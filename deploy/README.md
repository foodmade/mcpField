# 部署说明

服务器 `43.132.191.159`（OpenCloudOS 9，2 核 3.6G + 2G swap），与 bytro 共用一台机器，**不改动 bytro 的容器和数据**。

```
访客 → Cloudflare（HTTPS、CDN 缓存）→ bytor-website 容器里的 Nginx（80/443，按域名转发）
     → 宿主机 mcpfield-web（pm2，127.0.0.1/172.17.0.1:3000）→ mcpfield-api（pm2，127.0.0.1:3100）
     → mcpfield-mysql 容器（127.0.0.1:3307，限 512MB）
```

| 位置 | 内容 |
|---|---|
| `/data/mcpfield` | 代码（由本机 `mcpfield deploy` 同步，不在服务器上构建） |
| `/data/mcpfield/.mysql.env` | 数据库密码（只在服务器上） |
| `/data/mcpfield/mcp-field-crawler/.env` | API 与采集配置（只在服务器上） |
| `/data/mcpfield/deploy/nginx/mcpfield.com.conf` | 站点配置，挂载进 bytor-website 容器 |
| `/data/bytro/ssl/mcpfield.com*.pem` | Cloudflare 源服务器证书 |
| `/data/bytro/docker-compose.prod.yml` | 只加了一行挂载站点配置（备份：`.bak-before-mcpfield-*`） |
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
scp mcpfield.com.pem mcpfield.com-key.pem root@43.132.191.159:/data/bytro/ssl/
mcpfield nginx
```

## 注意

- 前端带哈希的静态资源（`mcp-field/build/client/assets/`）发布时只增不删，7 天前的旧文件在发布前端时清理。
  浏览器和 Cloudflare 里缓存的旧页面还会引用上一版的文件，立即删除会导致点链接时页面原地刷新、进不去详情页。
- Cloudflare 的 Caching → Configuration → Browser Cache TTL 要设为 "Respect Existing Headers"：
  页面自己返回 `max-age=0`，浏览器每次都会重新获取；改成固定时长会让浏览器在发布后继续使用旧页面。

- Nginx 属于 bytro 的容器。bytro 重新部署（重建容器）时，compose 里的那行挂载会自动带上 mcpfield 的站点配置；证书在 bytro 的 `ssl` 目录里，也会保留。
- 站点配置有误会导致 Nginx 无法启动并影响 bytro，所以只通过 `mcpfield nginx` 修改：先 `nginx -t` 校验，通过才重新加载。
- 每日任务默认只跑抓取、图标、GitHub 星数与 README、简介翻译、自撰内容（crontab 里 `STEPS="crawl assets github translate describe"`）；AI 介绍和 README 翻译费用较高，需要时用 `mcpfield data overview readme` 手动触发。
