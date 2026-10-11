import { and, asc, eq, inArray } from 'drizzle-orm'
import { withDeadlockRetry } from '../db/retry.ts'
import { LOCALES, type EntityKind, type Locale } from '../core/types.ts'
import type { Db } from '../db/client.ts'
import { ingestGeneratedSteps, ingestGeneratedTexts } from '../db/schema/index.ts'
import type { Problem } from '../llm/batch.ts'
import type { OverviewStore } from '../overview/store.ts'
import { describeKey, type DescribeInput, type DescribeResult, type DescribeWriter } from './types.ts'

type Ref = { sourceId: string; kind: EntityKind; externalId: string }

export interface Playbook {
  locale: Locale
  goal: string | null
  exitCondition: string | null
  steps: { position: number; title: string; body: string | null; command: string | null }[]
}

/** 接口层读取生成内容的接口 */
export interface GeneratedReader {
  /** 一句话简介；请求的语言没有时退回英文 */
  taglines(kind: EntityKind, externalIds: string[], locale: Locale, sourceId?: string): Promise<Map<string, string>>
  playbook(ref: Ref, locale: Locale): Promise<Playbook | null>
}

const where = (t: typeof ingestGeneratedTexts | typeof ingestGeneratedSteps, ref: Ref) =>
  and(eq(t.sourceId, ref.sourceId), eq(t.kind, ref.kind), eq(t.externalId, ref.externalId))

/**
 * 生成内容的存储：短文本（简介、目标、退出条件）和 Loop 步骤各存一张表，每种语言一行；
 * 概述、主要功能、适用场景复用 AI 介绍的表（ingest_overviews），详情页"关于"区块直接显示。
 */
export class DescribeStore implements GeneratedReader {
  constructor(
    private readonly db: Db,
    private readonly overviews: Pick<OverviewStore, 'save'>,
  ) {}

  async existing(inputs: DescribeInput[]): Promise<Map<string, { inputHash: string; promptVersion: number; locales: number }>> {
    const out = new Map<string, { inputHash: string; promptVersion: number; locales: number }>()
    const groups = new Map<string, DescribeInput[]>()
    for (const i of inputs) groups.set(`${i.sourceId}|${i.kind}`, [...(groups.get(`${i.sourceId}|${i.kind}`) ?? []), i])
    for (const [group, list] of groups) {
      const [sourceId, kind] = group.split('|') as [string, EntityKind]
      for (let i = 0; i < list.length; i += 500) {
        const rows = await this.db
          .select({ externalId: ingestGeneratedTexts.externalId, inputHash: ingestGeneratedTexts.inputHash, promptVersion: ingestGeneratedTexts.promptVersion })
          .from(ingestGeneratedTexts)
          .where(and(eq(ingestGeneratedTexts.sourceId, sourceId), eq(ingestGeneratedTexts.kind, kind), eq(ingestGeneratedTexts.field, 'tagline'), inArray(ingestGeneratedTexts.externalId, list.slice(i, i + 500).map((x) => x.externalId))))
        for (const r of rows) {
          const key = describeKey({ sourceId, kind: kind as DescribeInput['kind'], externalId: r.externalId })
          const prev = out.get(key)
          out.set(key, {
            inputHash: prev && prev.inputHash !== r.inputHash ? '' : r.inputHash,
            promptVersion: Math.min(prev?.promptVersion ?? Infinity, r.promptVersion ?? 0),
            locales: (prev?.locales ?? 0) + 1,
          })
        }
      }
    }
    return out
  }

  async save(input: DescribeInput, result: DescribeResult, problems: Problem[], writer: DescribeWriter): Promise<void> {
    const ref = { sourceId: input.sourceId, kind: input.kind, externalId: input.externalId }
    const now = new Date()
    await withDeadlockRetry(() => this.db.transaction(async (tx) => {
      for (const locale of LOCALES) {
        const c = result.content[locale]
        const localeProblems = problems.filter((p) => !p.locale || p.locale === locale)
        const meta = {
          inputHash: input.inputHash,
          provider: writer.provider,
          model: writer.model,
          promptVersion: writer.promptVersion,
          status: localeProblems.length > 0 ? 'review' : 'ok',
          problems: localeProblems.length > 0 ? localeProblems : null,
          generatedAt: now,
        }
        const fields: [string, string | undefined][] = [['tagline', c.tagline], ['goal', c.goal], ['exit_condition', c.exitCondition]]
        for (const [field, content] of fields) {
          if (!content) continue
          const values = { content, ...meta }
          await tx.insert(ingestGeneratedTexts).values({ ...ref, locale, field, ...values }).onDuplicateKeyUpdate({ set: values })
        }
        await tx.delete(ingestGeneratedSteps).where(and(where(ingestGeneratedSteps, ref), eq(ingestGeneratedSteps.locale, locale)))
        const steps = (c.steps ?? []).map((s, position) => ({
          ...ref,
          locale,
          position,
          title: s.title.slice(0, 255),
          body: s.body || null,
          command: s.commandIndex >= 0 ? (input.commands[s.commandIndex] ?? null) : null,
          ...meta,
        }))
        if (steps.length > 0) await tx.insert(ingestGeneratedSteps).values(steps)
      }
    }))
    // 概述、功能、场景走 AI 介绍的存储，详情页"关于"区块统一读取
    await this.overviews.save(
      { ...ref, name: input.name, tagline: null, category: null, tags: [], website: null, readme: '', stars: null, inputHash: input.inputHash },
      { key: describeKey(input), content: Object.fromEntries(LOCALES.map((l) => [l, { summary: result.content[l].summary, features: result.content[l].features, useCases: result.content[l].useCases, mcp: '' }])) as never },
      problems,
      writer,
    )
  }

  async taglines(kind: EntityKind, externalIds: string[], locale: Locale, sourceId = 'mcpso'): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    if (externalIds.length === 0) return out
    const rows = await this.db
      .select({ externalId: ingestGeneratedTexts.externalId, locale: ingestGeneratedTexts.locale, content: ingestGeneratedTexts.content })
      .from(ingestGeneratedTexts)
      .where(and(eq(ingestGeneratedTexts.sourceId, sourceId), eq(ingestGeneratedTexts.kind, kind), eq(ingestGeneratedTexts.field, 'tagline'), inArray(ingestGeneratedTexts.externalId, externalIds), inArray(ingestGeneratedTexts.locale, [locale, 'en'])))
    for (const r of rows) if (r.locale === locale || !out.has(r.externalId)) out.set(r.externalId, r.content)
    return out
  }

  async playbook(ref: Ref, locale: Locale): Promise<Playbook | null> {
    const texts = await this.db
      .select({ locale: ingestGeneratedTexts.locale, field: ingestGeneratedTexts.field, content: ingestGeneratedTexts.content })
      .from(ingestGeneratedTexts)
      .where(and(where(ingestGeneratedTexts, ref), inArray(ingestGeneratedTexts.locale, [locale, 'en'])))
    const use: Locale | null = texts.some((t) => t.locale === locale) ? locale : texts.some((t) => t.locale === 'en') ? 'en' : null
    if (!use) return null
    const steps = await this.db
      .select({ position: ingestGeneratedSteps.position, title: ingestGeneratedSteps.title, body: ingestGeneratedSteps.body, command: ingestGeneratedSteps.command })
      .from(ingestGeneratedSteps)
      .where(and(where(ingestGeneratedSteps, ref), eq(ingestGeneratedSteps.locale, use)))
      .orderBy(asc(ingestGeneratedSteps.position))
    const field = (f: string) => texts.find((t) => t.locale === use && t.field === f)?.content ?? null
    return { locale: use, goal: field('goal'), exitCondition: field('exit_condition'), steps }
  }
}
