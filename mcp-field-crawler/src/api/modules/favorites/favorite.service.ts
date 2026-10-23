import type { EntityKind, Locale } from '../../../core/types.ts'
import type { AuthUser } from '../../auth/supabase-auth.ts'
import { ApiError } from '../../http/errors.ts'
import type { EntityListItem } from '../entities/entity.dto.ts'
import type { FavoriteRepository } from './favorite.repository.ts'

/** 能收藏的类型：第一版只有 MCP 服务（含远程服务）和 Skill */
export const FAVORITE_KINDS = ['server', 'skill'] as const satisfies readonly EntityKind[]
export type FavoriteKind = (typeof FAVORITE_KINDS)[number]
export const isFavoriteKind = (v: string): v is FavoriteKind => (FAVORITE_KINDS as readonly string[]).includes(v)

/** 每人最多收藏的条目数 */
export const FAVORITES_MAX = 1000
/** 一次并入的浏览器本地收藏数上限 */
export const IMPORT_MAX = 200

/** 按 slug 取列表项（保持传入顺序，不存在的跳过）；由 server.ts 接到各类型的 EntityService */
export type FavoriteItems = (kind: FavoriteKind, slugs: string[], locale: Locale) => Promise<EntityListItem[]>

export interface FavoriteDto {
  kind: FavoriteKind
  /** 条目现在的地址；已下架的是收藏时的地址 */
  slug: string
  name: string
  favoritedAt: string
  /** 列表项（与目录接口的结构相同）；条目已下架时为 null */
  item: EntityListItem | null
}

/** 收藏标识：类型 + slug，例如 server:playwright-mcp */
const keyOf = (kind: string, slug: string) => `${kind}:${slug}`

function parseKey(key: string): { kind: FavoriteKind; slug: string } | null {
  const i = key.indexOf(':')
  const kind = key.slice(0, i)
  const slug = key.slice(i + 1)
  return i > 0 && isFavoriteKind(kind) && slug && slug.length <= 191 ? { kind, slug } : null
}

/** 收藏业务：只能看、改自己的；条目被合并后按代表条目算，同一条目只出现一次 */
export class FavoriteService {
  constructor(
    private readonly repository: FavoriteRepository,
    private readonly items: FavoriteItems,
    private readonly now: () => number = Date.now,
  ) {}

  /** 去重后的收藏（被合并的两条算一条，保留较近收藏的那条） */
  private async rows(user: AuthUser) {
    const seen = new Set<string>()
    return (await this.repository.list(user.id, FAVORITES_MAX)).filter((r) => {
      const key = keyOf(r.kind, r.canonical ?? r.slug)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  async list(user: AuthUser, locale: Locale): Promise<FavoriteDto[]> {
    const rows = (await this.rows(user)).filter((r) => isFavoriteKind(r.kind))
    const items = new Map<string, EntityListItem>()
    await Promise.all(
      FAVORITE_KINDS.map(async (kind) => {
        const slugs = rows.filter((r) => r.kind === kind && r.canonical).map((r) => r.canonical!)
        if (slugs.length === 0) return
        for (const item of await this.items(kind, slugs, locale)) items.set(keyOf(kind, item.slug), item)
      }),
    )
    return rows.map((r) => {
      const item = r.canonical ? (items.get(keyOf(r.kind, r.canonical)) ?? null) : null
      return { kind: r.kind as FavoriteKind, slug: r.canonical ?? r.slug, name: item?.name ?? r.name, favoritedAt: r.favoritedAt.toISOString(), item }
    })
  }

  /** 收藏了的条目标识（正式地址），详情页判断是否已收藏用 */
  async keys(user: AuthUser): Promise<string[]> {
    return (await this.rows(user)).map((r) => keyOf(r.kind, r.canonical ?? r.slug))
  }

  /**
   * 收藏；已收藏的不变。favoritedAt 用于撤销取消收藏时恢复原来的收藏时间，不能晚于现在。
   * 返回条目的正式地址（用旧地址收藏时与传入的不同）。
   */
  async add(user: AuthUser, kind: string, slug: string, favoritedAt?: string): Promise<{ key: string; favoritedAt: string }> {
    if (!isFavoriteKind(kind)) throw new ApiError(400, 'unsupported_kind', '这种类型暂不支持收藏')
    const entity = (await this.repository.resolve(kind, [slug])).get(slug)
    if (!entity) throw ApiError.notFound(`条目 "${slug}" 不存在`)
    if ((await this.repository.count(user.id)) >= FAVORITES_MAX) throw new ApiError(400, 'limit_reached', `最多收藏 ${FAVORITES_MAX} 个条目`)
    const at = favoritedAt ? new Date(favoritedAt) : null
    const when = at && !Number.isNaN(at.getTime()) && at.getTime() <= this.now() ? at : new Date(this.now())
    await this.repository.add(user.id, kind, entity, when)
    return { key: keyOf(kind, entity.slug), favoritedAt: when.toISOString() }
  }

  async remove(user: AuthUser, kind: string, slug: string): Promise<void> {
    if (!isFavoriteKind(kind)) throw new ApiError(400, 'unsupported_kind', '这种类型暂不支持收藏')
    await this.repository.remove(user.id, kind, slug)
  }

  /**
   * 并入浏览器本地的收藏（上线前收藏只存在浏览器里）：不支持的类型、已下架的条目跳过，超出上限的部分丢弃。
   * keys 按收藏先后排列，并入后的收藏时间也保持这个顺序。返回并入后的全部收藏标识。
   */
  async import(user: AuthUser, keys: string[]): Promise<string[]> {
    const parsed = keys.slice(0, IMPORT_MAX).flatMap((k) => parseKey(k) ?? [])
    const found = new Map<FavoriteKind, Map<string, { slug: string; name: string }>>()
    for (const kind of FAVORITE_KINDS) {
      found.set(kind, await this.repository.resolve(kind, parsed.filter((p) => p.kind === kind).map((p) => p.slug)))
    }
    const have = new Set(await this.keys(user))
    let room = FAVORITES_MAX - (await this.repository.count(user.id))
    const base = this.now() - parsed.length
    for (const [i, p] of parsed.entries()) {
      const entity = found.get(p.kind)!.get(p.slug)
      if (!entity || have.has(keyOf(p.kind, entity.slug)) || room <= 0) continue
      await this.repository.add(user.id, p.kind, entity, new Date(base + i))
      have.add(keyOf(p.kind, entity.slug))
      room--
    }
    return this.keys(user)
  }
}
