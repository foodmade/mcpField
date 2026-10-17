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
| `/logs` | 服务器上 daily.log、run-<命令>.log 的末尾 |
| `/account` | 修改密码 |

状态灯的数据从哪来、什么时候更新，见 `mcp-field-crawler/docs/PIPELINE.md` 的“管理后台的数据”一节。
