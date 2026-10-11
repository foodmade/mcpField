import type { SourceRecord } from '../../core/types.ts'
import type { DescribeInput } from '../../describe/types.ts'
import { sha256, stableJson } from '../../store/hash.ts'

/*
 * 把 mcp.so 的源记录整理成生成内容用的事实。
 * 只传事实（命令、链接、轮数、标签、简短的条件说明）；mcp.so 撰写的长段文字（Loop 简介、启动提示词、步骤说明）不传给模型。
 * CLI / Agent 的一句话说明作为 background 帮助模型理解条目，生成结果会做照抄检测。
 */

type Item = Record<string, unknown>

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((s): s is string => !!s) : [])

function jsonArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v !== 'string' || !v.trim()) return []
  try {
    const parsed = JSON.parse(v) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 去掉空值，保持事实精简 */
function compact(facts: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)))
}

function build(record: SourceRecord, name: string, facts: Record<string, unknown>, commands: string[], background: DescribeInput['background']): DescribeInput {
  const clean = compact(facts)
  return {
    sourceId: record.sourceId,
    kind: record.kind as DescribeInput['kind'],
    externalId: record.externalId,
    name,
    facts: clean,
    commands,
    background,
    inputHash: sha256(stableJson({ kind: record.kind, name, facts: clean, commands, background })),
  }
}

function loopInput(record: SourceRecord, item: Item): DescribeInput {
  const steps = jsonArray(item.steps).filter((s): s is Item => !!s && typeof s === 'object')
  const commands = steps.map((s) => str(s.command)).filter((c): c is string => !!c)
  const agents = jsonArray(item.supportedAgents)
    .filter((a): a is Item => !!a && typeof a === 'object' && (a as Item).active !== false)
    .map((a) => str(a.name))
    .filter(Boolean)
  return build(
    record,
    String(item.name),
    {
      category: str(item.category),
      trigger: str(item.type),
      maxRounds: typeof item.maxIterations === 'number' ? item.maxIterations : undefined,
      checkCommand: str(item.checkCommand),
      goalNote: str(item.goal),
      exitNote: str(item.exitCondition),
      // 每条命令的用途标签（几个词），帮助模型理解命令在做什么
      commandLabels: steps.filter((s) => str(s.command)).map((s) => str(s.title)),
      supportedAgents: agents,
    },
    commands,
    {},
  )
}

function cliInput(record: SourceRecord, item: Item): DescribeInput {
  const description = (item.description ?? {}) as Item
  const capabilities = (item.capabilities ?? {}) as Item
  return build(
    record,
    String(item.name),
    {
      command: str(item.command),
      aliases: strs(item.aliases),
      install: str(item.install),
      examples: strs(item.examples),
      homepage: str(item.homepage),
      repository: str(item.repository) ? `https://github.com/${str(item.repository)}` : undefined,
      category: str(item.category),
      type: str(item.kind),
      official: item.official === true,
      agentReady: item.agentReady === true,
      capabilityLabels: strs(capabilities.en),
    },
    [],
    { en: str(description.en), zh: str(description.zh) },
  )
}

function agentInput(record: SourceRecord, item: Item): DescribeInput {
  return build(
    record,
    String(item.name),
    {
      type: str(item.type),
      author: str(item.authorName),
      website: str(item.websiteUrl),
      repository: str(item.repositoryUrl),
      tags: strs(jsonArray(item.tags)),
      categories: strs(jsonArray(item.categories)),
    },
    [],
    { en: str(item.descriptionEn) ?? str(item.taglineEn), zh: str(item.descriptionZh) ?? str(item.taglineZh) },
  )
}

export function mcpSoDescribeInput(record: SourceRecord): DescribeInput | null {
  const item = (record.data as { item?: Item }).item
  if (!item || typeof item.name !== 'string') return null
  if (record.kind === 'loop') return loopInput(record, item)
  if (record.kind === 'cli') return cliInput(record, item)
  if (record.kind === 'agent') return agentInput(record, item)
  return null
}
