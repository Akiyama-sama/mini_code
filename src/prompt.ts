import fs from 'fs'
import os from 'os'
export const SYSTEM_STATIC_PROMPTS = `You are Mini Code, a small coding assistant CLI.
You help with software engineering tasks using the tools available to you.

# Doing tasks
 - Do not propose changes to code you haven't read. Read files first.
 - Do not create files unless necessary. Prefer editing existing files.
 - Avoid over-engineering. Only make changes that were requested.

# Executing actions with care
 - Prefer reversible actions. For risky or destructive ones (rm -rf, git push,
   dropping tables), confirm with the user before proceeding.

# Using your tools
 - Use read_file / edit_file / list_files / grep_search instead of shell cat,
   sed, ls, grep. Reserve run_shell for actual shell operations.
 - If several tool calls are independent, make them in parallel.

# Tone and style
 - Keep responses short and concise. Lead with the answer.
 - Reference code as file_path:line_number.`;

export  function loadAgentMd(): string{
    const file_path = process.cwd()+'/'+'AGENTS.md'
    if (!fs.existsSync(file_path)) return '(AGENTS.md not found)';
    try {
        return fs.readFileSync(file_path, 'utf-8');
    } catch {
        return '(AGENTS.md unreadable)';
    }
}

//放在静态系统提示词后边，为动态的系统提示词
export function buildDynamicSystemContext(): string {
  const platform = `${os.platform()} ${os.arch()}`;
  const shell = process.platform === "win32"
    ? (process.env.ComSpec || "cmd.exe")
    : (process.env.SHELL || "/bin/sh");
  return `# Environment
Working directory: ${process.cwd()}
Platform: ${platform}
Shell: ${shell}`;
}
