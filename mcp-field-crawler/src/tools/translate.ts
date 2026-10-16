import { sql } from 'drizzle-orm'
import type { ToolDraft } from '../core/draft.ts'
import type { Locale } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import type { Problem } from '../llm/batch.ts'
import { blockHash, normalizeBlock } from '../translate/key.ts'
import type { TranslationReader } from '../translate/memory.ts'
import type { TranslationItem, TranslationResult } from '../translate/types.ts'
import { validateTranslation } from '../translate/validate.ts'

/* MCP 服务的工具描述和参数说明：原文按指纹存进简介共用的翻译记忆库，接口按请求语言替换 */

/** 只有符号、数字的说明不用翻译 */
const HAS_LETTER = /\p{L}/u

/** 工具描述、参数说明的原文，规范化后为空或不含文字时返回 null */
function sourceText(description: string | undefined): string | null {
  const text = normalizeBlock(description ?? '')
  return text && HAS_LETTER.test(text) ? text : null
}

/** 一个服务的工具里要翻译的文本：工具描述（name = 工具名）和参数说明（name = 工具名.参数路径） */
export function toolTexts(tools: ToolDraft[]): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = []
  for (const tool of tools) {
    const text = sourceText(tool.description)
    if (text) out.push({ name: tool.name, text })
    for (const p of tool.params) {
      const param = sourceText(p.description)
      if (param) out.push({ name: `${tool.name}.${p.path}`, text: param })
    }
  }
  return out
}

/**
 * 从发布层收集 MCP 服务的工具文本，按服务热度（与 sort=popular 一致）从高到低排、按原文指纹去重：
 * 热门服务先翻译，加 --limit 试跑或中途停下时也是热门的先有译文
 */
export async function collectToolSources(db: Db, options: { minStars?: number } = {}): Promise<TranslationItem[]> {
  // 结果带着整段工具 JSON，在 MySQL 里排序会超出排序缓冲区（Out of sort memory），取回后再排
  const [rows] = (await db.execute(sql`
    SELECT d.id, s.pop_rank AS popRank, JSON_EXTRACT(d.draft, '$.detail.tools') AS tools
    FROM ingest_published d
    LEFT JOIN ingest_search s ON s.kind = d.kind AND s.locale = 'en' AND s.slug = d.slug
    WHERE d.kind = 'server' AND JSON_LENGTH(d.draft, '$.detail.tools') > 0
      ${options.minStars ? sql`AND s.pop_rank <= ${-options.minStars}` : sql``}`)) as unknown as [{ id: number; popRank: number | null; tools: ToolDraft[] | string }[]]
  const rank = (r: { popRank: number | null }) => (r.popRank === null ? Number.MAX_SAFE_INTEGER : Number(r.popRank))
  rows.sort((a, b) => rank(a) - rank(b) || a.id - b.id)

  const items = new Map<string, TranslationItem>()
  for (const row of rows) {
    const tools = (typeof row.tools === 'string' ? JSON.parse(row.tools) : row.tools) as ToolDraft[]
    for (const { name, text } of toolTexts(tools)) {
      const hash = blockHash(text)
      if (!items.has(hash)) items.set(hash, { hash, text, name, kind: 'server' })
    }
  }
  return [...items.values()]
}

/** 必须原样保留的标识符：snake_case（如 issue_id_or_url）；驼峰、网址、行内代码由 validateTranslation 检查 */
const SNAKE_RE = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g

const lineCount = (text: string) => text.split('\n').length

/** 在简介的校验规则上加两条：标识符原样保留、行数（列表结构）不变；都是软性问题，保存但标记为待抽查 */
export function validateToolTranslation(item: TranslationItem, result: TranslationResult): Problem[] {
  const problems = validateTranslation(item, result)
  const each = Object.entries(result.texts) as [Locale, string][]
  const reported = new Set(problems.filter((p) => p.code === 'missing_token').map((p) => `${p.locale}:${p.detail}`))
  for (const token of new Set(item.text.match(SNAKE_RE) ?? [])) {
    for (const [locale, value] of each) if (!value.includes(token) && !reported.has(`${locale}:${token}`)) problems.push({ code: 'missing_token', hard: false, locale, detail: token })
  }
  const lines = lineCount(item.text)
  if (lines > 1) {
    for (const [locale, value] of each) if (lineCount(value) !== lines) problems.push({ code: 'line_count', hard: false, locale, detail: `${lineCount(value)}/${lines}` })
  }
  return problems
}

/** 工具定义的对外结构里需要本地化的部分（见 presenters.ts 的 presentTool） */
interface LocalizableTool {
  description: string | null
  params: { description: string | null }[]
}

/** 把工具描述和参数说明换成请求语言的译文（按原文指纹查翻译记忆库）；没有译文的保留原文 */
export async function localizeTools(tools: LocalizableTool[], reader: TranslationReader, locale: Locale): Promise<void> {
  const fields = tools.flatMap((t) => [t, ...t.params]).filter((f) => f.description && sourceText(f.description))
  if (fields.length === 0) return
  const hashes = fields.map((f) => blockHash(f.description!))
  const found = await reader.lookup(hashes, locale)
  fields.forEach((f, i) => {
    f.description = found.get(hashes[i]!) ?? f.description
  })
}
