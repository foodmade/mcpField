import { motion } from 'motion/react'
import { CalendarBlank, Check, CheckCircle, Copy, DownloadSimple, File, FolderSimple, GithubLogo, Info, Prohibit, ShieldCheck, SquaresFour, Stack, Star, User, Warning } from '@phosphor-icons/react'
import { useState } from 'react'
import clsx from 'clsx'
import { Comments } from '../components/Comments'
import { CopyButton, copyText } from '../components/detail/CopyButton'
import {
  AboutSection, DetailBody, DetailError, DetailSeo, EntityHeader, InfoSection, LinkButton, ReadmeSection, RelatedSection, sourcesValue, useDateFormat,
} from '../components/detail/EntityDetail'
import { RevealGroup, RevealItem } from '../fx/Reveal'
import { useI18n } from '../i18n/context'
import type { SkillDetail as Detail, SkillItem } from '../lib/api/entities'
import { loadDetail } from '../lib/api/loaders'
import { categoryOf, compactNumber } from '../lib/categories'
import { developerOf, repoPath } from '../lib/entity'
import type { Route } from './+types/SkillDetail'

/** 安装命令：优先用数据源给出的命令，没有时按 owner/repo#skill 拼出 npx skills 命令 */
function installCommand(s: Detail): string | null {
  if (s.installCommand) return s.installCommand
  const [repo, skill] = (s.canonicalKey ?? '').split('#')
  return repo && skill ? `npx skills add https://github.com/${repo} --skill ${skill}` : null
}

function CopyInstall({ cmd }: { cmd: string }) {
  const { m } = useI18n()
  const [copied, setCopied] = useState(false)
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={() => {
        copyText(cmd)
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }}
      className="flex h-[38px] items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink shadow-[0_8px_24px_-6px_#3DDC9780]"
    >
      {copied ? <Check size={15} weight="bold" /> : <Copy size={15} weight="bold" />}
      {copied ? m.detail.copied : m.skill.copyInstall}
    </motion.button>
  )
}

function InstallSection({ s, cmd, glow }: { s: Detail; cmd: string; glow: string }) {
  const { m } = useI18n()
  return (
    <section>
      <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight"><DownloadSimple size={22} className="text-accent" />{m.skill.install(s.name)}</h2>
      <p className="mb-4 mt-1.5 text-sm text-text2">{m.skill.installSub}</p>
      <div className="flex items-center gap-3 rounded-[14px] border border-fg/10 py-3.5 pl-[18px] pr-3" style={{ background: `radial-gradient(80% 250% at 100% 0%, ${glow}1F, transparent 60%), var(--color-code-bg)` }}>
        <span className="font-mono text-sm text-fg/30">$</span>
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-sm text-ink [scrollbar-width:none]">{cmd}</code>
        <CopyButton text={cmd} />
      </div>
      {s.skillSlug && (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-text3">
          <Info size={14} />{m.skill.verifyBefore}
          <code className="rounded-[5px] bg-fg/[0.07] px-1.5 py-px font-mono text-ink">/{s.skillSlug}</code>
          {m.skill.verifyAfter}
        </p>
      )}
    </section>
  )
}

const AUDIT_STYLE: Record<string, { icon: typeof CheckCircle; cls: string }> = {
  pass: { icon: CheckCircle, cls: 'border-accent/25 bg-accent/10 text-mint' },
  warn: { icon: Warning, cls: 'border-[#F2C94C]/25 bg-[#F2C94C]/10 text-gold' },
  fail: { icon: Prohibit, cls: 'border-[#E5484D]/30 bg-[#E5484D]/10 text-rose' },
}

/** 风险等级的颜色：无风险 / 安全 / 低风险为绿，中风险为黄，高风险 / 严重为红 */
const RISK_STYLE: Record<string, string> = {
  NONE: 'text-mint',
  SAFE: 'text-mint',
  LOW: 'text-mint',
  MEDIUM: 'text-gold',
  HIGH: 'text-rose',
  CRITICAL: 'text-rose',
}

/** COMMAND_EXECUTION → command execution */
const prettyCategory = (c: string) => c.toLowerCase().replace(/_/g, ' ')

/** 第三方安全审计结果：结论、风险等级、摘要、涉及的行为类别、检查时间 */
function AuditsSection({ s }: { s: Detail }) {
  const { m } = useI18n()
  const fmt = useDateFormat()
  if (s.audits.length === 0) return null
  return (
    <section>
      <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight"><ShieldCheck size={22} className="text-accent" />{m.skill.audits}</h2>
      <p className="mb-4 mt-1.5 text-sm text-text2">{m.skill.auditsSub}</p>
      <RevealGroup className="grid gap-3 sm:grid-cols-2" stagger={0.05}>
        {s.audits.map((a) => {
          const style = AUDIT_STYLE[a.result] ?? { icon: Info, cls: 'border-fg/15 bg-fg/[0.05] text-text2' }
          const risk = a.riskLevel?.toUpperCase()
          return (
            <RevealItem key={a.auditor}>
              <div className="flex h-full flex-col gap-2 rounded-[14px] border border-fg/[0.08] bg-surface px-4 py-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{a.auditor}</span>
                  <span className={clsx('flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', style.cls)}>
                    <style.icon size={12} />{m.skill.auditResult[a.result as keyof typeof m.skill.auditResult] ?? a.result}
                  </span>
                </div>
                {risk && <span className={clsx('text-xs font-medium', RISK_STYLE[risk] ?? 'text-text2')}>{m.skill.risk[risk] ?? risk}</span>}
                {a.summary && <p className="line-clamp-3 text-xs leading-relaxed text-text2" title={a.summary}>{a.summary}</p>}
                {a.categories && a.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {a.categories.map((c) => <span key={c} className="rounded bg-fg/[0.05] px-1.5 py-0.5 text-[11px] text-text3">{prettyCategory(c)}</span>)}
                  </div>
                )}
                {a.auditedAt && <span className="mt-auto text-[11px] text-text3">{m.skill.auditedAt(fmt(a.auditedAt) ?? a.auditedAt)}</span>}
              </div>
            </RevealItem>
          )
        })}
      </RevealGroup>
    </section>
  )
}

const FILES_SHOWN = 30

/** 随 Skill 一起分发的文件：参考资料、脚本、模板 */
function FilesSection({ s }: { s: Detail }) {
  const { m } = useI18n()
  const [all, setAll] = useState(false)
  if (s.files.length === 0) return null
  const files = all ? s.files : s.files.slice(0, FILES_SHOWN)
  return (
    <section>
      <h2 className="flex items-center gap-2.5 text-xl font-bold tracking-tight"><FolderSimple size={22} className="text-accent" />{m.skill.files}</h2>
      <p className="mb-4 mt-1.5 text-sm text-text2">{m.skill.filesSub}</p>
      <div className="overflow-hidden rounded-[14px] border border-fg/[0.08] bg-surface">
        {files.map((f, i) => (
          <div key={f} className={clsx('flex items-center gap-2.5 px-4 py-2', i > 0 && 'border-t border-fg/[0.06]')}>
            <File size={14} className="shrink-0 text-text3" />
            <code className="min-w-0 truncate font-mono text-xs text-text2">{f}</code>
          </div>
        ))}
        {!all && s.files.length > FILES_SHOWN && (
          <button onClick={() => setAll(true)} className="w-full border-t border-fg/[0.06] px-4 py-2 text-left text-xs text-text3 hover:text-ink">
            {m.skill.moreFiles(s.files.length - FILES_SHOWN)}
          </button>
        )}
      </div>
    </section>
  )
}

function Sidebar({ s, related }: { s: Detail; related: SkillItem[] }) {
  const { m, tr } = useI18n()
  const fmt = useDateFormat()
  const k = m.skill.infoKeys
  const repo = repoPath(s.links.repository)
  return (
    <>
      <RelatedSection kind="skill" title={m.skill.related} items={related} allLabel={m.skill.all} />
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
    </>
  )
}

function Page({ s, related }: { s: Detail; related: SkillItem[] }) {
  const { m } = useI18n()
  const cat = categoryOf('skill', s.category?.slug)
  const cmd = installCommand(s)
  return (
    <>
      <DetailSeo kind="skill" d={s} section={m.dirs.skills.title} />
      <EntityHeader
        kind="skill"
        d={s}
        listTitle={m.dirs.skills.title}
        tile={<span className="grid size-[72px] place-items-center rounded-[18px] border text-3xl" style={{ background: cat.color + '29', borderColor: cat.color + '4D', color: cat.color }}><cat.icon size={34} /></span>}
        meta={s.installs !== null && <span className="flex items-center gap-1 tabular-nums"><DownloadSimple size={14} />{m.skill.installs(compactNumber(s.installs))}</span>}
        actions={
          <>
            {s.links.repository && <LinkButton href={s.links.repository} icon={GithubLogo} label={m.detail.links.repo} />}
            {cmd && <CopyInstall cmd={cmd} />}
          </>
        }
      />
      <DetailBody
        main={
          <>
            <AboutSection d={s} />
            {cmd && <InstallSection s={s} cmd={cmd} glow={cat.color} />}
            <AuditsSection s={s} />
            <FilesSection s={s} />
            {s.readme && <section><ReadmeSection d={s} /></section>}
            <section><Comments key={s.slug} target={`skill:${s.slug}`} /></section>
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
