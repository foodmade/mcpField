import { eq, inArray, sql } from 'drizzle-orm'
import type { EntityDraft, IdentityHints } from '../core/draft.ts'
import type { Db } from '../db/client.ts'
import { ingestPublished } from '../db/schema/index.ts'
import { sha256, stableJson } from '../store/hash.ts'
import type { AssetReader } from './store.ts'

/*
 * Skill 图标补全：skills.sh、mcp.so 都不提供 Skill 图标，用 GitHub 仓库所有者的头像（GitHub 仓库页、skills.sh 上显示的就是它）。
 * skill-icons 命令：发布层里没有图标、仓库在 GitHub 上的 Skill → 按所有者去重 → 头像转存到 R2（AssetMirror，记录在 media_assets）
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

/** Skill 没有图标时补上所有者头像，只用已经转存成功的；返回是否改动 */
export function applyOwnerIcon(draft: EntityDraft, mirrored: Pick<ReadonlySet<string>, 'has'>): boolean {
  if (draft.kind !== 'skill' || draft.media.some((m) => m.type === 'icon')) return false
  const url = ownerAvatarUrl(draft.identity)
  if (!url || !mirrored.has(url)) return false
  draft.media = [{ type: 'icon', url }, ...draft.media]
  return true
}

/** 按身份线索查已转存成功的所有者头像（publish 用） */
export async function mirroredOwnerAvatars(reader: AssetReader, identities: IdentityHints[]): Promise<Set<string>> {
  const urls = [...new Set(identities.map(ownerAvatarUrl).filter((u): u is string => !!u))]
  return new Set((await reader.lookup(urls)).keys())
}

/** 发布层里还没有图标的 Skill：发布 id 与所有者头像地址 */
export async function skillsWithoutIcon(db: Db): Promise<{ id: number; url: string }[]> {
  const [rows] = (await db.execute(sql`
    SELECT d.id, JSON_EXTRACT(d.draft, '$.identity') AS identity
    FROM ingest_published d
    WHERE d.kind = 'skill'
      AND JSON_UNQUOTE(JSON_EXTRACT(d.draft, '$.identity.repository.host')) = 'github.com'
      AND JSON_SEARCH(d.draft, 'one', 'icon', NULL, '$.media[*].type') IS NULL`)) as unknown as [{ id: number; identity: IdentityHints | string | null }[]]
  return rows.flatMap((r) => {
    const url = ownerAvatarUrl(typeof r.identity === 'string' ? (JSON.parse(r.identity) as IdentityHints) : (r.identity ?? undefined))
    return url ? [{ id: r.id, url }] : []
  })
}

/** 把转存成功的头像写进发布层草稿（同时更新草稿哈希）；返回写入的条数 */
export async function applySkillIcons(db: Db, reader: AssetReader, skills: { id: number; url: string }[]): Promise<number> {
  const mirrored = new Set((await reader.lookup(skills.map((s) => s.url))).keys())
  const ids = skills.filter((s) => mirrored.has(s.url)).map((s) => s.id)
  let applied = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const rows = await db.select({ id: ingestPublished.id, draft: ingestPublished.draft }).from(ingestPublished).where(inArray(ingestPublished.id, ids.slice(i, i + CHUNK)))
    await db.transaction(async (tx) => {
      for (const row of rows) {
        const draft = (typeof row.draft === 'string' ? JSON.parse(row.draft) : row.draft) as EntityDraft
        if (!applyOwnerIcon(draft, mirrored)) continue
        await tx.update(ingestPublished).set({ draft, draftHash: sha256(stableJson(draft)) }).where(eq(ingestPublished.id, row.id))
        applied++
      }
    })
  }
  return applied
}
