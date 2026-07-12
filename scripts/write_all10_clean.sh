#!/usr/bin/env bash
# 干净重跑全10章：严格按 outline 标题建章 -> 整章写作 -> 落库字数 -> 章级QA
# 一气呵成，中途不删改任何章节，避免 idx 错位。变量全用花括号边界。
PID="2bdaaf8e-2f58-4a50-94f1-255c7c56321e"
CK="/tmp/bf_cookie.txt"
LOG="/tmp/bf_clean10.log"
BASE="http://localhost:3000"
: > "${LOG}"

log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "${LOG}"; }

# 严格对齐 outline 的 10 个章标题（含【他的视角】标记）
t1="第1章 五十二万的推送弹在切水果的刀上"
t2="第2章 婆牌桌上拆开的不是红炸弹"
t3="第3章 律师函比他的道歉先到三十秒"
t4="第4章 【他的视角】冷静期第一天他以为是倒计时"
t5="第5章 她的暗牌比他的底仓还深"
t6="第6章 白月光的月光是借来的"
t7="第7章 【他的视角】认知坍塌的声音像骨头断裂"
t8="第8章 三年沉默值多少钱她不想算了"
t9="第9章 民政局门口的对峙不在计划里"
t10="第10章 喜帖的最后一页她没有印"

write_one(){
  local n="$1"; local t="$2"
  local payload cid len qa
  payload=$(python3 -c "import json,sys; print(json.dumps({'title': sys.argv[1]}))" "${t}")
  cid=$(curl -s -b "${CK}" -H "Content-Type: application/json" \
    -X POST "${BASE}/api/projects/${PID}/chapters" -d "${payload}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
  if [ -z "${cid}" ]; then log "第${n}章 建章失败"; return 1; fi
  log "第${n}章 建好 cid=${cid} 写作中"
  curl -s -N -b "${CK}" -H "Content-Type: application/json" \
    -X POST "${BASE}/api/chapters/${cid}/ai-write-full/stream" -d '{}' >/dev/null 2>&1
  len=$(docker exec bookflow-postgres psql -U bookflow -d bookflow_dev -tA \
    -c "SELECT char_length(body) FROM chapters WHERE id='${cid}';" 2>/dev/null)
  log "第${n}章 写完 ${len}字"
  qa=$(curl -s -b "${CK}" -H "Content-Type: application/json" \
    -X POST "${BASE}/api/chapters/${cid}/ai-qa" -d '{}' \
    | python3 -c "import sys,json
try:
  d=json.load(sys.stdin); print('QA', d.get('total_score','?'), d.get('verdict', d.get('tier','')))
except Exception as e: print('QA解析失败', e)" 2>/dev/null)
  log "第${n}章 ${qa}"
}

log "干净重跑开始"
write_one 1 "${t1}"
write_one 2 "${t2}"
write_one 3 "${t3}"
write_one 4 "${t4}"
write_one 5 "${t5}"
write_one 6 "${t6}"
write_one 7 "${t7}"
write_one 8 "${t8}"
write_one 9 "${t9}"
write_one 10 "${t10}"
log "全10章完成"
echo "=== 最终全景 ===" | tee -a "${LOG}"
docker exec bookflow-postgres psql -U bookflow -d bookflow_dev -tA \
  -c "SELECT idx, char_length(body) FROM chapters WHERE project_id='${PID}' ORDER BY idx;" | tee -a "${LOG}"