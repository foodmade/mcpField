import { ApiDirectory } from '../components/directory/ApiDirectory'
import { ClientCard, ClientRow } from '../components/directory/ClientItems'
import { useI18n } from '../i18n/context'
import type { ClientItem } from '../lib/api/entities'
import { loadDirectory, type DirectorySpec } from '../lib/api/loaders'
import { clientCategories } from '../lib/categories'
import type { Route } from './+types/Clients'

const Card = ({ item }: { item: ClientItem }) => <ClientCard c={item} />
const Row = ({ item }: { item: ClientItem }) => <ClientRow c={item} />
const SPEC: DirectorySpec<'client'> = { kind: 'client', categories: clientCategories }

export const loader = (args: Route.LoaderArgs) => loadDirectory(SPEC, args)

/** 客户端目录：筛选、搜索、排序、分页都在服务端完成 */
export default function Clients({ loaderData }: Route.ComponentProps) {
  const { m } = useI18n()
  return <ApiDirectory kind="client" text={m.dirs.clients} categories={clientCategories} data={loaderData} Card={Card} Row={Row} />
}
