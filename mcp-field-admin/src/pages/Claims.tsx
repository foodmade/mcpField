import { ArrowSquareOut, MagnifyingGlass, X } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '../components/Layout'
import { Button, Empty, ErrorBox, Loading, Pager, STACKED } from '../components/ui'
import { api, qs, useApi } from '../lib/api'
import { dateTime, num } from '../lib/format'

/* 与 mcp-field-crawler/src/admin-api/claims.ts 的返回结构一致 */
interface ClaimRow {
  id: number
  slug: string
  name: string | null
  iconUrl: string | null
  userName: string
  githubLogin: string
  githubAvatar: string | null
  repoFullName: string
  method: 'owner' | 'maintainer'
  claimedAt: string
  revokedAt: string | null
  revokedBy: string | null
  url: string
}

interface ClaimPage {
  data: ClaimRow[]
  meta: { page: number; pageSize: number; total: number; totalPages: number }
  counts: { all: number; active: number; revoked: number }
}

const TABS = [
  { value: '', label: '全部', count: 'all' },
  { value: 'active', label: '有效', count: 'active' },
  { value: 'revoked', label: '已撤销', count: 'revoked' },
] as const

const METHOD_LABEL = { owner: '仓库所有者', maintainer: '组织管理员' }

/** MCP 服务认领记录：按状态筛选、按服务 / GitHub 账号 / 仓库搜索，可以撤销 */
export function ClaimsPage() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const [q, setQ] = useState(params.get('q') ?? '')
  const [busy, setBusy] = useState<number | null>(null)
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

  const { data, error, loading, reload } = useApi<ClaimPage>(`/claims${qs({ status, q: params.get('q'), page: params.get('page') || 1, pageSize: 20 })}`)

  const revoke = async (row: ClaimRow) => {
    if (!confirm(`撤销 @${row.githubLogin} 对「${row.name ?? row.slug}」的认领？\n撤销后不再显示"已认证"，这个 GitHub 账号不能再认领这个服务。`)) return
    setBusy(row.id)
    setActionError(undefined)
    try {
      await api(`/claims/${row.id}/revoke`, { method: 'POST', body: {} })
      reload()
    } catch (e) {
      setActionError(e as Error)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader title="认领管理" sub={data ? `共 ${num(data.counts.all)} 条 · 撤销后详情页立即生效，网站列表最多 10 分钟后更新` : undefined} onRefresh={reload} />
      <div className="flex flex-col gap-4 px-4 pb-10 pt-4 md:px-8 md:pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <nav className="flex max-w-full gap-0.5 self-start overflow-x-auto rounded-[10px] bg-subtle p-[3px]">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setParams(t.value ? { status: t.value } : {})}
                className={clsx('flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px]', status === t.value ? 'bg-white/10 font-semibold text-ink' : 'text-text2 hover:text-ink')}
              >
                {t.label}
                <span className="font-mono text-[11px] font-normal text-text3">{data ? data.counts[t.count] : ''}</span>
              </button>
            ))}
          </nav>
          <label className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 sm:w-[280px]">
            <MagnifyingGlass className="size-[15px] text-text3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索服务、GitHub 账号或仓库" className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-text3" />
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
            <div className="p-4 md:p-5">
              <ErrorBox error={error} retry={reload} />
            </div>
          )}
          {loading && !data ? (
            <Loading />
          ) : data && !data.data.length ? (
            <Empty>{status || params.get('q') ? '没有符合条件的认领' : '还没有人认领'}</Empty>
          ) : (
            data && (
              <>
                <table className={clsx('w-full table-fixed text-[13px]', STACKED)}>
                  <thead>
                    <tr className="border-b border-line bg-white/[0.02] text-left text-xs text-text3">
                      <th className="py-2.5 pl-5 font-normal">MCP 服务</th>
                      <th className="w-[200px] font-normal">GitHub 账号</th>
                      <th className="w-[220px] font-normal">验证的仓库</th>
                      <th className="w-[140px] font-normal">网站账号</th>
                      <th className="w-[110px] font-normal">认领时间</th>
                      <th className="w-[150px] font-normal">状态</th>
                      <th className="w-[110px] pr-5 font-normal" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((row) => (
                      <tr key={row.id} className="border-b border-line last:border-0">
                        <td className="py-3 pl-5 max-md:w-full">
                          <span className="flex items-center gap-2.5">
                            {row.iconUrl ? <img src={row.iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-7 shrink-0 rounded-md bg-white/5 object-contain" /> : <span className="size-7 shrink-0 rounded-md bg-white/5" />}
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{row.name ?? row.slug}</span>
                              <span className="block truncate font-mono text-xs text-text3">{row.slug}</span>
                            </span>
                          </span>
                        </td>
                        <td className="max-md:max-w-full">
                          <a href={`https://github.com/${row.githubLogin}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-accent">
                            {row.githubAvatar ? <img src={row.githubAvatar} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-5 rounded-full bg-white/5" /> : <span className="size-5 rounded-full bg-white/10" />}
                            <span className="truncate">@{row.githubLogin}</span>
                          </a>
                          <span className="mt-0.5 block text-xs text-text3">{METHOD_LABEL[row.method]}</span>
                        </td>
                        <td className="max-md:max-w-full">
                          <a href={`https://github.com/${row.repoFullName}`} target="_blank" rel="noreferrer" className="block truncate font-mono text-xs text-text2 hover:text-accent">
                            {row.repoFullName}
                          </a>
                        </td>
                        <td className="truncate text-text2 max-md:max-w-full">
                          <span className="text-xs text-text3 md:hidden">网站账号 </span>
                          {row.userName}
                        </td>
                        <td className="font-mono text-xs text-text2">{dateTime(row.claimedAt)}</td>
                        <td>
                          {row.revokedAt ? (
                            <span className="text-xs text-text3" title={`由 ${row.revokedBy ?? '—'} 撤销`}>
                              <span className="inline-flex items-center rounded-full bg-white/5 px-2.5 py-0.5 text-text2">已撤销</span>
                              <span className="ml-1.5 font-mono">{dateTime(row.revokedAt)}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-ok/10 px-2.5 py-0.5 text-xs text-ok">有效</span>
                          )}
                        </td>
                        <td className="pr-5 max-md:ml-auto">
                          <span className="flex items-center justify-end gap-1">
                            {!row.revokedAt && (
                              <Button danger className="h-7 px-2.5 text-xs" disabled={busy === row.id} onClick={() => void revoke(row)}>
                                撤销
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
                  <div className="flex justify-end border-t border-line px-4 py-3 md:px-5">
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
