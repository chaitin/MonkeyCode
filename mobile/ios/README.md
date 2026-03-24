# iOS CI/CD

仓库现在提供了一条独立的 iOS 发布流水线：

- 打 `v*` tag 时自动构建签名 IPA，并按顺序执行：
  - 上传到 GitHub Release
  - 上传到 TestFlight
  - 提交到 App Store 审核
- 手动运行 `iOS Release` workflow 时，可以额外选择：
  - `none`: 只构建 IPA
  - `all`: 构建后同时执行 Release / TestFlight / App Store
  - `testflight`: 构建后上传到 TestFlight
  - `app-store`: 构建后直接提交到 App Store 审核

## 必备 GitHub Secrets

构建签名：

- `IOS_TEAM_ID`
- `IOS_CERTIFICATE_BASE64`
- `IOS_CERTIFICATE_PASSWORD`
- `IOS_PROVISIONING_PROFILE_BASE64`

App Store Connect：

- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY_BASE64`

## Secrets 含义

- `IOS_CERTIFICATE_BASE64`: `.p12` 发布证书的 Base64 内容。
- `IOS_CERTIFICATE_PASSWORD`: 导出 `.p12` 时使用的密码。
- `IOS_PROVISIONING_PROFILE_BASE64`: App Store Distribution 的 `.mobileprovision` Base64 内容。
- `APP_STORE_CONNECT_PRIVATE_KEY_BASE64`: App Store Connect API Key 的 `.p8` Base64 内容。

## 使用方式

完整自动发布：

```bash
git tag v1.0.0
git push origin v1.0.0
```

手动一键发：

1. 打开 GitHub Actions。
2. 运行 `iOS Release`。
3. 选择 `publish_target` 为 `all`、`testflight` 或 `app-store`。

## 前提

- `com.monkeycode.mobile` 这个 Bundle ID 已在 Apple Developer 和 App Store Connect 中创建。
- App Store Connect 里已经创建对应 App。
- 证书、描述文件和 API Key 都属于同一个 Team。
- 如果选择 `app-store`，App Store Connect 中的必填元数据需要已经补齐，否则提交审核会失败。
