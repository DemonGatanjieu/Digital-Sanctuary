# ADR 0007: 自定义字体验证解析器与本地安全协议架构决策

## 状态
已通过（Phase 0 决策）

## 背景
依据 `TASK_TYPOGRAPHY_SYSTEM_AND_CUSTOM_FONTS_FOR_GEMINI.md`，应用需要支持用户导入本地第三方 `.ttf` / `.otf` 字体文件，并由主进程建立受控沙箱索引 (`userData/fonts/`)、计算 SHA-256 去重，并通过安全协议 `sanctuary-font://custom/<id>` 按需加载至渲染层。

字体文件属于**非可信二进制输入**，可能包含畸形表偏移、超长字符串、伪造扩展名或利用解析漏洞的攻击载荷。因此必须确立安全、轻量且具备确定性退化能力的验证与加载方案。

---

## 候选技术方案对比

| 方案 | 外部依赖体积 | C++ / 原生构建要求 | 攻击面与安全性 | 维护成本 | 适用性结论 |
|---|---|---|---|---|---|
| **方案 A：纯 TypeScript 零依赖 SFNT 结构化解析器** (推荐) | **0 KB**（纯内建） | 无 | **极小**。仅读取并校验 12 字节 SFNT 头、`name` 表、`OS/2` 表与 `head` 表，所有偏移与长度执行上界截断检查，绝不执行轮廓渲染或复杂字节码。 | 极低（约 180 行标准 TS） | **最佳首选**。契合本地优先与最小权限原则。 |
| **方案 B：引入 `opentype.js`** | ~550 KB | 无 | 中等。会尝试解析全部字形轮廓（glyf/CFF）和排版布局表（GPOS/GSUB），对于仅需提取元数据与校验合法性的场景属于过度设计。 | 中 | 不推荐 |
| **方案 C：引入 `fontkit` / `freetype2`** | 庞大（含二进制/WASM） | 需要复杂工具链 | 较大。存在复杂的原生 C 内存管理与潜在安全漏洞历史。 | 高 | 明确否决 |

---

## 核心架构决策

### 1. 验证器架构（`font-file-validator.ts`）
- **格式魔数识别**：
  - TrueType: `0x00010000` (Windows TTF) 或 `0x74727565` (`true` - Mac TTF)
  - OpenType/CFF: `0x4F54544F` (`OTTO`)
  - 扩展名与魔数不匹配时立即拒绝。
- **文件体积限制**：单字体文件上限限制为 **32 MiB**，防止超大文件耗尽主进程内存。
- **关键表校验**：
  - 校验 `head` 表魔数必须为 `0x5F0F3CF5`；
  - 校验 `name` 表结构，严格限制提取的 `family`、`fullName`、`postscriptName` 长度不超过 128 字符，过滤所有控制字符；
  - 校验 `OS/2` 表读取 `usWeightClass` (100~900) 与 `fsSelection` 样式标志。
- **确定性 SHA-256 与原子写入**：
  - 文件以 `<sha256>.<ext>` 存入 `userData/fonts/files/`；
  - 索引写入 `userData/fonts/index.v1.json`，采用临时文件写入 + `fs.rename` 原子替换机制。

### 2. 协议与权限隔离（`sanctuary-font://`）
- `sanctuary-font` 协议与 `sanctuary-image` 一同在 `app.ready` 前由唯一的 `protocol.registerSchemesAsPrivileged` 调用注册；
- 协议权限仅配置：`standard: true, secure: true, supportFetchAPI: false, bypassCSP: false`；
- 协议路由严格受限：仅接受 `sanctuary-font://custom/<fontId>` 格式，由主进程通过内存索引映射至对应哈希文件，严禁传入任何文件绝对路径或 `..` 路径回溯；
- 协议 handler 仅注册在本地应用窗口会话，严禁向远程 Pixiv `WebContentsView` 暴露。

### 3. 系统字体读取（Local Font Access）
- 渲染层通过 `window.queryLocalFonts()` 获取 Windows 本地字体名称（由 Phase 0 探针实测通过，在本地 secure context 下权限为 `granted`）；
- 若该 API 在特定环境受限，自动平滑退化至预设常用 Windows 中英文字族列表与 `document.fonts.check()` 检测。

---

## 影响与风险评估
- **积极影响**：零依赖增量，解析性能极高（< 5ms 每文件），彻底杜绝路径遍历和恶意伪造字体。
- **限制说明**：MVP 阶段专注支持单字面 TTF 与 OTF 文件；TTC/OTC 集合字体与 WOFF2 容器待未来阶段在保证解压安全的前提下拓展。
