import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HttpError } from '../src/core/errors.ts'
import type { Fetcher } from '../src/core/source.ts'
import type { CrawlTarget, FetchRequest, RawDocument } from '../src/core/types.ts'
import { assignSlugs } from '../src/merge/publish.ts'
import { SkillsShDiscoverer, weekStart } from '../src/sources/skills-sh/discoverer.ts'
import { SkillsShFetcher } from '../src/sources/skills-sh/fetcher.ts'
import { frontmatterField, SkillsShMapper } from '../src/sources/skills-sh/mapper.ts'
import { SkillsShParser } from '../src/sources/skills-sh/parser.ts'
import { tokenExpiry, VercelOidcToken } from '../src/sources/skills-sh/token.ts'
import { auditUrlFor, listUrl, skillUrl } from '../src/sources/skills-sh/urls.ts'

const doc = (url: string, body: string): RawDocument => ({ requestedUrl: url, url, status: 200, headers: {}, body, fetchedAt: new Date('2026-10-13T00:00:00Z'), durationMs: 0, notModified: false })
const listing = (source: string, slug: string, installs = 100, sourceType = 'github') => ({ id: `${source}/${slug}`, slug, name: slug, source, installs, sourceType, installUrl: null, url: `https://www.skills.sh/${source}/${slug}` })

const SKILL_MD = `---
name: pdf
description: >-
  Read, merge and fill PDF files.
  Use when the user mentions PDFs.
license: MIT
---

# PDF

Body.`

describe('frontmatterField', () => {
  it('单行、引号、> 折叠块、| 保留换行；没有元数据时为 null', () => {
    expect(frontmatterField(SKILL_MD, 'name')).toBe('pdf')
    expect(frontmatterField(SKILL_MD, 'description')).toBe('Read, merge and fill PDF files. Use when the user mentions PDFs.')
    expect(frontmatterField('---\nname: "Quoted Name"\n---\n', 'name')).toBe('Quoted Name')
    expect(frontmatterField('---\ndescription: |\n  line one\n  line two\nname: x\n---\n', 'description')).toBe('line one\nline two')
    expect(frontmatterField('# no meta', 'name')).toBeNull()
  })
})

describe('urls', () => {
  it('详情、审计、排行榜地址', () => {
    expect(skillUrl('anthropics/skills', 'pdf')).toBe('https://skills.sh/api/v1/skills/anthropics/skills/pdf')
    expect(skillUrl('open.feishu.cn', 'lark-doc')).toBe('https://skills.sh/api/v1/skills/open.feishu.cn/lark-doc')
    expect(auditUrlFor(skillUrl('anthropics/skills', 'pdf'))).toBe('https://skills.sh/api/v1/skills/audit/anthropics/skills/pdf')
    expect(listUrl(3)).toBe('https://skills.sh/api/v1/skills?view=all-time&per_page=500&page=3')
  })
})

describe('SkillsShDiscoverer + SkillsShFetcher', () => {
  const PAGES: Record<string, unknown> = {
    [listUrl(0)]: { data: [listing('anthropics/skills', 'pdf'), listing('acme/skills', 'facebook/meta-ads')], pagination: { hasMore: true } },
    [listUrl(1)]: { data: [listing('anthropics/skills', 'pdf'), listing('open.feishu.cn', 'lark-doc', 9, 'well-known')], pagination: { hasMore: false } },
    [skillUrl('anthropics/skills', 'pdf')]: { id: 'anthropics/skills/pdf', source: 'anthropics/skills', slug: 'pdf', installs: 120, hash: 'h1', files: [{ path: 'SKILL.md', contents: SKILL_MD }, { path: 'scripts/merge.py', contents: 'print(1)' }] },
    [auditUrlFor(skillUrl('anthropics/skills', 'pdf'))]: { audits: [{ provider: 'Socket', slug: 'socket', status: 'pass', summary: 'No alerts', riskLevel: 'SAFE', categories: ['FILES'] }] },
    [skillUrl('open.feishu.cn', 'lark-doc')]: { id: 'open.feishu.cn/lark-doc', source: 'open.feishu.cn', slug: 'lark-doc', installs: 9, files: [] },
  }
  const inner: Fetcher = {
    async fetch(req: FetchRequest) {
      if (!(req.url in PAGES)) throw new HttpError(req.url, 404)
      return doc(req.url, JSON.stringify(PAGES[req.url]))
    },
  }

  it('翻页去重，跳过名称里带 / 的；lastmod 是本周期开始', async () => {
    const fetcher = new SkillsShFetcher(inner)
    const targets: CrawlTarget[] = []
    for await (const t of new SkillsShDiscoverer(fetcher, 'skills-sh').discover({ kinds: ['skill'] })) targets.push(t)
    expect(targets.map((t) => t.externalId)).toEqual(['anthropics/skills/pdf', 'open.feishu.cn/lark-doc'])
    expect(targets[0]!.lastmod).toEqual(weekStart())
  })

  it('抓取 skill 时合并排行榜条目、详情和审计；没有审计（404）时为空', async () => {
    const fetcher = new SkillsShFetcher(inner)
    const targets: CrawlTarget[] = []
    for await (const t of new SkillsShDiscoverer(fetcher, 'skills-sh').discover({ kinds: ['skill'] })) targets.push(t)
    const pdf = JSON.parse((await fetcher.fetch({ url: targets[0]!.url })).body)
    expect(pdf.listing.id).toBe('anthropics/skills/pdf')
    expect(pdf.skill.hash).toBe('h1')
    expect(pdf.audits[0].provider).toBe('Socket')
    const lark = JSON.parse((await fetcher.fetch({ url: targets[1]!.url })).body)
    expect(lark.audits).toEqual([])
  })

  it('解析只保留 SKILL.md 正文和其他文件路径；映射出 Skill 草稿', async () => {
    const fetcher = new SkillsShFetcher(inner)
    const targets: CrawlTarget[] = []
    for await (const t of new SkillsShDiscoverer(fetcher, 'skills-sh').discover({ kinds: ['skill'] })) targets.push(t)
    const [record] = await new SkillsShParser().parse(await fetcher.fetch({ url: targets[0]!.url }), targets[0]!)
    expect(record!.data).toMatchObject({ installs: 120, hash: 'h1', skillMd: SKILL_MD, files: ['scripts/merge.py'] })

    const draft = new SkillsShMapper().map(record!)
    expect(draft).toMatchObject({
      kind: 'skill',
      externalId: 'anthropics/skills/pdf',
      slug: 'pdf',
      name: 'pdf',
      identityKey: 'skill:anthropics/skills#pdf',
      texts: [{ field: 'description', locale: 'en', content: 'Read, merge and fill PDF files. Use when the user mentions PDFs.', format: 'plain' }],
      metrics: [{ metric: 'skill_installs', value: 120 }],
      authors: [{ platform: 'github', login: 'anthropics', role: 'owner' }],
      detail: {
        canonicalKey: 'anthropics/skills#pdf',
        skillSlug: 'pdf',
        installCommand: 'npx skills add https://github.com/anthropics/skills --skill pdf',
        audits: [{ auditor: 'Socket', result: 'pass', riskLevel: 'SAFE', summary: 'No alerts', categories: ['FILES'] }],
      },
    })
    expect(draft.identity.repository).toMatchObject({ owner: 'anthropics', name: 'skills' })

    const [wk] = await new SkillsShParser().parse(await fetcher.fetch({ url: targets[1]!.url }), targets[1]!)
    const feishu = new SkillsShMapper().map(wk!)
    expect(feishu).toMatchObject({ identityKey: 'skill:open.feishu.cn#lark-doc', name: 'lark-doc', detail: { installCommand: 'npx skills add https://open.feishu.cn --skill lark-doc' } })
    expect(feishu.identity.repository).toBeUndefined()
  })
})

describe('VercelOidcToken', () => {
  const jwt = (expSeconds: number) => `x.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url')}.y`

  it('读取目录里的令牌；快过期时运行 vercel env pull 换新的', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oidc-'))
    const soon = jwt(Math.floor(Date.now() / 1000) + 60)
    const later = jwt(Math.floor(Date.now() / 1000) + 12 * 3600)
    writeFileSync(join(dir, '.env.local'), `VERCEL_OIDC_TOKEN="${soon}"\n`)
    let pulls = 0
    const token = new VercelOidcToken(dir, async () => {
      pulls++
      writeFileSync(join(dir, '.env.local'), `VERCEL_OIDC_TOKEN="${later}"\n`)
    })
    expect(await token.get()).toBe(later)
    expect(await token.get()).toBe(later)
    expect(pulls).toBe(1)
    expect(tokenExpiry(later)).toBeGreaterThan(Date.now())
  })
})

describe('assignSlugs（Skill）', () => {
  it('重名时先用"名称-作者"，再加序号', () => {
    const req = (key: string, externalId: string, slug: string) => ({ kind: 'skill' as const, key, primary: { sourceId: 'skills-sh', externalId, slug } })
    const a = req('k1', 'anthropics/skills/pdf', 'pdf')
    const b = req('k2', 'acme/tools/pdf', 'pdf')
    const c = req('k3', 'acme/other/pdf', 'pdf')
    const d = req('k4', 'open.feishu.cn/pdf', 'pdf')
    const slugs = assignSlugs([a, b, c, d], [])
    expect([slugs.get(a), slugs.get(b), slugs.get(c), slugs.get(d)]).toEqual(['pdf', 'pdf-acme', 'pdf-acme-2', 'pdf-open-feishu-cn'])
  })
})
