import { and, eq, inArray } from 'drizzle-orm'
import type { EntityDraft } from '../core/draft.ts'
import { repoKey } from '../core/identity.ts'
import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { ingestDrafts, ingestPublished, ingestPublishedSlugs } from '../db/schema/index.ts'
import { classifyKey } from '../classify/classifier.ts'
import { applyClassification } from '../classify/runner.ts'
import { ClassificationStore } from '../classify/store.ts'
import { sha256, stableJson } from '../store/hash.ts'
import { displayRank, mergeDrafts, pickPrimary } from './merge-drafts.ts'
import { planMerge, type MergeGroup, type MergeItem, type MergeMember } from './plan.ts'
import { collectMergeItems } from './runner.ts'

/*
 * 发布：草稿 → 过滤凑数条目 → 按身份键分组（merge/plan.ts）→ 每组合并成一份 → 补上分类器的分类 → 整体重建 ingest_published。
 * 在一个事务里先删后写：网站在重建期间读到的仍是旧数据，提交后一次切换。
 */

/**
 * 同一仓库目录登记的服务超过这个数，判定为批量凑数，不发布。
 * 2026-10 官方 Registry：sadri-dridi/named-mcp-utilities 一个仓库登记了 2,332 条（"上海当前时间""英制杯换算毫升"之类）。
 * 按完整的仓库键（含子目录）计数：monorepo 里每个服务各有自己的子目录，不受影响。
 */
export const BULK_REPO_LIMIT = 20

const MAX_SLUG = 191

const toSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** 返回判定为凑数的草稿 id */
export function bulkDraftIds(items: MergeItem[], limit = BULK_REPO_LIMIT): Set<number> {
  const byRepo = new Map<string, number[]>()
  for (const item of items) {
    const repo = item.identity.repository
    if (item.kind !== 'server' || !repo) continue
    const key = `${item.sourceId}|${repoKey(repo)}`
    if (!byRepo.has(key)) byRepo.set(key, [])
    byRepo.get(key)!.push(item.draftId)
  }
  return new Set([...byRepo.values()].filter((ids) => ids.length > limit).flat())
}

export interface PreviousSlug {
  kind: EntityKind
  identityKey: string
  sourceId: string
  externalId: string
  slug: string
}

export interface SlugRequest {
  kind: EntityKind
  key: string
  primary: Pick<MergeMember, 'sourceId' | 'externalId' | 'slug'>
}

/**
 * 分配网站地址，同类型内唯一，并尽量稳定：
 * 1. 上一次发布过的组（按身份键，其次按主条目）沿用原来的地址；
 * 2. 其余的用主条目自己的 slug，mcp.so 的先分配（保住已有地址），重名时加 -2、-3。
 */
export function assignSlugs<T extends SlugRequest>(requests: T[], previous: PreviousSlug[]): Map<T, string> {
  const result = new Map<T, string>()
  const taken = new Set<string>()
  const claim = (req: T, slug: string) => {
    result.set(req, slug)
    taken.add(`${req.kind}:${slug}`)
  }
  const prevByKey = new Map(previous.map((p) => [`${p.kind}:${p.identityKey}`, p.slug]))
  const prevByPrimary = new Map(previous.map((p) => [`${p.kind}:${p.sourceId}:${p.externalId}`, p.slug]))

  for (const req of requests) {
    const slug = prevByKey.get(`${req.kind}:${req.key}`) ?? prevByPrimary.get(`${req.kind}:${req.primary.sourceId}:${req.primary.externalId}`)
    if (slug && !taken.has(`${req.kind}:${slug}`)) claim(req, slug)
  }
  const rest = requests
    .filter((req) => !result.has(req))
    .sort((a, b) => displayRank(a.primary.sourceId) - displayRank(b.primary.sourceId) || a.primary.slug.localeCompare(b.primary.slug) || a.key.localeCompare(b.key))
  for (const req of rest) {
    const base = (req.primary.slug || 'item').slice(0, MAX_SLUG - 4)
    let slug = base
    // Skill 重名很常见（几百个 pdf、frontend-design）：先用"名称-作者"，和 mcp.so 的地址规则一致
    const owner = req.kind === 'skill' && req.primary.externalId.includes('/') ? toSlug(req.primary.externalId.split('/')[0]!) : ''
    if (owner && taken.has(`${req.kind}:${slug}`)) slug = `${base}-${owner}`.slice(0, MAX_SLUG - 4)
    const first = slug
    for (let n = 2; taken.has(`${req.kind}:${slug}`); n++) slug = `${first}-${n}`
    claim(req, slug)
  }
  return result
}

export interface PublishStats {
  drafts: number
  /** 判定为凑数、没有发布的草稿 */
  bulk: number
  /** 发布的条目（合并后） */
  published: number
  /** 含多条草稿的组 */
  merged: number
  /** 按来源组合统计的条目数 */
  bySources: Record<string, number>
  seconds: number
}

interface GroupJob extends SlugRequest {
  group: MergeGroup
  primary: MergeMember
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function publish(db: Db, kinds: readonly EntityKind[], logger: Logger, batchSize = 300): Promise<PublishStats> {
  const started = Date.now()
  const all = await collectMergeItems(db, kinds)
  const bulk = bulkDraftIds(all)
  const plan = planMerge(all.filter((item) => !bulk.has(item.draftId)))
  const jobs: GroupJob[] = plan.groups.map((group) => ({ kind: group.kind, key: group.key, group, primary: pickPrimary(group.members) }))

  const previous = await db
    .select({ kind: ingestPublished.kind, identityKey: ingestPublished.identityKey, sourceId: ingestPublished.sourceId, externalId: ingestPublished.externalId, slug: ingestPublished.slug })
    .from(ingestPublished)
    .where(inArray(ingestPublished.kind, [...kinds]))
  const slugs = assignSlugs(jobs, previous)
  const classifications = await new ClassificationStore(db).all(kinds)
  const canonical = new Set([...slugs].map(([job, slug]) => `${job.kind}:${slug}`))
  logger.info({ drafts: all.length, bulk: bulk.size, groups: jobs.length }, '开始发布')

  const now = new Date()
  const bySources: Record<string, number> = {}
  let done = 0
  await db.transaction(async (tx) => {
    await tx.delete(ingestPublished).where(inArray(ingestPublished.kind, [...kinds]))
    const aliasTaken = new Set<string>()
    for (const kind of kinds) {
      for (const batch of chunk(
        jobs.filter((j) => j.kind === kind),
        batchSize,
      )) {
        const rows = await tx
          .select({ id: ingestDrafts.id, recordId: ingestDrafts.recordId, draft: ingestDrafts.draft, mappedAt: ingestDrafts.mappedAt })
          .from(ingestDrafts)
          .where(inArray(ingestDrafts.id, batch.flatMap((j) => j.group.members.map((m) => m.draftId))))
        const byId = new Map(rows.map((r) => [r.id, r]))

        const values = batch.map((job) => {
          const members = job.group.members.map((m) => byId.get(m.draftId)!.draft as EntityDraft)
          const primary = members[job.group.members.indexOf(job.primary)]!
          const slug = slugs.get(job)!
          const draft = mergeDrafts(members, { primary, slug, identityKey: job.key })
          applyClassification(draft, classifications.get(classifyKey({ ...job.primary, kind })))
          const sources = [...job.group.sources].sort().join(',')
          bySources[sources] = (bySources[sources] ?? 0) + 1
          return {
            kind,
            slug,
            identityKey: job.key,
            recordId: byId.get(job.primary.draftId)!.recordId,
            sourceId: job.primary.sourceId,
            externalId: job.primary.externalId,
            sources,
            memberCount: members.length,
            draftHash: sha256(stableJson(draft)),
            draft,
            mappedAt: new Date(Math.max(...job.group.members.map((m) => byId.get(m.draftId)!.mappedAt.getTime()))),
            publishedAt: now,
          }
        })
        await tx.insert(ingestPublished).values(values)

        const inserted = await tx
          .select({ id: ingestPublished.id, slug: ingestPublished.slug })
          .from(ingestPublished)
          .where(and(eq(ingestPublished.kind, kind), inArray(ingestPublished.slug, values.map((v) => v.slug))))
        const idBySlug = new Map(inserted.map((r) => [r.slug, r.id]))
        // 自己的地址 + 成员原来的地址；成员地址与别的条目的正式地址重名时让给对方
        const aliases = batch.flatMap((job) => {
          const id = idBySlug.get(slugs.get(job)!)!
          return [slugs.get(job)!, ...job.group.members.map((m) => m.slug)]
            .filter((s) => s && s.length <= MAX_SLUG)
            .filter((s) => s === slugs.get(job) || !canonical.has(`${kind}:${s}`))
            .filter((s) => !aliasTaken.has(`${kind}:${s}`) && aliasTaken.add(`${kind}:${s}`))
            .map((slug) => ({ kind, slug, publishedId: id }))
        })
        if (aliases.length > 0) await tx.insert(ingestPublishedSlugs).values(aliases)
        done += batch.length
        if (done % 6000 < batchSize) logger.info({ progress: `${done}/${jobs.length}` }, '发布进度')
      }
    }
  })
  return { drafts: all.length, bulk: bulk.size, published: jobs.length, merged: jobs.filter((j) => j.group.members.length > 1).length, bySources, seconds: Math.round((Date.now() - started) / 1000) }
}
