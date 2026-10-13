import type { Kind } from '../../lib/api/entities'
import type { Category } from '../../lib/categories'

/*
 * 各目录的分类 → 3D 模型（models.ts 的键）。MCP 服务的分类和模型同名；
 * 其他目录概念相同的分类复用同一个模型（版本控制、云、数据库、安全……），其余用专门的模型。
 */
const BY_KIND: Record<Exclude<Kind, 'server'>, Record<string, string>> = {
  client: { ide: 'editor', agent: 'ai-agents', desktop: 'desktop', chat: 'communication', framework: 'layers' },
  cli: { dev: 'dev-tools', vcs: 'vcs', cloud: 'cloud', data: 'database', media: 'film', ai: 'ai-agents' },
  skill: {
    design: 'media', agent: 'workflow', testing: 'flask', marketing: 'megaphone', data: 'database', security: 'security',
    cloud: 'cloud', creative: 'film', documents: 'document', dev: 'dev-tools', productivity: 'productivity',
  },
  loop: { ci: 'vcs', quality: 'medal', testing: 'flask', deps: 'parcel', frontend: 'browser', docs: 'document' },
  agent: {
    'general-agent': 'ai-agents', 'office-collaboration': 'business', 'image-design': 'media', 'coding-agent': 'dev-tools',
    'agent-framework': 'layers', 'personal-agent': 'phone', 'web-building': 'globe',
  },
}

/** 没选分类（全部或快捷视图）时的图标和光晕颜色 */
const ALL: Record<Kind, DirIcon> = {
  server: { model: 'servers', color: '#3DDC97' },
  client: { model: 'desktop', color: '#D97757' },
  cli: { model: 'console', color: '#3DDC97' },
  skill: { model: 'toolbox', color: '#9B6CE0' },
  loop: { model: 'cycle', color: '#3DDC97' },
  agent: { model: 'ai-agents', color: '#5B8DEF' },
}

/** 目录头部的 3D 图标：模型键和背后光晕的颜色 */
export type DirIcon = { model: string; color: string }

export function iconFor(kind: Kind, category: Category | undefined): DirIcon {
  if (!category) return ALL[kind]
  const model = kind === 'server' ? category.slug : (BY_KIND[kind][category.slug] ?? 'other')
  return { model, color: category.color }
}
