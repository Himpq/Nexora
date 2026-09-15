#!/usr/bin/env bash
# question 存量回答回填 — 把功能上线前已回答、但服务端无登记的 question 事件
# 按「紧跟 question 的下一条 user 消息即为该问题回答」的回合法则补写 resolved/answer。
#
# 依据: question 工具以 awaiting_question_response 结束回合，用户下一条消息必然是对该问题的应答。
# 用法: bash scripts/backfill_question_resolved_123.sh <cid> [cid...]
set -euo pipefail

# Git Bash 的 MSYS 会把 ssh 参数里开头的 /opt/... 改写成 Windows Git 安装路径，必须禁用
export MSYS_NO_PATHCONV=1

HOST=root@123.60.41.184
BASE=/opt/nexora/data/users/himpq/conversations
PY=/opt/nexora/venv/bin/python
TS=$(date +%Y%m%d_%H%M)

if [ $# -lt 1 ]; then
    echo "用法: bash scripts/backfill_question_resolved_123.sh <cid> [cid...]" >&2
    exit 1
fi

for CID in "$@"; do
    echo "== 会话 $CID"

    echo "-- 备份原文件"
    ssh -o BatchMode=yes "$HOST" "cp $BASE/$CID.json $BASE/$CID.json.bak_qbackfill_$TS && echo backup-ok"

    echo "-- 回填 resolved/answer"
    ssh -o BatchMode=yes "$HOST" "$PY - $CID <<'PYEOF'
import json, sys
from datetime import datetime

cid = sys.argv[1]
path = '/opt/nexora/data/users/himpq/conversations/%s.json' % cid
data = json.load(open(path, encoding='utf-8'))
msgs = data.get('messages', [])
changed = 0

for i, m in enumerate(msgs):
    if not isinstance(m, dict) or m.get('role') != 'assistant':
        continue
    events = ((m.get('trace') or {}).get('events') or [])
    for e in events:
        if not isinstance(e, dict) or e.get('type') != 'question':
            continue
        q = e.get('question')
        if not isinstance(q, dict) or q.get('resolved'):
            continue

        nxt = msgs[i + 1] if i + 1 < len(msgs) else None
        if not isinstance(nxt, dict) or nxt.get('role') != 'user':
            print('skip(无后续user消息) qid=%s' % q.get('question_id'))
            continue

        answer = str(nxt.get('content') or '').strip()
        if not answer:
            print('skip(后续user消息为空) qid=%s' % q.get('question_id'))
            continue

        q['resolved'] = True
        q['answer'] = answer
        changed += 1
        print('resolved qid=%s answer=%s' % (q.get('question_id'), answer[:40]))

if changed:
    data['updated_at'] = datetime.now().isoformat()
    json.dump(data, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

print('changed=%d' % changed)
PYEOF"
done

echo "== backfill-done"
