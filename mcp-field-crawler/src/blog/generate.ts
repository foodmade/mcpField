import OpenAI from 'openai'
import { z } from 'zod'
import type { ImageSource } from './images.ts'
import { normalizeTags } from './post.ts'

/*
 * AI 写博客：用后台配置的文本模型（OpenAI 兼容接口）出选题、提取搜索词，起标题、地址、标签，写正文（流式）和摘要，给封面写生图提示词。
 * 正文里的插图先写成占位行 ![说明](image: 提示词)，正文写完后再逐张生成或搜索、上传，回填成真实地址（见 resolveImages）。
 */

/** 预设的主题方向：id → 交给模型的写法说明 */
export const DIRECTIONS: Record<string, { label: string; guide: string }> = {
  tutorial: { label: '上手教程', guide: '一步一步的上手教程：准备工作、安装配置、实际使用、常见问题，读者照着做就能跑起来' },
  review: { label: '深度评测', guide: '对一个工具或服务的深度评测：定位、核心能力、上手和接入成本、优缺点和适用场景，结论要明确；分析基于它的功能、文档和工作机制，不编造测试结果' },
  compare: { label: '对比选型', guide: '多个同类工具的对比选型：对比维度、逐项比较（适合用表格）、不同场景下的推荐' },
  ecosystem: { label: '生态观察', guide: '对 MCP 生态某个方向的观察和分析：现状、代表性项目、趋势和判断' },
  testing: { label: '实测记录', guide: '一次动手实测的记录：测试环境、步骤、观察到的结果和数据、踩过的坑；结果和数据只用作者在要点里给出的，作者没给时写成可照做的测试方法和检查清单，不编造结果' },
  news: { label: '新闻解读', guide: '对一条行业动态的解读：发生了什么、为什么重要、对开发者的影响' },
}

/** 预设 id 换成写法说明；不是预设的当作自定义方向原样使用 */
export const directionGuide = (direction: string) => DIRECTIONS[direction]?.guide ?? direction.trim()

export interface TextEndpoint {
  baseURL: string
  apiKey: string
  model: string
}

export interface WriteInput {
  title: string
  direction: string
  keywords?: string
  notes?: string
  outline?: string[]
  /** 站内素材清单（materialsText 的结果） */
  materials: string
  images: { count: number; source: ImageSource }
}

export interface PlanInput {
  direction: string
  keywords?: string
  notes?: string
  materials: string
}

export interface TopicsInput {
  direction: string
  keywords?: string
  notes?: string
  /** 候选条目清单（materialsText 的结果） */
  candidates: string
  /** 已有文章和已经出过的题目：选题不要重复 */
  existing: string[]
}

export interface Topic {
  title: string
  keywords: string[]
  points: string[]
  reason: string
}

export interface Plan {
  title: string
  slug: string
  tags: string[]
  outline: string[]
  coverPrompt: string
}

/* ========== 提示词 ========== */

const AUTHOR =
  '你是 MCP Field 博客的作者。MCP Field 是一个收录 MCP 服务、客户端、Skill 和 Agent 的目录网站。你是一名写了多年代码、熟悉这些工具的开发者，给同行写简体中文技术文章：像在技术社区里分享见解，不像产品说明书，也不像客服话术。' +
  '你没有亲手跑过文中的工具：判断来自它们的功能、文档和工作机制，不要假装用过或测过（不写“我会把它用在……”“我测了几次”这类经历），也不要编造测试数据。'

/**
 * 文风：去掉“机器味”。早期生成的文章几乎每段都在兜底（“具体取决于……”“以……为准”）、
 * 向读者交代“素材里没有给出……”、满篇“若 / 应 / 需”和“X 不等于 Y”，这里逐条点名
 */
const STYLE = `文风
- 像一个懂行的同事在讲：直接给做法，有明确的判断并说出理由（如“更推荐 A，因为……”“这一步最容易踩坑”），可以用“你”“我们”。
- 写具体的东西：真实的命令、配置、报错信息、操作步骤、数字和对比。与其讲一句抽象的道理，不如举一个具体的例子。
- 句子长短交替，段落有长有短。不要每一节都按“概念—步骤—注意事项—小结”的同一个套路写，也不要每节最后用一句话总结。
- 不确定的事实直接不写，不要用“具体取决于……”“以……为准”“可能因……而异”来兜底。风险提醒只在真正有风险的地方说一次，说具体（会发生什么、怎么避免），不要每段都提醒。
- 不要向读者交代你手里有什么资料、缺什么数据（不要出现“素材”“提供的信息”“给出的数据”这类说法）；没有的数据就不写，也不要声明没有。

避免这些机器腔（写出来了就换一种说法或删掉）
- 公文腔和翻译腔：若、应、需、宜、即可、能够、进行、对于……来说、在……方面、通过……的方式、旨在、助力、赋能、无缝、一站式、全方位、显著提升。
- 空洞套话：值得注意的是、需要指出的是、总的来说、综上所述、总之、简而言之、不难看出、众所周知、在当今……的时代、随着……的发展。
- 套路句式：“X 不等于 Y”“A 不代表 B”“不能被理解成……”“不是……而是……”“既能……也能……”“……，而不是……”，全文每种最多用一次。
- 结尾不要写“先从……开始，再逐步扩展”“希望对你有帮助”这类模板话：说一个具体的建议或判断就收住。`

/** 交给模型的站内条目清单的标题：读者看不到这份清单，免得模型在正文里交代“素材” */
const MATERIALS_LABEL = '可引用的站内条目（只给你参考，读者看不到这份清单）'

export function bodySystemPrompt(images: WriteInput['images']): string {
  const imageRule =
    images.count > 0
      ? `插图：在正文合适的位置插入 ${images.count} 张插图，每张单独占一行，写成 ![图片说明](image: ${images.source === 'ai' ? '英文画面描述' : '英文搜索词'})。
- 图片说明用中文，一句话，说明图里是什么。
- ${images.source === 'ai' ? 'image: 后面用英文具体描述要画的画面（主体、场景、构图），1–2 句，不要要求图里出现文字' : 'image: 后面写 2–4 个英文单词的图库搜索词，选容易搜到实拍照片的具体事物（如 laptop code editor、server room）'}。
- 不要放在第一段之前；相邻两张图之间至少隔一个章节。`
      : '不要插入任何图片。'
  return `${AUTHOR}

${STYLE}

格式
- 只输出 Markdown 正文：不要输出文章标题（标题会单独显示），不要用一级标题；用 ## 和 ### 组织章节，一般 3–6 个二级标题。二级标题短而具体，不要都写成“X：Y”的冒号格式。
- 篇幅约 1500–2500 字。开头第一段要让没看标题的读者也知道在讲什么：先用一两句交代对象（它是什么、解决什么问题），再引出这篇文章要回答的问题或结论。不要用教科书式的定义开头，也不要从行业大背景讲起。
- 中文与英文、数字之间加半角空格，使用全角标点。
- 命令、配置、代码放进带语言标注的代码块；行内的命令、文件名、参数用反引号。
- 提到“可引用的站内条目”里的条目时，用 Markdown 链接到给出的站内地址，例如 [GitHub](/servers/github)。只引用清单里的条目；不要编造服务名、星数、版本号、网址或数据。
- 列表、表格和 > [!TIP] 提示块只在确实比段落好读时用；大部分内容用段落写。
${imageRule}`
}

export function bodyUserPrompt(input: WriteInput): string {
  return [
    `标题：${input.title}`,
    `主题方向：${directionGuide(input.direction)}`,
    input.keywords?.trim() && `关键词：${input.keywords.trim()}`,
    input.notes?.trim() && `作者希望写到的要点：\n${input.notes.trim()}`,
    input.outline?.length && `提纲（二级标题）：\n${input.outline.map((o) => `- ${o}`).join('\n')}`,
    `${MATERIALS_LABEL}：\n${input.materials}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

const PLAN_SYSTEM = `${AUTHOR}

根据作者给的主题方向、关键词、要点和站内条目，为一篇新文章做规划；要点里写了暂定标题时，在它的基础上起标题。只输出一个 JSON 对象，放在 <json></json> 里：
{
  "title": "中文标题，16–36 个字，具体、有信息量，像开发者会点开的文章；不做标题党，不用“完全指南”“全面解析”“深度剖析”这类词",
  "slug": "英文地址，小写字母和连字符，3–6 个词，如 remote-mcp-server-guide",
  "tags": ["3–6 个标签，英文小写短词或常用技术名，如 claude-code、remote、oauth"],
  "outline": ["4–6 个二级标题，按文章顺序：每个 4–14 个字，具体、口语化，像目录里的条目；不要都写成“X：Y”的冒号格式"],
  "coverPrompt": "English prompt for the cover illustration: a concrete visual metaphor of the topic, 1–2 sentences, no text in the image"
}`

const TOPICS_SYSTEM = `${AUTHOR}

根据站内近期新增的热门条目，给博客出 4 个选题：
- 每个选题围绕候选里的具体条目，优先选热度高、新近出现、开发者会关心的；可以把几个同类条目放在一起做对比或盘点。
- 贴合作者选的主题方向；作者给了关键词或想法时，选题要围绕它们。
- 不要和已有文章、出过的题目重复；4 个选题之间覆盖不同的条目或角度。
- 不要编造候选里没有的条目和数据。
只输出一个 JSON 对象，放在 <json></json> 里：
{
  "topics": [
    {
      "title": "暂定标题，16–36 个字，具体、有信息量，不做标题党",
      "keywords": ["2–4 个搜索词，用来在站内找素材：先写文章主要条目的名称（照候选里的写法），再写具体的技术词或领域词；不要写 MCP、CLI、Agent、工具这类泛词"],
      "points": ["2–4 条想写到的要点，每条一句话"],
      "reason": "一句话说明为什么值得写，如热度、新近程度、读者需求"
    }
  ]
}`

const KEYWORDS_SYSTEM = `从给出的文章信息里提取 2–4 个搜索词，用来在一个收录 MCP 服务、客户端、Skill 的目录网站里找相关条目。
搜索词要具体：产品名、服务名、技术名或领域词，如 postgres、github、playwright、浏览器自动化、数据库。不要写 MCP、服务、工具、教程、入门这类泛词。
只输出搜索词，用英文逗号分隔，放在 <keywords></keywords> 里。`

const SUMMARY_SYSTEM = `${AUTHOR}

${STYLE}

根据给出的文章写一段摘要：80–140 字，一两句话，说出文章里最具体、最有用的东西（比如结论、关键步骤、对比结果），让人想点开。
不要出现“本文”“文中”“这篇文章”“读者将”“涵盖”“介绍了”“帮助开发者”这类说法，不要罗列章节，不要堆形容词。只输出摘要文字，放在 <summary></summary> 里。`

const COVER_SYSTEM = `You write prompts for an image model that draws cover illustrations for a developer-tools tech blog.
Given the article title and summary (in Chinese), describe one concrete visual metaphor for the topic in English, 1–2 sentences: main subject, scene and composition. Never ask for text, letters or logos in the image.
Reply with only the prompt inside <prompt></prompt>.`

/* ========== 调用 ========== */

const inTag = (text: string, tag: string) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)
  return (m?.[1] ?? text).trim()
}

/** 取 <json> 里的 JSON 并按 schema 校验 */
function parseJson<S extends z.ZodType>(text: string, schema: S, what: string): z.infer<S> {
  let raw: unknown
  try {
    raw = JSON.parse(inTag(text, 'json').replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    throw new Error(`模型返回的${what}不是合法的 JSON，再试一次`)
  }
  return schema.parse(raw)
}

const topicsSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().trim().min(4).max(120),
        keywords: z.array(z.string().trim().min(1)).max(8).default([]),
        points: z.array(z.string().trim().min(1)).max(8).default([]),
        reason: z.string().trim().max(300).default(''),
      }),
    )
    .min(1),
})

const planSchema = z.object({
  title: z.string().trim().min(4).max(120),
  slug: z.string().trim().max(120),
  tags: z.array(z.string()).max(12).default([]),
  outline: z.array(z.string()).max(10).default([]),
  coverPrompt: z.string().trim().max(600).default(''),
})

/** 模型给的地址整理成合法 slug：小写、只留字母数字和连字符 */
export const cleanSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 8)
    .join('-')
    .slice(0, 80)

export class BlogWriter {
  private readonly client: OpenAI

  constructor(private readonly endpoint: TextEndpoint) {
    this.client = new OpenAI({ baseURL: endpoint.baseURL, apiKey: endpoint.apiKey, maxRetries: 2, timeout: 240_000 })
  }

  get model() {
    return this.endpoint.model
  }

  private async complete(system: string, user: string, maxTokens: number, signal?: AbortSignal): Promise<string> {
    const r = await this.client.chat.completions.create(
      {
        model: this.endpoint.model,
        // 推理模型的思考过程也算在里面，多留余量
        max_completion_tokens: maxTokens + 4_000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      { signal },
    )
    return (r.choices[0]?.message.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '')
  }

  async plan(input: PlanInput, signal?: AbortSignal): Promise<Plan> {
    const user = [`主题方向：${directionGuide(input.direction)}`, input.keywords?.trim() && `关键词：${input.keywords.trim()}`, input.notes?.trim() && `作者希望写到的要点：\n${input.notes.trim()}`, `站内条目：\n${input.materials}`].filter(Boolean).join('\n\n')
    const plan = parseJson(await this.complete(PLAN_SYSTEM, user, 1_500, signal), planSchema, '规划')
    return { ...plan, slug: cleanSlug(plan.slug) || 'post', tags: normalizeTags(plan.tags) }
  }

  /** 选题：从候选条目里出几个题目，每个带搜索词和要点 */
  async topics(input: TopicsInput, signal?: AbortSignal): Promise<Topic[]> {
    const user = [
      `主题方向：${directionGuide(input.direction)}`,
      input.keywords?.trim() && `作者给的关键词：${input.keywords.trim()}`,
      input.notes?.trim() && `作者的想法：\n${input.notes.trim()}`,
      `已有文章和出过的题目：\n${input.existing.length ? input.existing.map((t) => `- ${t}`).join('\n') : '（还没有）'}`,
      `候选条目：\n${input.candidates}`,
    ]
      .filter(Boolean)
      .join('\n\n')
    const { topics } = parseJson(await this.complete(TOPICS_SYSTEM, user, 2_000, signal), topicsSchema, '选题')
    return topics.slice(0, 6)
  }

  /** 从标题、方向、要点里提取站内搜索词（英文逗号分隔） */
  async searchKeywords(text: string, signal?: AbortSignal): Promise<string> {
    return inTag(await this.complete(KEYWORDS_SYSTEM, text, 200, signal), 'keywords').replace(/\s*\n\s*/g, ', ').slice(0, 200)
  }

  async summary(title: string, body: string, signal?: AbortSignal): Promise<string> {
    const text = await this.complete(SUMMARY_SYSTEM, `标题：${title}\n\n正文：\n${body.slice(0, 8_000)}`, 600, signal)
    return inTag(text, 'summary').replace(/\s+/g, ' ').slice(0, 500)
  }

  async coverPrompt(title: string, summary: string, signal?: AbortSignal): Promise<string> {
    const text = await this.complete(COVER_SYSTEM, `Title: ${title}\nSummary: ${summary || '(none)'}`, 400, signal)
    return inTag(text, 'prompt').slice(0, 600)
  }

  /** 流式写正文：逐段产出增量文字 */
  async *body(input: WriteInput, signal?: AbortSignal): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.endpoint.model,
        max_completion_tokens: 12_000,
        stream: true,
        messages: [
          { role: 'system', content: bodySystemPrompt(input.images) },
          { role: 'user', content: bodyUserPrompt(input) },
        ],
      },
      { signal },
    )
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) yield delta
    }
  }
}

/* ========== 插图占位 ========== */

/** 正文里独占一行的插图占位：![说明](image: 提示词) */
export const IMAGE_MARKER_RE = /^[ \t]*!\[([^\]\n]*)\]\(\s*image:\s*([^)\n]+?)\s*\)[ \t]*$/gm

export function imageMarkers(body: string): { line: string; alt: string; prompt: string }[] {
  return [...body.matchAll(IMAGE_MARKER_RE)].map((m) => ({ line: m[0], alt: m[1]!.trim(), prompt: m[2]!.trim() }))
}

/** 图片说明里的方括号会打断 Markdown 语法，去掉 */
const safe = (s: string) => s.replace(/[[\]]/g, '').trim()

/**
 * 逐张生成或搜索插图并回填：成功的换成 ![说明](地址)，失败的整行删掉（记下原因）。
 * 不写图片标题：网站会把标题渲染成图下方的图注，插图下方不显示文字，说明只作为 alt。
 * 按顺序处理，每张完成后回调一次，前端可以实时替换。
 */
export async function resolveImages(
  body: string,
  make: (prompt: string) => Promise<{ url: string }>,
  onImage?: (event: { line: string; markdown: string | null; error?: string }) => void,
): Promise<{ body: string; failed: string[] }> {
  let out = body
  const failed: string[] = []
  for (const m of imageMarkers(body)) {
    try {
      const img = await make(m.prompt)
      const markdown = `![${safe(m.alt)}](${img.url})`
      out = out.replace(m.line, markdown)
      onImage?.({ line: m.line, markdown })
    } catch (error) {
      const reason = (error as Error).message
      failed.push(`${m.alt || m.prompt}：${reason}`)
      out = out.replace(`${m.line}\n`, '').replace(m.line, '')
      onImage?.({ line: m.line, markdown: null, error: reason })
    }
  }
  return { body: out, failed }
}
