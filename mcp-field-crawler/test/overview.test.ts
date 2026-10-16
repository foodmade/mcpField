import { describe, expect, it } from 'vitest'
import type { Logger } from '../src/core/logger.ts'
import { longestCopiedRun } from '../src/llm/checks.ts'
import { overviewInputHash, prepareReadme } from '../src/overview/prepare.ts'
import { needsOverview, OverviewRunner } from '../src/overview/runner.ts'
import { overviewKey, type OverviewContent, type OverviewInput, type OverviewResult, type OverviewWriter } from '../src/overview/types.ts'
import { validateOverview } from '../src/overview/validate.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

const README = `# Demo Client

[![build](https://img.shields.io/badge/build-passing-green)](https://ci.example.com)
<p align="center"><img src="./logo.png" width="120"></p>
<!-- hidden note -->

Demo Client lets teams chat with several model providers from one desktop window and keeps every conversation searchable offline.
See the [docs](https://docs.example.com/start) for details.

\`\`\`bash
${Array.from({ length: 20 }, (_, i) => `echo step ${i}`).join('\n')}
\`\`\`
`

const input = (over: Partial<OverviewInput> = {}): OverviewInput => ({
  sourceId: 'mcpso',
  kind: 'client',
  externalId: 'demo',
  name: 'Demo Client',
  tagline: 'Desktop chat client',
  category: 'desktop',
  tags: [],
  website: null,
  readme: prepareReadme(README),
  stars: 10,
  inputHash: 'h1',
  ...over,
})

const content = (summary: string, features = ['多模型对话', '离线搜索'], useCases = ['团队协作']): OverviewContent => ({ summary, features, useCases, mcp: '' })

const good = (i: OverviewInput): OverviewResult => ({
  key: overviewKey(i),
  content: {
    zh: content('Demo Client 是一款桌面聊天客户端，可在同一窗口中使用多家模型服务。'),
    en: content('A desktop chat client for using several model providers in one window, with offline search.', ['Multi-provider chat', 'Offline search'], ['Team collaboration']),
    ja: content('Demo Client は、複数のモデルサービスを一つのウィンドウで使えるデスクトップチャットクライアントです。', ['複数プロバイダー対応', 'オフライン検索'], ['チームでの共同作業']),
  },
})

describe('prepareReadme', () => {
  it('去掉徽章、图片、注释和 HTML，链接只留文字，长代码块截断', () => {
    const out = prepareReadme(README)
    expect(out).not.toMatch(/shields\.io|logo\.png|hidden note|<p|https:\/\/docs/)
    expect(out).toContain('See the docs for details.')
    expect(out).toContain('echo step 0')
    expect(out).not.toContain('echo step 19')
  })

  it('超长时按段落截断', () => {
    const long = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} ${'word '.repeat(60)}`).join('\n\n')
    const out = prepareReadme(long, 2000)
    expect(out.length).toBeLessThanOrEqual(2002)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('longestCopiedRun', () => {
  it('找出与原文连续相同的最长词数', () => {
    const src = 'Demo Client lets teams chat with several model providers from one desktop window and keeps every conversation searchable offline.'
    expect(longestCopiedRun('It lets teams chat with several model providers from one desktop window and keeps every conversation searchable.', src)).toBe(16)
    expect(longestCopiedRun('A desktop app for multi-provider chat.', src)).toBe(0)
  })
})

describe('validateOverview', () => {
  it('合格的介绍没有问题', () => {
    const i = input()
    expect(validateOverview(i, good(i))).toEqual([])
  })

  it('照抄 README、日文混入中文、三语条数不一致都会被发现', () => {
    const i = input()
    const r = good(i)
    r.content.en.summary = 'Demo Client lets teams chat with several model providers from one desktop window and keeps every conversation searchable offline.'
    r.content.ja.summary = '这是一个桌面聊天客户端。'
    r.content.ja.features = ['一つだけ']
    const codes = validateOverview(i, r).map((p) => `${p.code}:${p.hard}`)
    expect(codes).toEqual(expect.arrayContaining(['copied_from_readme:true', 'chinese_in_ja:true', 'count_mismatch:false']))
  })
})

describe('OverviewRunner', () => {
  it('输入没变的跳过；按星数把热门条目交给更强的模型', async () => {
    const calls: Record<string, string[]> = {}
    const writer = (model: string): OverviewWriter => ({
      provider: 'fake',
      model,
      promptVersion: 1,
      async write(items) {
        calls[model] = [...(calls[model] ?? []), ...items.map((i) => i.externalId)]
        return { results: items.map(good), usage: { requests: 1, inputTokens: 1, outputTokens: 1 } }
      },
    })
    const inputs = [input({ externalId: 'a', stars: 5 }), input({ externalId: 'b', stars: 5000 }), input({ externalId: 'c', stars: 50, inputHash: 'same' })]
    const saved: string[] = []
    const store = {
      existing: async () => new Map([[overviewKey(inputs[2]!), { inputHash: 'same', promptVersion: 1, locales: 3 }]]),
      save: async (i: OverviewInput) => {
        saved.push(i.externalId)
      },
    }
    const stats = await new OverviewRunner({ standard: writer('haiku'), premium: writer('sonnet'), premiumMinStars: 1000 }, store, silent).run(inputs, { batchSize: 3, maxBatchChars: 40000, concurrency: 2 })
    expect(calls).toEqual({ haiku: ['a'], sonnet: ['b'] })
    expect(saved.sort()).toEqual(['a', 'b'])
    expect(stats).toMatchObject({ inputs: 3, pending: 2, premium: 1, ok: 2, failed: 0 })
  })
})

describe('每日增量：哪些条目需要（重新）生成介绍', () => {
  const fields = { name: 'Demo', tagline: 'A demo MCP server', tags: ['search'], website: null, readme: '# Demo\n\nSearch the web.' }

  it('分类不影响指纹，README、标签变了指纹才变', () => {
    const base = overviewInputHash('server', fields)
    // 分类不是指纹的一部分：OverviewInput 带着 category，但只交给模型参考
    expect(overviewInputHash('server', input({ ...fields, category: 'desktop' }))).toBe(base)
    expect(overviewInputHash('server', input({ ...fields, category: 'search' }))).toBe(base)
    expect(overviewInputHash('server', { ...fields, readme: '# Demo\n\nSearch the web and fetch pages.' })).not.toBe(base)
    expect(overviewInputHash('server', { ...fields, tags: ['search', 'web'] })).not.toBe(base)
  })

  it('没有、缺语言、输入变了才生成；--stale 重做旧版提示词的，--force 全部重做', () => {
    const current = input({ inputHash: 'h1' })
    const done = { inputHash: 'h1', promptVersion: 2, locales: 3 }
    expect(needsOverview(current, undefined, {}, 2)).toBe(true)
    expect(needsOverview(current, { ...done, locales: 2 }, {}, 2)).toBe(true)
    expect(needsOverview(current, { ...done, inputHash: 'old' }, {}, 2)).toBe(true)
    expect(needsOverview(current, done, {}, 2)).toBe(false)
    expect(needsOverview(current, { ...done, promptVersion: 1 }, {}, 2)).toBe(false)
    expect(needsOverview(current, { ...done, promptVersion: 1 }, { stale: true }, 2)).toBe(true)
    expect(needsOverview(current, done, { force: true }, 2)).toBe(true)
  })
})
