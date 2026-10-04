import OpenAI from "openai";
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { executeSkill, describeSkills } from "./skill";

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'coverage', '.cache']);
const MAX_GREP_HITS = 200;
const MAX_LIST_ENTRIES = 500;

// 统一的工具执行入口
export async function executeTool(name: string, args: any): Promise<string> {
  try {
    switch (name) {
      case 'read_file':
        return await readFile(args.filePath, args.startLine, args.endLine);
      case 'write_file':
        return await writeFile(args.filePath, args.content);
      case 'edit_file':
        return await editFile(args.filePath, args.oldString, args.newString, args.replaceAll === true);
      case 'list_files':
        return await listFiles(args.path ?? '.', args.depth);
      case 'grep_search':
        return await grepSearch(args.pattern, args.path ?? '.', args.include);
      case 'run_shell':
        return await runShell(args.command, args.cwd);
      case 'skill':
        return runSkillTool(args);
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: any) {
    return `${name} failed: ${err?.message ?? err}`;
  }
}


// ---------- 工具实现 ----------

async function readFile(filePath: string, startLine?: number, endLine?: number): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');
  if (startLine == null && endLine == null) return content;

  const lines = content.split('\n');
  const start = Math.max(1, startLine ?? 1);
  const end = Math.min(lines.length, endLine ?? lines.length);
  return lines
    .slice(start - 1, end)
    .map((line, i) => `${start + i}: ${line}`)
    .join('\n');
}

async function writeFile(filePath: string, content: string): Promise<string> {
  await fs.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
  const bytes = Buffer.byteLength(content, 'utf-8');
  return `Wrote ${bytes} bytes to ${filePath}`;
}

async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');
  const hits = content.split(oldString).length - 1;

  if (hits === 0) {
    return `Error: oldString not found in ${filePath}`;
  }
  if (hits > 1 && !replaceAll) {
    return `Error: oldString matches ${hits} places in ${filePath}, make it more specific or pass replaceAll: true`;
  }

  const updated = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);

  await fs.writeFile(filePath, updated, 'utf-8');
  return `Edited ${filePath} (${hits} replacement${hits > 1 ? 's' : ''})`;
}

async function listFiles(dir: string, depth = 3): Promise<string> {
  const entries: string[] = [];

  async function walk(current: string, remaining: number): Promise<void> {
    if (remaining < 0 || entries.length >= MAX_LIST_ENTRIES) return;
    const dirents = await fs.readdir(current, { withFileTypes: true });
    for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entries.length >= MAX_LIST_ENTRIES) return;
      const rel = path.relative(dir, path.join(current, dirent.name)) || dirent.name;
      if (dirent.isDirectory()) {
        if (IGNORE_DIRS.has(dirent.name)) continue;
        entries.push(`${rel}/`);
        await walk(path.join(current, dirent.name), remaining - 1);
      } else {
        entries.push(rel);
      }
    }
  }

  await walk(path.resolve(dir), depth - 1);
  if (entries.length === 0) return `No files found in ${dir}`;
  return entries.join('\n');
}

function run(cmd: string, cwd?: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) resolve(`Command failed: ${stderr || err.message}`);
      else resolve(stdout || 'Command executed successfully with no output.');
    });
  });
}

async function grepSearch(pattern: string, dir: string, include?: string): Promise<string> {
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const excludes = [...IGNORE_DIRS]
    .map((d) => `--exclude-dir=${d}`)
    .join(' ');

  // 优先 ripgrep，没有则退回 grep
  const hasRg = await new Promise<boolean>((resolve) => {
    exec('command -v rg', (err) => resolve(!err));
  });

  let cmd: string;
  if (hasRg) {
    const includeArg = include ? ` --glob ${quote(include)}` : '';
    cmd = `rg -n --no-heading --color never -e ${quote(pattern)}${includeArg} ${excludes.replace(/--exclude-dir=/g, '--glob=!*')} ${quote(dir)}`;
  } else {
    const includeArg = include ? ` --include=${quote(include)}` : '';
    cmd = `grep -rn${includeArg} ${excludes} -E -e ${quote(pattern)} ${quote(dir)}`;
  }

  const out = await run(cmd);
  if (out.startsWith('Command failed')) {
    if (/no matches|exit status 1/i.test(out)) return `No matches for pattern: ${pattern}`;
    return out;
  }
  const lines = out.split('\n').filter(Boolean);
  if (lines.length > MAX_GREP_HITS) {
    return [...lines.slice(0, MAX_GREP_HITS), `... ${lines.length - MAX_GREP_HITS} more matches truncated`].join('\n');
  }
  return out;
}

async function runShell(command: string, cwd?: string): Promise<string> {
  return run(command, cwd, 60_000);
}

//找 skill，返回 skill 的文本
function runSkillTool(input: { skill_name: string; args?: string }): string {
  const result = executeSkill(input.skill_name, input.args || "");
  if (!result) return `Unknown skill: ${input.skill_name}. 可用: ${describeSkills()}`;
  const suffix = input.args ? ` (args: ${input.args})` : "";
  return `[Skill "${result.name}" activated${suffix}]\n\n${result.content}`;
}
// ---------- 工具定义 ----------

/**
 * 每次请求都重新生成：skill 的 description 清单要实时反映磁盘上的 skill，
 * 模型读到清单才知道有哪些 skill 可调（自动触发）
 */
export function getToolDefinitions(): OpenAI.ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'skill',
        description:
          'Invoke a registered skill by name. A skill is a reusable set of instructions for a recurring task. ' +
          'Call it when the user references a skill (e.g. "/tdd") or when its description matches the current task.\n' +
          'Available skills:\n' +
          describeSkills(),
        parameters: {
          type: 'object',
          properties: {
            skill_name: { type: 'string', description: 'skill 的名字，不带斜杠，如 tdd' },
            args: { type: 'string', description: '可选参数，会替换 skill 正文里的 $ARGUMENTS' },
          },
          required: ['skill_name'],
        },
      },
    },
    ...baseToolDefinitions,
  ];
}

const baseToolDefinitions: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取指定路径的文件内容，可选按行号范围读取',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '文件相对或绝对路径' },
          startLine: { type: 'number', description: '起始行号(从1开始)，可选' },
          endLine: { type: 'number', description: '结束行号(含)，可选' },
        },
        required: ['filePath'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '向指定路径写入文件(覆盖)，父目录不存在时自动创建',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '文件相对或绝对路径' },
          content: { type: 'string', description: '要写入的完整文件内容' },
        },
        required: ['filePath', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '在文件中精确替换一段文本(需唯一匹配，除非 replaceAll)',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: '文件相对或绝对路径' },
          oldString: { type: 'string', description: '要被替换的原文，必须完全匹配' },
          newString: { type: 'string', description: '替换后的新文本' },
          replaceAll: { type: 'boolean', description: '是否替换所有匹配，默认 false' },
        },
        required: ['filePath', 'oldString', 'newString'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '递归列出目录下的文件和子目录(自动跳过 node_modules/.git 等)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径，默认当前目录' },
          depth: { type: 'number', description: '递归深度，默认 3' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description: '在目录中用正则表达式搜索内容，返回 文件:行号:内容',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '正则表达式' },
          path: { type: 'string', description: '搜索目录，默认当前目录' },
          include: { type: 'string', description: '文件名过滤，如 *.ts' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: '在指定目录下执行 Shell 命令(如 npm test, git status)',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 Bash 命令' },
          cwd: { type: 'string', description: '执行目录，默认当前项目目录' },
        },
        required: ['command'],
      },
    },
  },
];
