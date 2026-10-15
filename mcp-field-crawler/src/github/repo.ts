import type { EntityDraft, IdentityHints } from '../core/draft.ts'
import { DESCRIBE_KINDS } from '../describe/types.ts'
import type { GithubClient } from './client.ts'

/** 仓库统计，存在 ingest_enrichments.data 里（enricher = github_repo） */
export interface RepoStats {
  /** 仓库全名，大小写以 GitHub 为准；仓库改名后是新名字 */
  repository: string
  stars: number
  forks: number
  archived: boolean
  /** 默认分支最新一次提交的时间 */
  lastCommitAt: string | null
  /** 最近一次推送（任何分支） */
  pushedAt: string | null
  /** 仓库简介（About）；2026-10-14 之前抓的记录没有这个字段 */
  description?: string | null
}

/** 仓库统计的主体：repo:github.com/owner/name，不含子目录，monorepo 里的条目共用一份 */
export interface RepoRef {
  key: string
  owner: string
  name: string
}

export function repoRef(d: { identity: IdentityHints }): RepoRef | null {
  const repo = d.identity.repository
  if (!repo || repo.host !== 'github.com') return null
  return { key: `repo:github.com/${repo.owner}/${repo.name}`, owner: repo.owner, name: repo.name }
}

interface RepoNode {
  nameWithOwner: string
  stargazerCount: number
  forkCount: number
  isArchived: boolean
  pushedAt: string | null
  description: string | null
  defaultBranchRef: { target: { committedDate?: string } | null } | null
}

const FIELDS = 'nameWithOwner stargazerCount forkCount isArchived pushedAt description defaultBranchRef { target { ... on Commit { committedDate } } }'

/** 用 GraphQL 一次查一批仓库（每批约消耗 1 点额度）；不存在或无法访问的仓库返回 null */
export class GithubRepoFetcher {
  constructor(private readonly client: Pick<GithubClient, 'graphql'>) {}

  async fetch(repos: RepoRef[], signal?: AbortSignal): Promise<Map<string, RepoStats | null>> {
    const variables: Record<string, string> = {}
    const params: string[] = []
    const fields = repos.map((r, i) => {
      variables[`o${i}`] = r.owner
      variables[`n${i}`] = r.name
      params.push(`$o${i}: String!, $n${i}: String!`)
      return `r${i}: repository(owner: $o${i}, name: $n${i}) { ${FIELDS} }`
    })
    const { data, errors } = await this.client.graphql<Record<string, RepoNode | null>>(`query(${params.join(', ')}) {\n${fields.join('\n')}\n}`, variables, signal)
    // 整个查询失败（超时、限流等）时没有 data，整批算失败稍后重试；单个仓库不存在只影响它自己
    if (!data) throw new Error(`GraphQL 查询失败：${errors.map((e) => e.message).join('; ').slice(0, 500)}`)
    return new Map(repos.map((r, i) => [r.key, toStats(data[`r${i}`])]))
  }
}

function toStats(node: RepoNode | null | undefined): RepoStats | null {
  if (!node) return null
  return {
    repository: node.nameWithOwner,
    stars: node.stargazerCount,
    forks: node.forkCount,
    archived: node.isArchived,
    lastCommitAt: node.defaultBranchRef?.target?.committedDate ?? null,
    pushedAt: node.pushedAt,
    description: node.description?.trim() || null,
  }
}

/** 简介里的 GitHub emoji 短代码（:rocket:）在别处显示不出来，去掉 */
const cleanDescription = (value: string) => value.replace(/:[a-z0-9_+-]+:/g, ' ').replace(/\s+/g, ' ').trim()

/** 是否缺简介：没有 tagline 也没有 description（Skill 只有 description） */
export const lacksTagline = (draft: EntityDraft) => !draft.texts.some((t) => (t.field === 'tagline' || t.field === 'description') && t.content.trim())

/**
 * 源站没有简介的条目用 GitHub 仓库简介（mcp.so 上 microsoft/vscode 等约 3,000 个服务没有简介）；返回是否改动。
 * Loop / CLI / Agent 的简介由 describe 撰写，不用仓库简介。
 */
export function applyRepoDescription(draft: EntityDraft, stats: Pick<RepoStats, 'description'> | undefined): boolean {
  if ((DESCRIBE_KINDS as readonly string[]).includes(draft.kind) || !lacksTagline(draft)) return false
  const content = stats?.description ? cleanDescription(stats.description) : ''
  if (!content) return false
  draft.texts = [{ field: 'tagline', locale: 'en', content, format: 'plain' }, ...draft.texts]
  return true
}
