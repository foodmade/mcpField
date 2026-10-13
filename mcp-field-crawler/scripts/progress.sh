#!/usr/bin/env bash
# 查看后台任务进度：每个日志一行——最近进度、最后一条消息、多久前更新、告警/错误数，以及正在运行的采集命令。
# 用法：./scripts/progress.sh [日志目录，默认 logs]；持续刷新：watch -n 30 ./scripts/progress.sh
cd "$(dirname "$0")/.."
dir="${1:-logs}"
now=$(date +%s)

{
  printf '日志\t进度\t最后消息\t更新于\t告警/错误\n'
  # 最近更新的在前
  for f in $(ls -t "$dir"/*.log 2>/dev/null); do
    progress=$(grep -o '"progress":"[^"]*"' "$f" | tail -1 | cut -d'"' -f4)
    # 采集（crawl）的日志每条记录一行"已解析"，没有进度字段：显示已解析条数
    [[ -z $progress ]] && progress="已解析 $(grep -c '"msg":"已解析"' "$f")"
    msg=$(tail -1 "$f" | grep -o '"msg":"[^"]*"' | cut -d'"' -f4)
    modified=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f")
    problems=$(grep -cE '"level":(40|50)' "$f")
    printf '%s\t%s\t%s\t%s 分钟前\t%s\n' "$(basename "$f" .log)" "${progress:--}" "${msg:-—}" "$(((now - modified) / 60))" "$problems"
  done
} | column -t -s $'\t'

echo
echo "正在运行："
# 只看 node 进程本身（tsx 启动的子进程），不含 npm / tsx 外壳
running=$(ps -Ao command | grep -E '^/[^ ]*/node .*src/cli/index\.ts' | sed -E 's#.*src/cli/index\.ts#  #')
echo "${running:-  （没有）}"
