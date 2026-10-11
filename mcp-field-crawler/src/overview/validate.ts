import { LOCALES, type Locale } from '../core/types.ts'
import type { Problem } from '../llm/batch.ts'
import { languageProblems, longestCopiedRun } from '../llm/checks.ts'
import type { OverviewInput, OverviewResult } from './types.ts'

/** 与 README 连续相同的词数：达到 HARD 视为照抄需要重写，达到 SOFT 标记待抽查 */
const COPY_HARD = 15
const COPY_SOFT = 10

const joined = (c: OverviewResult['content'][Locale]) => [c.summary, ...c.features, ...c.useCases, c.mcp].join('\n')

export function validateOverview(input: OverviewInput, result: OverviewResult): Problem[] {
  const c = result.content
  const source = [input.name, input.tagline ?? '', input.readme].join('\n')
  const problems = languageProblems({ zh: joined(c.zh), en: joined(c.en), ja: joined(c.ja) }, source)

  for (const locale of LOCALES) {
    if (!c[locale].summary) problems.push({ code: 'empty_summary', hard: true, locale })
    if (c[locale].features.length === 0) problems.push({ code: 'no_features', hard: true, locale })
  }

  // 三种语言应该一一对应
  for (const list of ['features', 'useCases'] as const) {
    const counts = LOCALES.map((l) => c[l][list].length)
    if (new Set(counts).size > 1) problems.push({ code: 'count_mismatch', hard: false, detail: `${list}: ${counts.join('/')}` })
  }

  const copied = longestCopiedRun(joined(c.en), input.readme)
  if (copied >= COPY_HARD) problems.push({ code: 'copied_from_readme', hard: true, locale: 'en', detail: `${copied} words` })
  else if (copied >= COPY_SOFT) problems.push({ code: 'copied_from_readme', hard: false, locale: 'en', detail: `${copied} words` })

  if (c.zh.summary.length > 200) problems.push({ code: 'too_long', hard: false, locale: 'zh', detail: String(c.zh.summary.length) })
  if (c.en.summary.split(/\s+/).length > 90) problems.push({ code: 'too_long', hard: false, locale: 'en' })
  return problems
}
