import { spawn } from 'node:child_process'

/*
 * 安装 Skill：交给 skills.sh 的命令行工具（npx skills add），它知道几十种 Agent 各自的 Skill 目录。
 * MCP Field 收录的 Skill 都带着这条安装命令（installCommand），从里面取出来源和 Skill 名。
 */

/** skills CLI 认识的常见 Agent 标识（完整列表见 https://github.com/vercel-labs/skills） */
export const COMMON_AGENTS = ['claude-code', 'codex', 'gemini-cli', 'cursor', 'github-copilot', 'opencode', 'windsurf', 'cline', 'roo', 'goose', 'kiro-cli', 'qwen-code', 'trae', 'amp'] as const

/** MCP 握手时客户端报上来的名称 → skills CLI 的 Agent 标识；认不出时为 null */
export function agentFromClient(name: string | undefined | null): string | null {
  const v = (name ?? '').toLowerCase()
  if (!v) return null
  if (v.includes('claude-ai') || v.includes('desktop')) return null
  if (v.includes('claude')) return 'claude-code'
  if (v.includes('codex')) return 'codex'
  if (v.includes('gemini')) return 'gemini-cli'
  if (v.includes('cursor')) return 'cursor'
  if (v.includes('windsurf')) return 'windsurf'
  if (v.includes('opencode')) return 'opencode'
  if (v.includes('cline')) return 'cline'
  if (v.includes('copilot') || v.includes('vscode') || v.includes('visual studio code')) return 'github-copilot'
  return null
}

export interface SkillSource {
  /** 仓库地址或 owner/repo */
  source: string
  /** 仓库里的 Skill 名 */
  skill: string
}

/** 从 MCP Field 给出的安装命令里取来源和 Skill 名：npx skills add <source> --skill <name>；没有命令时用仓库地址和 skillSlug */
export function skillSource(d: { installCommand: string | null; skillSlug?: string | null; links: { repository: string | null } }): SkillSource | null {
  const m = d.installCommand?.match(/skills\s+add\s+(\S+).*?(?:--skill|-s)\s+(\S+)/)
  if (m) return { source: m[1]!, skill: m[2]! }
  if (d.links.repository && d.skillSlug) return { source: d.links.repository, skill: d.skillSlug }
  return null
}

export interface Audit {
  auditor: string
  result: string
  riskLevel?: string
  summary?: string
}

/** 审计没通过或风险等级为高的 Skill：需要用户明确同意才装 */
export function riskyAudits(audits: Audit[] | undefined): Audit[] {
  return (audits ?? []).filter((a) => a.result === 'fail' || ['HIGH', 'CRITICAL'].includes((a.riskLevel ?? '').toUpperCase()))
}

export function installArgs(src: SkillSource, agents: string[], global: boolean): string[] {
  return ['-y', 'skills', 'add', src.source, '--skill', src.skill, ...agents.flatMap((a) => ['--agent', a]), ...(global ? ['--global'] : []), '--yes']
}

const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')

/** 运行 npx skills add；返回退出码和输出的最后一段（去掉终端颜色） */
export function runInstall(args: string[], cwd: string, timeoutMs = 180_000): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const windows = process.platform === 'win32'
    const child = spawn(windows ? 'npx.cmd' : 'npx', args, { cwd, shell: windows, env: { ...process.env, CI: '1', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8000)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => {
      child.kill()
      output += `\nTimed out after ${Math.round(timeoutMs / 1000)} seconds.`
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, output: `Could not run npx: ${error.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, output: stripAnsi(output).trim().slice(-3000) })
    })
  })
}
