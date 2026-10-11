import type { ToolDraft, ToolParamDraft } from '../core/draft.ts'

const MAX_DEPTH = 3

/** 把 JSON Schema 的 properties 展开成一行一个参数，嵌套参数用点号路径（options.timeout） */
export function flattenSchemaParams(schema: unknown, prefix = '', depth = 0, out: ToolParamDraft[] = []): ToolParamDraft[] {
  if (!schema || typeof schema !== 'object' || depth > MAX_DEPTH) return out
  const { properties, required } = schema as { properties?: unknown; required?: unknown }
  if (!properties || typeof properties !== 'object') return out
  const requiredSet = new Set(Array.isArray(required) ? required.filter((r) => typeof r === 'string') : [])

  for (const [key, prop] of Object.entries(properties as Record<string, unknown>)) {
    if (!prop || typeof prop !== 'object') continue
    const p = prop as { type?: unknown; description?: unknown; enum?: unknown; default?: unknown }
    const path = prefix ? `${prefix}.${key}` : key
    out.push({
      path,
      jsonType: Array.isArray(p.type) ? p.type.join('|') : typeof p.type === 'string' ? p.type : undefined,
      description: typeof p.description === 'string' ? p.description : undefined,
      required: requiredSet.has(key),
      enumValues: Array.isArray(p.enum) ? p.enum : undefined,
      defaultValue: p.default,
    })
    flattenSchemaParams(prop, path, depth + 1, out)
  }
  return out
}

/** MCP tools/list 返回的工具数组 → 工具草稿（同时兼容 inputSchema / input_schema 两种写法） */
export function toToolDrafts(raw: unknown): ToolDraft[] {
  if (!Array.isArray(raw)) return []
  const tools: ToolDraft[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const t = entry as Record<string, unknown>
    if (typeof t.name !== 'string' || !t.name.trim() || seen.has(t.name)) continue
    seen.add(t.name)
    const inputSchema = t.inputSchema ?? t.input_schema
    tools.push({
      name: t.name.trim(),
      title: typeof t.title === 'string' ? t.title : undefined,
      description: typeof t.description === 'string' ? t.description : undefined,
      inputSchema,
      annotations: t.annotations && typeof t.annotations === 'object' ? (t.annotations as Record<string, unknown>) : undefined,
      params: flattenSchemaParams(inputSchema),
    })
  }
  return tools
}
