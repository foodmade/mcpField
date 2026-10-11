import { ApiDirectory } from '../components/directory/ApiDirectory'
import { CliCard, CliRow } from '../components/directory/CliItems'
import { useI18n } from '../i18n/context'
import type { CliItem } from '../lib/api/entities'
import { loadDirectory, type DirectorySpec } from '../lib/api/loaders'
import { cliCategories, type ViewKey } from '../lib/categories'
import type { Route } from './+types/Clis'

const Card = ({ item }: { item: CliItem }) => <CliCard c={item} />
const Row = ({ item }: { item: CliItem }) => <CliRow c={item} />
const VIEWS: ViewKey[] = ['official', 'featured', 'verified']
const SPEC: DirectorySpec<'cli'> = { kind: 'cli', categories: cliCategories, views: VIEWS }

export const loader = (args: Route.LoaderArgs) => loadDirectory(SPEC, args)

/** CLI 目录：筛选、搜索、排序、分页都在服务端完成 */
export default function Clis({ loaderData }: Route.ComponentProps) {
  const { m } = useI18n()
  return <ApiDirectory kind="cli" text={m.dirs.cli} categories={cliCategories} views={VIEWS} data={loaderData} Card={Card} Row={Row} />
}
