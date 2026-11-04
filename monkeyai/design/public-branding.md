# 公开品牌与商业授权标记

`GET /api/auth/v1/branding` 无需登录，仅返回以下字段：

```json
{
  "workspace_name": "团队名称",
  "product_name": "产品名称",
  "logo_url": "https://example.com/api/auth/v1/branding/logo?v=图片版本",
  "machine_code": "授权机器码",
  "has_commercial_license": false
}
```

响应使用 `Cache-Control: no-store`。机器码应与其他设置中的付费授权页面一致，不得使用统计实例 UUID 代替。公开响应不包含授权文件、签名、密钥、客户信息、席位数、机器列表或有效期。

## Admin 自定义 Logo

品牌信息保存在 `settings` 表 `key = 'branding'` 的 JSONB `value` 中。图片存入现有对象存储，内部引用字段为 `logo_s3_key`；公开接口、管理员设置响应均只返回派生的 `logo_url`，不返回存储 key。未设置时 `logo_url` 为空字符串，旧接口缺少字段或图片加载失败时，页面均回退内置默认图片。

- `PUT /api/admin/v1/settings/branding/logo`：管理员以 multipart `logo` 文件上传 PNG、JPG/JPEG、WebP、GIF、BMP 或 TIFF，最大 1 MiB，不限制像素尺寸。服务器完整解码并重新编码为 PNG，GIF/TIFF 使用首帧，成功后立即生效，返回品牌设置记录。
- `DELETE /api/admin/v1/settings/branding/logo`：管理员清除自定义引用，保留名称，返回空 `value.logo_url`。
- `GET /api/auth/v1/branding/logo`：无需登录读取当前 PNG，支持 ETag 条件请求和 304。未设置或读取失败时返回 404。
- `GET /api/admin/v1/settings`、`GET /api/admin/v1/settings/branding`、`PUT /api/admin/v1/settings/branding` 的品牌记录响应包含 `value.logo_url`。

名称更新会在数据库中原子保留当前图片引用；图片更新原子保留当前名称。名称接口忽略客户端传入的 `logo_s3_key` 和 `logo_url`，Logo 只能通过专用上传、删除接口变更。每次上传生成独立对象 key，URL 的版本随之变化。

Admin 的部署首页、后台登录页、侧栏、设置预览、favicon 和 Apple touch icon 共用品牌状态。Logo 预览容器本身是选图按钮，悬停和键盘聚焦时显示蒙层及上传图标。选图只修改本地预览，不发送请求；页面不提供恢复默认按钮；离开页面会丢弃未保存的选择。点击品牌信息右上角“保存”后才提交名称与 Logo，成功后同步刷新各处显示；失败时保留待保存的选择供重试。

包含 Logo 变更时，Admin 向 `PUT /api/admin/v1/settings/branding` 提交 multipart：`workspace_name`、`product_name`、`logo_action=replace|reset`，替换时附加 `logo` 文件。服务器先完成文件验证与对象写入，再通过一次 SQL 原子更新名称和引用；数据库保存失败时删除本次上传对象，原品牌配置保持不变。仅修改名称仍使用原 JSON 请求并保留当前 Logo。本轮不修改桌面客户端、客户端登录页、独立营销官网；`/api/v1/settings` 不下发 Logo 字段，图片变更也不影响其内容版本。

浏览器验证：先构建 admin，再设置 `CHROME_BIN`，执行 `npm run test:browser:brand-logo`；可用 `WIDTH`、`DARK=0|1` 分别检查桌面、手机和明暗主题。

## 宿主接入

授权校验位于宿主扩展。开源 backend 暴露可选的 `server.PublicLicenseReader` 接口，传给 `server.Run` 的管理员扩展可同时实现：

```go
PublicLicense(context.Context) (machineCode string, hasCommercialLicense bool, err error)
```

宿主应复用 `/api/admin/v1/license/machine-code` 和 `/api/admin/v1/license/status` 使用的机器码及合法付费授权校验逻辑。只有真实导入、验签通过、机器绑定匹配且当前有效的商业授权才能返回 `true`；不能依据文件存在、品牌设置或客户端传入的值判断。缺失、无效、未生效或过期授权均返回 `false`。查询失败返回错误，公开接口将标记降为 `false`，且不将错误详情写入公开响应。

每次 branding 请求都会重新调用该接口，不在启动时缓存授权有效性。没有提供此扩展时，机器码返回空字符串，商业授权标记返回 `false`。

**当前工作区缺少宿主扩展源码，实际宿主校验器尚未接入。** 因此这里完成的是公开接口与可选扩展接线，不能据此认定现有商业部署已经返回有效授权标记。

## 首页行为

只有 `has_commercial_license === true` 时隐藏整句“当前系统由百智办公驱动”。字段缺失、返回 `false`、旧版服务或接口请求失败时继续显示该文案。首页不展示机器码。
