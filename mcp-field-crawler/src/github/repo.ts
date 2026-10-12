import type { IdentityHints } from '../core/draft.ts'
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
  defaultBranchRef: { target: { committedDate?: string } | null } | null
}

const FIELDS = 'nameWithOwner stargazerCount forkCount isArchived pushedAt defaultBranchRef { target { ... on Commit { committedDate } } }'

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
  }
}
