import type { LlmUsage } from '../llm/claude.ts'
import { createLlm, type Llm, type LlmConfig } from '../llm/provider.ts'
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

/** 大模型 README 翻译器：模型服务（Claude / OpenAI 兼容）由配置决定 */
export class LlmReadmeTranslator implements ReadmeTranslator {
  readonly promptVersion = README_PROMPT_VERSION
  readonly provider: string
  readonly model: string
  private readonly llm: Llm

  constructor(options: LlmConfig & { model: string }) {
    this.model = options.model
    this.llm = createLlm(options)
    this.provider = this.llm.provider
  }

  translate(chunk: string, locale: ReadmeLocale, signal?: AbortSignal) {
    return this.llm.text({
      model: this.model,
      system: readmeSystemPrompt(locale),
      input: `<source>\n${chunk}\n</source>`,
      maxTokens: maxTokensFor(chunk.length),
      tag: 'translation',
      signal,
    })
  }
}
