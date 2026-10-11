import type { EntityKind, Locale } from '../core/types.ts'
import type { LlmUsage } from '../llm/claude.ts'

/** 待翻译的一段原文 */
export interface TranslationItem {
  /** 原文指纹，见 key.ts */
  hash: string
  text: string
  /** 上下文：帮助模型识别产品名，不要求出现在译文里 */
  name?: string
  kind?: EntityKind
}

export type SourceLocale = Locale | 'other'

/** 一段原文的三语结果 */
export interface TranslationResult {
  hash: string
  sourceLocale: SourceLocale
  texts: Record<Locale, string>
}

export type TranslatorUsage = LlmUsage

/**
 * 翻译器接口（策略模式）：默认实现是 ClaudeTranslator，
 * 以后接 DeepL 等固定翻译服务只需再写一个实现，运行器和翻译记忆库不用改。
 */
export interface Translator {
  /** 写入翻译记忆库的提供方标识 */
  readonly provider: string
  readonly model: string
  /** 提示词或规则变化时递增，便于找出需要重翻的条目 */
  readonly promptVersion: number
  translate(items: TranslationItem[], signal?: AbortSignal): Promise<{ results: TranslationResult[]; usage: TranslatorUsage }>
}
