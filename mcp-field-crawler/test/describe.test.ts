import { describe, expect, it } from 'vitest'
import type { SourceRecord } from '../src/core/types.ts'
import type { Logger } from '../src/core/logger.ts'
import { longestCopiedCjkRun } from '../src/llm/checks.ts'
import { DescribeRunner } from '../src/describe/runner.ts'
import { describeKey, type DescribeContent, type DescribeInput, type DescribeResult, type DescribeWriter } from '../src/describe/types.ts'
import { validateDescription } from '../src/describe/validate.ts'
import { mcpSoDescribeInput } from '../src/sources/mcpso/describe-facts.ts'

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent }
const record = (kind: SourceRecord['kind'], item: Record<string, unknown>): SourceRecord => ({ sourceId: 'mcpso', kind, externalId: String(item.slug), url: 'https://mcp.so/x', parserVersion: 1, fetchedAt: new Date(), data: { item } })

const LOOP_ITEM = {
  slug: 'ci-watch',
  name: 'CI Watch',
  category: 'CI',
  type: 'interval',
  maxIterations: 12,
  checkCommand: 'gh run list --limit 1',
  goal: 'latest CI run is green.',
  exitCondition: 'run conclusion is success.',
  summary: 'SOURCE-AUTHORED SUMMARY',
  kickoffPrompt: 'SOURCE-AUTHORED PROMPT',
  steps: JSON.stringify([
    { title: 'Check CI', command: 'gh run list --limit 1', description: 'SOURCE-AUTHORED STEP' },
    { title: 'Fix', command: 'npm test', description: 'SOURCE-AUTHORED STEP 2' },
  ]),
  supportedAgents: JSON.stringify([{ name: 'Cursor', active: true }, { name: 'Old', active: false }]),
}

describe('mcp.so 事实整理', () => {
  it('Loop 只传事实：不包含源站撰写的简介、提示词和步骤说明', () => {
    const input = mcpSoDescribeInput(record('loop', LOOP_ITEM))!
    expect(JSON.stringify(input)).not.toContain('SOURCE-AUTHORED')
    expect(input.commands).toEqual(['gh run list --limit 1', 'npm test'])
    expect(input.facts).toMatchObject({ trigger: 'interval', maxRounds: 12, checkCommand: 'gh run list --limit 1', supportedAgents: ['Cursor'] })
    expect(input.background).toEqual({})
  })

  it('CLI 的一句话说明只作为背景；输入不变时指纹不变', () => {
    const item = { slug: 'gh', name: 'GitHub CLI', command: 'gh', repository: 'cli/cli', description: { en: 'GitHub on the command line.', zh: '命令行里的 GitHub。' }, capabilities: { en: ['Pull requests'] } }
    const a = mcpSoDescribeInput(record('cli', item))!
    expect(a.background).toEqual({ en: 'GitHub on the command line.', zh: '命令行里的 GitHub。' })
    expect(a.facts).toMatchObject({ command: 'gh', repository: 'https://github.com/cli/cli', capabilityLabels: ['Pull requests'] })
    expect(mcpSoDescribeInput(record('cli', item))!.inputHash).toBe(a.inputHash)
  })
})

const content = (over: Partial<DescribeContent> = {}): DescribeContent => ({
  tagline: 'A loop that keeps CI green',
  summary: 'Runs the test suite each round and repairs failures until the pipeline passes.',
  features: ['Stops after twelve rounds', 'Uses the GitHub CLI'],
  useCases: ['Before merging a branch'],
  goal: 'The newest pipeline run on the branch passes',
  exitCondition: 'Stop once the newest pipeline run reports success',
  steps: [
    { title: 'Read pipeline status', body: 'Query the newest run.', commandIndex: 0 },
    { title: 'Repair failures', body: 'Fix what broke and rerun the tests.', commandIndex: 1 },
  ],
  ...over,
})
const zh = (): DescribeContent => ({
  ...content(),
  tagline: '让 CI 保持通过的循环',
  summary: '每轮运行测试并修复失败，直到流水线通过。',
  features: ['最多十二轮', '使用 GitHub CLI'],
  useCases: ['合并分支之前'],
  goal: '分支上最新的流水线运行通过',
  exitCondition: '最新流水线运行成功时停止',
  steps: [
    { title: '读取流水线状态', body: '查询最新一次运行。', commandIndex: 0 },
    { title: '修复失败', body: '修复问题并重新运行测试。', commandIndex: 1 },
  ],
})
const ja = (): DescribeContent => ({
  ...content(),
  tagline: 'CI を通過させ続けるループ',
  summary: '各ラウンドでテストを実行し、パイプラインが通るまで失敗を修正します。',
  features: ['最大 12 ラウンド', 'GitHub CLI を使用'],
  useCases: ['ブランチをマージする前'],
  goal: 'ブランチの最新パイプラインが成功すること',
  exitCondition: '最新のパイプラインが成功したら終了します',
  steps: [
    { title: 'パイプラインの状態を確認', body: '最新の実行を確認します。', commandIndex: 0 },
    { title: '失敗を修正', body: '問題を修正してテストを再実行します。', commandIndex: 1 },
  ],
})

describe('validateDescription', () => {
  const input = mcpSoDescribeInput(record('loop', LOOP_ITEM))!
  const result = (en = content()): DescribeResult => ({ key: describeKey(input), content: { en, zh: zh(), ja: ja() } })

  it('原创且结构完整的内容没有硬性问题', () => {
    expect(validateDescription(input, result()).filter((p) => p.hard)).toEqual([])
  })

  it('沿用参考文字的措辞、步骤与命令对不上都是硬性问题', () => {
    const cli = mcpSoDescribeInput(record('cli', { slug: 'gh', name: 'GitHub CLI', command: 'gh', description: { en: 'Work with GitHub pull requests, issues and releases straight from your terminal session.' } }))!
    const copied = content({ summary: 'It lets you work with GitHub pull requests, issues and releases straight from the shell.', steps: undefined, goal: undefined, exitCondition: undefined })
    const cliResult: DescribeResult = { key: describeKey(cli), content: { en: copied, zh: { ...zh(), steps: undefined }, ja: { ...ja(), steps: undefined } } }
    expect(validateDescription(cli, cliResult).filter((p) => p.hard).map((p) => p.code)).toContain('copied_from_source')
    const bad = content({ steps: [{ title: 'Only step', body: 'x', commandIndex: 5 }, { title: 'b', body: 'y', commandIndex: 1 }] })
    expect(validateDescription(input, result(bad)).map((p) => p.code)).toEqual(expect.arrayContaining(['unknown_command', 'steps_mismatch']))
  })

  it('中文照抄检测', () => {
    expect(longestCopiedCjkRun('这是命令行里的 GitHub 工具', '命令行里的 GitHub。')).toBe(5)
  })
})

describe('DescribeRunner', () => {
  it('输入没变的跳过；按类型选模型', async () => {
    const loop = mcpSoDescribeInput(record('loop', LOOP_ITEM))!
    const cli = mcpSoDescribeInput(record('cli', { slug: 'gh', name: 'GitHub CLI', command: 'gh', description: { en: 'GitHub on the command line.' } }))!
    const used: string[] = []
    const writer = (model: string): DescribeWriter => ({
      provider: 'fake',
      model,
      promptVersion: 1,
      async write(items: DescribeInput[]) {
        used.push(...items.map((i) => `${model}:${i.kind}`))
        return { results: items.map((i) => ({ key: describeKey(i), content: { en: content(), zh: zh(), ja: ja() } })), usage: { requests: 1, inputTokens: 1, outputTokens: 1 } }
      },
    })
    const saved: string[] = []
    const store = {
      existing: async () => new Map([[describeKey(cli), { inputHash: cli.inputHash, promptVersion: 1, locales: 3 }]]),
      save: async (i: DescribeInput) => void saved.push(i.externalId),
    }
    const stats = await new DescribeRunner((k) => writer(k === 'loop' ? 'sonnet' : 'haiku'), store, silent).run([loop, cli], { concurrency: 1 })
    expect(used).toEqual(['sonnet:loop'])
    expect(saved).toEqual(['ci-watch'])
    expect(stats).toMatchObject({ inputs: 2, pending: 1, ok: 1, failed: 0 })
  })
})

describe('输出容错', () => {
  it('把写成 JSON 字符串的数组还原', async () => {
    const { unwrapJsonStrings } = await import('../src/llm/claude.ts')
    expect(unwrapJsonStrings({ items: '[{"id":"1"}]', note: 'plain' })).toEqual({ items: [{ id: '1' }], note: 'plain' })
  })
})
