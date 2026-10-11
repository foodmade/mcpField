import { describe, expect, it } from 'vitest'
import type { Logger } from '../src/core/logger.ts'
import { normalizeSource, sourceHash } from '../src/translate/key.ts'
import { TranslateRunner } from '../src/translate/runner.ts'
import type { TranslationItem, TranslationResult, Translator } from '../src/translate/types.ts'
import { isHardFailure, protectedTokens, validateTranslation } from '../src/translate/validate.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }
const item = (text: string, name?: string): TranslationItem => ({ hash: sourceHash(text), text, name })
const result = (i: TranslationItem, texts: TranslationResult['texts'], sourceLocale: TranslationResult['sourceLocale'] = 'en'): TranslationResult => ({ hash: i.hash, sourceLocale, texts })

describe('原文指纹', () => {
  it('空白差异不影响指纹', () => {
    expect(sourceHash('  An  AI\nagent ')).toBe(sourceHash('An AI\nagent'))
    expect(normalizeSource(' a \n b ')).toBe('a b')
  })
})

describe('validateTranslation', () => {
  const src = item('Autonomous coding agent for VS Code, powered by OpenRouter and GPT-4o', 'Cline')

  it('合格的译文没有问题', () => {
    const r = result(src, {
      en: 'Autonomous coding agent for VS Code, powered by OpenRouter and GPT-4o',
      zh: '适用于 VS Code 的自主编码 Agent，基于 OpenRouter 和 GPT-4o',
      ja: 'OpenRouter と GPT-4o を活用した VS Code 向けの自律型コーディングエージェント',
    })
    expect(validateTranslation(src, r)).toEqual([])
  })

  it('专有名词丢失、日文写成中文、前面加了名称都会被发现', () => {
    const r = result(src, {
      en: 'Cline - Autonomous coding agent for VS Code, powered by OpenRouter and GPT-4o',
      zh: '适用于 VS Code 的自主编码代理，由开放路由驱动',
      ja: '这是适用于 VS Code 的自主编码代理，基于 OpenRouter 和 GPT-4o',
    })
    const problems = validateTranslation(src, r)
    expect(problems).toEqual(
      expect.arrayContaining([
        { code: 'missing_token', hard: false, locale: 'zh', detail: 'OpenRouter' },
        { code: 'chinese_in_ja', hard: true, locale: 'ja', detail: '这' },
        { code: 'name_added', hard: false, locale: 'en', detail: 'Cline' },
      ]),
    )
    expect(isHardFailure(problems)).toBe(true)
  })

  it('中文里出现假名、缺语言是硬性问题', () => {
    const r = result(src, { en: src.text, zh: 'エージェント', ja: '' })
    const codes = validateTranslation(src, r).map((p) => p.code)
    expect(codes).toContain('kana_in_zh')
    expect(codes).toContain('empty')
  })

  it('原文里的假名产品名可以留在中文里；全是汉字的短日文是正常的', () => {
    const a = item('MCP server for ”ゴママヨ”')
    expect(validateTranslation(a, result(a, { en: a.text, zh: '用于 ”ゴママヨ” 的 MCP 服务', ja: '”ゴママヨ” 用の MCP サーバー' }))).toEqual([])
    const b = item('Firefox Claude MCP extension')
    expect(validateTranslation(b, result(b, { en: b.text, zh: 'Firefox Claude MCP 扩展', ja: 'Firefox Claude MCP 拡張機能' }))).toEqual([])
  })

  it('只有名称或网址的文本不做语言检查', () => {
    const s = item('https://example.com')
    expect(validateTranslation(s, result(s, { en: s.text, zh: s.text, ja: s.text }, 'other'))).toEqual([])
  })

  it('通用缩写和普通复合词允许翻译，不算丢失', () => {
    expect(protectedTokens('Pack your repo into an AI-friendly file for LLMs and GenAI via DeepSeek')).toEqual(['DeepSeek'])
    expect(protectedTokens('MCP CLIENT for 36 U.S. agencies, see https://a.dev.')).toEqual(['https://a.dev'])
  })

  it('日文里混入简体字或中文词是硬性问题', () => {
    const s = item('A coding assistant for Claude Desktop')
    const problems = validateTranslation(s, result(s, { en: s.text, zh: '适用于 Claude Desktop 的编码助手', ja: 'Claude Desktop 向けのコーディング助手です' }))
    expect(problems).toEqual([{ code: 'chinese_in_ja', hard: true, locale: 'ja', detail: '助手' }])
    expect(isHardFailure(problems)).toBe(true)
  })

  it('识别需要原样保留的词', () => {
    expect(protectedTokens('Use `npx foo` with Node.js on macOS, see https://a.dev/x')).toEqual(expect.arrayContaining(['https://a.dev/x', '`npx foo`', 'Node.js', 'macOS']))
  })
})

describe('TranslateRunner', () => {
  it('跳过已完成的原文；硬性问题拆小重翻；软性问题标记为 review 保存', async () => {
    const items = [item('An open source AI agent for the terminal'), item('Already translated text here'), item('A desktop client for many models')]
    const calls: number[] = []
    let firstAttempt = true
    const translator: Translator = {
      provider: 'fake',
      model: 'fake-1',
      promptVersion: 1,
      async translate(batch) {
        calls.push(batch.length)
        const results = batch.map((i) => {
          // 第一次把第一条的日文写成中文，触发重翻
          const badJa = firstAttempt && i === items[0]
          return result(i, { en: i.text, zh: `中文：${i.text}`, ja: badJa ? '中文冒充日文的结果内容' : `日本語：${i.text}です` })
        })
        firstAttempt = false
        return { results, usage: { requests: 1, inputTokens: 10, outputTokens: 20 } }
      },
    }
    const saved: { hash: string; problems: number }[] = []
    const memory = {
      loadResults: async () => new Map(),
      restatus: async () => {},
      completed: async () => new Set([items[1]!.hash]),
      save: async (i: TranslationItem, _r: TranslationResult, problems: unknown[]) => {
        saved.push({ hash: i.hash, problems: problems.length })
      },
    }
    const stats = await new TranslateRunner(translator, memory, silent).run(items, { batchSize: 40, maxBatchChars: 8000, concurrency: 2 })
    expect(stats).toMatchObject({ sources: 3, pending: 2, failed: 0, requests: 2 })
    expect(calls).toEqual([2, 1])
    expect(saved.map((s) => s.hash).sort()).toEqual([items[0]!.hash, items[2]!.hash].sort())
    // "中文：" 前缀让长度比例异常，属于软性问题
    expect(stats.ok + stats.review).toBe(2)
  })
})
