# 产品设计索引

这里保存已经被采用、准备进入实现的产品与交互设计。它们回答“最终要做成什么样”，`docs/plans/ACTIVE_ROADMAP.md` 回答“按什么顺序施工”。

- [`PRODUCT_PRINCIPLES.md`](./PRODUCT_PRINCIPLES.md)：跨页面的产品与交互指导原则及交付检查；后续功能和界面调整共同遵守。
- 产品定位以根目录 [`AGENTS.md`](../../AGENTS.md) 第 0 节为准（进 → 存 → 找 → 用）。
- [`IMAGE_FIRST_REDESIGN.md`](./IMAGE_FIRST_REDESIGN.md)：已完成的图片优先重设计（0.2.0）的决策记录。
- [`PIXIV_RESOURCE_MANAGER_V2.md`](./PIXIV_RESOURCE_MANAGER_V2.md)：纯净领域 2.0 的早期设计；其中的定位、主题与自定义能力已被 `AGENTS.md` 和现行路线取代，仅作历史参考。
- [`DATA_AND_ARCHITECTURE_V2.md`](./DATA_AND_ARCHITECTURE_V2.md)：作品级图库数据模型、文件所有权、删除语义、IPC 和模块拆分方案。
- [`LOCAL_IMAGE_WORKBENCH.md`](./LOCAL_IMAGE_WORKBENCH.md)：图库与本地文件夹共用找图、选择和取用流程；明确图库显示名称及复制导出、文件夹分析、自然语言找图的分阶段状态。

设计原则发生变化时，先修改这里，再进入代码实现。视觉稿可以迭代，但作品、文件、信任、删除和模型分析的语义不能靠 CSS 临时决定。
