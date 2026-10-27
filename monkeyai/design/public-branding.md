# 公开品牌与商业授权标记

`GET /api/auth/v1/branding` 无需登录，仅返回以下字段：

```json
{
  "workspace_name": "团队名称",
  "product_name": "产品名称",
  "machine_code": "授权机器码",
  "has_commercial_license": false
}
```

响应使用 `Cache-Control: no-store`。机器码应与其他设置中的付费授权页面一致，不得使用统计实例 UUID 代替。公开响应不包含授权文件、签名、密钥、客户信息、席位数、机器列表或有效期。

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
