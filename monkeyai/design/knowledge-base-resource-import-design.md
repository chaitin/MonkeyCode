# PandaWiki 知识库资源包导出与导入

> 更新：2026-11-16。本文记录本次代码实现。测试结果见文末；未部署到线上。
>
> 当前链路：PandaWiki 前台 URL → Python 脚本 → 知识库 ZIP → 管理后台导入资源包 → 系统知识库 → 异步学习与检索。

## 1. 当前交付与范围

- 导出脚本：`monkeyai/scripts/pandawiki_kbpack.py`，输入首页或文档 URL，读取该站点当前访问身份可发现的整个目录与正文。
- 管理端：复用“导入资源包”的上传、分卷续传、预览、确认和历史入口，新增 `knowledge` 分区。
- 后端：严格校验文件清单、摘要、目录树，知识库分区内单事务创建库、标签、文件夹、正文、学习任务和成功回执。
- 每次新上传确认导入均创建独立系统知识库，即使 ZIP、publisher/release 完全相同；不覆盖已导入或人工编辑的内容。同一次上传的确认重试复用成功回执。
- 新库默认启用且不创建成员授权，即仅管理员可见；导入后在知识库页面配置只读/读写授权。

本次不实现原草案中的字段级增量合并、冲突决策、原库覆盖、缺失节点删除、发布回滚、头像迁移、浏览器 DOM 降级及服务器数据库导出。这些不是本轮功能前提。知识库资源包不沿用 Agent 分区“缺失项停用”的行为。

## 2. 使用方式

以下命令从仓库根目录执行，需要 Python 3.10+。纯 Markdown 文档只依赖标准库；HTML 正文需安装固定版本的转换依赖，建议预先安装以兼容混合内容站点。

```bash
python3 -m venv /tmp/pandawiki-kbpack-venv
/tmp/pandawiki-kbpack-venv/bin/pip install -r monkeyai/scripts/requirements-kbpack.txt
/tmp/pandawiki-kbpack-venv/bin/python monkeyai/scripts/pandawiki_kbpack.py \
  https://work.docs.baizhi.cloud/ \
  --name "百智办公文档" \
  -o /tmp/baizhi-work-knowledge.zip
```

也接受某篇文档的前台 URL，但仍按所属站点的整个可发现目录导出，不默认只取单篇。站点部署在路径前缀下时，优先探测该前缀下的 share 接口，再尝试父级路径。

生成两份文件：

- `baizhi-work-knowledge.zip`：上传到管理端的资源包。
- `baizhi-work-knowledge.report.json`：包外采集报告，包括成功篇数、已发现的失败条目、转换警告、图片数量、图片字节数；未知隐藏数量为 null。

默认不覆盖已有 ZIP。出现不可读、空正文等文档时先写报告、不生成正式 ZIP；明确接受遗漏时添加 `--allow-partial`。如果抓取前后的目录响应不同，始终中止，不能用部分导出选项绕过目录变化。

需要登录的站点可通过 `--cookies /path/to/source-cookies.txt` 传入当前有权阅读的 Netscape 格式 Cookie 文件。脚本不提供登录、验证码或浏览器会话自动提取功能。通常不需要知道 kb_id；只有源部署未通过网关注入库身份时，才补充 `--kb-id`。脚本不修改 PandaWiki 内容或权限。

其他参数：`--source-id` 固定源实例别名、`--timeout` 设置单请求超时、`--max-nodes` 设置采集节点上限（默认 50,000，含合成导航文件夹）。站点域名/前缀和 kb_id 参与默认身份计算；变更地址后如需保持原来源，应固定相应输入，不假设自动识别跨域实例。

## 3. 管理后台导入步骤

1. 更新后端数据库到迁移 `000042_kb_resource_import`，同时部署本次后端与管理端。
2. 打开资源导入页面，选择“导入资源包”，上传生成的 ZIP。
3. 上传完成后识别到“知识库”分区，选择该分区并解析预览。
4. 预览显示每个知识库名称、文档数、文件夹数、图片数，以及新增状态。
5. 勾选确认并导入。成功后到知识库页面查看目录、学习状态并配置成员授权。

“导入成功”表示内容与学习任务已持久化，不表示所有文档已完成学习。没有向量模型时仍可进行全文学习；模型可用时沿用现有自动绑定与向量索引机制。

包中同时存在 Agent、设计和知识库时可以选择部分分区。每个分区各自事务提交，允许部分成功，失败分区重新预览后重试。knowledge-only 包必须显式选择分区，不能回落为 Agent 空清单而停用 Agent。

## 4. PandaWiki 前台读取方式

本地核查路径：`/Users/coltea/GoProjects/PandaWiki`。

- `backend/handler/share/node.go`：`GET /share/v1/node/list` 返回按导航分组的目录；`GET /share/v1/node/detail?id=...&format=raw` 返回正文。
- `backend/middleware/share_auth.go`：库级匿名/简单认证/企业认证控制；受限站点需要正常会话。
- `backend/usecase/node.go`：目录按 visible 过滤，正文另校验 visitable；目录可见不等于正文可读。
- `backend/repo/pg/node.go`：分享接口依赖最新知识库发布及其文档发布关联，不直接读取当前草稿正文；部分权限和排序来自当前节点记录。
- `backend/domain/node.go`：type=1 是文件夹、type=2 是文档，正文类型有 md/html。

脚本直接调用页面本来使用的前台只读接口，不要求后台账号、内部服务地址或数据库权限。HTTP 200 还须满足 PandaWiki `success=true`；业务失败、登录页 HTML 和权限失败不能当正文保存。只允许同源重定向，防止向其他域名转发请求上下文。

无法通过当前前台目录接口访问的部署会报错。本轮没有实现任意网站爬虫、Playwright 浏览器登录、Next.js 页面数据反序列化或 DOM 提取。目录前后检查只能检测部分变化，属于尽力一致，不保证数据库快照级一致性。

## 5. 内容规范化

| 来源 | 目标 |
| --- | --- |
| 导航分组 nav_id | 合成顶层文件夹，`nav-<sha256>` key |
| 原 node_id | 稳定的 `node-<sha256>` key |
| 文件夹/文档类型 | folder / document |
| parent_id | parent_key，根节点放在对应导航文件夹下 |
| 同级 position | 按 position、稳定 key 排序后映射为非负整数 order |
| Markdown 正文 | 保留文本，简单内联 Markdown 相对链接改为源站绝对链接 |
| HTML 正文 | 使用 markdownify/BeautifulSoup 转为 Markdown，移除 script/style/iframe/object |
| 图片 | 下载 PNG/JPEG/GIF/WebP（含 data URI），按内容摘要去重写入 assets，正文改写包内相对路径；导入后保存至本地对象存储并替换本系统读取地址 |
| 普通附件与非图片媒体 | 保留原链接，未实现二进制迁移 |
| 原权限/用户/分组/模型/向量 | 不复制 |

`format=raw` 不代表正文一定是 Markdown，仍根据 meta.content_type 和内容特征选择转换方式。HTML 转换不保证自定义组件、复杂表格和嵌入媒体无损。图片支持内联 Markdown（含尖括号目标、标题和括号）、引用式图片、HTML img 与内嵌 Base64；普通链接和自定义组件不作完整语法重写。SVG 等不支持的图片类型、图片下载失败或返回登录页均按整篇采集失败处理，默认不产包；`--allow-partial` 可显式跳过这些文档。普通附件仍依赖源站。

父文件夹未出现在可见目录中、目录有环、源节点 ID 重复等结构异常会中止，不自动伪造源目录。空正文不填充虚假占位内容，按采集失败处理。

## 6. 知识库资源包 v1

```text
manifest.json
knowledge/<slug>/kb.json
knowledge/<slug>/tree.json
knowledge/<slug>/documents/<node-key>.md
knowledge/<slug>/assets/<sha256>.<png|jpg|gif|webp>
```

`manifest.json` 示例，文件 SHA/size 必须由脚本计算真实值：

```json
{
  "knowledge_resources": {
    "schema_version": 1,
    "publisher_id": "pandawiki-example",
    "release_id": "r-example",
    "knowledge_bases": [
      {
        "slug": "manual",
        "metadata_path": "knowledge/manual/kb.json",
        "tree_path": "knowledge/manual/tree.json",
        "files": [
          {"path": "knowledge/manual/kb.json", "sha256": "sha256:<64 hex>", "size": 123},
          {"path": "knowledge/manual/tree.json", "sha256": "sha256:<64 hex>", "size": 456},
          {"path": "knowledge/manual/doc.md", "sha256": "sha256:<64 hex>", "size": 789}
        ]
      }
    ]
  }
}
```

`kb.json`：

```json
{"name":"产品手册","description":"操作说明","tags":["PandaWiki"]}
```

`tree.json`：

```json
{
  "nodes": [
    {"key":"folder","node_type":"folder","parent_key":null,"order":0,"title":"入门"},
    {"key":"document","node_type":"document","parent_key":"folder","order":0,"title":"操作说明","content_path":"knowledge/manual/doc.md","source_type":"text"}
  ]
}
```

publisher_id/release_id/slug/key 匹配 `[A-Za-z0-9][A-Za-z0-9_-]{0,127}`。文件必须位于所属 `knowledge/<slug>/` 下，元数据、树、正文和图片都需进入 files 清单，SHA-256 格式带 `sha256:` 前缀。

节点同库 key 唯一，父节点必须是同库文件夹，禁止环；同父节点 order 唯一。文档支持 text/file 来源，缺省 text，可选 file_name/mime_type；正文必须为非空 UTF-8。文件夹不得携带正文属性。首期不接受 avatar、用户授权和模型字段。

后端拒绝 JSON 重复键、未知业务字段、非法类型、路径穿越、符号链接、大小写折叠后的重复 ZIP 路径、文件/目录冲突和文件摘要不匹配。只对选中分区做业务解析，但整个归档仍受公共路径检查约束。

容量：外包 ≤2 GiB，ZIP 展开总量 ≤4 GiB，单篇正文 ≤8 MiB，单个清单/元数据文件 ≤32 MiB，知识库 ≤100 个，节点总数 ≤50,000。脚本当前把采集正文暂存在内存后打包，适用于普通文档站；未完成 GiB 级容量压测，不把理论上限表述为已验证吞吐能力。

图片在正文中使用 `../assets/<sha256>.<ext>`，摘要为无前缀小写十六进制。后端校验文件头、扩展名与实际内容摘要，并拒绝指向缺失图片的引用。单张图片 ≤32 MiB；不允许 SVG。图片直接存于对象存储 `knowledge/<知识库ID>/assets/<sha256>.<ext>`，由路径确定归属，不建立图片关联表。读取时从图片二进制确定 MIME、大小并校验摘要，不查询图片记录。导入后正文中的图片路径替换为 `/api/kb/<id>/assets/<name>`。

图片读取支持浏览器 Cookie 和 Agent Bearer token：管理员可读未删除库；普通用户须有启用库的阅读权限。逐次鉴权并禁用响应缓存，撤销授权或删除知识库后不能继续通过接口读取。该路径需和前后端部署在同一服务域；外部 Markdown 阅读器需携带身份访问本系统图片。

## 7. 导入事务、幂等与权限

publisher_id/release_id 只保留为来源信息，不作为导入去重键，不建立发布记录表。包摘要用于绑定预览与确认，不用于跨上传去重。

每次新上传确认导入都生成新的知识库 ID，并复用 `kb` 模块已有校验、模型选择、标签、目录和学习任务能力。数据库业务写入与 `resource_import_sections` 成功回执同事务提交。同一次 upload 的重复确认返回原结果；重新上传同一个 ZIP 则创建新库、新文档和学习任务，不按库名或发布版本合并。

图片按知识库 ID 隔离，相同图片在不同库中各自存储。删除知识库提交成功后，S3 存储按该库 assets 前缀清理图片，不影响其他库。清理失败记录日志，知识库已删除，图片读取接口无法再访问；当前没有持久化的后台清理重试队列。对象存储写入发生在数据库提交前，回滚可能留下无对应知识库的目录，同样无法经接口访问，暂未实现孤儿目录的自动回收。

历史页显示知识库资源包及文档统计。新库默认无普通成员授权，原 PandaWiki 权限不跨系统复制。

后端已有 chi、pgx、sqlc 工作流，直接沿用；不为本功能新增 GoFrame 控制器。SQL 与业务实现归属 `internal/kb`，导入协调器通过窄接口调用，不直接写知识库业务表。

## 8. 两种获取条件的边界

| 获取条件 | 本轮支持 | 后续方向 |
| --- | --- | --- |
| 只有 Web URL | 可访问的前台目录和发布正文；需要认证时可补充正常阅读会话 | 浏览器渲染降级、局部子树选择、断点续采 |
| 有服务器访问权限 | 本轮不实现数据库适配器，仍可运行 URL 导出脚本 | 在源服务器以只读 REPEATABLE READ 事务导出固定 published 或显式 draft |

服务器导出不能简单复制 nodes 当作已发布内容。published 必须固定 kb_releases.id，再通过 kb_release_node_releases 关联 node_releases 和匹配导航；draft 才读取 nodes 当前正文。两个模式不得默默混用。正文位于 PostgreSQL，有服务器 Shell 还需实际数据库读取条件；完整媒体迁移还需对象存储读取条件。未来两条路径共用此 v1 包，不改变目标导入接口。

## 9. 验证与部署

真实来源：[百智办公文档](https://work.docs.baizhi.cloud/)。本轮采集得到 32 篇可访问正文、119 张去重图片，含图测试 ZIP（约 46 MiB）保存在 `/tmp/baizhi-work-with-images.zip`，不提交真实大包到 Git。

代码验证覆盖：脚本本地 HTTP 夹具、HTML 转换、失败不产包、显式部分导出、目录变化中止、重复导出字节稳定、包篡改拒绝；后端格式错误、未知字段、重复 JSON 键、目录环和路径穿越；真实包管理端 HTTP 上传/封存/发现/预览/确认、事务回滚、相同 ZIP 跨上传创建新库、同 upload 重试复用结果、无额外授权与学习任务。

后端知识库测试另运行 worker 验证 32 篇正文生成 79 个检索分片；图片另验证引用替换、读取原始字节、未授权拒绝、授权后读取、撤销及删除后拒绝。完整测试结果以本次交付回复为准。尚未完成生产部署和线上管理员账号的浏览器验收。

本次检查结果：Python 8 项测试通过；后端 `go test ./...`、`go vet ./...` 与 `make sqlc-check` 通过；真实含图包的上传/封存/预览/导入/重复导入/回滚及学习测试通过；图片按库隔离、授权、撤销、删除及目录清理测试通过；管理端构建、15 项导入相关测试与模拟接口的浏览器确认流程通过。管理端全量测试存在与本次改动无关的 `knowledge-bases-i18n` 阿拉伯语翻译键缺失失败，未将其计为通过。

部署必须同步发布前后端并执行新增迁移；不能只把 ZIP 上传到未升级的旧后台。迁移仅扩展已有分区约束，不新增知识库导入表。回滚移除知识库分区回执并恢复约束，不删除已有库、正文或对象存储图片。

## 10. 相关文档

- [现有资源包导入](resource-package-import-plan.md)
- [分卷上传与续传](resource-package-volumes-plan.md)
- [设计资源分区导入](design-resource-import-plan.md)
- [知识库技术设计](knowledge-base-technical-design.md)
- [知识库权限方案](knowledge-base-permissions-design.md)
