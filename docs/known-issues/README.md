# 已知问题

这里记录已经复现、但暂不阻塞当前路线推进的问题。每个问题单独成文，包含证据、影响、临时处理和后续修复方向。

| 编号 | 状态 | 摘要 |
|---|---|---|
| [KI-0001](./KI-0001-wd-tagger-cold-start-timeout.md) | 已确认 / 延后修复 | WD Tagger 冷启动超过 5 秒时，首张图片会按失败策略显示为模糊 |
| [KI-0002](./KI-0002-google-blocks-embedded-oauth.md) | 已确认 / 已绕开 | Google 拒绝 Electron 内嵌 OAuth；改用系统浏览器设置 Pixiv 密码后走邮箱登录 |
| [KI-0003](./KI-0003-explore-filter-regression.md) | 已止血 / 第一方美容过滤冻结 | 宽泛 PR/BOOTH DOM 猜测曾把普通作品列表整块误拦 |
| [KI-0004](./KI-0004-viewport-review-hides-all-images.md) | 已确认 / 实验功能已关闭 | 视口驱动审查启用后，Pixiv 作品图全部停留在保护态 |
| [KI-0005](./KI-0005-download-blocked-by-explore-filter.md) | 已修复 / 实机闭环通过 | “保存当前作品”的原图请求曾被探索过滤器以 `ERR_BLOCKED_BY_CLIENT` 取消 |
| [KI-0006](./KI-0006-author-avatar-download-failure.md) | 已修复 / 接口与 CDN 已实测 / 待 UI 点击验收 | 作品接口不含可靠头像字段，旧实现从未进入下载步骤 |
| [KI-0007](./KI-0007-stale-build-and-bulk-download-failure-cascade.md) | 已修复 / 待真实收藏任务复核 | 旧构建掩盖更新，批量下载把全局故障级联为数百个作品失败 |
