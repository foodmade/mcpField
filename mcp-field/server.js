import compression from 'compression'
import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'

/*
 * 前端服务：开发时挂载 Vite 中间件，生产时加载构建产物。
 * /api 反向代理到后端（mcp-field-crawler 的 API，同机部署），浏览器端的搜索、实时工具列表经它访问。
 */
const DEVELOPMENT = process.env.NODE_ENV === 'development'
const PORT = Number.parseInt(process.env.PORT || '3000', 10)
const API_ORIGIN = process.env.API_ORIGIN || 'http://127.0.0.1:3100'

const app = express()
app.disable('x-powered-by')
app.use(compression())
app.use(createProxyMiddleware({ target: API_ORIGIN, changeOrigin: true, pathFilter: '/api' }))

if (DEVELOPMENT) {
  const vite = await import('vite').then((v) => v.createServer({ server: { middlewareMode: true } }))
  app.use(vite.middlewares)
  app.use(async (req, res, next) => {
    try {
      const source = await vite.ssrLoadModule('./server/app.ts')
      return await source.app(req, res, next)
    } catch (error) {
      if (error instanceof Error) vite.ssrFixStacktrace(error)
      next(error)
    }
  })
} else {
  // 带内容哈希的资源长期缓存；其余静态文件（favicon 等）缓存 1 小时
  app.use('/assets', express.static('build/client/assets', { immutable: true, maxAge: '1y' }))
  app.use(express.static('build/client', { maxAge: '1h', index: false }))
  app.use(await import('./build/server/index.js').then((mod) => mod.app))
}

app.listen(PORT, () => {
  console.log(`MCP Field ${DEVELOPMENT ? '开发' : '生产'}服务已启动：http://localhost:${PORT}（API：${API_ORIGIN}）`)
})
