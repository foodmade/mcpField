import type { L } from '../i18n/locales'
import type { Kind } from './api/entities'

export type Reactions = { up: number; party: number; heart: number; rocket: number }
export type Comment = {
  id: string
  author: string
  color: string
  days: number
  body: L
  reactions: Partial<Reactions>
  /** 项目维护者的回复会显示“维护者”标识 */
  maintainer?: boolean
  replies?: Comment[]
}

/** 评论对象标识：类型 + slug，例如 server:playwright-mcp */
export type CommentTarget = `${Kind}:${string}`

/** 评论还没有后端接口，暂时一律为空；接入后改为请求接口 */
const COMMENTS: Record<string, Comment[]> = {}

export const getComments = (target: CommentTarget): Comment[] => COMMENTS[target] ?? []

export const commentCount = (target: CommentTarget) => getComments(target).reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0)
