import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { createLlm, type Llm, type LlmConfig } from '../llm/provider.ts'
import { normalizeSource } from './key.ts'
import { PROMPT_VERSION, SYSTEM_PROMPT } from './prompt.ts'
import type { TranslationItem, TranslationResult, Translator, TranslatorUsage } from './types.ts'

const TOOL: Anthropic.Tool = {
  name: 'submit_translations',
  description: 'Submit the localized texts, exactly one entry per input id.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            source_locale: { type: 'string', enum: ['zh', 'en', 'ja', 'other'] },
            zh: { type: 'string' },
            en: { type: 'string' },
            ja: { type: 'string' },
          },
          required: ['id', 'source_locale', 'zh', 'en', 'ja'],
        },
      },
    },
    required: ['items'],
  },
}

const outputSchema = z.object({
  items: z.array(
    z.object({
      id: z.coerce.string(),
      source_locale: z.enum(['zh', 'en', 'ja', 'other']).catch('other'),
      zh: z.string(),
      en: z.string(),
      ja: z.string(),
    }),
  ),
})

/** 每条译文三种语言大约 200 个 token，留出余量 */
const maxTokensFor = (n: number) => Math.min(16_000, 300 * n + 512)

/** 大模型翻译器：一次请求翻译一批条目，通过强制调用工具拿到结构化 JSON；模型服务（Claude / OpenAI 兼容）由配置决定 */
export class LlmTranslator implements Translator {
  readonly promptVersion = PROMPT_VERSION
  readonly provider: string
  readonly model: string
  private readonly llm: Llm

  constructor(options: LlmConfig & { model: string }) {
    this.model = options.model
    this.llm = createLlm(options)
    this.provider = this.llm.provider
  }

  async translate(items: TranslationItem[], signal?: AbortSignal): Promise<{ results: TranslationResult[]; usage: TranslatorUsage }> {
    const payload = items.map((item, i) => ({ id: String(i + 1), ...(item.name ? { name: item.name } : {}), text: normalizeSource(item.text) }))
    const { output, usage } = await this.llm.tool({
      model: this.model,
      system: SYSTEM_PROMPT,
      tool: TOOL,
      input: JSON.stringify(payload),
      maxTokens: maxTokensFor(items.length),
      schema: outputSchema,
      signal,
    })

    const results: TranslationResult[] = []
    for (const entry of output.items) {
      const item = items[Number(entry.id) - 1]
      if (!item) continue
      results.push({
        hash: item.hash,
        sourceLocale: entry.source_locale,
        texts: { zh: entry.zh.trim(), en: entry.en.trim(), ja: entry.ja.trim() },
      })
    }
    return { results, usage }
  }
}
