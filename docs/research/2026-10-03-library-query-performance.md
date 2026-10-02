# 图库查询与缩略图调度性能记录（2026-10-03）

本轮针对 Electron 主进程中的同步 SQLite 工作与文件检查。基线为 `d7da135`；下表是同一台 Windows 机器、Node.js 24.16.0 的隔离 SQLite 夹具测量，不能直接等同于用户真实图库的首屏耗时或帧率。没有读取真实用户数据库，也没有运行视觉推理。

## 查询夹具与结果

先以 `seedBenchmarkWorks(10_000)` 写入作品与 250 位画师，再用事务写入每件作品 5 页、共 50,000 个资产，回填作品封面与 `page_count=5`。每页字节数为 `1000 + 作品序号`，缩略图字段为不同的不存在的夹具路径。每种查询连续运行 30 次，以中位数报告；返回数量均为 60，默认方向为倒序。

| 操作 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 按保存时间第一页 | 46.58 ms | 3.22 ms |
| 按保存时间末页（offset 9,940） | 63.04 ms | 6.31 ms |
| 按作品总字节数第一页 | 52.59 ms | 23.68 ms |
| 按标题第一页 | 47.43 ms | 9.21 ms |
| 文本搜索 `artist 1`、按保存时间第一页 | 33.78 ms | 7.61 ms |

原查询在 `ORDER BY` 首项加入 `(saved_at IS NULL)`，虽然 `saved_at` 为非空字段，仍使已有的 `idx_works_saved_at` 无法承担完整排序，并在排序候选中计算资产总量。修改后以物化分页 CTE 先选择作品 ID 与排序值，再读取本页封面、相册关系和资产摘要。非空字段不再执行多余的 NULL 排序；发布时间、画师名称继续保持 NULL 置后，标题和画师仍忽略 ASCII 大小写，所有同值项继续按作品 ID 升序。

按字节数排序需要知道全部候选的总量，仍会聚合候选资产；将其计算出的排序值直接复用为返回总量。文本搜索仍为原有标题、画师、来源 ID 的子串匹配，没有用前缀搜索代替，也没有引入 FTS 或索引同步问题。分页总件数、总页数仍准确查询，不使用过期的计数缓存。

代表性 `EXPLAIN QUERY PLAN`：

```text
修改前：
SCAN w
CORRELATED SCALAR SUBQUERY
SEARCH a USING INDEX idx_assets_work (work_id=?)
USE TEMP B-TREE FOR ORDER BY

修改后：
MATERIALIZE page
SCAN w USING INDEX idx_works_saved_at
SCAN page
SEARCH w USING COVERING INDEX sqlite_autoindex_works_1 (id=?)
CORRELATED SCALAR SUBQUERY
SEARCH a USING INDEX idx_assets_work (work_id=?)
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
```

最后的排序只针对物化后的本页至多 60 件，不再针对完整图库。

## 本地图片路径检查

在同一 50,000 资产夹具中，每个路径连续检查 100 次，报告单次平均值。原图路径已有索引；缺的是缩略图路径与本地头像路径。

| `hasArtworkPath` 操作 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 末尾资产缩略图路径命中 | 7.238 ms | 0.071 ms |
| 不存在路径 | 7.110 ms | 0.017 ms |

增加非空部分索引 `idx_assets_thumbnail_path`、`idx_artists_avatar_local_path`，仍由数据库验证图片是否已索引，不放宽 `sanctuary-image` 协议的路径授权。缩略图计划由 `SCAN assets` 变为 `SEARCH assets USING COVERING INDEX idx_assets_thumbnail_path (thumbnail_path=?)`。

## 缩略图失效恢复与批次重叠

50,000 条资产都有已保存缩略图路径，但对应缓存文件均不存在，以模拟缓存目录丢失。旧实现的原始回退分支（读取全部缓存记录、逐一同步查文件、最后截取 6 条）连续运行 5 次，中位数 **1,575.63 ms**；新 `listAssetsNeedingThumbnails(6)` 同样运行 5 次，中位数 **0.30 ms**，且包含首次“尚无路径”的队列检查。

现在缓存回退使用 SQLite 迭代器，找到本批所需失效项便停止。两条非破坏性的部分索引按 `created_at, id` 排序，分别覆盖可用图片中路径尚未生成和已有路径的队列：

```text
SCAN assets USING INDEX idx_assets_pending_thumbnails
SCAN assets USING INDEX idx_assets_cached_thumbnails
```

两种队列均无需临时排序。所有缓存都有效或缺失项位于末尾时，检查完整缓存仍可能扫描较多记录；本轮不声称这个场景已经完全消除。生成仍逐张串行，保持既有较小批次；同一数据库实例上的重叠请求共享进行中的批次，避免同一资产重复解码、生成及回填。失败结束后释放进行中状态，后续请求可以重试。

索引在既有数据库初始化的 `CREATE INDEX IF NOT EXISTS` 路径创建。没有修改表字段、记录语义或 schema version，也不重写用户数据；已有数据库重开补齐索引有回归覆盖。

## 已有图库中的导入

另建 10,000 条旧版 `artworks` 记录，每条含一个完整的简短 assessment JSON，连续导入 50 张新图片记录，报告单张中位数：**29.04 ms → 2.44 ms**。该夹具没有实际原图，测量包含 SQLite 落盘和作品/资产双写，不包含图像解码、复制或模型分析。

`importArtwork` 不再通过 `listArtworks().find(...)` 读取并反序列化整个图库；改为按刚导入的 ID 查询，复用同一映射函数返回全部来源、审查记录与相册字段。大小写不同的已存在 Windows 路径也能正确复用记录，避免数据库 NOCASE 命中后被 JavaScript 精确字符串匹配误拒。

## 回归检查

聚焦检查通过：4 个测试文件、32 项测试，以及 `npm.cmd run build:core`。覆盖六类排序的两个方向、NULL、大小写相同值、分页拼接、删除项、相册过滤、空字节数；已有数据库自动补索引及查询计划；导入完整字段与不同大小写的重复路径；缓存缺失的有界恢复、有效缓存跳过；重叠生成共用批次及失败后重试。

修改文件为数据库源及其测试、缩略图服务及其测试。整体 Electron 首屏、滚动与完整项目门禁由本轮整体验证另行记录，不能从这份同步数据库夹具推导为实际界面的固定加速倍数。
