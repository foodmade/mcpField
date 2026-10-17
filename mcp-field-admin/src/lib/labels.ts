/* 界面上的中文名称：类型、步骤、补全项、状态 */

export const KINDS = ['server', 'skill', 'client', 'cli', 'agent', 'loop'] as const
export type Kind = (typeof KINDS)[number]

export const KIND_LABEL: Record<Kind, string> = { server: 'MCP 服务', skill: 'Skill', client: '客户端', cli: 'CLI', agent: 'Agent', loop: 'Loop' }

export const STAGES = ['classify', 'icon', 'github', 'readme', 'translate', 'tools', 'tools_translate', 'intro', 'readme_translate'] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_LABEL: Record<Stage, string> = {
  classify: '分类',
  icon: '图标',
  github: 'GitHub',
  readme: 'README',
  translate: '简介翻译',
  tools: '工具列表',
  tools_translate: '工具翻译',
  intro: 'AI 介绍',
  readme_translate: 'README 译',
}

/** 补全项对应的命令，覆盖率表里小字显示 */
export const STAGE_COMMAND: Record<Stage, string> = {
  classify: 'classify',
  icon: 'assets / owner-icons',
  github: 'github',
  readme: 'github',
  translate: 'translate',
  tools: 'publish · probe',
  tools_translate: 'translate-tools',
  intro: 'overview / describe',
  readme_translate: 'readme',
}

export const STEP_LABEL: Record<string, string> = {
  crawl: '抓取',
  discover: '发现',
  classify: '分类',
  probe: '工具实测',
  'probe-import': '实测导入',
  publish: '发布',
  assets: '图标转存',
  'owner-icons': '头像补图',
  github: 'GitHub',
  translate: '简介翻译',
  'translate-tools': '工具翻译',
  describe: 'AI 简介',
  overview: 'AI 介绍',
  readme: 'README 翻译',
  remap: '草稿重建',
  'search-index': '搜索索引',
  indexnow: 'IndexNow',
  'admin-sync': '状态同步',
}

export const stepLabel = (step: string) => STEP_LABEL[step] ?? step

export type StageState = 'na' | 'pending' | 'running' | 'ok' | 'warn' | 'failed'
export type RunState = 'running' | 'succeeded' | 'warning' | 'failed' | 'interrupted' | 'queued' | 'skipped'

/** 状态 → 颜色（tailwind 的 bg-/text- 后缀）和文字 */
export const STATE_TONE: Record<StageState | RunState, { tone: 'ok' | 'run' | 'warn' | 'err' | 'idle'; label: string }> = {
  ok: { tone: 'ok', label: '完成' },
  succeeded: { tone: 'ok', label: '成功' },
  running: { tone: 'run', label: '进行中' },
  pending: { tone: 'idle', label: '待处理' },
  queued: { tone: 'idle', label: '排队' },
  skipped: { tone: 'idle', label: '未运行' },
  na: { tone: 'idle', label: '不适用' },
  warn: { tone: 'warn', label: '警告' },
  warning: { tone: 'warn', label: '有警告' },
  interrupted: { tone: 'warn', label: '中断' },
  failed: { tone: 'err', label: '失败' },
}

export const SOURCE_LABEL: Record<string, string> = { 'mcp-registry': '官方 Registry', 'skills-sh': 'skills.sh', mcpso: 'mcp.so' }
export const sourceLabel = (id: string) => SOURCE_LABEL[id] ?? id
