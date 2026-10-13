import {
  Atom, BookOpen, Brain, Browser, ChartBar, ChartLineUp, ChatsCircle, CheckCircle, CheckSquare, Cloud, Code, Database, Desktop, DotsThreeCircle,
  Briefcase, FileDoc, FilmStrip, Flask, FlowArrow, Folder, FrameCorners, GameController, GitBranch, GlobeSimple, Heartbeat, MagnifyingGlass, MapTrifold,
  Megaphone, Package, Palette, Robot, Scales, ShieldCheck, Stack, TestTube, UserCircle, UsersThree, type Icon,
} from '@phosphor-icons/react'
import type { L } from '../i18n/locales'
import type { Kind } from './api/entities'

/*
 * 各类型的分类配置（界面上的名称、图标、颜色）。
 * slug 与采集服务的分类体系一致（mcp-field-crawler/src/classify/taxonomy.ts，那里有判定说明；它的测试会核对两边的 slug）；
 * 没有合适分类的条目归入 other，接口里用 category=none 查询。
 */

export type Category = { slug: string; name: L; icon: Icon; color: string }
/** 目录侧栏的子类型筛选项（Agent：产品 / 模板） */
export type TypeOption = { value: string; label: string; icon: Icon; color: string }

const OTHER: Category = { slug: 'other', name: ['其他', 'Other', 'その他'], icon: DotsThreeCircle, color: '#8B93A7' }

export const serverCategories: Category[] = [
  { slug: 'ai-agents', name: ['AI 与智能体', 'AI & Agents', 'AI・エージェント'], icon: Robot, color: '#8B93A7' },
  { slug: 'memory', name: ['记忆与知识', 'Memory & Knowledge', 'メモリ・ナレッジ'], icon: Brain, color: '#3DBE6E' },
  { slug: 'search', name: ['搜索与检索', 'Search', '検索'], icon: MagnifyingGlass, color: '#9B6CE0' },
  { slug: 'browser', name: ['浏览器自动化', 'Browser Automation', 'ブラウザ自動化'], icon: Browser, color: '#2BB3A3' },
  { slug: 'analytics', name: ['数据与分析', 'Data & Analytics', 'データ・分析'], icon: ChartBar, color: '#22B8D9' },
  { slug: 'dev-tools', name: ['开发工具', 'Developer Tools', '開発ツール'], icon: Code, color: '#5B8DEF' },
  { slug: 'vcs', name: ['版本控制', 'Version Control', 'バージョン管理'], icon: GitBranch, color: '#D9622B' },
  { slug: 'productivity', name: ['生产力', 'Productivity', '生産性'], icon: CheckSquare, color: '#B8C23A' },
  { slug: 'database', name: ['数据库', 'Databases', 'データベース'], icon: Database, color: '#4F7DD9' },
  { slug: 'cloud', name: ['云与基础设施', 'Cloud & Infra', 'クラウド・インフラ'], icon: Cloud, color: '#22B8D9' },
  { slug: 'storage', name: ['文件与存储', 'Files & Storage', 'ファイル・ストレージ'], icon: Folder, color: '#D9944A' },
  { slug: 'communication', name: ['通信协作', 'Communication', 'コミュニケーション'], icon: ChatsCircle, color: '#D9577E' },
  { slug: 'media', name: ['媒体与设计', 'Media & Design', 'メディア・デザイン'], icon: Palette, color: '#D9944A' },
  { slug: 'finance', name: ['金融数据', 'Finance', '金融データ'], icon: ChartLineUp, color: '#B8C23A' },
  { slug: 'security', name: ['安全', 'Security', 'セキュリティ'], icon: ShieldCheck, color: '#E5484D' },
  { slug: 'legal-gov', name: ['法律与政务', 'Legal & Government', '法務・行政'], icon: Scales, color: '#8B7355' },
  { slug: 'business', name: ['商业与营销', 'Business & Marketing', 'ビジネス・マーケティング'], icon: Briefcase, color: '#D9944A' },
  { slug: 'social', name: ['社交媒体', 'Social Media', 'ソーシャルメディア'], icon: UsersThree, color: '#4F7DD9' },
  { slug: 'travel', name: ['地图与出行', 'Maps & Travel', '地図・旅行'], icon: MapTrifold, color: '#2BB3A3' },
  { slug: 'health', name: ['健康医疗', 'Health', 'ヘルスケア'], icon: Heartbeat, color: '#D9577E' },
  { slug: 'entertainment', name: ['游戏娱乐', 'Games & Entertainment', 'ゲーム・エンタメ'], icon: GameController, color: '#9B6CE0' },
  { slug: 'science', name: ['科研与教育', 'Science & Education', '科学・教育'], icon: Atom, color: '#22B8D9' },
  OTHER,
]

export const clientCategories: Category[] = [
  { slug: 'ide', name: ['IDE 与编辑器', 'IDEs & Editors', 'IDE・エディタ'], icon: Code, color: '#5B8DEF' },
  { slug: 'agent', name: ['编码 Agent', 'Coding Agents', 'コーディングエージェント'], icon: Robot, color: '#3DBE6E' },
  { slug: 'desktop', name: ['桌面应用', 'Desktop Apps', 'デスクトップアプリ'], icon: Desktop, color: '#D97757' },
  { slug: 'chat', name: ['聊天应用', 'Chat Apps', 'チャットアプリ'], icon: ChatsCircle, color: '#9B6CE0' },
  { slug: 'framework', name: ['框架与 SDK', 'Frameworks & SDKs', 'フレームワーク・SDK'], icon: Stack, color: '#22B8D9' },
  OTHER,
]

export const cliCategories: Category[] = [
  { slug: 'dev', name: ['开发者工具', 'Developer Tools', '開発ツール'], icon: Code, color: '#5B8DEF' },
  { slug: 'vcs', name: ['版本控制', 'Version Control', 'バージョン管理'], icon: GitBranch, color: '#FC6D26' },
  { slug: 'cloud', name: ['云与 DevOps', 'Cloud & DevOps', 'クラウド・DevOps'], icon: Cloud, color: '#F38020' },
  { slug: 'data', name: ['数据库与数据', 'Databases & Data', 'データベース・データ'], icon: Database, color: '#4F7DD9' },
  { slug: 'media', name: ['媒体工具', 'Media Tools', 'メディアツール'], icon: FilmStrip, color: '#3DBE6E' },
  { slug: 'ai', name: ['AI 与 Agent', 'AI & Agents', 'AI・エージェント'], icon: Robot, color: '#9B6CE0' },
  OTHER,
]

export const skillCategories: Category[] = [
  { slug: 'design', name: ['设计与 UI', 'Design & UI', 'デザイン・UI'], icon: Palette, color: '#D9944A' },
  { slug: 'agent', name: ['Agent 工作流', 'Agent workflows', 'エージェントワークフロー'], icon: FlowArrow, color: '#3DBE6E' },
  { slug: 'testing', name: ['测试与质量', 'Testing & quality', 'テスト・品質'], icon: Flask, color: '#2BB3A3' },
  { slug: 'marketing', name: ['营销与增长', 'Marketing & growth', 'マーケティング・グロース'], icon: Megaphone, color: '#D9577E' },
  { slug: 'data', name: ['数据与数据库', 'Data & databases', 'データ・データベース'], icon: Database, color: '#4F7DD9' },
  { slug: 'security', name: ['安全', 'Security', 'セキュリティ'], icon: ShieldCheck, color: '#E5484D' },
  { slug: 'cloud', name: ['云与 DevOps', 'Cloud & DevOps', 'クラウド・DevOps'], icon: Cloud, color: '#22B8D9' },
  { slug: 'creative', name: ['创意与媒体', 'Creative & media', 'クリエイティブ・メディア'], icon: FilmStrip, color: '#9B6CE0' },
  { slug: 'documents', name: ['文档处理', 'Documents', 'ドキュメント'], icon: FileDoc, color: '#5B8DEF' },
  { slug: 'dev', name: ['开发', 'Development', '開発'], icon: Code, color: '#5B8DEF' },
  { slug: 'productivity', name: ['生产力', 'Productivity', '生産性'], icon: CheckSquare, color: '#B8C23A' },
  OTHER,
]

export const loopCategories: Category[] = [
  { slug: 'ci', name: ['持续集成', 'Continuous Integration', '継続的インテグレーション'], icon: GitBranch, color: '#D9577E' },
  { slug: 'quality', name: ['代码质量', 'Code Quality', 'コード品質'], icon: CheckCircle, color: '#3DBE6E' },
  { slug: 'testing', name: ['测试', 'Testing', 'テスト'], icon: TestTube, color: '#2BB3A3' },
  { slug: 'deps', name: ['依赖维护', 'Dependencies', '依存関係の保守'], icon: Package, color: '#5B8DEF' },
  { slug: 'frontend', name: ['设计与前端', 'Design & Frontend', 'デザイン・フロントエンド'], icon: FrameCorners, color: '#D9944A' },
  { slug: 'docs', name: ['文档', 'Docs', 'ドキュメント'], icon: BookOpen, color: '#9B6CE0' },
  OTHER,
]

export const agentCategories: Category[] = [
  { slug: 'general-agent', name: ['通用 Agent', 'General agents', '汎用エージェント'], icon: Robot, color: '#5B8DEF' },
  { slug: 'office-collaboration', name: ['办公与协作', 'Office & collaboration', 'オフィス・コラボレーション'], icon: Briefcase, color: '#D9944A' },
  { slug: 'image-design', name: ['图像与设计', 'Image & design', '画像・デザイン'], icon: Palette, color: '#D9577E' },
  { slug: 'coding-agent', name: ['编程 Agent', 'Coding agents', 'コーディングエージェント'], icon: Code, color: '#3DBE6E' },
  { slug: 'agent-framework', name: ['框架与 SDK', 'Frameworks & SDKs', 'フレームワーク・SDK'], icon: Stack, color: '#9B6CE0' },
  { slug: 'personal-agent', name: ['个人助理', 'Personal assistants', 'パーソナルアシスタント'], icon: UserCircle, color: '#22B8D9' },
  { slug: 'web-building', name: ['网页与建站', 'Web building', 'Web 制作'], icon: GlobeSimple, color: '#B8C23A' },
  OTHER,
]

export const CATEGORIES: Record<Kind, Category[]> = {
  server: serverCategories,
  client: clientCategories,
  cli: cliCategories,
  skill: skillCategories,
  loop: loopCategories,
  agent: agentCategories,
}

const BY_SLUG = Object.fromEntries(Object.entries(CATEGORIES).map(([k, list]) => [k, Object.fromEntries(list.map((c) => [c.slug, c]))])) as Record<Kind, Record<string, Category>>

/** 接口返回的分类 slug → 界面分类；没有对应项时归入"其他" */
export function categoryOf(kind: Kind, slug: string | null | undefined): Category {
  return (slug && BY_SLUG[kind][slug]) || OTHER
}

/** 页面上的分类 slug → 接口参数（other 对应 none） */
export const categoryParam = (slug: string | null) => (slug === 'other' ? 'none' : (slug ?? undefined))

export type SortKey = 'hot' | 'new' | 'name'
export const SORT_KEYS: SortKey[] = ['hot', 'new', 'name']
export type ViewKey = 'official' | 'featured' | 'verified'
export const PAGE_SIZE = 60

/** 1234 → 1.2k */
export const compactNumber = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
