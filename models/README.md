# 本地模型

模型权重不进入版本控制。当前开发基线：

- 模型：`SmilingWolf/wd-swinv2-tagger-v3`
- 来源：<https://huggingface.co/SmilingWolf/wd-swinv2-tagger-v3>
- 许可证：Apache-2.0
- 文件：`wd-swinv2-tagger-v3/model.onnx`
- 标签：`wd-swinv2-tagger-v3/selected_tags.csv`
- ONNX SHA-256：`E6774BFF34D43BD49F75A47DB4EF217DCE701C9847B546523EB85FF6DBBA1DB1`
- 标签数量：10,861（一般标签 8,106；角色标签 2,751；rating 标签 4）

应用只输出一般标签，不使用 rating 标签进行过滤。

## 语义检索实验模型（2026-10-08）

用户明确要求联网准备的官方 `google/embeddinggemma-2` 已完整下载到 `models/embeddinggemma-2/`，固定 revision 为 `914f7f89142e33e77833254d9c9b90c3cef7303b`，约 1.53 GB。下载校验与离线 CPU/GPU 环境说明见 [`services/semantic/README.md`](../services/semantic/README.md)。它尚未进入应用模型目录或搜索 UI，不替代 WD，也不随 0.1.2 安装包分发。
