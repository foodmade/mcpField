import { ApiDirectory } from '../components/directory/ApiDirectory'
import { SkillCard, SkillRow } from '../components/directory/SkillItems'
import { useI18n } from '../i18n/context'
import type { SkillItem } from '../lib/api/entities'
import { loadDirectory, type DirectorySpec } from '../lib/api/loaders'
import { skillCategories, type ViewKey } from '../lib/categories'
import type { Route } from './+types/Skills'

const Card = ({ item }: { item: SkillItem }) => <SkillCard s={item} />
const Row = ({ item }: { item: SkillItem }) => <SkillRow s={item} />
const VIEWS: ViewKey[] = ['official', 'featured', 'verified']
const SPEC: DirectorySpec<'skill'> = { kind: 'skill', categories: skillCategories, views: VIEWS }

export const loader = (args: Route.LoaderArgs) => loadDirectory(SPEC, args)

/** Skills 目录：筛选、搜索、排序、分页都在服务端完成 */
export default function Skills({ loaderData }: Route.ComponentProps) {
  const { m } = useI18n()
  return <ApiDirectory kind="skill" text={m.dirs.skills} categories={skillCategories} views={VIEWS} data={loaderData} Card={Card} Row={Row} />
}
