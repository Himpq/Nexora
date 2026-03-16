# NexoraCode

本地工具执行器，为 Nexora 提供本机能力扩展（Shell 执行、文件操作、网页渲染），通过 PyWebView 提供轻量桌面 UI。

## 架构

```
NexoraCode/
├── main.py                  # 入口：PyWebView 窗口 + 托盘
├── config.json              # 用户配置
├── requirements.txt
├── core/
│   ├── server.py            # 本地 Flask HTTP 服务（端口 27700）
│   ├── tool_registry.py     # 工具自动发现与注册
│   ├── nexora_client.py     # Nexora 服务器通信
│   ├── config.py            # 配置读写
│   └── tray.py              # 系统托盘
├── tools/
│   ├── shell.py             # shell_exec 工具
│   ├── file_ops.py          # file_read / file_write / file_list 工具
│   └── renderer.py          # web_render 工具（Playwright）
├── ui/
│   ├── index.html
│   └── assets/
│       ├── style.css
│       ├── app.js
│       ├── marked.min.js        # 需手动下载
│       ├── katex/               # 需手动下载 KaTeX 离线包
│       └── highlight/           # 需手动下载 highlight.js
└── assets/
    └── icon.png             # 托盘图标（可选）
```

## 安装

```powershell
pip install -r requirements.txt
playwright install chromium
```

## 前端依赖（离线，手动下载）

| 文件 | 来源 |
|------|------|
| `ui/assets/marked.min.js` | https://cdn.jsdelivr.net/npm/marked/marked.min.js |
| `ui/assets/katex/` | KaTeX Release 页，下载 katex.min.js + katex.min.css + contrib/auto-render.min.js + fonts/ |
| `ui/assets/highlight/` | https://highlightjs.org/download （选 github-dark 主题） |

## 运行

```powershell
python main.py
```

## 新增工具

在 `tools/` 目录下创建 Python 文件，导出 `TOOL_MANIFEST` 列表即可被自动发现：

```python
TOOL_MANIFEST = [{
    "name": "my_tool",
    "handler": "my_function",
    "description": "...",
    "parameters": { ... }
}]

def my_function(param1: str) -> dict:
    return {"result": ...}
```

## 安全说明

- 本地服务通过随机 token 鉴权，仅 WebView 内页面能获取
- 文件操作通过 `allowed_dirs` 白名单限制
- Shell 命令支持前缀白名单及硬编码黑名单
