import { CopySimple, Package } from '@phosphor-icons/react'
import { ApiDirectory } from '../components/directory/ApiDirectory'
import { AgentCard, AgentRow } from '../components/directory/AgentItems'
import { useI18n } from '../i18n/context'
import type { AgentItem } from '../lib/api/entities'
import { loadDirectory, type DirectorySpec } from '../lib/api/loaders'
import { agentCategories, type TypeOption } from '../lib/categories'
import type { Route } from './+types/Agents'

const Card = ({ item }: { item: AgentItem }) => <AgentCard a={item} />
const Row = ({ item }: { item: AgentItem }) => <AgentRow a={item} />
const SPEC: DirectorySpec<'agent'> = { kind: 'agent', categories: agentCategories, types: ['product', 'template'] }

export const loader = (args: Route.LoaderArgs) => loadDirectory(SPEC, args)

export default function Agents({ loaderData }: Route.ComponentProps) {
  const { m } = useI18n()
  const types: TypeOption[] = [
    { value: 'product', label: m.agent.type.product ?? 'product', icon: Package, color: '#9FC6FF' },
    { value: 'template', label: m.agent.type.template ?? 'template', icon: CopySimple, color: '#C4B5FD' },
  ]
  return <ApiDirectory kind="agent" text={m.dirs.agents} categories={agentCategories} types={types} data={loaderData} Card={Card} Row={Row} />
}
