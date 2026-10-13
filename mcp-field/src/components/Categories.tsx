import { useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'
import clsx from 'clsx'
import { Category3D } from '../fx/category3d/Category3D'
import { RevealGroup, RevealItem } from '../fx/Reveal'
import { useI18n } from '../i18n/context'
import type { Facets } from '../lib/api/entities'
import { categoryOf, type Category } from '../lib/categories'
import { Container, LinkArrow } from './ui'

const fmt = (n: number) => n.toLocaleString('en-US')

type Tile = { cat: Category; count: number }
type Size = 'lg' | 'md' | 'sm'

/** 三种尺寸的版式：封面 3D 图标的中心位置（占卡片宽高的百分比）和边长、背后光晕的半径、卡片内边距 */
const LAYOUT: Record<Size, { x: string; y: string; icon: number; glow: number; pad: string }> = {
  lg: { x: '70%', y: '32%', icon: 230, glow: 270, pad: 'p-7' },
  md: { x: '80%', y: '42%', icon: 150, glow: 180, pad: 'p-6' },
  sm: { x: '76%', y: '34%', icon: 124, glow: 150, pad: 'p-[22px]' },
}

/** 封面：会动的卡通 3D 图标，背后一团分类色光晕和淡出的点阵；悬停时光晕变亮、扩大 */
function CoverArt({ t, size, active }: { t: Tile; size: Size; active: boolean }) {
  const { x, y, icon, glow } = LAYOUT[size]
  const at = `at ${x} ${y}`
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div
        className={clsx('absolute inset-0 transition-[opacity,scale] duration-500 motion-reduce:transition-none', active ? 'scale-110 opacity-100' : 'opacity-75')}
        style={{ background: `radial-gradient(circle ${glow}px ${at}, color-mix(in oklab, var(--c) 24%, transparent), transparent)`, transformOrigin: `${x} ${y}` }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, color-mix(in oklab, var(--mf-fg) 16%, transparent) 1px, transparent 1.5px)',
          backgroundSize: '14px 14px',
          maskImage: `radial-gradient(circle ${glow * 0.8}px ${at}, #000 30%, transparent)`,
        }}
      />
      <Category3D model={t.cat.slug} size={icon} active={active} className="absolute" style={{ left: x, top: y, margin: -icon / 2 }} />
    </div>
  )
}

/** 拼贴里的一块，整块可点：封面是会动的 3D 图标；鼠标悬停或键盘聚焦时卡片浮起、边框和投影染上分类色，图标跳起来转一圈，之后动作更活跃 */
function TileShell({ t, size, className, children }: { t: Tile; size: Size; className?: string; children: ReactNode }) {
  const { m, tr, to } = useI18n()
  const [active, setActive] = useState(false)
  return (
    <Link
      to={to(`/servers?category=${t.cat.slug}`)}
      aria-label={m.categories.open(tr(t.cat.name))}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
      onFocus={(e) => e.currentTarget.matches(':focus-visible') && setActive(true)}
      onBlur={() => setActive(false)}
      className={clsx(
        'relative flex min-w-0 flex-col justify-end overflow-hidden rounded-[20px] border transition-[translate,border-color,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:translate-none motion-reduce:transition-none',
        active
          ? '-translate-y-1.5 border-[color-mix(in_oklab,var(--c)_45%,transparent)] shadow-[0_22px_44px_-20px_color-mix(in_oklab,var(--c)_70%,transparent),0_10px_24px_-12px_rgba(0,0,0,0.45)]'
          : 'border-fg/[0.07] shadow-[0_0_0_0_transparent]',
        LAYOUT[size].pad,
        className,
      )}
      style={{ '--c': t.cat.color, background: 'linear-gradient(180deg, color-mix(in oklab, var(--mf-fg) 4%, transparent), transparent 55%), var(--color-surface)' } as CSSProperties}
    >
      <CoverArt t={t} size={size} active={active} />
      <div className="relative">{children}</div>
    </Link>
  )
}

/**
 * 热门分类：收录最多的 6 个分类，非对称拼贴（第一名一大块，右侧上排两块、下排三块）。
 * 封面是会动的卡通 3D 图标配细体大数字。reps 是前三个分类的代表服务名。
 */
export function Categories({ facets, reps }: { facets: Facets; reps: Record<string, string[]> }) {
  const { m, tr, locale } = useI18n()
  const sep = locale === 'en' ? ', ' : '、'
  const known = facets.categories.filter((c) => c.slug)
  const tiles: Tile[] = [...known]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((c) => ({ cat: categoryOf('server', c.slug), count: c.count }))
  if (tiles.length < 6) return null
  const sum = tiles.reduce((s, t) => s + t.count, 0)
  const [big, ...rest] = tiles
  const names = (t: Tile, n: number) => (reps[t.cat.slug] ?? []).slice(0, n)

  return (
    <Container className="pt-16">
      <RevealGroup className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <RevealItem>
          <h2 className="text-xl font-bold tracking-tight md:text-[22px]">{m.categories.title}</h2>
          <p className="mt-1.5 text-sm text-text3">{m.categories.sub(fmt(sum), `${Math.round((sum / Math.max(1, facets.total)) * 100)}%`)}</p>
        </RevealItem>
        <RevealItem>
          <LinkArrow href="/servers">{m.categories.all(known.length)}</LinkArrow>
        </RevealItem>
      </RevealGroup>

      <div className="grid gap-3 lg:h-[440px] lg:grid-cols-[456px_1fr]">
        <TileShell t={big} size="lg" className="min-h-[360px]">
          <div className="flex flex-col gap-3.5">
            <span className="text-[22px] font-semibold">{tr(big.cat.name)}</span>
            <div className="flex flex-wrap items-end gap-2.5">
              <span className="text-[64px] font-light leading-[0.95] tracking-[-0.045em] sm:text-[76px]">{fmt(big.count)}</span>
              <span className="pb-1.5 text-[13px] text-text3">{m.categories.unit}</span>
            </div>
            {names(big, 4).length > 0 && (
              <div className="flex items-center gap-2 border-t border-fg/[0.06] pt-3.5">
                <span className="flex">
                  {names(big, 4).map((n) => (
                    <span key={n} className="-mr-1.5 grid size-6 place-items-center rounded-[7px] border-2 border-surface bg-subtle text-[11px] font-semibold text-text2">
                      {Array.from(n)[0]?.toUpperCase()}
                    </span>
                  ))}
                </span>
                <span className="truncate pl-2 text-[12.5px] text-text3">{names(big, 4).join(sep)}</span>
              </div>
            )}
          </div>
        </TileShell>

        <div className="grid gap-3 lg:grid-rows-2">
          <div className="grid gap-3 sm:grid-cols-2">
            {rest.slice(0, 2).map((t) => (
              <TileShell key={t.cat.slug} t={t} size="md" className="min-h-[200px]">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-base font-semibold">{tr(t.cat.name)}</span>
                    <span className="text-[44px] font-light leading-none tracking-[-0.04em]">{fmt(t.count)}</span>
                  </div>
                  {names(t, 3).length > 0 && <span className="truncate text-[12.5px] text-text3">{names(t, 3).join(sep)}</span>}
                </div>
              </TileShell>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {rest.slice(2).map((t) => (
              <TileShell key={t.cat.slug} t={t} size="sm" className="min-h-[200px]">
                <div className="flex flex-col gap-2.5">
                  <span className="text-[15px] font-semibold">{tr(t.cat.name)}</span>
                  <span className="text-[34px] font-light leading-none tracking-[-0.035em]">{fmt(t.count)}</span>
                  <span className="h-0.5 overflow-hidden rounded-full bg-fg/[0.06]">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${(t.count / big.count) * 100}%` }} />
                  </span>
                </div>
              </TileShell>
            ))}
          </div>
        </div>
      </div>
    </Container>
  )
}
