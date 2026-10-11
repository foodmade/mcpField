import { AnimatePresence, motion } from 'motion/react'
import { FileCode, GithubLogo, Globe, Info, Key, Package, TerminalWindow } from '@phosphor-icons/react'
import clsx from 'clsx'
import { useI18n } from '../../i18n/context'
import type { ServerDetail } from '../../lib/api/entities'
import { buildLocalConfig, buildRemoteConfig, CLIENT_META, highlight, installLinks, localSpec, runCommand, type ClientKey, type LocalSpec } from '../../lib/config'
import { CopyButton } from './CopyButton'

function CodeBlock({ file, code, kind, glow, animKey }: { file: string; code: string; kind: 'json' | 'shell'; glow: string; animKey: string }) {
  const lines = highlight(code, kind)
  return (
    <div className="overflow-hidden rounded-[14px] border border-fg/10" style={{ background: `radial-gradient(90% 140% at 100% 0%, ${glow}1F, transparent 60%), var(--color-code-bg)` }}>
      <div className="flex items-center justify-between border-b border-fg/[0.08] py-2 pl-4 pr-3">
        <span className="flex items-center gap-2 font-mono text-xs text-text2">
          {kind === 'shell' ? <TerminalWindow size={14} className="text-text3" /> : <FileCode size={14} className="text-text3" />}
          {file}
        </span>
        <CopyButton text={code} />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={animKey}
          initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -4, filter: 'blur(4px)' }}
          transition={{ duration: 0.22 }}
          className="flex gap-4 overflow-x-auto px-4 py-3.5 font-mono text-sm leading-[1.75] [scrollbar-width:thin]"
        >
          <div aria-hidden className="select-none text-right text-fg/20">
            {lines.map((_, i) => <div key={i}>{kind === 'shell' ? '$' : i + 1}</div>)}
          </div>
          <pre className="min-w-0 flex-1">
            {lines.map((toks, i) => (
              <div key={i} className="whitespace-pre">{toks.map((t, j) => <span key={j} className={t.cls}>{t.text}</span>)}</div>
            ))}
          </pre>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

/** 单行可复制字段：启动命令、服务地址 */
function CopyField({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-fg/[0.08] bg-surface py-2 pl-3.5 pr-2">
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-text3">{icon}{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-sm text-ink">{value}</code>
      <CopyButton text={value} />
    </div>
  )
}

const Tip = ({ children }: { children: string }) => <p className="flex items-start gap-2 text-xs leading-relaxed text-text3"><Info size={14} className="mt-px shrink-0" />{children}</p>

/** 需要用户填写的环境变量（只有名字和说明，没有取值） */
function EnvVars({ vars }: { vars: ServerDetail['envVars'] }) {
  const { m } = useI18n()
  if (vars.length === 0) return null
  return (
    <div className="overflow-hidden rounded-[14px] border border-fg/[0.08] bg-surface">
      <div className="flex items-center gap-1.5 border-b border-fg/[0.06] px-4 py-2.5 text-xs text-text3"><Key size={13} />{m.detail.envVars}</div>
      {vars.map((v, i) => (
        <div key={v.name} className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5', i > 0 && 'border-t border-fg/[0.06]')}>
          <code className="font-mono text-sm text-ink">{v.name}</code>
          {v.secret && <span className="rounded bg-[#F2994A]/15 px-1.5 py-0.5 text-[11px] text-amber">{m.detail.secret}</span>}
          {v.description && <span className="text-xs text-text3">{v.description}</span>}
        </div>
      ))}
    </div>
  )
}

function LocalConfig({ configKey, spec, d, glow }: { configKey: string; spec: LocalSpec; d: ServerDetail; glow: string }) {
  const { m } = useI18n()
  return (
    <div className="flex flex-col gap-3">
      <CodeBlock file={`mcp.json · ${m.detail.genericConfig}`} code={buildLocalConfig(configKey, spec)} kind="json" glow={glow} animKey="local" />
      <CopyField label={m.detail.runCmd} value={runCommand(spec)} icon={<TerminalWindow size={14} />} />
      <EnvVars vars={d.envVars} />
      <Tip>{m.detail.localTip}</Tip>
    </div>
  )
}

/** 没有收录到安装方式：提示去看项目 README */
function NoInstall({ d }: { d: ServerDetail }) {
  const { m } = useI18n()
  return (
    <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-fg/15 px-6 py-10 text-center">
      <Package size={24} className="text-text3" />
      <div className="text-sm font-medium">{m.detail.noInstall}</div>
      <div className="max-w-[440px] text-xs leading-relaxed text-text3">{m.detail.noInstallHint}</div>
      {d.links.repository && (
        <a href={d.links.repository} target="_blank" rel="noreferrer" className="mt-2 flex h-9 items-center gap-1.5 rounded-full border border-fg/15 px-4 text-sm text-text2 hover:border-fg/30 hover:text-ink">
          <GithubLogo size={14} />{m.detail.links.repo}
        </a>
      )}
    </div>
  )
}

const PLATFORM_ICON: Record<ClientKey, [string, string, string]> = {
  'claude-code': ['>_', '#D97757', '#fff'],
  'claude-desktop': ['C', '#D97757', '#fff'],
  cursor: ['C', '#F3F4F6', '#0A0B0D'],
  vscode: ['V', '#2B7FFF', '#fff'],
  windsurf: ['W', '#0FB5AE', '#fff'],
}
const ORDER: ClientKey[] = ['claude-code', 'cursor', 'vscode', 'claude-desktop', 'windsurf']

/** 远程服务：每个平台一行，点一下即可复制对应的安装命令或配置 */
function RemoteConfig({ configKey, url, transport }: { configKey: string; url: string; transport: string }) {
  const { m } = useI18n()
  const links = installLinks(configKey, url, transport)
  const deeplink: Partial<Record<ClientKey, string>> = { cursor: links.cursor, vscode: links.vscode }
  return (
    <div className="flex flex-col gap-3">
      <CopyField label={m.detail.endpoint} value={url} icon={<Globe size={14} />} />
      <div className="overflow-hidden rounded-[14px] border border-fg/[0.08] bg-surface">
        <div className="border-b border-fg/[0.06] px-4 py-2.5 text-xs text-text3">{m.detail.installCmds}</div>
        {ORDER.map((c, i) => {
          const meta = CLIENT_META[c]
          const code = buildRemoteConfig(configKey, url, c, transport)
          const preview = meta.kind === 'shell' ? code : JSON.stringify(JSON.parse(code))
          const [label, bg, fg] = PLATFORM_ICON[c]
          return (
            <motion.div
              key={c}
              initial={{ opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.04 }}
              className={clsx('group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-fg/[0.03]', i > 0 && 'border-t border-fg/[0.06]')}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg font-mono text-xs font-bold" style={{ background: bg, color: fg }}>{label}</span>
              <span className="w-[120px] shrink-0">
                <span className="block text-sm font-medium">{meta.label}</span>
                <span className="block truncate font-mono text-xs text-text3">{meta.file}</span>
              </span>
              <code className="hidden min-w-0 flex-1 truncate font-mono text-xs text-text2 sm:block">{preview}</code>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                {deeplink[c] && (
                  <a href={deeplink[c]} className="hidden h-7 items-center rounded-[7px] border border-fg/10 px-2.5 text-xs text-text2 transition-colors hover:border-fg/25 hover:text-ink md:flex">
                    {m.detail.openIn(meta.label)}
                  </a>
                )}
                <CopyButton text={code} />
              </span>
            </motion.div>
          )
        })}
      </div>
      <Tip>{m.detail.remoteTip}</Tip>
    </div>
  )
}

/** 配置区块：远程服务给各平台的安装命令，本地服务给通用配置和启动命令，都没有时提示查看 README */
export function ConfigSection({ configKey, d, glow }: { configKey: string; d: ServerDetail; glow: string }) {
  const remote = d.remotes[0]
  if (remote) return <RemoteConfig configKey={configKey} url={remote.url} transport={remote.transport} />
  const spec = localSpec(d)
  return spec ? <LocalConfig configKey={configKey} spec={spec} d={d} glow={glow} /> : <NoInstall d={d} />
}
