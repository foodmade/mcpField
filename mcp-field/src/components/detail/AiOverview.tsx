import { Lightning, PlugsConnected, Sparkle, Target, type Icon } from '@phosphor-icons/react'
import { useI18n } from '../../i18n/context'
import type { ApiOverview } from '../../lib/api/entities'

function ItemList({ title, icon: I, items }: { title: string; icon: Icon; items: string[] }) {
  if (items.length === 0) return null
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-surface p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-ink"><I size={15} className="text-accent" />{title}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-text2">
            <span className="mt-[9px] size-[5px] shrink-0 rounded-full bg-accent" />
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** AI 根据 README 生成的介绍：概述、主要功能、适用场景、MCP 相关，并注明由 AI 整理；summaryOnly 时不显示功能与场景 */
export function AiOverview({ overview, summaryOnly }: { overview: ApiOverview; summaryOnly?: boolean }) {
  const { m, locale } = useI18n()
  const t = m.detail.aiOverview
  return (
    <div className="mt-4 flex flex-col gap-5">
      {overview.locale !== locale && <p className="text-xs text-text3">{t.notTranslated}</p>}
      <p className="text-[15px] leading-[1.75] text-text2">{overview.summary}</p>
      {!summaryOnly && (
        <div className="grid gap-4 sm:grid-cols-2 [&>*]:min-w-0">
          <ItemList title={t.features} icon={Lightning} items={overview.features} />
          <ItemList title={t.useCases} icon={Target} items={overview.useCases} />
        </div>
      )}
      {overview.mcp && (
        <div className="flex gap-3 rounded-2xl border border-accent/20 bg-accent/[0.06] p-4">
          <PlugsConnected size={18} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">{t.mcp}</h3>
            <p className="mt-1 text-sm leading-relaxed text-text2">{overview.mcp}</p>
          </div>
        </div>
      )}
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-text3"><Sparkle size={12} className="mt-0.5 shrink-0" />{t.note}</p>
    </div>
  )
}
