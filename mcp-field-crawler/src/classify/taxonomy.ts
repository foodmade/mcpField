import type { EntityKind } from '../core/types.ts'

/*
 * 分类体系：各类型的分类 slug 与判定说明，分类器和人工复核都按这里的定义判断。
 * slug 与网站的分类配置一致（mcp-field/src/lib/categories.ts，那里有界面上的名称、图标、颜色；
 * test/taxonomy.test.ts 会核对两边的 slug）。没有合适分类的条目归入"其他"，不在这里列出。
 *
 * 修改分类或判定说明后递增 TAXONOMY_VERSION，classify 会重新分类所有条目。
 */
export const TAXONOMY_VERSION = 1

export interface CategoryDef {
  slug: string
  /** 判定说明：包含什么、不包含什么（给模型看，用英文写） */
  definition: string
}

export const TAXONOMY: Record<EntityKind, CategoryDef[]> = {
  server: [
    { slug: 'ai-agents', definition: 'LLM providers, agent orchestration, multi-agent frameworks, prompt tools, reasoning helpers, model routing.' },
    { slug: 'memory', definition: 'Long-term memory for agents, knowledge bases, RAG pipelines, note graphs, documentation knowledge. Not generic databases.' },
    { slug: 'search', definition: 'Web search engines, document/semantic search, academic paper search when the main job is finding things.' },
    { slug: 'browser', definition: 'Browser automation (Playwright, Puppeteer), web scraping, crawling, page fetching and extraction.' },
    { slug: 'analytics', definition: 'Data analysis, BI, metrics, product analytics, spreadsheets as data, dashboards, observability data queries.' },
    { slug: 'dev-tools', definition: 'Tools for building software: code execution, linters, testing, IDE helpers, API clients, package registries, docs for programmers, MCP examples, templates and tutorials.' },
    { slug: 'vcs', definition: 'Git, GitHub, GitLab, Bitbucket, code review and issue tracking tied to repositories.' },
    { slug: 'productivity', definition: 'Notes, tasks, calendars, project management, office documents, personal organization, time tracking.' },
    { slug: 'database', definition: 'SQL/NoSQL databases, vector databases, data warehouses, query and schema tools.' },
    { slug: 'cloud', definition: 'Cloud providers, infrastructure, DevOps, Kubernetes, CI/CD, monitoring and hosting platforms.' },
    { slug: 'storage', definition: 'File systems, object storage, file sharing and sync, document storage.' },
    { slug: 'communication', definition: 'Email, chat and messaging apps (Slack, Discord, Telegram), SMS, phone calls, meetings.' },
    { slug: 'media', definition: 'Creating or editing images, video, audio, music, speech; design tools (Figma); 3D.' },
    { slug: 'finance', definition: 'Stock and market data, banking, payments, accounting, crypto and blockchain, invoices, tax.' },
    { slug: 'security', definition: 'Security scanning, vulnerability and threat intelligence, penetration testing, malware analysis, identity/auth security, privacy.' },
    { slug: 'legal-gov', definition: 'Legal research, laws and regulations, compliance, courts, patents, government services and public records, official open data.' },
    { slug: 'business', definition: 'CRM, sales, marketing, SEO, advertising, e-commerce operations, HR and recruiting, real estate, ERP, company and business data.' },
    { slug: 'social', definition: 'Social media platforms and communities: X/Twitter, Reddit, LinkedIn, Instagram, TikTok, YouTube channels, forums.' },
    { slug: 'travel', definition: 'Maps, geolocation, places, weather, travel booking, flights, hotels, transit, shipping and logistics.' },
    { slug: 'health', definition: 'Medical, healthcare, drugs, biology data for health, fitness, nutrition, mental health.' },
    { slug: 'entertainment', definition: 'Games, sports, movies, TV, anime, books, music listening, hobbies, astrology and fun.' },
    { slug: 'science', definition: 'Scientific research data (astronomy, chemistry, physics, biology), math, education and learning platforms.' },
  ],
  client: [
    { slug: 'ide', definition: 'Code editors and IDEs or IDE extensions that act as MCP clients (VS Code, Cursor, JetBrains plugins).' },
    { slug: 'agent', definition: 'Autonomous coding agents and terminal agents (Claude Code, Codex CLI, Cline).' },
    { slug: 'desktop', definition: 'Desktop chat or assistant apps that connect to MCP servers.' },
    { slug: 'chat', definition: 'Web or mobile chat apps and chatbots that connect to MCP servers.' },
    { slug: 'framework', definition: 'SDKs, libraries, frameworks, proxies, gateways and inspectors for building or connecting MCP clients.' },
  ],
  cli: [
    { slug: 'dev', definition: 'General developer CLIs: build, test, lint, terminal utilities, security tools, productivity CLIs for developers.' },
    { slug: 'vcs', definition: 'Git and code hosting CLIs.' },
    { slug: 'cloud', definition: 'Cloud provider, DevOps, container and deployment CLIs.' },
    { slug: 'data', definition: 'Database and data processing CLIs.' },
    { slug: 'media', definition: 'Image, video, audio processing CLIs.' },
    { slug: 'ai', definition: 'AI and agent CLIs, LLM command-line tools.' },
  ],
  skill: [
    { slug: 'design', definition: 'UI/UX, frontend design, styling, visual design.' },
    { slug: 'agent', definition: 'Agent workflows, planning, orchestration, prompting, meta-skills about using agents.' },
    { slug: 'testing', definition: 'Testing, QA, code review, quality.' },
    { slug: 'marketing', definition: 'Marketing, growth, SEO, copywriting, sales.' },
    { slug: 'data', definition: 'Data analysis, databases, spreadsheets, data engineering.' },
    { slug: 'security', definition: 'Security reviews, vulnerability analysis, secure coding.' },
    { slug: 'cloud', definition: 'Cloud, DevOps, deployment, infrastructure.' },
    { slug: 'creative', definition: 'Creative work and media: images, video, audio, writing fiction, art.' },
    { slug: 'documents', definition: 'Working with documents: PDF, Word, slides, spreadsheets as files.' },
    { slug: 'dev', definition: 'General software development: languages, frameworks, refactoring, architecture.' },
    { slug: 'productivity', definition: 'Personal productivity, notes, research, planning outside of coding.' },
  ],
  loop: [
    { slug: 'ci', definition: 'Keeping CI green, fixing builds, automation and DevOps loops.' },
    { slug: 'quality', definition: 'Code quality, lint, types, refactoring, review, security and performance fixes.' },
    { slug: 'testing', definition: 'Writing and fixing tests, coverage.' },
    { slug: 'deps', definition: 'Dependency upgrades and maintenance.' },
    { slug: 'frontend', definition: 'UI, design and frontend polishing.' },
    { slug: 'docs', definition: 'Documentation writing and upkeep.' },
  ],
  agent: [
    { slug: 'general-agent', definition: 'General-purpose autonomous agents that handle many kinds of tasks.' },
    { slug: 'office-collaboration', definition: 'Office work, documents, meetings, team collaboration.' },
    { slug: 'image-design', definition: 'Image generation, design, visual content.' },
    { slug: 'coding-agent', definition: 'Agents that write and fix code.' },
    { slug: 'agent-framework', definition: 'Frameworks and SDKs for building agents.' },
    { slug: 'personal-agent', definition: 'Personal assistants for individuals: life, shopping, scheduling.' },
    { slug: 'web-building', definition: 'Building websites and apps from prompts.' },
  ],
}

/** "其他"：没有合适的分类 */
export const OTHER = 'other'

export function slugsOf(kind: EntityKind): string[] {
  return TAXONOMY[kind].map((c) => c.slug)
}
