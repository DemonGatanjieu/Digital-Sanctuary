# EmbeddingGemma 2 离线运行准备

## 来源与本机文件

采用官方 [`google/embeddinggemma-2`](https://huggingface.co/google/embeddinggemma-2/blob/914f7f89142e33e77833254d9c9b90c3cef7303b/README.md)，Apache-2.0，固定 revision `914f7f89142e33e77833254d9c9b90c3cef7303b`。完整 15 文件约 1.53 GB，下载后按官方 LFS SHA-256 / Git blob 指纹验证，再记录本机清单。模型在 `models/embeddinggemma-2`，基础解释器在 `runtime-data/semantic-python`；均不提交 Git。

Python 3.12.14 的独立 CPU / CUDA 环境与精确锁定依赖见 [`services/semantic`](../../services/semantic/README.md)。不修改现有 WD 环境。推理强制离线、本地文件且禁用远程代码，只启用文字和图像编码器，438,760,448 参数，输出 768 维。CPU float32；支持时 GPU bfloat16，按官方要求不使用 float16。

## 验证范围

`scripts/smoke-semantic.py` 校验全部文件，生成三张 384×384 合成图（草地晴天、月夜、红方块），分别使用对应中文描述检索。检查维度、有限值、单位向量、不同图片响应，以及三条中文查询的首位匹配。

CPU 最终离线复验：模型加载 5,179 ms，三张图片 31,597 ms，三条中文查询 517 ms；三个首位匹配均正确。较早一次图片编码为 22,446 ms，最终复验与导航检查并行，说明系统负载会影响 CPU 耗时；这些小样本记录不是批量图库吞吐率。

GPU 实测通过：RTX 4050 Laptop，6,141 MiB 显存，驱动 617.42；bfloat16 加载 6,159 ms，三张图片 1,383 ms，三条中文查询 377 ms，三个首位匹配均正确。PyTorch 峰值分配显存约 940 MiB（不含驱动、CUDA 上下文等全部显存开销）。后续索引优先评估 GPU，稳定吞吐与实际图库质量另行验证。

两环境均使用 Transformers 5.19.0、SentenceTransformers 6.1.0；PyTorch 分别为 2.14.1+cpu / 2.14.1+cu130。原始本机结果位于 `.tmp/semantic-smoke/cpu-final.json`、`.tmp/semantic-smoke/gpu.json`，后者运行时明确断网模式且禁用远程代码，不依赖线上服务。

这些合成图仅证明本机图文链路可运行，不构成二次元画面细节、角色身份、否定条件等实际检索质量的评估。模型尚未接入应用搜索、模型中心或文件夹整理；不包含在现有 0.1.2 安装包内。后续应先落实文件夹先分析后入库、选择入库/复制导出，再接入自然语言检索。明确元素筛选继续使用 WD，不需要为此额外下载大型聊天模型。

参考：[Google 模型卡](https://ai.google.dev/gemma/docs/embeddinggemma/model_card_2)、[SentenceTransformer 参数](https://sbert.net/docs/package_reference/sentence_transformer/model.html)。
