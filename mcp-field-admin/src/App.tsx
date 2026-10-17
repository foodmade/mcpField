import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router'
import { Layout } from './components/Layout'
import { Loading } from './components/ui'
import { api, setUnauthorizedHandler, type AdminUser } from './lib/api'
import { AccountPage } from './pages/Account'
import { DailyPage } from './pages/Daily'
import { DashboardPage } from './pages/Dashboard'
import { ItemsPage } from './pages/Items'
import { LoginPage } from './pages/Login'
import { LogsPage } from './pages/Logs'

/* 登录态：启动时问一次 /auth/me；任何接口返回 401 都回到登录页 */
export function App() {
  const [user, setUser] = useState<AdminUser | null | undefined>(undefined)

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null))
    api<AdminUser>('/auth/me').then(setUser, () => setUser(null))
  }, [])

  const logout = useCallback(() => {
    void api('/auth/logout', { method: 'POST', body: {} }).finally(() => setUser(null))
  }, [])

  if (user === undefined) return <Loading />
  if (user === null) return <LoginPage onLogin={setUser} />
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout user={user} logout={logout} />}>
          <Route index element={<DashboardPage />} />
          <Route path="daily" element={<DailyPage />} />
          <Route path="items" element={<ItemsPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
