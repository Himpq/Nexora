# Nexora 华为云调试部署

用于「揭榜挂帅/华为赛道」演示环境的调试服务器部署说明。

## 服务器

- 华为云 ECS：`123.60.41.184`（Ubuntu 24.04，root 可 SSH）
- 服务器自带宝塔面板，占用端口 32591，与 Nexora 互不影响：
  - 面板地址：`https://123.60.41.184:32591/91d80a12`
- Nexora 对外地址（nginx 80/443 反向代理 → 127.0.0.1:5000）：
  - `http://123.60.41.184/`
  - `https://123.60.41.184/`（自签名证书，浏览器需手动信任）

## 服务器布局

| 路径 | 说明 |
| --- | --- |
| `/opt/nexora` | ChatDBServer 代码 + `data/` + `static/`（含 `static/new` 前端产物） |
| `/opt/nexora/venv` | Python 3.12 虚拟环境（依赖已装） |
| `/opt/nexora-web` | NexoraWeb 前端源码（构建后产物写入 `../ChatDBServer/static/new`，靠 `/opt/ChatDBServer -> /opt/nexora` 软链对齐） |
| `/etc/systemd/system/nexora.service` | systemd 服务（开机自启、崩溃自动重启） |
| `/etc/nginx/sites-available/nexora` | nginx 站点（80/443，含 WebSocket Upgrade） |
| `/etc/nginx/ssl/nexora.crt` / `.key` | 自签名证书（CN/SAN = 123.60.41.184） |
| `/var/log/nexora.log` | 服务日志 |

## 常用操作

```bash
systemctl restart nexora     # 重启 ChatDBServer
systemctl status nexora      # 查看状态
tail -f /var/log/nexora.log  # 跟踪日志
```

## 更新部署（改代码后重新上线）

1. 打包 ChatDBServer（排除 `__pycache__`）并上传到 `/root/chatdbserver.tar.gz`；
2. `tar -xzf /root/chatdbserver.tar.gz -C /opt/nexora --strip-components=1`；
3. `systemctl restart nexora`。
4. 若前端有改动：打包 NexoraWeb 上传，在 `/opt/nexora-web` 解压后
   `npm install` + `npx vite build`。

## 注意事项

- 代码中 `from Map.baidu import ...` 依赖目录 `api/Map`（大写 M）。
  Windows 不区分大小写可运行，Linux 必须严格匹配 —— 已在本地仓库用
  `git mv api/map api/Map` 修正，服务器旧目录上留了 `Map -> map` 软链兜底。
- 调试账号在 `data/user.json`（密码见私密渠道）；模型供应商 API Key 需登录后
  在系统设置中配置，否则模型调用会报 `missing_api_key`。
- pip 装依赖用华为云镜像：
  `pip install -i https://mirrors.huaweicloud.com/repository/pypi/simple --trusted-host mirrors.huaweicloud.com ...`
- npm 用 `https://mirrors.huaweicloud.com/repository/npm/` 镜像。
