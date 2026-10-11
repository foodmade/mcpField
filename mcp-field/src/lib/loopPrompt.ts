import type { LoopDetail, Playbook } from './api/entities'

type PromptText = { start: (n: string) => string; goal: string; max: string; between: string; exit: string; step: (i: number) => string; sep: string; period: string }

const end = (s: string, period: string) => (/[.。!！?？]$/.test(s.trim()) ? s.trim() : s.trim() + period.trim())

/**
 * 启动提示词：用我们自己的模板，把目标、最大轮数、步骤、检查命令、退出条件拼成一段可直接粘贴给 Agent 的指令。
 */
export function buildLoopPrompt(l: Pick<LoopDetail, 'name' | 'maxIterations' | 'checkCommand'>, playbook: Playbook, p: PromptText): string {
  const lines = [p.start(l.name)]
  if (playbook.goal) lines.push(`${p.goal}${p.sep}${end(playbook.goal, p.period)}`)
  if (l.maxIterations) lines.push(`${p.max}${p.sep}${l.maxIterations}${p.period.trim()}`)
  playbook.steps.forEach((s, i) => {
    const detail = [s.body, s.command && `\`${s.command}\``].filter(Boolean).join(' ')
    lines.push(`${p.step(i + 1)}${p.sep}${s.title}${detail ? ` — ${detail}` : ''}`)
  })
  if (l.checkCommand) lines.push(`${p.between}${p.sep}\`${l.checkCommand}\``)
  if (playbook.exitCondition) lines.push(`${p.exit}${p.sep}${end(playbook.exitCondition, p.period)}`)
  return lines.join('\n')
}
