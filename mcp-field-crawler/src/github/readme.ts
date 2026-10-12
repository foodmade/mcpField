import type { IdentityHints } from '../core/draft.ts'
import type { EntityKind } from '../core/types.ts'
import type { GithubClient, GithubResponse } from './client.ts'

/** 从 GitHub 补抓到的 README，存在 ingest_enrichments.data 里 */
export interface GithubReadme {
  /** 仓库全名，大小写以 GitHub 为准；仓库改名后是新名字 */
  repository: string
  /** 文件在仓库里的路径，例如 README.md、src/filesystem/README.md、skills/pdf/SKILL.md */
  path: string
  sha: string
  /** .md 等按 Markdown 渲染；.rst、.txt、没有扩展名的按纯文本显示 */
  format: 'markdown' | 'plain'
  content: string
}

/** 要补抓 README 的主体：同一个仓库目录、同一个 Skill 只抓一次 */
export interface ReadmeSubject {
  /** repo:github.com/owner/name[/dir] 或 skill:owner/repo#slug，小写，用于去重和查询 */
  key: string
  owner: string
  name: string
  /** 仓库内的目录，保留原大小写；根目录为空字符串 */
  dir: string
  /** Skill 的目录名：README 是 <skill>/SKILL.md */
  skill?: string
}

export type ReadmeFetchResult =
  | { status: 'ok'; readme: GithubReadme; etag: string | null }
  | { status: 'not_modified'; etag: string | null }
  | { status: 'not_found' | 'too_large'; httpStatus: number; reason: string }

interface ContentFile {
  type: string
  name: string
  path: string
  sha: string
  size: number
  html_url: string | null
  content?: string
  encoding?: string
}

interface GitTree {
  tree: { path: string; type: string }[]
}

/** GitHub 内容接口只对 1MB 以内的文件返回正文 */
const MAX_BYTES = 1_000_000
/** 目录名对不上时，最多读多少个 SKILL.md 比对元数据里的 name */
const MAX_NAME_PROBES = 50
const MARKDOWN_FILE = /\.(md|markdown|mdx|mkd|mkdn|mdown)$/i

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/** 指向文件的仓库地址（…/blob/main/docs/README.md）取文件所在目录 */
export function repoDir(path: string): string {
  const segments = path.split('/').filter(Boolean)
  if (/\.[A-Za-z0-9]{1,8}$/.test(segments.at(-1) ?? '')) segments.pop()
  return segments.join('/')
}

/** 条目对应的补抓主体；不是 GitHub 仓库、Skill 缺规范键时返回 null */
export function readmeSubject(d: { kind: EntityKind; identity: IdentityHints }): ReadmeSubject | null {
  const repo = d.identity.repository
  if (!repo || repo.host !== 'github.com') return null
  if (d.kind === 'skill') {
    const key = d.identity.skillKey
    const skill = key?.split('#')[1]?.trim()
    return key && skill ? { key: `skill:${key.toLowerCase()}`, owner: repo.owner, name: repo.name, dir: '', skill } : null
  }
  const dir = repoDir(repo.path)
  return { key: `repo:github.com/${repo.owner}/${repo.name}${dir ? '/' + dir.toLowerCase() : ''}`, owner: repo.owner, name: repo.name, dir }
}

/** SKILL.md 开头的 YAML 元数据（name、description）不展示 */
export function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---[ \t]*(\n|$)/, '')
}

/** SKILL.md 元数据里的 name */
export function frontmatterName(text: string): string | null {
  const meta = text.match(/^---\n([\s\S]*?)\n---/)?.[1]
  return meta?.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim() ?? null
}

/** base64 正文解码，去掉 BOM、统一换行 */
const decode = (file: ContentFile) => Buffer.from(file.content ?? '', 'base64').toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')

/** 按目录名找 Skill：同名目录有多个时优先 skills/ 下的、路径短的 */
function pickSkillFile(files: string[], skill: string, repoName: string): string | null {
  const slug = skill.toLowerCase()
  const rank = (p: string) => (/(^|\/)skills\//.test(p) ? 0 : 1) * 1000 + p.length
  const matches = files.filter((p) => p.split('/').at(-2)?.toLowerCase() === slug).sort((a, b) => rank(a) - rank(b))
  if (matches[0]) return matches[0]
  // 单个 Skill 的仓库可能把 SKILL.md 放在根目录
  const root = files.find((p) => !p.includes('/'))
  return root && (repoName.toLowerCase() === slug || files.length === 1) ? root : null
}

/**
 * 从 GitHub 取 README：
 * - 仓库（含 monorepo 子目录）：GET /repos/{owner}/{repo}/readme/{dir}，GitHub 自动识别 README 文件名
 * - Skill：在目录树里找 <skill>/SKILL.md（每个仓库只取一次目录树），目录名对不上时比对元数据里的 name；
 *   上次抓到过就直接按路径取
 * 上次成功时的 ETag 用于条件请求，没有变化返回 not_modified。
 */
export class GithubReadmeFetcher {
  private readonly trees = new Map<string, Promise<string[] | null>>()
  private readonly files = new Map<string, Promise<GithubResponse<ContentFile>>>()

  constructor(private readonly client: Pick<GithubClient, 'get'>) {}

  async fetch(subject: ReadmeSubject, prev?: { etag: string | null; path: string | null }, signal?: AbortSignal): Promise<ReadmeFetchResult> {
    const repo = `/repos/${encodeURIComponent(subject.owner)}/${encodeURIComponent(subject.name)}`
    if (!subject.skill) {
      const res = await this.client.get<ContentFile>(`${repo}/readme${subject.dir ? '/' + encodePath(subject.dir) : ''}`, { etag: prev?.etag ?? undefined, signal })
      return toResult(res, subject)
    }
    if (prev?.path) {
      const res = await this.client.get<ContentFile>(`${repo}/contents/${encodePath(prev.path)}`, { etag: prev.etag ?? undefined, signal })
      // 文件被移动或删除时重新在目录树里找
      if (res.status === 200 || res.status === 304) return toResult(res, subject)
    }
    const files = await this.skillFiles(repo, signal)
    if (!files) return { status: 'not_found', httpStatus: 404, reason: '仓库不存在或无法访问' }
    const path = pickSkillFile(files, subject.skill, subject.name)
    const res = path ? await this.file(repo, path, signal) : await this.findByName(repo, files, subject.skill, signal)
    return res ? toResult(res, subject) : { status: 'not_found', httpStatus: 200, reason: `仓库里没有 name 为 ${subject.skill} 的 SKILL.md` }
  }

  /** 仓库里所有 SKILL.md 的路径；同一次运行内按仓库缓存 */
  private skillFiles(repo: string, signal?: AbortSignal): Promise<string[] | null> {
    let files = this.trees.get(repo)
    if (!files) {
      files = this.client.get<GitTree>(`${repo}/git/trees/HEAD?recursive=1`, { signal }).then((res) =>
        res.status === 200 && res.data ? res.data.tree.filter((e) => e.type === 'blob' && /(^|\/)SKILL\.md$/i.test(e.path)).map((e) => e.path) : null,
      )
      this.trees.set(repo, files)
      // 请求失败不缓存，下一个 Skill 重新取
      files.catch(() => this.trees.delete(repo))
    }
    return files
  }

  /** 目录名和 Skill 名不同（skills/react-best-practices 里的 vercel-react-best-practices）：读元数据里的 name 比对，名字相近的目录先试 */
  private async findByName(repo: string, files: string[], skill: string, signal?: AbortSignal): Promise<GithubResponse<ContentFile> | null> {
    const slug = skill.toLowerCase()
    const near = (p: string) => {
      const dir = p.split('/').at(-2)?.toLowerCase() ?? ''
      return !!dir && (slug.includes(dir) || dir.includes(slug))
    }
    const candidates = [...files].sort((a, b) => Number(near(b)) - Number(near(a))).slice(0, MAX_NAME_PROBES)
    for (const path of candidates) {
      const res = await this.file(repo, path, signal)
      if (res.status === 200 && res.data?.encoding === 'base64' && frontmatterName(decode(res.data))?.toLowerCase() === slug) return res
    }
    return null
  }

  /** 同一次运行内每个文件只取一次（同一仓库的多个 Skill 比对 name 时会重复用到） */
  private file(repo: string, path: string, signal?: AbortSignal): Promise<GithubResponse<ContentFile>> {
    const key = `${repo}/${path}`
    let res = this.files.get(key)
    if (!res) {
      res = this.client.get<ContentFile>(`${repo}/contents/${encodePath(path)}`, { signal })
      this.files.set(key, res)
      res.catch(() => this.files.delete(key))
    }
    return res
  }
}

function toResult(res: GithubResponse<ContentFile>, subject: ReadmeSubject): ReadmeFetchResult {
  if (res.status === 304) return { status: 'not_modified', etag: res.etag }
  const file = res.data
  if (res.status !== 200 || !file || file.type !== 'file') return { status: 'not_found', httpStatus: res.status, reason: subject.skill ? 'SKILL.md 不存在' : '仓库不存在或没有 README' }
  if (file.size > MAX_BYTES || file.encoding !== 'base64' || file.content === undefined) {
    return { status: 'too_large', httpStatus: res.status, reason: `${file.path} 共 ${file.size} 字节` }
  }
  const content = (subject.skill ? stripFrontmatter(decode(file)) : decode(file)).trim()
  if (!content) return { status: 'not_found', httpStatus: res.status, reason: `${file.path} 是空文件` }
  const repository = file.html_url?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\//)?.[1] ?? `${subject.owner}/${subject.name}`
  return {
    status: 'ok',
    etag: res.etag,
    readme: { repository, path: file.path, sha: file.sha, format: MARKDOWN_FILE.test(file.name) ? 'markdown' : 'plain', content },
  }
}
