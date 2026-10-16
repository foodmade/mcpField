# 部署说明

服务器 `43.165.173.197`（腾讯云 Lighthouse，OpenCloudOS 9.2，2 核 7.5G，无 swap），2026-10-13 从 `43.132.191.159` 迁来。
与 sub2api（8080）、PostgreSQL、Redis、80 端口的 lighthouse 应用共用一台机器，**不改动它们的配置和数据，系统盘的 `/data` 是 sub2api 的**。
mcpfield 的代码、数据库、运行环境都放在数据盘 `/storage02/mcpfield/` 下。

```
访客 → Cloudflare（HTTPS、CDN 缓存）→ 系统自带的 Nginx（只监听 443，按域名转发）
     → mcpfield-web（pm2，127.0.0.1:3000）→ mcpfield-api（pm2，127.0.0.1:3100）
     → 系统自带的 mysqld（127.0.0.1:3306，缓冲池 1G，systemd 限内存 2.5G）
```

| 位置 | 内容 |
|---|---|
| `/storage02/mcpfield/app` | 代码（由本机 `mcpfield deploy` 同步，不在服务器上构建） |
| `/storage02/mcpfield/app/.mysql.env` | 数据库密码（只在服务器上） |
| `/storage02/mcpfield/app/mcp-field-crawler/.env` | API、采集和模型服务配置（只在服务器上） |
| `/storage02/mcpfield/mysql` | MySQL 数据目录（`/etc/my.cnf.d/zz-mcpfield.cnf`；资源限制 `/etc/systemd/system/mysqld.service.d/mcpfield.conf`） |
| `/storage02/mcpfield/runtime/node` | Node 22（`/usr/local/bin` 下的 node、npm、pm2 是指向这里的链接）；pm2 开机自启（`pm2-root.service`） |
| `/storage02/mcpfield/ssl/mcpfield.com*.pem` | Cloudflare 源服务器证书 |
| `/etc/nginx/conf.d/mcpfield.com.conf` | 站点配置（来自 `deploy/nginx/`，用 `mcpfield nginx` 更新）；`nginx.conf` 里默认的 80 端口站点已注释掉（原文件 `nginx.conf.orig`） |
| crontab | 每天 3:30 增量更新数据，日志 `mcp-field-crawler/logs/daily.log` |

## 日常操作（本机执行）

安装命令：`ln -sf "$(pwd)/deploy/mcpfield.sh" ~/.local/bin/mcpfield`

```bash
mcpfield deploy            # 发布前后端（类型检查 → 本机构建 → 同步 → 装依赖 → 迁移 → 平滑重启 → 健康检查）
mcpfield deploy web        # 只发布前端；deploy api 只发布后端
mcpfield status            # 服务、站点、数据库、内存
mcpfield logs api -f       # 日志：web / api / nginx / data
mcpfield restart           # 重启
mcpfield data              # 立即在后台更新数据；也可以只跑某几步：mcpfield data overview readme
mcpfield run overview --kind server --limit 20   # 后台运行任意采集命令（可带参数），日志：mcpfield logs overview -f
mcpfield stop overview     # 停止后台运行的采集命令；命令是增量的，重新 run 会从断点继续
mcpfield nginx             # 修改 deploy/nginx/ 或更换证书后重新加载（校验失败自动撤回）
mcpfield backup            # 备份数据库到本机 backups/
mcpfield db / ssh          # 数据库命令行 / 登录服务器
```

## 更换证书

在 Cloudflare 后台 SSL/TLS → 源服务器 创建新证书后：

```bash
scp mcpfield.com.pem mcpfield.com-key.pem root@43.165.173.197:/storage02/mcpfield/ssl/
mcpfield nginx
```

## 注意

- 前端带哈希的静态资源（`mcp-field/build/client/assets/`）发布时只增不删，7 天前的旧文件在发布前端时清理。
  浏览器和 Cloudflare 里缓存的旧页面还会引用上一版的文件，立即删除会导致点链接时页面原地刷新、进不去详情页。
- Cloudflare 的 Caching → Configuration → Browser Cache TTL 要设为 "Respect Existing Headers"：
  页面自己返回 `max-age=0`，浏览器每次都会重新获取；改成固定时长会让浏览器在发布后继续使用旧页面。

- Nginx 只监听 443（80 是同机 lighthouse 应用的）：Cloudflare 要开 SSL/TLS → Edge Certificates → Always Use HTTPS，
  否则用 http 访问的请求会回源到 80 端口的别的应用。站点配置只通过 `mcpfield nginx` 修改：先 `nginx -t` 校验，通过才重新加载。
- 与 sub2api 同机：mysqld 的 systemd 配置里限了内存（`/etc/systemd/system/mysqld.service.d/mcpfield.conf`：MemoryHigh 3G / MemoryMax 3.5G；2026-10-15 从 2G / 2.5G 调上来，原来一直顶着上限被回收），CPU、磁盘 IO 的权重减半，
  紧张时 sub2api 优先；采集命令（`mcpfield run` / `data` / 每日任务）用 `nice -n 10` 运行；pm2 的服务超过上限自动重启（API 350MB；前端 700MB，堆限制 512MB，Googlebot 大量抓取时 350MB 不够）。不要在服务器上构建前端。
- 每日任务（crontab 里 `STEPS="crawl classify publish assets owner-icons github translate translate-tools describe overview readme"`，cron 的 PATH 要带 `/usr/local/bin`）：
  抓取只走官方 MCP Registry（平时 `--since auto` 增量，周日全量）和 skills.sh；mcp.so 2026-10-16 起冻结，已有数据照常发布、不再更新（client / cli / loop / agent 只有它这一个来源，不会再有新条目）。
  classify 只给新条目和输入有变化的分类。
- skills.sh 要 Vercel OIDC 令牌：服务器 `.env` 里的 `VERCEL_TOKEN`（Vercel Access Token）+ `~/.mcpfield/skills-sh`（`.vercel/project.json` 从本机拷来），令牌快过期时自动 `vercel env pull --token` 换新；Vercel CLI 装在 `/usr/local/bin`。
- `deploy/docker-compose.yml` 是旧服务器上 MySQL 容器的配置，新服务器不用 Docker。
