import { LOCALES, type Locale } from '../core/types.ts'
import type { Problem } from '../llm/batch.ts'
import { languageProblems, longestCopiedCjkRun, longestCopiedPhrase } from '../llm/checks.ts'
import type { DescribeContent, DescribeInput, DescribeResult } from './types.ts'

/** 与参考文字连续相同的英文词数 / 中文字数：达到即视为沿用原文措辞，需要重写 */
const COPY_WORDS_HARD = 6
const COPY_WORDS_SOFT = 4
const COPY_CJK_HARD = 12

const joined = (c: DescribeContent) =>
  [c.tagline, c.summary, ...c.features, ...c.useCases, c.goal ?? '', c.exitCondition ?? '', ...(c.steps ?? []).flatMap((s) => [s.title, s.body])].join('\n')

/** 必须原样保留的事实（命令、链接、名称），不参与照抄检测 */
const VERBATIM_FACTS = new Set(['command', 'aliases', 'install', 'examples', 'checkCommand', 'repository', 'homepage', 'website', 'supportedAgents', 'author'])

/**
 * 事实里的短标签和条件说明（goalNote、exitNote、commandLabels、capabilityLabels 等）：
 * 常常就是和命令输出对应的技术条件（如"migrate status shows no pending migrations"），沿用只标记待抽查。
 */
function labelText(input: DescribeInput): string {
  return Object.entries(input.facts)
    .filter(([key]) => !VERBATIM_FACTS.has(key))
    .flatMap(([, v]) => (Array.isArray(v) ? v : [v]))
    .filter((v): v is string => typeof v === 'string' && !/^https?:/.test(v) && !input.commands.includes(v))
    .join('\n')
}

export function validateDescription(input: DescribeInput, result: DescribeResult): Problem[] {
  const c = result.content
  const source = [input.name, input.background.en ?? '', input.background.zh ?? ''].join('\n')
  const problems = languageProblems(Object.fromEntries(LOCALES.map((l) => [l, joined(c[l])])) as Record<Locale, string>, source)

  for (const l of LOCALES) {
    if (!c[l].tagline) problems.push({ code: 'empty_tagline', hard: true, locale: l })
    if (!c[l].summary) problems.push({ code: 'empty_summary', hard: true, locale: l })
  }
  if (input.kind !== 'loop' && c.en.features.length < 2) problems.push({ code: 'few_features', hard: true, locale: 'en' })

  if (input.kind === 'loop') {
    for (const l of LOCALES) {
      if (!c[l].goal || !c[l].exitCondition) problems.push({ code: 'missing_goal_or_exit', hard: true, locale: l })
      if ((c[l].steps?.length ?? 0) < 2) problems.push({ code: 'few_steps', hard: true, locale: l })
    }
    // 步骤在各语言间按位置对应，数量和命令下标必须一致
    const signature = (l: Locale) => (c[l].steps ?? []).map((s) => s.commandIndex).join(',')
    if (new Set(LOCALES.map(signature)).size > 1) problems.push({ code: 'steps_mismatch', hard: true })
    const used = (c.en.steps ?? []).map((s) => s.commandIndex).filter((i) => i >= 0)
    if (used.some((i) => i >= input.commands.length)) problems.push({ code: 'unknown_command', hard: true })
    const missing = input.commands.filter((_, i) => !used.includes(i))
    if (missing.length > 0) problems.push({ code: 'commands_not_used', hard: false, detail: missing.join(' | ') })
  }

  for (const list of ['features', 'useCases'] as const) {
    const counts = LOCALES.map((l) => c[l][list].length)
    if (new Set(counts).size > 1) problems.push({ code: 'count_mismatch', hard: false, detail: `${list}: ${counts.join('/')}` })
  }

  // 名称本身不算照抄：比较前把名称从两边去掉
  const strip = (t: string) => t.split(input.name).join(' ')
  const output = strip(joined(c.en))
  // 源站的说明文字：沿用措辞需要重写
  const prose = longestCopiedPhrase(output, strip(input.background.en ?? ''))
  if (prose.words >= COPY_WORDS_HARD) problems.push({ code: 'copied_from_source', hard: true, locale: 'en', detail: `${prose.words} words: ${prose.phrase}` })
  else if (prose.words >= COPY_WORDS_SOFT) problems.push({ code: 'copied_from_source', hard: false, locale: 'en', detail: `${prose.words} words: ${prose.phrase}` })
  // 短标签和条件说明：只标记待抽查
  const labels = longestCopiedPhrase(output, strip(labelText(input)))
  if (labels.words >= COPY_WORDS_HARD) problems.push({ code: 'reused_label', hard: false, locale: 'en', detail: `${labels.words} words: ${labels.phrase}` })
  if (input.background.zh) {
    const chars = longestCopiedCjkRun(joined(c.zh), input.background.zh)
    if (chars >= COPY_CJK_HARD) problems.push({ code: 'copied_from_source', hard: true, locale: 'zh', detail: `${chars} chars` })
  }

  if (c.en.tagline.split(/\s+/).length > 24) problems.push({ code: 'tagline_too_long', hard: false, locale: 'en' })
  return problems
}
