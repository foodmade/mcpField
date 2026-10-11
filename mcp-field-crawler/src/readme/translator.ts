import type Anthropic from '@anthropic-ai/sdk'
import { callText, createClaude, type ClaudeConfig, type LlmUsage } from '../llm/claude.ts'
import { README_PROMPT_VERSION, readmeSystemPrompt, type ReadmeLocale } from './prompt.ts'

/** README 片段翻译器（策略模式）：一次翻译一个片段到一种语言 */
export interface ReadmeTranslator {
  readonly provider: string
  readonly model: string
  readonly promptVersion: number
  translate(chunk: string, locale: ReadmeLocale, signal?: AbortSignal): Promise<{ text: string; usage: LlmUsage }>
}

/** 中日文输出的 token 数大约是英文原文字符数的 0.6–0.9 倍，留出余量 */
const maxTokensFor = (chars: number) => Math.min(32_000, Math.ceil(chars * 1.2) + 2_048)

export class ClaudeReadmeTranslator implements ReadmeTranslator {
  readonly provider = 'claude'
  readonly promptVersion = README_PROMPT_VERSION
  readonly model: string
  private readonly client: Anthropic

  constructor(options: ClaudeConfig & { model: string }) {
    this.model = options.model
    this.client = createClaude(options)
  }

  translate(chunk: string, locale: ReadmeLocale, signal?: AbortSignal) {
    return callText(this.client, {
      model: this.model,
      system: readmeSystemPrompt(locale),
      input: `<source>\n${chunk}\n</source>`,
      maxTokens: maxTokensFor(chunk.length),
      tag: 'translation',
      signal,
    })
  }
}
