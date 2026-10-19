import { ArrowSquareOut, MagnifyingGlass, X } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '../components/Layout'
import { Button, Empty, ErrorBox, Loading, Pager } from '../components/ui'
import { api, qs, useApi } from '../lib/api'
import { dateTime, num } from '../lib/format'
import { KIND_LABEL, type Kind } from '../lib/labels'

/* 与 mcp-field-crawler/src/admin-api/feedback.ts 的返回结构一致 */
type Status = 'open' | 'resolved' | 'ignored'

interface FeedbackRow {
  id: number
  kind: Kind
  slug: string
  name: string | null
  iconUrl: string | null
  type: string
  body: string
  email: string | null
  userName: string | null
  status: Status
  handledAt: string | null
  handledBy: string | null
  createdAt: string
  url: string
}

interface FeedbackPage {
  data: FeedbackRow[]
  meta: { page: number; pageSize: number; total: number; totalPages: number }
  counts: Record<Status | 'all', number>
}

const TABS = [
  { value: 'open', label: '待处理' },
  { value: 'resolved', label: '已处理' },
  { value: 'ignored', label: '已忽略' },
  { value: 'all', label: '全部' },
] as const

const TYPE_LABEL: Record<string, string> = {
  wrong_info: '信息有误',
  broken_link: '链接失效',
  install: '安装配置不能用',
  duplicate: '重复收录',
  suggestion: '功能建议',
  other: '其他',
}

const STATUS_PILL: Record<Status, { label: string; cls: string }> = {
  open: { label: '待处理', cls: 'bg-warn/10 text-warn' },
  resolved: { label: '已处理', cls: 'bg-ok/10 text-ok' },
  ignored: { label: '已忽略', cls: 'bg-white/5 text-text2' },
}

/** 详情页提交的问题反馈：默认看待处理的，按条目 / 内容 / 邮箱 / 昵称搜索，标记已处理或忽略 */
export function FeedbackPage() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'open'
  const [q, setQ] = useState(params.get('q') ?? '')
  const [busy, setBusy] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [actionError, setActionError] = useState<Error>()
  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim() === (params.get('q') ?? '')) return
      setParams((p) => {
        if (q.trim()) p.set('q', q.trim())
        else p.delete('q')
        p.delete('page')
        return p
      })
    }, 400)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data, error, loading, reload } = useApi<FeedbackPage>(
    `/feedback${qs({ status: status === 'all' ? undefined : status, q: params.get('q'), page: params.get('page') || 1, pageSize: 20 })}`,
  )

  const setStatus = async (row: FeedbackRow, next: Status) => {
    setBusy(row.id)
    setActionError(undefined)
    try {
      await api(`/feedback/${row.id}/status`, { method: 'POST', body: { status: next } })
      reload()
    } catch (e) {
      setActionError(e as Error)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader title="反馈管理" sub={data ? `共 ${num(data.counts.all)} 条 · 待处理 ${num(data.counts.open)} 条` : undefined} onRefresh={reload} />
      <div className="flex flex-col gap-4 px-8 pb-10 pt-6">
        <div className="flex items-center justify-between gap-4">
          <nav className="flex gap-0.5 rounded-[10px] bg-subtle p-[3px]">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setParams(t.value === 'open' ? {} : { status: t.value })}
                className={clsx('flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px]', status === t.value ? 'bg-white/10 font-semibold text-ink' : 'text-text2 hover:text-ink')}
              >
                {t.label}
                <span className="font-mono text-[11px] font-normal text-text3">{data ? data.counts[t.value] : ''}</span>
              </button>
            ))}
          </nav>
          <label className="flex h-9 w-[280px] items-center gap-2 rounded-lg border border-line bg-surface px-3">
            <MagnifyingGlass className="size-[15px] text-text3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索条目、内容、邮箱或昵称" className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-text3" />
            {q && (
              <button onClick={() => setQ('')} className="text-text3 hover:text-ink" aria-label="清除">
                <X className="size-3.5" />
              </button>
            )}
          </label>
        </div>

        {actionError && <ErrorBox error={actionError} />}
        <section className="rounded-xl border border-line bg-surface">
          {error && (
            <div className="p-5">
              <ErrorBox error={error} retry={reload} />
            </div>
          )}
          {loading && !data ? (
            <Loading />
          ) : data && !data.data.length ? (
            <Empty>{params.get('q') ? '没有符合条件的反馈' : status === 'open' ? '没有待处理的反馈' : '还没有反馈'}</Empty>
          ) : (
            data && (
              <>
                <table className="w-full table-fixed text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-white/[0.02] text-left text-xs text-text3">
                      <th className="w-[230px] py-2.5 pl-5 font-normal">条目</th>
                      <th className="w-[120px] font-normal">类型</th>
                      <th className="font-normal">说明</th>
                      <th className="w-[180px] font-normal">提交人</th>
                      <th className="w-[100px] font-normal">提交时间</th>
                      <th className="w-[120px] font-normal">状态</th>
                      <th className="w-[200px] pr-5 font-normal" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((row) => (
                      <tr key={row.id} className="border-b border-line align-top last:border-0">
                        <td className="py-3 pl-5">
                          <span className="flex items-center gap-2.5">
                            {row.iconUrl ? <img src={row.iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-7 shrink-0 rounded-md bg-white/5 object-contain" /> : <span className="size-7 shrink-0 rounded-md bg-white/5" />}
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{row.name ?? row.slug}</span>
                              <span className="block truncate text-xs text-text3">{KIND_LABEL[row.kind] ?? row.kind} · <span className="font-mono">{row.slug}</span></span>
                            </span>
                          </span>
                        </td>
                        <td className="py-3 text-text2">{TYPE_LABEL[row.type] ?? row.type}</td>
                        <td className="py-3 pr-4">
                          <button
                            type="button"
                            onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                            title={expanded === row.id ? '收起' : '展开全文'}
                            className={clsx('w-full whitespace-pre-wrap break-words text-left leading-relaxed', expanded !== row.id && 'line-clamp-3')}
                          >
                            {row.body}
                          </button>
                        </td>
                        <td className="py-3">
                          {row.userName ? (
                            <span className="block truncate">{row.userName}<span className="ml-1.5 text-xs text-text3">已登录</span></span>
                          ) : row.email ? (
                            <a href={`mailto:${row.email}`} className="block truncate text-text2 hover:text-accent">{row.email}</a>
                          ) : (
                            <span className="text-text3">匿名</span>
                          )}
                        </td>
                        <td className="py-3 font-mono text-xs text-text2">{dateTime(row.createdAt)}</td>
                        <td className="py-3">
                          <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs', STATUS_PILL[row.status].cls)}>{STATUS_PILL[row.status].label}</span>
                          {row.handledAt && (
                            <span className="mt-1 block text-xs text-text3" title={`由 ${row.handledBy ?? '—'} 处理`}>
                              <span className="font-mono">{dateTime(row.handledAt)}</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-5">
                          <span className="flex items-center justify-end gap-1 whitespace-nowrap">
                            {row.status === 'open' ? (
                              <>
                                <Button primary className="h-7 px-2.5 text-xs" disabled={busy === row.id} onClick={() => void setStatus(row, 'resolved')}>
                                  已处理
                                </Button>
                                <Button className="h-7 px-2.5 text-xs" disabled={busy === row.id} onClick={() => void setStatus(row, 'ignored')}>
                                  忽略
                                </Button>
                              </>
                            ) : (
                              <Button className="h-7 px-2.5 text-xs" disabled={busy === row.id} onClick={() => void setStatus(row, 'open')}>
                                改回待处理
                              </Button>
                            )}
                            <a href={row.url} target="_blank" rel="noreferrer" title="在网站上查看" className="inline-flex rounded-md p-1.5 text-text3 hover:bg-white/5 hover:text-ink">
                              <ArrowSquareOut className="size-4" />
                            </a>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.meta.totalPages > 1 && (
                  <div className="flex justify-end border-t border-line px-5 py-3">
                    <Pager page={data.meta.page} totalPages={data.meta.totalPages} onChange={(p) => setParams((s) => (s.set('page', String(p)), s))} />
                  </div>
                )}
              </>
            )
          )}
        </section>
      </div>
    </>
  )
}
