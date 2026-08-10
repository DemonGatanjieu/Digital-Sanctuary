# KI-0002：Google 拒绝 Electron 内嵌 OAuth

- 状态：已确认，已通过受支持流程绕开
- 首次记录：2026-08-10
- 影响范围：从 Pixiv 登录页发起的 Google 第三方登录

## 现象

内嵌页面可以到达 Google 账号输入页，但提交账号后显示“无法登录——此浏览器或应用可能不安全”。这不是用户的账号、网络或操作错误。

## 已确认原因

Google 不接受当前 Electron `WebContentsView` 中的登录环境。复测时已经使用与 Electron 内置 Chromium 同版本的 Chrome User-Agent，仍在账号提交后的风控阶段被拒绝。

继续修改 User-Agent 或重写 `navigator.webdriver` 属于脆弱的反检测伪装，既不能保证通过后续风控，也会增加账号安全和维护风险，因此不作为产品方案。

## 当前处理

1. 应用不再承载 Google OAuth，也不复制浏览器 Cookie 或读取账号凭据。
2. “浏览器设置密码”只会用默认浏览器打开固定的 Pixiv 官方页面：<https://accounts.pixiv.net/password/change>。
3. 用户在普通浏览器中通过 Google 登录 Pixiv，并设置一个 Pixiv 密码。
4. 回到应用点击“邮箱登录”，使用绑定邮箱和新设置的 Pixiv 密码。

Pixiv 官方帮助说明，登录后可在账号管理中心修改密码；忘记密码时也可改用“使用邮箱登录”。

## 后续边界

除非 Pixiv 提供适合桌面应用的正式外部浏览器 OAuth / PKCE 流程，否则不恢复 Electron 内嵌第三方登录。
