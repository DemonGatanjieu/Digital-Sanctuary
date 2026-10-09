# EmbeddingGemma 2 本地找图运行时

图库搜索框的“按画面”和整理页的描述找图，都用它按画面内容排序。独立 CPU 进程按需加载，闲置 60 秒释放；WD 仍负责明确元素和探索保护。

- 官方模型：[`google/embeddinggemma-2`](https://huggingface.co/google/embeddinggemma-2/tree/914f7f89142e33e77833254d9c9b90c3cef7303b)，Apache-2.0，约 7.4 亿参数；应用只加载文字和图像编码器（438,760,448 参数）。
- 固定 revision：`914f7f89142e33e77833254d9c9b90c3cef7303b`，15 个文件约 1.53 GB。

## 用户怎么装（安装包不含）

“设置 → 模型管理 → 按画面找图 → 下载到本机”。模型中心下载两样东西，逐个文件核对大小和 SHA-256，全部通过后才启用：

1. 上面的 15 个官方文件，直接从 Hugging Face 固定 revision 下载；
2. 找图运行包 `sanctuary-semantic-runtime-1.zip`（约 251 MB，解压约 1.9 GB），从项目的 GitHub Release 下载。

安装位置是 `%LOCALAPPDATA%\digital-sanctuary\models\embeddinggemma-2`。下载走 Electron 网络栈，跟随系统代理；中断后重试，已校验的文件不会重下。

## 发布新的运行包

运行包是 `server.py` 用 PyInstaller 冻结的独立程序，不需要用户装 Python。

```powershell
uv pip install --python .venv-semantic/Scripts/python.exe -r services/semantic/requirements-build.txt
npm.cmd run build:semantic-bundle     # 冻结并打包，最后一行输出 size 和 sha256
npm.cmd run smoke:semantic-bundle     # 直接运行冻结程序，检查向量和排序
npm.cmd run smoke:semantic-install    # 打包后的应用里走一遍下载、校验、解压和找图（不联网）
```

transformers 按名字动态加载模型类，PyInstaller 看不到。`build_bundle.py` 先真实加载一次模型，记录实际导入的模块，再把它们作为隐藏导入冻结。torchvision 的算子库按路径加载，需要单独收集。

内容变了就换文件名（`-2.zip`），把新的大小和 SHA-256 写进 `apps/desktop/src/main/model-center/catalog.ts`，再上传到同名 Release 资源。已发布的文件不要原地替换，旧版本应用仍按旧哈希下载。

## 开发环境

开发时没有安装运行包，也会退回使用项目自己的 `.venv-semantic` 和 `models/embeddinggemma-2`。

- Python 3.12.14 基础解释器在 `runtime-data/semantic-python`。
- CPU 环境在 `.venv-semantic`；依赖精确版本见 `requirements.lock.txt`。
- CUDA 13.0 环境在 `.venv-semantic-gpu`；精确版本见 `requirements-gpu.lock.txt`。范围与限制见[验收记录](../../docs/research/2026-10-08-embeddinggemma2-offline-runtime.md)。

以上模型、运行时、虚拟环境和测试图都不提交 Git。

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

关闭音频编码器。CPU 使用 float32 和最多四个线程；GPU 有原生支持时使用 bfloat16，不能使用 float16。结果转为 float32 并再次归一化再比较。明确指定 CUDA 的验收若不可用会报错，不静默退回 CPU。

合成图通过只证明运行库完整及图文链路可用，不能证明中文二次元细节、角色身份或否定条件检索准确。相似度不展示成识别正确率，也不代替 WD 的明确元素筛选。

## 应用内链路

`server.py` 校验固定快照后离线加载 CPU float32 编码器，最多四线程。标准输入/输出/错误明确使用 UTF-8，JSONL 输出 ASCII 转义，避免 Windows 中文查询编码失败。图片转 RGB，长边最多 1024px，超过 40MP 拒绝；文字最长 500 字。模型启动限 180 秒、每次请求限 90 秒，用户停止时终止进程，闲置 60 秒自动释放。

`userData/semantic-index.db` 缓存原图 SHA-256 与模型/预处理版本对应的 768 维单位向量，最多 10,000 条；原图或版本变化重新编码，不在缓存里保存路径。普通查找只加载图文模型；附加明确元素条件才同时复用 WD 队列。

真实应用链路验收（隔离图库、合成图片、原生选择框替身，实际模型/IPC/剪贴板）：

```powershell
npm.cmd run build
npm.cmd run smoke:image-workbench
```

先运行上面的独立探针生成 `.tmp/semantic-smoke` 三张测试图。烟测覆盖中文排序、内容索引复用、文件夹未自动入库、所选导入、同名原图复制、逐页入册及任务中心返航；不访问实际用户图库。结果与限制见[工作台验收](../../docs/reviews/2026-10-08-image-workbench.md)。

## 重建环境

项目已准备基础解释器，使用 uv 创建新环境后安装锁定依赖：

```powershell
uv venv --python runtime-data/semantic-python/python.exe --no-python-downloads .venv-semantic --cache-dir .tmp/uv-cache
uv pip install --python .venv-semantic/Scripts/python.exe --cache-dir .tmp/uv-cache --torch-backend cpu --link-mode copy -r services/semantic/requirements.lock.txt
```

GPU 对应 `.venv-semantic-gpu`、`--torch-backend cu130` 及 `requirements-gpu.lock.txt`。只在需要重建时执行；联网安装与已安装环境的离线推理是两回事。Windows 设备/驱动不支持时保留 CPU 基线。若更换磁盘或项目路径，重新创建虚拟环境以修正解释器路径，不直接搬运旧 venv。基础解释器、已安装环境及模型是离线运行必需文件。

参考：[官方模型最佳实践](https://huggingface.co/google/embeddinggemma-2/blob/914f7f89142e33e77833254d9c9b90c3cef7303b/README.md)、[SentenceTransformer 参数文档](https://sbert.net/docs/package_reference/sentence_transformer/model.html)。
