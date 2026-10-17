import { sql } from 'drizzle-orm'
import type { EnvVarDraft, PackageDraft } from '../core/draft.ts'
import { npmKey, pypiKey } from '../core/identity.ts'
import type { Db } from '../db/client.ts'
import { PROBE_TOOLS_ENRICHER } from './tools-store.ts'

/*
 * 本地服务（stdio）工具列表实测的目标：发布层里还没有工具列表、有 npm / PyPI 安装包的服务，按安装包去重。
 * 生成目标要读数据库，实测在另一台没有数据库凭证的机器上跑（probe/sandbox.ts），两边通过 JSONL 文件交接。
 */

export interface ProbeTarget {
  /** npm:<包名> / pypi:<规范化包名>，同时是 ingest_enrichments 的主体键 */
  key: string
  registryType: 'npm' | 'pypi'
  /** 安装用的包名（不含版本） */
  name: string
  /** 只有官方 Registry 登记了版本时才固定版本，其余装最新版 */
  version?: string
  /** 启动时追加的参数（官方 Registry 的 packageArguments / runtimeArguments） */
  args: string[]
  /** PyPI：uvx --from 指定的安装规格（如 pypreset[mcp]）、--with 的额外依赖、-p 指定的 Python 版本 */
  installSpec?: string
  withSpecs?: string[]
  python?: string
  /** 必填环境变量的名字，实测时填假值 */
  env: string[]
  /** 使用这个包的条目中最高的星数，决定实测顺序 */
  stars: number | null
}

/** Registry 的参数定义（server.json 的 packageArguments / runtimeArguments 元素） */
interface RegistryArgument {
  type?: string
  name?: string
  value?: unknown
  default?: unknown
}

/** 参数里的 {占位符} 换成临时目录：多数是路径（{project_dir}），实测只要能启动 */
const PLACEHOLDER = /\{[^}]+\}/g

/** 参数定义 → 命令行片段；只取有固定值或默认值的，需要用户填写的跳过 */
export function argumentTokens(args: unknown): string[] {
  if (!Array.isArray(args)) return []
  const out: string[] = []
  for (const arg of args as RegistryArgument[]) {
    const raw = arg?.value ?? arg?.default
    const value = typeof raw === 'string' || typeof raw === 'number' ? String(raw).replace(PLACEHOLDER, '/tmp') : undefined
    if (arg?.type === 'named' && typeof arg.name === 'string' && arg.name.startsWith('-')) {
      if (value !== undefined) out.push(arg.name, value)
    } else if (value !== undefined) {
      out.push(value)
    }
  }
  return out
}

export interface PypiLaunch {
  installSpec?: string
  withSpecs: string[]
  python?: string
  args: string[]
}

/**
 * uvx 的运行参数：命令之前是 uv 自己的选项（--from、--with、-p），第一个位置参数起全部交给服务。
 * 发布者常把子命令写进 runtimeArguments（serena：-p 3.13 start-mcp-server --project-from-cwd）。
 */
export function parseUvxArguments(tokens: string[]): PypiLaunch {
  const launch: PypiLaunch = { withSpecs: [], args: [] }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    const [flag, inline] = token.startsWith('--') && token.includes('=') ? [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)] : [token, undefined]
    const next = () => inline ?? tokens[++i]
    if (flag === '--from') launch.installSpec = next()
    else if (flag === '--with') launch.withSpecs.push(next() ?? '')
    else if (flag === '-p' || flag === '--python') launch.python = next()
    else if (flag.startsWith('-')) continue
    else {
      launch.args = tokens.slice(i)
      break
    }
  }
  launch.withSpecs = launch.withSpecs.filter(Boolean)
  return launch
}

/** 包键 → 官方 Registry 登记的启动方式；同一个包登记了多次时取有参数的那条 */
async function registryLaunches(db: Db): Promise<Map<string, { version?: string; runtime: string[]; pkg: string[] }>> {
  const [rows] = (await db.execute(sql`
    SELECT JSON_EXTRACT(data, '$.server.packages') AS packages
    FROM ingest_records WHERE source_id = 'mcp-registry' AND kind = 'server'`)) as unknown as [{ packages: unknown }[]]
  const out = new Map<string, { version?: string; runtime: string[]; pkg: string[] }>()
  for (const row of rows) {
    const packages = (typeof row.packages === 'string' ? JSON.parse(row.packages) : row.packages) as Record<string, unknown>[] | null
    for (const p of packages ?? []) {
      const type = String(p.registryType ?? '').toLowerCase()
      const key = type === 'npm' ? npmKey(String(p.identifier ?? '')) : type === 'pypi' ? pypiKey(String(p.identifier ?? '')) : undefined
      if (!key) continue
      const launch = { version: typeof p.version === 'string' ? p.version : undefined, runtime: argumentTokens(p.runtimeArguments), pkg: argumentTokens(p.packageArguments) }
      const prev = out.get(key)
      if (!prev || (prev.runtime.length + prev.pkg.length === 0 && launch.runtime.length + launch.pkg.length > 0)) out.set(key, launch)
    }
  }
  return out
}

/** "@a/b@1.2" → @a/b；"pkg==1.0" / "pkg@latest" / "pkg[extra]" → pkg */
export function packageName(pkg: Pick<PackageDraft, 'registryType' | 'identifier'>): string {
  const id = pkg.identifier.trim()
  return pkg.registryType === 'npm' ? id.replace(/(.)@[^/]*$/, '$1') : id.split(/[@=<>~!;[\s]/)[0]!
}

/** 收集实测目标；未过期的实测结果（成功或失败）不再重测 */
export async function collectProbeTargets(db: Db, options: { minStars?: number } = {}): Promise<ProbeTarget[]> {
  const [rows] = (await db.execute(sql`
    SELECT s.pop_rank AS popRank, JSON_EXTRACT(d.draft, '$.detail.packages') AS packages, JSON_EXTRACT(d.draft, '$.detail.envVars') AS envVars
    FROM ingest_published d
    LEFT JOIN ingest_search s ON s.kind = d.kind AND s.locale = 'en' AND s.slug = d.slug
    WHERE d.kind = 'server'
      AND COALESCE(JSON_EXTRACT(d.draft, '$.detail.isRemote') = true, 0) = 0
      AND COALESCE(JSON_LENGTH(d.draft, '$.detail.tools'), 0) = 0
      AND JSON_LENGTH(d.draft, '$.detail.packages') > 0
      ${options.minStars ? sql`AND s.pop_rank <= ${-options.minStars}` : sql``}`)) as unknown as [{ popRank: number | null; packages: unknown; envVars: unknown }[]]
  const [fresh] = (await db.execute(sql`
    SELECT subject_key AS subjectKey FROM ingest_enrichments
    WHERE enricher = ${PROBE_TOOLS_ENRICHER} AND (expires_at IS NULL OR expires_at > NOW())`)) as unknown as [{ subjectKey: string }[]]
  const skip = new Set(fresh.map((r) => r.subjectKey))
  const launches = await registryLaunches(db)

  const json = <T>(value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value) as T
  const targets = new Map<string, ProbeTarget>()
  for (const row of rows) {
    const stars = row.popRank === null ? null : -Number(row.popRank)
    const env = (json<EnvVarDraft[] | null>(row.envVars) ?? []).filter((e) => e.required).map((e) => e.name)
    for (const pkg of json<PackageDraft[] | null>(row.packages) ?? []) {
      if (pkg.registryType !== 'npm' && pkg.registryType !== 'pypi') continue
      const key = pkg.registryType === 'npm' ? npmKey(pkg.identifier) : pypiKey(pkg.identifier)
      if (!key || skip.has(key)) continue
      const existing = targets.get(key)
      if (existing) {
        existing.env = [...new Set([...existing.env, ...env])]
        if (stars !== null && (existing.stars === null || stars > existing.stars)) existing.stars = stars
        continue
      }
      const launch = launches.get(key)
      const target: ProbeTarget = { key, registryType: pkg.registryType, name: packageName(pkg), args: [], env, stars }
      if (launch?.version) target.version = launch.version
      if (pkg.registryType === 'pypi') {
        const uvx = parseUvxArguments(launch?.runtime ?? [])
        if (uvx.installSpec) target.installSpec = uvx.installSpec
        if (uvx.withSpecs.length) target.withSpecs = uvx.withSpecs
        if (uvx.python) target.python = uvx.python
        target.args = [...uvx.args, ...(launch?.pkg ?? [])]
      } else {
        // npx 的运行参数（-y、--package=…）是给 npx 的，只取服务自己的参数
        target.args = launch?.pkg ?? []
      }
      targets.set(key, target)
    }
  }
  return [...targets.values()].sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1) || a.key.localeCompare(b.key))
}
