"""
重新生成路由契约基线 baseline_routes.json。

仅允许在有意的路由变更（新功能上线或迁移批次完成）后执行，
禁止用重新生成来掩盖非预期的路由变化：

    cd ChatDBServer
    python tests/update_route_baseline.py
"""

import os
import sys

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))

if TESTS_DIR not in sys.path:
    sys.path.insert(0, TESTS_DIR)

# test_smoke_routes 导入时会把 ChatDBServer 目录加入 sys.path 并完成 app 构建
from test_smoke_routes import write_route_baseline


def main():
    count = write_route_baseline()

    print(f'baseline updated: {count} routes')


if __name__ == '__main__':
    main()
