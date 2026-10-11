import { ApiDirectory } from '../components/directory/ApiDirectory'
import { ServerCard, ServerRow } from '../components/directory/ServerItems'
import { useI18n } from '../i18n/context'
import type { ServerItem } from '../lib/api/entities'
import { loadDirectory, type DirectorySpec } from '../lib/api/loaders'
import { serverCategories } from '../lib/categories'
import type { Route } from './+types/RemoteServers'

const Card = ({ item }: { item: ServerItem }) => <ServerCard s={item} />
const Row = ({ item }: { item: ServerItem }) => <ServerRow s={item} />
const SPEC: DirectorySpec<'server'> = { kind: 'server', categories: serverCategories, remote: true }

export const loader = (args: Route.LoaderArgs) => loadDirectory(SPEC, args)

/** 远程服务目录（只看提供远程地址的 MCP 服务）：筛选、搜索、排序、分页都在服务端完成 */
export default function RemoteServers({ loaderData }: Route.ComponentProps) {
  const { m } = useI18n()
  return <ApiDirectory kind="server" text={m.dirs.remote} categories={serverCategories} remote data={loaderData} Card={Card} Row={Row} />
}
