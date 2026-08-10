# 交接三：验收清单

## 每次改动必须执行

```powershell
npm.cmd run typecheck
.\node_modules\.bin\vitest.cmd run
& 'E:\PIxiv\.venv\Scripts\python.exe' -m unittest discover -s 'E:\PIxiv\services\vision\python' -p 'test_*.py'
npm.cmd run build
```

Python 虚拟环境启动器会调用用户目录中的 Python 3.14；在受限沙箱中可能需要授权执行。这不等于虚拟环境损坏。

## 探索页烟雾测试

- 应用能够进入“探索”，侧栏隐藏，外层 `main` padding 为 0。
- Pixiv 顶层页面正常加载。
- 工具栏能显示审查中、放行、内容拦截和广告拦截计数。
- 公开排行榜真实作品图的 `naturalWidth > 0`。
- 非 Pixiv 第三方 iframe 调试目标为 0。
- 站外顶层跳转、弹窗、下载和非必要权限仍被拒绝。
- 登录页 reCAPTCHA 不因广告策略被拦截。

## PR 美容过滤专项

- 页面可见区域中没有独立的“PR/推广”卡片。
- 普通作品卡片数量没有异常大幅减少。
- 标题或作者名中包含字母 `PR` 的普通作品不被隐藏。
- 滚动加载出来的新 PR 卡片也会隐藏。
- 前进、后退、站内软导航后 observer 只存在一份。

## 缓存专项

- 首次访问：缓存未命中并运行模型。
- 同进程刷新：不重复推理相同 URL。
- 重启应用：持久化缓存命中。
- 修改规则：旧缓存不再产生 allow 快路径。
- 模型失败：页面保持遮挡，数据库不保存永久失败记录。

## 占位层与一次性查看专项

- 被拦截图片不出现原图闪现或破图，显示统一浅色占位卡片和命中原因。
- “仅本次查看”只对明确点击的单张作品生效，不写入永久 allow 缓存。
- 一次性查看后的再次请求仍会重新审查；软导航后占位层和适配器可恢复。

## 安全回归

- 重复启动应用不会创建第二个窗口或第二个 Pixiv session。
- 关闭并重新启动应用后，`persist:pixiv` 会话仍然存在，不要求重复登录。
- 不出现内嵌 Google OAuth。
- 不增加 `nodeIntegration`，不关闭 sandbox、context isolation 或 web security。
- 远程页面不能访问本地文件或数据库。
- 未知图片不能先显示后审查。
- 广告过滤不能通过封禁整个 `pixiv.net` 或 `pximg.net` 实现。

## Git 提交前

- 检查 `git status --short`。
- 确认没有 `node_modules/`、`.venv/`、`models/`、`.tmp/`、`apps/desktop/out/`、数据库、日志或账号会话。
- 提交信息说明行为变化，不要使用含糊的 `update`。
