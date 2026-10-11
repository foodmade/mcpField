import { GLOSSARY } from '../translate/prompt.ts'
import type { DescribeKind } from './types.ts'

/** 修改规则后递增，`describe --stale` 会重新生成旧版本的结果 */
export const DESCRIBE_PROMPT_VERSION = 1

const KIND_GUIDE: Record<DescribeKind, string> = {
  cli: `Each item is a command-line tool. Facts include its command, aliases, install command, example commands, homepage, repository, category and capability labels.
- features: 3–5 concrete things the tool lets you do, grounded in the facts and example commands.
- use_cases: 2–4 situations where a developer or a coding agent would reach for it.`,
  agent: `Each item is an AI agent product or framework. Facts include its type, author, website, repository, tags and categories.
- features: 3–5 notable capabilities.
- use_cases: 2–4 situations where someone would use it.`,
  loop: `Each item is a "loop": a repeatable routine a coding agent runs round after round until an exit condition holds. Facts include the trigger type, maximum rounds, a check command, short goal / exit-condition notes and the commands used in each round.
- summary: what the loop is for and how one round works.
- goal: one sentence stating the outcome the loop drives toward, phrased as something checkable.
- exit_condition: one sentence stating exactly when to stop.
- steps: 2–5 steps for a single round, in order. Design them yourself: each step has a short imperative title and a 1–2 sentence body explaining what the agent does and how it judges the result. Set command_index to the index of the fact command that step runs (every listed command must be used by exactly one step, in order), or -1 when the step runs no command.
- features: 2–4 short points about what makes the loop useful (e.g. safeguards, what it checks).
- use_cases: 2–3 situations where you would start this loop.`,
}

export function describeSystemPrompt(kind: DescribeKind): string {
  return `You write original directory copy for MCP Field, a directory of Model Context Protocol (MCP) tools, coding agents, CLIs and agent loops.

${KIND_GUIDE[kind]}

For every item write, in Simplified Chinese (zh), English (en) and Japanese (ja):
- tagline: one sentence for a listing card (en ≤ 18 words, zh ≤ 40 characters, ja ≤ 50 characters).
- summary: 2–3 sentences.
- features and use_cases as described above (short phrases, no trailing period).

Rules
1. Write entirely in your own words and in your own structure. The "background" field is only a hint about what the item is: never reuse its sentences or distinctive phrasing.
2. Use only what the facts support (plus widely known facts about well-known tools). Never invent commands, flags, integrations, platforms, prices or numbers. If facts are thin, write less rather than padding.
3. Keep names, commands, flags, file names and URLs exactly as given.
4. Neutral, informative tone; no marketing superlatives, no emoji, do not address the reader as "you".
5. The three languages must say the same things, with the same number of features, use cases and steps in the same order. Step command_index values must be identical across languages.
6. zh: concise written Simplified Chinese, full-width punctuation, half-width space between Chinese and Latin letters or digits; never use Japanese kana.
7. ja: natural, concise Japanese; summary and step bodies in です・ます form; never use Chinese-only words such as 助手, 大模型, 知识库.
8. Glossary:
${GLOSSARY.map((g) => `- ${g.en} → zh: ${g.zh} · ja: ${g.ja}`).join('\n')}

Return the result only by calling the submit_descriptions tool, with exactly one entry per input id.`
}
