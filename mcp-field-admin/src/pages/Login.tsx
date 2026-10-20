import { Eye, EyeSlash, LockSimple, User, WarningCircle } from '@phosphor-icons/react'
import { useState, type FormEvent } from 'react'
import { api, type AdminUser } from '../lib/api'

export function LoginPage({ onLogin }: { onLogin: (user: AdminUser) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      onLogin(await api<AdminUser>('/auth/login', { method: 'POST', body: { username: username.trim(), password } }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const field = 'flex h-11 items-center gap-2.5 rounded-lg border border-line bg-bg px-3 focus-within:border-accent'
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <form onSubmit={submit} className="flex w-full max-w-[400px] flex-col gap-7 rounded-2xl border border-line bg-surface p-6 sm:p-9">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-linear-135 from-[#3ddc97] to-[#2b7fff] text-[13px] font-bold text-[#06110d]">MF</span>
            <span className="text-lg font-semibold">MCP Field</span>
          </div>
          <div>
            <h1 className="text-[22px] font-semibold">登录管理后台</h1>
            <p className="mt-1.5 text-[13px] text-text3">仅限管理员账号，登录状态保持 7 天</p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-[13px] text-text2">账号</span>
            <span className={field}>
              <User className="size-4 text-text3" />
              <input className="h-full flex-1 bg-transparent text-sm outline-none" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required />
            </span>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-[13px] text-text2">密码</span>
            <span className={field}>
              <LockSimple className="size-4 text-text3" />
              <input className="h-full flex-1 bg-transparent text-sm outline-none" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" onClick={() => setShow(!show)} className="text-text3 hover:text-ink" aria-label={show ? '隐藏密码' : '显示密码'}>
                {show ? <Eye className="size-4" /> : <EyeSlash className="size-4" />}
              </button>
            </span>
          </label>
          {error && (
            <p className="flex items-center gap-1.5 rounded-md bg-err/10 px-2.5 py-2 text-xs text-err">
              <WarningCircle className="size-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
        <button type="submit" disabled={busy} className="h-11 rounded-lg bg-ink text-sm font-semibold text-bg hover:bg-white disabled:opacity-60">
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
      <p className="text-xs text-text3">admin.mcpfield.com · 连续输错 5 次锁定 15 分钟</p>
    </div>
  )
}
