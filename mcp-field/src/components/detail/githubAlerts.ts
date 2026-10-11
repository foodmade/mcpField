/** 极简的 hast 节点类型，避免直接依赖 hast 的类型包 */
type HNode = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HNode[]; value?: string }

export type AlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution'

const MARKER = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i

/**
 * 把 GitHub 的提示块语法（> [!TIP] …）渲染成带标题和颜色的提示框。
 * 放在 rehype-sanitize 之后执行，这里添加的 class 不会被过滤掉。
 */
export function rehypeGithubAlerts(labels: Record<AlertType, string>) {
  const transform = (quote: HNode) => {
    const paragraph = quote.children?.find((c) => c.type === 'element' && c.tagName === 'p')
    const first = paragraph?.children?.[0]
    if (!first || first.type !== 'text') return
    const match = MARKER.exec(first.value ?? '')
    if (!match) return
    const type = match[1]!.toLowerCase() as AlertType
    first.value = (first.value ?? '').slice(match[0].length)
    quote.properties = { ...quote.properties, className: ['md-alert', `md-alert-${type}`] }
    quote.children = [{ type: 'element', tagName: 'p', properties: { className: ['md-alert-title'] }, children: [{ type: 'text', value: labels[type] }] }, ...(quote.children ?? [])]
  }
  const walk = (node: HNode) => {
    for (const child of node.children ?? []) {
      if (child.type === 'element' && child.tagName === 'blockquote') transform(child)
      walk(child)
    }
  }
  return () => (tree: HNode) => walk(tree)
}
