import { AnimatePresence, motion } from 'motion/react'
import { CalendarBlank, CheckCircle, DownloadSimple, File, FolderSimple, GithubLogo, Info, Prohibit, ShieldCheck, SquaresFour, Stack, Star, User, Warning } from '@phosphor-icons/react'
import { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import { RunlayerIcon, SnykIcon, SocketIcon, ZeroLeaksIcon } from '../components/BrandIcons'
import { Comments } from '../components/Comments'
import { CopyButton, PrimaryCopyButton } from '../components/detail/CopyButton'
import { SectionNav, useActiveSection, type SectionItem } from '../components/detail/SectionNav'
import {
  AboutSection, DetailBody, DetailError, DetailSeo, EntityHeader, InfoSection, LinkButton, ReadmeSection, RelatedSection, sourcesValue, useDateFormat,
} from '../components/detail/EntityDetail'
import { useI18n } from '../i18n/context'
import type { SkillDetail as Detail, SkillItem } from '../lib/api/entities'
import { loadDetail } from '../lib/api/loaders'
import { categoryOf, compactNumber } from '../lib/categories'
import { useCommentCount } from '../lib/comments'
import { developerOf, repoPath } from '../lib/entity'
import type { Route } from './+types/SkillDetail'

/** 安装命令：优先用数据源给出的命令，没有时按 owner/repo#skill 拼出 npx skills 命令 */
function installCommand(s: Detail): string | null {
  if (s.installCommand) return s.installCommand
  const [repo, skill] = (s.canonicalKey ?? '').split('#')
  return repo && skill ? `npx skills add https://github.com/${repo} --skill ${skill}` : null
}

/** 命令里的 / 后面允许换行，窄屏时按路径段折行，而不是从单词中间断开 */
const breakAfterSlash = (cmd: string) => cmd.split(/(?<=\/)/).flatMap((part, i) => (i ? [<wbr key={i} />, part] : [part]))

/** 文件不超过这个数时不单独成区，在安装区下方用一行列出 */
const FILES_INLINE_MAX = 2

function InstallSection({ s, cmd }: { s: Detail; cmd: string }) {
  const { m } = useI18n()
  return (
    <>
      <h2 className="text-xl font-bold tracking-tight">{m.skill.install}</h2>
      <p className="mb-4 mt-1.5 text-sm text-text2">{m.skill.installSub}</p>
      <div className="flex items-center gap-3 rounded-[14px] border border-fg/10 bg-code-bg py-3 pl-[18px] pr-3">
        <span className="self-start font-mono text-[13px] leading-7 text-fg/30 sm:text-sm">$</span>
        <code className="min-w-0 flex-1 whitespace-pre-wrap py-0.5 font-mono text-[13px] leading-6 text-ink [overflow-wrap:anywhere] sm:text-sm">{breakAfterSlash(cmd)}</code>
        <CopyButton text={cmd} className="self-start" />
      </div>
      {s.skillSlug && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-text3">
          <Info size={14} />{m.skill.verifyBefore}
          <code className="rounded-[5px] bg-fg/[0.07] px-1.5 py-px font-mono text-ink">/{s.skillSlug}</code>
          {m.skill.verifyAfter}
        </p>
      )}
      {s.files.length > 0 && s.files.length <= FILES_INLINE_MAX && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-text3">
          <FolderSimple size={14} />{m.skill.filesInline}
          {s.files.map((f) => <code key={f} className="rounded-[5px] bg-fg/[0.07] px-1.5 py-px font-mono text-text2">{f}</code>)}
        </p>
      )}
    </>
  )
}

const AUDIT_STYLE: Record<string, { icon: typeof CheckCircle; cls: string }> = {
  pass: { icon: CheckCircle, cls: 'border-accent/25 bg-accent/10 text-mint' },
  warn: { icon: Warning, cls: 'border-[#F2C94C]/25 bg-[#F2C94C]/10 text-gold' },
  fail: { icon: Prohibit, cls: 'border-[#E5484D]/30 bg-[#E5484D]/10 text-rose' },
}
const AUDIT_UNKNOWN = { icon: Info, cls: 'border-fg/15 bg-fg/[0.05] text-text2' }

/** 风险等级的颜色：无风险 / 安全 / 低风险为绿，中风险为黄，高风险 / 严重为红 */
const RISK_STYLE: Record<string, string> = {
  NONE: 'text-mint',
  SAFE: 'text-mint',
  LOW: 'text-mint',
  MEDIUM: 'text-gold',
  HIGH: 'text-rose',
  CRITICAL: 'text-rose',
}

/** 审计平台的官方标志，统一画成圆形；不认识的平台用首字母 */
function AuditorLogo({ name, size }: { name: string; size: number }) {
  const key = name.toLowerCase()
  if (key === 'gen agent trust hub') return <img src="/brands/gen.png" alt="" width={size} height={size} className="block shrink-0 rounded-full" />
  if (key === 'runlayer') return <RunlayerIcon size={size} className="block shrink-0" />
  if (key === 'zeroleaks') return <ZeroLeaksIcon size={size} className="block shrink-0" />
  const glyph = key === 'socket' ? { bg: '#C93CD7', icon: SocketIcon } : key === 'snyk' ? { bg: '#4C4A73', icon: SnykIcon } : null
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-bold text-white" style={{ width: size, height: size, background: glyph?.bg ?? '#3F4650', fontSize: size * 0.45 }}>
      {glyph ? <glyph.icon size={Math.round(size * 0.6)} /> : (name.replace(/^[^A-Za-z0-9]+/, '')[0]?.toUpperCase() ?? '?')}
    </span>
  )
}

/** 审计弹层的宽度与离视口边缘的最小距离 */
const POPOVER_W = 360
const POPOVER_GAP = 16

/**
 * 第三方安全审计：标题后的一行小字（盾牌 + 审计 + 通过数 + 叠放的平台标志），只有盾牌带颜色；
 * 悬停、点击或键盘聚焦后回车时展开每个平台的结论、风险等级和摘要。
 * 弹层只在打开时渲染（隐藏的弹层会撑出横向滚动），打开时按视口宽度左右平移，保证完整显示。
 */
function AuditBadges({ s }: { s: Detail }) {
  const { m } = useI18n()
  const fmt = useDateFormat()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [shift, setShift] = useState(0)
  const wrap = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const place = () => {
    const el = wrap.current
    if (!el) return
    const left = el.getBoundingClientRect().left
    const width = Math.min(POPOVER_W, window.innerWidth - POPOVER_GAP * 2)
    setShift(Math.min(Math.max(left, POPOVER_GAP), window.innerWidth - POPOVER_GAP - width) - left)
  }
  const later = (next: boolean, ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (next) place()
      setOpen(next)
    }, ms)
  }

  // 点击外面或按 Esc 关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  useEffect(() => () => clearTimeout(timer.current), [])

  if (s.audits.length === 0) return null
  const passed = s.audits.filter((a) => a.result === 'pass').length
  const tone = s.audits.some((a) => a.result === 'fail') ? 'text-rose' : passed === s.audits.length ? 'text-accent' : 'text-gold'
  const latest = s.audits.map((a) => a.auditedAt).filter(Boolean).sort().at(-1)
  return (
    <span
      ref={wrap}
      className="group relative"
      onPointerEnter={(e) => e.pointerType === 'mouse' && later(true, 120)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && later(false, 150)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${m.skill.audits} ${m.skill.auditsPassed(passed, s.audits.length)}`}
        onClick={() => {
          clearTimeout(timer.current)
          place()
          setOpen(true)
        }}
        className="flex items-center gap-1.5 rounded-md py-0.5 text-[13px] text-text3 transition-colors hover:text-text2"
      >
        <ShieldCheck size={14} weight="bold" className={tone} />
        <span>{m.skill.auditsShort}</span>
        <span className="font-semibold tabular-nums text-text2">{passed}/{s.audits.length}</span>
        <span className={clsx('ml-0.5 flex -space-x-1 transition-[filter] duration-200', !open && 'grayscale group-hover:grayscale-0')}>
          {s.audits.map((a) => <span key={a.auditor} className="block rounded-full ring-[1.5px] ring-bg"><AuditorLogo name={a.auditor} size={16} /></span>)}
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="dialog"
            aria-label={m.skill.audits}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-full z-[35] pt-2"
            style={{ left: shift }}
          >
            <span className="flex w-[min(360px,calc(100vw-32px))] flex-col rounded-xl border border-fg/10 bg-surface px-3.5 py-2.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.45)]">
              <span className="flex items-center justify-between border-b border-fg/[0.06] pb-2 text-xs text-text3">
                <span>{m.skill.audits}</span>
                <span>{m.skill.auditsPassed(passed, s.audits.length)}</span>
              </span>
              {s.audits.map((a) => {
                const style = AUDIT_STYLE[a.result] ?? AUDIT_UNKNOWN
                const risk = a.riskLevel?.toUpperCase()
                return (
                  <span key={a.auditor} className="flex gap-2.5 border-b border-fg/[0.06] py-2.5 last:border-0">
                    <span className="pt-px"><AuditorLogo name={a.auditor} size={22} /></span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-ink">{a.auditor}</span>
                        <span className={clsx('flex shrink-0 items-center gap-1 rounded-full border px-2 py-px text-[11px] font-medium', style.cls)}>
                          <style.icon size={11} />{m.skill.auditResult[a.result as keyof typeof m.skill.auditResult] ?? a.result}
                        </span>
                      </span>
                      {(risk || a.summary) && (
                        <span className="line-clamp-2 text-xs leading-relaxed text-text2">
                          {risk && <span className={clsx('font-medium', RISK_STYLE[risk] ?? 'text-text2')}>{m.skill.risk[risk] ?? risk}</span>}
                          {risk && a.summary && ' · '}
                          {a.summary}
                        </span>
                      )}
                    </span>
                  </span>
                )
              })}
              {latest && <span className="pt-1.5 text-[11px] text-text3">{m.skill.auditedAt(fmt(latest) ?? latest)}</span>}
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

const FILES_SHOWN = 30

/** 按所在目录分组：根目录的文件在前，其余目录按名称排序 */
function groupByDir(files: string[]) {
  const groups = new Map<string, string[]>()
  for (const f of files) {
    const i = f.lastIndexOf('/')
    const dir = i < 0 ? '' : f.slice(0, i + 1)
    groups.set(dir, [...(groups.get(dir) ?? []), f.slice(i + 1)])
  }
  return [...groups].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
}

/** 随 Skill 一起分发的文件：参考资料、脚本、模板（文件很少时由安装区列出，这里不显示） */
function FilesSection({ s }: { s: Detail }) {
  const { m } = useI18n()
  const [all, setAll] = useState(false)
  const groups = groupByDir(all ? s.files : s.files.slice(0, FILES_SHOWN))
  return (
    <>
      <h2 className="text-xl font-bold tracking-tight">{m.skill.files}</h2>
      <p className="mb-4 mt-1.5 text-sm text-text2">{m.skill.filesSub}</p>
      <div className="divide-y divide-fg/[0.06] overflow-hidden rounded-[14px] border border-fg/[0.08] bg-surface">
        {groups.map(([dir, names]) => (
          <div key={dir} className="py-1">
            {dir && (
              <div className="flex items-center gap-2.5 px-4 py-1.5">
                <FolderSimple size={14} className="shrink-0 text-text3" />
                <code className="min-w-0 truncate font-mono text-xs text-text3">{dir}</code>
              </div>
            )}
            {names.map((f) => (
              <div key={f} className={clsx('flex items-center gap-2.5 py-1.5 pr-4', dir ? 'pl-10' : 'pl-4')}>
                <File size={14} className="shrink-0 text-text3" />
                <code className="min-w-0 truncate font-mono text-xs text-text2">{f}</code>
              </div>
            ))}
          </div>
        ))}
        {!all && s.files.length > FILES_SHOWN && (
          <button onClick={() => setAll(true)} className="w-full px-4 py-2.5 text-left text-xs text-text3 transition-colors hover:text-ink active:bg-fg/[0.03]">
            {m.skill.moreFiles(s.files.length - FILES_SHOWN)}
          </button>
        )}
      </div>
    </>
  )
}

function Sidebar({ s, related }: { s: Detail; related: SkillItem[] }) {
  const { m, tr } = useI18n()
  const fmt = useDateFormat()
  const k = m.skill.infoKeys
  const repo = repoPath(s.links.repository)
  return (
    <>
      <InfoSection
        kind="skill"
        d={s}
        rows={[
          { icon: User, label: k.author, value: developerOf(s) },
          { icon: FolderSimple, label: k.repo, value: repo && <a href={s.links.repository!} target="_blank" rel="noreferrer" className="hover:text-accent">{repo}</a> },
          { icon: SquaresFour, label: k.category, value: tr(categoryOf('skill', s.category?.slug).name) },
          { icon: DownloadSimple, label: k.installs, value: s.installs?.toLocaleString('en-US') },
          { icon: Star, label: m.client.infoKeys.stars, value: s.stars?.toLocaleString('en-US') },
          { icon: CalendarBlank, label: m.skill.firstSeen, value: fmt(s.firstSeenOn) },
          { icon: Stack, label: m.detail.infoKeys.sources, value: sourcesValue(s.allLinks, m.detail.sourceNames) },
        ]}
      />
      <RelatedSection
        kind="skill"
        title={m.skill.related}
        items={related}
        allLabel={m.skill.all}
        stat={(r) => r.installs !== null && (
          <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-text2"><DownloadSimple size={13} />{compactNumber(r.installs)}</span>
        )}
      />
    </>
  )
}

type SkillSection = 'overview' | 'install' | 'files' | 'readme' | 'comments'

function Page({ s, related }: { s: Detail; related: SkillItem[] }) {
  const { m } = useI18n()
  const cat = categoryOf('skill', s.category?.slug)
  const cmd = installCommand(s)
  const showFiles = s.files.length > FILES_INLINE_MAX
  const sections: SectionItem<SkillSection>[] = [
    { id: 'overview', label: m.detail.sections.overview },
    ...(cmd ? [{ id: 'install' as const, label: m.skill.install }] : []),
    ...(showFiles ? [{ id: 'files' as const, label: m.skill.files, count: s.files.length }] : []),
    ...(s.readme ? [{ id: 'readme' as const, label: m.detail.sections.readme }] : []),
    { id: 'comments', label: m.comments.title, count: useCommentCount(`skill:${s.slug}`) },
  ]
  const { active, jump, reg } = useActiveSection(sections.map((x) => x.id), s.slug)
  return (
    <>
      <DetailSeo kind="skill" d={s} section={m.dirs.skills.title} />
      <EntityHeader
        kind="skill"
        d={s}
        listTitle={m.dirs.skills.title}
        // 有图标（仓库所有者头像）时用默认的 EntityIcon，没有时显示分类图标
        tile={s.iconUrl ? undefined : <span className="grid size-[72px] place-items-center rounded-[18px] border text-3xl" style={{ background: cat.color + '29', borderColor: cat.color + '4D', color: cat.color }}><cat.icon size={34} /></span>}
        badges={<AuditBadges s={s} />}
        meta={s.installs !== null && <span className="flex items-center gap-1 tabular-nums"><DownloadSimple size={14} />{m.skill.installs(compactNumber(s.installs))}</span>}
        actions={
          <>
            {s.links.repository && <LinkButton href={s.links.repository} icon={GithubLogo} label={m.detail.links.repo} />}
            {cmd && <PrimaryCopyButton text={cmd} label={m.skill.copyInstall} />}
          </>
        }
      />
      <DetailBody
        nav={<SectionNav items={sections} active={active} onJump={jump} />}
        faq={false}
        main={
          <>
            <section ref={reg('overview')}><AboutSection d={s} /></section>
            {cmd && <section ref={reg('install')}><InstallSection s={s} cmd={cmd} /></section>}
            {showFiles && <section ref={reg('files')}><FilesSection s={s} /></section>}
            {s.readme && <section ref={reg('readme')}><ReadmeSection d={s} /></section>}
            <section ref={reg('comments')}><Comments key={s.slug} target={`skill:${s.slug}`} /></section>
          </>
        }
        aside={<Sidebar s={s} related={related} />}
      />
    </>
  )
}

export const loader = (args: Route.LoaderArgs) => loadDetail('skill', args)

export function ErrorBoundary() {
  const { m } = useI18n()
  return <DetailError notFound={m.skill.notFound} listHref="/skills" />
}

export default function SkillDetail({ loaderData }: Route.ComponentProps) {
  return <Page s={loaderData.d} related={loaderData.related} />
}
