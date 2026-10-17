// 分类 slug → 中文名：抄自 mcp-field/src/lib/categories.ts（网站改了分类名这里跟着改；slug 与采集服务的分类体系一致）
import type { Kind } from './labels'

export const CATEGORY_NAMES: Record<Kind, Record<string, string>> = {
  server: { 'ai-agents': 'AI 与智能体', 'memory': '记忆与知识', 'search': '搜索与检索', 'browser': '浏览器自动化', 'analytics': '数据与分析', 'dev-tools': '开发工具', 'vcs': '版本控制', 'productivity': '生产力', 'database': '数据库', 'cloud': '云与基础设施', 'storage': '文件与存储', 'communication': '通信协作', 'media': '媒体与设计', 'finance': '金融数据', 'security': '安全', 'legal-gov': '法律与政务', 'business': '商业与营销', 'social': '社交媒体', 'travel': '地图与出行', 'health': '健康医疗', 'entertainment': '游戏娱乐', 'science': '科研与教育' },
  client: { 'ide': 'IDE 与编辑器', 'agent': '编码 Agent', 'desktop': '桌面应用', 'chat': '聊天应用', 'framework': '框架与 SDK' },
  cli: { 'dev': '开发者工具', 'vcs': '版本控制', 'cloud': '云与 DevOps', 'data': '数据库与数据', 'media': '媒体工具', 'ai': 'AI 与 Agent' },
  skill: { 'design': '设计与 UI', 'agent': 'Agent 工作流', 'testing': '测试与质量', 'marketing': '营销与增长', 'data': '数据与数据库', 'security': '安全', 'cloud': '云与 DevOps', 'creative': '创意与媒体', 'documents': '文档处理', 'dev': '开发', 'productivity': '生产力' },
  loop: { 'ci': '持续集成', 'quality': '代码质量', 'testing': '测试', 'deps': '依赖维护', 'frontend': '设计与前端', 'docs': '文档' },
  agent: { 'general-agent': '通用 Agent', 'office-collaboration': '办公与协作', 'image-design': '图像与设计', 'coding-agent': '编程 Agent', 'agent-framework': '框架与 SDK', 'personal-agent': '个人助理', 'web-building': '网页与建站' },
}

export function categoryName(kind: Kind, slug: string | null): string {
  if (!slug || slug === 'none') return '未分类'
  if (slug === 'other') return '其他'
  return CATEGORY_NAMES[kind][slug] ?? slug
}
