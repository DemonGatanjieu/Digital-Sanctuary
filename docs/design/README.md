# 产品设计索引

这里保存已经被采用、准备进入实现的产品与交互设计。它们回答“最终要做成什么样”，`docs/plans/ACTIVE_ROADMAP.md` 回答“按什么顺序施工”。

- [`PRODUCT_PRINCIPLES.md`](./PRODUCT_PRINCIPLES.md)：跨页面的产品与交互指导原则及交付检查；后续功能和界面调整共同遵守。
- [`PIXIV_RESOURCE_MANAGER_V2.md`](./PIXIV_RESOURCE_MANAGER_V2.md)：纯净领域 2.0 的产品定位、信息架构、界面、交互、性能档位、自定义能力与验收原则；具体当前能力与入口以 `ARCHITECTURE.md` 为准。
- [`DATA_AND_ARCHITECTURE_V2.md`](./DATA_AND_ARCHITECTURE_V2.md)：作品级图库数据模型、文件所有权、删除语义、IPC 和模块拆分方案。
- [`LOCAL_IMAGE_WORKBENCH.md`](./LOCAL_IMAGE_WORKBENCH.md)：图库与本地文件夹共用找图、选择和取用流程；明确图库显示名称及复制导出、文件夹分析、自然语言找图的分阶段状态。

设计原则发生变化时，先修改这里，再进入代码实现。视觉稿可以迭代，但作品、文件、信任、删除和模型分析的语义不能靠 CSS 临时决定。
