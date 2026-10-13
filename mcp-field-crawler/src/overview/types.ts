import type { EntityKind, Locale } from '../core/types.ts'
import type { LlmUsage } from '../llm/claude.ts'

/** 生成一条介绍所需的输入 */
export interface OverviewInput {
  sourceId: string
  kind: EntityKind
  externalId: string
  name: string
  tagline: string | null
  category: string | null
  tags: string[]
  website: string | null
  /** 清理并截断后的 README，见 prepare.ts */
  readme: string
  stars: number | null
  /** 以上输入的指纹：不变就不重复生成 */
  inputHash: string
}

/** 一种语言的介绍 */
export interface OverviewContent {
  summary: string
  features: string[]
  useCases: string[]
  /** 与 MCP 的关系；README 没提到时为空字符串 */
  mcp: string
}

export interface OverviewResult {
  key: string
  content: Record<Locale, OverviewContent>
}

export const overviewKey = (i: Pick<OverviewInput, 'sourceId' | 'kind' | 'externalId'>) => `${i.sourceId}:${i.kind}:${i.externalId}`

/** 介绍生成器（策略模式）：默认 LlmOverviewWriter（Claude 或 OpenAI 兼容接口），可按项目热度选择不同模型 */
export interface OverviewWriter {
  readonly provider: string
  readonly model: string
  readonly promptVersion: number
  write(items: OverviewInput[], signal?: AbortSignal): Promise<{ results: OverviewResult[]; usage: LlmUsage }>
}
