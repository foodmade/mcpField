import { AnimatePresence, motion } from 'motion/react'
import { ArrowSquareOut, FileCode, GithubLogo, Globe, Info, Key, LockKey, Package, TerminalWindow } from '@phosphor-icons/react'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { useI18n } from '../../i18n/context'
import type { ServerDetail } from '../../lib/api/entities'
import { buildLocalConfig, buildRemoteConfig, CLIENT_META, highlight, installLinks, localSpec, runCommand, type ClientKey, type LocalSpec } from '../../lib/config'
import { ClaudeCodeIcon, ClaudeIcon, CursorIcon, VSCodeIcon, WindsurfIcon } from '../BrandIcons'
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

/** 各平台的官方标志；单色标志（Cursor、Windsurf）跟随文字颜色 */
const PLATFORM_ICON: Record<ClientKey, ReactNode> = {
  'claude-code': <ClaudeCodeIcon size={22} />,
  'claude-desktop': <ClaudeIcon size={18} />,
  cursor: <CursorIcon size={18} className="text-ink" />,
  vscode: <VSCodeIcon size={18} />,
  windsurf: <WindsurfIcon size={18} className="text-ink" />,
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
          return (
            <motion.div
              key={c}
              initial={{ opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.04 }}
              className={clsx('group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-fg/[0.03]', i > 0 && 'border-t border-fg/[0.06]')}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-fg/[0.06]">{PLATFORM_ICON[c]}</span>
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

const TRANSPORT_LABEL: Record<string, string> = { 'streamable-http': 'Streamable HTTP', sse: 'SSE', stdio: 'stdio' }
/** 远程端点需要在请求头里带凭据（Authorization 或其他请求头） */
const needsAuth = (r: ServerDetail['remotes'][number]) => r.authType === 'bearer' || r.authType === 'header'

/** 远程端点：有多个（如同时提供 SSE 和 Streamable HTTP）或需要授权时逐个列出 */
function Endpoints({ remotes }: { remotes: ServerDetail['remotes'] }) {
  const { m } = useI18n()
  if (remotes.length < 2 && !remotes.some(needsAuth)) return null
  return (
    <div className="overflow-hidden rounded-[14px] border border-fg/[0.08] bg-surface">
      <div className="flex items-center gap-1.5 border-b border-fg/[0.06] px-4 py-2.5 text-xs text-text3"><Globe size={13} />{m.detail.endpoints}</div>
      {remotes.map((r, i) => (
        <div key={r.url} className={clsx('flex items-center gap-3 px-4 py-2.5', i > 0 && 'border-t border-fg/[0.06]')}>
          <span className="shrink-0 rounded bg-fg/[0.06] px-1.5 py-0.5 text-[11px] text-text2">{TRANSPORT_LABEL[r.transport] ?? r.transport}</span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{r.url}</code>
          {needsAuth(r) && <span className="flex shrink-0 items-center gap-1 rounded bg-[#F2994A]/15 px-1.5 py-0.5 text-[11px] text-amber"><LockKey size={11} />{m.detail.authRequired}</span>}
          <CopyButton text={r.url} />
        </div>
      ))}
    </div>
  )
}

type Pkg = ServerDetail['packages'][number]

/** 安装包的公开页面；Docker Hub 的镜像去掉 docker.io/ 前缀，MCPB 的标识本身就是下载地址 */
function packageUrl(p: Pkg): string | null {
  if (/^https?:\/\//.test(p.identifier)) return p.identifier
  if (p.registryType === 'npm') return `https://www.npmjs.com/package/${p.identifier}`
  if (p.registryType === 'pypi') return `https://pypi.org/project/${p.identifier}/`
  if (p.registryType === 'nuget') return `https://www.nuget.org/packages/${p.identifier}`
  if (p.registryType === 'cargo') return `https://crates.io/crates/${p.identifier}`
  if (p.registryType === 'oci') {
    const image = p.identifier.replace(/^(?:index\.)?docker\.io\//, '').split(/[:@]/)[0]!
    return image.split('/')[0]!.includes('.') ? null : `https://hub.docker.com/r/${image.includes('/') ? image : `library/${image}`}`
  }
  return null
}

/** 同一个包常按不同传输方式登记多次（stdio / sse / streamable-http）：合并成一行，列出全部传输方式 */
function groupPackages(packages: Pkg[]): (Pkg & { transports: string[] })[] {
  const groups = new Map<string, Pkg & { transports: string[] }>()
  for (const p of packages) {
    const key = `${p.registryType}|${p.identifier}|${p.version ?? ''}`
    const g = groups.get(key) ?? { ...p, transports: [] }
    if (p.transport && !g.transports.includes(p.transport)) g.transports.push(p.transport)
    groups.set(key, g)
  }
  return [...groups.values()]
}

/** 发布的安装包（npm / PyPI / Docker ……）、版本和支持的传输方式 */
function Packages({ packages }: { packages: ServerDetail['packages'] }) {
  const { m } = useI18n()
  if (packages.length === 0) return null
  return (
    <div className="overflow-hidden rounded-[14px] border border-fg/[0.08] bg-surface">
      <div className="flex items-center gap-1.5 border-b border-fg/[0.06] px-4 py-2.5 text-xs text-text3"><Package size={13} />{m.detail.packages}</div>
      {groupPackages(packages).map((p, i) => {
        const url = packageUrl(p)
        // 下载地址形式的标识（MCPB）只显示文件名
        const label = /^https?:\/\//.test(p.identifier) ? decodeURIComponent(p.identifier.split('/').pop() ?? p.identifier) : p.identifier
        return (
          <div key={`${p.registryType}:${p.identifier}:${p.version}`} className={clsx('flex items-center gap-3 px-4 py-2.5', i > 0 && 'border-t border-fg/[0.06]')}>
            <span className="shrink-0 rounded bg-fg/[0.06] px-1.5 py-0.5 text-[11px] uppercase text-text2">{p.registryType}</span>
            <code className="min-w-0 truncate font-mono text-sm text-ink" title={p.identifier}>{label}</code>
            {p.version && <span className="shrink-0 font-mono text-xs text-text3">{p.version}</span>}
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {p.transports.map((t) => <span key={t} className="hidden rounded bg-fg/[0.04] px-1.5 py-0.5 text-[11px] text-text3 sm:inline">{TRANSPORT_LABEL[t] ?? t}</span>)}
              {url && <a href={url} target="_blank" rel="noreferrer" className="grid size-7 place-items-center rounded-[7px] text-text3 hover:text-ink"><ArrowSquareOut size={14} /></a>}
              <CopyButton text={p.identifier} />
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** 配置区块：远程服务给各平台的安装命令，本地服务给通用配置和启动命令，都没有时提示查看 README；之后列出全部端点和安装包 */
export function ConfigSection({ configKey, d, glow }: { configKey: string; d: ServerDetail; glow: string }) {
  const remote = d.remotes[0]
  const spec = localSpec(d)
  const main = remote ? <RemoteConfig configKey={configKey} url={remote.url} transport={remote.transport} /> : spec ? <LocalConfig configKey={configKey} spec={spec} d={d} glow={glow} /> : <NoInstall d={d} />
  return (
    <div className="flex flex-col gap-3">
      {main}
      <Endpoints remotes={d.remotes} />
      <Packages packages={d.packages} />
    </div>
  )
}
