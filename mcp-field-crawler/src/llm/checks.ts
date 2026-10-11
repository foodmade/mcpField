import type { Locale } from '../core/types.ts'
import type { Problem } from './batch.ts'

/* 多语言输出的通用语言检查：翻译和生成介绍共用 */

const KANA = /[぀-ヿ]/
const KANA_RUN = /[぀-ヿ]+/g
const HAN = /[一-鿿]/g
/** 日文里不会出现的简体字，以及只在中文里使用的词：出现即说明日文混入了中文 */
const SIMPLIFIED_ONLY = /[这们个应软实现务发记执项开关库据说书图门问]|助手|大模型|大モデル/

/**
 * 单一语言输出的检查。
 * @param source  原文：其中本来就有的假名（如日文产品名）允许出现在中文里，原文里有的中文词也允许出现在日文里
 * @param natural 是否是自然语言（只有名称、网址时跳过"日文必须有假名"的检查）
 */
export function localeProblems(locale: Locale, text: string, source: string, natural = true): Problem[] {
  const problems: Problem[] = []
  if (!text.trim()) return [{ code: 'empty', hard: true, locale }]
  if (locale === 'zh') {
    const sourceKana = new Set(source.match(KANA_RUN) ?? [])
    const zhKana = (text.match(KANA_RUN) ?? []).filter((run) => !sourceKana.has(run))
    if (zhKana.length > 0) problems.push({ code: 'kana_in_zh', hard: true, locale, detail: zhKana[0] })
  }
  if (locale === 'ja') {
    // 只有汉字和英文的短日文是正常的，汉字多时才要求出现假名
    const hanCount = text.match(HAN)?.length ?? 0
    if (natural && !KANA.test(text) && hanCount >= 8) problems.push({ code: 'no_kana_in_ja', hard: true, locale })
    const zhWord = text.match(SIMPLIFIED_ONLY)?.[0]
    if (zhWord && !source.includes(zhWord)) problems.push({ code: 'chinese_in_ja', hard: true, locale, detail: zhWord })
  }
  return problems
}

/** 三种语言的输出一起检查 */
export function languageProblems(texts: Record<Locale, string>, source: string, natural = true): Problem[] {
  return (Object.entries(texts) as [Locale, string][]).flatMap(([locale, text]) => localeProblems(locale, text, source, natural))
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+(?:['+.-][a-z0-9]+)*/g) ?? []

/** 输出与原文之间最长的连续相同片段：返回词数和片段本身，用来发现照抄原文的句子 */
export function longestCopiedPhrase(output: string, source: string): { words: number; phrase: string } {
  const src = words(source)
  const out = words(output)
  if (src.length === 0 || out.length === 0) return { words: 0, phrase: '' }
  // 用 3 词片段建索引，再向后延伸匹配
  const N = 3
  const index = new Map<string, number[]>()
  for (let i = 0; i + N <= src.length; i++) {
    const key = src.slice(i, i + N).join(' ')
    const list = index.get(key)
    if (list) list.push(i)
    else index.set(key, [i])
  }
  let best = { words: 0, phrase: '' }
  for (let j = 0; j + N <= out.length; j++) {
    for (const i of index.get(out.slice(j, j + N).join(' ')) ?? []) {
      let len = N
      while (i + len < src.length && j + len < out.length && src[i + len] === out[j + len]) len++
      if (len > best.words) best = { words: len, phrase: out.slice(j, j + len).join(' ') }
    }
  }
  return best
}

/** 输出与原文之间最长的连续相同词数 */
export const longestCopiedRun = (output: string, source: string) => longestCopiedPhrase(output, source).words

/** 中日文输出与原文之间最长的相同连续汉字/假名片段长度（中文照抄检测） */
export function longestCopiedCjkRun(output: string, source: string): number {
  const cjk = (s: string) => s.replace(/[^぀-ヿ一-鿿]/g, '')
  const a = cjk(output)
  const b = cjk(source)
  if (!a || !b) return 0
  let best = 0
  // 动态规划求最长公共子串；文本都很短，直接 O(n·m)
  let prev: number[] = Array.from({ length: b.length + 1 }, () => 0)
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = Array.from({ length: b.length + 1 }, () => 0)
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1]! + 1
        if (cur[j]! > best) best = cur[j]!
      }
    }
    prev = cur
  }
  return best
}
