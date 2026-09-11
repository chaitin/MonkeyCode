# 技能、专家、工具、规则功能完善方案

> 2026-09-11 迁移收敛：按本轮重新部署要求，原 1–13 版已折叠到 `000001` 完整初始化结构，仅支持全新数据库。下文旧增量迁移及验收记录保留为实施历史，当前部署以 [数据库迁移说明](../backend/migrations/README.md) 为准。

> 本轮迁移收敛验收已完成：316 项 Go 测试全部通过，失败与跳过均为 0；`go vet ./...`、`make sqlc-check`、OpenAPI 重复字段与本地引用检查通过。PostgreSQL 18.6 验证 `version=1, dirty=false`、重复 up 无变化及带业务数据的 down/up；迁移镜像构建通过且只含一对 `000001` SQL。旧 13 版与新初始化的字段、索引、函数和触发器一致，余额约束从空库直接验证，钱包地址的非空约束使用最终字段名。代码已完成，现有部署数据库未操作。

> 2026-09-11 实施更新：Connector 简化与多凭证认证已实施，完整方案见 [连接与多凭证认证设计](connector-auth-design.md)。本文保留早期实现历史，当前 Connector 契约以新方案和 OpenAPI 为准。

> 状态：本次管理后台、后端与 Agent 资源下发 API 已实现，本地验收完成，进入 PR 评审阶段。
>
> 2026-09-08 补充：根节点全员授权已实现，数据库集成测试、前端检查和交互验证已通过；发布时需应用 `000007_resource_all_users_grant` 迁移。
>
> 基线：2026-09-07 的 main，提交 `1d1e9181`。
>
> 范围：当前 `monkeyai/admin`、`monkeyai/backend`，以及面向工作 Agent 的资源下发契约。
>
> 存储选型：引入 RustFS，作为资源文件的默认对象存储，通过 S3 兼容 API 接入。
>
> 本轮确认：前端尽可能保留原有样式；用户将重新部署，数据库 schema 收敛为版本 `000001` 的完整初始化结构。
>
> PR #1234 仅作为实体与关系的参考；本文针对当前工程重新确定管理流程、授权、接口和实施顺序。本文的新增领域术语为方案建议，实施时同步更新 `backend/CONTEXT.md`。

## 1. 交付目标与边界

完成“管理员配置资源 → 后端持久化与授权 → 工作 Agent 获取实际可用资源”的闭环。四个资源页面刷新后保留数据，关联选项来自真实数据，技能可以下载原始文件，MCP 连接测试与工具发现访问真实服务。

资源文件统一保存到 RustFS。PostgreSQL 保存资源定义、关系、授权、规则正文、专家 Prompt 和对象元数据；RustFS 保存技能 ZIP、Connector 图标及后续新增的资源附件。

本方案按服务端下发 API 和接入契约设计。Agent 可以读取规则正文、专家配置、技能包元数据与下载内容，以及 Connector 的认证状态和工具目录。Desktop / OhMyAgent 如何将这些数据写入本地文件、加载到运行时，作为消费契约描述，不在本次管理后台工程中实现。

“资源下发”与“MCP 执行代理”有独立的完成标准。本次不把尚不存在的网关地址放入配置：工具下发返回真实的连接资源描述和目录。后续接通生产调用时，再增加使用现有 `mcp:invoke` 调用密钥的 MCP 网关。当前工具页面的每次积分完成配置存储与展示，实际扣费需要后续计费能力，不能以配置保存代替扣费验收。

服务端专家保持单 Agent 系统预设。个人技能、规则和 Connector 的现有页签改为真实查询与管理能力；本次管理后台创建系统资源，不新增个人资源创作客户端。知识库关联、专家 ZIP 导入导出、多 Agent 编排不作为这次四类资源接入的前提。

## 2. 当前实现与缺口

| 部分 | 已有实现 | 本次需要补齐 |
| --- | --- | --- |
| 管理基础 | React 19、TypeScript、shadcn/ui、路由、多语言、Cookie 管理员会话 | 以原有样式为基线，优先只替换数据与事件处理；在现有组件内补充必要状态 |
| 模型管理 | 管理 CRUD、用户/分组授权、Agent 可用模型查询 | 复用接口和事务组织方式；会话独立选择模型 |
| 技能 | 卡片、系统/个人页签、ZIP/目录批量发现、正文预览与编辑 | 文件字节上传、后端独立解析、RustFS 存储、标签与授权持久化 |
| 规则 | 卡片、编辑、强制范围选择 | 区分可用范围与强制范围，数据库 CRUD、授权下发 |
| 工具 | MCP 配置表单、工具弹窗、认证与测试的展示原型 | Provider/Connector 数据、真实凭证状态、真实测试和目录发现 |
| 专家 | Prompt、资源关联、复制、启停 | 动态资源选项、关系约束、依赖检查、资源清单 |
| 后端业务包 | `skill`、`rule`、`mcp`、`expert`、`resource` 主要只有 `doc.go` | 完整业务服务、数据访问、Admin/Agent DTO 和路由 |
| 下发 | 按资源类型提供独立接口、SHA-256 版本与 ETag/304 | 保证授权过滤、内容变更与删除均影响对应资源版本 |
| 文件与部署 | PostgreSQL 与迁移容器，后端只读文件系统和临时目录 | RustFS 容器与持久化、Bucket 初始化、S3 适配、上传限制与受控下载 |

需要特别处理的现状：

- `SkillImportWizard` 的回调只有分析结果和文件名，没有保留可上传的包内容；正式导入必须保留候选项对应的源文件和根目录。
- 四类资源主要使用模拟分组和成员 ID；模型页已经使用真实授权对象，可以沿用其数据装配方式。
- 成员页当前只提供全部用户和管理员视图，不能把 `engineering` 等原型分组当成数据库记录。
- 当前迁移仍有 `skills.instructions`、`mcp_servers`、`expert_mcp_tools`；本次将现有四版 schema 与目标资源结构整理为一版最终初始化 DDL，供重新部署使用。
- `admin/src/lib/api.ts` 默认给有请求体的请求设置 JSON 类型，需要支持 `FormData`，让浏览器生成 multipart boundary。

## 3. 数据模型取舍

### 3.1 资源与授权

复用 `resource_access_grants`、`tags` 和 `resource_tags`，不新增统一资源主表或通用文件表。资源类型中的 `mcp_server` 改为 `connector`。

- 管理后台的系统资源由管理员编辑，授权给用户或分组的访问级别先固定为 `read_only`，与当前模型管理接口一致。
- 系统资源允许暂时没有授权对象，表示仅管理员可见；可以先完成配置，再分配使用范围。
- 个人技能保留所有者及已有分享关系，个人规则仅创建者可用；管理后台展示来源、所有者和被引用情况，治理删除必须检查引用并记录操作者。
- 个人 Connector 仅所有者可用；后台不展示个人认证 Header 或 Token，不以管理员身份替个人执行重新授权。
- 父分组授权覆盖后代分组用户；同一资源命中多个授权时取并集，规则的 `required` 优先于 `optional`。
- Provider 描述连接方式，不参与资源访问授权。系统 Provider 可见不等于其 Connector 可用。

提供真实的授权对象查询。不预置分组，界面根节点代表全体用户；选择根节点时保存 `all_users=true` 的全员授权，不引用分组记录，也不展开为当前用户快照。普通分组授权按 `group_users` 的直接关系及未删除的上级分组解析，不按顶层位置或管理员角色自动授予。模型与其他资源使用同样的授权语义，新资源须由管理员显式选择全体用户、授权用户或真实分组。

### 3.2 技能与规则

| 实体 | 字段与处理 |
| --- | --- |
| `skills` | 保留所有权、名称、描述、包文件名、S3 key、大小、SHA-256、文件数、启停与软删除；删除重复的 `instructions` |
| `rules` | 保留所有权、名称、正文、时间和软删除；沿用当前无 `enabled` 的模型 |
| `resource_tags` | 保存技能与标签的真实关联；系统标签词表复用 `tags` |
| `resource_access_grants` | 规则按授权对象记录 `usage_requirement`，不是规则表上的全局强制布尔值 |

系统名称按规范化名称唯一，个人名称按所有者与规范化名称唯一；规范化使用去除首尾空格和统一大小写。技能的规范名称以 `SKILL.md` 为准，名称必须能安全作为单个目录名。

技能包中 `SKILL.md` 是正文与名称、描述的权威来源。后台编辑正文或这些元信息时，服务端重建包、生成新对象和摘要，然后更新业务记录；不能只修改数据库的名称或正文显示缓存。

管理编辑采用单资源 ETag / `If-Match` 防止覆盖他人的更新。可增加 `revision bigint` 作为行级乐观锁；该字段不构成历史版本管理。

### 3.3 工具：定义、连接与认证上下文

采用 Provider → Connector → Credential 的拆分，但工具目录必须隔离实例和认证上下文。

| 实体 | 主要内容 |
| --- | --- |
| `connector_providers` | 稳定 identifier、名称、描述、图标元数据、HTTP 连接模板、认证模式/方式、Header Schema、OAuth 配置、启停和所有权 |
| `connectors` | Provider、所有权、名称、实际非密钥连接配置、实例绑定的服务端 OAuth Client Secret、启停、配置修订号、连接状态与最后测试信息 |
| `connector_credentials` | Connector、独立认证用户或集中认证标识、Header/Token、过期与撤销状态；敏感值只写不读 |
| `mcp_tools` | Connector、可空 Credential ID、上游精确名称、描述、Schema、启停、每次积分、发现时间、目录对应的配置修订号、软删除 |
| `connector_oauth_requests` | 短期 OAuth 事务：用户、Connector、配置修订号、state/PKCE、回调与过期/消费状态；独立于 MonkeyAI 登录 OAuth |

目录唯一键为 `(connector_id, credential_id, name)`，使用 PostgreSQL `NULLS NOT DISTINCT` 约束无凭证上下文。`none` 使用空 Credential；集中认证使用共享 Credential；独立认证使用当前用户的 Credential。工具名按上游精确大小写保存与匹配。

这样同一 Provider 的不同实例、同一独立认证 Connector 的不同用户都不会互相覆盖目录。每次完整读取全部 `tools/list` 分页后，才在单个事务内更新对应目录；请求失败不清空旧目录。保留同名工具的管理员启停和积分设置，新发现工具默认禁用，由管理员选择开放。Admin 明确显示当前查看的实例和认证上下文。

实例创建时复制模板的非密钥配置，并将匹配的 OAuth Client Secret 复制到实例的服务端专用字段；API 只序列化非密钥配置。后续模板变更由管理员明确应用到选定实例。Token 交换和刷新读取同一实例绑定的 Client ID、端点和 Secret，不拼接旧实例与 Provider 当前 Secret。更换 OAuth 应用使用新 Provider；同一应用 Secret 轮换需事务更新所有仍绑定该应用的实例。Header 结构或 URL 变化时，使相应凭证/目录失效并要求重新配置或测试。

带集中凭证的连接目标只能由管理员修改；实例 URL 覆盖受 Provider 允许目标约束，修改目标必须显式处理已有凭证。连接测试和 Discovery 请求共用出站访问规则，覆盖地址解析与重定向；私有网络接入通过部署侧明确配置允许范围。

保留 `none`、`centralized`、`independent` 以及 Header/OAuth 能力。OAuth 统一由服务端生成授权事务、处理固定回调、交换和刷新 Token；Admin 或 Agent 只获取浏览器授权 URL 和结果状态。避免把这项后台接入绑定到 OhMyAgent 的 localhost callback 实现。

### 3.4 专家

保留 `experts.prompt`、名称、描述、启停和软删除，专家不关联模型。使用 `expert_rules`、`expert_skills` 和 `expert_connector_providers` 维护关系。

Provider 关系保存 `required`、工具白名单和黑名单。专家不绑定账号凭证；下发时返回当前用户可选的 Connector ID，具体选择由消费端提交或使用。

- 系统专家只引用系统规则、系统技能和系统 Provider；关系不能重复。
- 规则、技能按规范化名称与 ID 稳定排序；黑名单优先于白名单，工具名称精确匹配。
- 关联资源删除返回 `409 resource_in_use` 和引用它的专家列表；解除关联后才能删除。
- 会话模型由用户独立选择并校验授权，模型变化不影响专家可用性或资源清单版本。
- 绑定技能禁用、必需 Connector 缺失等问题显式返回，不静默产生缺少关键能力的专家。
- 专家清单摘要在读取时按实际资源内容计算，不要求修改一个 Rule 时批量写回所有专家。规模扩大后可增加缓存。

## 4. 管理后台交互

以当前四个页面的视觉与交互结构作为验收基线，尽可能原样保留导航、系统/个人页签、卡片/列表、按钮位置、弹窗结构和导入步骤。字体、颜色、间距、圆角、图标及明暗主题继续使用现有组件与样式变量。

前端改动优先集中在真实数据加载、表单提交、授权对象、资源关联和错误处理。新增字段放入原有表单分组或弹窗，加载、空状态和失败提示使用现有组件；确需增加入口时沿用邻近操作的呈现方式。空数据库显示真实空状态，原型数据不进入正式列表。

| 页面 | 完整操作流程 |
| --- | --- |
| 技能 | 系统/个人查询、搜索和标签筛选；ZIP/目录批量导入；预览正文与包信息；编辑正文或替换包；授权、标签、启停、下载与删除 |
| 规则 | 系统/个人查询；新建、编辑和删除；分别配置“可使用范围”“必须使用范围”；查看引用专家 |
| 工具 | 保留当前连接列表/卡片、操作菜单和工具弹窗；现有创建/编辑弹窗增加模板选择及必要字段；模板管理通过当前工具页内的轻量入口和弹窗提供 |
| 专家 | 新建、复制、编辑、启停、删除、授权；选择真实 Rule、Skill、Provider；设置必需依赖和工具过滤；预览有效清单与依赖问题 |

规则的必须使用范围自动包含在可使用范围内。空强制范围代表普通可选规则，不能沿用现有表单“没有强制对象就不能保存”的行为。

技能导入保持多 ZIP、目录、多技能选择的现有能力。每个候选项保留源文件/目录根，在提交前形成以该技能 `SKILL.md` 为根的独立 ZIP。新建技能提交包、标签和授权；更新已有技能通过明确的更新入口，遇到同名冲突显示原资源并允许跳过或选择更新。

批量导入逐项显示上传、校验、成功和失败，成功项保留服务器 ID，失败项允许单独重试。请求结果不明时先核对已存在记录与包摘要，不能盲目再次创建。

跨页面统一处理：加载骨架、空状态、失败重试、表单保留输入、字段级错误、保存中禁止重复提交、删除影响提示和编辑冲突提示。提交失败后把焦点移到可访问的错误汇总，字段仍保留就地错误。所有操作以服务端响应更新页面状态。

## 5. 后端边界与文件处理

沿用模块化单体和显式路由注册，不增加业务框架层。

| 包 | 责任 |
| --- | --- |
| `identity` | 用户/分组解析、管理员与 Agent 身份；提供真实授权主体 |
| `resource` | 标签、授权关系、有效访问权计算，以及通过 S3 API 读写 RustFS 对象 |
| `skill` | ZIP 验证、包内容解析/重建、技能业务与文件下载鉴权 |
| `rule` | 正文管理、可选/强制使用语义 |
| `mcp` | Provider、Connector、Credential、OAuth、连接测试、工具目录与配置 |
| `expert` | 专家关系、依赖校验、按用户生成资源清单 |
| `agentconfig` | 按资源类型下发脱敏目录，解析专家依赖并生成独立 ETag |
| `audit` | 为本次资源写操作保存必要的管理审计记录 |
| `app` | 统一构造依赖、注册路由、管理 OAuth/临时文件清理生命周期 |

业务包分别暴露 Admin 与 Agent handler，复用业务服务但不共用请求 DTO。跨业务小接口定义在使用方；具体 SQL 留在所属业务目录。复用现有 pgx 实现方式，新增查询按既有 sqlc 方向组织，生成文件由工具产生。共享 API、单版初始化 schema、依赖及应用组装统一集成。

文件上传以服务端校验为准。沿用当前前端限制作为默认值：单包 20 MiB、展开 50 MiB、500 个文件、`SKILL.md` 512 KiB；限制从实际流式读取计数，拒绝路径穿越、符号链接、重复/冲突路径和无法解析的 frontmatter。后台批量目录选择也必须满足每项及整批资源上限。

包文件和图标写入 RustFS 不可变 key。成功上传与校验后，在事务中切换业务指针；失败则保留旧记录并清理本次临时对象。RustFS 与 PostgreSQL 的一致性通过先写对象、后切换数据库指针保证，孤儿对象通过有宽限期的清理任务处理，删除前重新检查引用。

数据库只记录当前对象元数据，文件下载通过业务资源接口查权限。默认由后端鉴权后流式返回文件，客户端始终访问稳定的业务下载路径；部署需要直传时可另外签发短期 URL，不把它纳入配置版本摘要。后端只读根目录保留，临时文件放 `/tmp`，正式文件仅放对象存储。

### 5.1 RustFS 对象组织与后端接入

默认使用私有 Bucket `monkeyai-resources`，配置允许覆盖名称。沿用业务表中的 `package_s3_key`、`icon_s3_key` 等字段，保存相对于 Bucket 的对象 key。

| 对象 | Key 约定 |
| --- | --- |
| 技能包 | `skills/<skill-id>/<object-id>/package.zip` |
| Connector 图标 | `connector-icons/<provider-id>/<object-id>/icon.<ext>` |
| 上传临时对象 | `tmp/<upload-id>/...` |

`object-id` 由服务端生成，每次文件变更写入新对象。原始文件名保存在业务元数据中。SHA-256 由后端读取实际字节计算，下载时供客户端校验；不把 S3 ETag 当作内容 SHA-256。

后端使用 AWS SDK for Go v2 的 S3 客户端，配置自定义 Endpoint、Region、静态访问凭据和 path-style 寻址；所需依赖由集成任务统一加入。`resource` 包提供当前用例需要的上传、读取、检查、删除等能力，业务包继续负责资源权限和格式校验。

客户端上传的文件先经过后端鉴权和大小/格式检查，再写 RustFS；下载经过后端鉴权和流式转发。浏览器与 Agent 不需要 RustFS 登录态、S3 凭据、Bucket 公共权限或跨域配置。后续启用预签名直传时，再配置客户端可达的对象存储地址；Docker 内部的 `rustfs` 主机名不能直接下发给客户端。

## 6. API 草案

管理 API 统一位于 `/api/admin/v1`，资源读写采用管理员会话。保存资源与标签/授权/依赖关系在事务内完成。新接口统一返回 `{error: {code, message, fields?, references?}}`，区分无权、未找到、名称冲突、引用冲突、并发修改和上游失败。

| 接口组 | 主要接口 |
| --- | --- |
| 授权与标签 | `GET /resources/authorization-subjects`；`GET/POST /tags`；`PUT/DELETE /tags/{id}`；`GET/PUT /resources/{type}/{id}/grants` |
| 技能 | `GET/POST /skills`；`GET/PUT/DELETE /skills/{id}`；`PATCH /skills/{id}/enabled`；`GET/PUT /skills/{id}/package`；`GET /skills/{id}/manifest` |
| 规则 | `GET/POST /rules`；`GET/PUT/DELETE /rules/{id}` |
| Provider | `GET/POST /connector-providers`；`GET/PUT/DELETE /connector-providers/{id}`；`PATCH /connector-providers/{id}/enabled` |
| Connector | `GET/POST /connectors`；`GET/PUT/DELETE /connectors/{id}`；`PATCH /connectors/{id}/enabled`；`POST /connectors/{id}/test` |
| 凭证与 OAuth | `PUT/DELETE /connectors/{id}/credential`；`POST /connectors/{id}/oauth/authorizations`；`GET /connector-authorizations/{id}`；专用服务端 OAuth 回调 |
| 工具目录 | `GET /connectors/{id}/tools`；`PATCH /connectors/{id}/tools/{toolID}`，管理端可指定合法的认证上下文 |
| 专家 | `GET/POST /experts`；`GET/PUT/DELETE /experts/{id}`；`PATCH /experts/{id}/enabled`；`POST /experts/{id}/copy`；`POST /experts/{id}/preview` |

技能新建采用 multipart 包与元数据；正文编辑走明确的 JSON 内容字段并在服务端重建包；直接替换包使用 package 接口。列表支持搜索、所有权、启用状态等实际所需过滤及游标分页，关联选择器复用列表接口。

管理端预览可指定一个实际用户，返回该用户的下发结果与问题；它是管理员可用的诊断入口，不让 Agent 通过传入 `user_id` 冒充其他用户。

Agent API 位于 `/api/v1`，沿用现有 OAuth access token：

| 接口 | 用途 |
| --- | --- |
| `GET /settings`、`GET /models` | 分别读取脱敏设置与可用模型；模型响应包含代理信息 |
| `GET /rules`、`GET /skills`、`GET /experts`、`GET /connectors` | 按资源类型读取授权目录，各自提供版本及 ETag |
| `GET /skills/{id}/package?sha256=...` | 下载当前用户直接有权使用的技能包；摘要变化返回资源已更新 |
| `GET /experts/{id}/manifest` | 获取专家完整清单、正文、依赖及可选 Connector；支持 ETag |
| `POST /resources/resolve` | 根据可选专家、用户选择的 Rule/Skill ID 和 Connector 绑定生成最终清单；只计算结果，不创建会话 |
| `GET /experts/{id}/skills/{skillID}/package?sha256=...` | 按专家关系与专家授权校验委托下载 |
| `GET /connectors/{id}/tools` | 获取当前用户认证上下文下允许下发的工具目录 |
| `PUT/DELETE /connectors/{id}/credential` | 独立认证用户配置/撤销自己的 Header 凭证 |
| `POST /connectors/{id}/oauth/authorizations`、`GET /connector-authorizations/{id}` | 当前用户发起和查询自己的独立 OAuth 授权 |
| `POST /connectors/{id}/test` | 使用当前用户合法认证上下文完成真实连接测试 |

OAuth callback 使用服务端固定地址，事务绑定发起用户、Connector、配置修订和用途，短期有效且仅消费一次。后台集中凭证与 Agent 独立凭证走不同权限检查，共享协议实现。

## 7. Agent 下发契约

### 7.1 按资源类型读取

整体 `/api/v1/config` 已移除，Agent 按需读取独立接口。每次请求先检查有效用户身份，随后只返回对应资源目录；版本和 ETag 分别计算。

| 接口 | 内容 |
| --- | --- |
| `GET /api/v1/settings` | `version`、脱敏的 `settings` |
| `GET /api/v1/models` | `version`、`models`、`model_gateway` |
| `GET /api/v1/rules` | `version`、直接可用规则的 ID、名称、正文、内容摘要、`required` |
| `GET /api/v1/skills` | `version`、直接可用技能的 ID、名称、描述、标签、包大小、SHA-256、稳定下载路径 |
| `GET /api/v1/experts` | `version`、专家 ID、名称、描述、清单摘要、清单路径、依赖问题及可用状态 |
| `GET /api/v1/connectors` | `version`、连接 ID、Provider ID/identifier、名称、认证模式、当前用户认证状态、连接状态、目录路径/摘要 |

不再提供全局 `schema_version` 和 `updated_at`；是否变化以当前接口的 `version` 与 ETag 为准。

Connector 的下发 DTO 不包含上游 Token、Secret 或敏感 Header；工具目录返回精确名称、说明、Schema、启停与价格元数据。当前下发能力可以明确声明为 `catalog`；只有生产调用代理真正接通并通过鉴权验证后，才下发 `invoke` 能力与实际 MCP 入口。

空集合统一为 `[]`。集合按稳定键排序，摘要只包含确定性业务字段，不包含当前请求时间、随机数据或短期下载签名。撤权、禁用、删除、分组成员变化会改变有效集合，因此即使剩余资源的更新时间没有增长，对应目录也必须产生新版本。

每个资源目录在自己的数据库一致读视图中生成，哈希覆盖实际响应内容及专家依赖摘要。规则、技能和连接器仅加载自身所需数据，专家目录读取关联依赖。读取失败时当前请求返回错误，不返回伪造的空目录；无依赖关系的其他接口不受影响。

### 7.2 专家清单与权限

清单包括 `expert_id`、版本、Prompt、规则正文、技能元数据、Provider 依赖、候选 Connector 和结构化 `issues`。

专家固定引用的系统 Rule/Skill 获得专家使用场景内的委托读取权，即可读取该专家清单和关联技能包；不把这些依赖并入用户独立资源列表。每次委托下载重新检查专家有效、用户获授权、关系仍存在且技能可用。

模型与 Connector 仍独立检查访问权。专家关联一个 Provider 不会自动授予具体连接或模型。

例如：用户只有专家 E 的授权，没有其技能 S 的单独授权，可以通过 E 的清单与下载接口获取 S；直接请求独立技能下载仍被拒绝。撤销 E 后，后续专家清单和委托下载都被拒绝。

`GET /experts/{id}/manifest` 返回专家预设清单，`POST /resources/resolve` 接受 `expert_id`、`rule_ids`、`skill_ids` 和 `connector_bindings`，返回包含本次选择的最终清单。服务端独立校验所有传入 ID、专家依赖与绑定关系，不能把客户端提交的列表当成授权依据。

规则装配顺序为强制系统规则、专家规则、用户本次选择的规则；同一 ID 去重，系统同名规则优先。技能采用专家固定技能、用户选择个人技能、用户选择系统技能的明确优先级，同名只保留一项。最终清单表达排序、去重和工具过滤结果，避免不同消费端各自解释。未选择专家时仍装配当前用户的强制规则。

专家清单的 `issues` 区分 `missing_connector`、`authorization_required`、`skill_disabled`、`rule_missing` 等原因，并标记是否阻止使用。未授权的资源不泄露账号、凭证或私有目录内容。

### 7.3 客户端接入约定

客户端登录、重连和创建新工作单元时按需检查各资源接口的版本。缓存按服务端、用户和接口隔离；收到 200 后替换对应目录，收到 304 时保留该接口缓存，不能将已移除项继续当作已授权资源。

选择专家时拉取预设清单并校验版本，完成资源选择后调用 resolve 获取最终清单；按需下载技能，校验大小与摘要后再装配。清单读取与包下载之间发生更新时重新拉取清单，不混用新旧包。

服务端保证每次新的配置、下载和认证操作都校验当前权限。已下载到客户端的文件如何替换、运行中的 Agent 何时重载，是消费端的职责；下发契约不承诺可以远程收回已经读取的内容。

## 8. 数据库迁移与部署

### 8.1 收敛为一版初始化 migration

用户已明确要求收敛为一版并重新部署。本次以全新数据库初始化为交付前提，将最终 schema 直接写入版本 `000001`，替换此前方案中的增量升级和旧数据转换安排。

`backend/migrations` 只保留一对 SQL 文件：

- `000001_initial_create_schema.up.sql`：一次性创建完整目标表结构、索引、约束及必要的固定初始化数据。
- `000001_initial_create_schema.down.sql`：按依赖逆序撤销本版本创建的对象，用于可丢弃测试库的初始化验证。

整合范围包含当前 `000001` 至 `000004` 的最终有效结构，以及本次四类资源新增结构：

1. 保留用户、分组、设置、模型、会话、调用事实、积分与审计等已有业务 schema。
2. 纳入 `browser_sessions`、`oauth_authorization_requests`、`oauth_login_states`、`oauth_authorization_codes` 和 `oauth_tokens`，直接定义管理员/客户端 OAuth 的最终字段与约束。
3. 纳入 `api_keys` 的完整字段、作用域约束和索引，保证现有模型调用密钥功能可继续使用。
4. 直接创建 `connector_providers`、`connectors`、`connector_credentials`、独立认证上下文的工具目录和 Connector OAuth 事务表。
5. 技能直接采用包文件权威模型；专家直接采用规则/技能关系和 Provider 依赖；授权、标签、调用事实直接引用目标资源结构。
6. 一次性定义名称唯一、外键、认证组合和关系约束；移除旧 `mcp_servers`、`mcp_server_credentials`、`expert_mcp_tools` 及 `skills.instructions` 的初始化定义。

合并时整理为最终 DDL，去掉重复的创建后修改语句和旧结构过渡 SQL。删除 `000002`、`000003`、`000004` 的 up/down 文件，迁移镜像中也只包含版本 `000001`。首次管理员仍由后端按部署环境变量创建；RustFS Bucket 由后端启动流程检查并按需创建。

本次重新部署连接全新的 PostgreSQL 数据库或数据目录，再执行 `migrate up`；仅重建容器并挂载旧数据库目录不构成全新初始化。部署说明需要明确这一前提，本轮方案更新不操作用户现有数据。

同步更新 `migrations/README.md`、部署 README 和测试约定，注明本次单版重置是用户指定的重部署安排。本次功能整合期间共同维护该初始化版本，后续正式发布后的 schema 变更再正常追加迁移。

验收要求：空库 `up` 成功且版本为 `1`、`dirty=false`；再次 `up` 返回无变化；可丢弃测试库执行 `down → up` 成功；初始化后管理员登录、客户端 OAuth、调用密钥、模型管理和四类资源功能全部通过验证。

### 8.2 Docker Compose 引入 RustFS

`monkeyai/docker-compose.yml` 使用单节点 `rustfs` 服务，后端通过 Compose 网络连接 `http://rustfs:9000`。镜像固定为 `chaitin-registry.cn-hangzhou.cr.aliyuncs.com/basic/rustfs:v1.0.0-rc.5`。

- RustFS 的 S3 API 使用容器内 `9000` 端口，默认供后端内网访问。
- 管理控制台使用 `9001`，本机调试绑定 `127.0.0.1`，与 MonkeyAI 管理后台分开。
- 数据持久化到 `./data/rustfs` 并挂载到容器 `/data`；日志单独挂载到 `./data/rustfs-logs`。数据目录随常规容器重建保留。
- RustFS 容器以非 root 用户 `10001:10001` 运行，部署前准备数据和日志挂载目录及其内容的读写权限，不配置独立目录权限初始化服务。
- RustFS 健康检查验证 S3 服务的 `/health`；Bucket 是否存在、运行凭据能否访问由后端启动初始化和就绪检查验证。

后端在启动流程中经 S3 API 检查并按需创建私有 Bucket，成功后开始提供 HTTP 服务。Bucket 已存在且可访问时视为成功，权限错误与网络错误不能当成“Bucket 不存在”。初始化限时 1 分钟，失败时后端退出，由 Compose 重启重试。多次启动不清空 Bucket，也不改变已有对象。Compose 默认复用 RustFS 凭据，独立应用凭据可通过 `MONKEYAI_S3_ACCESS_KEY` / `MONKEYAI_S3_SECRET_KEY` 覆盖；首次创建 Bucket 需要 `s3:CreateBucket` 权限。

启动依赖为 `rustfs 健康` 和 `PostgreSQL 健康 → migrate 成功` 两条链路；两者完成后启动后端并初始化 Bucket，再启动管理后台。`/readyz` 保留有超时和短时缓存的资源 Bucket 检查，`/healthz` 继续只表达进程存活。

配置约定如下：

| 配置 | 用途 / 默认值 |
| --- | --- |
| `RUSTFS_ACCESS_KEY`、`RUSTFS_SECRET_KEY` | RustFS 服务初始化的管理员凭据，通过部署环境提供 |
| `RUSTFS_VOLUMES` | 容器内的数据路径，单节点配置使用 `/data` |
| `MONKEYAI_S3_ENDPOINT` | 后端连接地址，Compose 默认 `http://rustfs:9000` |
| `MONKEYAI_S3_REGION` | 签名 Region，默认 `us-east-1`，与 RustFS 配置一致 |
| `MONKEYAI_S3_BUCKET` | 默认 `monkeyai-resources` |
| `MONKEYAI_S3_ACCESS_KEY`、`MONKEYAI_S3_SECRET_KEY` | 后端初始化及读写资源的凭据，Compose 默认复用 RustFS 凭据 |
| `MONKEYAI_S3_FORCE_PATH_STYLE` | 默认 `true` |

同步修改 `.env.example`、后端配置加载、Compose、启动初始化与部署 README，并调整管理反向代理的上传体积、超时和流式下载设置。后端配置 API 不返回上述访问密钥。

RustFS 对象与 PostgreSQL 元数据共同构成可恢复资源。备份应记录数据库快照及其引用的对象集合，旧对象清理不得早于有效备份和回滚窗口；验收时用数据库备份和 RustFS 对象恢复一次完整技能下载。

配置依据：[RustFS 官方容器启动说明](https://github.com/rustfs/rustfs/blob/c9c6bb7a24eb9fa8f158c350efde789b50dbf514/README_ZH.md)、[官方 Compose 示例](https://github.com/rustfs/rustfs/blob/c9c6bb7a24eb9fa8f158c350efde789b50dbf514/docker-compose-simple.yml)。引用用于确认接口、端口与权限；部署拓扑和镜像版本以实施阶段固定并通过测试的配置为准。

## 9. 实施顺序与验收

| 阶段 | 工作内容 | 验收结果 |
| --- | --- | --- |
| A：契约与基础 | 固定 DTO/错误码；真实授权对象；标签与授权事务；RustFS 与 Bucket 初始化；单版 schema 与审计基础 | 空库以版本 1 初始化，Compose 可启动完整依赖，资源文件在容器重建后仍可读取 |
| B：规则闭环 | Rule CRUD、可用/强制范围、后台接入、Agent rules 下发 | 保存刷新不丢失；普通规则可选；强制规则正确覆盖目标用户 |
| C：技能闭环 | 真实导入、包解析与重建、标签、启停、授权、下载 | 多来源批量导入可重试；编辑后包与元数据一致；无权下载被拒绝 |
| D：工具闭环 | Provider/Connector、Header/OAuth、测试、隔离工具目录、后台与 Agent 描述 | 真实 MCP 测试成功；按用户得到不同目录；凭证不下发；价格配置持久化 |
| E：专家闭环 | 动态关联、复制与授权、依赖检查、委托清单 | 专家只有真实有效关系，缺失依赖有明确原因，委托访问不扩散 |
| F：集成与交付 | 独立资源目录 ETag、单版初始化与重新部署验证、原有样式对照、API 文档、端到端验收 | 四页样式延续现状，CRUD → 数据库 → 目标用户配置/技能下载全部连通 |

B、C、D 完成各自闭环后再集成 E，F 完成才标记本次功能交付。实现可以按业务能力拆分 PR，但单版初始化 SQL、`go.mod`、`internal/app`、公共协议和两份 OpenAPI 由集成任务统一维护。

必要验证覆盖：

- 用户 A 有权限、B 无权限；父组继承、无父级分组的成员隔离、角色不隐式授予分组权限，以及撤权后的配置差异。
- 资源和授权同时保存失败时回滚，关联资源删除返回引用信息。
- 无变化配置返回 304；规则正文、技能包、专家依赖、工具目录或授权变化返回新版本；下载地址签名不会造成版本抖动。
- ZIP 路径、链接、重复项、超额展开、损坏摘要；批量部分失败和重复提交后的结果核对。
- 使用真实 RustFS 验证 S3 签名、path-style、上传、检查、下载、删除与 SDK 校验和兼容性；Bucket 初始化重复执行成功。
- RustFS 重建后文件保持可读；存储中断或权限错误时上传不产生已发布坏记录，下载和 `/readyz` 返回准确状态。
- 数据库提交失败时旧对象引用仍有效，清理任务不会删除仍被引用或处于备份保留窗口的对象。
- 专家委托下载可用，独立下载越权被拒绝，撤销专家或解除关系后委托立即失效。
- 两个实例、同一实例两个独立凭证发现不同工具时互不覆盖；发现失败保留旧目录但呈现失效状态。
- Header/OAuth 状态来自服务端；过期、取消、撤销、配置变更与并发 Token 刷新处理一致，回调不可重放。
- 快照、下载错误、日志和审计均不包含上游凭证。
- 前端检查真实请求与 DOM 行为，避免仅搜索源码字符串的测试；覆盖保存失败、刷新持久化、上传和授权选择。
- 使用相同视口和主题对照现有页面，确认导航、页签、卡片、按钮与弹窗样式延续原状，必要新增字段与状态符合现有组件风格。
- 迁移目录与构建后的 Migrate 镜像只有版本 `000001` 的 SQL；空库初始化、重复执行及可丢弃测试库的 down/up 均通过，现有 OAuth 和调用密钥结构没有遗漏。

业务后端运行 `go test ./internal/<feature>/...`；集成运行 `go test ./...`、`go vet ./...` 及真实 PostgreSQL/RustFS/MCP 测试。前端运行 `pnpm test`、`pnpm lint`、`pnpm build`，并用管理页和两个测试用户完成接口联调。OpenAPI 校验同时检查 HTTP DTO 与实际响应。

## 10. 方案状态

- [x] 核对当前前端、后端、迁移和 Agent 配置实现。
- [x] 确定数据模型建议、管理流程、接口、权限与下发契约。
- [x] 给出实施阶段、迁移策略及验收标准。
- [x] 按本轮要求明确采用 RustFS，补充对象组织、S3 接入、Compose、持久化、初始化及验收。
- [x] 按本轮要求明确保留前端原有样式，并将 migration 方案改为全新部署的一版初始化结构。
- [x] A：资源结构、真实授权对象、标签、审计、RustFS 接入与版本 000001 初始化。
- [x] B：规则 CRUD、可用/强制范围、后台持久化与 Agent 下发。
- [x] C：技能导入、包内容编辑、标签授权、启停与鉴权下载。
- [x] D：Provider/Connector/Credential、Header/OAuth、真实工具发现、目录隔离及管理页接入。
- [x] E：专家资源关系、复制、授权、有效清单和委托下载。
- [x] F：Go 与前端检查、真实 PostgreSQL/RustFS/MCP 联调、迁移镜像、OpenAPI 与浏览器验收。

实现位于独立工作树 `MonkeyCode-worktrees/feat-ai-resources` 的 `feat-ai-resources` 分支。变更仅涉及 `monkeyai`，通过 PR 评审合并；尚未部署线上环境。

## 11. 实施验收记录（2026-09-07）

- 后端 `go test ./... -count=1`、`go vet ./...` 通过；测试显式连接独立 PostgreSQL 与 RustFS，集成测试未跳过。
- 集成测试验证规则保存、行级修订冲突、用户与父子分组授权、用户及分组强制规则、独立资源目录 ETag/304、技能上传与包重建、专家复制与依赖、委托下载和撤权、模板图标权限、真实 MCP HTTP 握手/发现、独立认证工具目录隔离，以及 OAuth state/PKCE 与回调防重放。
- 非对象 JSON 与多个 JSON 文档返回 400；技能包元数据摘要被篡改时，下载和编辑清单返回 502，不返回损坏内容。
- RustFS 测试覆盖重复建桶初始化、上传、读取、Bucket 可访问性和对象删除。重启测试 RustFS 后再次下载浏览器上传并编辑的技能，包摘要、正文和附件一致。
- 前端 `pnpm test` 全部 38 项通过，`pnpm lint`、`pnpm build` 通过。构建仍有已有的大 chunk 提示，不影响构建成功。
- 浏览器检查真实规则、技能、专家与 MCP 数据刷新后的显示；验证重复名称保存失败时输入不丢失且焦点进入错误提示。四个页面沿用原有导航、卡片、页签、弹窗和主题变量；工具页检查桌面与窄屏布局。
- 后端与迁移镜像构建成功；直接检查迁移镜像，只有 `000001_initial_create_schema.up.sql` 和对应 down 文件。集成测试执行空 schema up/down/up，验证 OAuth、调用密钥与资源表齐全；Compose 配置解析通过。
- Admin 与 Agent 两份 OpenAPI 通过结构校验。测试证据位于 `/tmp/monkeyai-*-test.log`、`/tmp/monkeyai-front-build.log` 和 `/tmp/monkeyai-resource-qa/`，均为本机验收产物。

## 12. 最终实现边界

本次交付管理后台、后端及服务端资源下发接口；Desktop/OhMyAgent 的本地物化与加载、生产 MCP 调用网关、真实积分扣减仍按第 1 节边界处理。工具返回 `capabilities: [catalog]`，不会返回虚构的执行地址。

首版作如下具体取舍，以当前实现和 OpenAPI 为准：

- MCP OAuth 使用手工配置的 Authorization/Token Endpoint，暂未接入 Discovery 自动发现；已有实例的 URL、认证模式及 OAuth 应用保持绑定，需要换目标时新建模板与实例，Secret 可由服务端事务轮换。
- 图标接收 PNG/JPEG，暂不接收 SVG。技能下载在 20 MiB 上限内读取并校验大小和 SHA-256 后返回；编辑时同样验证当前包，避免把损坏对象重新发布。
- 历史包与失败事务产生的孤儿对象保留，首版没有自动清理任务；部署备份需包含数据库及其引用对象。
- 本地 OAuth 协议模拟器已覆盖授权事务和防重放；生产 OAuth 应用的回调登记、完整生产备份恢复演练和新部署环境冒烟由部署环境执行。

重新部署步骤见 `../README.md`，必须使用新数据库或新 PostgreSQL 数据目录，不能把已有版本 1 的库强行标记成新的结构。

2026-09-07 分组规则修订已实现：使用虚拟团队根节点，旧系统组授权转为升级时成员的直接授权，后续新增用户不自动获得这些授权。

## 12. Agent 接口拆分状态（2026-09-07）

已完成六类独立读取接口、整体配置入口移除、模型代理信息迁移及契约更新。PostgreSQL / RustFS 全量集成测试通过，覆盖独立缓存、分享与撤权、读取失败隔离、技能下载、专家依赖和连接器认证。

## 13. 个人资源用户接口补齐（2026-09-09）

- [x] 个人规则创建、详情、编辑和删除；个人技能 ZIP 上传、正文编辑、包替换、详情与删除。
- [x] 个人 Provider 与 Connector 创建、详情、编辑和删除，以及可用 Provider 发现和个人图标管理。
- [x] 个人模型、技能和规则使用统一批量分享/撤销接口；Connector 和 Provider 保持仅本人使用。
- [x] 用户写入采用字段白名单，归属固定为当前用户；修改和删除检查所有权及 `If-Match`，分享变更递增修订号。
- [x] 独立资源目录增加归属与修订号；删除个人资源同步清理分享，删除 Connector 同事务撤销凭证。
- [x] `make check` 通过：Go 全量测试（含 PostgreSQL/RustFS 集成）、`go vet`、SQL 生成一致性；Admin/Agent OpenAPI 结构与引用校验通过。

本次补齐 `/api/v1` 后端能力，未新增个人资源创作客户端。接口契约以 `backend/api/agent.yaml` 为准，无新增数据库迁移。

- [x] 已提交 PR [#1256](https://github.com/chaitin/MonkeyCode/pull/1256)，分支 `feat-personal-resources`，目标分支 `main`，等待评审。

## 14. 用户规则移除分享（2026-09-10）

- [x] 个人规则保留创建、列表、详情、编辑和删除，以及所有权和 `If-Match` 校验。
- [x] 统一分享/撤销接口不再接受 `rule`；规则目录和详情移除 `shared_users`，个人规则详情的 `grants` 固定为空数组。
- [x] 历史个人规则授权不再参与资源下发、解析和个人专家依赖校验；系统规则授权与强制范围保持原有语义，无新增数据库迁移。
- [x] 同步 Admin/Agent OpenAPI 及 API 说明，补充旧授权隔离和 CRUD 回归覆盖。
- [x] Go 全部包测试通过（含 PostgreSQL/RustFS 集成，修正测试数据后应用包复测通过）；`go vet`、SQL 生成一致性和 Admin/Agent OpenAPI 校验通过。

- [x] 已提交 PR [#1273](https://github.com/chaitin/MonkeyCode/pull/1273)，分支 `fix-user-rules-crud`，目标分支 `main`，等待评审。

### 专家独立于模型（2026-09-11）

- [x] 删除专家表单、类型和提交字段，并停止预加载模型列表。
- [x] 移除专家保存校验、清单解析及模型查询依赖。
- [x] 新增第 13 号迁移，更新 API、领域术语和设计说明。
- [x] 生成 SQL/schema，验证存量迁移、专家接口及前后端检查。

验证结果：PostgreSQL / RustFS 环境下后端 317 项测试通过，无跳过测试；覆盖系统和个人专家的创建、编辑、详情、列表、复制、清单及资源解析，第 13 号迁移保留其他字段和规则关系，模型启停和删除不影响专家可用性或目录版本。前端 43 项测试、lint 和生产构建通过；`go vet ./...`、SQL 生成一致性、迁移序号检查及两份 OpenAPI 校验通过。OpenAPI 仍报告文档规范警告，前端构建仍有大文件提示。实现与验证均已完成，部署前需执行第 13 号迁移。
