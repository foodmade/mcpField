import { ArrowSquareOut, MagnifyingGlass, PencilSimpleLine, PushPin, X } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { PageHeader } from '../components/Layout'
import { Button, Empty, ErrorBox, Loading, Pager } from '../components/ui'
import { qs, useApi } from '../lib/api'
import { CATEGORY_LABEL, type BlogPage, type BlogRow } from '../lib/blog'
import { dateTime, num } from '../lib/format'

const TABS = [
  { value: '', label: '全部', count: 'all' },
  { value: 'published', label: '已发布', count: 'published' },
  { value: 'scheduled', label: '定时发布', count: 'scheduled' },
  { value: 'draft', label: '草稿', count: 'draft' },
] as const

function StatusPill({ row }: { row: Pick<BlogRow, 'status' | 'scheduled'> }) {
  const [label, cls] = row.status === 'draft' ? ['草稿', 'bg-white/5 text-text2'] : row.scheduled ? ['定时发布', 'bg-run/15 text-run'] : ['已发布', 'bg-ok/10 text-ok']
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs', cls)}>{label}</span>
}

/** 博客文章列表：按状态筛选、按标题或地址搜索，点一行进入编辑 */
export function BlogPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const [q, setQ] = useState(params.get('q') ?? '')
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

  const { data, error, loading, reload } = useApi<BlogPage>(`/blog/posts${qs({ status, q: params.get('q'), page: params.get('page') || 1, pageSize: 20 })}`)

  return (
    <>
      <PageHeader
        title="博客文章"
        sub={data ? `共 ${num(data.counts.all)} 篇 · 保存后约半分钟网站可见` : undefined}
        onRefresh={reload}
        actions={
          <Button primary icon={<PencilSimpleLine className="size-[15px]" />} onClick={() => navigate('/blog/new')}>
            写文章
          </Button>
        }
      />
      <div className="flex flex-col gap-4 px-8 pb-10 pt-6">
        <div className="flex items-center justify-between gap-4">
          <nav className="flex gap-0.5 rounded-[10px] bg-subtle p-[3px]">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setParams(t.value ? { status: t.value } : {})}
                className={clsx('flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px]', status === t.value ? 'bg-white/10 font-semibold text-ink' : 'text-text2 hover:text-ink')}
              >
                {t.label}
                <span className="font-mono text-[11px] font-normal text-text3">{data ? data.counts[t.count] : ''}</span>
              </button>
            ))}
          </nav>
          <label className="flex h-9 w-[280px] items-center gap-2 rounded-lg border border-line bg-surface px-3">
            <MagnifyingGlass className="size-[15px] text-text3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索标题或地址" className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-text3" />
            {q && (
              <button onClick={() => setQ('')} className="text-text3 hover:text-ink" aria-label="清除">
                <X className="size-3.5" />
              </button>
            )}
          </label>
        </div>

        <section className="rounded-xl border border-line bg-surface">
          {error && (
            <div className="p-5">
              <ErrorBox error={error} retry={reload} />
            </div>
          )}
          {loading && !data ? (
            <Loading />
          ) : data && !data.data.length ? (
            <Empty>
              {status || params.get('q') ? '没有符合条件的文章' : '还没有文章，'}
              {!status && !params.get('q') && (
                <Link to="/blog/new" className="text-accent hover:underline">
                  写第一篇
                </Link>
              )}
            </Empty>
          ) : (
            data && (
              <>
                <table className="w-full table-fixed text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-white/[0.02] text-left text-xs text-text3">
                      <th className="py-2.5 pl-5 font-normal">标题</th>
                      <th className="w-[100px] font-normal">栏目</th>
                      <th className="w-[100px] font-normal">状态</th>
                      <th className="w-[120px] font-normal">发布时间</th>
                      <th className="w-[120px] font-normal">最后修改</th>
                      <th className="w-[80px] text-right font-normal">浏览</th>
                      <th className="w-[72px] pr-5 font-normal" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((row) => (
                      <tr key={row.id} onClick={() => navigate(`/blog/${row.id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-white/[0.02]">
                        <td className="py-3 pl-5">
                          <span className="flex items-center gap-1.5 truncate font-medium">
                            {row.pinned && <PushPin weight="fill" className="size-3.5 shrink-0 text-accent" aria-label="置顶" />}
                            <span className="truncate">{row.title}</span>
                          </span>
                          <span className="block truncate font-mono text-xs text-text3">/blog/{row.slug}</span>
                        </td>
                        <td className="text-text2">{CATEGORY_LABEL[row.category] ?? row.category}</td>
                        <td>
                          <StatusPill row={row} />
                        </td>
                        <td className="font-mono text-xs text-text2">{dateTime(row.publishedAt)}</td>
                        <td className="font-mono text-xs text-text3">{dateTime(row.updatedAt)}</td>
                        <td className="text-right font-mono text-xs tabular text-text2">{num(row.views)}</td>
                        <td className="pr-5 text-right">
                          {row.status === 'published' && !row.scheduled && (
                            <a href={row.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="在网站上查看" className="inline-flex rounded-md p-1.5 text-text3 hover:bg-white/5 hover:text-ink">
                              <ArrowSquareOut className="size-4" />
                            </a>
                          )}
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
