// pm2 进程配置：由 mcpfield deploy 在服务器上执行 pm2 startOrReload deploy/ecosystem.config.cjs
const { resolve } = require('node:path')

const root = resolve(__dirname, '..')

module.exports = {
  apps: [
    {
      // 后端 API：直接用 node 加载 tsx，pm2 监控的就是实际进程（内存上限才生效）
      name: 'mcpfield-api',
      cwd: resolve(root, 'mcp-field-crawler'),
      script: 'src/api/server.ts',
      interpreter: 'node',
      node_args: '--import tsx --env-file-if-exists=.env',
      max_memory_restart: '350M',
      env: { NODE_ENV: 'production' },
    },
    {
      // 管理后台接口（admin.mcpfield.com）：和网站 API 分开的进程，只监听本机 3200；页面是 Nginx 直接提供的静态文件
      name: 'mcpfield-admin-api',
      cwd: resolve(root, 'mcp-field-crawler'),
      script: 'src/admin-api/server.ts',
      interpreter: 'node',
      node_args: '--import tsx --env-file-if-exists=.env',
      max_memory_restart: '350M',
      env: { NODE_ENV: 'production' },
    },
    {
      // 前端服务端渲染：只监听本机，由服务器自带的 Nginx（443）转发外部请求
      name: 'mcpfield-web',
      cwd: resolve(root, 'mcp-field'),
      script: 'server.js',
      // Googlebot 按 sitemap 大量抓取时（每秒 3 次以上服务端渲染）内存会涨到 400MB 左右，350M 的上限下每两分钟重启一次、返回 502；
      // 限制 V8 老生代堆到 512MB，让它及早回收，进程超过 700M 才重启
      node_args: '--max-old-space-size=512',
      max_memory_restart: '700M',
      env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3000', API_ORIGIN: 'http://127.0.0.1:3100' },
    },
  ],
}
