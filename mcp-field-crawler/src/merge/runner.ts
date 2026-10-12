import { and, asc, gt, inArray, sql } from 'drizzle-orm'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IdentityHints } from '../core/draft.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { ingestDrafts } from '../db/schema/index.ts'
import { planMerge, type MergeGroup, type MergeItem, type MergePlan } from './plan.ts'

/** 只取合并需要的字段，不加载整份草稿（含 README，几百 KB） */
export async function collectMergeItems(db: Db, kinds: readonly EntityKind[]): Promise<MergeItem[]> {
  const items: MergeItem[] = []
  let lastId = 0
  for (;;) {
    const rows = await db
      .select({
        id: ingestDrafts.id,
        sourceId: ingestDrafts.sourceId,
        kind: ingestDrafts.kind,
        externalId: ingestDrafts.externalId,
        name: sql<string>`JSON_UNQUOTE(JSON_EXTRACT(${ingestDrafts.draft}, '$.name'))`,
        identity: sql<IdentityHints | null>`JSON_EXTRACT(${ingestDrafts.draft}, '$.identity')`,
      })
      .from(ingestDrafts)
      .where(and(inArray(ingestDrafts.kind, [...kinds]), gt(ingestDrafts.id, lastId)))
      .orderBy(asc(ingestDrafts.id))
      .limit(2000)
    if (rows.length === 0) break
    for (const row of rows) {
      const identity = typeof row.identity === 'string' ? (JSON.parse(row.identity) as IdentityHints) : (row.identity ?? {})
      items.push({ draftId: row.id, sourceId: row.sourceId, kind: row.kind as EntityKind, externalId: row.externalId, name: row.name ?? row.externalId, identity })
    }
    lastId = rows.at(-1)!.id
  }
  return items
}

/**
 * 名称归一化后仍不一致的合并组需要人工看一眼：可能是仓库根目录下的不同服务被合并了。
 * 镜像条目的名称带原作者前缀（"Aiyogg_tinypng Mcp Server"），比较前去掉。
 */
const normalizeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/^[^_]+_/, '')
    .replace(/\b(mcp|server|mcp-server)\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
const namesDiffer = (g: MergeGroup) => new Set(g.members.map((m) => normalizeName(m.name))).size > 1

export interface KindSummary {
  kind: EntityKind
  drafts: number
  /** 合并后的实体数 */
  entities: number
  /** 含多条草稿的组 */
  mergedGroups: number
  /** 被合并掉的草稿 = drafts - entities */
  absorbed: number
  /** 名称不一致的合并组 */
  nameMismatch: number
  /** 没有任何强键、按来源 ID 单独成组的 */
  noStrongKey: number
  ambiguousKeys: number
  suggestions: number
  /** 按来源组合统计的实体数，如 { mcpso: 16000, 'mcp-registry+mcpso': 800 } */
  bySources: Record<string, number>
}

export function summarize(items: MergeItem[], plan: MergePlan): { kinds: KindSummary[]; related: number } {
  const kinds = [...new Set(items.map((i) => i.kind))]
  return {
    kinds: kinds.map((kind) => {
      const groups = plan.groups.filter((g) => g.kind === kind)
      const merged = groups.filter((g) => g.members.length > 1)
      const bySources: Record<string, number> = {}
      for (const g of groups) {
        const label = [...g.sources].sort().join('+')
        bySources[label] = (bySources[label] ?? 0) + 1
      }
      return {
        kind,
        drafts: items.filter((i) => i.kind === kind).length,
        entities: groups.length,
        mergedGroups: merged.length,
        absorbed: merged.reduce((n, g) => n + g.members.length - 1, 0),
        nameMismatch: merged.filter(namesDiffer).length,
        noStrongKey: groups.filter((g) => g.key.startsWith('source:')).length,
        ambiguousKeys: plan.ambiguous.filter((a) => a.kind === kind).length,
        suggestions: plan.suggestions.filter((s) => s.kind === kind).length,
        bySources,
      }
    }),
    related: plan.related.length,
  }
}

/** 预演并写报告：只读数据库，报告里只放需要人工看的部分（合并组、歧义键、弱键重复、跨类型相关） */
export async function runMergePlan(db: Db, kinds: readonly EntityKind[], reportDir: string) {
  const items = await collectMergeItems(db, kinds)
  const plan = planMerge(items)
  const summary = summarize(items, plan)
  const merged = plan.groups
    .filter((g) => g.members.length > 1)
    .map((g) => ({ ...g, nameMismatch: namesDiffer(g) }))
    .sort((a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key))

  await mkdir(reportDir, { recursive: true })
  const file = join(reportDir, `merge-plan-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  const report = { createdAt: new Date().toISOString(), summary, merged, ambiguous: plan.ambiguous, suggestions: plan.suggestions, related: plan.related }
  await writeFile(file, JSON.stringify(report, null, 2))
  return { file, summary, merged, plan }
}
