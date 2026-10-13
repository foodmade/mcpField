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
      // 前端服务端渲染：只监听本机，由服务器自带的 Nginx（443）转发外部请求
      name: 'mcpfield-web',
      cwd: resolve(root, 'mcp-field'),
      script: 'server.js',
      max_memory_restart: '350M',
      env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3000', API_ORIGIN: 'http://127.0.0.1:3100' },
    },
  ],
}
