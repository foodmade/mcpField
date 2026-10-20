import { ArrowSquareOut, CaretDown, CaretRight } from '@phosphor-icons/react'
import clsx from 'clsx'
import { Fragment, useState } from 'react'
import type { Item, ItemPage } from '../lib/api'
import { categoryName } from '../lib/categories'
import { compact, dateTime, day, num } from '../lib/format'
import { KIND_LABEL, sourceLabel, STAGE_LABEL, STATE_TONE, type Stage } from '../lib/labels'
import { Dot, Empty, Pager, STACKED, TONE_TEXT, toneOf } from './ui'

/** 表格里亮灯的补全项；分类在分类列里显示（待分类时是标签） */
const LIGHTS: Stage[] = ['icon', 'github', 'readme', 'translate', 'tools', 'tools_translate', 'intro', 'readme_translate']

export function LightLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-text2">
      {(['ok', 'running', 'pending', 'warn', 'failed'] as const).map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <Dot state={s} size={7} />
          {s === 'pending' ? '待处理' : s === 'warn' ? '警告/待抽查' : STATE_TONE[s].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-text3">—</span>不适用
      </span>
    </div>
  )
}

function Icon({ item }: { item: Item }) {
  const [broken, setBroken] = useState(false)
  if (item.iconUrl && !broken) return <img src={item.iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-8 shrink-0 rounded-lg bg-white/5 object-contain" />
  return <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-xs font-semibold text-text2">{item.name.slice(0, 2)}</span>
}

export function ItemTable({ page, onPage, showKind, footer }: { page: ItemPage; onPage: (p: number) => void; showKind?: boolean; footer?: string }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!page.data.length) return <Empty>没有符合条件的条目</Empty>
  return (
    <>
      <div className="overflow-x-auto">
        <table className={clsx('w-full table-fixed text-[13px] md:min-w-[1080px]', STACKED)}>
          <thead>
            <tr className="border-y border-line bg-white/[0.02] text-left text-xs text-text3">
              <th className="w-[290px] py-2.5 pl-5 font-normal">名称</th>
              {showKind && <th className="w-[80px] font-normal">类型</th>}
              <th className="w-[120px] font-normal">分类</th>
              <th className="w-[64px] font-normal">热度</th>
              <th className="w-[76px] font-normal">收录</th>
              {LIGHTS.map((s) => (
                <th key={s} className="truncate px-0.5 text-center font-normal" title={STAGE_LABEL[s]}>
                  {STAGE_LABEL[s]}
                </th>
              ))}
              <th className="w-[56px] pr-5 font-normal" />
            </tr>
          </thead>
          <tbody>
            {page.data.map((item) => {
              const key = `${item.kind}/${item.slug}`
              const expanded = open === key
              const classify = item.stages.classify
              return (
                <Fragment key={key}>
                  <tr className={clsx('cursor-pointer border-b border-line hover:bg-white/[0.02]', expanded && 'bg-white/[0.03]', !item.active && 'opacity-60')} onClick={() => setOpen(expanded ? null : key)}>
                    <td className="py-2.5 pl-5 max-md:w-full">
                      <div className="flex items-center gap-3">
                        {expanded ? <CaretDown className="size-3 shrink-0 text-text3" /> : <CaretRight className="size-3 shrink-0 text-text3" />}
                        <Icon item={item} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{item.name}</div>
                          <div className="truncate font-mono text-[10px] text-text3">
                            {item.slug}
                            {!item.active && ' · 已下架'}
                          </div>
                        </div>
                      </div>
                    </td>
                    {showKind && <td className="text-text2">{KIND_LABEL[item.kind]}</td>}
                    <td>
                      {classify.state === 'pending' || classify.state === 'running' ? (
                        <span className="rounded border border-line px-1.5 py-0.5 text-[11px] text-text3">待分类</span>
                      ) : (
                        <span className={clsx('text-text2', classify.state === 'warn' && 'text-warn')} title={classify.note ?? undefined}>
                          {categoryName(item.kind, item.category ?? (classify.state === 'ok' ? 'other' : null))}
                        </span>
                      )}
                    </td>
                    <td className="font-mono text-xs text-text2 tabular">
                      <span className="font-sans text-text3 md:hidden">热度 </span>
                      {compact(item.popularity)}
                    </td>
                    <td className="font-mono text-xs text-text3" title={dateTime(item.firstSeenAt)}>
                      <span className="font-sans md:hidden">收录 </span>
                      {day(item.firstSeenAt).slice(5)}
                    </td>
                    {LIGHTS.map((s) => {
                      const st = item.stages[s]
                      return (
                        <td key={s} className="text-center max-md:hidden">
                          {st.state === 'na' ? <span className="font-mono text-xs text-text3" title={st.note ?? '不适用'}>—</span> : <Dot state={st.state} title={`${STAGE_LABEL[s]}：${STATE_TONE[st.state].label}${st.note ? `，${st.note}` : ''}`} />}
                        </td>
                      )
                    })}
                    {/* 手机上没有表头，灯旁边带上补全项的名字 */}
                    <td className="w-full md:hidden">
                      <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-text2">
                        {LIGHTS.map((s) => {
                          const st = item.stages[s]
                          return (
                            <span key={s} className={clsx('flex items-center gap-1', st.state === 'na' && 'text-text3')}>
                              {st.state === 'na' ? <span className="font-mono">—</span> : <Dot state={st.state} size={7} />}
                              {STAGE_LABEL[s]}
                            </span>
                          )
                        })}
                      </div>
                    </td>
                    <td className="pr-5 text-right max-md:hidden">
                      <a href={item.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="在网站上打开" className="inline-flex rounded-md p-1.5 text-text3 hover:bg-white/5 hover:text-ink">
                        <ArrowSquareOut className="size-4" />
                      </a>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="border-b border-line bg-white/[0.015]">
                      <td colSpan={20} className="px-5 py-4 max-md:w-full">
                        <Detail item={item} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3.5 md:px-5">
        <span className="text-xs text-text3">
          第 {num((page.meta.page - 1) * page.meta.pageSize + 1)}–{num(Math.min(page.meta.total, page.meta.page * page.meta.pageSize))} 条 / 共 {num(page.meta.total)} 条{footer ? ` · ${footer}` : ''}
        </span>
        <Pager page={page.meta.page} totalPages={page.meta.totalPages} onChange={onPage} />
      </div>
    </>
  )
}

/** 展开的一行：每个补全项的状态和说明 */
function Detail({ item }: { item: Item }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-10">
      <dl className="grid shrink-0 grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 text-xs lg:w-[300px]">
        <dt className="text-text3">来源</dt>
        <dd>{item.sources.map(sourceLabel).join('、')}</dd>
        <dt className="text-text3">收录时间</dt>
        <dd className="font-mono">{dateTime(item.firstSeenAt)}</dd>
        <dt className="text-text3">最近发布</dt>
        <dd className="font-mono">{dateTime(item.publishedAt)}</dd>
        <dt className="text-text3">热度</dt>
        <dd className="font-mono">{num(item.popularity)}</dd>
        <dt className="text-text3">网站地址</dt>
        <dd className="truncate">
          <a href={item.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {item.url.replace(/^https?:\/\//, '')}
          </a>
        </dd>
      </dl>
      <ul className="grid flex-1 grid-cols-1 gap-x-8 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(STAGE_LABEL) as Stage[]).map((s) => {
          const st = item.stages[s]
          return (
            <li key={s} className="flex items-start gap-2">
              <span className="pt-0.5">{st.state === 'na' ? <span className="inline-block w-[9px] text-center font-mono text-text3">—</span> : <Dot state={st.state} size={8} />}</span>
              <span>
                <span className="text-text2">{STAGE_LABEL[s]}</span>
                <span className={clsx('ml-2', TONE_TEXT[toneOf(st.state)])}>{STATE_TONE[st.state].label}</span>
                {st.note && <span className="ml-1.5 text-text3">· {st.note}</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
