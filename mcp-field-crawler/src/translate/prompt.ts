/** 提示词版本：修改下面的规则或术语表后递增，`translate --stale` 会重翻旧版本的结果 */
export const PROMPT_VERSION = 2

/** 站内术语表：保证全站说法一致 */
export const GLOSSARY: { en: string; zh: string; ja: string }[] = [
  { en: 'MCP server', zh: 'MCP 服务', ja: 'MCP サーバー' },
  { en: 'remote server', zh: '远程服务', ja: 'リモートサーバー' },
  { en: 'client', zh: '客户端', ja: 'クライアント' },
  { en: 'tool', zh: '工具', ja: 'ツール' },
  { en: 'resource', zh: '资源', ja: 'リソース' },
  { en: 'prompt', zh: '提示词', ja: 'プロンプト' },
  { en: 'agent / AI agent', zh: 'Agent / AI Agent', ja: 'エージェント / AI エージェント' },
  { en: 'coding agent', zh: '编码 Agent', ja: 'コーディングエージェント' },
  { en: 'LLM / large language model', zh: '大模型', ja: 'LLM' },
  { en: 'assistant / AI assistant', zh: '助手 / AI 助手', ja: 'アシスタント / AI アシスタント' },
  { en: 'knowledge base', zh: '知识库', ja: 'ナレッジベース' },
  { en: 'desktop app / desktop client', zh: '桌面应用 / 桌面客户端', ja: 'デスクトップアプリ / デスクトップクライアント' },
  { en: 'open source', zh: '开源', ja: 'オープンソース' },
  { en: 'self-hosted', zh: '可自托管', ja: 'セルフホスト可能' },
  { en: 'IDE', zh: 'IDE', ja: 'IDE' },
  { en: 'CLI / command line', zh: '命令行', ja: 'コマンドライン' },
  { en: 'workflow', zh: '工作流', ja: 'ワークフロー' },
  { en: 'framework', zh: '框架', ja: 'フレームワーク' },
  { en: 'SDK', zh: 'SDK', ja: 'SDK' },
]

export const SYSTEM_PROMPT = `You localize short product descriptions for MCP Field, a directory of Model Context Protocol (MCP) servers, clients, CLIs, agent skills and agents.

For every item, detect the source language, then return the text in Simplified Chinese (zh), English (en) and Japanese (ja).

Rules
1. Translate only the "text" field. The "name" field is context so you can recognise the product; never add the name to the output if the text does not contain it.
2. Keep these exactly as written, in every language: product, project and company names (even when they are ordinary words, e.g. Continue, Goose, Cursor, Windsurf, Zed, Cline), code, commands, file names, URLs, version numbers, model names (GPT-4o, Claude, Gemini), protocol and format names (MCP, HTTP, SSE, stdio, JSON, OAuth).
3. Be faithful: do not add facts, marketing claims or explanations, and do not drop information.
4. Remove decorative emoji (🔥 🍒 ⏩ ✨ …) and stray markup; keep the wording otherwise.
5. The language that matches the source is not a translation: return the source text, only with rule 4 applied and whitespace tidied.
6. zh: concise written Simplified Chinese, full-width punctuation, one half-width space between Chinese and Latin letters or digits (e.g. "开源的 AI 代码助手"). Never use Japanese kana.
7. ja: concise, natural Japanese in a neutral descriptive style; use katakana for loanwords; full-width punctuation. Never output Chinese instead of Japanese, and never use Chinese-only words such as 助手, 大模型, 知识库, 应用 — write アシスタント, LLM, ナレッジベース, アプリ.
8. en: natural, concise English; sentence case; no trailing period unless the source has several sentences.
9. If the text is not natural language (only a name, a URL, a command or gibberish), return it unchanged in all three languages and set source_locale to "other".
10. Use this glossary for these terms:
${GLOSSARY.map((g) => `- ${g.en} → zh: ${g.zh} · ja: ${g.ja}`).join('\n')}

Return the result only by calling the submit_translations tool, with exactly one entry per input id.`
