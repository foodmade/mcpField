import { describe, expect, it } from 'vitest'
import type { Logger } from '../src/core/logger.ts'
import { GithubClient, type GithubResponse } from '../src/github/client.ts'
import { frontmatterName, GithubReadmeFetcher, readmeSubject, stripFrontmatter, type GithubReadme, type ReadmeSubject } from '../src/github/readme.ts'
import { GithubRepoFetcher, repoRef, type RepoRef, type RepoStats } from '../src/github/repo.ts'
import { GithubReadmeRunner, GithubRepoRunner, type CollectedSubject } from '../src/github/runner.ts'
import type { ReadmeFetchState } from '../src/github/store.ts'
import { resolveReadme } from '../src/readme/source.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

const repo = (owner: string, name: string, path = '') => ({ host: 'github.com', owner, name, path })

const file = (path: string, content: string, over: Record<string, unknown> = {}) => ({
  type: 'file',
  name: path.split('/').at(-1)!,
  path,
  sha: 'sha-' + path,
  size: content.length,
  html_url: `https://github.com/Acme/Tools/blob/main/${path}`,
  content: Buffer.from(content).toString('base64'),
  encoding: 'base64',
  ...over,
})

/** 按路径返回预设响应的假客户端，记录请求 */
function fakeClient(routes: Record<string, GithubResponse<unknown>>) {
  const calls: { path: string; etag?: string }[] = []
  return {
    calls,
    async get<T>(path: string, options: { etag?: string } = {}): Promise<GithubResponse<T>> {
      calls.push({ path, etag: options.etag })
      return (routes[path] ?? { status: 404, etag: null, data: null }) as GithubResponse<T>
    },
  }
}

const ok = (data: unknown, etag = '"e1"'): GithubResponse<unknown> => ({ status: 200, etag, data })

describe('readmeSubject', () => {
  it('monorepo 子目录小写进键但保留原大小写用于请求；指向文件的地址取所在目录', () => {
    const s = readmeSubject({ kind: 'server', identity: { repository: repo('acme', 'tools', 'src/FileSystem') } })
    expect(s).toEqual({ key: 'repo:github.com/acme/tools/src/filesystem', owner: 'acme', name: 'tools', dir: 'src/FileSystem' })
    expect(readmeSubject({ kind: 'server', identity: { repository: repo('acme', 'tools', 'mcp/README.md') } })?.dir).toBe('mcp')
  })

  it('Skill 按规范键；不是 GitHub 或缺规范键时没有主体', () => {
    expect(readmeSubject({ kind: 'skill', identity: { skillKey: 'Acme/Skills#PDF', repository: repo('acme', 'skills') } })).toMatchObject({ key: 'skill:acme/skills#pdf', skill: 'PDF' })
    expect(readmeSubject({ kind: 'skill', identity: { repository: repo('acme', 'skills') } })).toBeNull()
    expect(readmeSubject({ kind: 'cli', identity: { repository: { ...repo('acme', 'tools'), host: 'gitlab.com' } } })).toBeNull()
  })
})

describe('resolveReadme', () => {
  it('相对链接基准是 README 所在目录；没有 GitHub README 时为 null', () => {
    const github: GithubReadme = { repository: 'Acme/Tools', path: 'src/fs/README.md', sha: 's', format: 'markdown', content: '# From GitHub' }
    expect(resolveReadme(github)).toEqual({ content: '# From GitHub', format: 'markdown', baseUrl: 'https://github.com/Acme/Tools/blob/HEAD/src/fs/' })
    expect(resolveReadme({ ...github, path: 'README.md' })?.baseUrl).toBe('https://github.com/Acme/Tools/blob/HEAD/')
    expect(resolveReadme(undefined)).toBeNull()
  })
})

describe('SKILL.md 元数据', () => {
  it('读出 name 并在展示时去掉', () => {
    const text = '---\nname: "vercel-react-best-practices"\ndescription: x\n---\n# Title\n'
    expect(frontmatterName(text)).toBe('vercel-react-best-practices')
    expect(stripFrontmatter(text)).toBe('# Title\n')
    expect(frontmatterName('# No meta')).toBeNull()
  })
})

describe('GithubReadmeFetcher', () => {
  const server: ReadmeSubject = { key: 'repo:github.com/acme/tools/src/fs', owner: 'acme', name: 'tools', dir: 'src/fs' }
  const skill = (name: string): ReadmeSubject => ({ key: `skill:acme/tools#${name}`, owner: 'acme', name: 'tools', dir: '', skill: name })

  it('取子目录 README：解码、统一换行、仓库名以 GitHub 为准；带 ETag 时 304 返回 not_modified', async () => {
    const client = fakeClient({ '/repos/acme/tools/readme/src/fs': ok(file('src/fs/README.md', '\uFEFF# FS\r\nbody\r\n')) })
    const result = await new GithubReadmeFetcher(client).fetch(server)
    expect(result).toEqual({ status: 'ok', etag: '"e1"', readme: { repository: 'Acme/Tools', path: 'src/fs/README.md', sha: 'sha-src/fs/README.md', format: 'markdown', content: '# FS\nbody' } })

    const cached = fakeClient({ '/repos/acme/tools/readme/src/fs': { status: 304, etag: '"e1"', data: null } })
    expect(await new GithubReadmeFetcher(cached).fetch(server, { etag: '"e1"', path: 'src/fs/README.md' })).toEqual({ status: 'not_modified', etag: '"e1"' })
    expect(cached.calls[0]!.etag).toBe('"e1"')
  })

  it('不存在、超过 1MB、非 Markdown 格式', async () => {
    expect(await new GithubReadmeFetcher(fakeClient({})).fetch(server)).toMatchObject({ status: 'not_found', httpStatus: 404 })
    const big = fakeClient({ '/repos/acme/tools/readme/src/fs': ok(file('src/fs/README.md', '', { size: 2_000_000, encoding: 'none', content: '' })) })
    expect(await new GithubReadmeFetcher(big).fetch(server)).toMatchObject({ status: 'too_large' })
    const rst = fakeClient({ '/repos/acme/tools/readme/src/fs': ok(file('src/fs/README.rst', 'Title\n=====\n')) })
    expect(await new GithubReadmeFetcher(rst).fetch(server)).toMatchObject({ status: 'ok', readme: { format: 'plain' } })
  })

  it('Skill：按目录名找（优先 skills/ 下），去掉元数据；同一仓库只取一次目录树', async () => {
    const client = fakeClient({
      '/repos/acme/tools/git/trees/HEAD?recursive=1': ok({ tree: [{ path: 'examples/pdf/SKILL.md', type: 'blob' }, { path: 'skills/pdf/SKILL.md', type: 'blob' }, { path: 'skills/docx/SKILL.md', type: 'blob' }] }),
      '/repos/acme/tools/contents/skills/pdf/SKILL.md': ok(file('skills/pdf/SKILL.md', '---\nname: pdf\n---\n# PDF skill')),
      '/repos/acme/tools/contents/skills/docx/SKILL.md': ok(file('skills/docx/SKILL.md', '# DOCX skill')),
    })
    const fetcher = new GithubReadmeFetcher(client)
    expect(await fetcher.fetch(skill('pdf'))).toMatchObject({ status: 'ok', readme: { path: 'skills/pdf/SKILL.md', content: '# PDF skill' } })
    expect(await fetcher.fetch(skill('docx'))).toMatchObject({ status: 'ok' })
    expect(client.calls.filter((c) => c.path.includes('/git/trees/'))).toHaveLength(1)
  })

  it('Skill：目录名对不上时按元数据 name 找；找不到为 not_found', async () => {
    const client = fakeClient({
      '/repos/acme/tools/git/trees/HEAD?recursive=1': ok({ tree: [{ path: 'skills/other/SKILL.md', type: 'blob' }, { path: 'skills/react-best-practices/SKILL.md', type: 'blob' }] }),
      '/repos/acme/tools/contents/skills/other/SKILL.md': ok(file('skills/other/SKILL.md', '---\nname: other\n---\nx')),
      '/repos/acme/tools/contents/skills/react-best-practices/SKILL.md': ok(file('skills/react-best-practices/SKILL.md', '---\nname: vercel-react-best-practices\n---\n# React')),
    })
    const fetcher = new GithubReadmeFetcher(client)
    expect(await fetcher.fetch(skill('vercel-react-best-practices'))).toMatchObject({ status: 'ok', readme: { path: 'skills/react-best-practices/SKILL.md', content: '# React' } })
    // 名字相近的目录先试，没有读 skills/other
    expect(client.calls.some((c) => c.path.endsWith('skills/other/SKILL.md'))).toBe(false)
    expect(await fetcher.fetch(skill('missing'))).toMatchObject({ status: 'not_found', httpStatus: 200 })
  })

  it('Skill：上次的路径失效时重新在目录树里找', async () => {
    const client = fakeClient({
      '/repos/acme/tools/git/trees/HEAD?recursive=1': ok({ tree: [{ path: 'new/pdf/SKILL.md', type: 'blob' }] }),
      '/repos/acme/tools/contents/new/pdf/SKILL.md': ok(file('new/pdf/SKILL.md', '# moved')),
    })
    expect(await new GithubReadmeFetcher(client).fetch(skill('pdf'), { etag: '"old"', path: 'skills/pdf/SKILL.md' })).toMatchObject({ status: 'ok', readme: { path: 'new/pdf/SKILL.md' } })
  })
})

describe('GithubClient', () => {
  const response = (status: number, headers: Record<string, string> = {}, body = '{}') => new Response(status === 304 ? null : body, { status, headers })

  function client(responses: Response[]) {
    const waits: number[] = []
    const requests: Headers[] = []
    const c = new GithubClient({
      token: 't0ken',
      userAgent: 'test',
      logger: silent,
      fetch: (async (_url: string, init: RequestInit) => {
        requests.push(new Headers(init.headers))
        return responses.shift()!
      }) as unknown as typeof fetch,
      sleep: async (ms) => {
        waits.push(ms)
      },
    })
    return { c, waits, requests }
  }

  it('带 token 和 ETag；404 不抛错；5xx 重试', async () => {
    const { c, waits, requests } = client([response(404), response(502), response(200, { etag: '"x"' }, '{"a":1}')])
    expect(await c.get('/a', { etag: '"old"' })).toEqual({ status: 404, etag: null, data: null })
    expect(requests[0]!.get('authorization')).toBe('Bearer t0ken')
    expect(requests[0]!.get('if-none-match')).toBe('"old"')
    expect(await c.get('/b')).toEqual({ status: 200, etag: '"x"', data: { a: 1 } })
    expect(waits).toHaveLength(1)
  })

  it('触发限流时等待后重试；非限流的 403 交给调用方', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 120)
    const { c, waits } = client([
      response(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }),
      response(429, { 'retry-after': '3' }),
      response(403, {}, '{"message":"You have exceeded a secondary rate limit"}'),
      response(200),
      response(403, {}, '{"message":"Repository access blocked"}'),
    ])
    expect((await c.get('/a')).status).toBe(200)
    expect(waits[0]).toBeGreaterThan(100_000)
    expect(waits.slice(1)).toEqual([3_000, 60_000])
    expect((await c.get('/b')).status).toBe(403)
  })

  it('GraphQL 用 POST，额度和 REST 分开计算', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 600)
    const { c, waits, requests } = client([
      response(200, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }),
      response(200, {}, '{"data":{"r0":null},"errors":[{"type":"NOT_FOUND","path":["r0"],"message":"Could not resolve"}]}'),
    ])
    await c.get('/a')
    expect(await c.graphql('query { r0: repository(owner: "a", name: "b") { id } }', {})).toEqual({ data: { r0: null }, errors: [{ type: 'NOT_FOUND', path: ['r0'], message: 'Could not resolve' }] })
    expect(waits).toHaveLength(0)
    expect(requests[1]!.get('authorization')).toBe('Bearer t0ken')
  })

  it('剩余额度不足时先等到重置时间再发请求', async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 600)
    const { c, waits } = client([response(200, { 'x-ratelimit-remaining': '3', 'x-ratelimit-reset': reset }), response(200)])
    await c.get('/a')
    expect(waits).toHaveLength(0)
    await c.get('/b')
    expect(waits).toHaveLength(1)
    expect(waits[0]).toBeGreaterThan(500_000)
  })
})

describe('GithubReadmeRunner', () => {
  const subject = (name: string): CollectedSubject => ({ key: `repo:github.com/acme/${name}`, owner: 'acme', name, dir: '', entries: 1 })
  const readme: GithubReadme = { repository: 'acme/a', path: 'README.md', sha: 's', format: 'markdown', content: '# A' }

  function setup(states: Map<string, ReadmeFetchState>, fetch: (s: ReadmeSubject) => Promise<unknown>) {
    const saved: string[] = []
    const store = {
      states: async () => states,
      saveOk: async (key: string) => void saved.push(`ok:${key}`),
      saveNotModified: async (key: string) => void saved.push(`304:${key}`),
      saveMissing: async (key: string, status: string) => void saved.push(`${status}:${key}`),
      saveError: async (key: string, _e: string, _s: unknown, attempts: number, _x: Date, keep: boolean) => void saved.push(`error:${key}:${attempts}:${keep}`),
    }
    const fetched: string[] = []
    const runner = new GithubReadmeRunner({ fetch: async (s) => (fetched.push(s.name), (await fetch(s)) as never) }, store, silent)
    return { runner, saved, fetched }
  }

  it('没抓过的都抓；抓过的到期才检查；--force 全部重抓', async () => {
    const past = new Date(Date.now() - 1000)
    const future = new Date(Date.now() + 86_400_000)
    const states = new Map<string, ReadmeFetchState>([
      ['repo:github.com/acme/fresh', { status: 'ok', etag: '"e"', path: 'README.md', attempts: 0, expiresAt: future }],
      ['repo:github.com/acme/stale', { status: 'ok', etag: '"e"', path: 'README.md', attempts: 0, expiresAt: past }],
    ])
    const subjects = [subject('a'), subject('fresh'), subject('stale')]
    const { runner, saved, fetched } = setup(states, async (s) => (s.name === 'stale' ? { status: 'not_modified', etag: '"e"' } : { status: 'ok', readme, etag: null }))
    const stats = await runner.run(subjects, { concurrency: 2 })
    expect(fetched.sort()).toEqual(['a', 'stale'])
    expect(saved.sort()).toEqual(['304:repo:github.com/acme/stale', 'ok:repo:github.com/acme/a'])
    expect(stats).toMatchObject({ subjects: 3, pending: 2, ok: 1, notModified: 1 })

    const forced = setup(states, async () => ({ status: 'not_found', httpStatus: 404, reason: 'x' }))
    await forced.runner.run(subjects, { concurrency: 2, force: true, limit: 10 })
    expect(forced.fetched.sort()).toEqual(['a', 'fresh', 'stale'])
  })

  it('临时错误累计次数；已经抓到过的保留原内容', async () => {
    const past = new Date(Date.now() - 1000)
    const states = new Map<string, ReadmeFetchState>([
      ['repo:github.com/acme/a', { status: 'error', etag: null, path: null, attempts: 2, expiresAt: past }],
      ['repo:github.com/acme/b', { status: 'ok', etag: '"e"', path: 'README.md', attempts: 0, expiresAt: past }],
    ])
    const { runner, saved } = setup(states, async () => {
      throw new Error('boom')
    })
    const stats = await runner.run([subject('a'), subject('b')], { concurrency: 1 })
    expect(saved).toEqual(['error:repo:github.com/acme/a:3:false', 'error:repo:github.com/acme/b:1:true'])
    expect(stats.failed).toBe(2)
  })
})

describe('仓库统计', () => {
  const ref = (owner: string, name: string): RepoRef => ({ key: `repo:github.com/${owner}/${name}`, owner, name })

  it('主体不含子目录，monorepo 里的条目共用', () => {
    expect(repoRef({ identity: { repository: repo('acme', 'tools', 'src/fs') } })).toEqual(ref('acme', 'tools'))
    expect(repoRef({ identity: {} })).toBeNull()
  })

  it('一批仓库一次 GraphQL 查询；不存在的为 null；整个查询失败时抛错', async () => {
    let sent: { query: string; variables: Record<string, unknown> } | undefined
    const fetcher = new GithubRepoFetcher({
      graphql: async <T>(query: string, variables: Record<string, unknown>) => {
        sent = { query, variables }
        const node = { nameWithOwner: 'Acme/Tools', stargazerCount: 42, forkCount: 3, isArchived: false, pushedAt: '2026-10-02T00:00:00Z', defaultBranchRef: { target: { committedDate: '2026-10-01T00:00:00Z' } } }
        return { data: { r0: node, r1: null } as T, errors: [{ type: 'NOT_FOUND', path: ['r1'], message: 'x' }] }
      },
    })
    const result = await fetcher.fetch([ref('acme', 'tools'), ref('acme', 'gone')])
    expect(sent!.variables).toEqual({ o0: 'acme', n0: 'tools', o1: 'acme', n1: 'gone' })
    expect(sent!.query).toContain('r1: repository(owner: $o1, name: $n1)')
    expect(result.get('repo:github.com/acme/tools')).toEqual({ repository: 'Acme/Tools', stars: 42, forks: 3, archived: false, lastCommitAt: '2026-10-01T00:00:00Z', pushedAt: '2026-10-02T00:00:00Z' })
    expect(result.get('repo:github.com/acme/gone')).toBeNull()

    const broken = new GithubRepoFetcher({ graphql: async () => ({ data: null, errors: [{ message: 'timeout' }] }) })
    await expect(broken.fetch([ref('acme', 'tools')])).rejects.toThrow('timeout')
  })

  it('分批写入；某批失败只跳过这一批', async () => {
    const saved: string[][] = []
    const stats: RepoStats = { repository: 'a/b', stars: 1, forks: 0, archived: false, lastCommitAt: null, pushedAt: null }
    const runner = new GithubRepoRunner(
      {
        fetch: async (batch: RepoRef[]) => {
          if (batch.some((r) => r.name === 'bad')) throw new Error('boom')
          return new Map(batch.map((r) => [r.key, r.name === 'gone' ? null : stats]))
        },
      },
      { save: async (results: Map<string, RepoStats | null>) => void saved.push([...results.keys()]) },
      silent,
    )
    const result = await runner.run([ref('a', 'x'), ref('a', 'gone'), ref('a', 'bad'), ref('a', 'y')], { batchSize: 2, concurrency: 1 })
    expect(saved).toEqual([['repo:github.com/a/x', 'repo:github.com/a/gone']])
    expect(result).toMatchObject({ repos: 4, ok: 1, notFound: 1, failed: 2 })
  })
})
