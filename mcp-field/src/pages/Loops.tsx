import { ApiDirectory } from '../components/directory/ApiDirectory'
import { LoopCard, LoopRow } from '../components/directory/LoopItems'
import { useI18n } from '../i18n/context'
import type { LoopItem } from '../lib/api/entities'
import { loadDirectory, type DirectorySpec } from '../lib/api/loaders'
import { loopCategories } from '../lib/categories'
import type { Route } from './+types/Loops'

const Card = ({ item }: { item: LoopItem }) => <LoopCard l={item} />
const Row = ({ item }: { item: LoopItem }) => <LoopRow l={item} />
const SPEC: DirectorySpec<'loop'> = { kind: 'loop', categories: loopCategories }

export const loader = (args: Route.LoaderArgs) => loadDirectory(SPEC, args)

/** Loops 目录：筛选、搜索、排序、分页都在服务端完成 */
export default function Loops({ loaderData }: Route.ComponentProps) {
  const { m } = useI18n()
  return <ApiDirectory kind="loop" text={m.dirs.loops} categories={loopCategories} data={loaderData} Card={Card} Row={Row} />
}
