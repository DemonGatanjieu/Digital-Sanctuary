# KI-0005：保存当前作品被探索过滤器拦截

- 状态：已修复 / 账号会话实机闭环通过
- 首次记录：2026-08-11
- 影响范围：作品详情页“保存当前作品”

## 现象

点击保存后，界面显示 `net::ERR_BLOCKED_BY_CLIENT`，托管目录只创建到 `图片/Digital Sanctuary/Pixiv`，没有原图成品文件。

## 根因

初版下载实现把 `i.pximg.net` 原图请求交给了探索页的持久 Session。该 Session 的 `webRequest.onBeforeRequest` 专门负责拦截网页作品图片并执行内容审查，因此应用主动下载也被误认为页面展示请求，最终被自身取消。

进一步隔离测试确认，Electron Chromium Fetch 对 Pixiv 原图所需的手工 `Referer` 组合仍会返回 `ERR_BLOCKED_BY_CLIENT`，仅依赖标准 `referrer` 又会被 Pixiv 返回 HTTP 403。

## 修复

- 收藏和作品页清单继续由登录 Session 请求，只在应用内部使用会话 Cookie。
- 原图改由主进程 Node Fetch 请求，仅发送原图地址与 Pixiv 作品页 `Referer`，不携带登录 Cookie。
- 原图使用流式临时文件和原子改名，不再把多张大图同时完整放入内存。
- 网络请求由全局四槽并发门限制；GPU 审查继续单路排队。
- 作品页注入应用按钮，点击消息会校验当前 URL 中的作品 ID 后才触发主进程下载。

## 验证

- 隔离 Node Fetch 对 Pixiv 当日公开作品返回 HTTP 200、`image/jpeg`、1,346,350 字节。
- 31 个 TypeScript 测试、3 个 Python 测试、类型检查与生产构建通过。
- 用户实际登录 Session 已完成单作品与收藏批量下载，并形成大规模本地画廊；重复任务能够跳过已有文件并补齐数据库来源元数据。
- 后续统一信任语义：单作品和收藏批量下载都不再自动运行 WD Tagger，保存后直接标记为用户信任。
