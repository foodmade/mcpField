import { describe, expect, it } from 'vitest'
import type { Logger } from '../src/core/logger.ts'
import { NoToolOutputError } from '../src/llm/claude.ts'
import { hasProse, prepareReadmeChunks, protectCode, restoreCode, splitChunks, textLocale } from '../src/readme/chunk.ts'
import { ReadmeTranslateRunner } from '../src/readme/runner.ts'
import type { ReadmeTarget } from '../src/readme/store.ts'
import type { ReadmeTranslator } from '../src/readme/translator.ts'
import { validateReadmeChunk } from '../src/readme/validate.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }

const README = `# Demo

[![ci](https://img.shields.io/x.svg)](https://ci.example.com)

Demo connects your editor to several model providers and keeps a local history of every session.

## Install

Run the installer and then open the settings page to add your first server.

\`\`\`bash
npm install -g demo
demo --version
\`\`\`

<!-- internal note -->

## Usage

| Option | Meaning |
| --- | --- |
| \`--port\` | Port to listen on |

See the [guide](https://docs.example.com/guide) for more examples.
`

describe('代码块占位与切片', () => {
  it('代码块替换成占位符、去掉 HTML 注释，还原后代码完全一致', () => {
    const { text, codeBlocks } = protectCode(README)
    expect(codeBlocks).toEqual(['```bash\nnpm install -g demo\ndemo --version\n```'])
    expect(text).toContain('⟦CODE 0⟧')
    expect(text).not.toContain('internal note')
    expect(restoreCode(text, codeBlocks)).toContain('npm install -g demo')
  })

  it('切片后用换行拼接能完全还原；按标题切分且不超过上限', () => {
    const { text } = protectCode(README)
    const chunks = splitChunks(text, 160)
    expect(chunks.join('\n')).toBe(text)
    expect(chunks.length).toBeGreaterThan(1)
    // 超过上限的只可能是无法再切的单个段落
    expect(chunks.every((c) => c.length <= 160 || !c.trim().includes('\n\n'))).toBe(true)
  })

  it('只有徽章、占位符、名单、语言切换的片段不需要翻译', () => {
    expect(hasProse('[![ci](https://img.shields.io/x.svg)](https://ci.example.com)\n⟦CODE 0⟧')).toBe(false)
    expect(hasProse('<table><tr><td><a href="https://github.com/alice"><sub><b>Alice Smith</b></sub></a></td><td><a href="https://github.com/bob"><sub><b>bob</b></sub></a></td></tr></table>')).toBe(false)
    expect(hasProse('<div align="center"><sub>English | <a href="README.zh.md">简体中文</a> | <a href="README.ja.md">日本語</a></sub></div>')).toBe(false)
    expect(hasProse('Run the installer and open settings.')).toBe(true)
  })
})

describe('textLocale', () => {
  it('识别片段语言', () => {
    expect(textLocale('基于 Model Context Protocol 的智能聊天应用，支持多种大模型和工具调用，界面简洁易用。')).toBe('zh')
    expect(textLocale('Model Context Protocol に対応したチャットアプリです。複数のモデルとツールを利用できます。')).toBe('ja')
    expect(textLocale('A chat app built on the Model Context Protocol with support for many models.')).toBe('en')
  })
})

describe('validateReadmeChunk', () => {
  it('页内锚点变化和中文原文不算问题', () => {
    const src = '## Contents\n\n- [Install](#install)\n- [Usage](#usage)\n\nThis section explains how to install and use the tool in different environments.'
    const out = '## 目录\n\n- [安装](#安装)\n- [用法](#用法)\n\n本节说明如何在不同环境中安装和使用该工具。'
    expect(validateReadmeChunk(src, out, 'zh').filter((p) => p.hard)).toEqual([])
    const zhSrc = '# 聊天应用\n\n基于 Model Context Protocol 的智能聊天应用，支持 OpenAI、Anthropic、DeepSeek 等多种模型。' + ' config value'.repeat(30)
    expect(validateReadmeChunk(zhSrc, zhSrc, 'zh').filter((p) => p.code === 'not_translated')).toEqual([])
  })

  const src = '## Usage\n\nSee the [guide](https://docs.example.com/guide) and run `demo --help` for options that are useful.\n\n⟦CODE 0⟧'
  it('合格的译文没有硬性问题', () => {
    const out = '## 用法\n\n参阅[指南](https://docs.example.com/guide)，运行 `demo --help` 查看可用选项。\n\n⟦CODE 0⟧'
    expect(validateReadmeChunk(src, out, 'zh').filter((p) => p.hard)).toEqual([])
  })
  it('丢了占位符或链接地址是硬性问题', () => {
    const out = '## 用法\n\n参阅指南，运行 `demo --help` 查看可用选项。'
    const codes = validateReadmeChunk(src, out, 'zh').map((p) => p.code)
    expect(codes).toEqual(expect.arrayContaining(['placeholder_mismatch', 'missing_url']))
  })
})

describe('ReadmeTranslateRunner', () => {
  const target = (externalId: string, stars: number): ReadmeTarget => ({ sourceId: 'mcpso', kind: 'client', externalId, name: externalId, license: 'MIT', readme: README, readmeHash: 'h', stars })
  type Memory = Map<string, { content: string; status: string; model: string | null; promptVersion: number; origin: string }>
  const fakeMemory = (memory: Memory) => ({
    lookupDetailed: async (hashes: string[], locale: string) => new Map(hashes.filter((h) => memory.has(`${h}:${locale}`)).map((h) => [h, memory.get(`${h}:${locale}`)!])),
    saveSingle: async (source: { hash: string }, locale: string, content: string, problems: unknown[], meta: { model: string }) => {
      memory.set(`${source.hash}:${locale}`, { content, status: problems.length ? 'review' : 'ok', model: meta.model, promptVersion: 1, origin: 'translated' })
    },
  })

  it('相同片段只翻一次；拼装后代码块原样保留；两种语言各存一篇', async () => {
    const calls: string[] = []
    const translator = (model: string): ReadmeTranslator => ({
      provider: 'fake',
      model,
      promptVersion: 1,
      async translate(chunk, locale) {
        calls.push(`${model}:${locale}`)
        // 逐行"翻译"：标题和普通正文换成中日文，带链接、占位符、表格的行原样保留
        const prose = locale === 'zh' ? '这是一段译文内容。' : 'これは翻訳された文章です。'
        const text = chunk
          .split('\n')
          .map((line) => {
            if (!line.trim() || line.includes('](') || line.includes('⟦') || line.startsWith('|')) return line
            const heading = /^(#{1,6}\s)/.exec(line)
            return heading ? `${heading[1]}${prose}` : prose
          })
          .join('\n')
        return { text, usage: { requests: 1, inputTokens: 1, outputTokens: 1 } }
      },
    })
    const saved: { key: string; content: string }[] = []
    const runner = new ReadmeTranslateRunner(
      { standard: translator('haiku'), premium: translator('sonnet'), premiumMinStars: 1000 },
      fakeMemory(new Map()),
      { existing: async () => new Map(), save: async (t, locale, data) => void saved.push({ key: `${t.externalId}:${locale}`, content: data.content }) },
      silent,
    )
    const { chunks } = prepareReadmeChunks(README)
    const prose = chunks.filter((c) => c.prose).length
    const stats = await runner.run([target('a', 10), target('b', 5000)], { locales: ['zh', 'ja'], concurrency: 2 })

    // 两个条目内容相同：每个片段每种语言只翻一次；有热门条目共享时用强模型
    expect(stats.work).toBe(prose * 2)
    expect(calls.every((c) => c.startsWith('sonnet'))).toBe(true)
    expect(saved.map((s) => s.key).sort()).toEqual(['a:ja', 'a:zh', 'b:ja', 'b:zh'])
    expect(saved[0]!.content).toContain('npm install -g demo')
    expect(saved[0]!.content).toContain('https://docs.example.com/guide')
  })

  it('热门档模型被限流（429）时改用普通档，并暂停热门档；译文记的是实际用的模型', async () => {
    const calls: string[] = []
    const fake = (model: string, fail?: boolean): ReadmeTranslator => ({
      provider: 'fake',
      model,
      promptVersion: 1,
      async translate(chunk, locale) {
        calls.push(model)
        if (fail) throw Object.assign(new Error('rate limited'), { status: 429 })
        const prose = locale === 'zh' ? '这是一段译文内容。' : 'これは翻訳された文章です。'
        const text = chunk
          .split('\n')
          .map((line) => (!line.trim() || line.includes('](') || line.includes('⟦') || line.startsWith('|') ? line : /^#{1,6}\s/.test(line) ? `## ${prose}` : prose))
          .join('\n')
        return { text, usage: { requests: 1, inputTokens: 1, outputTokens: 1 } }
      },
    })
    const memory: Memory = new Map()
    const runner = new ReadmeTranslateRunner({ standard: fake('mimo'), premium: fake('haiku', true), premiumMinStars: 1000 }, fakeMemory(memory), { existing: async () => new Map(), save: async () => {} }, silent)
    const stats = await runner.run([target('hot', 5000)], { locales: ['zh'], concurrency: 1 })

    // 第一次被拒后暂停热门档，后面的片段不再请求它
    expect(calls.filter((c) => c === 'haiku')).toHaveLength(1)
    expect(stats.fallback).toBe(stats.work)
    expect(stats.failed).toBe(0)
    expect([...memory.values()].every((t) => t.model === 'mimo')).toBe(true)
  })

  it('普通档被限流时改用后备模型（可以是另一个模型服务），暂停期间不再请求普通档', async () => {
    const calls: string[] = []
    const fake = (model: string, fail?: boolean): ReadmeTranslator => ({
      provider: model === 'gpt-6-luna' ? 'openai' : 'opencode',
      model,
      promptVersion: 1,
      async translate(chunk, locale) {
        calls.push(model)
        if (fail) throw Object.assign(new Error('Go usage limit exceeded'), { status: 429 })
        const prose = locale === 'zh' ? '这是一段译文内容。' : 'これは翻訳された文章です。'
        const text = chunk
          .split('\n')
          .map((line) => (!line.trim() || line.includes('](') || line.includes('⟦') || line.startsWith('|') ? line : /^#{1,6}\s/.test(line) ? `## ${prose}` : prose))
          .join('\n')
        return { text, usage: { requests: 1, inputTokens: 1, outputTokens: 1 } }
      },
    })
    const memory: Memory = new Map()
    const runner = new ReadmeTranslateRunner(
      { standard: fake('deepseek-v4.1-flash', true), premiumMinStars: 1000, fallback: fake('gpt-6-luna') },
      fakeMemory(memory),
      { existing: async () => new Map(), save: async () => {} },
      silent,
    )
    const stats = await runner.run([target('a', 10)], { locales: ['zh'], concurrency: 1 })

    expect(calls.filter((c) => c === 'deepseek-v4.1-flash')).toHaveLength(1)
    expect(stats.fallback).toBe(stats.work)
    expect(stats.failed).toBe(0)
    expect([...memory.values()].every((t) => t.model === 'gpt-6-luna')).toBe(true)
  })

  it('限流以外的错误不切换模型', async () => {
    const calls: string[] = []
    const failing: ReadmeTranslator = { provider: 'opencode', model: 'deepseek', promptVersion: 1, translate: async () => (calls.push('deepseek'), Promise.reject(Object.assign(new Error('bad request'), { status: 400 }))) }
    const backup: ReadmeTranslator = { provider: 'openai', model: 'gpt', promptVersion: 1, translate: async () => (calls.push('gpt'), Promise.reject(new Error('不应调用'))) }
    const runner = new ReadmeTranslateRunner({ standard: failing, premiumMinStars: 1000, fallback: backup }, fakeMemory(new Map()), { existing: async () => new Map(), save: async () => {} }, silent)
    const stats = await runner.run([target('a', 10)], { locales: ['zh'], concurrency: 1 })
    expect(calls.every((c) => c === 'deepseek')).toBe(true)
    expect(stats.fallback).toBe(0)
    expect(stats.failed).toBe(stats.work)
  })

  describe('内容上多次失败的片段', () => {
    const translateLines = (chunk: string, locale: string) => {
      const prose = locale === 'zh' ? '这是一段译文内容。' : 'これは翻訳された文章です。'
      return chunk
        .split('\n')
        .map((line) => (!line.trim() || line.includes('](') || line.includes('⟦') || line.startsWith('|') ? line : /^#{1,6}\s/.test(line) ? `## ${prose}` : prose))
        .join('\n')
    }
    const fakeFailures = (failed: Set<string>) => {
      const recorded: { hash: string; locale: string; reason: string; model: string }[] = []
      return { recorded, lookup: async (hashes: string[]) => new Set(hashes.filter((h) => failed.has(h))), record: async (hash: string, locale: string, reason: string, model: string) => void recorded.push({ hash, locale, reason, model }) }
    }
    const allHashes = () => prepareReadmeChunks(README).chunks.filter((c) => c.prose).map((c) => c.hash)

    it('默认跳过失败过的片段（记为 deferred），--retry-failed 时照常翻译', async () => {
      const calls: string[] = []
      const translator: ReadmeTranslator = { provider: 'fake', model: 'm', promptVersion: 1, translate: async (chunk, locale) => (calls.push(locale), { text: translateLines(chunk, locale), usage: { requests: 1, inputTokens: 1, outputTokens: 1 } }) }
      const failures = fakeFailures(new Set(allHashes()))
      const make = () => new ReadmeTranslateRunner({ standard: translator, premiumMinStars: 1000 }, fakeMemory(new Map()), { existing: async () => new Map(), save: async () => {} }, silent, undefined, failures)

      const skipped = await make().run([target('a', 10)], { locales: ['zh'], concurrency: 1 })
      expect(calls).toHaveLength(0)
      expect(skipped.work).toBe(0)
      expect(skipped.deferred).toBe(allHashes().length)

      const retried = await make().run([target('a', 10)], { locales: ['zh'], concurrency: 1, retryFailed: true })
      expect(calls).toHaveLength(allHashes().length)
      expect(retried.deferred).toBe(0)
      expect(retried.ok).toBe(allHashes().length)
    })

    it('校验多次不合格、没按格式返回时记下来；503 这类请求错误不记', async () => {
      const run = async (translate: ReadmeTranslator['translate']) => {
        const failures = fakeFailures(new Set())
        const runner = new ReadmeTranslateRunner({ standard: { provider: 'fake', model: 'deepseek', promptVersion: 1, translate }, premiumMinStars: 1000 }, fakeMemory(new Map()), { existing: async () => new Map(), save: async () => {} }, silent, undefined, failures)
        const stats = await runner.run([target('a', 10)], { locales: ['zh'], concurrency: 1 })
        return { stats, recorded: failures.recorded }
      }
      const usage = { requests: 1, inputTokens: 1, outputTokens: 1 }

      // 原样返回英文：校验不通过，重做 3 次仍不合格
      const invalid = await run(async (chunk) => ({ text: chunk, usage }))
      expect(invalid.stats.failed).toBe(allHashes().length)
      expect(invalid.recorded).toHaveLength(allHashes().length)
      expect(invalid.recorded.every((r) => r.model === 'deepseek' && r.locale === 'zh' && r.reason.length > 0)).toBe(true)

      const noTag = await run(async () => Promise.reject(new NoToolOutputError()))
      expect(noTag.recorded.map((r) => r.reason)).toEqual(allHashes().map(() => 'NoToolOutputError'))

      const unavailable = await run(async () => Promise.reject(Object.assign(new Error('Service temporarily unavailable'), { status: 503 })))
      expect(unavailable.stats.failed).toBe(allHashes().length)
      expect(unavailable.recorded).toHaveLength(0)
    })
  })

  it('目标不带正文时按片读出、处理完释放；读不到正文的跳过', async () => {
    // 本来就是中文的 README：译成中文时不用调用模型，直接算"同语言"
    const zhReadme = '# 演示\n\n这是一个用来测试的中文说明文档，介绍如何安装和使用这个工具。'
    const lazy = (externalId: string): ReadmeTarget => ({ sourceId: 'mcpso', kind: 'client', externalId, name: externalId, license: 'MIT', readmeKey: `readme:${externalId}`, readmeHash: 'old', stars: 1 })
    const targets = [lazy('a'), lazy('b'), lazy('gone')]
    const slices: string[][] = []
    const neverCalled: ReadmeTranslator = { provider: 'fake', model: 'm', promptVersion: 1, translate: async () => { throw new Error('不应调用模型') } }
    const runner = new ReadmeTranslateRunner(
      { standard: neverCalled, premiumMinStars: 1000 },
      fakeMemory(new Map()),
      { existing: async () => new Map(), save: async () => {} },
      silent,
      async (slice) => {
        slices.push(slice.map((t) => t.externalId))
        // 已删除的 README 读不到
        for (const t of slice) if (t.externalId !== 'gone') t.readme = zhReadme
      },
    )
    const stats = await runner.run(targets, { locales: ['zh'], concurrency: 1, sliceSize: 2 })
    expect(slices).toEqual([['a', 'b'], ['gone']])
    expect(stats.sameLanguage).toBe(2)
    expect(targets.every((t) => t.readme === undefined)).toBe(true)
  })
})
