import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten'
import type { Html } from './html.ts'

/** TanStack Router 一个路由匹配的服务端加载数据 */
export interface TanStackMatch {
  id: string
  status?: string
  data: unknown
}

const SANDBOX_TIMEOUT_MS = 2_000
const SANDBOX_MEMORY_BYTES = 64 * 1024 * 1024

// 页面脚本会访问 self / document，这里只提供它们用到的最小桩对象
const PRELUDE = `
var self = globalThis; var window = globalThis;
var document = { readyState: 'complete', currentScript: { remove: function () {} }, addEventListener: function () {} };
`

const EPILOGUE = `
;(function () {
  var t = self.$_TSR;
  if (t && t.buffer) t.buffer.forEach(function (f) { try { f() } catch (e) {} });
  var matches = (t && t.router && t.router.matches) || [];
  return JSON.stringify(matches.map(function (m) { return { id: m.i, status: m.s, data: m.l } }));
})()
`

/**
 * 提取 TanStack Start 内嵌在 HTML 里的路由加载数据。
 * 这段数据是 seroval 序列化的 JavaScript（不是 JSON），属于第三方代码，
 * 因此放进 QuickJS（WebAssembly）沙箱执行：无网络、无文件系统，并限制时间和内存。
 */
export async function extractTanStackMatches($: Html): Promise<TanStackMatch[]> {
  const scripts = $('script.\\$tsr')
    .toArray()
    .map((el) => $(el).text())
  if (scripts.length === 0) return []

  const QuickJS = await getQuickJS()
  const json = QuickJS.evalCode(PRELUDE + scripts.join(';\n') + EPILOGUE, {
    shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + SANDBOX_TIMEOUT_MS),
    memoryLimitBytes: SANDBOX_MEMORY_BYTES,
  })
  if (typeof json !== 'string') return []
  return JSON.parse(json) as TanStackMatch[]
}

/** 在所有匹配里找到第一个含有指定键的加载数据 */
export function findLoaderValue(matches: TanStackMatch[], key: string): unknown {
  for (let i = matches.length - 1; i >= 0; i--) {
    const data = matches[i]?.data
    if (data && typeof data === 'object' && key in data) return (data as Record<string, unknown>)[key]
  }
  return undefined
}
