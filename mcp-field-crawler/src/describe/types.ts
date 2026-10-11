import type { EntityKind, Locale } from '../core/types.ts'
import type { LlmUsage } from '../llm/claude.ts'

export type DescribeKind = Extract<EntityKind, 'loop' | 'cli' | 'agent'>
export const DESCRIBE_KINDS: readonly DescribeKind[] = ['loop', 'cli', 'agent']

/**
 * 生成内容所需的输入。facts 是事实（命令、链接、轮数、标签……），模型据此撰写；
 * background 是源站的简短说明，只用来帮助模型理解条目是什么，不能沿用其措辞（会做照抄检测）。
 */
export interface DescribeInput {
  sourceId: string
  kind: DescribeKind
  externalId: string
  name: string
  facts: Record<string, unknown>
  /** Loop 步骤里的可执行命令（事实），生成的步骤通过下标引用 */
  commands: string[]
  background: { en?: string; zh?: string }
  inputHash: string
}

export interface StepContent {
  title: string
  body: string
  /** commands 里的下标；没有对应命令时为 -1 */
  commandIndex: number
}

export interface DescribeContent {
  tagline: string
  summary: string
  features: string[]
  useCases: string[]
  /** 只有 Loop 有 */
  goal?: string
  exitCondition?: string
  steps?: StepContent[]
}

export interface DescribeResult {
  key: string
  content: Record<Locale, DescribeContent>
}

export const describeKey = (i: Pick<DescribeInput, 'sourceId' | 'kind' | 'externalId'>) => `${i.sourceId}:${i.kind}:${i.externalId}`

export interface DescribeWriter {
  readonly provider: string
  readonly model: string
  readonly promptVersion: number
  write(items: DescribeInput[], signal?: AbortSignal): Promise<{ results: DescribeResult[]; usage: LlmUsage }>
}
