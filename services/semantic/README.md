# EmbeddingGemma 2 本机运行准备

这是独立的实验运行环境，尚未接入应用搜索栏、模型中心或文件夹整理入口。WD 子进程、现有探索保护与安装包保持原运行路径。

- 官方模型：[`google/embeddinggemma-2`](https://huggingface.co/google/embeddinggemma-2/tree/914f7f89142e33e77833254d9c9b90c3cef7303b)，Apache-2.0。
- 固定 revision：`914f7f89142e33e77833254d9c9b90c3cef7303b`。
- 完整 15 文件约 1.53 GB；保留原始子目录，权重、分词器、配置与预处理器都已准备。
- Python 3.12.14 基础解释器在 `runtime-data/semantic-python`，不依赖临时下载目录或系统 Python。
- CPU 环境在 `.venv-semantic`；依赖精确版本见 `requirements.lock.txt`。
- CUDA 13.0 环境在 `.venv-semantic-gpu`；精确版本见 `requirements-gpu.lock.txt`。RTX 4050 Laptop 离线实测通过，三张测试图编码 1,383 ms，PyTorch 峰值分配显存约 940 MiB；范围与限制见[验收记录](../../docs/research/2026-10-08-embeddinggemma2-offline-runtime.md)。

以上模型、运行时、虚拟环境和测试图均被忽略，不提交 Git；不打进既有 0.1.2 安装器，也不自动分析用户图库。

## 固定快照下载

```powershell
./scripts/prepare-embeddinggemma.ps1
```

脚本需要 PowerShell 7.2 或更新版本，只访问上述固定官方仓库。检查完整文件清单与 revision，流式下载到 `.part`，支持续传，检查精确大小；LFS 文件使用仓库 SHA-256，小配置使用 Git blob 指纹。校验通过再改为正式文件名，写入本机 `sanctuary.manifest.json`。已有正式文件先校验，不覆盖不同内容。若断网、文件不全或校验失败，保留现场并报错。

## 已准备本机环境的离线验证

```powershell
./.venv-semantic/Scripts/python.exe -u scripts/smoke-semantic.py --device cpu
./.venv-semantic-gpu/Scripts/python.exe -u scripts/smoke-semantic.py --device cuda --output .tmp/semantic-smoke/gpu.json
```

验证脚本强制 `HF_HUB_OFFLINE=1`、`TRANSFORMERS_OFFLINE=1`、关闭遥测，使用本地目录、`local_files_only=True`、`trust_remote_code=False`。仅创建三张合成测试图，校验快照后产生图片与中文查询的 768 维向量，验证有限值、单位范数与不同图像响应，记录相似度、耗时和设备；不会打开用户图库。

仅加载文字和图像编码器（438,760,448 参数），关闭音频编码器。CPU 使用 float32 和最多四个线程；GPU 有原生支持时使用 bfloat16，不能使用 float16。结果转为 float32 并再次归一化再比较。明确指定 CUDA 的验收若不可用会报错，不静默退回 CPU。

合成图通过只证明运行库完整及图文链路可用，不能证明中文二次元细节、角色身份或否定条件检索准确。相似度不展示成识别正确率，也不代替 WD 的明确元素筛选。

## 重建环境

项目已准备基础解释器，使用 uv 创建新环境后安装锁定依赖：

```powershell
uv venv --python runtime-data/semantic-python/python.exe --no-python-downloads .venv-semantic --cache-dir .tmp/uv-cache
uv pip install --python .venv-semantic/Scripts/python.exe --cache-dir .tmp/uv-cache --torch-backend cpu --link-mode copy -r services/semantic/requirements.lock.txt
```

GPU 对应 `.venv-semantic-gpu`、`--torch-backend cu130` 及 `requirements-gpu.lock.txt`。只在需要重建时执行；联网安装与已安装环境的离线推理是两回事。Windows 设备/驱动不支持时保留 CPU 基线。若更换磁盘或项目路径，重新创建虚拟环境以修正解释器路径，不直接搬运旧 venv。基础解释器、已安装环境及模型是离线运行必需文件。

参考：[官方模型最佳实践](https://huggingface.co/google/embeddinggemma-2/blob/914f7f89142e33e77833254d9c9b90c3cef7303b/README.md)、[SentenceTransformer 参数文档](https://sbert.net/docs/package_reference/sentence_transformer/model.html)。
