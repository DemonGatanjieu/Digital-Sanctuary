# 图库目录摘要、范围读取与返航状态提案

- 日期：2026-10-03
- 状态：历史只读提案；目录/范围/批量入册及详情返航均已完成。实际 DTO 与验证见 [目录实施审核](../reviews/2026-10-03-gallery-directory-scope.md)、[详情返航审核](../reviews/2026-10-03-gallery-detail-return.md) 及源码。下述接口和快照范围为设计时示意，实际返航使用最多 20 条会话 LRU，查询状态仍由原有 App/查询控制器承担。
- 审查基线：`1fb1cc1`，结合当前第一批日常图库工作区；行号仅用于定位本次评估位置。
- 目标：切换相册或画师目录时不再把全部图片页、审查 JSON 和分类关系发送到 Renderer；保留画册、选页与大图的完整操作闭环。

## 已确认的整库路径

| 位置 | 当前行为与影响 |
| --- | --- |
| `App.tsx:97–109` 的 `refreshArtworks` 与模式 effect | 切到相册或画师就调用 `listArtworks()`；先取整库，再由目录卡片筛选、分组。 |
| `App.tsx:159–172` 的 `refreshLibrary`；`:276` 导入后的刷新 | 当前处于非平铺模式时再次刷新全部图片页。探索返回图库也走该刷新。 |
| `GalleryView.tsx:93`；`gallery-model.ts:17` | `buildAuthorGroups` 在 Renderer 对全部图片分组，且推断无来源文件名中的 Pixiv 作品号。 |
| `CollectionGallery.tsx:239`、`:1339` 的选图弹窗 | 将整库作为 `allArtworks`，本地搜索并渲染候选，批量加入逐页调用。 |
| `CollectionGallery.tsx:1463`、`:1547` 的目录卡 | 每张普通相册卡反复遍历全部页求封面/计数；组合卡也按页判断全部条件。 |
| 主进程 `index.ts:1614` 的 `collections:update-cover` | 用 `listArtworks().find(...)` 验证一张封面是否属于相册。 |
| 主进程 `index.ts:1630` 的 `collections:add-artwork`；`App.tsx:335` | 每加入一页返回完整图库，Renderer 整体替换数组；批量选页会反复发生。 |
| `library-ipc.ts:7` | 兼容 `library:list` 始终返回 `database.listArtworks()`。新目录不应再消费它。 |

主进程导入返回、存储迁移、下载预览统计及旧作品检查也还有整库读取。这些不属于本提案首批目录迁移，不能因目录改造就宣称项目已消除所有整库查询。

## 必须保留的实体语义

`collection_artworks` 是具体图片页的成员关系，`collection_works` 是作品关系。给 P0 加入相册 A，会同时给整件作品建立 A 的作品关系；但画册仍只收录选中的 P0。普通画册不能在性能改造时悄悄扩成作品的全部页。

一件双页作品 P0 在 A、P1 在 B 时，现组合卡按页执行 AND 得到 0，编辑器预览与平铺图库按作品执行 AND 得到 1。新组合目录应统一为现有 `queryWorks` 的作品级 AND/OR/NOT。普通相册同时明确显示“件作品”和“已收录页”，避免将页数标成作品数。

来源缺失的 `900_p0.jpg`、`900_p1.jpg` 可能只是两件本地作品。数据库范围与续页应使用真实 `works.id` / `assets.id`，不能靠文件名制造 `pixiv:900`。文件名推断只可作为待补来源提示。

## 第一批：目录摘要与按范围读取

保留 `CollectionRecord`、`ArtistRecord` 和既有写接口的基础类型，新增包装 DTO：

```ts
type GalleryScope =
  | { kind: "collection"; collectionId: string }
  | { kind: "artist"; artistId: string | null }
  | { kind: "work"; workId: string };

interface CollectionSummary {
  collection: CollectionRecord;
  workCount: number;
  pageCount: number;      // 对应作品包含的图库总页数
  bookPageCount: number;  // 该相册实际选中的 legacy 页数
  coverAsset: WorkAssetRecord | null;
}

interface ArtistSummary {
  key: string;
  artist: ArtistRecord | null;
  name: string;
  workCount: number;
  pageCount: number;
  bookPageCount: number;
  previewAssets: WorkAssetRecord[]; // 最多 3 个作品封面
}

interface SavedViewSummary {
  view: SavedCollectionView;
  effectiveQuery: SavedCollectionViewQuery;
  missingIncludedIds: string[];
  missingExcludedIds: string[];
  workCount: number;
  pageCount: number;
  previewAssets: WorkAssetRecord[]; // 最多 4 个作品封面
}
```

API 分别按需读取相册、画师、组合摘要；Renderer 切模式只请求对应目录。画师未知组为 `{kind:"artist", artistId:null}`，不插入虚构的 `ArtistRecord`，不以空字符串或可碰撞的特殊 ID 代替数据库 `IS NULL` 条件。摘要封面与预览优先使用已索引缩略图，继续经过既有图片协议；有效成员中的自选封面优先，失效封面回退范围首图，空目录返回 `null`。

作品数量和总页数先基于有效 `works` / `collection_works` 聚合，再关联资产。禁止在展开资产的 JOIN 上直接 `SUM(w.page_count)`，否则多页作品会重复累计。普通相册与画师使用分组聚合、有限排名预览，避免每张卡各调用一次 `queryWorks`。组合数可能无限增长，摘要应分页或按可见卡片加载，限制同时计算数量。

组合条件由主进程从已保存视图解析，并过滤已删除的相册 ID；返回 `effectiveQuery` 和缺失警示，与编辑器预览、点击后图库条件一致。进入组合时清理无关的旧搜索/常用筛选，或者明确展示继承条件，不能让目录数字与打开结果无提示地不同。

详情使用必选 `GalleryScope` 的 `listScopedArtworks(scope)`；没有无条件 `all`，不接受路径。建议返回 `ScopedArtworkRecord extends ArtworkRecord`，补充真实 `workId`、`assetId`、`pageIndex`、`thumbnailPath`。第一阶段读取当前相册实际成员页、当前画师全部 legacy 页或当前作品全部页，保留完整画册总展对、TOC、首页/末页与任意跳页；点击大图仍按真实作品 ID 取完整页组。

仅返回前 200 页然后让画册使用 `items.length` 会截断总页数和 TOC，不可作为兼容实现。超大单一相册的完整详情元数据仍可能较大；后续再考虑书目 manifest 与范围加载，不在这一批同时重写翻页状态机。没有 legacy 页的资产要如实保留摘要与普通作品入口，不伪造 `ArtworkRecord.id`。

入册与选图必须同步闭环：新增不超过 500 个合法页 ID 的批量入册 API，整体验证资产/作品/相册关系，在事务中写入并返回变更 ID 或摘要；失败不留下半批关系。新选图弹窗分页查询候选页，保持跨页已选集合，明确“全选当前页”，不再接收全库数组。封面成员校验改为按 ID 与相册的窄查询。旧兼容接口可以保留，但新目录工作流不能调用返回整库的写接口。

## 第二批：返航快照

在第一批范围读取稳定后，再保存会话内的图库返回描述：模式、选中范围、查询、详情子模式、当前画册页资产 ID、列表锚点及已加载范围。快照以真实 ID 为依据，不保存图片路径、原图解码缓存或任意 DOM；实例数量与列表范围有上限。

从探索、创作或设置返回时，先恢复范围描述并重新校验实体，再恢复页/列表锚点。请求代次隔离仍适用，旧范围响应不得覆盖新范围；相册或资产删除时回退到可用目录/邻近页。书页位置可用资产 ID 映射新展对，不只保存会在排序变化后失效的数组下标。弹窗、大图和正在进行的动画不自动重新打开。持久 `WorkReadingProgress` 继续只承担用户成功查看的作品页，两种状态不混用。

## 有意义的验收

1. 多页作品仅 P0 进 A、P1 进 B：普通画册选页不变，组合 AND/OR/NOT 与编辑器、平铺查询计数一致；整作品入册仍包含全部页。
2. 未知作者、本地数字文件名、空画师/相册、自选封面、删除封面与删除组合条件都返回准确摘要和明确退化。
3. 范围结果无范围外页、无猜测作品 ID；失效资产不受模型遮罩影响，原图授权仍由已索引资产决定。
4. 批量入册有界且原子，摘要、画册与组合预览同步更新；分页选图不丢跨页选择，不将当前页全选宣称全库全选。
5. 真实 Electron 的 10k 作品/50k 资产隔离夹具切换两类目录：新路径 `listArtworks` 调用 0 次，响应仅含摘要和有限预览；打开小范围只读取对应页。
6. 画册首页、末页、TOC 任意跳页、奇数/单页相册、同作品大图全页保持；超大单范围不伪报完整页数。
7. 第二批另外覆盖返回原范围与位置、快速切换的旧响应、修改分类后重验、删除原范围/锚点后的合理回退，以及不恢复阻塞弹窗。

实施范围预计涉及 domain DTO、database 查询、共享输入校验、library IPC/preload，以及 App、GalleryView、相册/画师目录卡与选图控制器。第一批不改数据库字段、模型分析或图像信任边界；第二批单独处理导航状态。每批各自完成聚焦回归、完整门禁、真实窗口检查和 Git 里程碑。
