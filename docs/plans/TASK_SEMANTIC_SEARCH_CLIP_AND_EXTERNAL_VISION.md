# 任务书：本地 CLIP / 多模态向量语义搜索架构与外接检索演进方案

## 1. 任务背景与边界界定

在 **AI 视觉多维雷达图与外部大模型评估体系**（参见 `TASK_AI_RADAR_AND_EXTERNAL_VISION_IMPLEMENTATION_PLAN.md`）落地之后，应用已具备：
1. 本地确定性统计特征画像（Pillow/NumPy 6 维技术指标）；
2. 外部多模态大模型（OpenAI / 通义千问 / Gemini / Claude）在显式任务下的多维艺术/角色主观评价雷达。

本任务书专门负责第二阶段的核心检索能力演进：**跨模态自然语言搜索、以图搜图（Visual Similarity Search）与混合召回检索架构**。

---

## 2. 为什么将“视觉评估”与“语义搜索”严格拆分？

| 维度 | 视觉特征/雷达评估 (Evaluation & Radar) | 向量语义搜索 (Vector Semantic Search) |
|---|---|---|
| **核心产物** | 可解释的离散标量维度分值（0~100）及文本赏析 | 高维浮点向量密排数组（512/768 维 `Float32Array`） |
| **存储方式** | SQLite 标量列与数值索引（支持 B-Tree 范围检索） | 向量索引（如 SQLite-vec / HNSW / 内存余弦相似度） |
| **主要用途** | 详情展示、雷达多边形、筛选高色彩/高对比画作 | 自然语言模糊意图匹配（如“雨夜霓虹赛博朋克”）与相似图推荐 |
| **外部模型角色** | 作为评判者（Critic）逐张深度评析 | 作为 Query 扩写或重排器（Reranker），而非底库向量提取源 |

---

## 3. 技术方案设计

### 3.1 本地 Embedding 引擎（默认优先，零网络依赖）
1. **模型选型**：
   - 优先集成 `ViT-B/32` 或 `MobileCLIP-B` ONNX 权重；
   - 通过 Python sidecar 或 ONNX Runtime Node 运行，产出 512 维 L2 归一化向量；
2. **向量缓存与存储**：
   - 表 `asset_embeddings`：`(asset_id, model_name, embedding_blob, updated_at)`；
   - 配合 SQLite 或内存线性扫描（支持 10 万张秒级 Top-K 召回）。

### 3.2 外部大模型结合点
1. **自然语言搜索意图解析与 Query 扩写**：
   - 用户输入中文复合短语时，由外部 LLM 扩写为更贴合 CLIP 词表的 English Prompts；
2. **候选集重排 (Cross-Encoder / LLM Reranker)**：
   - 向量粗筛返回 Top-50 后，可按需由大模型结合雷达特征做最终精选重排。

---

## 4. 实施里程碑

- **Milestone 1**: 本地 ONNX CLIP 提取器与测试 Fixture 向量化。
- **Milestone 2**: SQLite 向量存储与余弦距离 Top-K 召回检索算子。
- **Milestone 3**: 搜索栏自然语言搜索模式与多条件混合过滤（文本 + 雷达数值区间）。
- **Milestone 4**: 以图搜图相似推荐抽屉。
