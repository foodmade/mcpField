import { sql, type SQL } from 'drizzle-orm'
import { CLASSIFIER_SOURCE } from '../classify/classifier.ts'
import { POPULAR_METRIC, type EntityDraft } from '../core/draft.ts'
import type { Logger } from '../core/logger.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { adminCoverage, adminItemStatus } from '../db/schema/index.ts'
import { DESCRIBE_KINDS } from '../describe/types.ts'
import { readmeSubject } from '../github/readme.ts'
import { repoRef } from '../github/repo.ts'
import { GithubReadmeStore, README_ENRICHER, REPO_ENRICHER } from '../github/store.ts'
import { MIN_README_CHARS, prepareReadme } from '../overview/prepare.ts'
import { probeKeys } from '../probe/tools-store.ts'
import { readmeHash, textLocale } from '../readme/chunk.ts'
import { sha256 } from '../store/hash.ts'
import { toolTexts } from '../tools/translate.ts'
import { blockHash, normalizeSource, sourceHash } from '../translate/key.ts'
import { beijingDate } from './jobs.ts'
import { dbTime } from './time.ts'

/*
 * 条目状态同步：从各步骤的结果表推导每个发布条目的状态，写进 admin_item_status（一条一行的宽表）。
 * 任务本身不逐条埋点，状态都以结果表为准，所以任务中途失败、手动补跑、换了逻辑，同步一次就对得上。
 * 每一步结束时只算这一步影响的列（STAGES_AFTER），publish 之后全部重算；发布层按 id 分页读，每页 500 条。
 */

export const STAGES = ['classify', 'icon', 'github', 'readme', 'translate', 'tools', 'tools_translate', 'intro', 'readme_translate'] as const
export type Stage = (typeof STAGES)[number]

/** 0 不适用 / 1 待处理 / 2 完成 / 3 警告（待抽查、部分完成）/ 4 失败 */
export const ST = { na: 0, pending: 1, ok: 2, warn: 3, failed: 4 } as const
export type StatusCode = (typeof ST)[keyof typeof ST]

export const STAGE_COLUMN = {
  classify: 'stClassify',
  icon: 'stIcon',
  github: 'stGithub',
  readme: 'stReadme',
  translate: 'stTranslate',
  tools: 'stTools',
  tools_translate: 'stToolsTranslate',
  intro: 'stIntro',
  readme_translate: 'stReadmeTranslate',
} as const satisfies Record<Stage, keyof typeof adminItemStatus.$inferInsert>

/** 每个命令跑完后要刷新的列；classify、probe 的结果要等 publish 写进发布层才生效，不在这里 */
export const STAGES_AFTER: Record<string, Stage[]> = {
  publish: [...STAGES],
  'admin-sync': [],
  assets: ['icon'],
  'owner-icons': ['icon'],
  // README 变了，AI 介绍和 README 翻译是否适用、是否过期跟着变
  github: ['github', 'readme', 'intro', 'readme_translate'],
  translate: ['translate'],
  'translate-tools': ['tools_translate'],
  describe: ['intro'],
  overview: ['intro'],
  readme: ['readme_translate'],
}

const PAGE = 500

interface Key {
  sourceId: string
  kind: EntityKind
  externalId: string
}

interface PublishedRow extends Key {
  id: number
  /** 发布层的身份键列（mcp.so 的草稿里 identityKey 可能是空的，要用这一列） */
  identityKey: string
  recordId: number
  slug: string
  sources: string
  publishedAt: Date
  draft: EntityDraft
}

interface Result {
  status: StatusCode
  note?: string
}

/** 发布层一页条目 + 本页要用的各结果表数据 */
interface PageData {
  rows: PublishedRow[]
  classifications: Map<string, string>
  icons: Map<string, { status: string; publicUrl: string | null; error: string | null; httpStatus: number | null }>
  repos: Map<string, { status: string; error: string | null; stars: number | null }>
  readmes: Map<string, { status: string; error: string | null; contentHash: string | null }>
  readmeInfo: Map<string, ReadmeInfo>
  translations: Map<string, { locales: number; review: number }>
  probes: Map<string, string[]>
  overviews: Map<string, { locales: number; review: number }>
  readmeTranslations: Map<string, { locale: string; readmeHash: string; status: string }[]>
  firstSeen: Map<string, Date>
}

/** README 缓存（存在条目状态表里）：内容哈希没变就沿用 */
interface ReadmeInfo {
  contentHash: string
  readmeHash: string
  lang: string
  chars: number
  format: string
}

const entityKey = (k: Key) => `${k.sourceId}|${k.kind}|${k.externalId}`
const tuples = (keys: Key[]): SQL => sql.join(keys.map((k) => sql`(${k.sourceId}, ${k.kind}, ${k.externalId})`), sql`, `)
const list = (values: string[]): SQL => sql.join(values.map((v) => sql`${v}`), sql`, `)

async function query<T>(db: Db, statement: SQL): Promise<T[]> {
  const [rows] = (await db.execute(statement)) as unknown as [T[]]
  return rows
}

function iconUrl(d: EntityDraft): string | undefined {
  return d.media.find((m) => m.type === 'icon')?.url
}

function textHashes(d: EntityDraft): string[] {
  const out = new Set<string>()
  for (const t of d.texts) {
    if (t.field !== 'tagline' && t.field !== 'description') continue
    const text = normalizeSource(t.content ?? '')
    if (text) out.add(sourceHash(text))
  }
  return [...out]
}

function toolHashes(d: EntityDraft): string[] {
  if (d.kind !== 'server') return []
  return [...new Set(toolTexts(d.detail.tools).map((t) => blockHash(t.text)))]
}

async function loadPage(db: Db, rows: PublishedRow[], stages: Set<Stage>): Promise<PageData> {
  const keys = rows.map((r) => r as Key)
  const data: PageData = {
    rows,
    classifications: new Map(),
    icons: new Map(),
    repos: new Map(),
    readmes: new Map(),
    readmeInfo: new Map(),
    translations: new Map(),
    probes: new Map(),
    overviews: new Map(),
    readmeTranslations: new Map(),
    firstSeen: new Map(),
  }

  // 新条目的收录时间：同一身份键下所有来源里最早被发现的时间（主条目换了来源也不会算成新收录）
  const existing = await query<Key & { readmeContentHash: string | null; readmeHash: string | null; readmeLang: string | null; readmeChars: number | null; readmeFormat: string | null }>(
    db,
    sql`SELECT source_id AS sourceId, kind, external_id AS externalId, readme_content_hash AS readmeContentHash, readme_hash AS readmeHash,
          readme_lang AS readmeLang, readme_chars AS readmeChars, readme_format AS readmeFormat
        FROM admin_item_status WHERE (source_id, kind, external_id) IN (${tuples(keys)})`,
  )
  const known = new Map(existing.map((e) => [entityKey(e), e]))
  const fresh = rows.filter((r) => !known.has(entityKey(r)))
  if (fresh.length) {
    const byIdentity = new Map<string, PublishedRow[]>()
    for (const r of fresh) {
      const k = `${r.kind}|${r.identityKey}`
      byIdentity.set(k, [...(byIdentity.get(k) ?? []), r])
    }
    const withIdentity = fresh.filter((r) => r.identityKey)
    if (withIdentity.length) {
      const found = await query<{ kind: string; identityKey: string; first: Date | string }>(
        db,
        sql`SELECT d.kind, d.identity_key AS identityKey, MIN(t.discovered_at) AS first
            FROM ingest_drafts d JOIN ingest_records r ON r.id = d.record_id JOIN ingest_targets t ON t.id = r.target_id
            WHERE d.identity_key IN (${list([...new Set(withIdentity.map((r) => r.identityKey))])})
            GROUP BY d.kind, d.identity_key`,
      )
      for (const f of found) for (const r of byIdentity.get(`${f.kind}|${f.identityKey}`) ?? []) data.firstSeen.set(entityKey(r), dbTime(f.first))
    }
    // 草稿上没记身份键的（找不到成员）：用主条目自己的发现时间
    const rest = fresh.filter((r) => !data.firstSeen.has(entityKey(r)))
    if (rest.length) {
      const found = await query<{ id: number; first: Date | string }>(
        db,
        sql`SELECT r.id, t.discovered_at AS first FROM ingest_records r JOIN ingest_targets t ON t.id = r.target_id
            WHERE r.id IN (${sql.join(rest.map((r) => sql`${r.recordId}`), sql`, `)})`,
      )
      const byRecord = new Map(found.map((f) => [Number(f.id), dbTime(f.first)]))
      for (const r of rest) {
        const first = byRecord.get(r.recordId)
        if (first) data.firstSeen.set(entityKey(r), first)
      }
    }
  }

  if (stages.has('classify')) {
    const found = await query<Key & { status: string; primarySlug: string }>(
      db,
      sql`SELECT source_id AS sourceId, kind, external_id AS externalId, status, primary_slug AS primarySlug
          FROM ingest_classifications WHERE (source_id, kind, external_id) IN (${tuples(keys)})`,
    )
    for (const f of found) data.classifications.set(entityKey(f), f.primarySlug === 'other' ? 'other' : f.status)
  }

  if (stages.has('icon')) {
    const urls = [...new Set(rows.flatMap((r) => iconUrl(r.draft) ?? []))]
    if (urls.length) {
      const byHash = new Map(urls.map((u) => [sha256(u), u]))
      const found = await query<{ hash: string; status: string; publicUrl: string | null; error: string | null; httpStatus: number | null }>(
        db,
        sql`SELECT source_url_hash AS hash, status, public_url AS publicUrl, error, http_status AS httpStatus FROM media_assets WHERE source_url_hash IN (${list([...byHash.keys()])})`,
      )
      for (const f of found) data.icons.set(byHash.get(f.hash)!, f)
    }
  }

  if (stages.has('github')) {
    const repoKeys = [...new Set(rows.flatMap((r) => repoRef(r.draft)?.key ?? []))]
    if (repoKeys.length) {
      const found = await query<{ key: string; status: string; error: string | null; stars: number | null }>(
        db,
        sql`SELECT subject_key AS \`key\`, status, error, JSON_EXTRACT(data, '$.stars') AS stars
            FROM ingest_enrichments WHERE enricher = ${REPO_ENRICHER} AND subject_key IN (${list(repoKeys)})`,
      )
      for (const f of found) data.repos.set(f.key, { ...f, stars: f.stars === null ? null : Number(f.stars) })
    }
  }

  if (stages.has('readme') || stages.has('intro') || stages.has('readme_translate')) {
    const subjects = [...new Set(rows.flatMap((r) => readmeSubject(r.draft)?.key ?? []))]
    if (subjects.length) {
      const found = await query<{ key: string; status: string; error: string | null; contentHash: string | null }>(
        db,
        sql`SELECT subject_key AS \`key\`, status, error, content_hash AS contentHash
            FROM ingest_enrichments WHERE enricher = ${README_ENRICHER} AND subject_key IN (${list(subjects)})`,
      )
      for (const f of found) data.readmes.set(f.key, f)
    }
    // README 缓存：内容哈希变了（或还没算过）的才读正文
    const stale = new Map<string, string>()
    for (const r of rows) {
      const subject = readmeSubject(r.draft)?.key
      const readme = subject ? data.readmes.get(subject) : undefined
      if (!readme || readme.status !== 'ok' || !readme.contentHash) continue
      const prev = known.get(entityKey(r))
      if (prev?.readmeContentHash === readme.contentHash && prev.readmeHash && prev.readmeLang && prev.readmeChars !== null && prev.readmeFormat) {
        data.readmeInfo.set(entityKey(r), { contentHash: readme.contentHash, readmeHash: prev.readmeHash, lang: prev.readmeLang, chars: prev.readmeChars, format: prev.readmeFormat })
      } else stale.set(entityKey(r), subject!)
    }
    if (stale.size) {
      const contents = await new GithubReadmeStore(db).find([...stale.values()])
      for (const [key, subject] of stale) {
        const readme = contents.get(subject)
        if (!readme) continue
        const content = readme.content.trim()
        data.readmeInfo.set(key, {
          contentHash: data.readmes.get(subject)!.contentHash!,
          readmeHash: readmeHash(content),
          lang: textLocale(content),
          chars: prepareReadme(content).length,
          format: readme.format,
        })
      }
    }
  }

  const hashes = [...new Set(rows.flatMap((r) => [...(stages.has('translate') ? textHashes(r.draft) : []), ...(stages.has('tools_translate') ? toolHashes(r.draft) : [])]))]
  for (let i = 0; i < hashes.length; i += 2000) {
    const found = await query<{ hash: string; locales: number; review: number }>(
      db,
      sql`SELECT source_hash AS hash, COUNT(*) AS locales, SUM(status = 'review') AS review
          FROM ingest_translations WHERE source_hash IN (${list(hashes.slice(i, i + 2000))}) GROUP BY source_hash`,
    )
    for (const f of found) data.translations.set(f.hash, { locales: Number(f.locales), review: Number(f.review) })
  }

  if (stages.has('tools')) {
    const probe = [...new Set(rows.flatMap((r) => probeKeys(r.draft)))]
    if (probe.length) {
      const found = await query<{ key: string; status: string }>(
        db,
        sql`SELECT subject_key AS \`key\`, status FROM ingest_enrichments WHERE enricher = 'probe_tools' AND subject_key IN (${list(probe)})`,
      )
      for (const f of found) data.probes.set(f.key, [...(data.probes.get(f.key) ?? []), f.status])
    }
  }

  if (stages.has('intro')) {
    const found = await query<Key & { locales: number; review: number }>(
      db,
      sql`SELECT source_id AS sourceId, kind, external_id AS externalId, COUNT(*) AS locales, SUM(status = 'review') AS review
          FROM ingest_overviews WHERE (source_id, kind, external_id) IN (${tuples(keys)}) GROUP BY source_id, kind, external_id`,
    )
    for (const f of found) data.overviews.set(entityKey(f), { locales: Number(f.locales), review: Number(f.review) })
  }

  if (stages.has('readme_translate')) {
    const found = await query<Key & { locale: string; readmeHash: string; status: string }>(
      db,
      sql`SELECT source_id AS sourceId, kind, external_id AS externalId, locale, readme_hash AS readmeHash, status
          FROM ingest_readme_translations WHERE (source_id, kind, external_id) IN (${tuples(keys)})`,
    )
    for (const f of found) data.readmeTranslations.set(entityKey(f), [...(data.readmeTranslations.get(entityKey(f)) ?? []), f])
  }
  return data
}

/** 一组译文（简介或工具描述）：三种语言都有才算完成 */
function translatedStatus(hashes: string[], data: PageData): Result {
  if (!hashes.length) return { status: ST.na }
  const done = hashes.filter((h) => (data.translations.get(h)?.locales ?? 0) >= 3)
  if (done.length < hashes.length) return { status: ST.pending, note: `${done.length}/${hashes.length}` }
  const review = hashes.filter((h) => (data.translations.get(h)?.review ?? 0) > 0).length
  return review ? { status: ST.warn, note: `${review} 段待抽查` } : { status: ST.ok }
}

/** 单个条目各步骤的状态；只算 stages 里的 */
export function computeStages(row: PublishedRow, data: PageData, stages: Set<Stage>): Partial<Record<Stage, Result>> {
  const d = row.draft
  const key = entityKey(row)
  const out: Partial<Record<Stage, Result>> = {}
  const readmeKey = readmeSubject(d)?.key
  const readme = readmeKey ? data.readmes.get(readmeKey) : undefined
  const info = data.readmeInfo.get(key)

  if (stages.has('classify')) {
    const primary = d.categories.find((c) => c.primary && c.slug) ?? d.categories.find((c) => c.slug)
    const classified = data.classifications.get(key)
    if (primary) out.classify = primary.sourceValue === CLASSIFIER_SOURCE && classified === 'review' ? { status: ST.warn, note: '分类把握不足，待复核' } : { status: ST.ok }
    else if (classified === 'other') out.classify = { status: ST.ok, note: '其他' }
    else out.classify = { status: ST.pending, note: '待分类，次日 classify 后生效' }
  }

  if (stages.has('icon')) {
    const url = iconUrl(d)
    const asset = url ? data.icons.get(url) : undefined
    if (!url) out.icon = { status: ST.warn, note: '没有图标' }
    else if (!asset || asset.status === 'pending') out.icon = { status: ST.pending }
    else if (asset.status === 'ok') out.icon = { status: ST.ok }
    else if (asset.status === 'gone') out.icon = { status: ST.failed, note: `原图不存在${asset.httpStatus ? `（${asset.httpStatus}）` : ''}` }
    else if (asset.status === 'skipped') out.icon = { status: ST.failed, note: '图片格式不支持' }
    else out.icon = { status: ST.failed, note: asset.error?.slice(0, 120) ?? '转存失败，等待重试' }
  }

  if (stages.has('github')) {
    const repo = repoRef(d)
    const stats = repo ? data.repos.get(repo.key) : undefined
    if (!repo) out.github = { status: ST.na }
    else if (!stats) out.github = { status: ST.pending }
    else if (stats.status === 'ok') out.github = { status: ST.ok }
    else if (stats.status === 'not_found') out.github = { status: ST.warn, note: '仓库不存在或已设为私有' }
    else out.github = { status: ST.failed, note: stats.error?.slice(0, 120) ?? stats.status }
  }

  if (stages.has('readme')) {
    if (!readmeKey) out.readme = { status: ST.na }
    else if (!readme) out.readme = { status: ST.pending }
    else if (readme.status === 'ok') out.readme = { status: ST.ok }
    else if (readme.status === 'not_found') out.readme = { status: ST.warn, note: '仓库里没有 README' }
    else if (readme.status === 'too_large') out.readme = { status: ST.warn, note: 'README 过大，未抓取' }
    else out.readme = { status: ST.failed, note: readme.error?.slice(0, 120) ?? readme.status }
  }

  if (stages.has('translate')) out.translate = translatedStatus(textHashes(d), data)

  if (stages.has('tools')) {
    if (d.kind !== 'server') out.tools = { status: ST.na }
    else if (d.detail.tools.length) out.tools = { status: ST.ok, note: `${d.detail.tools.length} 个工具` }
    else {
      const keys = probeKeys(d)
      const results = keys.flatMap((k) => data.probes.get(k) ?? [])
      if (!keys.length) out.tools = { status: ST.warn, note: '没有安装包或远程地址，无法实测' }
      else if (!results.length) out.tools = { status: ST.pending, note: '待实测' }
      else if (results.includes('ok')) out.tools = { status: ST.warn, note: '已实测，结果与条目不符或待下次发布' }
      else out.tools = { status: ST.failed, note: `实测失败：${[...new Set(results)].join('、')}` }
    }
  }

  if (stages.has('tools_translate')) out.tools_translate = translatedStatus(toolHashes(d), data)

  if (stages.has('intro')) {
    const ov = data.overviews.get(key)
    const describeKind = (DESCRIBE_KINDS as readonly string[]).includes(d.kind)
    if (ov && ov.locales >= 3) out.intro = ov.review ? { status: ST.warn, note: '待抽查' } : { status: ST.ok }
    else if (!describeKind && (!readme || readme.status !== 'ok')) out.intro = { status: ST.na, note: '没有 README' }
    else if (!describeKind && info && info.chars < MIN_README_CHARS) out.intro = { status: ST.na, note: 'README 太短' }
    else out.intro = { status: ST.pending, note: ov ? `${ov.locales}/3` : undefined }
  }

  if (stages.has('readme_translate')) {
    if (!readme || readme.status !== 'ok' || !info) out.readme_translate = { status: ST.na }
    else if (info.format !== 'markdown') out.readme_translate = { status: ST.na, note: '纯文本 README 不翻译' }
    else {
      const expected = (['zh', 'ja'] as const).filter((l) => l !== info.lang)
      const saved = data.readmeTranslations.get(key) ?? []
      const current = expected.filter((l) => saved.some((s) => s.locale === l && s.readmeHash === info.readmeHash))
      const missing = expected.filter((l) => !current.includes(l))
      if (missing.length) {
        const outdated = missing.some((l) => saved.some((s) => s.locale === l))
        out.readme_translate = { status: ST.pending, note: outdated ? '原文已更新，待重译' : `缺 ${missing.join('、')}` }
      } else if (saved.some((s) => current.includes(s.locale as 'zh' | 'ja') && s.status === 'review')) out.readme_translate = { status: ST.warn, note: '待抽查' }
      else out.readme_translate = { status: ST.ok }
    }
  }
  return out
}

function popularity(d: EntityDraft, data: PageData): number | null {
  const repo = repoRef(d)
  const stars = repo ? data.repos.get(repo.key)?.stars : undefined
  const metric = POPULAR_METRIC[d.kind]
  if (metric === 'github_stars' && typeof stars === 'number') return stars
  const value = d.metrics.find((m) => m.metric === metric)?.value
  return typeof value === 'number' ? Math.max(0, Math.round(value)) : null
}

async function savePage(db: Db, data: PageData, stages: Set<Stage>, now: Date): Promise<void> {
  const values = data.rows.map((row) => {
    const d = row.draft
    const key = entityKey(row)
    const results = computeStages(row, data, stages)
    const firstSeen = data.firstSeen.get(key) ?? row.publishedAt
    const url = iconUrl(d)
    const asset = url ? data.icons.get(url) : undefined
    const info = data.readmeInfo.get(key)
    const notes: Record<string, string | null> = {}
    const columns: Record<string, number> = {}
    for (const stage of stages) {
      columns[STAGE_COLUMN[stage]] = results[stage]!.status
      notes[stage] = results[stage]!.note ?? null
    }
    return {
      kind: row.kind,
      sourceId: row.sourceId,
      externalId: row.externalId,
      slug: row.slug,
      name: d.name.slice(0, 255),
      iconUrl: (asset?.status === 'ok' && asset.publicUrl ? asset.publicUrl : url)?.slice(0, 1024) ?? null,
      category: (d.categories.find((c) => c.primary && c.slug) ?? d.categories.find((c) => c.slug))?.slug ?? null,
      sources: row.sources,
      popularity: popularity(d, data),
      firstSeenAt: firstSeen,
      firstSeenDate: beijingDate(firstSeen),
      publishedAt: row.publishedAt,
      active: true,
      ...columns,
      notes: notes as Record<string, string>,
      readmeContentHash: info?.contentHash ?? null,
      readmeHash: info?.readmeHash ?? null,
      readmeLang: info?.lang ?? null,
      readmeChars: info?.chars ?? null,
      readmeFormat: info?.format ?? null,
      seenAt: now,
    }
  })
  const v = (column: string) => sql.raw(`VALUES(\`${column}\`)`)
  const set: Record<string, SQL> = {
    slug: v('slug'),
    name: v('name'),
    category: v('category'),
    sources: v('sources'),
    publishedAt: v('published_at'),
    active: v('active'),
    seenAt: v('seen_at'),
    // 只合并这次算了的步骤的说明（null 表示删掉这一项）
    notes: sql`JSON_MERGE_PATCH(COALESCE(${adminItemStatus.notes}, JSON_OBJECT()), VALUES(\`notes\`))`,
  }
  for (const stage of stages) set[STAGE_COLUMN[stage]] = v(adminItemStatus[STAGE_COLUMN[stage]].name)
  if (stages.has('icon')) set.iconUrl = v('icon_url')
  if (stages.has('github')) set.popularity = v('popularity')
  if (stages.has('readme') || stages.has('intro') || stages.has('readme_translate')) {
    for (const c of ['readmeContentHash', 'readmeHash', 'readmeLang', 'readmeChars', 'readmeFormat'] as const) set[c] = v(adminItemStatus[c].name)
  }
  await db.insert(adminItemStatus).values(values).onDuplicateKeyUpdate({ set })
}

const COLUMNS = STAGES.map((s) => adminItemStatus[STAGE_COLUMN[s]].name)
const countOf = (code: number) => sql.raw(COLUMNS.map((c) => `(\`${c}\` = ${code})`).join(' + '))

/** 重算本次同步过的行的汇总列，下架不在发布层的行，重算覆盖率 */
async function finalize(db: Db, since: Date, now: Date): Promise<void> {
  await db.execute(sql`UPDATE admin_item_status SET fail_count = ${countOf(ST.failed)}, warn_count = ${countOf(ST.warn)},
    pending_count = ${countOf(ST.pending)}, has_fail = fail_count > 0 WHERE seen_at >= ${since}`)
  await db.execute(sql`UPDATE admin_item_status SET active = 0 WHERE active = 1 AND seen_at < ${since}`)

  const sums = sql.raw(COLUMNS.flatMap((c) => [0, 1, 2, 3, 4].map((code) => `SUM(\`${c}\` = ${code}) AS \`${c}_${code}\``)).join(', '))
  const rows = await query<Record<string, string | number>>(db, sql`SELECT kind, ${sums} FROM admin_item_status WHERE active = 1 GROUP BY kind`)
  const values = rows.flatMap((r) =>
    STAGES.map((stage, i) => {
      const n = (code: number) => Number(r[`${COLUMNS[i]}_${code}`] ?? 0)
      return { kind: r.kind as EntityKind, stage, na: n(0), pending: n(1), ok: n(2), warn: n(3), failed: n(4), updatedAt: now }
    }),
  )
  if (values.length) {
    await db
      .insert(adminCoverage)
      .values(values)
      .onDuplicateKeyUpdate({ set: { na: sql`VALUES(na)`, pending: sql`VALUES(pending)`, ok: sql`VALUES(ok)`, warn: sql`VALUES(warn)`, failed: sql`VALUES(failed)`, updatedAt: sql`VALUES(updated_at)` } })
  }
}

export interface ItemSyncStats {
  stages: Stage[]
  items: number
  seconds: number
}

/** 同步条目状态表：遍历整个发布层，只重算 stages 里的列（为空时只更新名称、分类等冗余字段和在架状态） */
export async function syncItemStatus(db: Db, stages: Stage[], logger: Logger): Promise<ItemSyncStats> {
  const started = Date.now()
  const since = new Date()
  const wanted = new Set(stages)
  let lastId = 0
  let items = 0
  for (;;) {
    const rows = await query<Omit<PublishedRow, 'draft'> & { draft: EntityDraft | string }>(
      db,
      sql`SELECT id, kind, identity_key AS identityKey, record_id AS recordId, slug, source_id AS sourceId, external_id AS externalId, sources, published_at AS publishedAt, draft
          FROM ingest_published WHERE id > ${lastId} ORDER BY id LIMIT ${PAGE}`,
    )
    if (!rows.length) break
    const page = rows.map((r) => ({ ...r, publishedAt: dbTime(r.publishedAt), draft: (typeof r.draft === 'string' ? JSON.parse(r.draft) : r.draft) as EntityDraft }))
    await savePage(db, await loadPage(db, page, wanted), wanted, since)
    items += rows.length
    lastId = rows.at(-1)!.id
    if (items % 20_000 < PAGE) logger.info({ progress: `${items}`, stages }, '条目状态同步进度')
  }
  // 发布层是空的（publish 进行中或出错）时不下架，免得把整张表都标成不在架
  if (items > 0) await finalize(db, since, new Date())
  const stats = { stages, items, seconds: Math.round((Date.now() - started) / 1000) }
  logger.info(stats, '条目状态已同步')
  return stats
}
