import { and, asc, gt, inArray } from 'drizzle-orm'
import type { EntityDraft, TextFormat } from '../core/draft.ts'
import type { EntityKind } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { ingestPublished } from '../db/schema/index.ts'
import { readmeSubject, type GithubReadme } from '../github/readme.ts'
import { repoRef } from '../github/repo.ts'
import { GithubReadmeStore, GithubRepoStore, type GithubReadmeReader, type GithubRepoReader } from '../github/store.ts'

/*
 * README 只用从 GitHub 抓取的原文（见 github/）。源站收录的 README（mcp.so 的 description）
 * 往往是收录时的旧快照或只有一句话，仍保留在草稿里，但不再展示、翻译或用来生成介绍。
 * 接口详情、README 翻译、AI 介绍都从这里取。
 */

export interface ResolvedReadme {
  content: string
  format: TextFormat
  /** README 所在目录的页面地址（https://github.com/o/r/blob/HEAD/dir/），用来解析相对链接 */
  baseUrl: string
}

export function resolveReadme(github: GithubReadme | undefined): ResolvedReadme | null {
  if (!github) return null
  const dir = github.path.split('/').slice(0, -1).map(encodeURIComponent).join('/')
  return { content: github.content, format: github.format, baseUrl: `https://github.com/${github.repository}/blob/HEAD/${dir ? dir + '/' : ''}` }
}

/**
 * 分页读取发布层的条目（合并后、已过滤凑数的），附上该条目的 GitHub README 和星数（GitHub 的优先，没有时用源站的；
 * 用于 --min-stars 筛选和热门模型分档，CLI 等源站没有星数的条目也能按热度处理）
 */
export async function* draftsWithReadme(
  db: Db,
  kinds: readonly EntityKind[],
  readers: { readmes: GithubReadmeReader; repos: GithubRepoReader } = { readmes: new GithubReadmeStore(db), repos: new GithubRepoStore(db) },
): AsyncGenerator<{ draft: EntityDraft; readme: ResolvedReadme | null; stars: number | null }> {
  let lastId = 0
  for (;;) {
    const rows = await db
      .select({ id: ingestPublished.id, draft: ingestPublished.draft })
      .from(ingestPublished)
      .where(and(inArray(ingestPublished.kind, [...kinds]), gt(ingestPublished.id, lastId)))
      .orderBy(asc(ingestPublished.id))
      .limit(200)
    if (rows.length === 0) return
    const drafts = rows.map((r) => r.draft as EntityDraft)
    const subjects = drafts.map(readmeSubject)
    const repos = drafts.map(repoRef)
    const [found, stats] = await Promise.all([
      readers.readmes.find(subjects.flatMap((s) => (s ? [s.key] : []))),
      readers.repos.find(repos.flatMap((r) => (r ? [r.key] : []))),
    ])
    for (const [i, draft] of drafts.entries()) {
      const subject = subjects[i]
      const stars = stats.get(repos[i]?.key ?? '')?.stars ?? draft.metrics.find((m) => m.metric === 'github_stars')?.value ?? null
      yield { draft, readme: resolveReadme(subject ? found.get(subject.key) : undefined), stars }
    }
    lastId = rows.at(-1)!.id
  }
}
