import type { EntityKind } from '../../../core/types.ts'
import type { AuthUser } from '../../auth/supabase-auth.ts'
import { ApiError } from '../../http/errors.ts'
import type { CommentRepository, CommentRow, CommentSort, Reaction } from './comment.repository.ts'

export const BODY_MAX = 5000
/** 限流：每人 10 分钟内最多发 10 条 */
const RATE_WINDOW = 10 * 60_000
const RATE_MAX = 10

export interface CommentDto {
  id: string
  author: string
  avatar: string | null
  /** Markdown 原文 */
  body: string
  createdAt: string
  reactions: Partial<Record<Reaction, number>>
  /** 当前用户点过的回应；未登录时为空 */
  mine: Reaction[]
  /** 当前用户发的，可以删除 */
  own: boolean
  replies?: CommentDto[]
}

export interface CommentPage {
  data: CommentDto[]
  meta: { page: number; pageSize: number; total: number; totalPages: number; count: number }
}

/** 评论业务：列表组装、发表校验、限流、只能删自己的 */
export class CommentService {
  constructor(
    private readonly repository: CommentRepository,
    private readonly now: () => number = Date.now,
  ) {}

  private async slugOf(kind: EntityKind, slug: string): Promise<string> {
    const canonical = await this.repository.resolveSlug(kind, slug)
    if (!canonical) throw ApiError.notFound(`条目 "${slug}" 不存在`)
    return canonical
  }

  private async toDtos(rows: CommentRow[], viewer: AuthUser | null): Promise<Map<number, CommentDto>> {
    const ids = rows.map((r) => r.id)
    const [counts, mine] = await Promise.all([this.repository.reactionCounts(ids), viewer ? this.repository.reactionsBy(ids, viewer.id) : []])
    const out = new Map<number, CommentDto>()
    for (const r of rows) {
      out.set(r.id, { id: String(r.id), author: r.authorName, avatar: r.authorAvatar, body: r.body, createdAt: r.createdAt.toISOString(), reactions: {}, mine: [], own: viewer?.id === r.userId })
    }
    for (const c of counts) out.get(c.commentId)!.reactions[c.reaction] = Number(c.n)
    for (const m of mine) out.get(m.commentId)?.mine.push(m.reaction)
    return out
  }

  async list(kind: EntityKind, slug: string, query: { sort: CommentSort; page: number; pageSize: number }, viewer: AuthUser | null): Promise<CommentPage> {
    const canonical = await this.slugOf(kind, slug)
    const { rows, total, count } = await this.repository.page(kind, canonical, query.sort, (query.page - 1) * query.pageSize, query.pageSize)
    const replies = await this.repository.replies(rows.map((r) => r.id))
    const dtos = await this.toDtos([...rows, ...replies], viewer)
    const data = rows.map((r) => ({ ...dtos.get(r.id)!, replies: replies.filter((x) => x.parentId === r.id).map((x) => dtos.get(x.id)!) }))
    return { data, meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize), count } }
  }

  async create(kind: EntityKind, slug: string, input: { body: string; parentId?: number }, user: AuthUser): Promise<CommentDto> {
    const body = input.body.trim()
    if (!body) throw ApiError.badRequest('评论内容不能为空')
    if (body.length > BODY_MAX) throw ApiError.badRequest(`评论最多 ${BODY_MAX} 字`)
    const canonical = await this.slugOf(kind, slug)

    let parentId: number | null = null
    if (input.parentId !== undefined) {
      const parent = await this.repository.find(input.parentId)
      if (!parent || parent.kind !== kind || parent.slug !== canonical) throw ApiError.badRequest('回复的评论不存在')
      // 回复只有一层：回复别人的回复时挂到同一条顶层评论下
      parentId = parent.parentId ?? parent.id
    }

    if ((await this.repository.postedSince(user.id, new Date(this.now() - RATE_WINDOW))) >= RATE_MAX) {
      throw new ApiError(429, 'rate_limited', '发表太频繁了，请稍后再试')
    }
    const row = await this.repository.insert({ kind, slug: canonical, parentId, userId: user.id, authorName: user.name, authorAvatar: user.avatar, body })
    return { ...(await this.toDtos([row], user)).get(row.id)!, ...(parentId === null ? { replies: [] } : {}) }
  }

  async remove(id: number, user: AuthUser): Promise<void> {
    const row = await this.repository.find(id)
    if (!row) throw ApiError.notFound('评论不存在')
    if (row.userId !== user.id) throw new ApiError(403, 'forbidden', '只能删除自己的评论')
    await this.repository.remove(id)
  }

  /** 添加或取消回应，返回这条评论最新的回应数和自己的回应 */
  async react(id: number, reaction: Reaction, on: boolean, user: AuthUser): Promise<Pick<CommentDto, 'reactions' | 'mine'>> {
    const row = await this.repository.find(id)
    if (!row) throw ApiError.notFound('评论不存在')
    await this.repository.setReaction(id, user.id, reaction, on)
    const { reactions, mine } = (await this.toDtos([row], user)).get(id)!
    return { reactions, mine }
  }
}
