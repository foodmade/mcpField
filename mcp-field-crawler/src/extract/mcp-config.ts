import type { EnvVarDraft, PackageDraft, RemoteDraft } from '../core/draft.ts'

export interface ParsedMcpConfig {
  packages: PackageDraft[]
  envVars: EnvVarDraft[]
  remotes: RemoteDraft[]
  /** 配置指向第三方代理（如 mcprouter），不是项目自己的安装方式 */
  proxied: boolean
}

export const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/i
const PROXY_MARKERS = ['mcprouter']
const DOCKER_FLAGS_WITH_VALUE = new Set(['-e', '--env', '-v', '--volume', '-p', '--publish', '--name', '--network', '-w', '--workdir', '--mount', '--env-file', '--platform', '-u', '--user'])

function firstPositional(args: string[]): string | undefined {
  return args.find((a) => !a.startsWith('-'))
}

/** @scope/pkg@1.2.3 → @scope/pkg；pkg@latest → pkg */
function stripNpmVersion(spec: string): string {
  const at = spec.lastIndexOf('@')
  return at > 0 ? spec.slice(0, at) : spec
}

function packageFromCommand(command: string, args: string[]): { pkg?: PackageDraft; dockerEnv: string[] } {
  const bin = command.split('/').pop()!.toLowerCase()
  if (bin === 'npx' || bin === 'bunx' || (bin === 'pnpm' && args[0] === 'dlx')) {
    const spec = firstPositional(bin === 'pnpm' ? args.slice(1) : args)
    return { pkg: spec ? { registryType: 'npm', identifier: stripNpmVersion(spec), runtimeHint: bin, transport: 'stdio' } : undefined, dockerEnv: [] }
  }
  if (bin === 'uvx' || bin === 'pipx') {
    const fromIndex = args.indexOf('--from')
    const spec = fromIndex >= 0 ? args[fromIndex + 1] : firstPositional(bin === 'pipx' && args[0] === 'run' ? args.slice(1) : args)
    const identifier = spec?.split(/[=<>~!]=?|\[/)[0]
    return { pkg: identifier ? { registryType: 'pypi', identifier, runtimeHint: bin, transport: 'stdio' } : undefined, dockerEnv: [] }
  }
  if (bin === 'docker' || bin === 'podman') {
    const dockerEnv: string[] = []
    let image: string | undefined
    for (let i = args[0] === 'run' ? 1 : 0; i < args.length; i++) {
      const arg = args[i]!
      if (DOCKER_FLAGS_WITH_VALUE.has(arg)) {
        if (arg === '-e' || arg === '--env') dockerEnv.push(args[i + 1]!.split('=')[0]!)
        i++
        continue
      }
      if (arg.startsWith('-')) continue
      image = arg
      break
    }
    return { pkg: image ? { registryType: 'oci', identifier: image, runtimeHint: bin, transport: 'stdio' } : undefined, dockerEnv }
  }
  return { dockerEnv: [] }
}

/**
 * 解析客户端配置里的 mcpServers 片段，拆出安装包、环境变量和远程端点。
 * 只记录环境变量的名字，不保存取值：取值可能是真实密钥。
 */
export function parseMcpServersConfig(config: unknown): ParsedMcpConfig {
  const result: ParsedMcpConfig = { packages: [], envVars: [], remotes: [], proxied: false }
  const servers = (config as { mcpServers?: unknown } | null)?.mcpServers
  if (!servers || typeof servers !== 'object') return result

  const envNames = new Set<string>()
  for (const entry of Object.values(servers as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { command?: unknown; args?: unknown; env?: unknown; url?: unknown; type?: unknown; headers?: unknown }
    const args = Array.isArray(e.args) ? e.args.filter((a): a is string => typeof a === 'string') : []
    const text = [e.command, ...args, e.url].filter((v) => typeof v === 'string').join(' ').toLowerCase()
    if (PROXY_MARKERS.some((m) => text.includes(m))) {
      result.proxied = true
      continue
    }

    if (typeof e.url === 'string') {
      result.remotes.push({
        transport: e.type === 'sse' ? 'sse' : 'streamable-http',
        url: e.url,
        authType: e.headers && typeof e.headers === 'object' && Object.keys(e.headers).length > 0 ? 'header' : 'unknown',
      })
    }
    if (typeof e.command === 'string') {
      const { pkg, dockerEnv } = packageFromCommand(e.command, args)
      if (pkg && !result.packages.some((p) => p.registryType === pkg.registryType && p.identifier === pkg.identifier)) {
        result.packages.push(pkg)
      }
      dockerEnv.forEach((name) => envNames.add(name))
    }
    if (e.env && typeof e.env === 'object') Object.keys(e.env).forEach((name) => envNames.add(name))
  }

  for (const name of envNames) {
    result.envVars.push({ name, required: true, secret: SECRET_NAME.test(name) })
  }
  return result
}
