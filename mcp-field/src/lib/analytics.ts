/*
 * 访问统计：每打开一个页面（包括站内跳转）用 sendBeacon 向 /api/collect 发一条（后端是 mcp-field-crawler 的 analytics），
 * 只发路径、来源和是否是打开网站的第一个页面；不用 Cookie，访客标识由后端按 IP + UA + 当天的随机盐算出，不存 IP。
 * sendBeacon 不等返回、不占主线程，不影响交互响应。自动化浏览器（navigator.webdriver）不发。
 */

let first = true

export function trackPageView(path: string) {
  if (navigator.webdriver) return
  const entry = first
  first = false
  const referrer = entry ? document.referrer || undefined : undefined
  const body = JSON.stringify({ p: path, ...(referrer ? { r: referrer } : {}), e: entry })
  try {
    if (!navigator.sendBeacon?.('/api/collect', new Blob([body], { type: 'text/plain' }))) {
      void fetch('/api/collect', { method: 'POST', body, keepalive: true }).catch(() => {})
    }
  } catch {
    /* 统计失败不影响页面 */
  }
}
