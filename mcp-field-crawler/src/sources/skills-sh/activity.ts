import { and, eq, inArray, sql } from 'drizzle-orm'
import type { EntityDraft } from '../../core/draft.ts'
import type { Db } from '../../db/client.ts'
import { ingestEnrichments } from '../../db/schema/index.ts'
import { REPO_ENRICHER } from '../../github/store.ts'

/** 排行榜给出的安装量，存在 ingest_enrichments（enricher = skills_sh_installs，一个 Skill 一行，主体是 skill:来源 ID） */
export const INSTALLS_ENRICHER = 'skills_sh_installs'
export const SKILLS_SH_SOURCE = 'skills-sh'

const CHUNK = 1000
/** subject_key 列的长度上限 */
const MAX_KEY_LENGTH = 255

const subjectKey = (externalId: string) => `skill:${externalId}`

export interface ListedInstalls {
  installs: number
  /** YYYY-MM-DD */
  observedOn: string
}

/** 发现器用到的补充数据：仓库推送时间决定哪些 Skill 要重新抓，排行榜的安装量每天记下 */
export interface SkillsShActivity {
  /** GitHub 仓库最近一次推送的时间（github 命令每天更新），键是 repo:github.com/owner/name */
  repoPushedAt(): Promise<Map<string, Date>>
  saveInstalls(installs: Map<string, number>): Promise<void>
}

export class SkillsShActivityStore implements SkillsShActivity {
  constructor(private readonly db: Db) {}

  async repoPushedAt(): Promise<Map<string, Date>> {
    const rows = await this.db
      .select({ key: ingestEnrichments.subjectKey, pushedAt: sql<string | null>`JSON_UNQUOTE(JSON_EXTRACT(${ingestEnrichments.data}, '$.pushedAt'))` })
      .from(ingestEnrichments)
      .where(and(eq(ingestEnrichments.enricher, REPO_ENRICHER), eq(ingestEnrichments.status, 'ok')))
    const out = new Map<string, Date>()
    for (const r of rows) {
      const at = r.pushedAt && r.pushedAt !== 'null' ? new Date(r.pushedAt) : null
      if (at && !Number.isNaN(at.getTime())) out.set(r.key, at)
    }
    return out
  }

  async saveInstalls(installs: Map<string, number>): Promise<void> {
    const fetchedAt = new Date()
    const data = { installs: 0, observedOn: fetchedAt.toISOString().slice(0, 10) }
    const rows = [...installs]
      .filter(([id]) => subjectKey(id).length <= MAX_KEY_LENGTH)
      .map(([id, n]) => ({ enricher: INSTALLS_ENRICHER, subjectKey: subjectKey(id), status: 'ok', httpStatus: 200, data: { ...data, installs: n }, fetchedAt }))
    for (let i = 0; i < rows.length; i += CHUNK) {
      await this.db
        .insert(ingestEnrichments)
        .values(rows.slice(i, i + CHUNK))
        .onDuplicateKeyUpdate({ set: { data: sql`VALUES(data)`, fetchedAt: sql`VALUES(fetched_at)` } })
    }
  }

  /** 按来源 ID 查排行榜安装量 */
  async find(externalIds: string[]): Promise<Map<string, ListedInstalls>> {
    const out = new Map<string, ListedInstalls>()
    const keys = [...new Set(externalIds.map(subjectKey))].filter((k) => k.length <= MAX_KEY_LENGTH)
    for (let i = 0; i < keys.length; i += CHUNK) {
      const rows = await this.db
        .select({ key: ingestEnrichments.subjectKey, data: ingestEnrichments.data })
        .from(ingestEnrichments)
        .where(and(eq(ingestEnrichments.enricher, INSTALLS_ENRICHER), inArray(ingestEnrichments.subjectKey, keys.slice(i, i + CHUNK))))
      for (const r of rows) {
        const data = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as ListedInstalls | null
        if (data) out.set(r.key.slice('skill:'.length), data)
      }
    }
    return out
  }
}

/**
 * 发布时用排行榜的安装量更新 Skill：已收录的 Skill 不是每天都重新抓详情，安装量以每天翻的排行榜为准。
 * 与合并规则一致取较大值（安装量是只增不减的累计值）。
 */
export function applyListedInstalls(draft: EntityDraft, externalIds: string[], listed: Map<string, ListedInstalls>): void {
  const best = externalIds.map((id) => listed.get(id)).reduce<ListedInstalls | undefined>((a, b) => (b && (!a || b.installs > a.installs) ? b : a), undefined)
  if (!best) return
  const current = draft.metrics.find((m) => m.metric === 'skill_installs' && m.period === 'total')
  if (current && current.value >= best.installs) return
  draft.metrics = [...draft.metrics.filter((m) => m !== current), { metric: 'skill_installs', period: 'total', value: best.installs, observedOn: best.observedOn }]
}
