import { createHash } from 'node:crypto'
import pLimit from 'p-limit'
import type { Logger } from '../core/logger.ts'
import type { Problem } from '../llm/batch.ts'
import { localeProblems } from '../llm/checks.ts'
import type { Llm } from '../llm/provider.ts'
import { PLACEHOLDER_RE, protectCode, restoreCode, splitChunks } from '../readme/chunk.ts'
import { GLOSSARY } from '../translate/prompt.ts'
import type { BlogTranslateLocale } from './post.ts'

/*
 * 博客译文：中文原文 → 英文 / 日文。
 * 标题和摘要一次请求；正文沿用 README 翻译的做法——代码块换成占位符不发给模型，按章节切片逐段翻译、逐段校验，拼回后还原代码块。
 * 每段译文按片段指纹存下来，原文只改了几段时其余片段直接沿用。
 */

/** 修改提示词后递增（目前只记录，不自动重翻） */
export const BLOG_PROMPT_VERSION = 1

const LANGUAGE: Record<BlogTranslateLocale, string> = { en: 'English', ja: 'Japanese' }

const STYLE: Record<BlogTranslateLocale, string> = {
  en: 'Clear, natural technical English for developers. Use sentence case for headings. Do not leave any Chinese characters in the output (except inside code or proper names that are only written in Chinese).',
  ja: 'Natural technical Japanese in です・ます form for prose; katakana for loanwords; full-width punctuation. Never output Chinese, and never use Chinese-only words or simplified characters such as 这, 们, 个, 助手, 大模型, 知识库.',
}

const glossary = (locale: BlogTranslateLocale) => GLOSSARY.map((g) => `- ${g.zh} → ${locale === 'en' ? g.en : g.ja}`).join('\n')

const COMMON_RULES = (locale: BlogTranslateLocale) => `- Never change: placeholders such as ⟦CODE 3⟧ (keep each on its own line, in the same place), inline code in backticks, URLs, link targets, image paths, file names, commands, environment variables, version numbers, and product, company, model and protocol names (MCP, Claude, OpenAI, VS Code…).
- Translate faithfully and completely: do not summarise, omit, explain or add anything.
- Style: ${STYLE[locale]}
- Glossary (Chinese → ${LANGUAGE[locale]}):
${glossary(locale)}`

export function blogBodyPrompt(locale: BlogTranslateLocale): string {
  return `You translate a section of a blog post on MCP Field, a directory of Model Context Protocol (MCP) tools, from Simplified Chinese into ${LANGUAGE[locale]}.

The user message contains the source Markdown inside <source></source>. Reply with only the translated Markdown inside <translation></translation> — no explanations.

Rules
- Keep the Markdown structure exactly: heading levels, list markers and numbering, indentation, tables (same rows and columns), blockquotes, emphasis, line breaks and blank lines.
- Translate prose, headings, list items, table cells, link text, image alt text and image titles (the quoted text after an image URL).
- GitHub alert markers such as [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] and [!CAUTION] stay exactly as written.
${COMMON_RULES(locale)}`
}

export function blogMetaPrompt(locale: BlogTranslateLocale): string {
  return `You translate the title and summary of a blog post on MCP Field, a directory of Model Context Protocol (MCP) tools, from Simplified Chinese into ${LANGUAGE[locale]}.

The user message contains <title></title> and <summary></summary> (the summary may be empty). Reply with only:
<translation><title>…</title><summary>…</summary></translation>

Rules
- The title should read like a natural ${LANGUAGE[locale]} headline; keep it about as long as the original.
${COMMON_RULES(locale)}`
}

/* ========== 校验 ========== */

const HAN = /[一-鿿]/g
const placeholders = (s: string) => [...s.matchAll(PLACEHOLDER_RE)].map((m) => m[0]).sort()

/** 链接、图片地址：译文里必须一个不少（页内锚点随标题翻译变化，不检查） */
function urls(s: string): string[] {
  const found = new Set<string>()
  for (const m of s.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) found.add(m[1]!)
  return [...found].filter((u) => !u.startsWith('#'))
}

/** 去掉占位符、链接地址、行内代码后的正文：语言检查只看这部分 */
const prose = (s: string) => s.replace(PLACEHOLDER_RE, ' ').replace(/\]\([^)]*\)/g, ']').replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ')

/** 译文里残留的中文：英文译文里汉字超过原文的 5%（且多于 10 个）算没翻完 */
function languageCheck(source: string, output: string, locale: BlogTranslateLocale): Problem[] {
  const out = prose(output)
  if (!out.trim()) return [{ code: 'empty', hard: true, locale }]
  if (locale === 'en') {
    const left = out.match(HAN)?.length ?? 0
    const src = prose(source).match(HAN)?.length ?? 0
    return left > Math.max(10, src * 0.05) ? [{ code: 'chinese_left', hard: true, locale, detail: String(left) }] : []
  }
  // 原文就是中文：不能按“原文里有的中文词允许出现”放宽，传空原文
  return localeProblems('ja', out, '')
}

export function validateBlogChunk(source: string, output: string, locale: BlogTranslateLocale): Problem[] {
  const problems: Problem[] = []
  if (placeholders(source).join() !== placeholders(output).join()) problems.push({ code: 'placeholder_mismatch', hard: true, locale })
  for (const url of urls(source)) if (!output.includes(url)) problems.push({ code: 'missing_url', hard: true, locale, detail: url })
  problems.push(...languageCheck(source, output, locale))
  return problems
}

/* ========== 翻译 ========== */

export interface BlogSource {
  title: string
  summary: string
  body: string
}

export interface BlogTranslation extends BlogSource {
  /** 正文片段指纹 → 译文，下次翻译时传回来复用 */
  chunks: Record<string, string>
  /** 这次实际调用模型翻译的片段数（复用的不算） */
  translatedChunks: number
}

export class BlogTranslationError extends Error {}

const chunkHash = (text: string) => createHash('sha256').update(text).digest('hex')

/** 片段里有没有要翻译的中文（只有占位符、链接、英文的片段原样保留） */
const hasChinese = (chunk: string) => (prose(chunk).match(HAN)?.length ?? 0) > 0

/** 输出的 token 数按原文字符数估：中文译成英文约 1.5–2 倍 */
const maxTokensFor = (chars: number) => Math.min(32_000, Math.ceil(chars * 2.5) + 1_024)

export class BlogTranslator {
  constructor(
    private readonly llm: Llm,
    readonly model: string,
    private readonly logger: Logger,
    private readonly options: { concurrency?: number; attempts?: number; maxChunkChars?: number } = {},
  ) {}

  /** 一次请求，校验不过就重试；最后一次仍不过时抛错 */
  private async attempt(label: string, call: () => Promise<string>, check: (text: string) => Problem[]): Promise<string> {
    const attempts = this.options.attempts ?? 3
    let last = ''
    for (let i = 1; i <= attempts; i++) {
      try {
        const text = await call()
        const hard = check(text).filter((p) => p.hard)
        if (!hard.length) return text
        last = hard.map((p) => (p.detail ? `${p.code}(${p.detail})` : p.code)).join(', ')
      } catch (error) {
        last = (error as Error).message
      }
      this.logger.warn({ label, attempt: i, problem: last }, '博客译文不合格，重试')
    }
    throw new BlogTranslationError(`${label}：${last}`)
  }

  async translate(source: BlogSource, locale: BlogTranslateLocale, previous: Record<string, string> = {}, signal?: AbortSignal): Promise<BlogTranslation> {
    const meta = await this.attempt(
      '标题和摘要',
      async () => {
        const { text } = await this.llm.text({
          model: this.model,
          system: blogMetaPrompt(locale),
          input: `<title>${source.title}</title>\n<summary>${source.summary}</summary>`,
          maxTokens: maxTokensFor(source.title.length + source.summary.length),
          tag: 'translation',
          signal,
        })
        return text
      },
      (text) => {
        const title = /<title>([\s\S]*?)<\/title>/.exec(text)?.[1]?.trim()
        const summary = /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1]?.trim()
        if (!title || summary === undefined || (source.summary.trim() && !summary)) return [{ code: 'bad_format', hard: true, locale }]
        return languageCheck(`${source.title}\n${source.summary}`, `${title}\n${summary}`, locale)
      },
    )
    const title = /<title>([\s\S]*?)<\/title>/.exec(meta)![1]!.trim()
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(meta)![1]!.trim()

    const { text, codeBlocks } = protectCode(source.body)
    const pieces = splitChunks(text, this.options.maxChunkChars ?? 3_000)
    const chunks: Record<string, string> = {}
    let translatedChunks = 0
    const limit = pLimit(this.options.concurrency ?? 3)
    const parts = await Promise.all(
      pieces.map((piece, i) =>
        limit(async () => {
          if (!hasChinese(piece)) return piece
          const hash = chunkHash(piece)
          const reused = previous[hash]
          if (reused !== undefined) {
            chunks[hash] = reused
            return reused
          }
          const out = await this.attempt(
            `正文第 ${i + 1}/${pieces.length} 段`,
            async () => {
              const { text: t } = await this.llm.text({ model: this.model, system: blogBodyPrompt(locale), input: `<source>\n${piece}\n</source>`, maxTokens: maxTokensFor(piece.length), tag: 'translation', signal })
              return t
            },
            (t) => validateBlogChunk(piece, t, locale),
          )
          translatedChunks++
          // 模型输出去掉了首尾空行，按原片段补回，拼接后段落之间的空行不变
          const kept = `${/^\s*/.exec(piece)![0]}${out.trim()}${/\s*$/.exec(piece)![0]}`
          chunks[hash] = kept
          return kept
        }),
      ),
    )
    return { title, summary, body: restoreCode(parts.join('\n'), codeBlocks), chunks, translatedChunks }
  }
}
