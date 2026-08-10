# 纯净领域（Digital Sanctuary）目录结构计划

> 当前仓库根目录 `E:\PIxiv` 就是项目根目录，不再额外套一层 `digital-sanctuary/`。本计划只定义边界；在技术探针完成前，不需要一次性创建全部目录。

## 1. 目标结构

```text
E:\PIxiv\
├─ apps\
│  └─ desktop\
│     ├─ src\
│     │  ├─ main\               # Electron 主进程、窗口、session、下载与子进程
│     │  ├─ preload\            # 最小化且可审计的 IPC 桥
│     │  └─ renderer\           # React UI：画廊、探索、设置
│     └─ tests\
├─ packages\
│  ├─ domain\                   # 纯领域类型与规则，不依赖 Electron/React/Python
│  ├─ protocol\                 # 桌面端与视觉进程的版本化消息协议
│  ├─ database\                 # SQLite schema、迁移、仓储接口
│  ├─ ui\                       # 可复用 UI 与主题；稳定后再建立
│  └─ site-adapters\            # Pixiv 页面提取与站点变化隔离层
├─ services\
│  └─ vision\
│     ├─ src\                   # 模型加载、预处理、推理、结果归一化
│     └─ tests\
├─ tests\
│  ├─ fixtures\                # 可合法保存的小型测试资产
│  ├─ integration\
│  └─ e2e\
├─ docs\
│  ├─ adr\                     # Architecture Decision Records
│  ├─ research\                # 技术探针和模型评测结论
│  └─ threat-model\            # 远程页面、IPC、文件与凭据威胁模型
├─ scripts\                     # 构建、检查、迁移等薄脚本
├─ models\                      # 本地模型位置；大文件默认不进 Git
├─ runtime-data\                # 仅开发环境数据；默认不进 Git
├─ Project_Vision.md
├─ Implementation_Plan_Draft.md
├─ Implementation_Plan_Options.md
└─ Project_Structure_Plan.md
```

## 2. 为什么这样分

### `apps/desktop`

只负责“应用怎么运行”：窗口、菜单、托盘、远程页面容器、下载队列和 UI。它可以依赖 `packages/*`，但领域规则不能反向依赖 Electron。

### `packages/domain`

放稳定概念，例如：

- `Artwork`、`Artist`、`Collection`、`SourceRef`
- `VisionLabel`、`VisionAssessment`
- `FilterRule`、`FilterDecision`
- 下载和索引状态机

这里只允许纯 TypeScript 和纯函数。这样未来替换 UI、数据库或桌面容器时，核心规则仍可复用和测试。

### `packages/protocol`

只放跨进程消息定义，例如请求 ID、协议版本、超时、错误码和分类结果。桌面端与 Python 各自生成或验证同一份 schema，避免用随意 JSON 逐渐形成隐式协议。

### `packages/database`

数据库只保存索引和元数据，不保存图片二进制。所有 schema 变化走迁移；业务代码不散落 SQL。

### `packages/site-adapters`

站点选择器、作品 ID 提取、页面节点观察、允许域名和下载来源解析全部集中在这里。站点改版时，只需修复适配器及其夹具测试。

### `services/vision`

视觉引擎是可独立启动和测试的本地进程。它不读取登录 cookie，不直接修改图库，也不决定最终隐藏规则；它只返回可解释的标签和置信度。

## 3. 第一批只创建这些目录

选择推荐的纵向切片路线时，第一批足够：

```text
apps/desktop/src/{main,preload,renderer}
packages/{domain,protocol,database}
services/vision/{src,tests}
tests/fixtures
docs/{adr,research,threat-model}
```

暂时不要创建 `packages/ui`、`packages/site-adapters`、`tests/e2e`、`models` 和 `runtime-data`。等对应模块真正有第一个文件时再创建，避免空目录给人“模块已经设计完成”的错觉。

## 4. 路线不同，目录创建顺序不同

### 路线 A：纵向切片

1. `packages/domain`、`packages/protocol`
2. `services/vision`
3. `packages/database`
4. `apps/desktop`
5. `packages/site-adapters`
6. `tests/integration`、`tests/e2e`

### 路线 B：风险优先

1. `docs/research`、`tests/fixtures`
2. `services/vision`
3. `packages/protocol`
4. `apps/desktop/src/main`、`apps/desktop/src/preload`
5. `packages/site-adapters`
6. 通过止损门槛后再建 `packages/database` 和完整 renderer

### 路线 C：画廊优先

1. `packages/domain`、`packages/database`
2. `apps/desktop/src/main`、`apps/desktop/src/renderer`
3. `packages/ui`
4. `services/vision`、`packages/protocol`
5. `packages/site-adapters`

## 5. 依赖方向

```text
renderer ─┐
main ─────┼──> domain
database ─┘

desktop main ──> protocol <── vision service
desktop main ──> database
site adapters ─> domain
```

必须保持的规则：

- `domain` 不依赖其他项目模块。
- `vision` 不依赖 Electron、React、数据库或站点适配器。
- `renderer` 不直接访问文件系统、SQLite、cookie 或视觉子进程。
- `preload` 不包含业务逻辑，只做参数校验和窄 IPC 转发。
- `site-adapters` 不直接写数据库。

## 6. 运行时数据不要混进源码

正式应用的数据位置由系统应用数据目录决定，不放在仓库内。开发期即使使用 `runtime-data/`，也应在 `.gitignore` 排除：

- SQLite 数据库及其 WAL 文件
- 登录 session 与 cookie
- 下载临时文件
- 缩略图与 AI 审查缓存
- 用户选择的模型文件
- 含本地绝对路径或访问 token 的日志

模型许可证、模型来源、哈希和预处理参数应进入版本控制，但模型权重是否入库要单独决定。

## 7. 建议最先写的 ADR

创建代码目录后，先写短 ADR，不需要长篇设计：

1. `0001-desktop-container.md`：为什么首版选 Electron / WebContentsView。
2. `0002-unknown-image-policy.md`：为什么未知或超时默认隐藏。
3. `0003-library-ownership.md`：首版只索引，还是由应用托管文件。
4. `0004-vision-process-boundary.md`：为什么视觉服务使用子进程协议。
5. `0005-database-choice.md`：为什么元数据使用 SQLite。

