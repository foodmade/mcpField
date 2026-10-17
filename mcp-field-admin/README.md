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
| `/daily?date=` | 每日采集：某一天的批次、每一步的状态、耗时、进度、成功 / 待抽查 / 失败条数，失败步骤展开最后几条警告和错误日志，可以重新运行；当天新收录条目的状态灯 |
| `/items?kind=` | 数据管理：按类型分页浏览全部条目，按分类、来源、补全状态、某一补全项的状态筛选，按收录时间、热度、名称排序 |
| `/blog` | 博客文章：按已发布 / 定时发布 / 草稿筛选，按标题或地址搜索 |
| `/blog/new`、`/blog/:id` | 写文章：Markdown 编辑 + 实时预览（和网站文章页同一份样式 `src/blog-md.css`），粘贴或拖入图片自动上传到 R2；地址、栏目、标签、作者、发布时间（填未来时间即定时发布）、置顶、封面；⌘S 保存 |
| `/logs` | 服务器上 daily.log、run-<命令>.log 的末尾 |
| `/account` | 修改密码 |

状态灯的数据从哪来、什么时候更新，见 `mcp-field-crawler/docs/PIPELINE.md` 的“管理后台的数据”一节。

## 博客

文章存在 `blog_posts` 表（迁移 0014），后台接口见 `mcp-field-crawler/src/admin-api/blog.ts`，网站读接口见 `src/api/modules/blog`。

- 网站接口对结果缓存 30 秒，保存后最多半分钟网站可见；草稿、发布时间未到的文章网站上看不到。
- 正文里链接到站内条目（`[Linear](/servers/linear)`、完整的 `https://mcpfield.com/...` 地址也行）会在保存时解析出来，显示在文章页右侧的“文中提到的服务”。
- 图片上传需要 `mcp-field-crawler/.env` 里配齐 `R2_*` 五项（和图标同一个桶，放在 `blog/` 下，按内容哈希命名）；本地 `.env` 也配了线上 R2，本地上传的图会进线上桶。
- 文章只有中文：网站的英文、日文博客页可以访问，但不收录（noindex），sitemap 只列中文地址；RSS 在 `https://mcpfield.com/blog/rss.xml`。
- Nginx 给 `/api/admin/blog/` 单独放宽了请求体到 10 MB（其余后台接口仍是 64 KB），改了配置要执行 `mcpfield nginx`。
