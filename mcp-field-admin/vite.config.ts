import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 纯静态单页应用：构建产物由 Nginx 直接提供（admin.mcpfield.com），/api/admin 转发给后台接口（127.0.0.1:3200）。
// 本地开发：先在 mcp-field-crawler 里 npm run admin-api:dev，再 npm run dev（端口 5299）
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5299,
    proxy: { '/api/admin': { target: process.env.ADMIN_API_ORIGIN ?? 'http://127.0.0.1:3200', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false },
})
