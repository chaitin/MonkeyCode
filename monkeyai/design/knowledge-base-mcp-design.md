# 知识库 MCP 设计

## 1. 入口与调用链

知识库通过独立的 `POST /mcp/kb` 入口向客户端提供 MCP 工具，由 `kb.Service.RegisterMCP` 注册并直接调用知识库业务服务，不经过远程连接器 MCP 网关。

客户端从资源目录取得 `mcp_gateway.url`，使用 `Authorization: Bearer <platform-api-key>` 调用，密钥要求 `mcp:invoke`。目录中的知识库连接器是虚拟资源，不对应 `connectors` 表记录；其固定 ID 仅用于目录和资源选择，调用地址仍是 `/mcp/kb`。

支持 JSON-RPC 2.0 的 `initialize`、`ping`、`tools/list`、`tools/call`，使用 JSON 请求和响应。支持协议版本 `2024-11-05`、`2025-03-26`、`2025-06-18`、`2025-11-25`，服务名为 `baizhi-office-kb`。每次业务调用按密钥对应用户检查目标知识库和文档的有效权限，annotations 不代替授权。

该入口不接入远程 MCP 的计费流水、`mcp_tool_calls` 或会话归属校验。数据模型、学习任务及检索实现见 [知识库技术设计](knowledge-base-technical-design.md)。工具 schema 以 `backend/internal/kb/mcptools.go` 中的 `MCPTools()` 及其辅助函数为准。

## 2. 工具集合

当前提供以下 19 个工具（以 `MCPTools()` 为准），按实际操作对象分为 `kb` 和 `doc`，每个接口独占一行。`kb` 包含知识库信息、授权、标签及库级图片资源；`doc` 包含文档、文件夹和文档内容检索。图片以 `kb_id/name` 定位，不绑定单篇文档；检索虽然可跨知识库，但操作对象是文档分片，因此归入 `doc`。

### 2.1 全部接口与调用边界

**kb：知识库及库级资源（8 个）**

| 接口 | 操作对象 | 功能与调用边界 |
| --- | --- | --- |
| `kb_list` | kb：知识库 | 分页列出可访问且已启用的知识库，支持 owner、关键词和标签过滤 |
| `kb_get` | kb：知识库 | 读取详情、图标地址、有效权限和 revision；仅所有者响应包含完整授权 |
| `kb_create` | kb：知识库 | 创建当前用户的个人知识库，不支持系统库或指定其他所有者；创建无持久化幂等保障 |
| `kb_update` | kb：知识库 | 仅所有者更新本人个人库，必须提供 expected_revision；省略字段保持原值，空更新拒绝；支持名称、说明、标签、融合配置和图标，不支持授权、启停或模型绑定 |
| `kb_list_tags` | kb：标签 | 全量列出可访问且已启用知识库使用的标签 |
| `kb_list_permissions` | kb：授权 | 仅个人库所有者可读取完整授权列表及库 revision |
| `kb_upload_image` | kb：正文图片资源 | 要求启用知识库的正文读写权限；仅供程序化客户端注入 Base64，上传不修改文档；优先使用 REST multipart 通道，凭证和传输限制见第 3 节 |
| `kb_get_image` | kb：正文图片资源 | 以 kb_id/name 读取图片，要求启用知识库的阅读权限；默认返回 image 内容块，include_data=false 仅返回元数据及地址 |

**doc：文档、目录及内容检索（11 个）**

| 接口 | 操作对象 | 功能与调用边界 |
| --- | --- | --- |
| `kb_list_documents` | doc：文档列表 | 分页读取元数据，不返回正文；支持关键词、学习状态和来源过滤，并校验知识库权限 |
| `kb_get_document` | doc：文档 | 默认读取元数据和 revision；include_content=true 兼容全文读取，长文档优先分段读取 |
| `kb_read_document` | doc：文档正文 | 按 Unicode 字符分段读取，默认 4000、最多 16000 字符；续读必须提供首页 expected_revision，文件夹不可读取正文 |
| `kb_create_folder` | doc：文件夹 | 要求正文读写权限；parent_id 必须为同库文件夹，省略、null 或空字符串表示根目录；返回节点元数据，不进入学习队列 |
| `kb_create_document` | doc：文档 | 要求正文读写权限，kb_id/title/content 必填；parent_id 规则同创建文件夹，创建后进入学习队列；创建无持久化幂等保障 |
| `kb_update_document` | doc：文档 | 更新元数据或整体正文，仅正文变化时重新学习；空 content 保留旧值，协作更新必须提供 expected_revision；局部修改或清空正文使用 kb_edit_document |
| `kb_edit_document` | doc：文本正文 | 仅文本文档支持；所有调用者必须提供 expected_revision，最多 50 项精确替换、编辑文本合计最多 256 KiB；原子执行，允许清空正文，成功只返回元数据 |
| `kb_delete_document` | doc：文档或文件夹 | 删除节点并取消活跃学习任务；支持 ids（最多 200 项），协作删除提供 expected_revisions；兼容 document_id/expected_revision，批量结果须逐项检查 succeeded/failed |
| `kb_move_document` | doc：文档或文件夹 | 在同库移动及排序，禁止移入自身或子目录；parent_id 省略或 null 表示根目录，prev_id/next_id 仅用于单项排序；支持 ids 和协作 expected_revisions，兼容 document_id/expected_revision，批量结果须逐项检查 |
| `kb_restudy_document` | doc：文档 | 要求启用知识库的正文读写权限，取消旧活跃任务后按现有索引状态重新学习；支持 ids，兼容 document_id，文件夹不支持，批量结果须逐项检查 |
| `kb_search` | doc：文档分片 | 在可访问知识库中检索，kb_ids 限定范围；自动选择全文或混合检索，top_k 默认 8、最多 20；filters 当前不执行过滤并返回 filters_not_applied，不应依赖它约束结果 |

所有工具保留原始 schema，并提供 `readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint`。annotations 仅为客户端提示，不代替授权。写操作保守标为非幂等；超时或连接中断后先核实实际结果，不盲目重试。批量操作返回 `succeeded/failed`，不能把 HTTP 200 当作全部成功。

长文档优先分段读取，局部修改优先 `kb_edit_document`；整体内容与目录操作继续由知识库服务检查参数和 revision。移动通过 `kb_move_document` 完成，不通过 `kb_update_document` 修改父目录。当前不提供知识库删除、授权更新、启停或全库索引维护工具。

### 2.2 文档编辑流程

1. `kb_list_documents` 定位文档；`kb_get_document` 默认只读取元数据。
2. `kb_read_document` 按 Unicode 字符读取正文，默认 4000、最多 16000 字符；文件夹没有正文，读取会被拒绝。返回 `document.revision`、`next_offset`、`has_more`、`total_characters`。续读必须传首页的 `expected_revision`，冲突则重读，不能拼接不同版本。
3. `kb_edit_document` 传 `kb_id`、`document_id`、`expected_revision` 和 `edits: [{old_text,new_text}]`。最多 50 项，编辑文本合计最多 256 KiB；精确匹配不做空白归一化，不接受正则或模糊匹配。仅 `source_type=text` 的文档可编辑；文件、链接文档和文件夹直接拒绝，避免正文与原始附件元数据不一致。
4. 所有操作在文档行锁、当前写权限及版本检查后顺序执行，后续操作匹配前一步结果。每个 old_text 必须非空且唯一，new_text 必须显式提供，允许空字符串删除。任一步失败整批回滚，索引和学习任务同样不发生部分更新。
5. 返回文档元数据和新 revision，不复制全文。`text_not_found`、`ambiguous_match` 指示匹配失败；`document_revision_conflict` 表示旧版本不可写；`precondition_required` 表示必须读取版本。失败位置使用 edits 的零基索引，匹配次数按包含重叠在内的实际位置计数；空 old_text 与合计超限分别报错。参数结构错误（缺少 new_text、多余字段等）返回具体原因，而不是笼统的“工具参数无效”。

示例工具参数：

```json
{"kb_id":"<uuid>","document_id":"<uuid>","expected_revision":4,"edits":[{"old_text":"截止日期：11 月 30 日","new_text":"截止日期：12 月 1 日"}]}
```

这是版本保护，不是持久化幂等记录。已成功提交后重放旧版本会冲突；若响应丢失，客户端需读取结果核实，不应换用新版本后直接重复应用。创建、移动、删除、重新学习同样不承诺自动重试安全。


## 3. 请求体与文件传输

REST 文档创建和更新接口（用户端 `/api/v1/kb/{id}/documents[/{documentId}]`、管理端 `/api/admin/v1/kb/{id}/documents[/{documentId}]`）允许最大 100 MiB 的完整 JSON 请求体，包含正文、JSON 转义及元数据开销；超限返回 HTTP 413。此限制不等同于原文件大小限制，也不改变 MCP 的 1 MiB 请求体上限。

`kb_create_document` 创建大文档、`kb_update_document` 整体替换大文档时，不得让模型通过 tool calling 生成、复制或传递大段 `content` 参数。完整正文必须由客户端在模型上下文之外读取或准备并程序化注入；这不会绕过 1 MiB JSON 请求体上限。局部修改使用 `kb_edit_document`；缺少程序化注入能力时，提示使用客户端文档上传、导入或编辑入口，不回退为模型输出全文。

图片上传需求优先调用 `POST /api/v1/kb/{id}/images/upload`，使用 `multipart/form-data` 的 `file` 字段，由客户端直接传输图片字节。不要让大模型通过 tool calling 生成、复制或传递图片 Base64 来调用 `kb_upload_image`。REST 需要 Agent 登录凭证，MCP Key 不能替代；缺少上传能力或登录凭证时，应提示用户使用客户端上传入口，不要回退为模型生成 Base64。`kb_upload_image` 仅供能够在模型上下文之外读取文件并程序化注入 Base64 的客户端使用。

| 请求 | HTTP JSON body 上限 |
| --- | --- |
| 默认（包括普通工具、初始化和工具目录） | 1 MiB |
| `tools/call` → `kb_upload_image` | 44,804,780 字节：32 MiB 原图的 Base64 长度 + 64 KiB JSON 开销 |
| `tools/call` → `kb_update` | 2,446,680 字节：1 MiB 图标的 Base64 长度 + 1 MiB 元数据开销 |

知识库独立 MCP handler 先按图片上传上限限制读取，再按 method 和工具名检查实际请求大小。超过限制返回 HTTP 400 和 JSON-RPC error；图片格式、解码后大小和像素限制由知识库服务检查。

现有 `POST /api/v1/kb/{id}/images/upload` 接受 multipart/form-data 的 `file` 字段，由客户端读取和上传图片字节，最大 32 MiB。它需要 Agent 登录凭证；只有 MCP Key 的客户端不能直接调用，且纯模型客户端未必具有本地文件读取/上传能力。该通道不等于已实现 MCP 文件引用上传。

Base64 原图 32 MiB 编码后约 42.7 MiB，模型输出、客户端和代理可能远早于服务端限制失败。图标更新的 avatar_base64 同样仅适用于程序化注入。此次未新增任意 URL 下载或本地路径读取，以免暴露 SSRF 或服务端文件读取能力。统一的受限上传会话/文件引用需要结合实际 Agent 的文件访问与凭证通道另行实现。


程序化客户端上传后可将返回的 Markdown 写入正文；详情见 [知识库图片上传](knowledge-base-image-upload.md)。客户端和反向代理仍需允许对应请求大小及执行时间。

## 4. 返回结果、错误和重试

普通成功结果包含文本 `content` 和 `structuredContent`。`kb_get_image` 默认返回原生 MCP image 内容块；`include_data=false` 时只返回元数据及地址，结构化字段不重复携带图片 Base64。

认证、协议及请求大小错误使用 JSON-RPC error。工具业务错误（包括未知工具）返回 `isError=true` 结果，包含 code、message 和 references；内部错误隐藏底层细节并记录诊断日志。

知识库 MCP 不提供持久化 Idempotency-Key 去重保障。写入失败或连接中断后，客户端应根据读取结果、revision 或批量结果确认实际状态，不能把 HTTP 超时等同于没有副作用。协作写入继续遵守 expected_revision / expected_revisions 约束。

## 5. 验证与兼容性

旧工具名称、默认全文响应和个人库所有者可省略版本的旧调用保持兼容；新局部编辑对所有调用者强制版本。旧创建/全文更新仍受 JSON 请求大小限制。分段正文读取限制的是输出量，底层仍读取完整文档；

业务测试覆盖 Unicode 分段、越界、匹配歧义（含重叠）、编辑参数/大小、事务回滚、旧版本重放、清空正文、只读权限、元数据省略名称、以及带 Bearer 的 HTTP JSON-RPC 读取。HTTP 使用测试认证器，尚未执行真实模型 Agent 的端到端编辑或二进制上传验证。

数据库测试与 HTTP 测试用于证明服务端调用链；不能代替真实 Desktop/Agent 从资源目录获取配置到调用的端到端验证，也不能证明线上代理的 body/timeout 设置正确。线上验证需另外确认 `/mcp/kb` 调用和图片传输。
