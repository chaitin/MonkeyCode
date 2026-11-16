# .well-known 关联文件

部署域名：`work.baizhi.cloud`。部署时必须设置：

```text
SITE_URL=https://work.baizhi.cloud
SITE_ADDRESS=work.baizhi.cloud
```

## 当前内容

### iOS：`apple-app-site-association`

- Team ID：`8Z56KX83T3`
- Bundle ID：`com.chaitin.monkeyai`
- 路径：`/app-link/scan/` 和 `/app-link/scan`

### Android：`assetlinks.json`

- Package：`com.chaitin.monkeyai`
- SHA-256：`52:BE:52:D9:30:49:AE:D9:2E:0D:C8:58:3A:C8:21:69:F2:F0:A6:E3:9F:A4:0C:E7:A2:8A:88:B4:E5:FE:FC:49`
- 来源：已签名 APK `MonkeyAI-26.1114.1-android-arm64.apk` 的 `apksigner verify --print-certs` 输出
- 证书 DN：`CN=Unknown, OU=PDC, O=Chaitin, L=Beijing, ST=Beijing, C=CN`

如果使用 Google Play App Signing，用户设备上的签名证书是 Google 持有的那张，还需要把 Play Console → App integrity → App signing key certificate 的 SHA-256 追加到这个数组里。官网 APK 的发布证书和 Play 证书可以同时存在。

### HarmonyOS：`applinking.json`

- Bundle：`com.chaitin.monkeyai`
- appIdentifier：`6917618674586487246`
- 来源：`signature/release/MonkeyAI-Release-Priv2Release.p7b` 的 `bundle-info.app-identifier`
- debug Profile 的 appIdentifier 与 release 相同

如果更换 Harmony 签名 Profile，重新从 `HarmonyAppProvision` 的 `app-identifier` 取值。

## 部署后检查

```bash
curl -I https://work.baizhi.cloud/.well-known/apple-app-site-association
curl -I https://work.baizhi.cloud/.well-known/assetlinks.json
curl -I https://work.baizhi.cloud/.well-known/applinking.json
```

三个文件都应直接 200、不能重定向；AASA 必须是 `Content-Type: application/json`。构建后确认 `dist/.well-known/` 下确实有这些文件。
