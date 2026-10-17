import { useState, type FormEvent } from 'react'
import { PageHeader, useShell } from '../components/Layout'
import { Button, Card } from '../components/ui'
import { api } from '../lib/api'
import { dateTime } from '../lib/format'

export function AccountPage() {
  const { user, logout } = useShell()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>()
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (form.next !== form.confirm) return setMsg({ ok: false, text: '两次输入的新密码不一致' })
    setBusy(true)
    try {
      await api('/auth/password', { method: 'POST', body: { current: form.current, next: form.next } })
      setForm({ current: '', next: '', confirm: '' })
      setMsg({ ok: true, text: '密码已修改，其他设备上的登录已失效' })
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const input = 'h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm outline-none focus:border-accent'
  return (
    <>
      <PageHeader title="账号设置" />
      <div className="flex max-w-[880px] gap-5 px-8 pb-10 pt-6">
        <Card title="当前账号" className="w-[320px] shrink-0">
          <dl className="grid grid-cols-[80px_1fr] gap-y-2.5 text-[13px]">
            <dt className="text-text3">用户名</dt>
            <dd className="font-semibold">{user.username}</dd>
            <dt className="text-text3">角色</dt>
            <dd>管理员</dd>
            <dt className="text-text3">本次登录</dt>
            <dd className="font-mono text-xs">{dateTime(user.lastLoginAt)}</dd>
            <dt className="text-text3">密码修改</dt>
            <dd className="font-mono text-xs">{dateTime(user.passwordChangedAt)}</dd>
          </dl>
          <Button className="mt-5 w-full" onClick={logout}>
            退出登录
          </Button>
        </Card>
        <Card title="修改密码" sub="至少 8 个字符；修改后其他设备上的登录会失效" className="flex-1">
          <form onSubmit={submit} className="flex flex-col gap-4">
            {(
              [
                ['current', '当前密码', 'current-password'],
                ['next', '新密码', 'new-password'],
                ['confirm', '再输一次新密码', 'new-password'],
              ] as const
            ).map(([key, label, auto]) => (
              <label key={key} className="flex flex-col gap-1.5">
                <span className="text-[13px] text-text2">{label}</span>
                <input type="password" autoComplete={auto} required minLength={key === 'current' ? 1 : 8} className={input} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </label>
            ))}
            {msg && <p className={msg.ok ? 'text-xs text-ok' : 'text-xs text-err'}>{msg.text}</p>}
            <div>
              <Button primary type="submit" disabled={busy}>
                {busy ? '保存中…' : '保存新密码'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  )
}
