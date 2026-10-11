import type { EntityKind } from '../../core/types.ts'

/** 归一化源站分类取值：'AI & Agents' → 'ai-agents'，'coding-agent' → 'coding-agent' */
export function normalizeCategory(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * mcp.so 分类 → mcp-field 分类 slug（见 mcp-field/src/lib/*.ts）。
 * 左侧写源站原值，运行时统一归一化后比较。
 * 值为 null 表示"已知、但 mcp-field 没有对应分类"（如 Other），不算问题；
 * 不在表里的值会记入 ingest_issues（unmapped_category），定期查询后补充到这里即可。
 */
const RAW_MAP: Record<EntityKind, Record<string, string | null>> = {
  server: {
    'AI & Agents': 'ai-agents',
    Reasoning: 'ai-agents',
    'Memory & Knowledge': 'memory',
    Search: 'search',
    'Browser Automation': 'browser',
    'Data & Analytics': 'analytics',
    'Developer Tools': 'dev-tools',
    'Version Control': 'vcs',
    Productivity: 'productivity',
    Databases: 'database',
    'Cloud & Infrastructure': 'cloud',
    'Files & Storage': 'storage',
    Communication: 'communication',
    'Media & Design': 'media',
    'Finance & Commerce': 'finance',
    Other: null,
  },
  // 2026-10 实测取值：other / agent-framework / desktop-chat / ide / web-chat / coding-agent
  client: {
    'coding-agent': 'agent',
    ide: 'ide',
    'desktop-chat': 'desktop',
    'web-chat': 'chat',
    'agent-framework': 'framework',
    other: null,
  },
  // 2026-10 实测取值：developer / terminal / security / productivity / payments / …
  cli: {
    developer: 'dev',
    terminal: 'dev',
    security: 'dev',
    productivity: 'dev',
    payments: null,
    'version-control': 'vcs',
    git: 'vcs',
    cloud: 'cloud',
    devops: 'cloud',
    database: 'data',
    data: 'data',
    media: 'media',
    ai: 'ai',
  },
  // 2026-10 实测取值另有 agent-workflows / media / other
  skill: {
    design: 'design',
    agent: 'agent',
    agents: 'agent',
    'agent-workflows': 'agent',
    media: 'creative',
    other: null,
    testing: 'testing',
    marketing: 'marketing',
    data: 'data',
    security: 'security',
    cloud: 'cloud',
    devops: 'cloud',
    creative: 'creative',
    documents: 'documents',
    development: 'dev',
    dev: 'dev',
    productivity: 'productivity',
  },
  loop: {
    CI: 'ci',
    'Code Quality': 'quality',
    Quality: 'quality',
    Testing: 'testing',
    Dependencies: 'deps',
    Frontend: 'frontend',
    Design: 'frontend',
    Docs: 'docs',
    // 2026-10 实测的其余取值
    Maintenance: 'deps',
    DevOps: 'ci',
    Git: 'ci',
    Automation: 'ci',
    API: 'quality',
    Debugging: 'quality',
    Review: 'quality',
    Security: 'quality',
    Performance: 'quality',
    Database: null,
    Planning: null,
  },
  // mcp-field 还没有 Agent 分类体系，先保留源站取值，确定体系后再补映射
  agent: {},
}

const MAP = Object.fromEntries(
  Object.entries(RAW_MAP).map(([kind, entries]) => [
    kind,
    new Map(Object.entries(entries).map(([source, slug]) => [normalizeCategory(source), slug])),
  ]),
) as Record<EntityKind, Map<string, string | null>>

/** 返回 mcp-field 分类 slug；null = 已知但无对应分类；undefined = 未知取值（需要补充映射） */
export function mapCategory(kind: EntityKind, sourceValue: string | null | undefined): string | null | undefined {
  if (!sourceValue) return null
  const key = normalizeCategory(sourceValue)
  if (kind === 'agent') return key || null
  return MAP[kind].has(key) ? MAP[kind].get(key) : undefined
}
