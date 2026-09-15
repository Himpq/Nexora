#!/usr/bin/env bash
# question 作答登记功能部署 — 123.60.41.184 (/opt/nexora)
#
# 外科手术式部署：远端 server.py 仍是迁移前版本（本地 HEAD 的 Strangler Fig
# 迁移批次尚未部署），因此只上传 Conversation 域文件并在远端 server.py
# 精确插入 2 行蓝图注册，不整树上传以免带回未部署的迁移重构。
#
# 步骤: 备份 server.py -> 上传 Conversation 域文件 -> 幂等插入注册行 ->
#       语法/导入校验 -> systemctl restart nexora -> 健康检查
set -euo pipefail

# Git Bash 的 MSYS 会把 ssh 参数里开头的 /opt/... 改写成 Windows Git 安装路径，
# 部署命令必须禁用该转换，远端绝对路径才能原样送达
export MSYS_NO_PATHCONV=1

HOST=root@123.60.41.184
REMOTE_DIR=/opt/nexora
REMOTE_PY=$REMOTE_DIR/venv/bin/python
TS=$(date +%Y%m%d_%H%M)

cd "F:/Code/AI/ChatDB/ChatDBServer"

echo "== 1. 备份远端 server.py"
ssh -o BatchMode=yes "$HOST" "cp $REMOTE_DIR/server.py $REMOTE_DIR/server.py.bak_qresolve_$TS && echo backup-ok"

echo "== 2. 上传 Conversation 域文件（内容已经 Edit/Write 写入并通过本地 16 项测试）"
scp -o BatchMode=yes \
    ../ChatDBServer/api/basis/Conversation/__init__.py \
    ../ChatDBServer/api/basis/Conversation/errors.py \
    ../ChatDBServer/api/basis/Conversation/messages.py \
    ../ChatDBServer/api/basis/Conversation/service.py \
    ../ChatDBServer/api/basis/Conversation/routes.py \
    "$HOST:$REMOTE_DIR/api/basis/Conversation/"
scp -o BatchMode=yes ../ChatDBServer/api/basis/Permission/session_auth.py \
    "$HOST:$REMOTE_DIR/api/basis/Permission/"
ssh -o BatchMode=yes "$HOST" "mkdir -p $REMOTE_DIR/api/basis/Conversation/tests"
scp -o BatchMode=yes ../ChatDBServer/api/basis/Conversation/tests/test_conversation_service.py \
    "$HOST:$REMOTE_DIR/api/basis/Conversation/tests/"

echo "== 3. 幂等插入蓝图注册（锚点: app.register_blueprint(user_papi_keys_bp)）"
ssh -o BatchMode=yes "$HOST" "$REMOTE_PY - <<'PYEOF'
path = '/opt/nexora/server.py'
src = open(path, encoding='utf-8').read()

if 'conversation_bp' in src:
    print('already patched')
else:
    anchor = 'app.register_blueprint(user_papi_keys_bp)'
    pos = src.index(anchor) + len(anchor)
    insert = '\nfrom basis.Conversation import conversation_bp\napp.register_blueprint(conversation_bp)'
    open(path, 'w', encoding='utf-8').write(src[:pos] + insert + src[pos:])
    print('patched')
PYEOF"

echo "== 4. 语法 + 蓝图导入校验"
ssh -o BatchMode=yes "$HOST" "$REMOTE_PY -m py_compile $REMOTE_DIR/server.py && echo compile-ok"
ssh -o BatchMode=yes "$HOST" "$REMOTE_PY - <<'PYEOF'
import sys
sys.path.insert(0, '/opt/nexora/api')
from basis.Conversation import conversation_bp
print('bp-import-ok')
PYEOF"

echo "== 5. 重启 nexora.service（123 端按约定允许自动重启）"
ssh -o BatchMode=yes "$HOST" "systemctl restart nexora && sleep 4 && systemctl is-active nexora"

echo "== 6. 健康检查: 进程端口 + 新路由应答(未登录应为 401 而非 404)"
ssh -o BatchMode=yes "$HOST" "ss -tlnp | grep :5000 | head -1"
ssh -o BatchMode=yes "$HOST" "curl -s -o /dev/null -w 'resolve-route:%{http_code}\n' -X POST http://127.0.0.1:5000/api/conversations/x/question/resolve -H 'Content-Type: application/json' -d '{}'"

echo "== deploy-123-done"
