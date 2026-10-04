import fs from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { select } from '@inquirer/prompts';
import type { ChatCompletionMessageParam } from 'openai/resources';

const SESSION_DIR = join(process.cwd(), '.mini_code', 'sessions')

export interface AgentSession {
  sessionId: string;
  title: string;        // 首条用户消息的截断，用于列表展示
  createdAt: string;
  updatedAt: string;
  cwd: string;
  messages: ChatCompletionMessageParam[];
}

/** 会话创建时生成一次，之后复用；不是内容 hash，内容变也不会换 id */
export function createSessionId(): string {
  const ts = new Date().toISOString().replace(/[-:TZ]/g, '').slice(0, 14)
  return `${ts}_${randomBytes(3).toString('hex')}`
}

/** 从消息里挑出首条 user 文本，压成一行做标题 */
export function buildTitle(messages: ChatCompletionMessageParam[]): string {
  const first = messages.find((m) => m.role === 'user' && typeof m.content === 'string')
  const text = typeof first?.content === 'string' ? first.content : '(empty)'
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > 40 ? oneLine.slice(0, 40) + '…' : oneLine
}

function ensureDir() {
  fs.mkdirSync(SESSION_DIR, { recursive: true })
}

function sessionPath(sessionId: string) {
  return join(SESSION_DIR, `${sessionId}.json`)
}

/** 保存会话：同一个 sessionId 永远覆盖同一个文件（先写 tmp 再 rename，原子替换） */
export function saveSession(data: AgentSession): void {
  ensureDir()
  const target = sessionPath(data.sessionId)
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, target)
}

/** 列出所有已保存会话，按更新时间倒序 */
export function getSessionList(): AgentSession[] {
  if (!fs.existsSync(SESSION_DIR)) return []
  const sessions: AgentSession[] = []
  for (const file of fs.readdirSync(SESSION_DIR)) {
    if (!file.endsWith('.json')) continue
    try {
      sessions.push(JSON.parse(fs.readFileSync(join(SESSION_DIR, file), 'utf-8')))
    } catch {
      // 损坏的文件直接跳过
    }
  }
  return sessions.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

/** 按 id 读回单个会话 */
export function loadSession(sessionId: string): AgentSession | null {
  try {
    return JSON.parse(fs.readFileSync(sessionPath(sessionId), 'utf-8'))
  } catch {
    return null
  }
}

/** 打印会话列表并让用户选择，返回 sessionId；没有会话时返回 null */
export async function promptSelectSession(): Promise<string | null> {
  const sessions = getSessionList()
  if (sessions.length === 0) {
    console.log('\n还没有保存过的会话。')
    return null
  }

  const selectedSessionId = await select<string>({
    message: '选择要恢复的会话 (使用上下键选择):',
    pageSize: 10,
    choices: sessions.map((s) => ({
      name: `${s.title}  [${s.updatedAt}]  ${s.messages.length} 条消息`,
      value: s.sessionId,
    })),
  });

  return selectedSessionId
}
