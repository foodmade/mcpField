import { PlugsConnected } from '@phosphor-icons/react'
import clsx from 'clsx'
import { Link } from 'react-router'
import { useI18n } from '../../i18n/context'
import type { ApiOverview, Kind } from '../../lib/api/entities'
import { tagPath } from '../../lib/tagsQuery'

/** 标签列表（#标签）：链接到同类型目录页里带这个标签的条目 */
export function TagList({ tags, kind }: { tags: string[]; kind: Kind }) {
  const { to } = useI18n()
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((t) => (
        <Link key={t} to={to(tagPath(kind, t))} className="rounded-lg border border-fg/[0.08] bg-fg/[0.04] px-2.5 py-1 text-xs text-text2 transition-colors hover:border-fg/20 hover:text-ink">
          #{t}
        </Link>
      ))}
    </div>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 一栏条目：小号标题，下面是带序号、用细线分隔的列表（不加卡片外框） */
function ItemList({ title, items, className }: { title: string; items: string[]; className?: string }) {
  return (
    <section className={clsx('min-w-0 py-5', className)}>
      <h3 className="mb-2 text-xs font-medium tracking-wide text-text3">{title}</h3>
      <ol>
        {items.map((item, i) => (
          <li key={i} className="group flex gap-4 border-t border-fg/[0.06] py-2.5 first:border-0">
            <span className="w-5 shrink-0 pt-[3px] font-mono text-xs tabular-nums text-text3 transition-colors group-hover:text-accent">{pad(i + 1)}</span>
            <span className="text-[15px] leading-relaxed text-text2 transition-colors group-hover:text-ink">{item}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** AI 根据 README 生成的介绍：概述、主要功能、适用场景、MCP 相关，末尾是标签；summaryOnly 时不显示功能与场景 */
export function AiOverview({ overview, summaryOnly, tags = [], kind }: { overview: ApiOverview; summaryOnly?: boolean; tags?: string[]; kind: Kind }) {
  const { m, locale } = useI18n()
  const t = m.detail.aiOverview
  const lists = summaryOnly
    ? []
    : [
        { title: t.features, items: overview.features },
        { title: t.useCases, items: overview.useCases },
      ].filter((l) => l.items.length > 0)
  return (
    <div className="mt-4 flex flex-col gap-5">
      {overview.locale !== locale && <p className="text-xs text-text3">{t.notTranslated}</p>}
      <p className="text-[15px] leading-[1.75] text-text2">{overview.summary}</p>
      {lists.length > 0 && (
        // 上下各一条细线，两栏之间一条竖线；窄屏上下排列，栏间改为横线
        <div className={clsx('grid border-y border-line', lists.length === 2 && 'max-sm:divide-y max-sm:divide-line sm:grid-cols-2 sm:divide-x sm:divide-line')}>
          {lists.map((l, i) => (
            <ItemList key={l.title} title={l.title} items={l.items} className={clsx(lists.length === 2 && (i === 0 ? 'sm:pr-8' : 'sm:pl-8'))} />
          ))}
        </div>
      )}
      {overview.mcp && (
        <div className="border-l-2 border-accent/60 pl-4">
          <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-text3"><PlugsConnected size={14} className="text-accent" />{t.mcp}</h3>
          <p className="mt-1.5 text-[15px] leading-relaxed text-text2">{overview.mcp}</p>
        </div>
      )}
      {tags.length > 0 && <TagList tags={tags} kind={kind} />}
    </div>
  )
}
