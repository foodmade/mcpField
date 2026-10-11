import type { Config } from '@react-router/dev/config'

export default {
  appDirectory: 'src',
  // 服务端渲染：页面 HTML 直接包含数据，便于搜索引擎收录
  ssr: true,
} satisfies Config
