import { createClient } from 'redis'
import type { Logger } from '../core/logger.ts'
import type { ProbeTarget } from './local-targets.ts'
import type { RemoteProbeTarget } from './remote.ts'

/*
 * 线上和实测机之间的任务队列（Redis，在线上）：
 *   线上 probe 命令往 jobs 队列投递目标、从 results 取回结果；实测机的 probe-worker 从 jobs 取任务、把结果写回 results。
 * 实测机用的是只能读写 probe:jobs:* / probe:results 的受限账号，拿不到线上其他任何东西（实测机要执行第三方代码）。
 * 本地包和远程服务分两个池：装包一个要几十秒到几分钟，远程读取几秒，分开排队免得远程服务被堵在后面。
 */

export type ProbeJob = ProbeTarget | RemoteProbeTarget
export type ProbePool = 'local' | 'remote'
export type ProbePriority = 'high' | 'low'

export const QUEUE = {
  /** 当天新收录的进 high，积压和到期重测的进 low；worker 先取 high */
  jobs: (pool: ProbePool, priority: ProbePriority) => `probe:jobs:${pool}:${priority}`,
  results: 'probe:results',
  /** 已投递、还没拿到结果的目标（主体键 → 投递时间毫秒），只有线上读写，避免重复投递 */
  pending: 'probe:pending',
} as const

export const jobPool = (job: ProbeJob): ProbePool => (job.registryType === 'remote' ? 'remote' : 'local')

export type QueueClient = ReturnType<typeof createClient>

/** 不发 CLIENT SETINFO：实测机的受限账号只放行取任务、写结果用到的命令 */
export async function connectQueue(url: string, logger: Logger): Promise<QueueClient> {
  const client = createClient({ url, disableClientInfo: true })
  client.on('error', (error: Error) => logger.warn({ err: error.message }, 'Redis 连接出错，自动重连'))
  await client.connect()
  return client
}
