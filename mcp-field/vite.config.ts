import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// 服务端构建的入口是 server/app.ts（Express 请求处理），由 server.js 在开发和生产环境加载
export default defineConfig({
  environments: {
    ssr: {
      build: {
        rollupOptions: { input: './server/app.ts' },
      },
    },
  },
  plugins: [tailwindcss(), reactRouter()],
  // 开发时预先打包这些依赖：否则首次打开页面才发现它们，Vite 会中途重新打包并让这次水合失败
  optimizeDeps: {
    include: [
      '@phosphor-icons/react', '@radix-ui/react-accordion', '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', 'clsx', 'motion/react',
      'react-markdown', 'rehype-raw', 'rehype-sanitize', 'remark-gfm',
    ],
  },
})
