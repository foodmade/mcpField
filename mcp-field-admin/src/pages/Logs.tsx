import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '../components/Layout'
import { ErrorBox, Loading, Select } from '../components/ui'
import { useApi, type LogFile } from '../lib/api'
import { dateTime, num } from '../lib/format'
import { stepLabel } from '../lib/labels'

const NAMES = ['daily', 'classify', 'probe', 'publish', 'assets', 'owner-icons', 'github', 'translate', 'translate-tools', 'describe', 'overview', 'readme', 'admin-sync']

/** pino 的 JSON 行：取时间、级别、消息，其余字段原样跟在后面 */
function parse(line: string): { level: number; text: string } {
  if (!line.startsWith('{')) return { level: line.includes('失败') ? 50 : 30, text: line }
  try {
    const { level, time, msg, pid: _p, hostname: _h, ...rest } = JSON.parse(line) as Record<string, unknown>
    const at = typeof time === 'number' ? new Date(time + 8 * 3600_000).toISOString().slice(11, 19) : ''
    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : ''
    return { level: Number(level ?? 30), text: `${at} ${String(msg ?? '')}${extra}` }
  } catch {
    return { level: 30, text: line }
  }
}

export function LogsPage() {
  const [params, setParams] = useSearchParams()
  const name = params.get('name') ?? 'daily'
  const lines = Number(params.get('lines') ?? 500)
  const { data, error, loading, reload } = useApi<LogFile>(`/logs/${name}?lines=${lines}`, 15_000)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [data?.size])

  return (
    <>
      <PageHeader title="运行日志" sub="服务器 mcp-field-crawler/logs 下的日志末尾，每 15 秒刷新" onRefresh={reload} />
      <div className="flex flex-col gap-4 px-4 pb-10 pt-4 md:px-8 md:pt-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <Select label="日志" value={name} onChange={(v) => setParams({ name: v })} options={NAMES.map((n) => ({ value: n, label: n === 'daily' ? '每日任务 daily.log' : `${stepLabel(n)} run-${n}.log` }))} />
          <Select label="行数" value={String(lines)} onChange={(v) => setParams({ name, lines: v })} options={['200', '500', '2000', '5000'].map((v) => ({ value: v, label: `最后 ${v} 行` }))} />
          {data && (
            <span className="break-all text-xs text-text3">
              {data.file} · {num(Math.round(data.size / 1024))} KB · 更新于 {dateTime(data.updatedAt)}
            </span>
          )}
        </div>
        {error && <ErrorBox error={error} retry={reload} />}
        {loading && !data ? (
          <Loading />
        ) : (
          data && (
            <div className="h-[calc(100dvh-220px)] min-h-[320px] overflow-auto rounded-xl border border-line bg-[#07080a] px-3 py-3 font-mono text-[11px] md:h-[calc(100vh-190px)] md:px-4 md:text-[11.5px] leading-relaxed">
              {data.lines.length === 0 && <p className="text-text3">日志文件不存在或是空的（这个命令还没有手动运行过）</p>}
              {data.lines.map((line, i) => {
                const { level, text } = parse(line)
                return (
                  <div key={i} className={clsx('whitespace-pre-wrap break-all', level >= 50 ? 'text-err' : level >= 40 ? 'text-warn' : line.startsWith('[') ? 'text-ink' : 'text-text2')}>
                    {text}
                  </div>
                )
              })}
              <div ref={end} />
            </div>
          )
        )}
      </div>
    </>
  )
}
