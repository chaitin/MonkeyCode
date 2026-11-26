# 知识库正文图片上传

本文描述正文插图上传。JPEG/JPG/PNG 作为独立知识文档导入时，由后端调用视觉 LLM 生成画面描述并提取图中文字，描述参与检索，命中后可返回原图；不调用 anydoc；方案与验证范围见 [多格式解析方案第 10 节](knowledge-base-file-parsing.md#10-jpegjpgpng-独立文档导入)。两类入口的入库与学习行为不同。

管理端：`POST /api/admin/v1/kb/{id}/images/upload`，使用管理员登录 Cookie，仅支持系统知识库。个人知识库在管理端保持只读。

客户端：`POST /api/v1/kb/{id}/images/upload`，使用 OAuth Bearer access token。知识库必须启用，调用者为个人库所有者或拥有正文 `read_write` 授权的成员。只读成员返回 403，无访问权限返回 404。上传时锁定知识库并检查权限，与权限撤销、删除操作串行。

请求使用 `multipart/form-data`，通过 `file` 字段上传一张图片。支持 PNG、JPEG、GIF、WebP，最多 32 MiB、2500 万像素。服务端根据真实内容识别格式并完整解码，不信任文件名或客户端 MIME，拒绝 SVG、损坏图片、空文件和多文件。超限请求返回 400。

```sh
# 管理端：使用已登录的 Cookie 文件，并遵守现有管理 API 的来源校验。
curl 'https://example.com/api/admin/v1/kb/KB_ID/images/upload' \
  -b cookies.txt -H 'Origin: https://example.com' -F 'file=@./picture.png'

# 客户端
curl 'https://example.com/api/v1/kb/KB_ID/images/upload' \
  -H "Authorization: Bearer $ACCESS_TOKEN" -F 'file=@./picture.png'
```

成功返回 HTTP 201：

```json
{
  "name": "<sha256>.png",
  "url": "/api/kb/<kb-id>/assets/<sha256>.png",
  "mime_type": "image/png",
  "size_bytes": 1024,
  "markdown": "![](/api/kb/<kb-id>/assets/<sha256>.png)"
}
```

调用者将 `markdown` 插入文档正文，再调用原有文档保存接口。上传本身不修改正文或触发知识库学习。编辑器可以通过返回的 `url` 预览图片。

## MCP 接口范围

图片上传需求优先调用 `POST /api/v1/kb/{id}/images/upload`，使用 `multipart/form-data` 的 `file` 字段，由客户端直接传输图片字节。不要让大模型通过 tool calling 生成、复制或传递图片 Base64 来调用 `kb_upload_image`。REST 需要 Agent 登录凭证，MCP Key 不能替代；缺少上传能力或登录凭证时，应提示用户使用客户端上传入口，不要回退为模型生成 Base64。`kb_upload_image` 仅供能够在模型上下文之外读取文件并程序化注入 Base64 的客户端使用。

知识库 MCP 入口为 `POST /mcp/kb`，新增 `kb_upload_image` 工具，使用带 `mcp:invoke` 作用域的平台 API Key。工具以 Key 对应用户检查启用知识库的正文读写权限，复用 REST 上传的图片校验、同库去重、对象存储及审计流程。

| 参数 | 约束 |
| --- | --- |
| `kb_id` | 必填，目标知识库 UUID |
| `data_base64` | 必填，图片原始字节的标准 Base64 编码，不包含 `data:image/...;base64,` 前缀；原图最多 32 MiB、2500 万像素，支持 PNG、JPEG、GIF、WebP |

仅接受上述两个参数；不接受文件路径或源站 URL。上传成功的 `structuredContent` 包含与 REST 相同的 `name`、`url`、`mime_type`、`size_bytes` 和 `markdown`，`content` 同时提供结果的 JSON 文本。工具业务错误返回 `isError=true`。

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "kb_upload_image",
    "arguments": {
      "kb_id": "<kb-id>",
      "data_base64": "<图片原始字节的标准 Base64>"
    }
  }
}
```

上传调用允许的 JSON 请求体上限为 44,804,780 字节（32 MiB 图片的 Base64 长度加 64 KiB 开销）；其他 MCP 请求仍最多 1 MiB。先通过 `kb_upload_image` 获得 Markdown，再将其合并到正文，通过 `kb_create_document` 或 `kb_update_document` 保存。上传本身不创建文档或触发学习，文档保存仍受现有请求体大小和版本检查约束。

知识库 MCP 现共提供 22 个工具，完整清单见 [内置 MCP 工具清单](knowledge-base-technical-design.md#83-内置-mcp)。返回的图片地址仍受阅读权限保护；MCP API Key 用于上传工具调用，浏览器预览或 REST 读取图片需使用浏览器会话或 OAuth access token。

## 管理端与图片存储

管理端知识库正文编辑器支持粘贴剪贴板图片，自动调用管理端上传接口并在粘贴位置插入 Markdown 图片。一次粘贴多张图片时依次上传；普通文本粘贴保持原有行为。上传期间可以继续输入，插入位置随文档编辑移动，不覆盖后续输入；页面显示上传状态并暂停手动和自动保存。上传失败提示错误并保留草稿；离开页面时取消未完成上传。只读文档不发起上传。浏览器先校验图片格式和 32 MiB 大小限制，真实图片解码和像素限制由后端执行。

图片使用对象存储路径 `knowledge/<kb-id>/assets/<sha256>.<ext>` 和读取接口 `GET /api/kb/{id}/assets/{name}`，不新增数据库表。同库同图复用地址，不同知识库分别存储。读取接口支持浏览器 Cookie 和客户端 Bearer token，逐次检查阅读权限，响应禁止缓存，不公开对象存储 URL。

删除知识库后按 assets 前缀清理对象存储。上传后未引用的图片保留到知识库删除；对象存储写入成功但审计或数据库提交失败时可能留下未引用对象，当前没有自动回收任务。未配置对象存储返回 503，上传失败时不会返回成功地址。

完整请求和响应契约见 `backend/api/admin.yaml` 与 `backend/api/agent.yaml`。后端沿用项目现有 chi 路由、identity 鉴权和 kb 业务层。
