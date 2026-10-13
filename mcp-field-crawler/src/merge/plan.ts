import type { IdentityHints } from '../core/draft.ts'
import { identityKeys, type IdentityKey, type IdentityKeyType } from '../core/identity.ts'
import type { EntityKind } from '../core/types.ts'

/*
 * 合并预演：算出"哪些草稿是同一个东西"，不写任何数据。
 *
 * 规则（详见 docs/DESIGN.md 第 6 节）：
 * - 只在同一类型内合并；同一强键跨类型出现记为"相关"。
 * - 强键相同才合并，按可信度依次处理：Skill 键 > 仓库 > Registry 名称 > npm > PyPI > 远程地址。
 * - 一个键连接的各组之间如果有冲突（仓库不同、包名不同……），这个键整体不用于合并，记为"有歧义的键"。
 *   这样一个被很多仓库引用的包（教程、fork 里写的 npx @modelcontextprotocol/server-filesystem）不会把它们串成一组。
 * - 弱键（官网）只提示可能重复，不自动合并。
 */

export interface MergeItem {
  draftId: number
  sourceId: string
  kind: EntityKind
  externalId: string
  slug: string
  name: string
  identity: IdentityHints
}

export interface MergeMember {
  draftId: number
  sourceId: string
  externalId: string
  slug: string
  name: string
}

export interface MergeGroup {
  kind: EntityKind
  /** 合并后实体的身份键：成员强键中可信度最高、出现最多的一个；没有强键时为 source:来源/类型/ID */
  key: string
  members: MergeMember[]
  /** 成员的全部强键 */
  keys: string[]
  /** 成员的全部弱键 */
  weakKeys: string[]
  sources: string[]
}

export interface AmbiguousKey {
  kind: EntityKind
  key: string
  reason: string
  /** 这个键连接的各组的身份键 */
  groups: string[]
}

export interface Suggestion {
  kind: EntityKind
  /** 相同的弱键 */
  key: string
  groups: string[]
}

export interface Related {
  key: string
  entries: { kind: EntityKind; group: string }[]
}

export interface MergePlan {
  groups: MergeGroup[]
  ambiguous: AmbiguousKey[]
  suggestions: Suggestion[]
  related: Related[]
}

/** 强键依次参与合并的顺序 */
const LINK_ORDER: IdentityKeyType[] = ['skill', 'repo', 'registry', 'npm', 'pypi', 'remote']
/** 一个实体只能有一个取值的键类型：两组各有取值且没有交集，说明是两个东西 */
const EXCLUSIVE: IdentityKeyType[] = ['skill', 'repo', 'registry', 'npm', 'pypi']

const typeOf = (key: string) => key.slice(0, key.indexOf(':')) as IdentityKeyType

/** 仓库根目录与它的子目录不算冲突：mcp.so 常把 monorepo 里的服务链接到仓库根目录 */
const repoCompatible = (a: string, b: string) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/')

class Groups {
  private readonly parent: number[]
  /** 每个根节点汇总的排他键，key 为类型 */
  private readonly exclusive: Map<IdentityKeyType, Set<string>>[]

  constructor(keys: IdentityKey[][]) {
    this.parent = keys.map((_, i) => i)
    this.exclusive = keys.map((list) => {
      const map = new Map<IdentityKeyType, Set<string>>()
      for (const k of list) {
        if (!k.strong || !EXCLUSIVE.includes(k.type)) continue
        if (!map.has(k.type)) map.set(k.type, new Set())
        map.get(k.type)!.add(k.key)
      }
      return map
    })
  }

  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!
      i = this.parent[i]!
    }
    return i
  }

  /** 两组能否合并；不能时返回原因 */
  conflict(a: number, b: number): string | null {
    const x = this.exclusive[a]!
    const y = this.exclusive[b]!
    for (const type of EXCLUSIVE) {
      const xs = x.get(type)
      const ys = y.get(type)
      if (!xs || !ys) continue
      const ok =
        type === 'repo'
          ? [...xs].every((p) => [...ys].every((q) => repoCompatible(p, q)))
          : [...xs].some((v) => ys.has(v))
      if (!ok) return `${type} 不同：${[...xs].join(', ')} ≠ ${[...ys].join(', ')}`
    }
    return null
  }

  union(a: number, b: number): void {
    this.parent[b] = a
    for (const [type, values] of this.exclusive[b]!) {
      if (!this.exclusive[a]!.has(type)) this.exclusive[a]!.set(type, new Set())
      values.forEach((v) => this.exclusive[a]!.get(type)!.add(v))
    }
  }
}

/**
 * 合并后实体的身份键：只从本组独有的强键里选（被歧义键连着的几组可能共用一个仓库键），
 * 按可信度、出现次数、字母序；没有独有强键时用 source:来源/类型/ID，保证同一类型内唯一。
 */
function groupKey(kind: EntityKind, members: { item: MergeItem; keys: IdentityKey[] }[], holders: Map<string, number>): string {
  const counts = new Map<string, number>()
  for (const m of members) for (const k of m.keys) if (k.strong && holders.get(k.key) === 1) counts.set(k.key, (counts.get(k.key) ?? 0) + 1)
  const best = [...counts].sort(
    ([a, na], [b, nb]) => LINK_ORDER.indexOf(typeOf(a)) - LINK_ORDER.indexOf(typeOf(b)) || nb - na || a.localeCompare(b),
  )[0]
  if (best) return best[0]
  const first = members.map((m) => m.item).sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.externalId.localeCompare(b.externalId))[0]!
  return `source:${first.sourceId}/${kind}/${first.externalId}`
}

/** repo:github.com/owner/name/src/x → repo:github.com/owner/name */
const repoRoot = (key: string) => key.split('/').slice(0, 3).join('/')

function planKind(kind: EntityKind, items: MergeItem[]): Omit<MergePlan, 'related'> {
  const keys = items.map((item) => identityKeys(item.identity))
  const groups = new Groups(keys)
  const ambiguous: { key: string; reason: string; roots: number[] }[] = []

  const byKey = new Map<string, number[]>()
  keys.forEach((list, i) => {
    for (const k of list) {
      if (!k.strong) continue
      if (!byKey.has(k.key)) byKey.set(k.key, [])
      byKey.get(k.key)!.push(i)
    }
  })
  // 有条目指向子目录的仓库是 monorepo：根目录常被多个服务共用（awslabs/mcp），根目录键不用于合并
  const monorepos = new Set<string>()
  for (const key of byKey.keys()) if (typeOf(key) === 'repo' && repoRoot(key) !== key) monorepos.add(repoRoot(key))

  const ordered = [...byKey].sort(([a], [b]) => LINK_ORDER.indexOf(typeOf(a)) - LINK_ORDER.indexOf(typeOf(b)) || a.localeCompare(b))

  for (const [key, indexes] of ordered) {
    const roots = [...new Set(indexes.map((i) => groups.find(i)))]
    if (roots.length < 2) continue
    let reason: string | null = monorepos.has(key) ? 'monorepo 根目录：仓库里另有子目录条目，根目录可能被多个服务共用' : null
    for (let i = 0; i < roots.length && !reason; i++) {
      for (let j = i + 1; j < roots.length && !reason; j++) reason = groups.conflict(roots[i]!, roots[j]!)
    }
    if (reason) {
      ambiguous.push({ key, reason, roots })
      continue
    }
    for (const root of roots.slice(1)) groups.union(roots[0]!, root)
  }

  const byRoot = new Map<number, { item: MergeItem; keys: IdentityKey[] }[]>()
  items.forEach((item, i) => {
    const root = groups.find(i)
    if (!byRoot.has(root)) byRoot.set(root, [])
    byRoot.get(root)!.push({ item, keys: keys[i]! })
  })

  const holders = new Map<string, number>()
  for (const members of byRoot.values()) {
    for (const key of new Set(members.flatMap((m) => m.keys.filter((k) => k.strong).map((k) => k.key)))) holders.set(key, (holders.get(key) ?? 0) + 1)
  }

  const keyOfRoot = new Map<number, string>()
  const result: MergeGroup[] = []
  for (const [root, members] of byRoot) {
    const key = groupKey(kind, members, holders)
    keyOfRoot.set(root, key)
    const all = members.flatMap((m) => m.keys)
    result.push({
      kind,
      key,
      members: members.map(({ item }) => ({ draftId: item.draftId, sourceId: item.sourceId, externalId: item.externalId, slug: item.slug, name: item.name })),
      keys: [...new Set(all.filter((k) => k.strong).map((k) => k.key))],
      weakKeys: [...new Set(all.filter((k) => !k.strong).map((k) => k.key))],
      sources: [...new Set(members.map((m) => m.item.sourceId))],
    })
  }

  // 弱键提示：只用官网。Skill 的仓库也是弱键，但同一仓库里本来就有很多 Skill，不提示
  const bySite = new Map<string, Set<string>>()
  for (const g of result) {
    for (const key of g.weakKeys) {
      if (typeOf(key) !== 'site') continue
      if (!bySite.has(key)) bySite.set(key, new Set())
      bySite.get(key)!.add(g.key)
    }
  }
  const suggestions = [...bySite].filter(([, set]) => set.size > 1).map(([key, set]) => ({ kind, key, groups: [...set] }))

  return {
    groups: result,
    // 合并完成后再取身份键：歧义记录里的组可能后来被其他键合并了
    ambiguous: ambiguous.map((a) => ({ kind, key: a.key, reason: a.reason, groups: [...new Set(a.roots.map((r) => keyOfRoot.get(groups.find(r))!))] })),
    suggestions,
  }
}

export function planMerge(items: MergeItem[]): MergePlan {
  const byKind = new Map<EntityKind, MergeItem[]>()
  for (const item of items) {
    if (!byKind.has(item.kind)) byKind.set(item.kind, [])
    byKind.get(item.kind)!.push(item)
  }

  const plan: MergePlan = { groups: [], ambiguous: [], suggestions: [], related: [] }
  for (const [kind, list] of byKind) {
    const part = planKind(kind, list)
    plan.groups.push(...part.groups)
    plan.ambiguous.push(...part.ambiguous)
    plan.suggestions.push(...part.suggestions)
  }

  // 跨类型：同一强键出现在不同类型的组里（例如同一仓库既有 CLI 又有 MCP 服务）
  const byKey = new Map<string, Map<EntityKind, string>>()
  for (const g of plan.groups) {
    for (const key of g.keys) {
      if (!byKey.has(key)) byKey.set(key, new Map())
      byKey.get(key)!.set(g.kind, g.key)
    }
  }
  plan.related = [...byKey]
    .filter(([, kinds]) => kinds.size > 1)
    .map(([key, kinds]) => ({ key, entries: [...kinds].map(([kind, group]) => ({ kind, group })) }))
  return plan
}
