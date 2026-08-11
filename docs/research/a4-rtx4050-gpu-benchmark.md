# A4：RTX 4050 ONNX Runtime GPU 基准

- 日期：2026-08-11
- 硬件：NVIDIA GeForce RTX 4050 Laptop GPU，6 GB 显存
- 驱动：610.88
- Python：3.14.6
- ONNX Runtime：`onnxruntime-gpu==1.28.0`
- CUDA 运行库：CUDA 13 / cuDNN 9，通过 Python wheel 安装在 `.venv-gpu`

## 隔离策略

- 原 `.venv` 与 `onnxruntime==1.28.0` CPU 环境保持不变。
- 新建 `.venv-gpu`，只用于 CUDA 试验与开发环境运行。
- GPU 环境已加入 `.gitignore`，不会进入仓库。
- `engine.py` 通过 `SANCTUARY_ONNX_PROVIDER=cuda` 请求 CUDA；初始化失败时记录错误并回退 `CPUExecutionProvider`。

## Provider 自检

```text
device=GPU
providers=['TensorrtExecutionProvider', 'CUDAExecutionProvider', 'CPUExecutionProvider']
actual=CUDAExecutionProvider
```

## 基准方法

- 同一个 `wd-swinv2-tagger-v3/model.onnx`。
- 同一份固定随机种子的 NHWC float32 输入。
- CPU 与 CUDA 各预热 2 次、正式运行 10 次。
- 基准脚本：`services/vision/python/benchmark_providers.py`。

| Provider | 最低 | 中位数 | P95 | 最高 |
|---|---:|---:|---:|---:|
| CPU | 455.61 ms | 463.48 ms | 508.86 ms | 508.86 ms |
| CUDA | 69.14 ms | 71.85 ms | 82.03 ms | 82.03 ms |

- 中位数加速：**6.45 倍**。
- CPU/CUDA 最大输出绝对差异：`0.0008057`。
- 平均输出绝对差异：`0.00000360`。

## 决策

- 开发环境检测到 `.venv-gpu` 时优先使用 CUDA，并保留 CPU 回退。
- 当前保持远程审查单并发；约 72 ms 的单图推理已足以先验证真实滚动体验，不盲目增加 3–4 路并发。
- 界面显示配置 provider；完成首次分类后 `VisionClient` 会记录 Python 返回的实际 provider。
- CPU 与 CUDA 继续共用模型版本缓存命名空间：模型、预处理和规则完全一致，现有 CPU 缓存无需作废；极端接近阈值的数值差异作为后续边界样本问题记录。

## 运行确认

- 最终构建重启后，视觉子进程路径为 `E:\PIxiv\.venv-gpu\Scripts\python.exe`。
- 正式 `WdTaggerVisionEngine` 实例返回 `CUDAExecutionProvider`。
- 该 Python 进程出现在 `nvidia-smi` 的 GPU 计算进程列表中。
