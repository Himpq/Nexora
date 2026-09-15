#!/usr/bin/env bash
# question 作答登记功能部署 — 154.37.212.129 (/www/wwwroot/KnowledgeDB)
#
# 与 123 相同的外科手术式部署。差异:
# - 进程归宝塔面板管理，按项目约定【不重启】，上传后由管理员手动重启生效
# - 运行用户为 www，上传文件需修正属主
set -euo pipefail

# Git Bash 的 MSYS 会把 ssh 参数里开头的 /www/... 改写成 Windows Git 安装路径，
# 部署命令必须禁用该转换，远端绝对路径才能原样送达
export MSYS_NO_PATHCONV=1

HOST=root@154.37.212.129
REMOTE_DIR=/www/wwwroot/KnowledgeDB
REMOTE_PY=/www/server/pyporject_evn/KnowledgeDB_venv/bin/python
TS=$(date +%Y%m%d_%H%M)

cd "F:/Code/AI/ChatDB/ChatDBServer"

echo "== 1. 备份远端 server.py"
ssh -o BatchMode=yes "$HOST" "cp $REMOTE_DIR/server.py $REMOTE_DIR/server.py.bak_qresolve_$TS && echo backup-ok"

echo "== 2. 上传 Conversation 域文件"
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
path = '/www/wwwroot/KnowledgeDB/server.py'
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

echo "== 4. 修正属主(运行用户 www) + 语法 + 蓝图导入校验"
ssh -o BatchMode=yes "$HOST" "chown www:www $REMOTE_DIR/server.py $REMOTE_DIR/api/basis/Conversation/__init__.py $REMOTE_DIR/api/basis/Conversation/errors.py $REMOTE_DIR/api/basis/Conversation/messages.py $REMOTE_DIR/api/basis/Conversation/service.py $REMOTE_DIR/api/basis/Conversation/routes.py $REMOTE_DIR/api/basis/Permission/session_auth.py && chown -R www:www $REMOTE_DIR/api/basis/Conversation/tests && echo chown-ok"
ssh -o BatchMode=yes "$HOST" "$REMOTE_PY -m py_compile $REMOTE_DIR/server.py && echo compile-ok"
ssh -o BatchMode=yes "$HOST" "$REMOTE_PY - <<'PYEOF'
import sys
sys.path.insert(0, '/www/wwwroot/KnowledgeDB/api')
from basis.Conversation import conversation_bp
print('bp-import-ok')
PYEOF"

echo "== deploy-154-files-ok（按约定不重启，等待管理员手动重启生效）"
