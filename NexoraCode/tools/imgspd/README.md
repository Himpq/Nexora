# imgspd

`imgspd` 是 NexoraCode 的独立本地搜图模块，目前不接入 Nexora 主流程。

## Bing 图片搜索

```powershell
python -m NexoraCode.tools.imgspd bing 静冈 --limit 10 --proxy http://127.0.0.1:15555
```

常用测试参数：

```powershell
python -m NexoraCode.tools.imgspd bing Shizuoka --limit 5 --proxy http://127.0.0.1:15555 --headless --no-pause-on-anti-spider
```

## Python Crawlee Bing 图片搜索

```powershell
python -m NexoraCode.tools.imgspd bing-crawlee Osaka --limit 5 --proxy http://127.0.0.1:15555 --headless
```

## Wikimedia Commons 图片搜索

```powershell
python -m NexoraCode.tools.imgspd commons Shizuoka --limit 10 --proxy http://127.0.0.1:15555
```

## 输出字段

- `image_url`: 原图地址
- `thumbnail_url`: 缩略图地址
- `source_url`: 图片来源页面
- `page_url`: 搜索引擎详情页或 Commons 文件页
- `license`: Commons 许可证
- `author`: Commons 作者
- `anti_spider`: 搜索页面的人机验证检测状态
