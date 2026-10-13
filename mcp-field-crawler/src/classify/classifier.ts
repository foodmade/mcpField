import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { EntityDraft, ServerDetailDraft } from '../core/draft.ts'
import type { EntityKind } from '../core/types.ts'
import type { Problem } from '../llm/batch.ts'
import type { LlmUsage } from '../llm/claude.ts'
import { createLlm, type Llm, type LlmConfig } from '../llm/provider.ts'
import { prepareReadme } from '../overview/prepare.ts'
import { sha256, stableJson } from '../store/hash.ts'
import { OTHER, slugsOf, TAXONOMY, TAXONOMY_VERSION } from './taxonomy.ts'

/** 提示词变化时递增：classify 会重新分类所有条目 */
export const CLASSIFY_PROMPT_VERSION = 1

/** 分类所需的输入：只取能说明"它是做什么的"的信息 */
export interface ClassifyInput {
  sourceId: string
  kind: EntityKind
  externalId: string
  name: string
  tagline: string | null
  tags: string[]
  /** MCP 服务的工具名 */
  tools: string[]
  /** 安装包名（npm / PyPI / Docker …） */
  packages: string[]
  repository: string | null
  /** 源站给的分类原值（mcp.so 的 "Other" 等），作为参考 */
  sourceCategory: string | null
  /** 清理后的 README 开头 */
  readme: string
  stars: number | null
  /** 以上输入加分类体系版本的指纹：都不变就不重复分类 */
  inputHash: string
}

export interface ClassifyResult {
  key: string
  primary: string
  secondary: string[]
  confidence: number
}

export const classifyKey = (i: Pick<ClassifyInput, 'sourceId' | 'kind' | 'externalId'>) => `${i.sourceId}:${i.kind}:${i.externalId}`

const README_CHARS = 1_200

/** 发布时写入的分类器结果，sourceValue 用这个值标记，与来源给的分类区分 */
export const CLASSIFIER_SOURCE = 'classifier'

const sourceCategories = (d: EntityDraft) => d.categories.filter((c) => c.sourceValue !== CLASSIFIER_SOURCE)

/** 来源没有给出可用分类（没有分类、或映射为"其他"）的条目需要分类器；发布层里分类器写入的不算 */
export const needsClassification = (d: EntityDraft) => !sourceCategories(d).some((c) => c.slug)

export function inputFromDraft(d: EntityDraft, readme: string, stars: number | null): ClassifyInput {
  const detail = d.kind === 'server' ? (d.detail as ServerDetailDraft) : null
  const repo = d.identity.repository
  const fields = {
    name: d.name,
    tagline: (d.texts.find((t) => t.field === 'tagline' && t.locale === 'en') ?? d.texts.find((t) => t.field === 'description'))?.content.slice(0, 400) ?? null,
    tags: d.tags.slice(0, 12),
    tools: detail?.tools.slice(0, 20).map((t) => t.name) ?? [],
    packages: detail?.packages.map((p) => p.identifier).slice(0, 4) ?? [],
    repository: repo ? `${repo.owner}/${repo.name}${repo.path ? '/' + repo.path : ''}` : null,
    sourceCategory: sourceCategories(d)[0]?.sourceValue ?? null,
    readme: readme ? prepareReadme(readme, README_CHARS) : '',
  }
  return {
    sourceId: d.sourceId,
    kind: d.kind,
    externalId: d.externalId,
    ...fields,
    stars,
    inputHash: sha256(stableJson({ kind: d.kind, ...fields, taxonomy: TAXONOMY_VERSION })),
  }
}

const KIND_LABEL: Record<EntityKind, string> = {
  server: 'MCP servers',
  client: 'MCP clients (apps and SDKs that connect to MCP servers)',
  cli: 'command-line tools',
  skill: 'agent skills (instructions and scripts that teach AI agents a task)',
  loop: 'agent loops (repeatable agent workflows)',
  agent: 'AI agent products',
}

export function systemPrompt(kind: EntityKind): string {
  const list = TAXONOMY[kind].map((c) => `- ${c.slug}: ${c.definition}`).join('\n')
  return `You categorize ${KIND_LABEL[kind]} for a directory website, so that people browsing a category find what they expect there.

Categories:
${list}
- ${OTHER}: none of the above fits.

For each item:
- primary: the one category that best describes what the item is mainly FOR — its domain and the value to users — not how it is built. A Slack integration is communication even though it is written in TypeScript; a stock data API is finance even though it is an API.
- secondary: up to 2 more categories that clearly also apply; usually empty.
- confidence: 0–100, how likely the primary is right given the information. Use a low value when there is little information (for example only a vague name).
- Use "${OTHER}" only when no category fits; do not force a weak match.
Return exactly one entry per input id via the tool.`
}

function toolFor(kind: EntityKind): Anthropic.Tool {
  const slugs = [...slugsOf(kind), OTHER]
  return {
    name: 'submit_categories',
    description: 'Submit the categories, exactly one entry per input id.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              primary: { type: 'string', enum: slugs },
              secondary: { type: 'array', items: { type: 'string', enum: slugs } },
              confidence: { type: 'integer', minimum: 0, maximum: 100 },
            },
            required: ['id', 'primary', 'secondary', 'confidence'],
          },
        },
      },
      required: ['items'],
    },
  }
}

const outputSchema = z.object({
  items: z.array(
    z.object({ id: z.coerce.string(), primary: z.string(), secondary: z.array(z.string()).default([]), confidence: z.coerce.number().default(0) }),
  ),
})

/** 分类结果的校验：主分类不在分类体系里是硬性问题（重做）；把握不足标记为待复核 */
export function validateClassification(input: ClassifyInput, result: ClassifyResult): Problem[] {
  const allowed = new Set([...slugsOf(input.kind), OTHER])
  const problems: Problem[] = []
  if (!allowed.has(result.primary)) problems.push({ code: 'unknown_category', hard: true, detail: result.primary })
  if (result.confidence < 50) problems.push({ code: 'low_confidence', hard: false, detail: String(result.confidence) })
  return problems
}

/** 大模型分类器：模型服务（Claude / OpenAI 兼容）由配置决定 */
export class LlmClassifier {
  readonly model: string
  private readonly llm: Llm

  constructor(options: LlmConfig & { model: string }) {
    this.model = options.model
    this.llm = createLlm(options)
  }

  /** 一批必须是同一类型（分类体系不同） */
  async classify(items: ClassifyInput[], signal?: AbortSignal): Promise<{ results: ClassifyResult[]; usage: LlmUsage }> {
    const kind = items[0]!.kind
    const payload = items.map((item, i) => ({
      id: String(i + 1),
      name: item.name,
      tagline: item.tagline,
      tags: item.tags,
      tools: item.tools,
      packages: item.packages,
      repository: item.repository,
      source_category: item.sourceCategory,
      readme_excerpt: item.readme,
    }))
    const { output, usage } = await this.llm.tool({
      model: this.model,
      system: systemPrompt(kind),
      tool: toolFor(kind),
      input: JSON.stringify(payload),
      maxTokens: 80 * items.length + 512,
      schema: outputSchema,
      signal,
    })
    const allowed = new Set(slugsOf(kind))
    const results: ClassifyResult[] = []
    for (const entry of output.items) {
      const item = items[Number(entry.id) - 1]
      if (!item) continue
      results.push({
        key: classifyKey(item),
        primary: entry.primary,
        // 次分类只保留分类体系里的、与主分类不同的，最多 2 个
        secondary: [...new Set(entry.secondary)].filter((s) => allowed.has(s) && s !== entry.primary).slice(0, 2),
        confidence: Math.max(0, Math.min(100, Math.round(entry.confidence))),
      })
    }
    return { results, usage }
  }
}
