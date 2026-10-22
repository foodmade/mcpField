# mcp-field-crawler

MCP Field 的数据采集服务：可插拔的多源爬虫，数据写入与 mcp-field 共用的 MySQL（`mcp_field` 库）。

设计说明见 [docs/DESIGN.md](docs/DESIGN.md)，采集、去重与分类的计划和进展见 [docs/PLAN.md](docs/PLAN.md)，
后台整体运行流程、每日定时任务的步骤与各步增量规则见 [docs/PIPELINE.md](docs/PIPELINE.md)。

## 准备

```bash
npm install
cp .env.example .env      # 填写 DATABASE_URL
npm run db:migrate        # 创建 / 升级表结构
```

本机 MySQL 跑在 Colima 的 `mysql-master` 容器里，电脑重启后需要先执行 `colima start`。

## 使用

```bash
npm run crawler -- sources                                   # 已注册的数据源
npm run crawler -- discover --source mcpso                   # 只登记目标
npm run crawler -- crawl --source mcpso --limit 2            # 每种类型抽样 2 个
npm run crawler -- crawl --source mcpso --kind server,skill  # 只抓指定类型
npm run crawler -- crawl --source mcpso --since 2026-10-01   # 只抓近期更新的
npm run crawler -- crawl --source mcp-registry --since auto # 只拉上次成功抓取之后有变化的（每日任务用）
npm run crawler -- crawl --source skills-sh                  # 翻排行榜：新的抓详情，已收录的按仓库推送时间隔 7 天以上才重抓，安装量每天更新
npm run crawler -- crawl --source mcpso --store file         # 不写数据库，输出到 data/runs
npm run crawler -- stats                                     # 采集层统计
npm run crawler -- merge-plan                                # 合并预演：哪些草稿是同一个东西（只读，报告在 data/merge-plan）
npm run crawler -- classify                                  # 给来源没有分类的条目分类（Opus 5.5），之后 publish 生效
npm run crawler -- publish                                   # 发布：过滤凑数条目、合并各来源，重建 ingest_published（网站和各生成任务读它）
npm run crawler -- search-index                              # 同步搜索表 ingest_search、标签表 ingest_tags 和列表键表 ingest_list_keys（publish 结束时会自动同步；github 结束时同步搜索表和列表键表，translate / describe 结束时只同步搜索表）
npm run crawler -- indexnow --since 2026-10-15              # 把内容有变化的页面推送给 IndexNow（Bing 等）；配置了 INDEXNOW_KEY 时 publish 结束后自动推送
npm run crawler -- remap --source mcpso --kind client        # 改了映射规则后重建草稿（不发网络请求）
npm run crawler -- github                                    # 从 GitHub 更新星数、最近提交时间，并抓取 README（Skill 取 SKILL.md，增量）
npm run crawler -- translate --kind client                   # 把简介翻译成中英日三语
npm run crawler -- translate --kind client --recheck         # 按当前规则重新校验已有译文，只重翻不合格的
npm run crawler -- translate-tools --limit 10               # 把 MCP 服务的工具描述和参数说明翻译成中英日三语（热门服务先翻；--min-stars 只翻热门的）
npm run crawler -- overview --kind client                    # 根据 README 生成三语介绍
npm run crawler -- readme --kind client                      # README 整篇翻译成中文、日文（增量）
npm run crawler -- assets                                    # 图标转存到 Cloudflare R2（增量）
npm run crawler -- owner-icons                               # 图标补全：缺图标的条目用 GitHub 仓库所有者头像，转存到 R2 并写入发布层（增量）
npm run crawler -- describe                                  # 为 Loop / CLI / Agent 撰写我们自己的三语内容（增量）
npm run api:dev                                              # 启动后端 API（http://localhost:3100）
```

`github` 建议配置 `GITHUB_TOKEN`（每小时 5000 次；不配置只有 60 次）。
翻译和生成介绍需要在 `.env` 中配置 `ANTHROPIC_API_KEY`（可选 `ANTHROPIC_BASE_URL` 指向兼容代理）。
图片转存需要配置 `R2_ACCOUNT_ID`、`R2_BUCKET`、`R2_PUBLIC_BASE_URL`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。

## 开发

```bash
npm run typecheck
npm run lint
npm test
npm run db:generate -- --name <变更名>   # 修改 src/db/schema 后生成迁移
```
