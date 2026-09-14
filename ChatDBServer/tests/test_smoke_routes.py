"""
服务级冒烟测试：路由契约基线 + 关键路径探活

server.py 采用 Strangler Fig 模式分批迁移路由，本测试是每批迁移的门禁：

    cd ChatDBServer
    python -m unittest tests.test_smoke_routes -v

- RouteContractTests：将当前 app.url_map 与 baseline_routes.json 全量比对，
  任何路由丢失、新增或方法变化都会失败（前端契约零变化是硬要求）。
- KeyPathSmokeTests：无登录态下关键端点的响应契约。

基线再生成（仅允许在有意的路由变更后执行，禁止作为测试失败的解法）：

    python tests/update_route_baseline.py
"""

import json
import os
import sys
import unittest

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.dirname(TESTS_DIR)

if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

import server

BASELINE_PATH = os.path.join(TESTS_DIR, 'baseline_routes.json')


def snapshot_routes():
    """
    导出当前 Flask app 的全部路由规则为可排序的 [路径, [方法]] 列表。

    HEAD/OPTIONS 由 Flask/Werkzeug 自动派生，不纳入契约比对，
    只保留业务真正声明的方法。
    """
    rules = []

    for rule in server.app.url_map.iter_rules():
        methods = sorted(m for m in rule.methods if m not in ('HEAD', 'OPTIONS'))
        rules.append([rule.rule, methods])

    rules.sort(key=lambda item: item[0])
    return rules


def write_route_baseline():
    """
    将当前路由快照写入基线文件，返回路由数量。

    仅由 tests/update_route_baseline.py 在有意的路由变更后调用，
    测试本身永不触发写入。
    """
    baseline = {'routes': snapshot_routes()}

    with open(BASELINE_PATH, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(baseline, f, ensure_ascii=False, indent=2)
        f.write('\n')

    return len(baseline['routes'])


class RouteContractTests(unittest.TestCase):
    """路由契约基线比对：迁移期间防止路由丢失或方法漂移。"""

    def test_route_contract_matches_baseline(self):
        with open(BASELINE_PATH, 'r', encoding='utf-8') as f:
            baseline = json.load(f)

        self.assertEqual(
            snapshot_routes(),
            baseline['routes'],
            '路由契约与基线不一致。若本次迁移确应增删路由，'
            '运行 python tests/update_route_baseline.py 重新生成基线并在提交说明中注明。',
        )


class KeyPathSmokeTests(unittest.TestCase):
    """关键路径冒烟：无登录态下的响应契约，防止迁移改变可观测行为。"""

    @classmethod
    def setUpClass(cls):
        cls.client = server.app.test_client()

    def test_index_page_renders(self):
        resp = self.client.get('/')

        self.assertEqual(resp.status_code, 200)
        self.assertIn('text/html', resp.content_type)

    def test_health_endpoint(self):
        resp = self.client.get('/api/health')

        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data['success'])
        self.assertEqual(data['service'], 'Nexora')

    def test_user_info_requires_login(self):
        resp = self.client.get('/api/user/info')

        self.assertEqual(resp.status_code, 401)
        self.assertFalse(resp.get_json()['success'])

    def test_conversations_require_login(self):
        resp = self.client.get('/api/conversations')

        self.assertEqual(resp.status_code, 401)
        self.assertFalse(resp.get_json()['success'])

    def test_login_rejects_unknown_user(self):
        resp = self.client.post('/login', json={'username': '__smoke__', 'password': '__smoke__'})

        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.get_json()['success'])


if __name__ == '__main__':
    unittest.main()
