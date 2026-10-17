#!/usr/bin/env bash
# MCP Field 运维命令：在本机执行，通过 SSH 操作服务器。
# 安装：ln -sf "$(pwd)/deploy/mcpfield.sh" ~/.local/bin/mcpfield
set -euo pipefail

# 2026-10-13 迁到新服务器（与 sub2api 同机）：代码和 MySQL 数据都在数据盘 /storage02/mcpfield 下
SERVER="${MCPFIELD_SERVER:-root@43.165.173.197}"
REMOTE="${MCPFIELD_DIR:-/storage02/mcpfield/app}"
ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"

c_info=$'\e[36m'; c_ok=$'\e[32m'; c_err=$'\e[31m'; c_off=$'\e[0m'
info() { echo "${c_info}▸ $*${c_off}"; }
ok() { echo "${c_ok}✔ $*${c_off}"; }
die() { echo "${c_err}✘ $*${c_off}" >&2; exit 1; }
remote() { ssh -o BatchMode=yes "${SERVER}" "$@"; }

usage() {
  cat <<EOF
MCP Field 运维命令（服务器：${SERVER}:${REMOTE}）

用法：mcpfield <命令> [参数]

  deploy [web|api|admin] [--skip-checks]   发布：本地类型检查 → 构建前端 → 同步代码 → 安装依赖 → 数据库迁移 → 平滑重启
                                     （admin 是管理后台 admin.mcpfield.com：页面 + mcpfield-admin-api）
  status                             服务、站点、数据库、内存状态
  logs [web|api|nginx|data|<采集命令>] [-f]   查看日志（默认 web，-f 持续跟踪；nginx 是站点的访问日志；
                                     采集命令的日志例如：mcpfield logs overview -f）
  restart [web|api]                  重启服务（默认全部）
  data [step...]                     在服务器后台立即跑一次数据更新（默认全部步骤，例如：mcpfield data translate overview）
  run <采集命令> [参数]              在服务器后台运行任意采集命令，可带参数（例如：mcpfield run overview --kind server --limit 20）
  stop <采集命令>                    停止后台运行中的采集命令（例如：mcpfield stop readme）
  nginx                              更新站点的 Nginx 配置（deploy/nginx/）或证书后执行：校验通过才重新加载，失败自动撤回
  backup                             备份服务器数据库，下载到本地 backups/
  db                                 打开服务器上的 MySQL 命令行
  ssh                                登录服务器（进入部署目录）
EOF
}

# 只同步代码和前端构建产物；服务器上的 .env、数据、日志、依赖都不会被覆盖或删除
sync_code() {
  info "同步代码到 ${SERVER}:${REMOTE}"
  rsync -az --delete --no-owner --no-group \
    --exclude='.git/' --exclude='node_modules/' --exclude='.DS_Store' --exclude='*.tar.gz' \
    --exclude='/.mysql.env' --exclude='/.bytro' --exclude='/backups/' \
    --exclude='/mcp-field/.react-router/' --exclude='/mcp-field/dist/' \
    --exclude='/mcp-field/build/client/assets/' \
    --exclude='/mcp-field-crawler/.env' --exclude='/mcp-field-crawler/.env.bak*' --exclude='/mcp-field-crawler/data/' --exclude='/mcp-field-crawler/logs/' \
    --exclude='/mcp-field-admin/node_modules/' \
    "${ROOT}/" "${SERVER}:${REMOTE}/"
  # 带哈希的前端资源只增不删：浏览器和 CDN 里缓存的旧页面还会引用上一版的文件，
  # 删掉后点链接会加载失败、页面原地刷新。超过 7 天没更新的旧文件在发布前端时清理（见 cmd_deploy）
  rsync -az --no-owner --no-group "${ROOT}/mcp-field/build/client/assets/" "${SERVER}:${REMOTE}/mcp-field/build/client/assets/"
}

cmd_deploy() {
  local target=all checks=1
  for a in "$@"; do
    case "$a" in
      web|api|admin) target="$a" ;;
      --skip-checks) checks=0 ;;
      *) die "未知参数：$a" ;;
    esac
  done
  if [[ $checks == 1 ]]; then
    info "类型检查"
    [[ $target == all || $target == web ]] && (cd "${ROOT}/mcp-field" && npm run --silent typecheck)
    [[ $target != web ]] && (cd "${ROOT}/mcp-field-crawler" && npm run --silent typecheck)
    [[ $target == all || $target == admin ]] && (cd "${ROOT}/mcp-field-admin" && npm run --silent typecheck)
  fi
  if [[ $target == all || $target == web ]]; then
    info "构建前端（在本机构建，服务器内存不够同时跑构建）"
    (cd "${ROOT}/mcp-field" && npm run --silent build >/dev/null)
  fi
  if [[ $target == all || $target == admin ]]; then
    info "构建管理后台页面"
    (cd "${ROOT}/mcp-field-admin" && npm run --silent build >/dev/null)
  fi
  sync_code
  local only=''
  [[ $target == web ]] && only='--only mcpfield-web'
  [[ $target == api ]] && only='--only mcpfield-api'
  [[ $target == admin ]] && only='--only mcpfield-admin-api'
  info "服务器：安装依赖、迁移数据库、重启"
  remote "cd ${REMOTE} && ONLY='$only' bash -s" <<'EOF'
set -e
# package-lock.json 变了才重新安装依赖
install() {
  local dir=$1 flags=$2 sum
  sum=$(sha1sum "$dir/package-lock.json" | cut -c1-40)
  if [[ "$(cat "$dir/node_modules/.lock-sha" 2>/dev/null)" != "$sum" ]]; then
    echo "  安装 $dir 依赖"
    (cd "$dir" && npm ci $flags --no-audit --no-fund --loglevel=error)
    echo "$sum" > "$dir/node_modules/.lock-sha"
  fi
}
install mcp-field --omit=dev
install mcp-field-crawler ''
(cd mcp-field-crawler && npm run --silent db:migrate)
# 本次构建的文件刚同步过、修改时间是现在；7 天前的只会是旧版本留下的
[[ "$ONLY" == *api* ]] || find mcp-field/build/client/assets -type f -mtime +7 -delete
pm2 startOrReload deploy/ecosystem.config.cjs --update-env $ONLY >/dev/null
pm2 save >/dev/null
for i in $(seq 1 30); do
  curl -sf -o /dev/null http://127.0.0.1:3100/api/health && curl -sf -o /dev/null http://127.0.0.1:3000/ && curl -sf -o /dev/null http://127.0.0.1:3200/api/admin/health && exit 0
  sleep 1
done
echo "健康检查失败，最近日志：" && pm2 logs --nostream --lines 30 && exit 1
EOF
  ok "发布完成：https://mcpfield.com（后台 https://admin.mcpfield.com）"
}

cmd_status() {
  remote "cd ${REMOTE} && bash -s" <<'EOF'
pm2 list | grep -E 'name|mcpfield' || true
printf '\n站点（经 Nginx）：%s\n' "$(curl -sk -o /dev/null -w '%{http_code}' --resolve mcpfield.com:443:127.0.0.1 https://mcpfield.com/robots.txt)"
printf '数据库：%s\n' "$(systemctl is-active mysqld)"
printf 'API：%s  前端：%s  后台接口：%s\n' "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/api/health)" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/)" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3200/api/admin/health)"
echo; free -m | head -3
[[ -f mcp-field-crawler/logs/daily.log ]] && printf '\n最近一次数据更新：\n' && tail -3 mcp-field-crawler/logs/daily.log
EOF
}

cmd_logs() {
  local which=web follow=''
  for a in "$@"; do
    case "$a" in
      -f) follow=1 ;;
      *) which="$a" ;;
    esac
  done
  case "$which" in
    web|api) if [[ -n $follow ]]; then ssh -t "${SERVER}" "pm2 logs mcpfield-$which"; else remote "pm2 logs mcpfield-$which --nostream --lines 100"; fi ;;
    nginx) if [[ -n $follow ]]; then ssh -t "${SERVER}" "tail -f /var/log/nginx/mcpfield.com.access.log"; else remote "tail -n 100 /var/log/nginx/mcpfield.com.access.log"; fi ;;
    *)
      # data 是每日任务的日志，其余是 mcpfield run 启动的采集命令日志
      local file="${REMOTE}/mcp-field-crawler/logs/run-${which}.log"
      [[ $which == data ]] && file="${REMOTE}/mcp-field-crawler/logs/daily.log"
      if [[ -n $follow ]]; then ssh -t "${SERVER}" "tail -f $file"; else remote "tail -n 100 $file"; fi ;;
  esac
}

cmd_restart() {
  local only=''
  case "${1:-all}" in
    web|api) only="--only mcpfield-$1" ;;
    all) ;;
    *) die "未知参数：$1" ;;
  esac
  remote "cd ${REMOTE} && pm2 reload deploy/ecosystem.config.cjs --update-env $only >/dev/null && pm2 list | grep -E 'name|mcpfield'"
}

cmd_data() {
  local steps="$*"
  remote "cd ${REMOTE}/mcp-field-crawler && mkdir -p logs && STEPS='$steps' TRIGGER=manual nohup nice -n 10 flock -n /tmp/mcpfield-daily.lock ./scripts/daily.sh >> logs/daily.log 2>&1 &"
  ok "已在服务器后台开始数据更新${steps:+（${steps}）}；查看进度：mcpfield logs data -f"
}

# 站点配置放进服务器自带的 Nginx（只占 443，80 是同机其他应用的）：先校验，通过才重新加载，失败恢复原配置
cmd_nginx() {
  rsync -az --no-owner --no-group "${ROOT}/deploy/nginx/" "${SERVER}:${REMOTE}/deploy/nginx/"
  remote "REMOTE='${REMOTE}' bash -s" <<'EOF'
set -e
f=/etc/nginx/conf.d/mcpfield.com.conf
rm -f /tmp/mcpfield.com.conf.bak
[ -f $f ] && cp $f /tmp/mcpfield.com.conf.bak
cp "$REMOTE/deploy/nginx/mcpfield.com.conf" $f
if nginx -t >/dev/null 2>&1; then
  systemctl reload-or-restart nginx && echo "Nginx 已重新加载"
else
  nginx -t || true
  if [ -f /tmp/mcpfield.com.conf.bak ]; then cp /tmp/mcpfield.com.conf.bak $f; else rm -f $f; fi
  echo "校验失败，已恢复原配置"; exit 1
fi
EOF
}

# 后台运行采集命令：断开 SSH 后继续跑；同名命令同时只允许一个；命令本身是增量的，中断后重跑会跳过已完成的部分
cmd_run() {
  [[ $# -gt 0 ]] || die "用法：mcpfield run <采集命令> [参数]，例如：mcpfield run overview --kind server --limit 20"
  local name="$1" args
  args=$(printf '%q ' "$@")
  remote "cd ${REMOTE}/mcp-field-crawler && mkdir -p logs && if pgrep -f 'cli/index.ts ${name}( |$)' >/dev/null; then echo '${name} 已经在运行'; exit 1; fi
    echo \"[\$(date '+%F %T')] 开始 crawler ${*}\" >> logs/run-${name}.log
    nohup nice -n 10 npm run --silent crawler -- ${args} >> logs/run-${name}.log 2>&1 < /dev/null &"
  ok "已在服务器后台运行：crawler ${*}；查看进度：mcpfield logs ${name} -f；停止：mcpfield stop ${name}"
}

cmd_stop() {
  [[ $# -eq 1 ]] || die "用法：mcpfield stop <采集命令>，例如：mcpfield stop readme"
  # 发 SIGINT：采集命令收到后会等进行中的请求完成、保存结果再退出
  remote "pkill -INT -f 'cli/index.ts $1( |\$)' && echo '已通知 $1 停止（等进行中的请求完成、保存结果后退出）' || echo '$1 没有在运行'"
}

cmd_backup() {
  local name
  name="mcp_field-$(date +%Y%m%d-%H%M%S).sql.gz"
  info "导出服务器数据库"
  remote "mkdir -p ${REMOTE}/backups && cd ${REMOTE} && set -a && . ./.mysql.env && MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" nice mysqldump -uroot --single-transaction --set-gtid-purged=OFF --no-tablespaces mcp_field | gzip > backups/${name} && ls -t backups/*.sql.gz | tail -n +8 | xargs -r rm"
  mkdir -p "${ROOT}/backups"
  scp -q "${SERVER}:${REMOTE}/backups/${name}" "${ROOT}/backups/${name}"
  ok "已备份：${ROOT}/backups/${name}（服务器上保留最近 7 份）"
}

cmd_db() {
  ssh -t "${SERVER}" "cd ${REMOTE} && set -a && . ./.mysql.env && MYSQL_PWD=\"\$MYSQL_PASSWORD\" mysql -umcpfield -h127.0.0.1 mcp_field"
}

case "${1:-help}" in
  deploy) shift; cmd_deploy "$@" ;;
  status) cmd_status ;;
  logs) shift; cmd_logs "$@" ;;
  restart) shift; cmd_restart "$@" ;;
  data) shift; cmd_data "$@" ;;
  run) shift; cmd_run "$@" ;;
  stop) shift; cmd_stop "$@" ;;
  nginx) cmd_nginx ;;
  backup) cmd_backup ;;
  db) cmd_db ;;
  ssh) ssh -t "${SERVER}" "cd ${REMOTE} && exec \$SHELL -l" ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
