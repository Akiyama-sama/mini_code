import fs from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os';

export type SkillDefinition = {
    name: string
    description: string
    content: string
    source: 'user' | 'project'
}

let cachedSkills: SkillDefinition[] | null = null;

//这些顶层 md 不是 skill，跳过
const SKIP_NAMES = new Set(['readme', 'changelog', 'license', 'contributing', 'architect'])

/**
 * 手动/自动触发的共同入口：通过 skill_name 找到这个 skill 的内容。
 * args 会替换正文里的 $ARGUMENTS 占位符；找不到返回 null。
 */
export function executeSkill(skill_name: string, args: string = ''): SkillDefinition | null {
  const name = String(skill_name ?? '').trim().replace(/^\//, '')
  const hit = discoverSkills().find((s) => s.name === name)
  if (!hit) return null
  if (!args.trim() || !hit.content.includes('$ARGUMENTS')) return hit
  return { ...hit, content: hit.content.split('$ARGUMENTS').join(args) }
}

export function discoverSkills(): SkillDefinition[] {
  if (cachedSkills) return cachedSkills;

  const skills = new Map<string, SkillDefinition>();

  //先加载 user，再加载 project：同名时 project 覆盖 user
  loadSkillsFromDir(join(homedir(), ".agents", "skills"), "user", skills);
  loadSkillsFromDir(join(process.cwd(), ".mini_code", "skills"), "project", skills);

  cachedSkills = Array.from(skills.values());
  return cachedSkills;
}

/** 重新扫一次磁盘（/skills 菜单用，保证新建的 skill 能被看到） */
export function refreshSkills(): SkillDefinition[] {
  cachedSkills = null;
  return discoverSkills();
}

/** 给模型看的 skill 清单，用于自动触发（模型根据 description 决定要不要调 skill 工具） */
export function describeSkills(): string {
  const skills = discoverSkills();
  if (skills.length === 0) return 'No skills are currently registered.';
  return skills.map((s) => `- ${s.name}: ${s.description}`).join('\n');
}

/**
 * 通过目录来找这个 skill：
 *   <dir>/<name>/SKILL.md   目录式（主流格式）
 *   <dir>/<name>.md         单文件式
 */
function loadSkillsFromDir(dir: string, type: "user" | "project", skills: Map<string, SkillDefinition>) {
  if (!fs.existsSync(dir)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; //目录读不了就当没有
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    let file: string | null = null;
    let fallbackName = entry.name;

    if (entry.isDirectory()) {
      const candidate = join(dir, entry.name, 'SKILL.md');
      if (fs.existsSync(candidate)) file = candidate;
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      fallbackName = basename(entry.name, '.md');
      if (!SKIP_NAMES.has(fallbackName.toLowerCase())) file = join(dir, entry.name);
    }

    if (!file) continue;
    try {
      const skill = parseSkillFile(file, fallbackName, type);
      //Map.set 同名 key 会覆盖 value，所以后加载的 project 优先
      if (skill) skills.set(skill.name, skill);
    } catch {
      //坏文件直接跳过，不让一个 skill 拖垮全部发现
    }
  }
}

/** 解析 `---\nname: ...\ndescription: ...\n---\n正文`，frontmatter 缺失时正文就是整个文件 */
function parseSkillFile(file: string, fallbackName: string, source: 'user' | 'project'): SkillDefinition | null {
  const raw = fs.readFileSync(file, 'utf-8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  const meta: Record<string, string> = {};
  let content = raw;

  if (match) {
    const [, frontmatter, body] = match;
    content = (body ?? '').trim();
    for (const line of (frontmatter ?? '').split(/\r?\n/)) {
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (key) meta[key] = value;
    }
  }

  const name = (meta.name || fallbackName).trim();
  if (!name) return null;

  return {
    name,
    description: meta.description || '(no description)',
    content: content.trim(),
    source,
  };
}
