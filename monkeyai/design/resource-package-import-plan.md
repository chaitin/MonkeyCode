# 管理端资源包导入方案

> 状态：2026-10-14 已按用户最新要求改为宽松导入，优先让资源包可导入。JSON 仅检查语法，取消发布协议摘要、字段格式和产物一致性检查。五个真实发布 ZIP 的解析、后端测试及静态检查、管理端构建和测试通过。数据库/S3 实际导入与线上部署尚未验收。

## 1. 当前约定

管理员上传 ZIP 或选择解压目录，服务端读取 `manifest.json`，预览资源变化，确认后导入 Skill、Rule、Connector 和 Expert。

- JSON 只要求语法合法。未知字段、字段类型不匹配、缺省字段、名称或 slug 与产物不一致均不作为协议错误拒绝。
- 不重建 canonical manifest，不比对包内 `manifest_sha256`、产物 `sha256` 或 `CHECKSUMS.sha256`。
- `release.json` 和 `CHECKSUMS.sha256` 可省略。提供 `release.json` 时检查其 JSON 语法；校验清单直接忽略。
- 额外文件、非空设计资源和独立静态资源不阻断 Agent 资源导入。设计资源与独立静态资源不落库。
- 导入仍需要能读取实际引用的资源文件。ZIP 解包保留路径、文件类型、文件数量及大小限制。
- 保持已有管理员权限、预览确认、同源资源更新、缺失资源停用和整包事务。

此前方案中关于规范化摘要、字段一致性、严格版本递增和完整校验清单的要求已被上述最新约定替代。

## 2. 解析与缺省值

JSON 通过语法检查后按现有资源模型读取可识别字段；不兼容字段使用零值或默认值。时间等展示元数据不参与日期格式检查。

| 数据 | 导入行为 |
| --- | --- |
| publisher | 取 `release.publisher.name`，去首尾空格并适配数据库长度；缺失时使用 `resource-package`。 |
| release ID | 服务端根据 manifest 文件生成稳定内部 ID，不依赖上传字段是否合法。 |
| version | 优先取 manifest 的可用版本，其次 release，缺失时从 1 开始；内容变化但版本没有递增时，自动使用当前成功版本 + 1。 |
| manifest 摘要 | 记录实际文件的内部指纹，供批次去重使用；不与包内声明比对。 |
| 资源类型 | 按 skills/rules/connectors/experts 分区确定，忽略条目中不一致的 type。 |
| slug | 优先使用条目 slug，其次文件名、名称或类型；适配数据库长度，重名时补充类型与序号。 |
| 名称 | 缺失时使用导入 slug。 |
| 路径 | 使用条目 path；缺失时按分区和 slug 补齐常规 ZIP/JSON 路径。 |
| 多语言 | 读取可识别的字符串映射，合并产物与 manifest；同语言以 manifest 为准，不检查语言标签或翻译一致性。 |
| 来源摘要 | 由服务端记录实际产物或内嵌内容的指纹，不使用上传的摘要作为校验依据。 |

重名后的依赖通过类型与原 slug 解析，避免 Skill 和 Rule 同 slug 时相互覆盖。

## 3. 四类资源

### Skill

读取技能 ZIP 与 `SKILL.md`；`skill.json` 可省略，存在时仅检查 JSON 语法。名称、slug 和翻译不要求与 manifest 一致。

保留现有技能存储格式。对无法直接被技能运行时读取的 frontmatter，尽量补齐安全名称、描述或修复描述引号，并保留正文。预览展示规范化动作，沿用确认流程。技能 ZIP 的路径、展开大小和实际可读性限制仍有效。

### Rule

从 JSON 读取可识别的 `content`，不检查 slug、名称或正文是否为空；不存在的可选字段使用默认值。

### Connector

读取可识别的 config、auth 和 OAuth 字段，不检查 URL、transport、Header Schema、未知字段或认证字段组合。已支持的 Header/OAuth 配置沿用现有映射；不识别的认证模式使用默认映射。

缺省超时为 25000 ms，读取到的超时适配数据库允许的范围。导入不创建凭证，也不请求包内 URL。未知配置能够导入不代表当前 MCP 运行时支持它。

### Expert

`expert.json` 可省略，存在时仅检查 JSON 语法。指令读取 `prompt_path` 指向的文件，缺省为 `agents/expert.md`；头像按声明路径读取，缺省为 `avatar.webp`，不校验文件名或图片格式。

依赖优先复用已解析的同类型资源，其次读取 Expert ZIP 中的内嵌 Skill/Rule。不比较顶层与内嵌依赖的内容摘要。缺失依赖跳过，并在预览 warnings 中明确列出；重复依赖去重。额外文件忽略。

## 4. 导入与已有数据

资源仍以 `(publisher, slug)` 绑定现有系统资源，个人资源和管理员本地资源不会因同名被合并。四类资源的来源只读、独立授权和 Connector 凭证管理沿用现有机制。

预览读取当前资源、绑定及关联，计算新增、更新、跳过、停用和恢复；确认时重读状态并在 publisher 锁下应用。保留实际目标丢失、跨类型绑定、已有外部引用和并发变更等操作冲突检查。

本次包仍是该 publisher 的最终 Agent 清单，缺失资源经确认后停用并保留绑定。相同内部 manifest 指纹可返回已导入结果；内容变化时自动分配可写入的新批次版本，不因上传版本相同或倒退拒绝导入。

`package_sha256`、`plan_digest`、已应用内容指纹和存储包摘要继续用于预览对应、并发保护、去重和存储记录。这些值由服务端产生，不用于验证上传包声明的摘要或字段。

对象存储预写、数据库单事务、失败补偿、审计和历史查询沿用现有实现。本轮未修改迁移、schema、SQL 查询或 SQLC 生成物。

## 5. 管理端与 API

目录上传直接打包目录内文件，不依赖 `CHECKSUMS.sha256` 选择文件；保留文件数、2 GiB 包体及浏览器暂存限制。

管理端操作改称“解析并预览”“重新预览”，静态资源显示“已忽略”，不再声明已做完整性校验。API 文档同步说明 JSON 语法检查、缺省回退及可选元数据。

接口仍为：

- `POST /api/admin/v1/resource-imports/preview`
- `POST /api/admin/v1/resource-imports`
- `GET /api/admin/v1/resource-imports`
- `GET /api/admin/v1/resource-imports/{id}`

## 6. 本轮验证

默认回归覆盖错误摘要和校验清单、可选元数据缺失、字段类型不匹配、名称不一致、未知认证字段、自定义指令/头像路径、缺失依赖提示、跨类型同 slug，以及非法 JSON 语法拒绝。

显式设置 `MONKEYAI_RELEASE_FIXTURE_ZIP` 验证原始 ZIP 的 `ParseReader` 与 `ParseResources`：

| 原始 ZIP | Skill | Rule | Connector | Expert | 结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| r0008 | 6 | 1 | 1 | 0 | 通过 |
| r0013 | 16 | 1 | 1 | 1 | 通过 |
| r0016 | 34 | 1 | 2 | 2 | 通过 |
| r0017 | 294 | 2 | 1 | 18 | 通过 |
| r0019 | 291 | 3 | 2 | 16 | 通过 |

数量包含从 Expert 解析出的独占资源。

- [x] 取消发布协议摘要及字段拒绝规则。
- [x] 实现缺省值、重名资源和缺失依赖的回退。
- [x] 更新目录打包、管理端文案和 API 描述。
- [x] `go test ./internal/resourceimport/... -count=1`。
- [x] `go test ./...`、`go vet ./...`。
- [x] 五个真实发布 ZIP 解析。
- [x] 管理端 `pnpm build`、`pnpm test`（198 项通过）及修改页面 ESLint。
- [x] OpenAPI YAML 解析与 `git diff --check`。
- [ ] 数据库/S3 实际导入和部署后 HTTP 验收：按此前选择，未启动独立数据库验收环境；修复尚未部署。
