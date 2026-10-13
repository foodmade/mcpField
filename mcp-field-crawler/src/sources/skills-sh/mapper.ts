import { DraftBuilder } from '../../core/draft-builder.ts'
import type { EntityDraft, SkillAuditDraft } from '../../core/draft.ts'
import { parseRepositoryUrl } from '../../core/identity.ts'
import type { Mapper } from '../../core/source.ts'
import type { SourceRecord } from '../../core/types.ts'
import type { SkillsShAudit, SkillsShRecord } from './schema.ts'

/*
 * skills.sh 源记录 → Skill 草稿。
 * 只取事实：名称和简介来自 SKILL.md 的元数据（作者自己写的），安装量、安全审计来自 skills.sh。
 * SKILL.md 全文不进草稿，由 github 命令导入为该 Skill 的 README（见 skills-sh/readme.ts），不占 GitHub 额度。
 */

/** SKILL.md 开头 YAML 元数据里的简单字段：支持单行值、引号和 | / > 多行块 */
export function frontmatterField(markdown: string | null, field: string): string | null {
  const meta = markdown?.match(/^---\n([\s\S]*?)\n---/)?.[1]
  if (!meta) return null
  const lines = meta.split('\n')
  const i = lines.findIndex((l) => new RegExp(`^${field}:`).test(l))
  if (i < 0) return null
  const inline = lines[i]!.slice(field.length + 1).trim()
  if (inline && !/^[|>][-+]?$/.test(inline)) return inline.replace(/^(["'])([\s\S]*)\1$/, '$2').trim() || null
  const block: string[] = []
  for (const line of lines.slice(i + 1)) {
    if (line && !/^\s/.test(line)) break
    block.push(line.trim())
  }
  const text = inline.startsWith('|') ? block.join('\n') : block.join(' ')
  return text.replace(/\s+\n/g, '\n').trim() || null
}

function toAudit(a: SkillsShAudit): SkillAuditDraft {
  const status = a.status?.toLowerCase() ?? ''
  const result = status.startsWith('pass') ? 'pass' : status.startsWith('fail') ? 'fail' : status.startsWith('warn') ? 'warn' : 'unknown'
  return {
    auditor: a.provider,
    result,
    ...(a.riskLevel ? { riskLevel: a.riskLevel } : {}),
    ...(a.summary?.trim() ? { summary: a.summary.trim() } : {}),
    ...(a.categories?.length ? { categories: a.categories } : {}),
    ...(a.auditedAt ? { auditedAt: a.auditedAt } : {}),
  }
}

function mapSkill(record: SourceRecord<SkillsShRecord>): EntityDraft {
  const { listing, skillMd, installs, audits, files } = record.data
  const { source, slug } = listing
  const github = listing.sourceType !== 'well-known' && source.includes('/')
  const home = github ? `https://github.com/${source}` : `https://${source}`
  const skillKey = `${source}#${slug}`
  const b = new DraftBuilder(
    { kind: 'skill', sourceId: record.sourceId, externalId: record.externalId, sourceUrl: listing.url ?? record.url, slug, name: frontmatterField(skillMd, 'name') ?? listing.name ?? slug },
    { canonicalKey: skillKey, skillSlug: slug, installCommand: `npx skills add ${home} --skill ${slug}`, audits: audits.map(toAudit), files: files.slice(0, 200) },
  )
  b.identity({ skillKey, repository: github ? parseRepositoryUrl(home) : undefined, website: github ? undefined : home })
    .text('description', 'en', frontmatterField(skillMd, 'description'))
    .link('repository', github ? home : undefined)
    .link('website', github ? undefined : home)
    .link('source', listing.url)
    .author(github ? { platform: 'github', login: source.split('/')[0], url: `https://github.com/${source.split('/')[0]}`, role: 'owner' } : { platform: 'website', login: source, url: home, role: 'publisher' })
    .metric('skill_installs', installs)
  return b.build()
}

export class SkillsShMapper implements Mapper<SkillsShRecord> {
  /** 2：带上随 Skill 分发的文件列表 */
  readonly version = 2

  map(record: SourceRecord<SkillsShRecord>): EntityDraft {
    return mapSkill(record)
  }
}
