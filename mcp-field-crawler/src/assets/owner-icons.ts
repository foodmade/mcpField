import { eq, inArray, sql } from 'drizzle-orm'
import type { EntityDraft, IdentityHints } from '../core/draft.ts'
import type { Db } from '../db/client.ts'
import { ingestPublished } from '../db/schema/index.ts'
import { sha256, stableJson } from '../store/hash.ts'
import type { AssetReader } from './store.ts'

/*
 * 图标补全：没有图标、或图标原图已失效（转存记录为 gone / skipped）的条目，用 GitHub 仓库所有者的头像
 * （GitHub 仓库页、skills.sh 上显示的就是它；skills.sh、mcp.so 都不提供 Skill 图标，mcp.so 的服务也有大半没有图标）。
 * owner-icons 命令：发布层里缺图标、仓库在 GitHub 上的条目 → 按所有者去重 → 头像转存到 R2（AssetMirror，记录在 media_assets）
 * → 转存成功的写进发布层草稿的图标。publish 重建发布层时按 media_assets 再补上（applyOwnerIcon），不会丢。
 * 草稿里记的是原始地址，接口按 media_assets 换成 R2 地址，与其他图标一致。
 */

const CHUNK = 200

/** 用 github.com/<login>.png：它会跳转到真实头像（与 mcp.so CLI 的做法一致）；owner 已统一为小写，同一所有者只转存一次 */
export function ownerAvatarUrl(identity: IdentityHints | undefined): string | null {
  const repo = identity?.repository
  if (repo?.host !== 'github.com' || !/^[a-z0-9-]+$/i.test(repo.owner)) return null
  return `https://github.com/${repo.owner.toLowerCase()}.png`
}

/** 草稿的图标地址；没有图标时为 undefined */
const iconOf = (draft: EntityDraft) => draft.media.find((m) => m.type === 'icon')?.url

/**
 * 没有图标、或图标原图已失效时补上所有者头像，只用已经转存成功的；返回是否改动。
 * broken：原图已失效的图标地址（AssetStore.brokenUrls）
 */
export function applyOwnerIcon(draft: EntityDraft, mirrored: Pick<ReadonlySet<string>, 'has'>, broken: Pick<ReadonlySet<string>, 'has'> = new Set()): boolean {
  const icon = iconOf(draft)
  if (icon && !broken.has(icon)) return false
  const url = ownerAvatarUrl(draft.identity)
  if (!url || url === icon || !mirrored.has(url)) return false
  draft.media = [{ type: 'icon', url }, ...draft.media.filter((m) => m.type !== 'icon')]
  return true
}

/** 按身份线索查已转存成功的所有者头像（publish 用） */
export async function mirroredOwnerAvatars(reader: AssetReader, identities: IdentityHints[]): Promise<Set<string>> {
  const urls = [...new Set(identities.map(ownerAvatarUrl).filter((u): u is string => !!u))]
  return new Set((await reader.lookup(urls)).keys())
}

/** 发布层里缺图标（没有或原图已失效）、仓库在 GitHub 上的条目：发布 id 与所有者头像地址 */
export async function entriesWithoutIcon(db: Db, broken: ReadonlySet<string>): Promise<{ id: number; url: string }[]> {
  const [rows] = (await db.execute(sql`
    SELECT d.id, JSON_EXTRACT(d.draft, '$.identity') AS identity,
           (SELECT m.url FROM JSON_TABLE(d.draft, '$.media[*]' COLUMNS (type VARCHAR(16) PATH '$.type', url VARCHAR(2048) PATH '$.url')) m WHERE m.type = 'icon' LIMIT 1) AS icon
    FROM ingest_published d
    WHERE JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.identity.repository.host')) = 'github.com'`)) as unknown as [{ id: number; identity: IdentityHints | string | null; icon: string | null }[]]
  return rows.flatMap((r) => {
    if (r.icon && !broken.has(r.icon)) return []
    const url = ownerAvatarUrl(typeof r.identity === 'string' ? (JSON.parse(r.identity) as IdentityHints) : (r.identity ?? undefined))
    return url && url !== r.icon ? [{ id: r.id, url }] : []
  })
}

/** 把转存成功的头像写进发布层草稿（同时更新草稿哈希）；返回写入的条数 */
export async function applyOwnerIcons(db: Db, reader: AssetReader, entries: { id: number; url: string }[], broken: ReadonlySet<string>): Promise<number> {
  const mirrored = new Set((await reader.lookup(entries.map((e) => e.url))).keys())
  const ids = entries.filter((e) => mirrored.has(e.url)).map((e) => e.id)
  let applied = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await db.select({ id: ingestPublished.id, draft: ingestPublished.draft }).from(ingestPublished).where(inArray(ingestPublished.id, ids.slice(i, i + CHUNK)))
    await db.transaction(async (tx) => {
      for (const row of rows) {
        const draft = (typeof row.draft === 'string' ? JSON.parse(row.draft) : row.draft) as EntityDraft
        if (!applyOwnerIcon(draft, mirrored, broken)) continue
        await tx.update(ingestPublished).set({ draft, draftHash: sha256(stableJson(draft)) }).where(eq(ingestPublished.id, row.id))
        applied++
      }
    })
  }
  return applied
}
