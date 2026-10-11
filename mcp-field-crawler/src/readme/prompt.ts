import { GLOSSARY } from '../translate/prompt.ts'

/** 修改规则后递增，`readme --stale` 会重新翻译旧版本的结果 */
export const README_PROMPT_VERSION = 1

export type ReadmeLocale = 'zh' | 'ja'

const LANGUAGE: Record<ReadmeLocale, string> = { zh: 'Simplified Chinese', ja: 'Japanese' }

const STYLE: Record<ReadmeLocale, string> = {
  zh: 'Concise written Simplified Chinese with full-width punctuation and a half-width space between Chinese and Latin letters or digits. Never use Japanese kana.',
  ja: 'Natural technical Japanese in です・ます form for prose; katakana for loanwords; full-width punctuation. Never output Chinese, and never use Chinese-only words such as 助手, 大模型, 知识库.',
}

export function readmeSystemPrompt(locale: ReadmeLocale): string {
  const lang = LANGUAGE[locale]
  return `You translate a section of a software project's README (Markdown) into ${lang} for MCP Field, a directory of Model Context Protocol (MCP) tools.

The user message contains the source inside <source></source>. Reply with only the translated Markdown inside <translation></translation> — no explanations.

Rules
1. Keep the Markdown structure exactly: heading levels, list markers and numbering, indentation, tables (same rows and columns), blockquotes, emphasis, line breaks and blank lines.
2. Never change: placeholders such as ⟦CODE 3⟧ (keep each on its own line, in the same place), inline code in backticks, URLs, link targets, image paths, HTML tags and attributes, file names, commands, environment variables, version numbers, badges, and product, company, model and protocol names (MCP, Claude, OpenAI, VS Code…).
3. Translate prose, headings, list items, table cells, link text, image alt text and visible text inside HTML.
4. GitHub alert markers such as [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] and [!CAUTION] stay exactly as written.
5. Translate faithfully and completely: do not summarise, omit or add anything.
6. Style: ${STYLE[locale]}
7. Glossary:
${GLOSSARY.map((g) => `- ${g.en} → ${g[locale]}`).join('\n')}`
}
