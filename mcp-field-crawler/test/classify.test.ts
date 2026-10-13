import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLASSIFIER_SOURCE, inputFromDraft, needsClassification, systemPrompt, validateClassification, type ClassifyInput, type ClassifyResult } from '../src/classify/classifier.ts'
import { applyClassification, ClassifyRunner } from '../src/classify/runner.ts'
import { OTHER, slugsOf, TAXONOMY } from '../src/classify/taxonomy.ts'
import { DraftBuilder } from '../src/core/draft-builder.ts'
import type { EntityDraft } from '../src/core/draft.ts'
import { parseRepositoryUrl } from '../src/core/identity.ts'
import { ENTITY_KINDS } from '../src/core/types.ts'

const draft = (category?: { slug: string | null; value: string }) => {
  const b = new DraftBuilder(
    { kind: 'server', sourceId: 'mcp-registry', externalId: 'io.github.acme/weather', sourceUrl: 'u', slug: 'acme-weather', name: 'Acme Weather' },
    { isRemote: false, transports: [], packages: [{ registryType: 'npm', identifier: '@acme/weather' }], envVars: [], remotes: [], tools: [{ name: 'get_forecast', params: [] }] },
  )
    .identity({ repository: parseRepositoryUrl('https://github.com/acme/mcp/tree/main/weather') })
    .text('tagline', 'en', 'Forecasts for any city')
    .tags(['weather'])
  if (category) b.category(category.slug, category.value)
  return b.build() as EntityDraft
}

describe('taxonomy', () => {
  it('与网站的分类配置（mcp-field/src/lib/categories.ts）slug 一致', () => {
    const web = readFileSync(join(import.meta.dirname, '../../mcp-field/src/lib/categories.ts'), 'utf8')
    const lists: Record<string, string> = { server: 'serverCategories', client: 'clientCategories', cli: 'cliCategories', skill: 'skillCategories', loop: 'loopCategories', agent: 'agentCategories' }
    for (const kind of ENTITY_KINDS) {
      const block = new RegExp(`export const ${lists[kind]}: Category\\[\\] = \\[([\\s\\S]*?)\\n\\]`).exec(web)?.[1] ?? ''
      const slugs = [...block.matchAll(/slug: '([^']+)'/g)].map((m) => m[1])
      expect(slugs, kind).toEqual(slugsOf(kind))
    }
  })

  it('每个分类都有判定说明，slug 不重复，不包含"其他"', () => {
    for (const kind of ENTITY_KINDS) {
      expect(new Set(slugsOf(kind)).size).toBe(TAXONOMY[kind].length)
      expect(slugsOf(kind)).not.toContain(OTHER)
      for (const c of TAXONOMY[kind]) expect(c.definition.length).toBeGreaterThan(10)
    }
    expect(systemPrompt('server')).toContain('- security:')
  })
})

describe('分类输入与判定', () => {
  it('来源没有分类、或映射为"其他"的需要分类；分类器写入的不算来源分类', () => {
    expect(needsClassification(draft())).toBe(true)
    expect(needsClassification(draft({ slug: null, value: 'Other' }))).toBe(true)
    expect(needsClassification(draft({ slug: 'finance', value: 'Finance & Commerce' }))).toBe(false)
    expect(needsClassification(draft({ slug: 'travel', value: CLASSIFIER_SOURCE }))).toBe(true)
  })

  it('输入取名称、简介、标签、工具、包名、仓库；分类器写入的分类不影响指纹', () => {
    const input = inputFromDraft(draft(), '# Weather\n\nGet forecasts.', 10)
    expect(input).toMatchObject({ name: 'Acme Weather', tagline: 'Forecasts for any city', tags: ['weather'], tools: ['get_forecast'], packages: ['@acme/weather'], repository: 'acme/mcp/weather', sourceCategory: null, readme: '# Weather\n\nGet forecasts.' })
    expect(inputFromDraft(draft({ slug: 'travel', value: CLASSIFIER_SOURCE }), '# Weather\n\nGet forecasts.', 10).inputHash).toBe(input.inputHash)
    expect(inputFromDraft(draft({ slug: null, value: 'Other' }), '', 10).sourceCategory).toBe('Other')
  })

  it('主分类不在分类体系里要重做；把握低于 50 待复核', () => {
    const input = inputFromDraft(draft(), '', null)
    const result = (primary: string, confidence: number): ClassifyResult => ({ key: 'k', primary, secondary: [], confidence })
    expect(validateClassification(input, result('travel', 90))).toEqual([])
    expect(validateClassification(input, result(OTHER, 90))).toEqual([])
    expect(validateClassification(input, result('weather', 90))[0]).toMatchObject({ code: 'unknown_category', hard: true })
    expect(validateClassification(input, result('travel', 30))[0]).toMatchObject({ code: 'low_confidence', hard: false })
  })

  it('发布时写入分类器结果；来源已有分类或结果为"其他"时不动', () => {
    const d = draft()
    applyClassification(d, { primary: 'travel', secondary: ['science'], confidence: 80, status: 'ok' })
    expect(d.categories).toEqual([
      { slug: 'travel', sourceValue: CLASSIFIER_SOURCE, primary: true },
      { slug: 'science', sourceValue: CLASSIFIER_SOURCE, primary: false },
    ])
    const sourced = draft({ slug: 'finance', value: 'Finance & Commerce' })
    applyClassification(sourced, { primary: 'travel', secondary: [], confidence: 80, status: 'ok' })
    expect(sourced.categories[0]!.slug).toBe('finance')
    const other = draft()
    applyClassification(other, { primary: OTHER, secondary: [], confidence: 80, status: 'ok' })
    expect(other.categories).toEqual([])
  })
})

describe('ClassifyRunner', () => {
  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never
  const input = (id: string, kind: ClassifyInput['kind'] = 'server'): ClassifyInput => ({ ...inputFromDraft(draft(), '', null), externalId: id, kind, inputHash: `h-${id}` })

  it('跳过输入没变的；按类型分批调用；保存结果并统计', async () => {
    const calls: string[][] = []
    const saved: [string, string, string][] = []
    const classifier = {
      model: 'm',
      classify: async (batch: ClassifyInput[]) => {
        calls.push(batch.map((i) => `${i.kind}/${i.externalId}`))
        return { results: batch.map((i) => ({ key: `${i.sourceId}:${i.kind}:${i.externalId}`, primary: i.kind === 'server' ? 'travel' : 'ide', secondary: [], confidence: i.externalId === 'b' ? 20 : 90 })), usage: { requests: 1, inputTokens: 1, outputTokens: 1 } }
      },
    }
    const store = {
      existing: async () => new Map([['mcp-registry:server:done', { inputHash: 'h-done', promptVersion: 99 }]]),
      save: async (i: ClassifyInput, r: ClassifyResult, problems: unknown[]) => void saved.push([i.externalId, r.primary, problems.length ? 'review' : 'ok']),
    }
    const stats = await new ClassifyRunner(classifier, store, logger).run([input('a'), input('b'), input('done'), input('c', 'client')], { batchSize: 25, maxBatchChars: 100_000, concurrency: 1 })
    expect(calls).toEqual([['server/a', 'server/b'], ['client/c']])
    expect(saved).toEqual([
      ['a', 'travel', 'ok'],
      ['b', 'travel', 'review'],
      ['c', 'ide', 'ok'],
    ])
    expect(stats).toMatchObject({ inputs: 4, pending: 3, ok: 2, review: 1, failed: 0, requests: 2 })
  })
})
