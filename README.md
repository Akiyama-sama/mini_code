# agent-learn

To install dependencies:

```bash
bun install
```

## 配置

配置采用「模板 + 本地私有文件」的形式：

- `env.conf.example` —— 随仓库提交的模板，只有占位值
- `env.conf` —— 本地真实配置（含 `API_KEY`），已被 `.gitignore` 忽略，不会被 push

首次运行先复制模板：

```bash
cp env.conf.example env.conf
```

然后按需修改 `env.conf`：

```bash
BASE_LOCAL_URL=http://localhost:11434/v1   # 本地模型的 OpenAI 兼容接口
LOCAL_MODEL=qwen2.5:7b

BASE_REMOTE_URL=https://api.example.com/v1 # 远程接口
REMOTE_MODEL=deepseek-v4.1-flash
API_KEY=sk-xxxx                            # 只写在这里，别写进 example

USAGE=REMOTE                               # REMOTE 或 LOCAL
```

没有 `env.conf` 时会自动退回 `env.conf.example` 并打印提示，方便别人 clone 后先跑起来。

推送前可以确认真实配置确实被忽略：

```bash
git check-ignore env.conf        # 有输出 = 已忽略
git check-ignore env.conf.example || echo "example 会进仓库"
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.9. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
