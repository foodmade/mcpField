# MCP Field 采集服务设计

## 1. 目标

- 从多个外部来源采集 MCP 服务、客户端、CLI、Skill、Loop、Agent 数据，写入与 mcp-field 共用的 MySQL（库名 `mcp_field`）。
- 数据源可插拔：新增一个源站只写一个"数据源工厂"，运行器、存储、表结构都不用改。
- 数据细粒度落库：凡是可能被查询、筛选、统计的信息都拆成独立的行，不存 JSON 字符串。
- 每一层都可以单独重跑：改了解析逻辑不用重新抓取，改了映射逻辑不用重新解析。
- 礼貌抓取：遵守 robots.txt、按主机限速、条件请求、增量更新，遇到人机验证就停，不做绕过。

## 2. 总体流程

```
              ┌───────────── 数据源工厂（每个源站一个）─────────────┐
              │  Discoverer   Fetcher      Parser        Mapper    │
              └──────┬──────────┬────────────┬─────────────┬───────┘
                     ▼          ▼            ▼             ▼
发现 ──► 目标 ──► 抓取 ──► 原始文档 ──► 解析 ──► 源记录 ──► 映射 ──► 草稿 ──► [补全] ──► [合并发布] ──► 目录表
     ingest_targets   ingest_documents       ingest_records        ingest_drafts   ingest_enrichments     catalog
                      + 文件存储(gzip)                             + ingest_issues
```

| 阶段 | 输入 → 输出 | 当前状态 |
| --- | --- | --- |
| 发现 | 站点地图 / API 列表 → `ingest_targets` | ✅ 已实现（通用站点地图发现器） |
| 抓取 | 目标 → 原始 HTML（文件存储）+ `ingest_documents` | ✅ 已实现（重试、robots、限速、条件请求） |
| 解析 | HTML → 源站原生结构 `ingest_records` | ✅ 已实现（mcp.so 内嵌数据沙箱解析） |
| 映射 | 源记录 → 统一结构的细粒度草稿 `ingest_drafts` + 问题 `ingest_issues` | ✅ 已实现（mcp.so 六种类型） |
| 补全 | GitHub / npm / PyPI / 实时探测 → `ingest_enrichments` | 🚧 已实现 GitHub README（见 13 节），其余下一阶段 |
| 合并发布 | 多来源草稿按身份键合并 → 发布层 `ingest_published`（以后再写目录表） | 🚧 第一版已实现发布层（见第 6 节），目录表下一阶段 |
| 生成 | LLM 生成中英日简介、介绍 → `entity_texts` | ⏳ 下一阶段 |

## 3. 设计模式

| 模式 | 位置 | 作用 |
| --- | --- | --- |
| 抽象工厂 | `core/source.ts` `SourceFactory` | 每个源站提供一整套相互匹配的产品：发现器、抓取器、解析器、映射器 |
| 模板方法 | `core/base-source.ts` `BaseSourceFactory` | 默认提供"HTTP + 重试 + robots + 限速"的抓取器，子类只实现站点相关部分 |
| 模板方法 | `core/runner.ts` `CrawlRunner` | 固定"开始 → 发现 → 增量判断 → 分派 → 收尾"流程；`DiscoverRunner` 只登记，`InlineRunner` 本进程处理，以后的 Worker 从队列领取 |
| 注册表 | `core/registry.ts` | 按 ID 查找数据源，运行器不依赖任何具体源站 |
| 装饰器 | `fetch/*.ts` | 重试、robots、限速都是包装 `Fetcher` 的中间件，可自由组合 |
| 策略 | `discover/` `extract/` | 站点地图发现、TanStack 内嵌数据提取、MCP 配置解析、工具参数展开等可在不同源站复用 |
| 建造者 | `core/draft-builder.ts` | 映射器逐项添加数据，统一处理空值、URL 校验、去重、问题记录 |
| 仓储 | `core/store.ts` | `MySqlIngestStore` 正式运行，`FileStore` 本地调试；运行器只依赖接口 |
| 观察者 | `core/events.ts` | 进度显示、指标统计订阅运行事件，不侵入业务逻辑 |
| 组合根 | `bootstrap.ts` | 所有具体实现只在这里装配 |

## 4. 目录结构

```
src/
├── cli/index.ts            命令行入口
├── bootstrap.ts            组合根：注册数据源、创建存储
├── config.ts               环境变量（zod 校验）
├── core/                   与具体站点无关的领域抽象
│   ├── types.ts            实体类型、目标、原始文档、源记录
│   ├── draft.ts            细粒度草稿结构（与目录表一一对应）
│   ├── draft-builder.ts    草稿建造者
│   ├── identity.ts         仓库地址归一化、跨源合并键
│   ├── source.ts           抽象工厂与四个产品接口
│   ├── base-source.ts      工厂基类
│   ├── registry.ts         数据源注册表
│   ├── runner.ts           运行器（模板方法）与单目标处理器
│   ├── store.ts            仓储接口
│   ├── events.ts / errors.ts / logger.ts
├── fetch/                  抓取层：HTTP + 装饰器（retry / robots / rate-limit）+ 预取（列表接口已带完整数据时）
├── discover/sitemap.ts     通用站点地图发现器
├── extract/                通用提取：HTML、TanStack 内嵌数据（QuickJS 沙箱）、MCP 配置、工具参数
├── store/                  MySQL 仓储、文件仓储、原始文档存储
├── db/schema/              表结构：catalog.ts（目录层）、ingest.ts（采集层）
├── merge/                  合并预演：哪些草稿是同一个东西（见第 6 节）
├── sources/mcpso/          mcp.so 数据源：URL 规则、字段校验、解析、映射、分类映射
└── sources/mcp-registry/   官方 MCP Registry 数据源：列表发现、server.json 解析与映射（见第 15 节）
```

## 5. 数据库设计

### 5.1 约定

- 库：`mcp_field`，utf8mb4 / utf8mb4_unicode_ci，InnoDB。
- 采集服务自己的表带 `ingest_` 前缀，网站不直接读；不带前缀的是目录层，是两个项目之间的契约。
- 主键 `id BIGINT UNSIGNED AUTO_INCREMENT`；关联表用复合主键。
- 业务时间 `DATETIME(3)`，一律 UTC；`created_at` / `updated_at` 由数据库自动维护。
- 枚举类取值用 `VARCHAR` + TypeScript 联合类型约束，新增取值不需要改表。
- 超长 URL 另存 SHA-256（`*_hash`）用于唯一约束。
- 有来历之分的行都带 `origin`（source / generated / translated / manual / live）和 `source_id`，可以追溯每条数据从哪来。
- 外键：子表 `ON DELETE CASCADE`，可选引用 `ON DELETE SET NULL`。

### 5.2 目录层（41 张表）

**共享维度**

| 表 | 粒度 | 典型查询 |
| --- | --- | --- |
| `categories` | 每类型的分类，含中英日名称、父分类 | 分类导航 |
| `tags` | 全局标签 | 标签页 |
| `authors` | GitHub 账号 / 组织 / 厂商 | "microsoft 的所有项目" |
| `repositories` | 源码仓库，挂星数、Fork、语言、许可证、最后提交 | 按星数排序；monorepo 下多个服务共享 |
| `repository_topics` | 仓库主题，一行一个 | 按 GitHub topic 聚合 |

**实体主表与通用子表**

| 表 | 粒度 | 典型查询 |
| --- | --- | --- |
| `entities` | 每个服务 / 客户端 / CLI / Skill / Loop / Agent 一行；冗余了排序用的星数、安装数 | 列表页、排序、分页 |
| `entity_texts` | 一行 = 一个字段 × 一种语言（tagline / description / overview / readme / goal …） | 按语言取文案；找"缺日文翻译的条目" |
| `entity_sources` | 实体在各来源中的条目 | 溯源；源站下架检测 |
| `entity_links` | 仓库、官网、文档、npm、PyPI、远程端点等 | "有官方文档的服务" |
| `entity_aliases` | 旧 slug、命令别名、规范键 | 301 跳转；站内搜索命中别名 |
| `entity_categories` / `entity_tags` / `entity_authors` / `entity_platforms` | 多对多 | 组合筛选 |
| `entity_metrics` | 指标时间序列：每来源每天一行 | 星数趋势、本周增长榜 |
| `entity_media` | 图标、截图 | 详情页画廊 |
| `entity_list_items` | 多语言有序短列表（CLI 能力、要点） | 详情页列表 |
| `entity_relations` | 同类、替代、同仓库、可配合使用 | "同类推荐" |

**按类型的详情与子表**

| 类型 | 表 |
| --- | --- |
| MCP 服务 | `server_details`（本地/远程、运行时、鉴权、Registry 名称、能力计数、探测状态）<br>`server_transports`、`server_packages` → `server_package_arguments`<br>`server_env_vars`（只存变量名和说明，从不存取值）<br>`server_remotes` → `server_remote_headers`<br>`server_tools` → `server_tool_params`（参数按点号路径展开，行为提示拆成独立列）<br>`server_prompts` → `server_prompt_arguments`、`server_resources` |
| 客户端 | `client_details`、`client_capabilities`（对 tools / resources / prompts / sampling / oauth 等的支持矩阵） |
| CLI | `cli_details`、`cli_install_methods`（包管理器 × 平台）、`cli_examples` |
| Skill | `skill_details`（owner/repo#skill 规范键）、`skill_security_audits` |
| Loop | `loop_details`、`loop_steps`（按语言）、`loop_supported_agents` |
| Agent | `agent_details` |

### 5.3 采集层（8 张表）

| 表 | 作用 |
| --- | --- |
| `ingest_sources` | 已注册的数据源及其礼貌参数 |
| `ingest_runs` | 每次运行一行，统计数字都是独立列；进程被杀后会在下次启动时标记为 aborted |
| `ingest_targets` | URL 前沿兼任务队列：状态、ETag、Last-Modified、内容哈希、失败次数、下次抓取时间、锁 |
| `ingest_documents` | 抓取历史；正文 gzip 后存文件，内容不变不重复存 |
| `ingest_records` | 源站原生结构（JSON），记录解析器版本和内容最近变化时间 |
| `ingest_drafts` | 细粒度草稿（JSON）、身份键、合并到的实体 |
| `ingest_issues` | 数据质量问题，每次映射时重建 |
| `ingest_enrichments` | 补全阶段的响应缓存，带过期时间 |

### 5.4 细粒度查询示例

```sql
-- 需要 OPENAI_API_KEY 的 MCP 服务
SELECT e.slug FROM server_env_vars v JOIN entities e ON e.id = v.entity_id WHERE v.name = 'OPENAI_API_KEY';

-- 提供只读工具、且有名为 url 的必填参数的服务
SELECT DISTINCT e.slug
FROM server_tools t
JOIN server_tool_params p ON p.tool_id = t.id AND p.name = 'url' AND p.is_required
JOIN entities e ON e.id = t.entity_id
WHERE t.hint_read_only = TRUE;

-- 本周星数增长最多的 20 个服务
SELECT e.slug, MAX(m.value) - MIN(m.value) AS growth
FROM entity_metrics m JOIN entities e ON e.id = m.entity_id
WHERE m.metric = 'github_stars' AND m.observed_on >= CURRENT_DATE - INTERVAL 7 DAY AND e.kind = 'server'
GROUP BY e.id ORDER BY growth DESC LIMIT 20;

-- 支持 sampling 的客户端
SELECT e.slug FROM client_capabilities c JOIN entities e ON e.id = c.entity_id WHERE c.capability = 'sampling' AND c.support = 'full';

-- 采集侧：哪些源站分类还没映射
SELECT detail, COUNT(*) FROM ingest_issues WHERE code = 'unmapped_category' GROUP BY detail ORDER BY 2 DESC;
```

## 6. 身份与合并

- 合并键（`core/identity.ts`）按可信度：Skill 键 `owner/repo#skill` > 仓库（含 monorepo 子目录）> 官方 Registry 名称 > npm 包 > PyPI 包 > 远程地址 > 官网。
- 每条草稿产出**全部**候选键（`identityKeys`），分强键和弱键；`ingest_drafts.identity_key` 只存可信度最高的一个。
  - 弱键：官网；有 Skill 键时的仓库；官网指向的仓库与仓库字段不一致时的那个仓库。
  - 不产生键：启动器包（`mcp-remote`、`@smithery/cli`、`nx`、`tsx` 等）、本机 / 内网 / 示例 / 占位地址、平台域名（npm、PyPI、GitHub 首页、各目录站、短链接）。
  - 官网是 npm / PyPI / 仓库页面时转成对应的键；包名按 npm 规则 / PEP 503 校验和归一化。
  - 镜像仓库 `mcp-mirror/<owner>_<repo>` 归到 `<owner>/<repo>`。
- 仓库地址统一小写、去 `.git`、去分支名但保留子目录：`modelcontextprotocol/servers` 下的十几个服务不会被合成一个。
- Skill 必须用规范键：同一仓库里通常有多个 Skill。
- 合并规则（`merge/plan.ts`，`npm run crawler -- merge-plan` 只读预演，报告写到 `data/merge-plan/`）：
  - 只在同一类型内合并；同一强键跨类型出现记为"相关"（发布阶段写 `entity_relations`）。
  - 强键相同才合并，按可信度依次处理。一个键连接的各组之间有冲突时（仓库不同、Skill 键 / Registry 名称 / npm / PyPI 不同），这个键整体不用于合并，记为"有歧义的键"。仓库根目录与它的子目录不算冲突。
  - 有条目指向子目录的仓库是 monorepo，它的根目录键不用于合并。
  - 弱键只提示可能重复，不自动合并。
  - 合并组的身份键只从本组独有的强键里选；没有时用 `source:来源/类型/ID`，保证同一类型内唯一。
- 发布（`merge/publish.ts`，`npm run crawler -- publish`）：按上面的规则分组，每组合并成一份草稿写入发布层 `ingest_published`（一组一行），网站 API 和 github / translate / overview / readme / assets 都读这张表，不再直接读 `ingest_drafts`。每次整体重建（一个事务里先删后写，约 15 秒）。
  - 过滤：同一仓库目录（完整仓库键，含子目录）登记超过 20 条的服务判定为批量凑数，不发布（2026-10 官方 Registry 有 17 个仓库、约 3,300 条，如一个仓库登记了 2,332 个"上海当前时间""英制杯换算毫升"）。
  - 主条目：有 mcp.so 的用 mcp.so（沿用已有地址和已生成的翻译、介绍）；同来源多条时不带随机后缀、slug 短的优先。发布条目的 `source_id` / `external_id` 是主条目的，生成内容都按它关联。
  - 字段取舍（`merge/merge-drafts.ts`）：名称、简介、分类、标签、图标、作者按 mcp.so > Registry；安装包、远程端点、环境变量整组取自 Registry（发布者自己登记的；mcp.so 的配置可能被换成代理）；工具列表取最多的；仓库取最具体的（带子目录的）；指标取最大值；创建时间取最早、更新时间取最晚。源站收录的 README 文本不进入发布层（只用 GitHub 原文）。
  - 名称修正：映射时标为可疑、与仓库所有者和仓库名没有共同词，且是 README 小节标题（"Introduction""License"）、作者名或重复词（"Slack Slack"）的，换成其他来源的名称，没有时用仓库名。填成人名的（microsoft/vscode 叫"Geng"）规则分不出来，留给人工修正。
  - 地址：同类型内唯一；上一次发布过的沿用（按身份键，其次按主条目），新条目用主条目的 slug，mcp.so 的先分配，重名加 -2、-3。被合并进来的成员原来的地址记在 `ingest_published_slugs`，旧链接也能打开。
- 搜索表 `ingest_search`（`search/`，`npm run crawler -- search-index`）：列表接口的关键词搜索和热门排序读这张窄表，不再对发布层每一行现算 JSON 字段和译文指纹（原来 skills 搜一次 2–6 秒，现在全站搜索取前几条 2–6 毫秒）。
  - 一行 = 一个条目在一种语言下的 body（名称、slug、英文简介、这种语言的简介译文、自撰简介，换行分隔）和排序键；主键按 类型 → 语言 → 热度 → 精选 → slug 排列，与 `sort=popular` 的顺序一致，查询按主键顺序扫描、凑够一页就停。最坏情况是关键词搜不到、要扫完一整类（本地 skills 约 140 毫秒）。
  - 匹配仍用 `LIKE '%关键词%'`，结果与原来一致。没有用 MySQL 全文索引（ngram）：英文常见词反而更慢（180–500 毫秒），索引另占约 400 MB，线上 MySQL 缓冲池只有 128 MB。
  - 同步：publish / github / translate / describe 结束时自动执行，按指纹只改有变化的行（本地全量无变化时约 12 秒）；每个类型一个事务，并用 `GET_LOCK` 防止两个同步同时写。热度、名称、简介的算法与列表接口共用 `db/published-sql.ts`，热度指标共用 `POPULAR_METRIC`。
  - 发布层按 slug 关联（publish 整体重建、id 会变）。接口在搜索表还没有某个类型的数据时（新部署还没跑 search-index）退回直接查发布层；热门排序以外的排序、带分类等筛选时，关键词条件也改为查搜索表。

## 7. mcp.so 数据源

- 发现：站点地图索引按分区展开（servers 分 19 页约 1.84 万条，clients 388、cli 170、skills 250、loops 40、agents 63）；只抓英文版，中日文是同一条数据的翻译；分类/标签页（8348 个）不抓。
- 解析：页面由 TanStack Start 渲染，完整数据以 JavaScript（seroval）形式内嵌在 `<script class="$tsr">` 中。这是第三方代码，放进 QuickJS（WebAssembly）沙箱执行：无网络、无文件系统、2 秒超时、64 MB 内存上限。实测单页 3–30 ms。
- 各类型在加载数据中的键名：server / client / tool(CLI) / skill / loop / entry(Agent)。
- 解析时直接丢弃：mcp.so 用户的个人数据（提交者、所有者账号）、mcp.so 自己撰写的长篇介绍。
- 映射只取事实；以下内容不进入草稿，由我们自己生成：CLI 描述与能力列表、Skill 摘要、Agent 简介、Loop 的提示词与步骤。
- 已发现的源站数据问题（会记入 `ingest_issues`）：
  - 安装配置被替换成 mcp.so 自己的代理（`npx -y mcprouter` + `SERVER_KEY`），不是项目真实的安装方式 → `proxied_install_config`，安装信息改从官方 Registry / npm 获取。
  - 名称错误，例如 `playwright-microsoft` 的名称是 "Slack Slack" → `suspicious_name`，名称以 GitHub / Registry 为准。
  - 同一仓库重复收录（`firecrawl` 与 `firecrawl-firecrawl`）→ 合并阶段按身份键去重。
- 礼貌参数：每秒 1 个请求、并发 2、遵守 robots.txt、最多重试 4 次、30 秒超时。

## 8. 增量与调度

- 站点地图 `lastmod` 不晚于上次成功抓取时间 → 直接跳过，不发请求。
- 需要抓取时带 `If-None-Match` / `If-Modified-Since`；304 只更新状态。
- 内容哈希不变 → 不重复存原文、不重新解析。
- 失败按 1h、2h、4h…… 最长 7 天退避；404/410 标记为 gone，robots 禁止标记为 blocked。
- 以后多进程运行：Worker 用 `SELECT … FOR UPDATE SKIP LOCKED` 从 `ingest_targets` 领取到期目标（MySQL 8 支持），复用 `TargetProcessor`，不需要额外的队列组件。

## 9. 规模估算（基于 12 页实测）

| 项 | 估算 |
| --- | --- |
| 首次全量详情页 | 约 1.93 万页，按每秒 1 个约 5.5 小时 |
| 原始 HTML 存储 | 平均约 17 KB/页（gzip 后），全量约 330 MB |
| 之后每天增量 | 只抓 lastmod 变化的页面，通常几分钟 |

## 10. 新增数据源的步骤

1. 在 `src/sources/<id>/` 下实现一个继承 `BaseSourceFactory` 的工厂：
   - `meta`：ID、名称、支持的类型、礼貌参数
   - `createDiscoverer`：能用站点地图就复用 `SitemapDiscoverer`，否则实现分页 API 发现器
   - `createParser`：复用 `extract/` 里的提取器（TanStack、JSON-LD 等），或新写一个
   - `createMapper`：用 `DraftBuilder` 把源站字段映射到草稿
   - 需要浏览器渲染或走 API 时覆盖 `createFetcher`
2. 在 `bootstrap.ts` 里 `register(new XxxFactory())`。
3. 补单元测试（用合成数据，不提交源站页面）。

运行器、存储、表结构都不用改。

## 11. 多语言：翻译与 AI 介绍

两类大模型任务共用 `src/llm/`：

- `claude.ts`：调用 Claude 并强制通过工具返回结构化 JSON；模型不支持强制指定工具时自动改用 auto，并兼容模型在文本里直接返回 JSON
- `batch.ts`：通用批处理（模板方法）——分批、并发、输出截断时拆批、校验不合格时小批次重做（最多 3 次）、统计用量
- `checks.ts`：通用语言检查——中文里不能有假名、日文里不能混入简体字或中文词、与原文照抄的最长连续词数

| 任务 | 命令 | 输入 | 存储 |
| --- | --- | --- | --- |
| 翻译简介 | `translate` | 草稿里的 tagline / description | `ingest_translation_sources`（按原文指纹去重）+ `ingest_translations`（每种语言一行） |
| 生成三语介绍 | `overview` | 名称、简介、分类、标签、清理后的 README | `ingest_overviews`（每个条目每种语言一行：概述、MCP 相关）+ `ingest_overview_items`（主要功能、适用场景，一条一行） |

- 翻译和介绍都记录模型与提示词版本；提示词改进后用 `--stale` 重做旧版本结果。
- 翻译记忆库里人工修改过的译文（origin = manual）不会被自动翻译覆盖。
- 介绍按输入指纹判断是否需要重新生成：README、简介等没变就跳过。
- 介绍只使用 README 中写明的事实，用自己的话写；与 README 连续 15 个词以上相同视为照抄，自动重写。
- 介绍统一用 Claude Haiku 5.5 生成三语，不按星数分档；需要时可用 `OVERVIEW_PREMIUM_MODEL` / `--premium-model` 给热门项目单独指定模型。
- README 整篇翻译（`readme` 命令，中文、日文）：
  - 围栏代码块替换成占位符 `⟦CODE n⟧` 不发给模型，翻完原样放回；HTML 注释去掉。
  - 按标题切分成不超过 4,000 字符的片段，章节过长再按段落切；表格不会被切开。
  - 片段按内容指纹存进翻译记忆库（与简介共用），不同项目里相同的段落只翻一次；README 更新后只重翻变化的片段。
  - 只有代码、徽章、链接的片段不翻译；已经是目标语言的片段（本来就用中文写的 README）沿用原文。
  - 逐段校验：占位符个数、链接和图片地址（页内锚点除外）必须一个不少，必须真的译成目标语言，日文不能混入中文；行内代码、标题数、表格行数、长度比例不一致标记为待抽查。
  - 所有正文片段都有译文后，拼回整篇并还原代码块，存入 `ingest_readme_translations`，记录翻译时的原文指纹（原文更新后接口返回 outdated）和原项目许可证。
  - 模型：统一用 Haiku 5.5，不按星数分档（可用 `README_PREMIUM_MODEL` / `--premium-model` 单独指定）；`--licensed-only` 可只翻译有明确开源许可证的 README。

### 自己撰写的内容（Loop / CLI / Agent）

这三类没有项目 README，mcp.so 上的简介、提示词、步骤说明是 mcp.so 自己写的，不搬运。`describe` 命令按"事实优先"生成我们自己的三语内容：

- 输入：由各数据源的事实整理器（`sources/mcpso/describe-facts.ts`）从源记录里提取事实——命令、安装方式、示例、链接、轮数、检查命令、标签等。
  Loop 不传 mcp.so 的简介、启动提示词和步骤说明，只传每步的命令和几个词的用途标签，步骤由模型自行设计；CLI / Agent 的一句话说明作为背景提示。
- 输出：三语的一句话简介、概述、主要功能、适用场景；Loop 另有目标、退出条件和步骤（步骤通过下标引用事实里的命令，三种语言一一对应）。
- 校验：与源站说明连续 6 个英文词或 12 个汉字相同即判为沿用原文，要求重写；与短标签、条件说明重合只标记待抽查。重写 3 次仍不合格的跳过，页面显示"暂无简介"。
- 存储：简介、目标、退出条件存 `ingest_generated_texts`，步骤存 `ingest_generated_steps`（每种语言一行），概述与功能复用 `ingest_overviews`。启动提示词不存，由前端用我们的模板根据目标、步骤、检查命令、退出条件拼出。
- 模型：Loop 用 Sonnet 5.5；CLI / Agent 用 Haiku 5.5，被照抄检测拦下的用 `--model claude-sonnet-5-5` 重跑。

## 12. 图片转存（Cloudflare R2）

第三方图床（GitHub 头像、cdn.mcp.so 等）在部分网络下很慢或打不开，也可能加防盗链，因此图标转存到自己的存储：

- 存储：Cloudflare R2 桶 `mcp-field-assets`，自定义域名 `https://assets.mcpfield.com`（经 Cloudflare CDN，`Cache-Control: immutable` 一年）。
- 处理：下载原图（只允许 https、拒绝内网地址、手动跟随重定向并逐跳校验、5MB / 15 秒上限）→ sharp 缩放到 256×256 以内并输出 WebP（SVG 先转成位图，不直接提供 SVG）→ 文件名用内容哈希 `icons/ab/<sha256>.webp`，同样内容只存一份。
- 数据库：`media_assets` 表只存"原始地址 → 公开地址"和尺寸、状态等元信息，不存图片本身。失败按 1h、4h、16h…… 最长 7 天退避重试；格式不支持记为 skipped，原图 404 记为 gone。
- 接口：组装列表和详情时把图标、截图换成转存地址，没转存的保留原地址；前端看到图片加载失败时显示首字母色块。
- 命令：`npm run crawler -- assets`（默认处理图标，`--media screenshot` 处理截图）；每次抓取后运行一次即可增量转存。
- 存储层是 `AssetStorage` 接口（`R2Storage` / `LocalStorage`），以后换成其他对象存储只需新增实现。

## 13. GitHub：README、星数、最近提交时间

README 只用 GitHub 上的原文。mcp.so 收录的 README（`item.description`）往往是收录时的旧快照，不少只有一句话，而且 CLI、Skill、Agent 根本没有；它仍按事实映射进草稿，但不再展示、翻译或用来生成介绍。星数和最近提交时间同样以 GitHub 为准。`github` 命令先更新仓库统计，再抓取 README：

- 仓库统计：按仓库去重（`repo:github.com/owner/name`，不含子目录），GraphQL 每批 50 个仓库一次查询（约 1 点额度），取星数、Fork 数、是否归档、默认分支最新提交时间、最近推送时间；每次运行全部更新，存 `ingest_enrichments`（`enricher = github_repo`）。接口的星数、最近更新时间以及按星数 / 热度 / 更新时间排序都优先用它，没抓到的仓库用源站的数值。

- 主体：按仓库目录去重，`repo:github.com/owner/name[/dir]`（monorepo 子目录各算一个；指向文件的地址取所在目录）；Skill 用 `skill:owner/repo#slug`。
- 仓库：`GET /repos/{owner}/{repo}/readme/{dir}`，GitHub 自动识别 README 文件名。
- Skill：每个仓库取一次目录树，找 `<slug>/SKILL.md`（同名的有多个时优先 `skills/` 下的）；目录名对不上（`skills/react-best-practices` 里的 `vercel-react-best-practices`）时读元数据里的 `name` 比对；展示时去掉 YAML 元数据。
- 范围：所有有 GitHub 仓库的条目（`--kind` 可限定类型）。
- 增量：成功的 7 天后用 ETag 条件请求检查更新（304 不占额度）；不存在、超过 1MB 的 30 天后再试；临时错误按 1h、4h、16h…… 最长 7 天退避，已抓到过的保留原内容。
- 额度：读取响应头里的剩余额度，快用完时暂停到重置时间；触发限流（403 / 429）按 Retry-After 或重置时间等待后重试。
- 存储：`ingest_enrichments`（`enricher = github_readme`），`data` 存仓库全名、文件路径、sha、格式（.md 为 markdown，其余为 plain）和正文。
- 读取：`readme/source.ts` 按条目查 GitHub README，接口详情、README 翻译、AI 介绍共用；接口返回 `readme.baseUrl`（README 所在目录，前端据此解析相对链接）。没抓到的条目没有 README。
- Loop / CLI / Agent 的介绍由 `describe` 撰写，`overview` 不处理这三类，避免覆盖。

## 14. 分类器

- 分类体系：`classify/taxonomy.ts`，每个类型的分类 slug + 判定说明（给模型和人工复核共用），带 `TAXONOMY_VERSION`；网站 `mcp-field/src/lib/categories.ts` 只负责名称、图标、颜色，`test/classify.test.ts` 核对两边 slug 一致。MCP 服务在 mcp.so 原有 14 个分类之外新增 8 个：security、legal-gov、business、social、travel、health、entertainment、science。
- 范围：来源没有给出可用分类的条目（官方 Registry 全部、mcp.so 的 "Other"）；`--all` 连已有分类的也分，只用于评估。
- 输入：名称、英文简介、标签、工具名、安装包名、仓库、源站分类原值、GitHub README 开头 1,200 字。输出：主分类（只能选分类体系里的 slug 或 other）、最多 2 个次分类、把握程度 0–100（< 50 标记 review）。
- 模型：Opus 5.5（`CLASSIFY_MODEL`）。2026-10 在 200 条样本上与 Haiku 5.5 对比，两者速度相同，分歧时 Opus 更贴合判定说明。每批 25 条，结构化输出走工具调用。
- 增量：输入指纹（含分类体系版本）或提示词版本变化才重新分类；结果在 `ingest_classifications`。
- 生效：`publish` 时把结果写进发布层草稿的 categories（sourceValue 为 `classifier`，与来源给的分类区分）；来源已有的分类不覆盖，主分类为 other 的保持没有分类。

## 15. 官方 MCP Registry 数据源

数据源 ID `mcp-registry`，只有 MCP 服务一种类型。`npm run crawler -- crawl --source mcp-registry`。

- 接口：`https://registry.modelcontextprotocol.io/v0.1`（v0 仍可用但不再更新），无需鉴权，没有 robots.txt。
- 发现：`GET /servers?version=latest&limit=100` 按游标翻页；增量用 `updated_since`（对应 `--since`）。每个服务产出一个目标，地址是它的详情接口 `/servers/{name}/versions/latest`，`lastmod` 取 `_meta` 里的 `updatedAt`，没变的直接跳过。
- 抓取：详情接口实测每次 40–60 秒，列表 100 条只要 2–6 秒，而列表条目就是完整的 `{ server, _meta }`。所以发现器把条目预取给 `PrefetchFetcher`，抓取阶段直接取用，全量只发列表页请求；没预取到的才去请求详情接口。
- 映射（只取事实）：
  - 名称取 `title`，没有时取名称最后一段；最后一段是 `mcp`、`site` 这类通用词时用命名空间里的账号或域名主体（`com.acme/mcp` → `acme`）；简介 `description`（≤ 100 字）→ tagline。
  - 身份：Registry 名称、仓库 + `subfolder`、npm / PyPI 包、第一个不含 `{变量}` 的远程地址、官网。
  - 安装包（npm / pypi / oci / nuget / mcpb / cargo）、远程端点（有 Authorization 头记为 bearer）、环境变量（只记名字、说明、是否必填；机密变量的默认值不保存）。
  - 发布者：命名空间是反写的域名（`ai.smithery` → `smithery.ai`）；`io.github.<login>` 是经 GitHub 登录验证的账号。
  - 图标：多个时优先非深色主题、尺寸最大的；由 `assets --source mcp-registry` 转存到 R2。
  - 标签：发布者在 `_meta` 里提供的 `tags`、`keywords`。发布者给的 `categories` 留在源记录里，交给分类器。
  - 没有分类、星数、工具列表；状态为 deleted 的不生成草稿。
- 名称只有大小写不同的（2026-10 实测 7 对，如 `io.github.SceneView/mcp` 与 `io.github.sceneview/mcp`，都是同一 GitHub 账号重复登记）：库表唯一键不区分大小写，存成一条，后抓到的覆盖先抓到的。
- 规模（2026-10-12）：见 PLAN.md 阶段 2。

## 16. skills.sh 数据源

数据源 ID `skills-sh`，只有 Skill 一种类型。`npm run crawler -- crawl --source skills-sh`。

- 接口：官方 API `https://skills.sh/api/v1`（文档 /docs/api），认证用 Vercel OIDC 令牌，每分钟 600 次（按 Vercel 团队 + 项目计）。robots.txt 的 `Disallow: /api/` 针对网页爬虫；文档化、需认证的 API 是网站提供的正式数据接口，使用条款写明合理使用、缓存到自己的服务器是被鼓励的。
- 令牌：`SKILLS_SH_VERCEL_DIR`（默认 `~/.mcpfield/skills-sh`）是一个已 `vercel link` 的空 Vercel 项目（免费 Hobby 账号即可），令牌在它的 `.env.local` 里，有效期约 12 小时；快过期时自动在该目录运行 `vercel env pull` 换新（`sources/skills-sh/token.ts`），需要本机 Vercel CLI 已登录。新机器上：`vercel login`，然后在该目录 `vercel link` 和 `vercel env pull`。
- 发现：全站排行榜（`view=all-time`，每页 500 条，最多前 10 万条；2026-10 共 93,019 条）。网站上显示的 "All Time (1,291,198)" 是被安装过的全部 skill 个数，排行榜之外的长尾只能按仓库查（`source=owner/repo`），以后配合 GitHub 指纹补。名称里带 `/` 的接口不支持，跳过。
- 抓取：每个 skill 请求详情（含 SKILL.md 等文件、内容哈希）和安全审计两次，`SkillsShFetcher` 合成一份文档（排行榜条目 + 详情 + 审计）。列表没有更新时间，用"每周一个周期"代替：本周期内抓过的跳过。
- 映射：名称、简介取 SKILL.md 元数据（作者自己写的）；身份键 `skill:owner/repo#skill`（well-known 来源是 `skill:域名#skill`），与 mcp.so 的 Skill 自动合并；安装量、安全审计（结论、风险等级、摘要、行为类别、时间）、随 Skill 分发的文件列表。源记录只存 SKILL.md 正文和其他文件的路径。
- README：`github` 命令开始抓 README 前，先把 skills.sh 记录里的 SKILL.md 导入为对应 Skill 的 README（去掉 YAML 元数据，`sources/skills-sh/readme.ts`），这些 Skill 不再请求 GitHub（GitHub 额度 5,000 次/小时，与线上共用）。
- 地址：Skill 重名很常见，发布时先用"名称-作者"（与 mcp.so 一致），再加序号。
- 合并：Skill 的审计取信息最全的来源（skills.sh 的带风险等级和摘要），文件列表从有的来源补上。

## 17. 后续阶段

1. **补全**（Enricher）：GitHub GraphQL（每次 100 个仓库，星数等元数据）、npm / PyPI 下载量、远程服务实时探测（initialize + tools/list + prompts/list + resources/list）。
2. **合并发布**（Publisher）：按身份键合并草稿 → 按字段优先级取值 → upsert 目录表 → 记录 `entity_sources` → 触发网站缓存刷新和 IndexNow 推送。
3. **生成**：LLM 根据 README 和元数据生成中英日简介与介绍，写入 `entity_texts`（origin = generated / translated，记录模型）。
4. **Worker 与定时任务**：多进程领取队列、每日增量、每周补全。
