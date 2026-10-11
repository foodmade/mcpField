import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { LOCALES } from '../core/types.ts'
import { callTool, createClaude, type ClaudeConfig, type LlmUsage } from '../llm/claude.ts'
import { OVERVIEW_PROMPT_VERSION, OVERVIEW_SYSTEM_PROMPT } from './prompt.ts'
import { overviewKey, type OverviewInput, type OverviewResult, type OverviewWriter } from './types.ts'

const localeSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    features: { type: 'array', items: { type: 'string' } },
    use_cases: { type: 'array', items: { type: 'string' } },
    mcp: { type: 'string' },
  },
  required: ['summary', 'features', 'use_cases', 'mcp'],
} as const

const TOOL: Anthropic.Tool = {
  name: 'submit_overviews',
  description: 'Submit the overviews, exactly one entry per input id.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string' }, zh: localeSchema, en: localeSchema, ja: localeSchema }, required: ['id', 'zh', 'en', 'ja'] },
      },
    },
    required: ['items'],
  },
}

const contentSchema = z.object({
  summary: z.string(),
  features: z.array(z.string()),
  use_cases: z.array(z.string()),
  mcp: z.string().default(''),
})
const outputSchema = z.object({ items: z.array(z.object({ id: z.coerce.string(), zh: contentSchema, en: contentSchema, ja: contentSchema })) })

const clean = (list: string[]) => list.map((s) => s.trim().replace(/[。.]$/, '')).filter(Boolean)

/** 三种语言的介绍每条约 1,500 个 token，留出余量 */
const maxTokensFor = (n: number) => Math.min(16_000, 2_200 * n + 512)

export class ClaudeOverviewWriter implements OverviewWriter {
  readonly provider = 'claude'
  readonly promptVersion = OVERVIEW_PROMPT_VERSION
  readonly model: string
  private readonly client: Anthropic

  constructor(options: ClaudeConfig & { model: string }) {
    this.model = options.model
    this.client = createClaude(options)
  }

  async write(items: OverviewInput[], signal?: AbortSignal): Promise<{ results: OverviewResult[]; usage: LlmUsage }> {
    const payload = items.map((item, i) => ({
      id: String(i + 1),
      kind: item.kind,
      name: item.name,
      tagline: item.tagline,
      category: item.category,
      tags: item.tags,
      website: item.website,
      readme: item.readme,
    }))
    const { output, usage } = await callTool(this.client, {
      model: this.model,
      system: OVERVIEW_SYSTEM_PROMPT,
      tool: TOOL,
      input: JSON.stringify(payload),
      maxTokens: maxTokensFor(items.length),
      schema: outputSchema,
      signal,
    })

    const results: OverviewResult[] = []
    for (const entry of output.items) {
      const item = items[Number(entry.id) - 1]
      if (!item) continue
      const content = Object.fromEntries(
        LOCALES.map((l) => [l, { summary: entry[l].summary.trim(), features: clean(entry[l].features), useCases: clean(entry[l].use_cases), mcp: entry[l].mcp.trim() }]),
      ) as OverviewResult['content']
      results.push({ key: overviewKey(item), content })
    }
    return { results, usage }
  }
}
