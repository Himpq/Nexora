# ADDW-T2 驾驶员分心时刻智能检测系统核查

日期：2026-10-16。仅查看公开仓库和公开 Gallery 接口，未执行代码、未安装依赖、未下载 LFS 权重。

- Gallery：https://gallery.developer.huaweicloud.com/gallery/0062648276400000
- 详情接口：https://gallery.developer.huaweicloud.com/open-web-guest/v1/gallery/works/0062648276400000
- 仓库：https://gitcode.com/gcw_qUwR89DO/ADDW-T2
- 分支：main
- 提交：0d3e72b238a2892f8c2b86172756d1d445704a45
- Gallery 返回学校为上海理工大学，栏目为“码道高校教学合作计划（上海理工大学）”。

## 判断

该项目具有真实模型推理代码、训练代码与时序判定算法，不是只有界面或静态数据展示。属于专业场景明确、算法证据较完整的对手。使用第三方 VideoMAE 预训练模型微调，再结合滑窗与连续性规则定位分心起始时间 T2。

## 关键源码证据

1. 视频推理：code/infer_core.py 的 iter_video_windows 使用 OpenCV 解码抽帧；predict_batch 把帧转换为张量，实际调用 VideoMAEForVideoClassification 并对 logits 做 softmax 取分心概率。VideoMAEEngine.load 从本地模型目录加载处理器和权重。
2. 时序定位：同文件 detect 把窗口概率转换为连续阳性区间。默认 1 秒窗口、0.25 秒步长、16 帧，概率阈值 0.86，要求连续 11 窗口，T2 加 0.25 秒偏移。视频尾部截断时输出候选及额外信息。
3. 人工复核：code/confidence.py 的 compute_confidence 按区间概率均值、波动、长度、检测类型和多段惩罚计算路由分数；code/app.py 的 run_task 实际调用 engine.infer，再据分数和用户阈值决定是否需要人工复核。
4. 训练：addw_t2_project/scripts/train_videomae.py 定义 Dataset 与 DataLoader、模型初始化、AdamW、学习率调度；run_train_epoch 实现前向损失、反向传播、梯度累积和裁剪、优化器更新；另有验证与模型保存流程。
5. 数据划分：addw_t2_project/scripts/make_split.py 按 dataset、driver 分组划分 train/val/test，并检查同一驾驶员不跨集合。缺少私有原始清单，无法独立核实实际划分结果。
6. 辅助算法链：仓库包含窗口评分、校准 T2、固定参数评估、尾部结果处理、失败概率分析等脚本。

源码链接：

- https://gitcode.com/gcw_qUwR89DO/ADDW-T2/blob/main/code/infer_core.py
- https://gitcode.com/gcw_qUwR89DO/ADDW-T2/blob/main/code/confidence.py
- https://gitcode.com/gcw_qUwR89DO/ADDW-T2/blob/main/code/app.py
- https://gitcode.com/gcw_qUwR89DO/ADDW-T2/blob/main/addw_t2_project/scripts/train_videomae.py
- https://gitcode.com/gcw_qUwR89DO/ADDW-T2/blob/main/addw_t2_project/scripts/make_split.py

## 完成度与指标证据

- 前端为原生 HTML/CSS/JavaScript，后端为 FastAPI，推理使用 PyTorch、Transformers、OpenCV，提供安装启动脚本和 Dockerfile。
- 模型文件 model.safetensors 是 Git LFS 指针，声明对象大小为 344,937,328 字节。此次只确认指针存在，未下载和加载权重。
- training_summary.json 记录训练完成、3 轮、约 1917 秒、最佳验证 F1 0.9560。
- best_model/metrics.json 记录训练 2682 个片段、验证 356 个片段，验证混淆矩阵 tn=166、fp=12、fn=4、tp=174，与 F1 约 0.956 一致。这是仓库提交的实验结果，未独立复现。
- README 另宣称 166 个验证事件全部检出、T2 MAE 0.227 秒；本次文件列表未见逐视频预测、原始标签或完整误差报告，因此只能标为作者报告的事件级指标。
- docs/测试报告.md 宣称 11 项置信度测试通过；此次未运行。测试目录主要覆盖路由分数和复核规则，不能代替视频模型性能验证。
- Gallery 未提供在线体验地址。README 链接到 media/demo.mp4，但该文件不在本次公开 main 文件列表中，演示材料链接需要进一步核验。

## 与 NexoraApp 的竞争点

业务与 NexoraApp 重合较少，竞争主要在评审对技术深度、专业场景价值和成果可验证性的判断。该项目的突出点是清晰的检测工作流程、实际训练与推理链、具体量化结果；NexoraApp 应以已有跨端体验和完整用户流程形成展示优势。
