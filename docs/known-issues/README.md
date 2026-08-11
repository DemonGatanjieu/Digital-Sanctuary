# 已知问题

这里记录已经复现、但暂不阻塞当前路线推进的问题。每个问题单独成文，包含证据、影响、临时处理和后续修复方向。

| 编号 | 状态 | 摘要 |
|---|---|---|
| [KI-0001](./KI-0001-wd-tagger-cold-start-timeout.md) | 已确认 / 延后修复 | WD Tagger 冷启动超过 5 秒时，首张图片会按失败策略显示为模糊 |
| [KI-0002](./KI-0002-google-blocks-embedded-oauth.md) | 已确认 / 已绕开 | Google 拒绝 Electron 内嵌 OAuth；改用系统浏览器设置 Pixiv 密码后走邮箱登录 |
| [KI-0003](./KI-0003-explore-filter-regression.md) | P0 已修复 / 待实机复核 | 普通作品大量误拦，同时 PR/BOOTH 第一方广告漏拦 |
| [KI-0004](./KI-0004-viewport-review-hides-all-images.md) | 已确认 / 实验功能已关闭 | 视口驱动审查启用后，Pixiv 作品图全部停留在保护态 |
| [KI-0005](./KI-0005-download-blocked-by-explore-filter.md) | 已修复 / 待实机复核 | “保存当前作品”的原图请求被探索过滤器以 `ERR_BLOCKED_BY_CLIENT` 取消 |
