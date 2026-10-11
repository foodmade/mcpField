import { createHash } from 'node:crypto'

/** 代码块占位符：翻译时整块替换掉，不发给模型，翻完原样放回 */
export const placeholder = (n: number) => `⟦CODE ${n}⟧`
export const PLACEHOLDER_RE = /⟦CODE (\d+)⟧/g

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/
const HEADING = /^#{1,6}\s/

/** README 指纹：只规范换行符，内容有任何变化都会改变 */
export function readmeHash(markdown: string): string {
  return createHash('sha256').update(markdown.replace(/\r\n?/g, '\n')).digest('hex')
}

/** 去掉 HTML 注释，并把围栏代码块替换成独占一行的占位符 */
export function protectCode(markdown: string): { text: string; codeBlocks: string[] } {
  const lines = markdown.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n')
  const out: string[] = []
  const codeBlocks: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]!)
    if (!open) {
      out.push(lines[i]!)
      continue
    }
    const fence = open[1]!
    const block = [lines[i]!]
    let j = i + 1
    for (; j < lines.length; j++) {
      block.push(lines[j]!)
      const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`)
      if (close.test(lines[j]!)) break
    }
    out.push(placeholder(codeBlocks.length))
    codeBlocks.push(block.join('\n'))
    i = j
  }
  return { text: out.join('\n'), codeBlocks }
}

export function restoreCode(text: string, codeBlocks: string[]): string {
  return text.replace(PLACEHOLDER_RE, (m, n: string) => codeBlocks[Number(n)] ?? m)
}

/** 按段落（空行）切分，保留每段末尾的空行，拼回去与原文完全一致 */
function paragraphs(lines: string[]): string[][] {
  const out: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    current.push(line)
    if (line.trim() === '') {
      out.push(current)
      current = []
    }
  }
  if (current.length > 0) out.push(current)
  return out
}

/**
 * 切分成适合单次翻译的片段：优先在标题处切，单个章节过长时再按段落切。
 * 片段用换行拼接即可还原原文；表格中间没有空行，不会被切开。
 */
export function splitChunks(text: string, maxChars = 4_000): string[] {
  const sections: string[][] = []
  for (const line of text.split('\n')) {
    if (HEADING.test(line) || sections.length === 0) sections.push([line])
    else sections.at(-1)!.push(line)
  }

  const chunks: string[] = []
  let current: string[] = []
  const size = (lines: string[]) => lines.reduce((n, l) => n + l.length + 1, 0)
  const flush = () => {
    if (current.length > 0) chunks.push(current.join('\n'))
    current = []
  }
  const add = (lines: string[]) => {
    if (current.length > 0 && size(current) + size(lines) > maxChars) flush()
    current.push(...lines)
  }

  for (const section of sections) {
    if (size(section) <= maxChars) add(section)
    else for (const p of paragraphs(section)) add(p)
  }
  flush()
  return chunks
}

/**
 * 片段里成句的英文单词数：只统计同一行里连续 4 个以上单词组成的词组。
 * 贡献者头像表、语言切换链接、徽章这类内容由标签或竖线隔开，每处只有一两个单词，不算正文。
 */
export function sentenceWords(chunk: string): number {
  const text = chunk
    .replace(PLACEHOLDER_RE, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '\n')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/<[^>]+>/g, '\n')
    .replace(/https?:\/\/\S+/g, '\n')
    .replace(/`[^`]*`/g, ' x ')
    .replace(/\|/g, '\n')
  let count = 0
  for (const run of text.match(/[A-Za-z][A-Za-z'’-]*(?:[,;:]?[ \t]+[A-Za-z][A-Za-z'’-]*){3,}/g) ?? []) count += run.split(/[ \t]+/).length
  return count
}

/** 片段里是否有需要翻译的自然语言（只有占位符、徽章、链接、名单的片段原样保留） */
export function hasProse(chunk: string): boolean {
  return sentenceWords(chunk) >= 4
}

/**
 * 判断片段正文主要是什么语言：有较多假名是日文；汉字占比高是中文；否则按英文处理。
 * 用于跳过"已经是目标语言"的片段（例如本来就用中文写的 README）。
 */
export function textLocale(chunk: string): 'zh' | 'ja' | 'en' {
  const prose = chunk.replace(PLACEHOLDER_RE, ' ').replace(/\]\([^)]*\)/g, ']').replace(/<[^>]+>/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/`[^`]*`/g, ' ')
  const kana = prose.match(/[぀-ヿ]/g)?.length ?? 0
  const han = prose.match(/[一-鿿]/g)?.length ?? 0
  const latin = prose.match(/[A-Za-z]/g)?.length ?? 0
  if (kana >= 10) return 'ja'
  // 英文单词平均约 5 个字母，大致相当于 1.5 个汉字的信息量
  return han >= 20 && han >= (latin / 5) * 1.5 ? 'zh' : 'en'
}

export interface ReadmeChunk {
  hash: string
  text: string
  prose: boolean
}

/** 原文 → 代码占位 → 切片，并为每个片段计算指纹（用于翻译记忆库） */
export function prepareReadmeChunks(markdown: string, maxChars?: number): { chunks: ReadmeChunk[]; codeBlocks: string[] } {
  const { text, codeBlocks } = protectCode(markdown)
  const chunks = splitChunks(text, maxChars).map((chunk) => ({
    hash: createHash('sha256').update(chunk).digest('hex'),
    text: chunk,
    prose: hasProse(chunk),
  }))
  return { chunks, codeBlocks }
}
