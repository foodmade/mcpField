import { data } from 'react-router'

/** 没有匹配的页面：返回 404，由站点布局的 ErrorBoundary 显示 */
export function loader() {
  throw data(null, { status: 404 })
}

export default function NotFound() {
  return null
}
