#!/usr/bin/env bash
# 每日数据更新：增量抓取 → 分类（只分新的）→ 工具实测（投递给实测机、导入结果，等新收录的最多 60 分钟）→ 发布（合并各来源）→ 图标转存 → 图标补全（所有者头像）→ GitHub（星数、最近提交、README）→ 简介翻译 → 工具描述翻译 → 自撰内容 → AI 介绍 → README 翻译
# publish / github / translate / describe 结束时会自动同步搜索表 ingest_search，不需要单独的步骤。
# 每一步都是增量的，只处理新增或有变化的条目；某一步失败不影响后面的步骤。
# 抓取只走 CRAWL_SOURCES（默认官方 MCP Registry 和 skills.sh）；mcp.so 的数据 2026-10-16 起冻结，不再抓取。
# mcp-registry 平时只拉上次成功抓取之后有变化的（--since auto），每周日全量一次兜底。
# 只跑其中几步：STEPS="translate overview" ./scripts/daily.sh
# 每次运行在后台记一个批次（admin_job_batches），各步骤的运行挂在它下面；TRIGGER=manual 表示手动触发（mcpfield data）
cd "$(dirname "$0")/.."
read -r -a steps <<< "${STEPS:-crawl classify probe publish assets owner-icons github translate translate-tools describe overview readme}"
read -r -a sources <<< "${CRAWL_SOURCES:-mcp-registry skills-sh}"
status=0
# 批次记录失败不影响数据更新，只是后台看不到这一批
batch=$(npm run --silent crawler -- job-batch start --trigger "${TRIGGER:-cron}" --steps "${steps[*]}" 2>/dev/null | tail -n 1 || true)
[[ $batch =~ ^[0-9]+$ ]] && export MCPFIELD_BATCH_ID=$batch
run() {
  echo "[$(date '+%F %T')] 开始 $*"
  if ! npm run --silent crawler -- "$@"; then
    echo "[$(date '+%F %T')] 失败 $*"
    status=1
  fi
}
for step in "${steps[@]}"; do
  if [[ $step == crawl ]]; then
    for source in "${sources[@]}"; do
      args=(crawl --source "$source")
      [[ $source == mcp-registry && $(date +%u) != 7 ]] && args+=(--since auto)
      run "${args[@]}"
    done
  else
    run "$step"
  fi
done
echo "[$(date '+%F %T')] 完成 ${steps[*]}"
if [[ -n ${MCPFIELD_BATCH_ID:-} ]]; then
  npm run --silent crawler -- job-batch finish --id "$MCPFIELD_BATCH_ID" --status "$([[ $status == 0 ]] && echo succeeded || echo failed)" || true
fi
exit $status
