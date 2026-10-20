import { ArrowsClockwise, ArrowSquareOut, Copy, EnvelopeSimple, GithubLogo, GoogleLogo, MagnifyingGlass, X } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '../components/Layout'
import { Button, Empty, ErrorBox, Loading, Pager, Pill, Select, STACKED } from '../components/ui'
import { api, qs, useApi, type SiteUser, type SiteUserDetail, type SiteUserPage, type SiteUserStatus, type SiteUserSummary } from '../lib/api'
import { ago, clock, dateTime, num } from '../lib/format'
import { KIND_LABEL } from '../lib/labels'

/* 网站用户：Supabase Auth 里的注册账号，后台接口每 10 分钟同步一次；只读 */

const PROVIDER = {
  github: { label: 'GitHub', icon: GithubLogo, bar: 'bg-ink' },
  google: { label: 'Google', icon: GoogleLogo, bar: 'bg-run' },
  email: { label: '邮箱', icon: EnvelopeSimple, bar: 'bg-kind-skill' },
} as const
type Provider = keyof typeof PROVIDER

const STATUS: Record<SiteUserStatus, { state: 'ok' | 'warn' | 'failed'; label: string }> = {
  active: { state: 'ok', label: '正常' },
  unverified: { state: 'warn', label: '未验证邮箱' },
  banned: { state: 'failed', label: '已封禁' },
}

const LOCALE: Record<string, string> = { zh: '中文', en: 'English', ja: '日本語' }

const opts = (all: string, list: [string, string][]) => [{ value: '', label: all }, ...list.map(([value, label]) => ({ value, label }))]
const PROVIDER_OPTIONS = opts('全部', [['github', 'GitHub'], ['google', 'Google'], ['email', '邮箱']])
const STATUS_OPTIONS = opts('全部', [['active', '正常'], ['unverified', '未验证邮箱'], ['banned', '已封禁']])
const REGISTERED_OPTIONS = opts('不限', [['1d', '24 小时内'], ['7d', '7 天内'], ['30d', '30 天内']])
const SIGN_IN_OPTIONS = opts('不限', [['7d', '7 天内'], ['30d', '30 天内'], ['90d', '90 天内'], ['stale', '超过 90 天']])
const SORTS = [
  { value: 'new', label: '最近注册' },
  { value: 'recent', label: '最近登录' },
  { value: 'comments', label: '评论最多' },
]
const FILTERS = ['q', 'provider', 'status', 'registered', 'signIn']

const AVATAR_BG = ['#3B6FD9', '#C2563A', '#7A4FD0', '#2E8B6E', '#B5479A', '#1F7A99', '#A84A63', '#5D7A2E', '#8A6A2F']

const displayName = (u: Pick<SiteUser, 'name' | 'email' | 'id'>) => u.name ?? u.email?.split('@')[0] ?? u.id.slice(0, 8)

function Avatar({ user, size = 32 }: { user: SiteUser; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (user.avatarUrl && !broken) return <img src={user.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="shrink-0 rounded-full bg-white/5 object-cover" style={{ width: size, height: size }} />
  const bg = AVATAR_BG[[...user.id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_BG.length]
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, background: bg, fontSize: size * 0.4 }}>
      {displayName(user).slice(0, 1).toUpperCase()}
    </span>
  )
}

function ProviderBadge({ provider }: { provider: string }) {
  const p = PROVIDER[provider as Provider]
  if (!p) return <span className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-text2">{provider}</span>
  return (
    <span className="inline-flex h-[22px] items-center gap-1 rounded-md border border-line bg-white/[0.03] px-1.5 text-[11px] text-text2">
      <p.icon className="size-3" />
      {p.label}
    </span>
  )
}

function Stat({ label, value, note, good }: { label: string; value: string; note: string; good?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface px-4 py-3.5">
      <span className="text-[13px] text-text2">{label}</span>
      <span className="flex items-end gap-2">
        <span className="text-xl font-semibold tabular">{value}</span>
        <span className={clsx('pb-0.5 text-[11px]', good ? 'text-ok' : 'text-text3')}>{note}</span>
      </span>
    </div>
  )
}

function Summary({ s }: { s: SiteUserSummary | undefined }) {
  const change = s && s.prev7d ? Math.round(((s.new7d - s.prev7d) / s.prev7d) * 100) : null
  const bound = s ? s.providers.github + s.providers.google + s.providers.email : 0
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-[1fr_1fr_1fr_1fr_380px]">
      <Stat label="全部用户" value={s ? num(s.total) : '—'} note={`今日 +${num(s?.today ?? 0)}`} good={!!s?.today} />
      <Stat label="近 7 天新增" value={s ? num(s.new7d) : '—'} note={change === null ? '前 7 天无新增' : `较前 7 天 ${change >= 0 ? '+' : ''}${change}%`} good={change !== null && change > 0} />
      <Stat label="近 7 天登录" value={s ? num(s.signIn7d) : '—'} note={s && s.total ? `占全部 ${((s.signIn7d / s.total) * 100).toFixed(1)}%` : ''} />
      <Stat label="发过评论" value={s ? num(s.commenters) : '—'} note={`共 ${num(s?.comments ?? 0)} 条评论`} />
      <div className="col-span-2 flex flex-col gap-2.5 rounded-xl border border-line bg-surface px-4 py-3.5 lg:col-span-4 xl:col-span-1">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-text2">登录方式</span>
          <span className="text-[11px] text-text3">一个账号可绑定多种</span>
        </div>
        <div className="flex h-2 gap-0.5 overflow-hidden rounded bg-white/5">
          {bound > 0 && (Object.keys(PROVIDER) as Provider[]).map((p) => <span key={p} className={PROVIDER[p].bar} style={{ width: `${(s!.providers[p] / bound) * 100}%` }} />)}
        </div>
        <div className="flex gap-4.5 text-xs">
          {(Object.keys(PROVIDER) as Provider[]).map((p) => (
            <span key={p} className="flex items-center gap-1.5">
              <span className={clsx('size-[7px] rounded-full', PROVIDER[p].bar)} />
              <span className="text-text2">{PROVIDER[p].label}</span>
              <span className="font-mono">{s ? num(s.providers[p]) : '—'}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export function UsersPage() {
  const [params, setParams] = useSearchParams()
  const get = (k: string) => params.get(k) ?? ''
  const set = (patch: Record<string, string | null>) =>
    setParams((p) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v) p.set(k, v)
        else p.delete(k)
      }
      if (!('page' in patch)) p.delete('page')
      return p
    })

  const [q, setQ] = useState(get('q'))
  useEffect(() => setQ(get('q')), [params.get('q')]) // eslint-disable-line react-hooks/exhaustive-deps
  // 输入停顿 400 毫秒后再查
  useEffect(() => {
    const t = setTimeout(() => q.trim() !== get('q') && set({ q: q.trim() || null }), 400)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  const query = qs({ q: get('q'), provider: get('provider'), status: get('status'), registered: get('registered'), signIn: get('signIn'), sort: get('sort') || 'new', page: get('page') || 1, pageSize: 20 })
  const { data, error, loading, reload } = useApi<SiteUserPage>(`/users${query}`)
  const summary = useApi<SiteUserSummary>('/users/summary', 60_000)
  const s = summary.data
  const filters = FILTERS.filter((k) => get(k))

  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<Error>()
  const sync = async () => {
    setSyncing(true)
    setSyncError(undefined)
    try {
      await api('/users/sync', { method: 'POST', body: {} })
      await Promise.all([reload(), summary.reload()])
    } catch (e) {
      setSyncError(e as Error)
    } finally {
      setSyncing(false)
    }
  }

  const [open, setOpen] = useState<string | null>(null)

  return (
    <>
      <PageHeader
        title="用户"
        sub={`网站注册账号 · ${s ? num(s.total) : '…'}`}
        actions={
          <>
            <span className="text-xs text-text3 max-sm:hidden" title={s?.syncedAt ? dateTime(s.syncedAt) : undefined}>
              {s?.syncedAt ? `同步于 ${clock(s.syncedAt)}` : '尚未同步'}
            </span>
            <Button onClick={sync} disabled={syncing || !s?.syncEnabled} icon={<ArrowsClockwise className={clsx('size-[15px]', syncing && 'animate-spin')} />} className="h-8">
              {syncing ? '同步中' : '立即同步'}
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-10 pt-4 md:px-8 md:pt-6">
        {s && !s.syncEnabled && <ErrorBox error={new Error('后台接口没有配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，用户列表不会同步')} />}
        {syncError && <ErrorBox error={syncError} retry={sync} />}
        <Summary s={s} />

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 sm:w-[280px]">
            <MagnifyingGlass className="size-[15px] text-text3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索昵称、邮箱、用户 ID" className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-text3" />
            {q && (
              <button onClick={() => setQ('')} className="text-text3 hover:text-ink" aria-label="清除">
                <X className="size-3.5" />
              </button>
            )}
          </label>
          <Select label="登录方式" value={get('provider')} onChange={(v) => set({ provider: v || null })} options={PROVIDER_OPTIONS} />
          <Select label="状态" value={get('status')} onChange={(v) => set({ status: v || null })} options={STATUS_OPTIONS} />
          <Select label="注册时间" value={get('registered')} onChange={(v) => set({ registered: v || null })} options={REGISTERED_OPTIONS} />
          <Select label="最近登录" value={get('signIn')} onChange={(v) => set({ signIn: v || null })} options={SIGN_IN_OPTIONS} />
          <Select label="排序" value={get('sort') || 'new'} onChange={(v) => set({ sort: v === 'new' ? null : v })} options={SORTS} />
          {filters.length > 0 && (
            <button onClick={() => setParams(get('sort') ? { sort: get('sort') } : {})} className="text-xs text-text3 hover:text-ink">
              清除筛选
            </button>
          )}
        </div>

        <section className="rounded-xl border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3.5 md:px-5">
            <span className="text-[13px] font-semibold">符合条件 {data ? num(data.meta.total) : '…'} 人</span>
            <span className="text-[11px] text-text3">账号来自 Supabase Auth，评论数来自站内评论</span>
          </div>
          {error && (
            <div className="px-4 pb-5 md:px-5">
              <ErrorBox error={error} retry={reload} />
            </div>
          )}
          {loading && !data ? <Loading /> : data && <UserTable page={data} selected={open} onOpen={setOpen} onPage={(p) => set({ page: String(p) })} />}
        </section>
      </div>
      {open && <UserDrawer id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function UserTable({ page, selected, onOpen, onPage }: { page: SiteUserPage; selected: string | null; onOpen: (id: string) => void; onPage: (p: number) => void }) {
  if (!page.data.length) return <Empty>没有符合条件的用户</Empty>
  return (
    <>
      <div className="overflow-x-auto">
        <table className={clsx('w-full table-fixed text-[13px] md:min-w-[1040px]', STACKED)}>
          <thead>
            <tr className="border-y border-line bg-white/[0.02] text-left text-xs text-text3">
              <th className="w-[300px] py-2.5 pl-5 font-normal">用户</th>
              <th className="w-[170px] font-normal">登录方式</th>
              <th className="w-[80px] font-normal">语言</th>
              <th className="w-[70px] pr-6 text-right font-normal">评论</th>
              <th className="w-[130px] font-normal">注册时间</th>
              <th className="w-[130px] font-normal">最近登录</th>
              <th className="font-normal">状态</th>
            </tr>
          </thead>
          <tbody>
            {page.data.map((u) => (
              <tr key={u.id} onClick={() => onOpen(u.id)} className={clsx('cursor-pointer border-b border-line hover:bg-white/[0.02]', selected === u.id && 'bg-white/[0.04]')}>
                <td className="py-2.5 pl-5 max-md:w-full">
                  <div className="flex items-center gap-3">
                    <Avatar user={u} />
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{displayName(u)}</div>
                      <div className="truncate font-mono text-[11px] text-text3">{u.email ?? u.id}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="flex gap-1.5">
                    {u.providers.map((p) => (
                      <ProviderBadge key={p} provider={p} />
                    ))}
                  </div>
                </td>
                <td className="text-text2 max-md:hidden">{u.locale ? (LOCALE[u.locale] ?? u.locale) : '—'}</td>
                <td className={clsx('pr-6 text-right font-mono text-xs tabular', u.comments ? 'text-ink' : 'text-text3')}>
                  <span className="font-sans md:hidden">评论 </span>
                  {num(u.comments)}
                </td>
                <td className="font-mono text-xs text-text2">
                  <span className="font-sans text-text3 md:hidden">注册 </span>
                  {dateTime(u.registeredAt)}
                </td>
                <td className={clsx('text-xs', u.lastSignInAt && Date.now() - new Date(u.lastSignInAt).getTime() < 86400_000 ? 'text-ok' : 'text-text3')} title={u.lastSignInAt ? dateTime(u.lastSignInAt) : '从未登录'}>
                  <span className="md:hidden">登录 </span>
                  {ago(u.lastSignInAt)}
                </td>
                <td>
                  <Pill state={STATUS[u.status].state} label={STATUS[u.status].label} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3.5 md:px-5">
        <span className="text-xs text-text3">
          第 {num((page.meta.page - 1) * page.meta.pageSize + 1)}–{num(Math.min(page.meta.total, page.meta.page * page.meta.pageSize))} 条 / 共 {num(page.meta.total)} 条
        </span>
        <Pager page={page.meta.page} totalPages={page.meta.totalPages} onChange={onPage} />
      </div>
    </>
  )
}

/** 右侧抽屉：账号信息、登录方式、最近评论 */
function UserDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: u, error, loading } = useApi<SiteUserDetail>(`/users/${encodeURIComponent(id)}`)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copyId = () => {
    void navigator.clipboard.writeText(id).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const rows: [string, ReactNode][] = u
    ? [
        [
          '用户 ID',
          <span className="flex items-center gap-1.5">
            <span className="font-mono">{u.id}</span>
            <button onClick={copyId} title="复制" className="text-text3 hover:text-ink">
              <Copy className="size-3.5" />
            </button>
            {copied && <span className="text-[11px] text-ok">已复制</span>}
          </span>,
        ],
        ['注册时间', <span className="font-mono">{dateTime(u.registeredAt)}</span>],
        ['最近登录', u.lastSignInAt ? <span>{dateTime(u.lastSignInAt)} · {ago(u.lastSignInAt)}</span> : '从未登录'],
        ['邮箱验证', u.emailConfirmedAt ? `已验证 · ${dateTime(u.emailConfirmedAt)}` : <span className="text-warn">未验证（发了验证码但没完成登录）</span>],
        ...(u.bannedUntil ? [['封禁到', <span className="text-err">{dateTime(u.bannedUntil)}</span>] as [string, ReactNode]] : []),
        ['界面语言', u.locale ? (LOCALE[u.locale] ?? u.locale) : '—'],
        ['评论 / 表态', `${num(u.comments)} 条评论 · ${num(u.reactions)} 次表态`],
      ]
    : []

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="flex h-full w-full flex-col border-l border-line bg-surface sm:w-[480px]">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4 sm:h-16 sm:px-6">
          <h2 className="text-base font-semibold">用户详情</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-text2 hover:bg-white/5 hover:text-ink" aria-label="关闭">
            <X className="size-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          {error && <ErrorBox error={error} />}
          {loading && !u && <Loading />}
          {u && (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-3.5">
                <Avatar user={u} size={52} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[17px] font-semibold">{displayName(u)}</span>
                    <Pill state={STATUS[u.status].state} label={STATUS[u.status].label} />
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-text2">{u.email ?? '没有邮箱'}</div>
                </div>
              </div>

              <section className="flex flex-col gap-2.5">
                <h3 className="text-xs text-text3">账号信息</h3>
                <dl className="rounded-xl border border-line text-xs">
                  {rows.map(([k, v], i) => (
                    <div key={k} className={clsx('flex gap-3 px-3.5 py-2.5', i < rows.length - 1 && 'border-b border-line')}>
                      <dt className="w-20 shrink-0 text-text3">{k}</dt>
                      <dd className="min-w-0 break-all">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="flex flex-col gap-2.5">
                <h3 className="flex justify-between text-xs text-text3">
                  登录方式<span className="text-text2">{u.providers.length} 种</span>
                </h3>
                {u.providers.map((p) => {
                  const meta = PROVIDER[p as Provider]
                  const Icon = meta?.icon ?? EnvelopeSimple
                  const handle = p === 'github' ? (u.githubLogin ? `@${u.githubLogin}` : null) : u.email
                  return (
                    <div key={p} className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5">
                      <span className="flex size-[30px] items-center justify-center rounded-lg bg-white/[0.04]">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold">{meta?.label ?? p}</span>
                        {handle && <span className="block truncate font-mono text-[11px] text-text3">{handle}</span>}
                      </span>
                      {p === 'github' && u.githubLogin && (
                        <a href={`https://github.com/${u.githubLogin}`} target="_blank" rel="noreferrer" title="打开 GitHub 主页" className="rounded-md p-1.5 text-text3 hover:bg-white/5 hover:text-ink">
                          <ArrowSquareOut className="size-4" />
                        </a>
                      )}
                    </div>
                  )
                })}
              </section>

              <section className="flex flex-col gap-2.5">
                <h3 className="flex justify-between text-xs text-text3">
                  最近评论{u.comments > u.recentComments.length && <span className="text-text2">最近 {u.recentComments.length} 条 / 共 {num(u.comments)} 条</span>}
                </h3>
                {u.recentComments.length ? (
                  u.recentComments.map((c) => (
                    <a key={c.id} href={c.url} target="_blank" rel="noreferrer" className="flex flex-col gap-1.5 rounded-xl border border-line bg-white/[0.02] px-3.5 py-3 hover:bg-white/[0.04]">
                      <span className="flex items-center gap-1.5">
                        <span className="rounded bg-white/[0.06] px-1.5 py-px text-[10px] text-text2">{KIND_LABEL[c.kind] ?? c.kind}</span>
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                          {c.name ?? c.slug}
                          {c.parentId && <span className="ml-1.5 font-normal text-text3">· 回复</span>}
                        </span>
                        <span className="shrink-0 text-[11px] text-text3">{ago(c.createdAt)}</span>
                      </span>
                      <span className="line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-text2">{c.body}</span>
                    </a>
                  ))
                ) : (
                  <p className="rounded-xl border border-dashed border-line py-6 text-center text-xs text-text3">还没有发过评论</p>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
