# mini code

这是一个最小的 coding agent 实现，核心功能包括

- agent loop 循环:  用户询问，agent 调用工具 -> 把调用工具的结果返回给 agent -> agent 再根据内容执行后续操作，循环往复，直到不再调用工具，即认为 agent 已经完成这个任务
- system prompt：静态提示词+动态提示词。静态提示词包含它的角色，可以做什么，动态提示词包括它目前的一个执行目录+系统环境+可以调用的 skill 的描述
- 会话记录持久化：每一个会话会存在`.mini_code/sessions`里面，为一个 json，对话结束自动保存，可以选择历史会话进行继续
- skill 加载，手动触发+agent 自动触发：skill 加载作为 agent 调用工具的其中之一，需要时自动调用工具进行触发。手动触发，查找用户目录`~/.agents/skills/`下的 skills 以及`.mini_code/skills`里面的 skill，输入`/skill-name`skill的名字后，会将 skill的内容进行替换，所以本质上还是一个可复用的 prompt 


主要是参考的：
https://github.com/Windy3f3f3f3f/claude-code-from-scratch
这个项目，我自己自学的时候把里面认为最重要的最核心的部分进行实现，其他部分算是优化+边界约束，无论是上下文管理+权限管理


# 如何安装

```bash
git clone https://github.com/Akiyama-sama/mini_code.git
cd mini_code
bun install
```

## 配置

```bash
cp env.conf.example env.conf
```

然后按需修改 `env.conf`：

```bash
BASE_LOCAL_URL=http://localhost:11434/v1   # 本地模型的 OpenAI 兼容接口
LOCAL_MODEL=qwen2.5:7b

BASE_REMOTE_URL=https://api.example.com/v1 # 远程接口（只适配 openai的兼容形式）
REMOTE_MODEL=deepseek-v4.1-flash
API_KEY=sk-xxxx                            # 只写在这里，别写进 example

USAGE=REMOTE                               # REMOTE 或 LOCAL
```
To run:

```bash
bun run code
```

# 如何使用

- 查历史会话：`/resume`
- 查有哪些 skill： `/skills`
- 调用本机的已有的 skill：`/skill-name`(skill 自己的名字)
- 退出: `/exit`
