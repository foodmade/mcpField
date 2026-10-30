import { and, eq, inArray } from 'drizzle-orm'
import { applyOwnerIcon, mirroredOwnerAvatars } from '../assets/owner-icons.ts'
import { AssetStore } from '../assets/store.ts'
import type { EntityDraft } from '../core/draft.ts'
import { repoKey } from '../core/identity.ts'
import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { ingestDrafts, ingestPublished, ingestPublishedSlugs, ingestRecords, ingestTargets } from '../db/schema/index.ts'
import { classifyKey } from '../classify/classifier.ts'
import { applyClassification } from '../classify/runner.ts'
import { ClassificationStore } from '../classify/store.ts'
import { readmeSubject } from '../github/readme.ts'
import { applyRepoDescription, lacksTagline, repoRef } from '../github/repo.ts'
import { GithubReadmeStore, GithubRepoStore } from '../github/store.ts'
import { applyProbedTools, ProbedToolsStore, probeKeys } from '../probe/tools-store.ts'
import { applyListedInstalls, SKILLS_SH_SOURCE, SkillsShActivityStore } from '../sources/skills-sh/activity.ts'
import { sha256, stableJson } from '../store/hash.ts'
import { displayRank, mergeDrafts, pickPrimary } from './merge-drafts.ts'
import { planMerge, type MergeGroup, type MergeItem, type MergeMember } from './plan.ts'
import { collectMergeItems } from './runner.ts'

/*
 * 发布：草稿 → 过滤凑数条目 → 按身份键分组（merge/plan.ts）→ 每组合并成一份 → 补上分类器的分类、缺图标条目的所有者头像、缺简介条目的 GitHub 仓库简介、
 * 缺工具列表的本地服务的实测结果（probe/tools-store.ts）、Skill 在 skills.sh 排行榜上的最新安装量
 * → 整体重建 ingest_published。
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
/**
 * 地址的唯一性按数据库的比较规则判断（utf8mb4_unicode_ci 不区分大小写和重音）：
 * mcp.so 的 basicMcpServer 和 BasicMcpServer 在库里是同一个地址（2026-10-14 因此写入 ingest_published_slugs 主键冲突、发布失败）
 */
const slugKey = (kind: EntityKind, slug: string) => `${kind}:${slug.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()}`

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

/**
 * 源站的上架日期不晚于我们第一次发现这个条目的时间：官方 Registry 的 publishedAt 是最新版本的发布时间，作者发新版本后就变成当天，
 * 早就收录的条目会被首页算成"新上架"（2026-10-29 pipeworx-io 等批量发版，当天 3400 个里 2866 个是老条目）
 */
export function capSourceCreatedAt(draft: EntityDraft, discoveredAt: Date | null): void {
  if (!draft.sourceCreatedAt || !discoveredAt) return
  if (Date.parse(draft.sourceCreatedAt) > discoveredAt.getTime()) draft.sourceCreatedAt = discoveredAt.toISOString()
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
    taken.add(slugKey(req.kind, slug))
  }
  const prevByKey = new Map(previous.map((p) => [`${p.kind}:${p.identityKey}`, p.slug]))
  const prevByPrimary = new Map(previous.map((p) => [`${p.kind}:${p.sourceId}:${p.externalId}`, p.slug]))

  for (const req of requests) {
    const slug = prevByKey.get(`${req.kind}:${req.key}`) ?? prevByPrimary.get(`${req.kind}:${req.primary.sourceId}:${req.primary.externalId}`)
    if (slug && !taken.has(slugKey(req.kind, slug))) claim(req, slug)
  }
  const rest = requests
    .filter((req) => !result.has(req))
    .sort((a, b) => displayRank(a.primary.sourceId) - displayRank(b.primary.sourceId) || a.primary.slug.localeCompare(b.primary.slug) || a.key.localeCompare(b.key))
  for (const req of rest) {
    const base = (req.primary.slug || 'item').slice(0, MAX_SLUG - 4)
    let slug = base
    // Skill 重名很常见（几百个 pdf、frontend-design）：先用"名称-作者"，和 mcp.so 的地址规则一致
    const owner = req.kind === 'skill' && req.primary.externalId.includes('/') ? toSlug(req.primary.externalId.split('/')[0]!) : ''
    if (owner && taken.has(slugKey(req.kind, slug))) slug = `${base}-${owner}`.slice(0, MAX_SLUG - 4)
    const first = slug
    for (let n = 2; taken.has(slugKey(req.kind, slug)); n++) slug = `${first}-${n}`
    claim(req, slug)
  }
  return result
}

/**
 * 页面内容的哈希，决定 sitemap 的 lastmod（content_changed_at）。
 * 去掉不算内容变化的字段：源站更新时间（mcp.so 会批量刷新，2026-10-10 一天刷了 9 千多条一年没提交过的服务）、最近提交时间、
 * 星数等指标、质量问题、审计时间和 CLI 的验证日期；README 从 GitHub 抓取、不在草稿里，加上它的正文哈希。
 */
export function contentHash(draft: EntityDraft, readmeHash?: string): string {
  const { sourceUpdatedAt: _updated, lastCommitAt: _commit, metrics: _metrics, issues: _issues, ...content } = draft
  const detail: Record<string, unknown> = { ...draft.detail }
  if ('audits' in draft.detail) detail.audits = draft.detail.audits.map(({ auditedAt: _audited, ...audit }) => audit)
  delete detail.lastVerifiedOn
  return sha256(stableJson({ ...content, detail, readme: readmeHash ?? null }))
}

export interface PreviousContent {
  contentHash: string | null
  contentChangedAt: Date | null
}

/** 内容没变（或上一次还没记哈希）时沿用上一次的时间，变了或是新条目记为本次发布时间 */
export function contentChangedAt(previous: PreviousContent | undefined, hash: string, now: Date): Date | null {
  if (!previous) return now
  return previous.contentHash === null || previous.contentHash === hash ? previous.contentChangedAt : now
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
    .select({
      kind: ingestPublished.kind,
      identityKey: ingestPublished.identityKey,
      sourceId: ingestPublished.sourceId,
      externalId: ingestPublished.externalId,
      slug: ingestPublished.slug,
      contentHash: ingestPublished.contentHash,
      contentChangedAt: ingestPublished.contentChangedAt,
    })
    .from(ingestPublished)
    .where(inArray(ingestPublished.kind, [...kinds]))
  const slugs = assignSlugs(jobs, previous)
  // 上一次发布的内容哈希：和地址一样按身份键，其次按主条目对应
  const prevByKey = new Map(previous.map((p) => [`${p.kind}:${p.identityKey}`, p]))
  const prevByPrimary = new Map(previous.map((p) => [`${p.kind}:${p.sourceId}:${p.externalId}`, p]))
  const previousOf = (job: GroupJob) => prevByKey.get(`${job.kind}:${job.key}`) ?? prevByPrimary.get(`${job.kind}:${job.primary.sourceId}:${job.primary.externalId}`)
  const classifications = await new ClassificationStore(db).all(kinds)
  // owner-icons 转存过的所有者头像（见 assets/owner-icons.ts）
  const assets = new AssetStore(db)
  const avatars = await mirroredOwnerAvatars(assets, all.map((item) => item.identity))
  const brokenIcons = await assets.brokenUrls()
  const readmes = new GithubReadmeStore(db)
  const repos = new GithubRepoStore(db)
  const probes = new ProbedToolsStore(db)
  const skillInstalls = new SkillsShActivityStore(db)
  const canonical = new Set([...slugs].map(([job, slug]) => slugKey(job.kind, slug)))
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
          .select({ id: ingestDrafts.id, recordId: ingestDrafts.recordId, draft: ingestDrafts.draft, mappedAt: ingestDrafts.mappedAt, discoveredAt: ingestTargets.discoveredAt })
          .from(ingestDrafts)
          .leftJoin(ingestRecords, eq(ingestRecords.id, ingestDrafts.recordId))
          .leftJoin(ingestTargets, eq(ingestTargets.id, ingestRecords.targetId))
          .where(inArray(ingestDrafts.id, batch.flatMap((j) => j.group.members.map((m) => m.draftId))))
        const byId = new Map(rows.map((r) => [r.id, r]))
        // 名称可疑的组要看 GitHub README 里有没有提到这个名称（见 hasBrokenName），只为这些组读 README
        const readmeKeys = new Map<GroupJob, string>()
        for (const job of batch) {
          const primary = byId.get(job.primary.draftId)!.draft as EntityDraft
          const subject = primary.issues.some((i) => i.code === 'suspicious_name') ? readmeSubject(primary) : null
          if (subject) readmeKeys.set(job, subject.key)
        }
        const readmeByKey = await readmes.find([...readmeKeys.values()])

        const drafts = batch.map((job) => {
          const members = job.group.members.map((m) => {
            const row = byId.get(m.draftId)!
            const draft = row.draft as EntityDraft
            capSourceCreatedAt(draft, row.discoveredAt)
            return draft
          })
          const primary = members[job.group.members.indexOf(job.primary)]!
          const readmeKey = readmeKeys.get(job)
          const readme = readmeKey ? readmeByKey.get(readmeKey)?.content : undefined
          const draft = mergeDrafts(members, { primary, slug: slugs.get(job)!, identityKey: job.key, readme })
          applyClassification(draft, classifications.get(classifyKey({ ...job.primary, kind })))
          applyOwnerIcon(draft, avatars, brokenIcons)
          return draft
        })
        // 合并后仍没有简介的，用 GitHub 仓库简介（github 命令每天更新）
        const repoKeys = drafts.map((d) => (lacksTagline(d) ? repoRef(d)?.key : undefined))
        const repoStats = await repos.find(repoKeys.filter((k): k is string => !!k))
        drafts.forEach((d, i) => applyRepoDescription(d, repoStats.get(repoKeys[i] ?? '')))
        // 来源没给工具列表的本地服务，用安装包的实测结果（probe-local 实测、probe-import 导入）
        const probed = await probes.find(drafts.flatMap(probeKeys))
        drafts.forEach((d) => applyProbedTools(d, probed))
        // Skill 的安装量用 skills.sh 排行榜每天的数字（crawl --source skills-sh 记下），已收录的不是每天都重新抓详情
        if (kind === 'skill') {
          const listedIds = batch.map((job) => job.group.members.filter((m) => m.sourceId === SKILLS_SH_SOURCE).map((m) => m.externalId))
          const listed = await skillInstalls.find(listedIds.flat())
          drafts.forEach((d, i) => applyListedInstalls(d, listedIds[i]!, listed))
        }
        const readmeSubjects = drafts.map((d) => readmeSubject(d)?.key)
        const readmeHashes = await readmes.hashes(readmeSubjects.filter((k): k is string => !!k))

        const values = batch.map((job, i) => {
          const draft = drafts[i]!
          const slug = slugs.get(job)!
          const hash = contentHash(draft, readmeHashes.get(readmeSubjects[i] ?? ''))
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
            memberCount: job.group.members.length,
            draftHash: sha256(stableJson(draft)),
            draft,
            contentHash: hash,
            contentChangedAt: contentChangedAt(previousOf(job), hash, now),
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
            .filter((s) => s === slugs.get(job) || !canonical.has(slugKey(kind, s)))
            .filter((s) => !aliasTaken.has(slugKey(kind, s)) && aliasTaken.add(slugKey(kind, s)))
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
