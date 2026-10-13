import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../../db/client.ts'
import { ingestRecords } from '../../db/schema/index.ts'
import { stripFrontmatter, type GithubReadme, type ReadmeSubject } from '../../github/readme.ts'
import type { GithubReadmeStore } from '../../github/store.ts'
import type { SkillsShRecord } from './schema.ts'

/** 导入的 SKILL.md 下次检查前的有效期：每次 github 命令都会重新导入并顺延，GitHub 就不会再去请求它 */
const VALID_MS = 8 * 24 * 3600_000
/** 记在 etag 列里，内容没变（哈希相同）且还在有效期内的不重复写 */
const marker = (hash: string) => `skills.sh:${hash}`

/**
 * 把 skills.sh 记录里的 SKILL.md 写成对应 Skill 的 README（与 GitHub 抓取的存在同一处）。
 * skills.sh 的详情接口直接给出 SKILL.md，比按仓库翻 GitHub 目录树快得多，也不占 GitHub 额度（5,000 次/小时，与线上共用）。
 */
export async function importSkillsShReadmes(
  db: Db,
  store: Pick<GithubReadmeStore, 'states' | 'saveOk'>,
  subjects: ReadmeSubject[],
): Promise<{ subjects: number; imported: number; unchanged: number }> {
  const skills = subjects.filter((s) => s.skill)
  const byExternal = new Map(skills.map((s) => [`${s.owner}/${s.name}/${s.skill}`.toLowerCase(), s]))
  const stats = { subjects: skills.length, imported: 0, unchanged: 0 }
  const ids = [...byExternal.keys()]
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select({ externalId: ingestRecords.externalId, data: ingestRecords.data })
      .from(ingestRecords)
      .where(and(eq(ingestRecords.sourceId, 'skills-sh'), eq(ingestRecords.kind, 'skill'), inArray(ingestRecords.externalId, ids.slice(i, i + 500))))
    const found = rows.flatMap((r) => {
      const data = r.data as SkillsShRecord
      const subject = byExternal.get(r.externalId.toLowerCase())
      return subject && data.skillMd ? [{ subject, data }] : []
    })
    const states = await store.states(found.map((f) => f.subject.key))
    const now = Date.now()
    for (const { subject, data } of found) {
      const hash = data.hash ?? String(data.skillMd!.length)
      const state = states.get(subject.key)
      if (state?.status === 'ok' && state.etag === marker(hash) && (state.expiresAt?.getTime() ?? 0) > now + 24 * 3600_000) {
        stats.unchanged++
        continue
      }
      // 与从 GitHub 抓取的 SKILL.md 一致：去掉开头的 YAML 元数据
      const readme: GithubReadme = { repository: data.listing.source, path: 'SKILL.md', sha: hash, format: 'markdown', content: stripFrontmatter(data.skillMd!).trim() }
      await store.saveOk(subject.key, readme, marker(hash), new Date(now + VALID_MS))
      stats.imported++
    }
  }
  return stats
}
