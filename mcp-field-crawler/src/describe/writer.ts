import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { LOCALES } from '../core/types.ts'
import type { LlmUsage } from '../llm/claude.ts'
import { createLlm, type Llm, type LlmConfig } from '../llm/provider.ts'
import { DESCRIBE_PROMPT_VERSION, describeSystemPrompt } from './prompt.ts'
import { describeKey, type DescribeContent, type DescribeInput, type DescribeKind, type DescribeResult, type DescribeWriter } from './types.ts'

const list = { type: 'array', items: { type: 'string' } } as const

function localeSchema(kind: DescribeKind) {
  const base: Record<string, unknown> = { tagline: { type: 'string' }, summary: { type: 'string' }, features: list, use_cases: list }
  const required = ['tagline', 'summary', 'features', 'use_cases']
  if (kind === 'loop') {
    base.goal = { type: 'string' }
    base.exit_condition = { type: 'string' }
    base.steps = {
      type: 'array',
      items: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, command_index: { type: 'integer' } }, required: ['title', 'body', 'command_index'] },
    }
    required.push('goal', 'exit_condition', 'steps')
  }
  return { type: 'object', properties: base, required }
}

function tool(kind: DescribeKind): Anthropic.Tool {
  const loc = localeSchema(kind)
  return {
    name: 'submit_descriptions',
    description: 'Submit the written copy, exactly one entry per input id.',
    input_schema: {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, zh: loc, en: loc, ja: loc }, required: ['id', 'zh', 'en', 'ja'] } } },
      required: ['items'],
    },
  }
}

const contentSchema = z.object({
  tagline: z.string(),
  summary: z.string(),
  features: z.array(z.string()).default([]),
  use_cases: z.array(z.string()).default([]),
  goal: z.string().optional(),
  exit_condition: z.string().optional(),
  steps: z.array(z.object({ title: z.string(), body: z.string().default(''), command_index: z.coerce.number().int().default(-1) })).optional(),
})
const itemSchema = z.object({ id: z.coerce.string(), zh: contentSchema, en: contentSchema, ja: contentSchema })
/** 逐条校验：结构不对的条目丢弃（会作为"缺结果"重新生成），不让一条坏数据拖垮整批 */
const outputSchema = z.object({ items: z.array(z.unknown()) }).transform(({ items }) => ({
  items: items.map((i) => itemSchema.safeParse(i)).flatMap((r) => (r.success ? [r.data] : [])),
}))

const clean = (items: string[]) => items.map((s) => s.trim().replace(/[。.]$/, '')).filter(Boolean)

function toContent(c: z.infer<typeof contentSchema>): DescribeContent {
  return {
    tagline: c.tagline.trim(),
    summary: c.summary.trim(),
    features: clean(c.features),
    useCases: clean(c.use_cases),
    ...(c.goal !== undefined ? { goal: c.goal.trim() } : {}),
    ...(c.exit_condition !== undefined ? { exitCondition: c.exit_condition.trim() } : {}),
    ...(c.steps ? { steps: c.steps.map((s) => ({ title: s.title.trim(), body: s.body.trim(), commandIndex: s.command_index })) } : {}),
  }
}

/** Loop 三种语言约 3,000 token，CLI / Agent 约 1,200 token */
const maxTokensFor = (kind: DescribeKind, n: number) => Math.min(16_000, (kind === 'loop' ? 3_500 : 1_600) * n + 512)

/** 大模型内容写作器：模型服务（Claude / OpenAI 兼容）由配置决定 */
export class LlmDescribeWriter implements DescribeWriter {
  readonly promptVersion = DESCRIBE_PROMPT_VERSION
  readonly provider: string
  readonly model: string
  private readonly llm: Llm

  constructor(options: LlmConfig & { model: string }) {
    this.model = options.model
    this.llm = createLlm(options)
    this.provider = this.llm.provider
  }

  async write(items: DescribeInput[], signal?: AbortSignal): Promise<{ results: DescribeResult[]; usage: LlmUsage }> {
    const kind = items[0]!.kind
    const payload = items.map((item, i) => ({
      id: String(i + 1),
      name: item.name,
      facts: item.facts,
      ...(item.commands.length ? { commands: item.commands.map((command, index) => ({ index, command })) } : {}),
      ...(item.background.en ? { background: item.background.en } : {}),
    }))
    const { output, usage } = await this.llm.tool({
      model: this.model,
      system: describeSystemPrompt(kind),
      tool: tool(kind),
      input: JSON.stringify(payload),
      maxTokens: maxTokensFor(kind, items.length),
      schema: outputSchema,
      signal,
    })
    const results: DescribeResult[] = []
    for (const entry of output.items) {
      const item = items[Number(entry.id) - 1]
      if (!item) continue
      results.push({ key: describeKey(item), content: Object.fromEntries(LOCALES.map((l) => [l, toContent(entry[l])])) as DescribeResult['content'] })
    }
    return { results, usage }
  }
}
