#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { resolve } from 'node:path'
import { z } from 'zod'
import { api, ApiError, DEFAULT_LOCALE, KEYS_URL, LOCALES, pageUrl, SITE, VERSION, type Kind } from './api.js'
import { buildConfig, CLIENT_LABELS, CLIENTS, type Client, type ServerInfo } from './config.js'
import { agentFromClient, COMMON_AGENTS, installArgs, riskyAudits, runInstall, skillSource, type Audit } from './skills.js'

/*
 * MCP Field 的 MCP 服务（stdio）：在 Agent 里搜索 MCP 服务和 Skill、管理收藏、把 Skill 装进本机、生成 MCP 配置。
 * 收藏相关的工具要用 MCPFIELD_API_KEY（在 https://mcpfield.com/console/keys 创建）。
 */

const server = new McpServer(
  { name: 'mcpfield', version: VERSION },
  {
    instructions: [
      'MCP Field (mcpfield.com) is a directory of MCP servers and agent Skills. Use these tools to find servers and Skills, manage the user’s saved items (favorites), install Skills into local agents, and produce MCP config snippets.',
      'Typical flows: "install my saved Skills" → list_favorites (type: skill) then install_skill with their slugs; "find X and save it" → search then add_favorite; "set up a server in Codex" → get_mcp_config.',
      'Items are identified by type ("server" or "skill") plus slug, as returned by search and list_favorites.',
    ].join('\n'),
  },
)

/** Agent 的名称（MCP 握手时报上来的），转给网站记在「最近使用」里 */
const clientName = () => server.server.getClientVersion()?.name ?? null

type Item = { kind: Kind; slug: string; name: string; tagline: string | null; stars: number | null; installs?: number | null; author: { login: string; name: string | null } | null; official: boolean; verified: boolean }

/** 有的 Skill 简介很长，列表里只留前 200 字 */
const clip = (s: string, max = 200) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

function describe(item: Item): string {
  const stats = item.kind === 'skill' ? (item.installs != null ? `${compact(item.installs)} installs` : null) : item.stars != null ? `${compact(item.stars)} stars` : null
  const badges = [item.official && 'official', item.verified && 'verified'].filter(Boolean).join(', ')
  const by = item.author ? (item.author.name ?? item.author.login) : null
  return [
    `- [${item.kind}] ${item.name} (slug: ${item.slug})${by ? ` by ${by}` : ''}${stats ? ` · ${stats}` : ''}${badges ? ` · ${badges}` : ''}`,
    item.tagline ? `  ${clip(item.tagline)}` : null,
    `  ${pageUrl(item.kind, item.slug)}`,
  ]
    .filter(Boolean)
    .join('\n')
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })

/** 工具出错时把原因告诉 Agent（而不是抛异常让整个调用失败） */
async function run(fn: () => Promise<string>, notFound?: string) {
  try {
    return text(await fn())
  } catch (error) {
    const message = error instanceof ApiError ? (error.status === 404 && notFound ? notFound : error.message) : `Unexpected error: ${(error as Error).message}`
    return { ...text(message), isError: true }
  }
}

const kindSchema = z.enum(['server', 'skill']).describe('"server" for an MCP server, "skill" for an agent Skill')
const localeSchema = z.enum(LOCALES).optional().describe(`Language for descriptions (default: ${DEFAULT_LOCALE})`)

server.registerTool(
  'search',
  {
    title: 'Search MCP Field',
    description: 'Search the MCP Field directory for MCP servers and/or agent Skills by keyword (name, purpose, technology). Results are sorted by popularity and include slugs for the other tools.',
    inputSchema: {
      query: z.string().min(1).max(100).describe('Keywords, e.g. "browser automation", "postgres", "pdf"'),
      type: z.enum(['server', 'skill', 'all']).default('all').describe('What to search'),
      limit: z.number().int().min(1).max(20).default(8).describe('Max results per type'),
      locale: localeSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  ({ query, type, limit, locale }) =>
    run(async () => {
      const kinds: Kind[] = type === 'all' ? ['server', 'skill'] : [type]
      const sections = await Promise.all(
        kinds.map(async (kind) => {
          const res = await api<{ data: Item[]; meta: { total: number | null } }>(`/${kind === 'server' ? 'servers' : 'skills'}`, { query: { q: query, pageSize: limit, locale: locale ?? DEFAULT_LOCALE } })
          const title = kind === 'server' ? 'MCP servers' : 'Skills'
          return res.data.length ? `${title}:\n${res.data.map(describe).join('\n')}` : `${title}: no matches.`
        }),
      )
      return sections.join('\n\n')
    }),
)

type Favorite = { kind: Kind; slug: string; name: string; favoritedAt: string; item: Item | null }

server.registerTool(
  'list_favorites',
  {
    title: 'List saved items',
    description: 'List the MCP servers and Skills the user saved on MCP Field (newest first). Requires MCPFIELD_API_KEY.',
    inputSchema: {
      type: z.enum(['server', 'skill', 'all']).default('all').describe('Filter by type'),
      locale: localeSchema,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  ({ type, locale }) =>
    run(async () => {
      const { data } = await api<{ data: Favorite[] }>('/favorites', { auth: true, client: clientName(), query: { locale: locale ?? DEFAULT_LOCALE } })
      const rows = data.filter((f) => type === 'all' || f.kind === type)
      if (rows.length === 0) return type === 'all' ? `No saved items yet. Save some with add_favorite or at ${SITE}.` : `No saved ${type === 'server' ? 'MCP servers' : 'Skills'}.`
      const lines = rows.map((f) => (f.item ? `${describe(f.item)}\n  saved ${f.favoritedAt.slice(0, 10)}` : `- [${f.kind}] ${f.name} (slug: ${f.slug}) · no longer listed on MCP Field · saved ${f.favoritedAt.slice(0, 10)}`))
      return `${rows.length} saved item(s):\n${lines.join('\n')}`
    }),
)

server.registerTool(
  'add_favorite',
  {
    title: 'Save an item',
    description: 'Save an MCP server or Skill to the user’s MCP Field favorites. Requires MCPFIELD_API_KEY.',
    inputSchema: { type: kindSchema, slug: z.string().min(1).max(191).describe('Slug from search results') },
    annotations: { idempotentHint: true, openWorldHint: true },
  },
  ({ type, slug }) =>
    run(async () => {
      const { data } = await api<{ data: { key: string } }>(`/favorites/${type}/${encodeURIComponent(slug)}`, { method: 'PUT', body: {}, auth: true, client: clientName() })
      const saved = data.key.slice(data.key.indexOf(':') + 1)
      return `Saved ${type} "${saved}" to favorites. ${pageUrl(type, saved)}`
    }, `No ${type} with slug "${slug}" on MCP Field. Use search to find the right slug.`),
)

server.registerTool(
  'remove_favorite',
  {
    title: 'Remove a saved item',
    description: 'Remove an MCP server or Skill from the user’s MCP Field favorites. Requires MCPFIELD_API_KEY.',
    inputSchema: { type: kindSchema, slug: z.string().min(1).max(191) },
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  ({ type, slug }) =>
    run(async () => {
      await api(`/favorites/${type}/${encodeURIComponent(slug)}`, { method: 'DELETE', auth: true, client: clientName() })
      return `Removed ${type} "${slug}" from favorites.`
    }),
)

type SkillDetail = Item & { installCommand: string | null; skillSlug: string | null; links: { repository: string | null }; audits?: Audit[] }

server.registerTool(
  'install_skill',
  {
    title: 'Install Skills',
    description: [
      'Install one or more Skills from MCP Field into local agents, using the skills.sh CLI (npx skills add). It downloads the Skill from its GitHub repository and places it in each agent’s Skills folder.',
      'If agents is omitted, installs for the agent running this MCP server when it can be recognised.',
      'Skills that failed a security audit are skipped unless allow_risky is true; only set it after the user has confirmed.',
    ].join(' '),
    inputSchema: {
      slugs: z.array(z.string().min(1).max(191)).min(1).max(20).describe('Skill slugs from search or list_favorites'),
      agents: z.array(z.string().regex(/^[a-z0-9-]+$/)).max(10).optional().describe(`Target agents, e.g. ${COMMON_AGENTS.slice(0, 6).join(', ')}`),
      scope: z.enum(['global', 'project']).default('global').describe('global: user-level folder (e.g. ~/.claude/skills); project: the project folder'),
      project_dir: z.string().optional().describe('Project folder for scope "project" (default: current working directory)'),
      allow_risky: z.boolean().default(false).describe('Install even if a security audit failed'),
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  },
  ({ slugs, agents, scope, project_dir, allow_risky }) =>
    run(async () => {
      const detected = agentFromClient(clientName())
      const targets = agents?.length ? agents : detected ? [detected] : null
      if (!targets) return `Could not tell which agent to install for (client: ${clientName() ?? 'unknown'}). Call install_skill again with agents, e.g. ["claude-code"].`
      const cwd = scope === 'project' ? resolve(project_dir ?? process.cwd()) : process.cwd()
      const report: string[] = []
      for (const slug of slugs) {
        let d: SkillDetail
        try {
          d = (await api<{ data: SkillDetail }>(`/skills/${encodeURIComponent(slug)}`)).data
        } catch (error) {
          report.push(`✗ ${slug}: ${error instanceof ApiError && error.status === 404 ? 'not found on MCP Field' : (error as Error).message}`)
          continue
        }
        const risky = riskyAudits(d.audits)
        if (risky.length && !allow_risky) {
          report.push(`⚠ ${d.name}: skipped, security audit flagged it (${risky.map((a) => `${a.auditor}: ${a.riskLevel ?? a.result}${a.summary ? ` – ${a.summary.slice(0, 160)}` : ''}`).join('; ')}). Ask the user, then retry with allow_risky: true.`)
          continue
        }
        const src = skillSource(d)
        if (!src) {
          report.push(`✗ ${d.name}: no install source listed. See ${pageUrl('skill', d.slug)}`)
          continue
        }
        const result = await runInstall(installArgs(src, targets, scope === 'global'), cwd)
        report.push(result.ok ? `✓ ${d.name} → ${targets.join(', ')} (${scope}${scope === 'project' ? `: ${cwd}` : ''})` : `✗ ${d.name}: install failed\n${result.output}`)
      }
      return `${report.join('\n')}\n\nRestart the agent (or start a new session) if newly installed Skills don’t show up.`
    }),
)

server.registerTool(
  'get_mcp_config',
  {
    title: 'Get MCP config',
    description: 'Generate the config (or install command) to add an MCP server from MCP Field to a client such as Claude Code, Codex, Gemini CLI, Cursor, VS Code, Claude Desktop or Windsurf. Returns the snippet and where it goes; it does not modify any files.',
    inputSchema: {
      slug: z.string().min(1).max(191).describe('MCP server slug from search or list_favorites'),
      client: z.enum(CLIENTS).optional().describe('Target client (default: the agent running this MCP server, if recognised)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  ({ slug, client }) =>
    run(async () => {
      const target = (client ?? agentFromClient(clientName())) as Client | null
      if (!target || !(CLIENTS as readonly string[]).includes(target)) return `Which client is this for? Call get_mcp_config again with client set to one of: ${CLIENTS.join(', ')}.`
      const { data: d } = await api<{ data: ServerInfo & { name: string } }>(`/servers/${encodeURIComponent(slug)}`).catch((error) => {
        if (error instanceof ApiError && error.status === 404) throw new ApiError(404, 'not_found', `No MCP server with slug "${slug}" on MCP Field. Use search to find the right slug.`)
        throw error
      })
      const config = buildConfig(d, target)
      if (!config) return `${d.name} has no install package or remote URL listed on MCP Field. Check its page for setup steps: ${pageUrl('server', d.slug)}`
      const where = target === 'claude-code' ? 'Run in a terminal:' : `Add to ${config.file}:`
      const env = config.envVars.length
        ? `\n\nFill in these environment variables:\n${config.envVars.map((e) => `- ${e.name}${e.required ? ' (required)' : ''}${e.secret ? ' (secret)' : ''}${e.description ? `: ${e.description}` : ''}`).join('\n')}`
        : ''
      const warn = config.unverifiedPackage ? '\n\nNote: the package listed for this server may not belong to it. Check the repository before installing.' : ''
      return `${d.name} for ${CLIENT_LABELS[target]} (${config.mode === 'remote' ? 'remote server' : 'runs locally'}).\n${where}\n\n${config.config}${env}${warn}\n\nDetails: ${pageUrl('server', d.slug)}`
    }),
)

await server.connect(new StdioServerTransport())

if (!process.env.MCPFIELD_API_KEY) console.error(`mcpfield-mcp ${VERSION}: MCPFIELD_API_KEY is not set; search and get_mcp_config work, favorites need a key from ${KEYS_URL}`)
