import type { Locale } from '../core/types.ts'
import { isHard, type Problem } from '../llm/batch.ts'
import { languageProblems } from '../llm/checks.ts'
import { normalizeSource } from './key.ts'
import type { TranslationItem, TranslationResult } from './types.ts'

export type ValidationProblem = Problem

const URL_RE = /https?:\/\/[^\s)（）。，、]*[^\s)（）。，、.,;:!?]/g
const CODE_RE = /`[^`]+`/g
/** 需要原样保留的词：含大写字母内拼、数字或点号的英文词，如 OpenRouter、GPT-4o、Node.js、macOS */
const TOKEN_RE = /\b[A-Za-z][a-z]*[A-Z0-9.][A-Za-z0-9.-]*[A-Za-z0-9]\b/g

/** 可以翻译的通用术语 */
const TRANSLATABLE = new Set(['GenAI'])

/**
 * 允许翻译的词，只有专有名词必须原样保留：
 * 通用缩写（LLM、LLMs、GUI）、全大写的普通词（CLIENT、MCP-SERVER）、带点的缩写（U.S、e.g）、普通复合词（AI-friendly）
 */
function isGeneric(token: string): boolean {
  return (
    TRANSLATABLE.has(token) ||
    /^[A-Z]{2,5}s?$/.test(token) ||
    /^[A-Z-]+$/.test(token) ||
    /^([A-Za-z]\.)+[A-Za-z]?$/.test(token) ||
    /-[a-z]/.test(token)
  )
}

/** 原文里必须在每种译文中原样出现的片段：网址、行内代码、专有名词 */
export function protectedTokens(text: string): string[] {
  const tokens = new Set<string>()
  for (const re of [URL_RE, CODE_RE]) for (const m of text.matchAll(re)) tokens.add(m[0])
  // 网址和代码已整体保护，去掉后再找专有名词，避免把 a.dev 这类片段重复计入
  const prose = text.replace(URL_RE, ' ').replace(CODE_RE, ' ')
  for (const m of prose.matchAll(TOKEN_RE)) if (!isGeneric(m[0])) tokens.add(m[0])
  return [...tokens].filter((t) => t.length >= 3)
}

/** 自然语言单词数：只有名称、网址这类文本时跳过语言相关的检查 */
function wordCount(text: string): number {
  const latin = text.replace(URL_RE, '').match(/[A-Za-z]{2,}/g)?.length ?? 0
  const cjk = text.match(/[぀-ヿ一-鿿]/g)?.length ?? 0
  return latin + Math.ceil(cjk / 2)
}

export function validateTranslation(item: TranslationItem, result: TranslationResult): Problem[] {
  const { zh, en, ja } = result.texts
  const natural = result.sourceLocale !== 'other' && wordCount(item.text) >= 3
  const problems = languageProblems(result.texts, item.text, natural)
  const each = Object.entries(result.texts) as [Locale, string][]

  for (const token of protectedTokens(item.text)) {
    for (const [locale, value] of each) if (!value.includes(token)) problems.push({ code: 'missing_token', hard: false, locale, detail: token })
  }

  // 以英文长度为基准：中文通常是英文字符数的 0.3–0.7，日文 0.35–0.9
  if (natural && en.length >= 30) {
    const ratio = (s: string) => s.length / en.length
    if (ratio(zh) < 0.15 || ratio(zh) > 1.4) problems.push({ code: 'length_ratio', hard: false, locale: 'zh', detail: ratio(zh).toFixed(2) })
    if (ratio(ja) < 0.2 || ratio(ja) > 1.8) problems.push({ code: 'length_ratio', hard: false, locale: 'ja', detail: ratio(ja).toFixed(2) })
  }

  // 模型有时会在译文前面加上"名称 - "
  const name = item.name ? normalizeSource(item.name) : ''
  if (name && !normalizeSource(item.text).toLowerCase().includes(name.toLowerCase())) {
    for (const [locale, value] of each) if (value.toLowerCase().startsWith(name.toLowerCase())) problems.push({ code: 'name_added', hard: false, locale, detail: name })
  }
  return problems
}

export const isHardFailure = isHard
