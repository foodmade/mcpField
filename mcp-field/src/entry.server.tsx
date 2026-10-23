import { PassThrough } from 'node:stream'
import { createReadableStreamFromReadable } from '@react-router/node'
import { isbot } from 'isbot'
import { renderToPipeableStream, type RenderToPipeableStreamOptions } from 'react-dom/server'
import { ServerRouter, type EntryContext } from 'react-router'

/*
 * 服务端渲染入口：基于 React Router 默认的 Node 入口，增加了页面 HTML 的缓存头。
 * 爬虫请求等全部内容渲染完再一次性输出（onAllReady），普通用户流式输出（onShellReady）。
 */

export const streamTimeout = 5_000

/**
 * 页面 HTML 的缓存策略：浏览器每次重新验证；CDN（Cloudflare）缓存 10 分钟，过期后一天内先返回旧页面、后台再更新。
 * 数据每天采集一次，10 分钟足够新。404 只短暂缓存，5xx 不缓存，避免把临时故障缓存下来。
 */
function setCacheHeaders(status: number, headers: Headers) {
  if (headers.has('Cache-Control')) return
  if (status < 300) headers.set('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400')
  else if (status === 404) headers.set('Cache-Control', 'public, max-age=0, s-maxage=60')
  else headers.set('Cache-Control', 'no-store')
}

/** 页面响应头里指向给 AI 看的站点说明（llms.txt）和博客订阅源，agent 不用解析 HTML 就能找到 */
const LINK = '</llms.txt>; rel="describedby"; type="text/plain", </blog/rss.xml>; rel="alternate"; type="application/rss+xml"'

export default function handleRequest(request: Request, responseStatusCode: number, responseHeaders: Headers, routerContext: EntryContext) {
  setCacheHeaders(responseStatusCode, responseHeaders)
  responseHeaders.set('Link', LINK)

  // https://httpwg.org/specs/rfc9110.html#HEAD
  if (request.method.toUpperCase() === 'HEAD') return new Response(null, { status: responseStatusCode, headers: responseHeaders })

  return new Promise<Response>((resolve, reject) => {
    let shellRendered = false
    const userAgent = request.headers.get('user-agent')
    const readyOption: keyof RenderToPipeableStreamOptions = (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? 'onAllReady' : 'onShellReady'

    // 超时后中止渲染，留出时间把被拒绝的 Suspense 边界输出出去
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1000)

    const { pipe, abort } = renderToPipeableStream(<ServerRouter context={routerContext} url={request.url} />, {
      [readyOption]() {
        shellRendered = true
        const body = new PassThrough({
          final(callback) {
            clearTimeout(timeoutId)
            timeoutId = undefined
            callback()
          },
        })
        responseHeaders.set('Content-Type', 'text/html')
        pipe(body)
        resolve(new Response(createReadableStreamFromReadable(body), { headers: responseHeaders, status: responseStatusCode }))
      },
      onShellError(error: unknown) {
        reject(error)
      },
      onError(error: unknown) {
        responseStatusCode = 500
        // 外壳渲染阶段的错误会由 handleDocumentRequest 记录，这里只记录流式输出中的错误
        if (shellRendered) console.error(error)
      },
    })
  })
}
