# 纯净领域 2.0：数据与工程架构

- 状态：实施基线
- 日期：2026-08-13

## 1. 为什么必须先升级数据模型

当前 `ArtworkRecord` 实际表示一张文件页，但产品界面又把若干页临时拼成一个 Pixiv 作品。由此造成统计、排序、分类、删除、模型整理和批量操作语义不稳定。

2.0 将“作品”和“文件资产”分离。迁移过程中保留现有 `artworks` 表作为兼容来源，先双读校验，再切换 UI，最后才考虑清理旧结构。

## 2. 目标实体

### 2.1 `works`

代表用户认知中的一个作品。

- `id`：应用稳定 ID；
- `source_platform`、`source_work_id`：Pixiv 来源唯一键；
- `artist_id`；
- `title`；
- `work_type`：`illustration | manga | ugoira | local | unknown`；
- `published_at`：Pixiv 发布时间，可空；
- `bookmarked_at`：来源可获得时保存，可空；
- `saved_at`：进入本地画廊时间；
- `last_viewed_at`；
- `favorite`；
- `page_count`；
- `cover_asset_id`；
- `ownership`：`managed | external`；
- `deleted_at`：应用内软删除/回收站状态；
- `created_at`、`updated_at`。

唯一约束：`(source_platform, source_work_id)` 在两者不为空时唯一。

### 2.2 `assets`

代表作品内部的一张图片或媒体文件。

- `id`、`work_id`；
- `page_index`；
- `path`；
- `media_type`、`extension`；
- `width`、`height`、`byte_length`；
- `content_hash`（异步补全）；
- `thumbnail_path`；
- `file_state`：`available | missing | trashed | error`；
- `created_at`、`updated_at`。

约束：同一 `work_id` 下 `page_index` 唯一；路径不区分大小写唯一。

### 2.3 关系实体

- `artists`：作者资料与本地头像；
- `collections`：名称、说明、封面、排序；
- `collection_works`：分类与作品关系，不再绑定单页；
- `tags`、`work_tags`：用户标签、模型建议和来源分开；
- `analysis_runs`、`analysis_results`：显式模型整理；
- `tasks`、`task_items`：下载、缩略图、模型任务的持久状态；
- `user_preferences`：窗口、视图、排序、密度、主题、性能档位和存储选项。

## 3. 时间与排序语义

界面不得使用模糊的“时间排序”。必须显示具体字段：

- Pixiv 发布时间；
- 本地保存时间；
- 最近浏览时间；
- 最近修改时间。

字段缺失时将该作品放在有值项目之后，并在界面标记“时间未知”，不能拿下载时间冒充发布时间。

首版排序：保存时间、发布时间、标题、作者、页数、文件大小。数据库查询负责排序和分页。

## 4. 文件所有权与删除事务

### 4.1 所有权

- `managed`：应用下载到托管目录，应用可以在用户确认后移至系统回收站。
- `external`：用户从其他目录导入，默认只能移除索引。

一个作品原则上只有一种所有权。若混合，删除面板必须逐项说明，首版可禁止产生混合所有权作品。

### 4.2 删除流程

1. 主进程根据作品 ID 重新读取资产，不相信渲染器传来的路径。
2. 向渲染器返回删除预览：作品数、文件数、总大小、所有权和建议动作。
3. 用户确认后执行：
   - 外部文件：仅删除数据库索引；
   - 托管文件：调用系统回收站 API；
4. 文件操作成功后，在数据库事务中删除/软删除作品及关系。
5. 部分失败时记录逐文件结果，不把成功和失败混成一个布尔值。

分类内“移除”只删除 `collection_works` 关系，不进入文件删除流程。

## 5. 查询接口

渲染器不再调用 `listArtworks()` 获取全库，然后自行 `filter/sort/group`。目标 IPC：

- `library:query-works(query)`：搜索、筛选、排序、游标分页；
- `library:get-work(id)`：作品、资产、作者、分类、标签；
- `library:get-facets(query)`：类型、作者、分类、时间范围计数；
- `library:delete-preview(workIds)`；
- `library:delete-confirmed(request)`；
- `library:update-favorite(workIds, value)`；
- `library:update-collections(workIds, addIds, removeIds)`；
- `collections:create/update/delete/reorder`；
- `preferences:get/update`；
- `tasks:list/cancel/retry`。

每个 IPC 参数使用共享 schema 验证；主进程重新做权限、存在性和所有权检查。

## 6. 前端模块

拆分当前单文件 `App.tsx`：

```text
renderer/src/
  app/
    AppShell.tsx
    routes.ts
    usePreferences.ts
  design-system/
    Button.tsx
    IconButton.tsx
    Dialog.tsx
    Menu.tsx
    Toast.tsx
    SegmentedControl.tsx
  library/
    LibraryPage.tsx
    LibraryToolbar.tsx
    WorkGrid.tsx
    WorkCard.tsx
    WorkDetail.tsx
    SelectionBar.tsx
    DeleteDialog.tsx
  artists/
  collections/
  explore/
  settings/
  tasks/
```

第一步只搬组件和样式，不同时改变产品逻辑；第二步接新查询模型。

## 7. 主进程模块

```text
main/
  window/
    controller.ts
    preferences.ts
  library/
    controller.ts
    queries.ts
    deletion.ts
    thumbnails.ts
  download/
    controller.ts
    pixiv-api.ts
    original-fetch.ts
  explore/
    controller.ts
    navigation-policy.ts
    review-coordinator.ts
  analysis/
    controller.ts
  ipc/
    schemas.ts
    register.ts
```

不一次性重写 1700 行主进程。按行为搬迁，每次保持测试通过。

## 8. 窗口与偏好

- 首次启动默认 `1440 × 900`，在可用工作区内居中；小屏按工作区比例收缩。
- 保存正常窗口的 bounds 和最大化状态；启动时验证仍落在现有显示器范围内。
- 不恢复最小化状态，不因拔掉显示器把窗口放到屏幕外。
- 偏好保存在本地配置，不写入 UI 组件常量。

## 9. 缩略图管线

- 原图落盘/导入后排入独立缩略图任务，不阻塞入库完成。
- 标准缩略图建议以最长边 768–1024 px、保留宽高比的 WebP/AVIF 保存；质量通过基准决定。
- 缩略图键包含源文件哈希/mtime、尺寸和编码版本。
- 缩略图缺失时显示稳定占位并异步生成，不回退为同时解码大量原图。
- 原图查看器永远读取原资产，不使用缩略图冒充原图。

当前 `v1` 实现采用最长边 640 px 的透明 PNG，以 Electron 内置解码器串行生成；缓存键包含版本、资产 ID、源路径和内容哈希/字节数。选择 PNG 是为了先保证插画透明背景正确，后续以真实图库基准决定是否发布新的 WebP/AVIF 缓存版本。

## 10. 迁移步骤

1. 新建 `works/assets` 等表与迁移测试，不改现有 UI。
2. 从旧 `artworks` 聚合：Pixiv 按 `source_work_id`，本地导入每张建立一个 local work。
3. 校验作品数、页数、路径和关系总量；重复运行迁移必须幂等。
4. 新下载同时写入新模型；旧模型保持兼容读取。
5. 新画廊切到 `query-works`，通过验收后停止旧 UI 写入。
6. 分类关系迁到作品级；旧页面级关系合并去重并记录冲突。
7. 稳定两个版本后再评估删除旧列/旧表，不在首次迁移中破坏回滚能力。

## 11. 工程验收

- 迁移前自动备份数据库，失败后原库可继续启动。
- 迁移幂等，有正常、多页、缺元数据、缺文件和重复关系测试。
- 查询 10,000 作品时不向渲染器一次性返回全量记录。
- 删除、分类和批量操作均有事务与失败结果测试。
- 视觉模型、下载和缩略图任务互不占用同一个无限队列。
