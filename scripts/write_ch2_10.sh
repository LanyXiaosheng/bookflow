#!/usr/bin/env bash
# 写第2-10章：建章→整章写作→落库字数→章级QA
PID="2bdaaf8e-2f58-4a50-94f1-255c7c56321e"
CK=/tmp/bf_cookie.txt
LOG=/tmp/bf_write10.log
BASE="http://localhost:3000"
: > "$LOG"

log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

write_one(){
  n="$1"
  t="$2"
  payload=$(python3 -c "import json,sys; print(json.dumps({'title': sys.argv[1]}))" "$t")
  cid=$(curl -s -b "$CK" -H "Content-Type: application/json" \
    -X POST "$BASE/api/projects/$PID/chapters" -d "$payload" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
  if [ -z "$cid" ]; then log "ch${n} create-failed"; return 1; fi
  log "ch${n} created id=${cid} writing"
  curl -s -N -b "$CK" -H "Content-Type: application/json" \
    -X POST "$BASE/api/chapters/${cid}/ai-write-full/stream" -d '{}' >/dev/null 2>&1
  len=$(docker exec bookflow-postgres psql -U bookflow -d bookflow_dev -tA \
    -c "SELECT char_length(body) FROM chapters WHERE id='${cid}';" 2>/dev/null)
  log "ch${n} written len=${len}"
  qa=$(curl -s -b "$CK" -H "Content-Type: application/json" \
    -X POST "$BASE/api/chapters/${cid}/ai-qa" -d '{}' \
    | python3 -c "import sys,json
try:
  d=json.load(sys.stdin); print('QA', d.get('total_score','?'), d.get('verdict', d.get('tier','')))
except Exception as e: print('QA-parse-fail', e)" 2>/dev/null)
  log "ch${n} ${qa}"
}

log "start ch2-10"
write_one 2 "第2章 全城最体面的散场通知"
write_one 3 "第3章 冷静期第一天，她挂上了透析"
write_one 4 "第4章 深情人设的第一道裂缝"
write_one 5 "第5章 她的药瓶被他看见了"
write_one 6 "第6章 全公司都在传她的喜帖"
write_one 7 "第7章 资金链断裂那天他没有打给她"
write_one 8 "第8章 十年深情不过是一场精准收割"
write_one 9 "第9章 她说你连让我死都不给个痛快"
write_one 10 "第10章 她开了门但没有说欢迎回来"
log "done ch2-10"
docker exec bookflow-postgres psql -U bookflow -d bookflow_dev -tA \
  -c "SELECT idx, char_length(body) FROM chapters WHERE project_id='$PID' ORDER BY idx;" | tee -a "$LOG"
