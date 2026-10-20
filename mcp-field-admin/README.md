# mcp-field-admin

MCP Field 管理后台（https://admin.mcpfield.com）：每日采集任务的运行情况、每个条目的补全状态灯、平台全部数据的分页浏览。
纯静态单页应用（Vite + React），由 Nginx 直接提供；接口是 `mcp-field-crawler` 里的独立服务 `src/admin-api`（pm2 进程 `mcpfield-admin-api`，127.0.0.1:3200）。

## 本地开发

```bash
# 1. 后台接口（读 mcp-field-crawler/.env 里的 DATABASE_URL；本地 http 下 cookie 不能带 Secure）
cd mcp-field-crawler && npm run admin-api:dev
# 2. 建一个本地账号
npm run crawler -- admin-user --username admin --password '<密码>'
# 3. 页面（http://localhost:5299，/api/admin 转发到 3200）
cd mcp-field-admin && npm run dev
```

## 页面

| 路径 | 内容 |
| --- | --- |
| `/` | 仪表盘：今天每日任务的总体状态和各步骤状态条、今日新收录、近 14 天新收录（按类型堆叠，柱下圆点是当天任务结果）、各类型的补全覆盖率、最近 7 天的异常 |
| `/daily?date=` | 每日采集：某一天的批次、每一步的状态、耗时、进度、成功 / 待抽查 / 失败条数，失败步骤展开最后几条警告和错误日志，可以重新运行；README 翻译展开后可以补跑失败片段（`readme --retry-failed`）；当天新收录条目的状态灯 |
| `/items?kind=` | 数据管理：按类型分页浏览全部条目，按分类、来源、补全状态、某一补全项的状态筛选，按收录时间、热度、名称排序 |
| `/blog` | 博客文章：按已发布 / 定时发布 / 草稿筛选，按标题或地址搜索 |
| `/blog/new`、`/blog/:id` | 写文章：Markdown 编辑 + 实时预览（和网站文章页同一份样式 `src/blog-md.css`），粘贴或拖入图片自动上传到 R2；地址、标签、作者、发布时间（填未来时间即定时发布）、置顶、封面；⌘S 保存；AI 生成见下 |
| `/logs` | 服务器上 daily.log、run-<命令>.log 的末尾 |
| `/settings` | AI 设置：博客 AI 生成用的文本模型、生图模型（OpenAI 兼容接口的 Base URL、API Key、模型名）和 Pexels 图库 Key，可以测试连接 |
| `/account` | 修改密码 |

状态灯的数据从哪来、什么时候更新，见 `mcp-field-crawler/docs/PIPELINE.md` 的“管理后台的数据”一节。

## 博客

文章存在 `blog_posts` 表（迁移 0014），后台接口见 `mcp-field-crawler/src/admin-api/blog.ts`，网站读接口见 `src/api/modules/blog`。

- 网站接口对结果缓存 30 秒，保存后最多半分钟网站可见；草稿、发布时间未到的文章网站上看不到。
- 正文里链接到站内条目（`[Linear](/servers/linear)`、完整的 `https://mcpfield.com/...` 地址也行）会在保存时解析出来，显示在文章页右侧的“文中提到的服务”。
- 图片上传需要 `mcp-field-crawler/.env` 里配齐 `R2_*` 五项（和图标同一个桶，放在 `blog/` 下，按内容哈希命名）；本地 `.env` 也配了线上 R2，本地上传的图会进线上桶。
- 多语言：文章用中文写，发布（含定时发布）后自动翻译成英文、日文。保存时原文（标题、摘要、正文）有变化的语言排进表 `blog_post_translations`，翻译任务跑在后台接口进程里（`src/blog/worker.ts`）：保存后立刻开始，另外每分钟扫一遍队列；失败 2 分钟、10 分钟后各重试一次，第 3 次失败标红，等在编辑页点“重新翻译”。进程启动时会把没翻完的、已发布但从没翻译过的文章补排进来。
- 翻译用和 README 翻译相同的模型配置（`TRANSLATE_PROVIDER`、`README_MODEL`），代码块不发给模型、原样保留（代码里的中文注释不翻译）。正文按章节分段翻译，每段译文按内容指纹存下来，只改了几段时其余段直接复用。
- 网站：英文、日文页面显示对应译文；还没翻译的文章显示中文原文并提示，这类页面不收录（noindex）。原文改过、新译文没翻完前继续显示旧译文并提示“译文即将更新”。sitemap 和 hreflang 只列有译文的语言；RSS（`https://mcpfield.com/blog/rss.xml`）只有中文。
- IndexNow（Bing、Yandex 等，Google 不支持）：已发布的文章发布、修改后推送中文地址和列表页，译文翻好后推送对应语言的地址，撤回为草稿或删除时也推一次让搜索引擎移除；定时发布的到点后推送。后台接口进程每分钟扫一遍、保存后立刻唤醒（`src/blog/indexnow.ts`，按 `indexnow_at` 判断推没推过）。需要 `INDEXNOW_KEY`，本地 `.env` 不配所以本地不推。Google 只能靠 sitemap，重要文章可以在 Search Console 里手动请求编入索引。
- Nginx 给 `/api/admin/blog/` 单独放宽了请求体到 10 MB（其余后台接口仍是 64 KB），改了配置要执行 `mcpfield nginx`。

## 博客 AI 生成

模型服务在后台「AI 设置」里配置（存在 `admin_settings` 表，迁移 0016；API Key 接口只回显掩码），和翻译用的 `.env` 配置互不影响。接口见 `mcp-field-crawler/src/admin-api/blog-ai.ts`，提示词和插图回填见 `src/blog/generate.ts`。

- 编辑页：摘要框的“AI 生成”（根据标题和正文）；正文工具栏的“AI 写正文”（基于当前标题，选主题方向、关键词、要点、插图张数和来源）；封面面板的“AI 生成封面 / 图库”；右上角“AI 一键生成”（只给方向和关键词，标题、地址、标签、摘要、正文、封面全部生成）。
- 主题方向有 6 个预设（上手教程、深度评测、对比选型、生态观察、实测记录、新闻解读），也可以自己写一句。
- 写正文前按关键词（和标题里的英文技术名）在站内搜索表 `ingest_search` 里找相关条目，名称、简介、热度、站内地址交给模型，正文只链接真实存在的条目，保存后自动出现在“文中提到的服务”。
- 插图：模型先在正文里写占位行 `![说明](image: 提示词)`，正文写完后逐张用生图模型生成（或按搜索词从 Pexels 找照片），转成 WebP 存到 R2 的 `blog/` 下再回填地址；插图不写图片标题，下方不显示图注，说明只作为 alt；失败的那张整行删掉并在进度里提示。封面裁成 1600 × 900。
- 生成接口是 NDJSON 流（正文边写边显示），每 10 秒发一次 ping，避免 Nginx、Cloudflare 在生图的几十秒里断开；一键生成全部实测约 1 分钟。
- 博客不再分栏目（迁移 0016 删掉了 `category` 列），网站列表页上方用常用标签做快捷筛选。
