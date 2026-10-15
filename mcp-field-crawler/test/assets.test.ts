import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { AssetMirror } from '../src/assets/mirror.ts'
import { AssetError, download, downloadUrl, storageKey, toWebp, type ProcessedImage } from '../src/assets/processor.ts'
import { applyOwnerIcon, mirroredOwnerAvatars, ownerAvatarUrl } from '../src/assets/owner-icons.ts'
import type { AssetStorage } from '../src/assets/storage.ts'
import type { AssetState } from '../src/assets/store.ts'
import { DraftBuilder } from '../src/core/draft-builder.ts'
import { parseRepositoryUrl } from '../src/core/identity.ts'
import type { Logger } from '../src/core/logger.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

describe('图片处理', () => {
  it('PNG 缩到 256 以内并转成 WebP', async () => {
    const png = await sharp({ create: { width: 600, height: 300, channels: 4, background: '#3DDC97' } }).png().toBuffer()
    const out = await toWebp(png, 'image/png')
    expect(out.mime).toBe('image/webp')
    expect([out.width, out.height]).toEqual([256, 128])
    expect(out.body.subarray(8, 12).toString()).toBe('WEBP')
    expect(out.contentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('小图不放大；SVG 转成位图（即使没有 content-type）', async () => {
    const tiny = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#000' } }).png().toBuffer()
    expect((await toWebp(tiny, 'image/png')).width).toBe(32)
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="red"/><script>alert(1)</script></svg>')
    const out = await toWebp(svg, null)
    expect(out.mime).toBe('image/webp')
    expect(out.width).toBe(256)
    expect(out.body.includes(Buffer.from('script'))).toBe(false)
  })

  it('无法识别的内容标记为不支持', async () => {
    await expect(toWebp(Buffer.from('not an image'), 'image/x-icon')).rejects.toMatchObject({ failure: { kind: 'unsupported' } })
  })

  it('GitHub 头像请求 256px 版本；存储路径按哈希分目录', () => {
    expect(downloadUrl('https://avatars.githubusercontent.com/u/1?v=4')).toBe('https://avatars.githubusercontent.com/u/1?v=4&s=256')
    expect(downloadUrl('https://github.com/oven-sh.png')).toBe('https://github.com/oven-sh.png?size=256')
    expect(downloadUrl('https://cdn.mcp.so/a.png')).toBe('https://cdn.mcp.so/a.png')
    expect(downloadUrl('https://github.com/acme/tool/blob/main/assets/logo.png')).toBe('https://raw.githubusercontent.com/acme/tool/main/assets/logo.png')
    expect(downloadUrl('https://github.com/acme/tool/raw/main/logo.svg')).toBe('https://raw.githubusercontent.com/acme/tool/main/logo.svg')
    expect(storageKey('icon', 'ab'.repeat(32))).toBe(`icons/ab/${'ab'.repeat(32)}.webp`)
  })

  it('拒绝 http 和内网地址', async () => {
    await expect(download('http://example.com/a.png', 'test')).rejects.toMatchObject({ failure: { kind: 'blocked' } })
    await expect(download('https://127.0.0.1/a.png', 'test')).rejects.toMatchObject({ failure: { kind: 'blocked' } })
  })
})

describe('AssetMirror', () => {
  it('跳过已完成的；同样内容只上传一次；失败按类型记录', async () => {
    const image = (hash: string): ProcessedImage => ({ body: Buffer.from(hash), contentHash: hash.padEnd(64, '0'), mime: 'image/webp', width: 64, height: 64, originalMime: 'image/png', originalBytes: 10 })
    const uploads: string[] = []
    const storage: AssetStorage = {
      name: 'fake',
      exists: async (key) => uploads.includes(key),
      put: async (key) => void uploads.push(key),
      publicUrl: (key) => `https://assets.test/${key}`,
    }
    const saved: Record<string, string> = {}
    const okByContent = new Map<string, { storageKey: string; publicUrl: string }>()
    const store = {
      states: async () => new Map<string, AssetState>([['https://x/done.png', { status: 'ok', attempts: 1, nextRetryAt: null }]]),
      findByContent: async (hash: string) => okByContent.get(hash) ?? null,
      saveOk: async (url: string, _p: string, img: ProcessedImage, key: string, publicUrl: string) => {
        saved[url] = `ok ${publicUrl}`
        okByContent.set(img.contentHash, { storageKey: key, publicUrl })
      },
      saveFailure: async (url: string, _p: string, status: string) => void (saved[url] = status),
    }
    const fetchImage = async (url: string) => {
      if (url.endsWith('missing.png')) throw new AssetError({ kind: 'gone', status: 404, message: '404' })
      if (url.endsWith('page.html')) throw new AssetError({ kind: 'unsupported', message: 'html' })
      if (url.endsWith('slow.png')) throw new AssetError({ kind: 'failed', message: 'timeout' })
      return { body: Buffer.from(url), mime: 'image/png' }
    }
    // a.png 和 b.png 内容相同
    const process = async (body: Buffer) => image(body.toString().includes('/c.png') ? 'cc' : 'ab')
    const mirror = new AssetMirror(storage, store, silent, 'test', fetchImage, process)
    const items = ['done', 'a', 'b', 'c', 'missing', 'page', 'slow'].map((n) => ({ url: `https://x/${n}${n === 'page' ? '.html' : '.png'}`, type: 'icon' as const }))
    const stats = await mirror.run(items, { concurrency: 1 })

    expect(stats).toMatchObject({ total: 7, pending: 6, ok: 3, reused: 1, gone: 1, skipped: 1, failed: 1 })
    expect(uploads).toHaveLength(2)
    expect(saved['https://x/a.png']).toBe(saved['https://x/b.png'])
    expect(saved['https://x/missing.png']).toBe('gone')
    expect(saved['https://x/done.png']).toBeUndefined()
  })
})

describe('图标补全（所有者头像）', () => {
  const skill = (repo: string | undefined, icon?: string) =>
    new DraftBuilder({ kind: 'skill', sourceId: 'skills-sh', externalId: 'x', sourceUrl: 'https://skills.sh/x', slug: 'pdf', name: 'pdf' }, { skillSlug: 'pdf', audits: [], files: [] })
      .identity({ repository: parseRepositoryUrl(repo) })
      .media('icon', icon)
      .build()

  it('按 GitHub 仓库所有者生成头像地址，其他托管平台不处理', () => {
    expect(ownerAvatarUrl({ repository: parseRepositoryUrl('https://github.com/Anthropics/skills') })).toBe('https://github.com/anthropics.png')
    expect(ownerAvatarUrl({ repository: parseRepositoryUrl('https://gitlab.com/acme/skills') })).toBeNull()
    expect(ownerAvatarUrl({})).toBeNull()
  })

  it('只给没有图标的条目补上已转存的头像', () => {
    const mirrored = new Set(['https://github.com/anthropics.png'])
    const missing = skill('https://github.com/anthropics/skills')
    expect(applyOwnerIcon(missing, mirrored)).toBe(true)
    expect(missing.media).toEqual([{ type: 'icon', url: 'https://github.com/anthropics.png' }])

    const own = skill('https://github.com/anthropics/skills', 'https://acme.dev/icon.png')
    expect(applyOwnerIcon(own, mirrored)).toBe(false)
    expect(own.media).toEqual([{ type: 'icon', url: 'https://acme.dev/icon.png' }])
    expect(applyOwnerIcon(skill('https://github.com/acme/skills'), mirrored)).toBe(false)
    expect(applyOwnerIcon(skill(undefined), mirrored)).toBe(false)
  })

  it('图标原图已失效的换成头像；服务也适用', () => {
    const mirrored = new Set(['https://github.com/microsoft.png'])
    const broken = new Set(['https://cdn.mcp.so/dead.png'])
    const dead = skill('https://github.com/microsoft/skills', 'https://cdn.mcp.so/dead.png')
    expect(applyOwnerIcon(dead, mirrored, broken)).toBe(true)
    expect(dead.media).toEqual([{ type: 'icon', url: 'https://github.com/microsoft.png' }])
    expect(applyOwnerIcon(dead, mirrored, broken)).toBe(false)

    const server = new DraftBuilder({ kind: 'server', sourceId: 'mcpso', externalId: 'vscode', sourceUrl: 'u', slug: 'vscode', name: 'vscode' }, { isRemote: false, transports: [], packages: [], envVars: [], remotes: [], tools: [] })
      .identity({ repository: parseRepositoryUrl('https://github.com/microsoft/vscode') })
      .media('screenshot', 'https://cdn.mcp.so/shot.png')
      .build()
    expect(applyOwnerIcon(server, mirrored)).toBe(true)
    expect(server.media.map((m) => m.type)).toEqual(['icon', 'screenshot'])
  })

  it('发布时按所有者去重查询已转存的头像', async () => {
    const asked: string[][] = []
    const reader = { lookup: async (urls: string[]) => (asked.push(urls), new Map([['https://github.com/acme.png', 'https://assets.test/a.webp']])) }
    const identities = ['acme/a', 'ACME/b', 'other/c'].map((r) => ({ repository: parseRepositoryUrl(`https://github.com/${r}`) }))
    expect(await mirroredOwnerAvatars(reader, [...identities, {}])).toEqual(new Set(['https://github.com/acme.png']))
    expect(asked).toEqual([['https://github.com/acme.png', 'https://github.com/other.png']])
  })
})
