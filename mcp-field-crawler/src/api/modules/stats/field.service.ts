import type { Locale } from '../../../core/types.ts'
import { listQuerySchema } from '../../http/query.ts'
import type { EntityListItem } from '../entities/entity.dto.ts'
import type { EntityService } from '../entities/entity.service.ts'

/**
 * 首屏背景"手电筒"里流动的名字：最热门的 MCP 服务和 Skill，只保留卡片预览要用的字段。
 * 选中某个名字后，网站再按 slug 读取详情（AI 导读、接入方式）。
 */
export interface FieldItem {
  kind: 'server' | 'skill'
  slug: string
  name: string
  category: string | null
  tagline: string | null
  iconUrl: string | null
  author: string | null
  verified: boolean
  /** 服务是星数，Skill 是安装量 */
  metric: number | null
  /** 只有服务有 */
  toolsCount?: number
  isRemote?: boolean
  /** 只有 Skill 有 */
  installCommand?: string | null
}

/** 每种类型取几页（每页 100 条） */
const PAGES = { server: 3, skill: 2 } as const
const TTL_MS = 30 * 60_000

/**
 * 名字要在等宽字体里排成一行行：只要 3~28 个可打印 ASCII 字符、不超过 3 个单词的，
 * 过滤掉整句描述当名字、非拉丁文字等排不齐的条目。
 */
export function fitsField(name: string): boolean {
  return /^[\x20-\x7E]{3,28}$/.test(name) && name.trim().split(/\s+/).length <= 3
}

function toFieldItem(kind: 'server' | 'skill', i: EntityListItem): FieldItem {
  const base = {
    kind,
    slug: i.slug,
    name: i.name.trim(),
    category: i.category?.slug ?? null,
    // 卡片里最多显示三行，长简介截短，减小响应体积
    tagline: i.tagline && i.tagline.length > 140 ? i.tagline.slice(0, 139) + '…' : i.tagline,
    iconUrl: i.iconUrl,
    author: i.author?.name ?? i.author?.login ?? null,
    verified: i.verified || i.official,
  }
  return kind === 'server'
    ? { ...base, metric: i.stars, toolsCount: Number(i.toolsCount ?? 0), isRemote: Boolean(i.isRemote) }
    : { ...base, metric: (i.installs as number | null) ?? null, installCommand: (i.installCommand as string | null) ?? null }
}

export class FieldService {
  private cache = new Map<Locale, { at: number; value: Promise<FieldItem[]> }>()

  constructor(
    private readonly services: { server: EntityService<'server'>; skill: EntityService<'skill'> },
    private readonly now: () => number = Date.now,
  ) {}

  get(locale: Locale): Promise<FieldItem[]> {
    const t = this.now()
    const hit = this.cache.get(locale)
    if (hit && t - hit.at <= TTL_MS) return hit.value
    const value = this.load(locale)
    this.cache.set(locale, { at: t, value })
    value.catch(() => {
      if (this.cache.get(locale)?.value === value) this.cache.delete(locale)
    })
    return value
  }

  private async load(locale: Locale): Promise<FieldItem[]> {
    const pages = (['server', 'skill'] as const).flatMap((kind) =>
      Array.from({ length: PAGES[kind] }, (_, i) => ({ kind, query: listQuerySchema.parse({ page: i + 1, pageSize: 100, sort: 'popular', locale, withTotal: 'false' }) })),
    )
    // 分页按顺序请求，避免一次压上五个排序查询
    const items: FieldItem[] = []
    for (const { kind, query } of pages) {
      const { data } = await this.services[kind].list(query)
      items.push(...data.map((i) => toFieldItem(kind, i)))
    }
    const seen = new Set<string>()
    return items.filter((i) => {
      const key = i.name.toLowerCase()
      if (!fitsField(i.name) || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
}
