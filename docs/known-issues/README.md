# 已知问题

这里记录已经复现、但暂不阻塞当前路线推进的问题。每个问题单独成文，包含证据、影响、临时处理和后续修复方向。

| 编号 | 状态 | 摘要 |
|---|---|---|
| [KI-0001](./KI-0001-wd-tagger-cold-start-timeout.md) | 已修复 / 待新安装包验收 | WD Tagger 冷启动超过 5 秒时，首张图片曾按失败策略显示为模糊 |
| [KI-0002](./KI-0002-google-blocks-embedded-oauth.md) | 已确认 / 已绕开 | Google 拒绝 Electron 内嵌 OAuth；改用系统浏览器设置 Pixiv 密码后走邮箱登录 |
| [KI-0003](./KI-0003-explore-filter-regression.md) | 已止血 / 第一方美容过滤冻结 | 宽泛 PR/BOOTH DOM 猜测曾把普通作品列表整块误拦 |
| [KI-0004](./KI-0004-viewport-review-hides-all-images.md) | 已修复并重新启用 / 待真实站验收 | 视口驱动审查曾让 Pixiv 作品图全部停留在保护态 |
| [KI-0005](./KI-0005-download-blocked-by-explore-filter.md) | 已修复 / 实机闭环通过 | “保存当前作品”的原图请求曾被探索过滤器以 `ERR_BLOCKED_BY_CLIENT` 取消 |
| [KI-0006](./KI-0006-author-avatar-download-failure.md) | 已修复 / 接口与 CDN 已实测 / 待 UI 点击验收 | 作品接口不含可靠头像字段，旧实现从未进入下载步骤 |
| [KI-0007](./KI-0007-stale-build-and-bulk-download-failure-cascade.md) | 已修复 / 待真实收藏任务复核 | 旧构建掩盖更新，批量下载把全局故障级联为数百个作品失败 |
| [KI-0008](./KI-0008-unsigned-large-installer.md) | 已确认 / 发布前处理 | 离线安装包内含完整模型且尚未配置商业代码签名，体积较大并可能触发未知发布者提示 |
| [KI-0009](./KI-0009-packaged-model-failure-masquerades-as-blocked.md) | 代码已修复 / 待重新打包验收 | 安装包模型故障曾被表现成全部探索图片遭到拦截 |
| [KI-0010](./KI-0010-radar-label-windows-encoding.md) | 已修复 / 自动兼容旧缓存 / 待重启目视验收 | Windows 代码页曾让 Python 技术画像的中文轴名在 JSONL 协议中乱码 |
