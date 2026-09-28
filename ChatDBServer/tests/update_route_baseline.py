"""
重新生成路由契约基线 baseline_routes.json。

仅允许在有意的路由变更（新功能上线或迁移批次完成）后执行，
禁止用重新生成来掩盖非预期的路由变化：

    cd ChatDBServer
    python tests/update_route_baseline.py
"""

import os
import sys
import argparse
import importlib.util
import json
import tempfile

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))

if TESTS_DIR not in sys.path:
    sys.path.insert(0, TESTS_DIR)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--add-module', help='独立 Blueprint 模块的相对路径，仅追加新路由并保留现有基线')
    parser.add_argument('--blueprint', help='模块导出的 Blueprint 变量名')
    args = parser.parse_args()

    if args.add_module:
        count = add_blueprint_routes(args.add_module, args.blueprint)
    else:
        # 全量更新仍走真实 app；独立新增模式不加载用户配置、密钥及后台服务。
        from test_smoke_routes import write_route_baseline
        count = write_route_baseline()

    print(f'baseline updated: {count} routes')


def add_blueprint_routes(module_path, blueprint_name):
    """显式追加独立新模块，已有路由冲突时直接报错，不能掩盖路由删除。"""
    from flask import Flask
    from pathlib import Path

    root = Path(TESTS_DIR).resolve().parent
    path = (root / module_path).resolve()

    if not path.is_relative_to(root) or not path.is_file() or not blueprint_name:
        raise ValueError('必须指定工程内独立模块及其 Blueprint 名称')

    spec = importlib.util.spec_from_file_location('route_baseline_addition', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    baseline_path = Path(TESTS_DIR) / 'baseline_routes.json'
    baseline = json.loads(baseline_path.read_text(encoding='utf-8-sig'))
    routes = list(baseline['routes'])

    with tempfile.TemporaryDirectory() as directory:
        app = Flask('isolated_blueprint_baseline', root_path=directory, static_folder=None)
        app.register_blueprint(getattr(module, blueprint_name))

        for rule in app.url_map.iter_rules():
            methods = sorted(method for method in rule.methods if method not in ('HEAD', 'OPTIONS'))

            existing = [entry for entry in routes if entry[0] == rule.rule]

            if existing and [rule.rule, methods] not in existing:
                raise ValueError(f'已有路由方法冲突: {rule.rule}')

            if not existing:
                routes.append([rule.rule, methods])

    baseline['routes'] = sorted(routes, key=lambda entry: entry[0])
    baseline_path.write_text(json.dumps(baseline, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return len(routes)


if __name__ == '__main__':
    main()
