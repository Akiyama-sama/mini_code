import Agent from "./agents";
import readline from 'readline'
import { select } from '@inquirer/prompts';
import { promptSelectSession, loadSession } from "./session";
import { refreshSkills } from "./skill";

//内置斜杠命令，和 skill 区分开
const BUILTIN_COMMANDS = new Set(['/exit', '/quit', '/resume', '/skills']);
export async function runRepl(agent:Agent) {
    const rl = readline.createInterface({
        input:process.stdin,
        output:process.stdout
    })
    //如果碰到退出信号
    let sigintCount = 0;
    process.on('SIGINT',()=>{
        //只有一次退出信号
        sigintCount++
        if(sigintCount === 1){
            //agent 退出输出
            agent.abort()
            console.log('用户打断会话')
        } else if(sigintCount >=2){
            //退出整个进程
            console.log("\nBye!\n"); 
            process.exit(0); 
        }
    })
    printWelcome();

    //输入信号
    // rl.once 而非 rl.on：保证严格串行，避免多个 chat 并发修改消息历史
    const askQuestion = (): void => {
        
        rl.once("line", async (line) => {
        let input = line.trim();
        sigintCount = 0;

        if (!input) { askQuestion(); return; }
        if (input === "/exit" || input === "/quit") { console.log("\nBye!\n"); process.exit(0); }

        if (input === "/resume") {
            const sessionId = await promptSelectSession();
            //inquirer 结束后把共享的 stdin pause 掉了；readline 自己的 paused 标志还是 false，
            //只调 rl.resume() 会变成 no-op，必须直接把 stdin 拉起来，否则进程会静默退出
            process.stdin.resume();
            rl.resume();
            if (sessionId) {
                const session = loadSession(sessionId);
                if (session) {
                    agent.restore(session);
                    console.log(`\n✅ 已恢复会话: ${session.title}\n`);
                } else {
                    printError(`读取会话失败: ${sessionId}`);
                }
            }
            askQuestion(); return;
        }
        if(input === '/skills'){
            //用@inquirer/prompts来选择已有的 skill，选中则是直接在 input 里面输入对应的 skill 的 name
            //后续解析这个输入内容的时候，需要在内部做一层转化，即/给替换为 skill 的 content
            const skills = refreshSkills(); //重新扫盘，刚新建的 skill 也能被列出
            if (skills.length === 0) {
                printError('没有发现任何 skill（可放 ~/.agents/skills/<name>/SKILL.md 或 .mini_code/skills/<name>/SKILL.md）');
                askQuestion(); return;
            }
            const picked = await select<string>({
                message: '选择一个 skill (使用上下键选择):',
                pageSize: 10,
                choices: skills.map((s) => ({
                    name: `${s.name} — ${s.description.length > 70 ? s.description.slice(0, 70) + '…' : s.description}`,
                    value: s.name,
                })),
            });
            input = `/${picked}`;
            //同上：把 stdin 还给 readline，否则选完 skill 后 REPL 收不到下一行输入，进程会直接退出
            process.stdin.resume();
            rl.resume();
            console.log(`\n🎯 已选择 skill: ${input}（想带任务/参数就直接输入 /名字 内容）\n`);
        }

        //手动触发兜底：/开头但既不是内置命令也不对应任何 skill，直接提示，不发给模型
        const head = input.startsWith('/') ? input.split(/\s+/)[0] : '';
        if (head && !BUILTIN_COMMANDS.has(head)) {
            const name = head.slice(1);
            //refresh：用户可能刚建好 skill 就直接打 /名字
            const known = refreshSkills().some((s) => s.name.toLowerCase() === name.toLowerCase());
            if (!known) {
                printError(`未找到 skill: ${head}（输入 /skills 查看可用列表）`);
                askQuestion(); return;
            }
        }
        
        try {
            await agent.chat(input);
        } catch (e: any) {
            if (e.name !== "AbortError" && !e.message?.includes("aborted")) printError(e.message);
        }

        askQuestion();
        });
    };

    askQuestion();

}
function printWelcome(){
    console.log('你好，早安，午安，晚上好，晚安 ！！')
}
function printError(message:string){
    console.log(`ERROR: ${message}`)
}