import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { createLlm, type Llm, type LlmConfig } from '../llm/provider.ts'
import { LOCALES } from '../core/types.ts'
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

/** 短简介每条三种语言大约 200 个 token；长文本（工具描述）按字符数估算，留出余量 */
const maxTokensFor = (n: number, chars: number) => Math.min(16_000, Math.max(300 * n, Math.ceil(chars * 1.2)) + 512)

/** 系统提示词及其版本：简介用 prompt.ts 的，工具描述用 tools/prompt.ts 的 */
export interface TranslatePrompt {
  system: string
  version: number
}

/**
 * 大模型翻译器：一次请求翻译一批条目，通过强制调用工具拿到结构化 JSON；模型服务（Claude / OpenAI 兼容）由配置决定。
 * 原文由调用方规范化后原样发送。模型对原文语言（或非自然语言）返回空字符串时用原文补上，省去照抄原文的输出。
 */
export class LlmTranslator implements Translator {
  readonly promptVersion: number
  readonly provider: string
  readonly model: string
  private readonly llm: Llm
  private readonly system: string

  constructor(options: LlmConfig & { model: string; prompt?: TranslatePrompt }) {
    this.model = options.model
    this.llm = createLlm(options)
    this.provider = this.llm.provider
    this.system = options.prompt?.system ?? SYSTEM_PROMPT
    this.promptVersion = options.prompt?.version ?? PROMPT_VERSION
  }

  async translate(items: TranslationItem[], signal?: AbortSignal): Promise<{ results: TranslationResult[]; usage: TranslatorUsage }> {
    const payload = items.map((item, i) => ({ id: String(i + 1), ...(item.name ? { name: item.name } : {}), text: item.text }))
    const chars = items.reduce((sum, item) => sum + item.text.length, 0)
    const { output, usage } = await this.llm.tool({
      model: this.model,
      system: this.system,
      tool: TOOL,
      input: JSON.stringify(payload),
      maxTokens: maxTokensFor(items.length, chars),
      schema: outputSchema,
      signal,
    })

    const results: TranslationResult[] = []
    for (const entry of output.items) {
      const item = items[Number(entry.id) - 1]
      if (!item) continue
      const texts = { zh: entry.zh.trim(), en: entry.en.trim(), ja: entry.ja.trim() }
      for (const locale of LOCALES) if (!texts[locale] && (entry.source_locale === locale || entry.source_locale === 'other')) texts[locale] = item.text
      results.push({ hash: item.hash, sourceLocale: entry.source_locale, texts })
    }
    return { results, usage }
  }
}
