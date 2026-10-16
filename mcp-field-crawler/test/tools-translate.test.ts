import { describe, expect, it } from 'vitest'
import type { ToolDraft } from '../src/core/draft.ts'
import { blockHash, normalizeBlock, normalizeSource, sourceHash } from '../src/translate/key.ts'
import type { TranslationReader } from '../src/translate/memory.ts'
import type { TranslationItem, TranslationResult } from '../src/translate/types.ts'
import { localizeTools, toolTexts, validateToolTranslation } from '../src/tools/translate.ts'

const SENTRY = 'Retrieve and analyze a Sentry issue by ID or URL. Use this tool when you need to:\n- Investigate production errors and crashes\n- Review error counts and status'

describe('多行原文规范化', () => {
  it('保留换行和列表，去掉行首尾空白、行内多余空白和多余空行', () => {
    expect(normalizeBlock('  Get  issue:\r\n  - first \n\n\n\n- second\t ')).toBe('Get issue:\n- first\n\n- second')
  })

  it('单行文本与简介的规范化结果、指纹相同', () => {
    const text = '  Sentry issue  ID or URL to analyze '
    expect(normalizeBlock(text)).toBe(normalizeSource(text))
    expect(blockHash(text)).toBe(sourceHash(text))
  })
})

describe('toolTexts', () => {
  it('收集工具描述和参数说明，跳过空的和只有符号的', () => {
    const tools: ToolDraft[] = [
      {
        name: 'get_sentry_issue',
        description: SENTRY,
        params: [
          { path: 'issue_id_or_url', description: 'Sentry issue ID or URL to analyze', required: true },
          { path: 'limit', description: ' 1-100 ', required: false },
          { path: 'cursor', required: false },
        ],
      },
      { name: 'ping', description: '  ', params: [] },
    ]
    expect(toolTexts(tools)).toEqual([
      { name: 'get_sentry_issue', text: SENTRY },
      { name: 'get_sentry_issue.issue_id_or_url', text: 'Sentry issue ID or URL to analyze' },
    ])
  })
})

describe('validateToolTranslation', () => {
  const item = (text: string, name?: string): TranslationItem => ({ hash: blockHash(text), text, name })
  const result = (i: TranslationItem, texts: TranslationResult['texts']): TranslationResult => ({ hash: i.hash, sourceLocale: 'en', texts })

  it('合格的译文没有问题', () => {
    const src = item(SENTRY, 'get_sentry_issue')
    const r = result(src, {
      en: SENTRY,
      zh: '按 ID 或 URL 获取并分析 Sentry issue。在以下情况使用此工具：\n- 排查线上错误和崩溃\n- 查看错误次数和状态',
      ja: 'ID または URL で Sentry の issue を取得・分析します。次の場合に使用します：\n- 本番環境のエラーやクラッシュの調査\n- エラー件数とステータスの確認',
    })
    expect(validateToolTranslation(src, r)).toEqual([])
  })

  it('标识符被翻译、行数变化都记为待抽查', () => {
    const src = item('Pass the project_id first.\nThen call list_issues.', 'list_issues')
    const r = result(src, {
      en: src.text,
      zh: '先传入项目 ID。然后调用 list_issues。',
      ja: 'まず project_id を渡します。\n次に list_issues を呼び出します。',
    })
    const problems = validateToolTranslation(src, r)
    expect(problems).toEqual(
      expect.arrayContaining([
        { code: 'missing_token', hard: false, locale: 'zh', detail: 'project_id' },
        { code: 'line_count', hard: false, locale: 'zh', detail: '1/2' },
      ]),
    )
    expect(problems.every((p) => p.locale === 'zh' && !p.hard)).toBe(true)
  })
})

describe('localizeTools', () => {
  it('按多行指纹替换工具描述和参数说明，没有译文的保留原文', async () => {
    const translations = new Map([
      [blockHash(SENTRY), '按 ID 或 URL 获取并分析 Sentry issue。'],
      [blockHash('Sentry issue ID or URL to analyze'), '要分析的 Sentry issue ID 或 URL'],
    ])
    const asked: string[][] = []
    const reader: TranslationReader = {
      lookup: async (hashes) => {
        asked.push(hashes)
        return new Map(hashes.flatMap((h) => (translations.has(h) ? [[h, translations.get(h)!] as const] : [])))
      },
    }
    const tools = [
      { description: `  ${SENTRY}\n`, params: [{ description: 'Sentry issue ID or URL to analyze' }, { description: 'Not translated yet' }, { description: null }] },
    ]
    await localizeTools(tools, reader, 'zh')
    expect(tools[0]!.description).toBe('按 ID 或 URL 获取并分析 Sentry issue。')
    expect(tools[0]!.params.map((p) => p.description)).toEqual(['要分析的 Sentry issue ID 或 URL', 'Not translated yet', null])
    expect(asked).toHaveLength(1)
  })
})
