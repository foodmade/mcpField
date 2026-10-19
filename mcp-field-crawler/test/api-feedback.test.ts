import { describe, expect, it } from 'vitest'
import { createApp } from '../src/api/app.ts'
import type { AuthUser, AuthVerifier } from '../src/api/auth/supabase-auth.ts'
import type { FeedbackRepository, NewFeedback } from '../src/api/modules/feedback/feedback.repository.ts'
import { FeedbackService, hashIp } from '../src/api/modules/feedback/feedback.service.ts'
import type { Logger } from '../src/core/logger.ts'
import type { EntityKind } from '../src/core/types.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

/** 内存仓储：slug 表里有 cli:glab，旧地址 cli:gitlab-cli 指向它 */
class MemoryRepo implements FeedbackRepository {
  rows: (NewFeedback & { at: number })[] = []
  private slugs: Record<string, string> = { 'cli:glab': 'glab', 'cli:gitlab-cli': 'glab' }
  clock = 0

  async resolveSlug(kind: EntityKind, slug: string) {
    return this.slugs[`${kind}:${slug}`] ?? null
  }
  async insert(row: NewFeedback) {
    this.rows.push({ ...row, at: this.clock })
  }
  async postedSince(by: { userId: string | null; ipHash: string | null }, since: Date) {
    return this.rows.filter((r) => ((by.userId && r.userId === by.userId) || (by.ipHash && r.ipHash === by.ipHash)) && r.at >= since.getTime()).length
  }
}

const USERS: Record<string, AuthUser> = { 'token-lina': { id: 'u-lina', name: 'lina-dev', avatar: null } }
const fakeAuth: AuthVerifier = { verify: async (t) => USERS[t] ?? null }

function setup() {
  const repo = new MemoryRepo()
  const app = createApp({ entities: {}, feedback: new FeedbackService(repo, () => repo.clock), auth: fakeAuth, logger: silent })
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(`/api/feedback${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return { repo, post }
}

describe('反馈接口', () => {
  it('未登录也能提交：存正式 slug、邮箱和 IP 的哈希', async () => {
    const { repo, post } = setup()
    const res = await post('/cli/gitlab-cli', { type: 'wrong_info', body: '  仓库地址不对  ', email: 'a@example.com' }, { 'cf-connecting-ip': '1.2.3.4' })
    expect(res.status).toBe(204)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(repo.rows).toEqual([
      { kind: 'cli', slug: 'glab', type: 'wrong_info', body: '仓库地址不对', email: 'a@example.com', userId: null, userName: null, ipHash: hashIp('1.2.3.4'), at: 0 },
    ])
  })

  it('登录了的记下账号，不保存邮箱', async () => {
    const { repo, post } = setup()
    expect((await post('/cli/glab', { type: 'other', body: 'hi', email: 'a@example.com' }, { authorization: 'Bearer token-lina', 'x-real-ip': '5.6.7.8' })).status).toBe(204)
    expect(repo.rows[0]).toMatchObject({ userId: 'u-lina', userName: 'lina-dev', email: null, ipHash: hashIp('5.6.7.8') })
  })

  it('内容不合法返回 400，条目不存在返回 404', async () => {
    const { post } = setup()
    expect((await post('/cli/glab', { type: 'wrong_info', body: '   ' })).status).toBe(400)
    expect((await post('/cli/glab', { type: 'spam', body: 'hi' })).status).toBe(400)
    expect((await post('/cli/glab', { type: 'other', body: 'x'.repeat(1001) })).status).toBe(400)
    expect((await post('/cli/glab', { type: 'other', body: 'hi', email: 'not-an-email' })).status).toBe(400)
    expect((await post('/cli/glab', { type: 'other', body: 'hi', email: '' })).status).toBe(204)
    expect((await post('/cli/nope', { type: 'other', body: 'hi' })).status).toBe(404)
    expect((await post('/widget/glab', { type: 'other', body: 'hi' })).status).toBe(404)
  })

  it('限流：同一 IP 10 分钟内最多 5 条，过了时间窗口可以再提交', async () => {
    const { repo, post } = setup()
    const ip = { 'cf-connecting-ip': '9.9.9.9' }
    for (let i = 0; i < 5; i++) expect((await post('/cli/glab', { type: 'other', body: `#${i}` }, ip)).status).toBe(204)
    expect((await post('/cli/glab', { type: 'other', body: 'more' }, ip)).status).toBe(429)
    expect((await post('/cli/glab', { type: 'other', body: 'other ip' }, { 'cf-connecting-ip': '8.8.8.8' })).status).toBe(204)
    repo.clock = 10 * 60_000 + 1
    expect((await post('/cli/glab', { type: 'other', body: 'later' }, ip)).status).toBe(204)
  })
})
