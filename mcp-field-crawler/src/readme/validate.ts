import type { Problem } from '../llm/batch.ts'
import { localeProblems } from '../llm/checks.ts'
import { PLACEHOLDER_RE, sentenceWords } from './chunk.ts'
import type { ReadmeLocale } from './prompt.ts'

const placeholders = (s: string) => [...s.matchAll(PLACEHOLDER_RE)].map((m) => m[0]).sort()

/**
 * 链接、图片地址和 HTML 里的 href/src：译文里必须一个不少。
 * 页内锚点（#installation）由标题文字生成，标题翻译后锚点随之变化是合理的，不检查。
 */
function urls(s: string): string[] {
  const found = new Set<string>()
  for (const m of s.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) found.add(m[1]!)
  for (const m of s.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) found.add(m[1]!)
  return [...found].filter((u) => !u.startsWith('#'))
}

const inlineCode = (s: string) => [...new Set([...s.matchAll(/`([^`\n]+)`/g)].map((m) => m[0]))]
const countLines = (s: string, re: RegExp) => s.split('\n').filter((l) => re.test(l)).length

/** 去掉占位符、链接地址、代码后的正文，用于语言检查和长度比较 */
function prose(s: string): string {
  return s
    .replace(PLACEHOLDER_RE, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/<[^>]+>/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
}

export function validateReadmeChunk(source: string, output: string, locale: ReadmeLocale): Problem[] {
  const problems: Problem[] = []
  if (placeholders(source).join() !== placeholders(output).join()) problems.push({ code: 'placeholder_mismatch', hard: true, locale })
  for (const url of urls(source)) if (!output.includes(url)) problems.push({ code: 'missing_url', hard: true, locale, detail: url })

  const src = prose(source)
  const out = prose(output)
  const cjk = out.match(/[぀-ヿ一-鿿]/g)?.length ?? 0
  const srcCjk = src.match(/[぀-ヿ一-鿿]/g)?.length ?? 0
  const letters = src.match(/[A-Za-z]/g)?.length ?? 0
  // 英文原文有不少成句的内容，译文却几乎没有中日文：没有翻译
  if (srcCjk < 20 && letters >= 200 && cjk < letters * 0.05) {
    problems.push({ code: 'not_translated', hard: sentenceWords(source) >= 30, locale })
  }
  problems.push(...localeProblems(locale, out, source))

  for (const code of inlineCode(source)) if (!output.includes(code)) problems.push({ code: 'missing_code', hard: false, locale, detail: code })
  if (countLines(source, /^#{1,6}\s/) !== countLines(output, /^#{1,6}\s/)) problems.push({ code: 'heading_mismatch', hard: false, locale })
  if (countLines(source, /^\s*\|/) !== countLines(output, /^\s*\|/)) problems.push({ code: 'table_mismatch', hard: false, locale })

  if (src.trim().length >= 300) {
    const ratio = out.trim().length / src.trim().length
    const [min, max] = locale === 'zh' ? [0.15, 1.3] : [0.2, 1.6]
    if (ratio < min || ratio > max) problems.push({ code: 'length_ratio', hard: false, locale, detail: ratio.toFixed(2) })
  }
  return problems
}
