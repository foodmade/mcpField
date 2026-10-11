#!/usr/bin/env bash
# MCP Field 运维命令：在本机执行，通过 SSH 操作服务器。
# 安装：ln -sf "$(pwd)/deploy/mcpfield.sh" ~/.local/bin/mcpfield
set -euo pipefail

SERVER="${MCPFIELD_SERVER:-root@43.132.191.159}"
REMOTE="${MCPFIELD_DIR:-/data/mcpfield}"
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

  deploy [web|api] [--skip-checks]   发布：本地类型检查 → 构建前端 → 同步代码 → 安装依赖 → 数据库迁移 → 平滑重启
  status                             服务、站点、数据库、内存状态
  logs [web|api|nginx|data|<采集命令>] [-f]   查看日志（默认 web，-f 持续跟踪；nginx 是 bytor-website 容器的访问日志；
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
    --exclude='/.mysql.env' --exclude='/backups/' \
    --exclude='/mcp-field/.react-router/' --exclude='/mcp-field/dist/' \
    --exclude='/mcp-field-crawler/.env' --exclude='/mcp-field-crawler/data/' --exclude='/mcp-field-crawler/logs/' \
    "${ROOT}/" "${SERVER}:${REMOTE}/"
}

cmd_deploy() {
  local target=all checks=1
  for a in "$@"; do
    case "$a" in
      web|api) target="$a" ;;
      --skip-checks) checks=0 ;;
      *) die "未知参数：$a" ;;
    esac
  done
  if [[ $checks == 1 ]]; then
    info "类型检查"
    [[ $target != api ]] && (cd "${ROOT}/mcp-field" && npm run --silent typecheck)
    [[ $target != web ]] && (cd "${ROOT}/mcp-field-crawler" && npm run --silent typecheck)
  fi
  if [[ $target != api ]]; then
    info "构建前端（在本机构建，服务器内存不够同时跑构建）"
    (cd "${ROOT}/mcp-field" && npm run --silent build >/dev/null)
  fi
  sync_code
  local only=''
  [[ $target == web ]] && only='--only mcpfield-web'
  [[ $target == api ]] && only='--only mcpfield-api'
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
pm2 startOrReload deploy/ecosystem.config.cjs --update-env $ONLY >/dev/null
pm2 save >/dev/null
for i in $(seq 1 30); do
  curl -sf -o /dev/null http://127.0.0.1:3100/api/health && curl -sf -o /dev/null http://127.0.0.1:3000/ && exit 0
  sleep 1
done
echo "健康检查失败，最近日志：" && pm2 logs --nostream --lines 30 && exit 1
EOF
  ok "发布完成：https://mcpfield.com"
}

cmd_status() {
  remote "cd ${REMOTE} && bash -s" <<'EOF'
pm2 list | grep -E 'name|mcpfield' || true
printf '\n站点（经 Nginx）：%s\n' "$(curl -sk -o /dev/null -w '%{http_code}' --resolve mcpfield.com:443:127.0.0.1 https://mcpfield.com/robots.txt)"
printf '数据库：%s\n' "$(docker inspect -f '{{.State.Health.Status}}' mcpfield-mysql 2>/dev/null)"
printf 'API：%s  前端：%s\n' "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/api/health)" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/)"
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
    nginx) if [[ -n $follow ]]; then ssh -t "${SERVER}" "docker logs -f --tail 50 bytor-website"; else remote "docker logs --tail 100 bytor-website 2>&1"; fi ;;
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
  remote "cd ${REMOTE}/mcp-field-crawler && mkdir -p logs && STEPS='$steps' nohup flock -n /tmp/mcpfield-daily.lock ./scripts/daily.sh >> logs/daily.log 2>&1 &"
  ok "已在服务器后台开始数据更新${steps:+（${steps}）}；查看进度：mcpfield logs data -f"
}

# 站点配置放在 bytor-website 容器的 Nginx 里（它占用 80/443）：先校验，通过才重新加载，不会重启容器
cmd_nginx() {
  rsync -az --no-owner --no-group "${ROOT}/deploy/nginx/" "${SERVER}:${REMOTE}/deploy/nginx/"
  remote "bash -s" <<'EOF'
set -e
c=bytor-website f=/etc/nginx/conf.d/mcpfield.com.conf
docker exec $c cp $f /tmp/mcpfield.com.conf.bak 2>/dev/null || true
docker cp /data/mcpfield/deploy/nginx/mcpfield.com.conf $c:$f
if docker exec $c nginx -t >/dev/null 2>&1; then
  docker exec $c nginx -s reload && echo "Nginx 已重新加载"
else
  docker exec $c nginx -t || true
  docker exec $c sh -c "[ -f /tmp/mcpfield.com.conf.bak ] && cp /tmp/mcpfield.com.conf.bak $f" || true
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
    nohup npm run --silent crawler -- ${args} >> logs/run-${name}.log 2>&1 < /dev/null &"
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
  remote "mkdir -p ${REMOTE}/backups && cd ${REMOTE} && set -a && . ./.mysql.env && docker exec -e MYSQL_PWD=\"\$MYSQL_ROOT_PASSWORD\" mcpfield-mysql mysqldump -uroot --single-transaction --set-gtid-purged=OFF --no-tablespaces mcp_field | gzip > backups/${name} && ls -t backups/*.sql.gz | tail -n +8 | xargs -r rm"
  mkdir -p "${ROOT}/backups"
  scp -q "${SERVER}:${REMOTE}/backups/${name}" "${ROOT}/backups/${name}"
  ok "已备份：${ROOT}/backups/${name}（服务器上保留最近 7 份）"
}

cmd_db() {
  ssh -t "${SERVER}" "cd ${REMOTE} && set -a && . ./.mysql.env && docker exec -it -e MYSQL_PWD=\"\$MYSQL_PASSWORD\" mcpfield-mysql mysql -umcpfield mcp_field"
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
