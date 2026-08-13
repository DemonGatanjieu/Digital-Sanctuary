# KI-0008：安装包体积与发布者信誉

- 状态：已确认 / 不阻塞本地使用 / 对外发布前处理
- 记录日期：2026-08-14

## 现象

`Digital-Sanctuary-Setup-0.1.0.exe` 约 491 MB，解包后约 941 MB。安装包未配置商业代码签名证书，Windows 向其他设备分发时可能显示未知发布者或 SmartScreen 提示。

## 原因

- 安装包离线携带约 446 MB 的 WD SwinV2 Tagger v3 模型；
- PyInstaller 打包的 Python、NumPy、Pillow 和 ONNX Runtime 运行时约 95 MB；
- Electron/Chromium 运行时本身也占据主要空间；
- 当前私人仓库和本地验收没有可用的受信任代码签名证书。

## 当前处理

- 保留完整离线 CPU 模型，避免安装后依赖系统 Python或偷偷退化为开发探针；
- `smoke:installer` 已验证安装后的 WD Tagger 能完成真实推理；
- `release/`、模型和运行时构建目录不进入 Git。

## 对外发布前

1. 核对模型、PyInstaller 打包依赖和应用素材的再分发许可；
2. 配置 Windows Authenticode 代码签名并建立发布者信誉；
3. 如需减小首包，可另行设计带哈希校验、断点续传和明确授权的模型下载器，不能静默联网；
4. 保留离线完整版供不希望运行时下载的用户选择。
