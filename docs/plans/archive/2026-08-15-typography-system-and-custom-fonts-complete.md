# 排版系统与自定义字体实施规划（Gemini 执行版）

> 归档状态：已完成。下文“待实施”是施工当时的原文，不再表示待办。验收见 `docs/reviews/typography/`。

> 状态：待实施  
> 评审日期：2026-08-15  
> 需求来源：`docs/plans/archive/2026-08-15-typography-system-implementation-plan.md`  
> 适用平台：Windows 优先，保留跨平台退化路径  
> 执行原则：按阶段实施；一阶段、一验证、一提交；本文件与来源计划冲突时以本文件为准。

## 0. 给 Gemini 的第一条指令

请先完整阅读本文件、来源计划、`ARCHITECTURE.md`、`docs/design/DATA_AND_ARCHITECTURE_V2.md`、现有主题实现与 2026-08-15 视觉审计报告。

第一轮只执行 **Phase 0：探针、契约与风险验证**。完成后运行 `npm.cmd run verify`，提交 Phase 0 的代码和研究记录，然后停止等待用户确认。不要提前实现字体导入 UI，不要批量替换全项目 CSS，不要下载或提交任何未审核授权的字体文件。

---

## 1. 评估结论

方向成立，但来源计划不能直接整包实施。四槽位排版、自定义字体导入、系统字体选择和多主题回归都符合产品需要；原稿中以下假设必须修正：

1. **深色主题不能统一把字重加 50～80。** 字体未必提供对应字重，当前全局又有 `font-synthesis: none`；强行加重会改变换行、卡片高度和视觉层级，也可能让黑体糊成一片。
2. **`-webkit-font-smoothing: antialiased` 不是可靠的“清晰度增强引擎”。** 不同 Windows/Chromium 环境的效果不可承诺，有时反而让浅色文字更细。可读性应通过颜色对比、实际可用字重、字号、行高和受控阴影解决。
3. **只校验 `.ttf/.otf/.woff2` 扩展名不安全。** 必须校验文件大小、魔数、容器和可解析元数据；损坏或伪装文件不得进入字体库。
4. **Renderer 不得收到字体磁盘路径。** `FontDescriptor.filePath` 会破坏当前“Renderer 只拿受控 ID”的边界。
5. **系统字体枚举是具有隐私含义的能力。** Chromium 的 `queryLocalFonts()` 需要安全上下文、用户手势和 `local-fonts` 权限，不能假定 Electron 中永远可用。
6. **不能把字体 IPC 写进 `packages/protocol`。** 该包当前服务于独立 Python 视觉 JSONL 协议，不是 Electron IPC 注册中心。
7. **不能为了加载字体绕过 CSP。** `sanctuary-font` 必须是最小权限协议，不能启用 `bypassCSP`、`webSecurity: false` 或把本地文件路径拼进 URL。
8. **“内置高品质字体”需要许可和体积审核。** 禁止运行时下载 Google Fonts；禁止把 Windows/商业字体随安装包再分发；任何随包字体都必须携带许可文本和第三方声明。
9. **字体设置不能被主题切换静默覆盖。** 主题负责色彩与氛围，用户排版选择拥有最终优先级。

因此本任务有条件通过，实施拆成：

- 语义排版 token；
- 安全的自定义字体沙箱；
- 可退化的系统字体选择；
- 设置预览与显式应用；
- 全产品迁移和视觉回归。

---

## 2. 产品边界与非目标

### 2.1 本期目标

- 四个语义字体槽位：正文、展示标题、画册题记、等宽数据；
- 统一字号、行高、字重、字距 token，减少散落的硬编码；
- 支持安全导入用户拥有的 TTF/OTF，验证通过后再决定是否开放 WOFF2；
- 支持选择系统字体，API 不可用时有明确退化方案；
- 四套主题和三种显示档位下保持可读；
- 缺字、文件丢失、字体损坏或删除时稳定回退；
- 不联网、不上传、不自动下载字体。

### 2.2 非目标

- 不实现在线字体商店；
- 不让社区主题包携带任意字体二进制；
- 不提供字体编辑、转换、子集化或授权破解；
- 不自动扫描用户磁盘上的字体文件；
- 不把用户字体应用到远程 Pixiv `WebContentsView`；
- 不承诺任何字体对全部 Unicode 字符都零 tofu；
- 不为了排版任务重写主题商店、3D 画册、灯箱或设置页导航。

---

## 3. 语义排版体系

### 3.1 四个字体槽位

```ts
export type TypographySlot = 'body' | 'display' | 'editorial' | 'mono';
```

| 槽位 | CSS token | 用途 | 默认方向 |
| --- | --- | --- | --- |
| body | `--ds-font-body` | 侧栏、按钮、表单、卡片、说明 | 高可读系统无衬线 |
| display | `--ds-font-display` | 页面标题、Hero、品牌标题 | 有辨识度但必须支持中日韩回退 |
| editorial | `--ds-font-editorial` | 画册题记、卷首语、章节标题 | 人文衬线/楷宋方向 |
| mono | `--ds-font-mono` | ID、尺寸、哈希、队列与状态数据 | 等宽 |

来源计划中的 `serif` 改名为 `editorial`，因为它描述的是产品语义，不应强制所有语言都使用西文 serif。

### 3.2 字体之外的排版 token

只做字体 family 不足以解决可读性。建议增加：

```css
:root {
  --ds-font-body: "Segoe UI Variable Text", "Microsoft YaHei UI", sans-serif;
  --ds-font-display: var(--ds-font-body);
  --ds-font-editorial: "Songti SC", "SimSun", serif;
  --ds-font-mono: "Cascadia Mono", "Consolas", monospace;

  --ds-weight-regular: 400;
  --ds-weight-medium: 550;
  --ds-weight-semibold: 650;
  --ds-weight-bold: 750;

  --ds-leading-tight: 1.2;
  --ds-leading-body: 1.55;
  --ds-leading-relaxed: 1.75;

  --ds-tracking-tight: -0.015em;
  --ds-tracking-normal: 0;
  --ds-tracking-label: 0.06em;

  --ds-text-shadow-on-image: 0 1px 3px rgba(0, 0, 0, 0.42);
}
```

最终默认栈要在当前 Windows 环境实测。不要继续把 `PingFang SC` 放在 Windows 默认栈首位；它通常不存在，会造成无意义匹配。emoji 需要单独保留 `"Segoe UI Emoji"` 回退。

### 3.3 字重和暗色主题规则

- 不进行 JS 动态“字重 +N”；
- 不对所有文字统一 text-shadow；
- 主题可覆盖语义颜色和 `--ds-text-shadow-on-image`，但不能替换用户字体槽位；
- 复杂图片背景上的标题使用专用遮罩/阴影 token；普通纯色表面优先用足够对比度，不加 glow；
- 字重只使用当前字体实际支持或浏览器可靠映射的值；
- 如果自定义字体只有 Regular，则 UI 明确显示“仅常规字重”，不要假装存在 Bold；
- `font-optical-sizing: auto` 仅在变量字体确实支持时生效；不得作为清晰度保证。

### 3.4 样式优先级

必须固定为：

```text
基础 token
  < 当前主题 CSS（色彩/氛围）
  < 用户排版 override（四槽位）
  < 局部可访问性状态（焦点/错误/高对比）
```

`#ds-typography-override` 应插在主题动态 style 之后。切换主题不得改变用户字体选择；主题卸载也不得留下失效字体引用。

---

## 4. 数据模型与持久化

### 4.1 不扩张 `AppearancePreferences`

字体偏好独立存储，避免当前严格解析的 `AppearancePreferences` 因字段升级产生兼容问题：

```ts
export interface TypographyPreferencesV1 {
  schemaVersion: 1;
  slots: Record<TypographySlot, TypographyFontRef>;
  previewText?: string;
}

export type TypographyFontRef =
  | { source: 'preset'; id: string }
  | { source: 'system'; postscriptName?: string; family: string }
  | { source: 'custom'; id: string };
```

数据库 preference key 建议为 `typography.v1`。偏好只存 ID、family 或 PostScript name，不存磁盘路径、不存 CSS 片段。

### 4.2 Renderer 可见描述符

```ts
export interface TypographyFontDescriptor {
  id: string;
  source: 'preset' | 'system' | 'custom';
  family: string;
  fullName: string;
  postscriptName?: string;
  style: 'normal' | 'italic' | 'oblique';
  weight?: number;
  variable: boolean;
  supportedSlots: TypographySlot[];
  status: 'available' | 'missing' | 'invalid';
}
```

禁止字段：`filePath`、注册表路径、原始二进制、用户目录和任意 CSS。

### 4.3 自定义字体索引

`userData/fonts/` 建议：

```text
fonts/
  index.v1.json
  files/
    <sha256>.<validated-extension>
```

- 文件名由内容哈希生成，避免路径注入和重名；
- index 使用临时文件 + 原子 rename；
- 导入同内容时返回已存在项；
- 索引损坏时可以从文件重新扫描或进入安全回退；
- 删除活动字体前先把引用它的槽位恢复默认，再删除索引与文件；
- 找不到文件时保留 `missing` 状态，UI 允许清理，不崩溃。

自定义字体目录当前不包含在 SQLite 单文件备份中。实施后必须更新备份说明：数据库恢复时若字体文件缺失，偏好安全回退；不要声称现有“创建数据库备份”已经备份字体。

---

## 5. 自定义字体导入安全

### 5.1 导入入口

Renderer 只调用 `importFontFromDialog()`。原生文件选择器和路径处理都在主进程，Renderer 不传任意路径。

### 5.2 MVP 支持矩阵

建议先支持：

- 单字面 TTF（sfnt `0x00010000` / `true`）；
- 单字面 OTF/CFF（sfnt `OTTO`）。

Phase 0 验证解析方案后再决定：

- WOFF2：只有选定解析器能够可靠解压/读取 name 表并通过实际 Chromium 加载测试时才开放；
- TTC/OTC：一个文件含多个 face，MVP 明确不支持；
- color font、bitmap-only font、variable font：可识别但先记录能力，不承诺所有轴和颜色表 UI。

不要为了满足原稿勾选项而假装所有扩展都已可靠支持。

### 5.3 校验流水线

```text
用户选择
  -> stat + 普通文件检查
  -> 大小限制（建议单文件 32 MiB）
  -> 扩展名与魔数一致
  -> 解析容器和 name/OS2/head 等必要表
  -> family/full name/PostScript name 清洗与长度限制
  -> 实际 FontFace 加载探针
  -> SHA-256 去重
  -> staging 写入
  -> 原子提交索引
```

解析方案必须在 Phase 0 做 ADR 级比较：优先选择维护活跃、能处理目标格式的专用库；如果新增依赖，要记录版本、许可证、安装体积和安全责任。不要手写一个只读 happy path 的半成品解析器后宣称安全。

异常信息对用户只显示稳定原因：格式不支持、文件过大、文件损坏、无法读取、重复导入。日志不得记录用户完整路径。

### 5.4 字体文件是非可信输入

- 保持 Electron 当前版本与 sandbox；
- 不在远程 Pixiv session 注册字体协议；
- 不把字体 bytes 发给 Renderer IPC；
- 不执行文件中的任何脚本或附带内容；
- 测试畸形表长度、越界 offset、超长名字和截断文件；
- 读取和解析必须有字节上限。

---

## 6. `sanctuary-font://` 协议

### 6.1 注册约束

项目现在已经在 `app.ready` 前调用一次 `protocol.registerSchemesAsPrivileged()` 注册 `sanctuary-image`。Electron 要求该方法在 ready 前调用且只能调用一次，因此必须把 `sanctuary-font` 加入**现有数组**，不能另起第二次调用。

建议最小 privileges：

```ts
{
  scheme: 'sanctuary-font',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true
  }
}
```

如实际 `FontFace`/CSS URL 不需要 `supportFetchAPI`，Phase 0 应验证后去掉。明确禁止 `bypassCSP: true`。

### 6.2 URL 与解析

```text
sanctuary-font://custom/<opaque-font-id>
```

- ID 必须经过固定格式 parser；
- 主进程从字体索引解析 ID 到受控路径；
- 路径必须验证仍位于 `userData/fonts/files/`；
- 返回正确 MIME、`X-Content-Type-Options: nosniff` 和本地缓存头；
- 不接受查询参数中的路径、盘符、`..`、百分号绕过或任意文件名；
- 未知/失效 ID 返回 404；
- handler 只注册在本地主窗口使用的 session，不注册到 `persist:pixiv`。

如果应用补充 CSP，需要明确允许 `font-src 'self' sanctuary-font:`，不能用关闭 CSP 代替。

---

## 7. 系统字体选择策略

### 7.1 首选路径：能力探针后的 Local Font Access

`window.queryLocalFonts()` 只能从用户明确点击“读取系统字体”触发。它要求权限并带有字体指纹隐私风险，因此 UI 必须解释：

> 仅在本机读取字体名称用于选择，不复制字体文件，不上传字体列表。

Electron 主进程只允许本地应用主窗口 origin 的 `local-fonts` 权限；远程 Pixiv `WebContentsView` 一律不得获得。

Phase 0 必须验证：

- 当前 `loadFile` 页面是否满足非 opaque 安全上下文要求；
- Electron 43 当前行为和 permission 名称；
- 拒绝权限、API 不存在、调用不在用户手势内的表现；
- 返回字段的 family、fullName、postscriptName、style；
- 中文本地化名称和重复字面的去重方式。

### 7.2 退化路径

若 Local Font Access 不可用或用户拒绝：

1. 提供经过验证的常见 Windows 字体预设；
2. 允许用户输入 family name，但只保存规范化文本；
3. 用 `document.fonts.check()` 给出“检测到 / 未检测到 / 无法确认”；
4. 始终允许恢复默认；
5. 不启动 PowerShell 扫描、不遍历 `C:\Windows\Fonts`，除非以后有独立安全设计。

系统字体只按 family/PostScript name 引用，不复制到应用目录，也不随应用分发。

---

## 8. Renderer 加载与预览

### 8.1 使用 FontFace API

优先使用 `FontFace` API 管理自定义字体，而不是拼接包含用户输入的 `@font-face` 字符串：

```text
字体 ID
  -> sanctuary-font URL
  -> 生成安全内部 family（如 ds-custom-<id>）
  -> new FontFace(...)
  -> await load()
  -> document.fonts.add()
  -> CSS variable 指向安全内部 family + fallback
```

- 内部 family 只由应用生成；
- 系统 family 必须使用可靠的 CSS 字符串序列化，不能原样拼入 style 文本；
- 只加载四个活动槽位和当前可见预览需要的自定义字体；
- 切换后从 `document.fonts` 移除不再使用的自定义 FontFace；
- 加载失败时保持 fallback，并在设置中标记，不白屏。

### 8.2 启动策略

- 默认系统栈立即首屏，不阻塞应用启动；
- 异步读取 `typography.v1` 并加载活动自定义字体；
- 加载成功后一次性更新四槽位变量；
- 避免每个组件各自请求字体；
- 记录字体加载耗时和失败原因，但不记录路径；
- 不宣称完全消除 FOUT；通过稳定 fallback 和受控切换减少布局跳动。

### 8.3 设置页交互

新增“排版与字体”区域：

- 四槽位卡片；
- 来源标签：预设 / 系统 / 导入；
- 搜索和字重/样式能力；
- 多语种预览：中文、日文假名、拉丁、数字、标点、Emoji；
- 当前字体缺少某类字形时显示回退提示；
- “读取系统字体”是显式按钮，不在打开设置页时自动触发权限；
- 导入、删除、恢复单槽位默认、全部恢复默认；
- 删除字体前显示受影响槽位；
- 加载和失败状态不使用原生 alert。

修改先进入 settings draft：预览区实时变化；点击“应用”后持久化。取消或离开未保存修改时恢复当前设置。不要让用户仅仅滚动下拉列表就改变全局应用。

---

## 9. 内置字体与许可规则

### 9.1 预设不等于必须随包二进制

第一版预设可以只是经过验证的系统 fallback 组合，零安装包增量。确实需要随包字体时，必须先提交字体清单供用户确认，包括：

- 字体项目和上游链接；
- 精确版本与文件 hash；
- 许可证 SPDX ID；
- Reserved Font Name；
- 是否修改、转换或子集化；
- 单文件和总安装体积；
- CJK/拉丁/假名覆盖；
- Regular/Bold/Italic 能力。

### 9.2 分发要求

- 只接受允许随软件再分发的明确许可；
- OFL 字体随包时保留版权声明和 OFL 文本；
- 在 `THIRD_PARTY_NOTICES.md` 或等价清单中登记；
- 禁止打包 Microsoft、Apple、Adobe 商业系统字体；
- 禁止运行时从 CDN 获取；
- 若进行了子集化/格式转换，重新核对 Reserved Font Name 和修改版许可义务。

Phase 0 不添加任何字体二进制。

---

## 10. 建议代码边界

```text
packages/domain/src/
  typography.ts                     # 领域类型、defaults、validator

apps/desktop/src/main/typography/
  font-service.ts                   # 索引、导入、删除、受控解析
  font-file-validator.ts            # 文件容器/元数据验证
  typography-preferences.ts         # v1 偏好读取与修复
  typography-ipc.ts                 # 窄 IPC
  font-protocol.ts                  # ID -> Response

apps/desktop/src/preload/index.ts   # 只增加窄 API

apps/desktop/src/renderer/src/typography/
  TypographyProvider.tsx
  TypographySettingsSection.tsx
  font-face-loader.ts
  typography-preview.ts

apps/desktop/src/renderer/src/styles/
  typography.css
  typography-settings.css
```

不要把所有逻辑继续堆进 `main/index.ts`、`App.tsx` 或 `SettingsView.tsx`。主入口只负责构造服务、注册协议/IPC和挂载 Provider。

Electron IPC channel 类型按当前桌面应用约定放在 preload/desktop shared 边界，不修改 Python sidecar 的 `packages/protocol`。

---

## 11. 分阶段实施

### Phase 0：探针、契约与 ADR

- [ ] 记录当前 Git 基线和 `npm.cmd run verify` 结果；
- [ ] 统计现有 `font-family`、字重和文字阴影硬编码热点；
- [ ] 在 `packages/domain` 增加纯类型/default/validator，不接 UI；
- [ ] 写 Local Font Access Electron 探针，验证 permission、secure context 和拒绝路径；
- [ ] 写 custom protocol 最小探针，验证 FontFace 能从受控 ID 加载；
- [ ] 比较字体解析依赖，形成 ADR/研究记录；
- [ ] 确定 MVP 格式支持矩阵；
- [ ] 不添加字体二进制；
- [ ] `npm.cmd run verify`；
- [ ] 单独提交并停止。

**完成标准：** 不靠猜测决定系统枚举、协议权限与解析器；有可重复探针、明确技术选择和失败退化路线。

### Phase 1：语义 token 与无行为迁移

- [ ] 增加四槽位 family token 与基础排版 token；
- [ ] 把 `Georgia`、`monospace` 和根字体栈等明确热点迁到语义 token；
- [ ] 不改变用户现有默认视觉；
- [ ] 主题 CSS 不直接覆盖四个用户槽位；
- [ ] 组件/样式测试；
- [ ] 运行视觉审计核心矩阵；
- [ ] `npm.cmd run verify`。

**完成标准：** 默认截图无非预期变化，后续切字体只改 token 而非逐组件打补丁。

### Phase 2：字体沙箱、索引和协议

- [ ] 实现受控导入、格式验证、SHA-256 去重和原子索引；
- [ ] 将 `sanctuary-font` 合并到现有 privileged scheme 注册；
- [ ] 仅在本地应用 session 注册 handler；
- [ ] Renderer 只拿 ID/描述符；
- [ ] 删除与 missing 恢复；
- [ ] 临时目录单测覆盖损坏/超大/伪扩展/路径绕过；
- [ ] `npm.cmd run verify`。

**完成标准：** 通过固定测试字体可以加载；任意本地路径无法经协议读取；Pixiv session 无法使用该协议。

### Phase 3：偏好与 TypographyProvider

- [ ] 实现 `typography.v1` 默认、读取、验证和恢复；
- [ ] FontFace 加载器和安全 family 生成；
- [ ] 四槽位异步应用；
- [ ] 切换、失败、缺失和删除回退；
- [ ] 主题切换不覆盖字体；
- [ ] 只加载活动字体；
- [ ] `npm.cmd run verify`。

**完成标准：** 重启可恢复；缺失字体不白屏；切主题、切性能档位后选择仍一致。

### Phase 4：设置页和系统字体

- [ ] 四槽位 draft/apply/cancel；
- [ ] 多语种预览与能力标签；
- [ ] 本地字体导入/删除/恢复默认；
- [ ] 用户手势触发系统字体权限；
- [ ] 拒绝或不支持时进入退化路径；
- [ ] 不显示路径，不复制系统字体；
- [ ] 更新备份和隐私文案；
- [ ] `npm.cmd run verify`。

**完成标准：** 用户知道字体来源、权限与保存状态；操作可撤销，失败可恢复。

### Phase 5：内置字体候选（需要单独批准）

- [ ] 先提交候选、许可、体积、字形覆盖和 hash 清单；
- [ ] 用户批准后才加入二进制；
- [ ] 加入许可证和第三方声明；
- [ ] 打包与安装体积对比；
- [ ] 离线可用，无远程字体请求；
- [ ] `npm.cmd run verify` 和 packaged smoke。

**完成标准：** 每个随包字体均可追溯且允许分发；没有商业系统字体混入。

### Phase 6：全产品排版回归

- [ ] 扩展 `scripts/visual-audit.mjs` 的 typography fixtures；
- [ ] W1/W2/W3/W4 窗口；
- [ ] 四主题 × 核心页面；
- [ ] 三显示档位 × 画廊/灯箱/相册；
- [ ] 中文、假名、拉丁、数字、Emoji、长标题；
- [ ] 默认、Regular-only、自定义宽体/窄体、缺字、损坏、删除；
- [ ] 检查 overflow、裁切、按钮高度、卡片跳动和焦点；
- [ ] 保存 before/after 证据和问题账本；
- [ ] `npm.cmd run verify`、packaged smoke。

**完成标准：** 没有新增 P0/P1；遗留问题进入 visual audit/known issues，不得静默丢弃。

---

## 12. 测试矩阵

### 12.1 Domain 与持久化

- 默认偏好；
- 旧版本/未知字段/损坏 JSON；
- 不存在 preset/custom ID；
- 删除活动字体后四槽位修复；
- family/PostScript name 长度、控制字符和 CSS 特殊字符。

### 12.2 文件与索引

- 有效 TTF/OTF；
- 扩展名与魔数不一致；
- 截断表、越界 offset、超长 name；
- 超过大小上限；
- 同 hash 重复导入；
- 索引原子写失败；
- index 损坏和文件 missing；
- 不允许 `..`、盘符、URL 编码路径绕过；
- 删除时文件被占用/不存在。

### 12.3 协议与 IPC

- 合法字体 ID 返回正确 MIME；
- 未知/畸形 ID 返回 404；
- Renderer 无法获得 path/bytes；
- 任意路径无法读；
- 远程 Pixiv session 没有 handler；
- preload 不暴露通用 IPC 或文件读取；
- CSP 不使用 bypass。

### 12.4 Renderer

- FontFace load success/failure/timeout；
- 同一字体不重复加载；
- 切换后卸载无用 face；
- draft/apply/cancel；
- 主题切换、重启、删除和 missing fallback；
- Local Font Access granted/denied/unavailable；
- `document.fonts.check()` 仅作为提示，不当成绝对字形覆盖证明。

### 12.5 视觉与性能

- 900×620 不横向溢出；
- 60+ 卡片滚动不因预览所有字体卡顿；
- 灯箱、暗色画册、Cyber Deck/Hollow Zero 文本清晰；
- 正文、标题、题记、数据槽位各自可辨；
- 选用极宽/极窄字体时布局不坍塌；
- 字体加载失败时首屏仍可交互；
- 应用启动不等待扫描全部系统字体；
- 无运行时字体网络请求。

---

## 13. 明确禁止

- 禁止把用户字体路径或二进制暴露给 Renderer；
- 禁止 Renderer 传任意路径给主进程导入；
- 禁止只按扩展名认定字体有效；
- 禁止第二次调用 `protocol.registerSchemesAsPrivileged()`；
- 禁止 `bypassCSP`、关闭 `webSecurity` 或放宽远程 Pixiv 权限；
- 禁止自动枚举系统字体或在无用户手势时索要权限；
- 禁止把 Local Font Access 权限授予 Pixiv WebContentsView；
- 禁止自动下载 Google Fonts 或其他网络字体；
- 禁止打包 Windows/商业字体；
- 禁止无许可清单地提交字体二进制；
- 禁止用统一 `font-weight + 80`、全局 glow 或 `!important` 掩盖可读性；
- 禁止把所有 CSS 一次性机械替换；
- 禁止让主题覆盖用户排版选择；
- 禁止把字体 IPC 写入 Python 视觉 sidecar 协议包；
- 禁止删除难修视觉问题，必须记录并闭环。

---

## 14. 各阶段交付格式

Gemini 每阶段最终消息必须包含：

```text
阶段：Phase N
基线：<commit>
修改文件：<列表>
新增/变更行为：<列表>
安全边界验证：<结果>
自动测试：<结果>
视觉证据：<路径或 N/A>
npm.cmd run verify：pass/fail
遗留问题：<编号和原因>
提交：<commit>
已停止，等待下一阶段确认。
```

不能只回复“已经全部完成”。

---

## 15. Phase 0 可直接复制指令

> 请执行 `docs/plans/archive/2026-08-15-typography-system-and-custom-fonts-complete.md`，本轮只完成 Phase 0。先验证 Electron 43 当前 Local Font Access 权限/安全上下文行为、`sanctuary-font` 最小协议加载和字体解析器选择，再冻结类型与 MVP 格式矩阵。不要写设置 UI，不要批量改 CSS，不要下载或提交字体文件。运行 `npm.cmd run verify`，提交探针与研究记录后停止，按任务书格式汇报。

---

## 16. 官方依据

- Electron Protocol：<https://www.electronjs.org/docs/latest/api/protocol/>
- Electron Security：<https://www.electronjs.org/docs/latest/tutorial/security>
- Local Font Access API 规范：<https://wicg.github.io/local-font-access/>
- Chromium Local Font Access 指南：<https://developer.chrome.com/docs/capabilities/web-apis/local-fonts>
- SIL Open Font License 1.1：<https://opensource.org/license/OFL-1.1>

