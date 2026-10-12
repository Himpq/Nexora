# -*- mode: python ; coding: utf-8 -*-
# 单文件（onefile）打包配置：与 NexoraCode.spec 的分析参数完全一致，
# 唯一区别是 binaries/datas 直接并入 EXE、不生成 COLLECT 目录。
# 运行时 PyInstaller 会把内容解到临时目录，启动比 onedir 慢，
# 但对外只交付一个 exe。
from PyInstaller.utils.hooks import collect_all

# 说明：
# - 不打 data/：data/config.json 含 agent_token，data/providers.json 含 API Key，
#   首次运行时由 core.config.Config 自动生成，绝不能随安装包分发。
# - 不打 config.json：NexoraCode 根目录下不存在该文件，运行时读的是 data/config.json。
# - vendor 只打 ui/static/vendor 自带副本（与 ChatDBServer/static/vendor 内容一致），
#   不再跨项目引用 ..\ChatDBServer，打包环境无该目录会导致构建失败。
datas = [('asset_manifest.json', '.'), ('ui', 'ui')]
binaries = []
hiddenimports = ['webview.platforms.winforms', 'webview.platforms.edgechromium', 'local.tools.ShellTool', 'local.tools.FileTool', 'local.tools.BrowserCore', 'local.tools.BrowserTool', 'local.tools.ImageSearchTool', 'tools.imgspd', 'tools.imgspd.bing', 'tools.imgspd.bing_common', 'tools.imgspd.crawlee_bing', 'tools.imgspd.mediawiki', 'tools.imgspd.models', 'tools.imgspd.anti_spider']
tmp_ret = collect_all('webview')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # 构建机为通用 Python 环境，这些包与 NexoraCode 无关，
        # 不排除会让 PyInstaller 顺着依赖图分析 torch/sklearn 等，构建耗时数小时且产物巨大。
        'torch', 'sklearn', 'scipy', 'numpy', 'pandas', 'matplotlib',
        'PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'wx',
        'kivy', 'kivymd', 'pygame',
        'IPython', 'jupyter', 'notebook', 'nbformat',
        'pytest', 'astroid', 'jedi', 'parso', 'pylint',
        'zmq', 'tkinter',
        # 注意：不要排除 playwright / crawlee。
        # local/tools/__init__.py 只是注释了 ImageSearchTool 的实例注册，
        # 但顶部 `from .ImageSearchTool import ImageSearchTool` 仍在，
        # 导入链会走到 tools/imgspd/bing.py 的顶层 `import playwright`；
        # 排除后 exe 启动即 ModuleNotFoundError。
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='NexoraCode',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['ui\\static\\img\\icon.png'],
)
