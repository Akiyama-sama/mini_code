import OpenAI from 'openai';
import { config } from './config';
import { getToolDefinitions, executeTool } from './tools';
import { discoverSkills, refreshSkills } from './skill';
import type { SkillDefinition } from './skill';
import { SYSTEM_STATIC_PROMPTS ,loadAgentMd,buildDynamicSystemContext} from './prompt';
import { saveSession, createSessionId, buildTitle } from './session';
import type { AgentSession } from './session';


const REQUEST = '你看看你现在的环境是什么，以及不调用 read_file这个工具，能够知道 AGENTS.md里面的内容吗，说出来'

const client = new OpenAI({
        baseURL: config.baseURL,
        apiKey: config.apiKey
});

class Agent {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    private sessionId: string;
    private createdAt: string;
    private controller?: AbortController;
    /** 本轮已经注入过的 skill，避免同一条消息被重复注入 */
    private injectedSkills = new Set<string>();

    constructor(session?: AgentSession){
        this.sessionId = session?.sessionId ?? createSessionId();
        this.createdAt = session?.createdAt ?? new Date().toISOString();
        // system 不落盘：恢复时按当前 cwd / AGENTS.md 重建
        this.messages = [this.systemMessage(), ...(session?.messages ?? [])];
        if (session) console.log(`\n📂 已加载会话 ${session.sessionId}（${session.messages.length} 条消息）`);
    }

    /** 每次都用当前环境重建，避免恢复出旧目录的上下文 */
    private systemMessage(): OpenAI.Chat.Completions.ChatCompletionMessageParam {
        return {
            role: 'system',
            content: SYSTEM_STATIC_PROMPTS + '\n' + buildDynamicSystemContext() + '\n' + loadAgentMd(),
        };
    }

    /** /resume 选中后，把持久化的消息灌回当前 agent */
    restore(session: AgentSession){
        this.sessionId = session.sessionId;
        this.createdAt = session.createdAt;
        this.messages = [this.systemMessage(), ...session.messages];
        //system 消息(含 skill 正文)不落盘，恢复后要允许重新注入
        this.injectedSkills.clear();
    }

    abort(){
        this.controller?.abort();
    }

    private autoSave(){
        try{
          saveSession({
            sessionId: this.sessionId,
            title: buildTitle(this.messages),
            createdAt: this.createdAt,
            updatedAt: new Date().toISOString(),
            cwd: process.cwd(),
            // system 不存，见 systemMessage()
            messages: this.messages.filter((m) => m.role !== 'system'),
          })  
        }catch(e){
            console.error(`\n⚠️ 会话保存失败: ${(e as Error).message}`)
        }
    }
    /**
     * 手动触发的落地：找出对话里以 / 开头、且命中已注册 skill 的字符串，
     * 把对应 skill 的正文作为 role: 'system' 的消息注入到消息列表
     */
    private injectSkills(){
        const text = this.messages
            .filter((m): m is OpenAI.Chat.Completions.ChatCompletionMessageParam =>
                m.role === 'user' || m.role === 'assistant')
            .map((m: any) => (typeof m.content === 'string' ? m.content : ''))
            .join('\n');

        //抽出所有 /xxx 形态的词，/resume、/exit 这类内置命令在下面匹配不到 skill 自然落空
        const tokens = text.split(/\s+/).filter((t) => t.startsWith('/'));
        if (tokens.length === 0) return;

        //重新扫盘：用户可能刚新建了 skill 就直接打 /名字
        const byName = new Map<string, SkillDefinition>();
        for (const s of refreshSkills()) byName.set(s.name.toLowerCase(), s);

        for (const token of tokens) {
            const raw = token.slice(1).replace(/[,.，。!！?？:：;；)）\]】]+$/, '');
            if (!raw) continue;
            const skill = byName.get(raw.toLowerCase());
            if (!skill || this.injectedSkills.has(skill.name)) continue;

            //历史里已经有这份正文(上一轮注入过)就不重复塞
            const alreadyIn = this.messages.some((m: any) =>
                m.role === 'system' &&
                typeof m.content === 'string' &&
                m.content.startsWith(`[Skill "${skill.name}"`)
            );
            this.injectedSkills.add(skill.name);
            if (alreadyIn) continue;

            this.messages.push({
                role: 'system',
                content: `[Skill "${skill.name}" activated]\n\n${skill.content}`,
            });
            console.log(`\n🎯 已注入 skill: ${skill.name}`);
        }
    }

    async chat(input:string) {
        this.messages.push({ role: 'user', content: input })
        //用户可能直接打了 /skill-name，先注入一次
        this.injectSkills()
        try {
        this.controller = new AbortController();
        while(true){

            const response =await client.chat.completions.create({
                model: config.model,
                messages: this.messages,
                stream:true,
                tools: getToolDefinitions(),
            }, { signal: this.controller.signal })
            
            
            let fullContent = '';
            const toolCalls: any[] = [];

            for await (const chunk of response) {
                const delta = chunk.choices[0]?.delta;

                // 1. 打印模型的思考文本输出
                if (delta?.content) {
                    process.stdout.write(delta.content);
                    fullContent += delta.content;
                }

                // 2. 收集流式的 Tool Call 碎片
                if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                    if (!toolCalls[tc.index]) {
                    toolCalls[tc.index] = {
                        id: tc.id,
                        type: 'function',
                        function: { name: tc.function?.name || '', arguments: '' }
                    };
                    }
                    if (tc.function?.arguments) {
                    toolCalls[tc.index].function.arguments += tc.function.arguments;
                    }
                }
                }
            }
            // 3. 如果模型没有发起 Tool Call，说明工作结束，跳出循环
            if (toolCalls.length === 0) {
                this.messages.push({ role: 'assistant', content: fullContent });
                console.log('\n\n✅ Agent 完成任务!');
                break;
            }

            // 把助手消息(含 tool_calls)完整写回，tool 结果必须紧随其后
            const normalizedCalls = toolCalls.map((tc, index) => ({
                id: tc.id ?? `call_${index}`,
                type: 'function' as const,
                function: { name: tc.function.name, arguments: tc.function.arguments || '{}' },
            }));
            this.messages.push({
                role: 'assistant',
                content: fullContent || null,
                tool_calls: normalizedCalls,
            });

            // 4. 执行所有被调用的工具，并将结果写回 messages (role: 'tool')
            for (const toolCall of normalizedCalls) {
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);
                
                console.log(`\n🛠️ 执行工具: ${functionName}(${JSON.stringify(functionArgs)})`);
                const result = await executeTool(functionName, functionArgs);

                this.messages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: result,
                });
            }
            // 5. 找到所有调用 以/开头的字符串，并且找到对应 skill 的 content 注入到消息列表当中,role为system
            this.injectSkills();

        }
        } finally {
            // 中断可能停在半途：assistant 发出了 tool_calls 却没等到 tool 结果，
            // 这种半截历史存下来，下次恢复请求会直接 400，先裁掉
            while (this.messages.length > 0) {
                const last: any = this.messages[this.messages.length - 1];
                if (last.role === 'assistant' && last.tool_calls?.length) this.messages.pop();
                else break;
            }
            // 正常结束 / 报错 / Ctrl+C 中断，都会落盘
            this.autoSave();
        }
    }
}
 
export default Agent