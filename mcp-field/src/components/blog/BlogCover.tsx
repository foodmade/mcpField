import clsx from 'clsx'
import type { BlogCard } from '../../lib/api/blog'
import { coverStyle } from '../../lib/blog'

/** 文章封面：有封面图就用图；没有时画一张渐变底 + 图标的默认封面，颜色按地址固定（large 时左上角加文件路径） */
export function BlogCover({ post, large, className }: { post: Pick<BlogCard, 'slug' | 'coverUrl' | 'title'>; large?: boolean; className?: string }) {
  const { color, icon: Icon } = coverStyle(post.slug)
  if (post.coverUrl) {
    return (
      <div className={clsx('overflow-hidden border border-line bg-subtle', className)}>
        <img src={post.coverUrl} alt={post.title} loading={large ? 'eager' : 'lazy'} decoding="async" className="size-full object-cover" />
      </div>
    )
  }
  return (
    <div
      aria-hidden
      className={clsx('relative flex items-center justify-center overflow-hidden border border-line', className)}
      style={{ background: `radial-gradient(90% 110% at 88% 0%, ${color}40, transparent 70%), radial-gradient(70% 90% at 0% 100%, ${color}1f, transparent 70%), var(--color-code-bg)` }}
    >
      {large && <span className="absolute left-6 top-5 max-w-[80%] truncate font-mono text-xs text-fg/50">~/blog/{post.slug}.md</span>}
      <Icon size={large ? 72 : 28} weight="duotone" style={{ color }} />
    </div>
  )
}
