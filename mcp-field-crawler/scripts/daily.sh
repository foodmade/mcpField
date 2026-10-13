#!/usr/bin/env bash
# 每日数据更新：增量抓取 → 发布（合并各来源）→ 图标转存 → GitHub（星数、最近提交、README）→ 简介翻译 → 自撰内容 → AI 介绍 → README 翻译
# 每一步都是增量的，只处理新增或有变化的条目；某一步失败不影响后面的步骤。
# 只跑其中几步：STEPS="translate overview" ./scripts/daily.sh
cd "$(dirname "$0")/.."
read -r -a steps <<< "${STEPS:-crawl publish assets github translate describe overview readme}"
status=0
for step in "${steps[@]}"; do
  args=("$step")
  [[ $step == crawl ]] && args+=(--source mcpso)
  echo "[$(date '+%F %T')] 开始 ${args[*]}"
  if ! npm run --silent crawler -- "${args[@]}"; then
    echo "[$(date '+%F %T')] 失败 ${args[*]}"
    status=1
  fi
done
echo "[$(date '+%F %T')] 完成 ${steps[*]}"
exit $status
