# 管理端资源包导入方案

> 状态：本期代码已实施并完成 Go/SQLC/管理端静态验收及 r0016 解压目录解析；用户选择跳过独立 PostgreSQL 容器验收，因此迁移与整包导入事务**尚未经过数据库运行时验证**。Agent 客户端语言选择不在本期范围；原始外层 ZIP 与 Expert 独占依赖样本仍缺。
>
> 范围：MonkeyAI 管理端上传资源发布 ZIP，导入系统 Skill、Rule、Connector、Expert。输入协议依据《资源包结构体定义（不带设计资源）》；具体序列化以发布端实际产物及导出实现为准。

## 1. 目标与边界

管理员选择一个发布整包，先查看服务端给出的新增、更新、跳过、移除、恢复及冲突预览，确认后一次导入。重复导入相同版本不产生重复资源；导入失败不留下半包数据库记录；管理员创建的系统资源和个人资源保留现有编辑能力，资源包导入的资源本体只能由后续经验证的资源包更新、退役或恢复，任何人都不能手工修改。人工仅允许在现有权限边界内管理使用授权和 Connector 凭证。

本期只通过管理后台上传资源包；后端统一接收 ZIP，管理端可选择已有 ZIP 或解压后的目录并在浏览器中把目录**内容**打成 ZIP（根目录直接是 `release.json`，不能再包一层 `release-r0016/`）。不接发布端注册、轮询、Webhook、CLI 或物理删除；**管理员本次上传的包就是该 publisher 的最终 Agent 资源清单**，旧包中缺失的资源按第 3.3 节停用并保留绑定。不导入设计资源；`design_resources` 非空时报不支持并阻断。独立 `static_assets` 本期不落库，但须校验其文件与摘要，在预览和批次历史中明确列出“已忽略”数量/路径，再继续导入 Agent 资源；不能提示“包内全部内容均已导入”。`avatar.webp` 属于 Expert 产物内部文件，仍需导入。

现有 `SkillImportWizard` 处理单个技能 ZIP/目录，不解析 `release.json`、跨资源依赖或批次版本；保留原流程，新增独立“资源包导入”入口。

## 2. 输入契约与预检

根目录要求 `release.json`、`manifest.json`、`CHECKSUMS.sha256`；以 `manifest.agent_resources` 中的 `path` 定位 Skill、Rule、Connector、Expert 产物，不从 slug 推测文件路径。解析并验证：

1. 上传压缩大小、ZIP 文件数、单文件/累计解压大小与嵌套 ZIP 总预算均须有**非零上限**；拒绝绝对路径、`..`、反斜杠、链接、重复文件名及跨平台等价路径冲突。读取时流式限额，不仅依赖 ZIP 声明大小。浏览器打包目录也须限制文件数和总字节数，不把目录中的文件逐个直传给应用接口。
2. `release_id`、`version` 与两个 JSON 的 `manifest_sha256` 对齐；按发布端 `canonicalManifest` 的确切字段顺序与 JSON 编码重算摘要。规范化字段包括 `release_id, version, generated_at, agent_resources, design_resources, static_assets`；**不能因为不导入设计资源就省略 `design_resources`**，也不能把空数组改成 `null`。用发布端生成的黄金样本验证字节级兼容性。
3. 每个 manifest 产物条目的 `sha256` 与其实际 ZIP 条目字节一致；`CHECKSUMS.sha256` 的路径集合、排序及摘要与所有内容条目、`manifest.json` 一致，不含 `release.json` 与自身。检查 manifest 路径唯一、类型/slug 与产物元数据一致、ZIP 条目存在且无未声明的内容。协议中产物 `sha256` 存在 `content_hash` 回退描述：若无法按实际文件字节验证则报协议不兼容，不能把业务指纹当文件摘要放行。
4. Skill ZIP 解析 `skill.json` 和 `SKILL.md`，复用现有技能包限制与 frontmatter 校验；校验 slug 及显示名称/Skill frontmatter 的各自语义，不要求不同语言的展示名称字面相同。若 `SKILL.md` 的 `name` 不符合现有解析器的安全名称规则（如 r0016 中的空格），在校验原始产物后按第 4 节确定性规范化，并在预览中要求管理员确认；合法名称不改。Rule 取 JSON 中的 `content`；Expert 校验 `expert.json`、`prompt_path`、依赖文件和可选头像。所有文本做编码/长度校验。
5. 对 Agent 资源依赖与字段映射做**完整预检**；任何 Agent 资源不兼容则整包阻断；非空设计资源仍阻断，静态资源经校验后列为忽略项。校验摘要只证明字节完整，不证明发布者身份；本期信任边界是已有管理员权限，不允许通过 `release.json.publisher.url` 发起网络请求。

预检只读本地数据库与上传文件，不创建资源、不写对象存储、不访问包中 Connector URL。预检错误必须带资源类型、slug、路径和原因。

## 3. 来源、身份与版本

导入资源的唯一身份是 **`(publisher, slug)`**，跨 Skill、Rule、Connector、Expert 共用一个命名空间；`publisher` 取 `release.json.publisher.name`，manifest 条目本身没有该字段。`resource_type` 只是定位目标表，不参与唯一键。同一包内相同 `(publisher, slug)` 若对应类型或有效内容不一致，预检报错；跨版本同类型内容变化则由导入器正常更新，不自动改名或跨类型覆盖。r0016 的 39 个顶层资源没有跨类型重名。管理员权限允许提交包，但摘要并不能认证 publisher；如将来开放不可信来源，须额外验证发布者身份。

新增两张表：`resource_import_bindings` 以 `(publisher, slug)` 主键记录资源类型、对应系统资源 ID、来源摘要、已应用内容摘要和批次 ID，并约束同一系统资源 ID 只绑定一次；`resource_imports` 记录 publisher、release_id、version、manifest_sha256、上传者、状态、计数、脱敏失败码及时间，用于版本冲突判定与历史查询。**不新增 `resource_sources` 表**。无绑定的资源是本地资源，个人资源不可绑定。普通接口不得软删除绑定资源；若因历史数据或外部写入造成目标异常丢失，绑定仍占位，重导入返回冲突，不创建同名新行。

同一 `(publisher, slug)` 命中现有绑定才允许更新；只凭名称相同不合并。重复 `(publisher, release_id, version, manifest_sha256)` 返回已导入结果；同版本不同摘要或倒退版本返回冲突，不能静默回滚。即使发布版本不同，也按规范化后的已应用内容判断逐项跳过，不能只比较产物文件摘要；Expert 的依赖 ID/关联变化也要纳入判断。按 publisher 串行化并用绑定表唯一约束防止并发双写。

### 3.1 拟新增表结构（PostgreSQL）

```sql
CREATE TABLE resource_imports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher text NOT NULL CHECK (publisher = btrim(publisher) AND char_length(publisher) BETWEEN 1 AND 128),
    release_id uuid NOT NULL,
    version bigint NOT NULL CHECK (version > 0),
    manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    actor_user_id uuid NOT NULL REFERENCES users(id),
    status text NOT NULL CHECK (status IN ('succeeded', 'failed')),
    result_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result_counts) = 'object'),
    failure_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'succeeded') = (failure_code IS NULL))
);

CREATE UNIQUE INDEX resource_imports_publisher_version_succeeded_key
    ON resource_imports (publisher, version) WHERE status = 'succeeded';
CREATE UNIQUE INDEX resource_imports_publisher_release_succeeded_key
    ON resource_imports (publisher, release_id) WHERE status = 'succeeded';
CREATE INDEX resource_imports_publisher_created_at_idx
    ON resource_imports (publisher, created_at DESC);

CREATE TABLE resource_import_bindings (
    publisher text NOT NULL CHECK (publisher = btrim(publisher) AND char_length(publisher) BETWEEN 1 AND 128),
    slug text NOT NULL CHECK (slug = btrim(slug) AND char_length(slug) BETWEEN 1 AND 128),
    resource_type text NOT NULL CHECK (resource_type IN ('skill', 'rule', 'connector', 'expert')),
    resource_id uuid NOT NULL,
    source_sha256 text NOT NULL CHECK (source_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    applied_sha256 text NOT NULL CHECK (applied_sha256 ~ '^sha256:[0-9a-f]{64}$'),
    last_import_id uuid NOT NULL REFERENCES resource_imports(id),
    retired_at timestamptz,
    retired_import_id uuid REFERENCES resource_imports(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((retired_at IS NULL) = (retired_import_id IS NULL)),
    PRIMARY KEY (publisher, slug),
    UNIQUE (resource_type, resource_id)
);
```

`source_sha256` 对顶层资源取产物文件摘要，对 Expert 内独占资源取其相对路径与文件字节的确定性摘要；`applied_sha256` 取按协议解析并映射后由导入器管理的字段、所选导入选项与 Expert 关系的规范化摘要；二者都不必等于经规范化后存储的技能包 `package_sha256`。`resource_id` 指向四种不同资源表，无法用一条普通外键覆盖；导入事务需校验资源存在且所有权为 `system`，删除时保留绑定占位。仅成功批次有版本唯一约束，失败批次可重试；解析不到 publisher/version 的预检失败不写批次。历史接口按 publisher 和创建时间分页；严格递增版本与同版本摘要一致性仍需服务端事务验证。

导入绑定存在即表示资源本体由发布包托管；管理员及普通用户对其手工编辑、替换 ZIP/图标、调整标签/工具配置、启停和删除均被后端拒绝。允许按现有角色权限独立管理资源使用授权和 Connector 凭证；这两类运维数据不随发布包覆盖。新资源无默认授权。普通 API 无法删除已绑定资源；只有导入器可以按第 3.3 节退役/恢复或更新它。

### 3.2 逐资源 diff 与预览

先完整验证包和版本，再按 `(publisher, slug)` 预读绑定和目标资源，解析/规范化产物，并解析 Expert 依赖。`desired` 只包含导入器负责的字段：Skill 的规范化文件树摘要（按相对路径与解压后字节排序计算，不含 ZIP 压缩方式）、名称、描述及 i18n；Rule 正文/展示字段；Connector URL、发布包声明的认证配置/超时/展示字段和**明确选择**的认证归属（排除运行期动态注册生成的 Client ID/Secret 与自动发现结果）；Expert prompt、展示字段、头像内容摘要及 Skill/Rule/Connector 关联 ID 和关联参数。授权、标签、凭证、连接状态等运行态**不进 diff**。将 `desired` 按稳定字段顺序序列化为 `applied_sha256`；输入 manifest 的 i18n 或导入选项变化，即使产物 ZIP 字节不变，也要反映在该摘要中。

| 情况 | 预览动作 | 写入策略 |
| --- | --- | --- |
| 无绑定 | 新增 | 新建系统资源及绑定；仅同名但没有绑定的本地资源不合并。 |
| 有绑定，但类型变更、目标丢失或已软删除 | 冲突 | 阻断整包，不重新占用身份。 |
| 绑定为已退役且资源重现 | 恢复/冲突 | 目标仍是导入器退役的原资源时恢复原 ID，并显著提示旧授权可能重新生效；目标异常丢失或已软删除则阻断。 |
| `desired.applied_sha256 = binding.applied_sha256` | 跳过 | 不改资源 revision、不重传 S3；若原产物 SHA 变化只同步绑定中的来源摘要/批次信息。独立授权/凭证变更不影响资源本体 diff。 |
| 已应用内容不同，且目标仍由该绑定管理 | 更新 | 预览字段级变化（敏感配置仅显示字段名/摘要）；仅写入导入器管理的字段并更新绑定与 revision。普通 API 不得改这些字段。 |
| 目标丢失、绑定身份异常或发现非授权写入 | 冲突 | 阻断整包并报数据异常，不通过导入修复异常状态。 |

例如：r0016 中某 Skill 的 ZIP 未变化，但新 manifest 更新 `description_i18n`，应判为**更新**；仅发布包 ZIP 的压缩参数改变、解析后内容相同，应**跳过资源更新**；若版本只改变已校验的独立静态资源，Agent 资源 diff 全部跳过，但批次仍记录这些静态条目被忽略。Expert 自身文件未变化而关联目标 ID、`required`/工具过滤配置变化，也应判为更新。预览按类型列出新增、更新、跳过、移除、恢复、冲突及变更字段，排序固定；批次版本冲突、缺依赖或不支持配置属于整包错误。

预览返回的 `plan_digest` 绑定包字节摘要、publisher/version、选项、每项动作/目标 ID/当前 revision 与期望已应用摘要；确认时重读数据库并重算计划，在 publisher 锁和行锁下复核，任何竞态变化返回 409 重新预览。资源 revision 只用于预览并发校验，**不用于判断人工修改**：现有授权/组操作也可能触发 revision 变化，不能因此误报导入冲突。不能把客户端传回的动作列表当权威。

### 3.3 完整快照中缺失资源的退役与恢复

先计算本次 publisher 的**闭包**：顶层 manifest 的 `(publisher, slug)`，加上仍在包内 Expert ZIP 中被引用的独占 Skill/Rule。仅对经过完整校验、version 严格递增且由管理员确认的本次**完整 Agent 资源清单**，用 `已有未退役绑定 − 本次闭包` 得到“移除”列表；本期不要求 `release.json` 增加全量标记，上传包的 Agent 清单就是最终状态。上传与确认页面明确告知“此包将替换该 publisher 的 Agent 资源集合，缺失资源会被停用”；解析失败或跨 publisher 的资源绝不参与减法。静态资源不参与该集合的 diff，即使静态条目非空也不能影响 Agent 退役判定。一个独占依赖从某 Expert 消失但仍被其他 Expert 或顶层资源使用时，不算移除。

预览把“移除”单列，展示资源类型、名称、引用方、当前启停与授权影响。若绑定目标异常、退役状态与资源启停状态不一致，或仍被本次导入后**保持可用**的 Expert（含本地/其他 publisher 的 Expert）引用，报冲突并阻断整包，不暗中断开引用；本包仍在的 Expert 若依赖已消失，也应在预检阶段报缺依赖。对于“整包全部资源消失”等大范围退役，必须在预览中单独警示并确认。授权与凭证本身保留，恢复时会重新生效，预览必须突出这一点。

确认后，在同一数据库事务中先退役本次也已消失的 Expert、更新仍存在的 Expert 关系，再按依赖顺序停用无冲突的 Skill、Rule、Connector：更新原资源 `enabled=false`、`revision+1`，绑定写 `retired_at`、`retired_import_id`，批次统计“移除”。**不软删除资源、不删除 S3 包、不清理授权、不撤销 Connector 凭证**；特别不能调用 Connector 的 `DeleteResource`，其删除查询会撤销凭证与工具目录。已有 Skill/Connector/Expert 可启停；Rule 需新增 `enabled` 并检查直接 Rule 访问、Agent 目录及 Expert Rule 下发均遵守禁用状态。管理端保留退役资源可见；仍处于退役绑定时，禁止任何人工启用/编辑，并禁止新增使用授权（可撤销既有授权），避免未来恢复时意外扩大可见范围。

未来版本同一 `(publisher, slug)` 重现，优先匹配原绑定：预览“恢复”，若绑定和目标状态正常就复用**原 resource_id**，更新内容并重新启用，清空退役字段；因为旧授权和 Connector 凭证可能恢复使用，必须让管理员在确认页面看到这些影响。包中继续缺失的已退役资源保持退役，不重复改 revision。该策略已由产品选择为“自动停用，保留记录”，不是“直接删除”。

### 3.4 资源来源展示与不可人工修改

`resource_import_bindings` 是来源真值：按 `(resource_type, resource_id)` 查询，有绑定即 `origin=package`，同时返回只读 `publisher`、`slug`、`retired`；无绑定的系统资源显示 `origin=admin`，个人资源保留其所有者来源。来源字段由服务端装饰 List/Get 响应，**不得接受客户端提交或通过普通 CRUD 伪造**。管理端导入资源只提供查看、下载、授权和凭证操作入口，编辑、替换技能包/Connector 图标、标签、启停、删除和 MCP 工具配置按钮均隐藏/禁用，退役资源另显示状态。

后端必须在与目标资源锁定的**同一个事务**内检查绑定：`resource.CRUD.Save/Delete/SetEnabled`、技能包替换、Connector 图标上传、工具配置、Expert 关联等所有人工写入口，对有绑定的目标统一返回只读冲突；个人资源也不得冒用绑定 ID。仅导入服务经过包校验和 publisher 级锁后，使用内部事务接口更新本体和绑定；不要公开可由客户端传入的 `force`、`origin` 或 `is_import` 绕过开关。复制导入资源为新的管理员本地资源如需支持，必须新建 ID 且不复制绑定，不影响原资源。

授权是例外但必须与本体更新拆开：当前 `resource.CRUD.Save` 同时写入资源字段和 `grants`，不能因为请求“只想改授权”就放行导入资源的 Save。增加仅接受授权数据的独立管理端接口（如 `PUT /api/admin/v1/{kind}/{id}/grants`），复用 `SaveGrants` 和现有权限检查，并拒绝在退役资源上**新增**授权；允许撤销旧授权。Connector 凭证的创建、更新、撤销、OAuth 授权沿用既有管理员/用户权限，但不能借此修改 Connector URL、认证模式、scope、Header 配置等发布包管理字段；测试与读取仍按原有权限。授权/组操作可能触发目标资源 revision 增长，所以 revision 只用于预览并发控制，不能据此推断导入内容被人工改动。OAuth 动态发现/注册产生的 Client ID、Secret 等运行期技术字段和工具自动发现也不属于人工编辑，需保留现有后台维护机制；导入 diff 只比较包内声明式配置，不能把这些自动生成的字段当作发布包变更或覆盖掉。

## 4. 资源映射与依赖

| 产物 | 落地方式 | 需要关注的边界 |
| --- | --- | --- |
| Skill | 技能 ZIP 放入现有 S3 存储，保存 `package_*` 字段；保存 `name_i18n`、`description_i18n` | `SKILL.md` 是运行内容的权威来源；`skill.json` 是发布元数据。本样本 34 个 Skill 的 `SKILL.md` 都在 ZIP 根目录，合法名称优先直接保存原包。若有包装目录或额外元数据需要移除，重打后用 `skill.Parse` 校验。`transcription-automation` 的 frontmatter `name: Transcription Automation` 含空格：先验证原始产物摘要，再仅对**不符合规则**的名称确定性改写为经校验的 `skill.json.slug`；对于未加引号且包含 `: ` 的描述，仅在当前解析失败时补引号。预览展示原值/新值与存储包摘要变化，由管理员确认；其他 frontmatter 与指令正文保持不变，slug 本身不合法则报错。绑定表记录原产物摘要，`package_sha256` 记录实际存储包摘要，二者不能混用。 |
| Rule | `name`、`content`、`name_i18n`、`description_i18n` 写入 `rules` | 当前没有 `enabled` 列；本方案为统一退役增加 `enabled boolean NOT NULL DEFAULT true`，并同步管理端启停接口与 Agent Rule/Expert 下发路径，保证禁用后不可独立或经 Expert 使用。 |
| Connector | 将 `config` 显式映射为现有 `url`、认证模式、认证方式、OAuth 配置，并保存 `name_i18n`、`description_i18n` | 必须实现 r0016 的 HTTP Header/OAuth DCR 映射及 60 秒运行时超时，详见第 4.1 节；不能默默丢掉超时、认证、Header 提示或 OAuth scope。绝不从包中创建凭证。 |
| Expert | `agents/expert.md` 写 `prompt`，manifest 的 `name_i18n`、`description_i18n` 写入对应字段，依赖映射到现有三张关联表；可选头像写 S3 并提供受控读取 | `expert.json.depends_on` 必须全部解析，不能只导入顶层清单。必需 Connector 的 `required`/工具过滤参数若包中无对应信息，使用现有默认语义并在预览显示。 |

依赖按 `(publisher, slug)` 查找：顶层 manifest 中已有的复用其资源；仅存在于 Expert ZIP 的 Skill/Rule 仍须建系统资源供 Expert 关系表引用，但**保留原 slug，不生成私有命名空间的替代 slug**，且不赋予独立授权。不同 Expert 同 slug 的内嵌资源只有有效内容一致时才复用；与顶层资源同 slug 也须类型与内容一致，否则整包报冲突。内嵌 Skill 文件须重打为能通过 `skill.Parse` 的包；内嵌 Rule 的正文来自对应 Markdown。依赖缺失直接阻断。先处理 Skill、Rule、Connector，再处理 Expert 与关系。现有系统 Expert 关联的 Skill/Rule 下发路径需要以真实授权场景验证，确保无独立授权的依赖不会绕过 Expert 权限单独暴露。

### 4.1 r0016 Connector 的落地条件

- `tavily`：`transport=http`、`auth.mode=header`、`auth.header=Authorization`、`header_schema=[]`。映射为 `authorization_method=http_header`，持久化需填写的 Header 名称作为非敏感配置/凭证界面提示；不导入 API Key。来源没有“集中/独立凭证”语义，本期首次导入默认 `authorization_mode=independent`，如要组织共享凭证由管理员在预览中显式选择 `centralized`。
- `oauth-test`：`auth.mode=oauth`、`oauth.config_source=dcr`，且 `scope="profile email"`、端点与 Client ID 为空。映射为 `authorization_method=oauth`、`oauth_config.mode=dynamic`，首次导入默认独立凭证，也允许管理员在预览显式选集中凭证；不能因为端点为空误判为坏包或回退免认证。现有 `mcp.Service.validateConnector` 的 dynamic 分支会重建配置，实施时须补齐 scope 的保存/发现/授权链路，确保 `profile email` 不丢失；不在导入阶段执行 OAuth 发现或动态注册。
- 两个 Connector 的 `timeout_ms` 都是 `60000`，而现有 `mcp/transport.go` 的 HTTP 客户端固定 25 秒。本期必须增加受上下限保护的 Connector 级 `timeout_ms` 存储与实际 MCP 请求/测试链路传递，让这两个 Connector 真正按 60 秒运行；配置变化维护 `config_revision`。对非 HTTP transport、非空且无法表达的 `header_schema`、未识别的 `auth/oauth` 组合仍应预检拒绝，不擅自忽略。
- 预检所选认证归属和所有显式规范化动作要计入 `plan_digest` 与导入批次，不能确认时悄悄改变。重导入时保留此前确认的认证归属与现有凭证，不因包里缺少这些字段而重置；通过新导入选项改变归属或声明式配置可能导致凭证失效，须在预览单独展示并确认，不能靠普通编辑接口修改。

### 4.2 多语言存储、Agent 下发与语言选择

- `skills`、`rules`、`connectors`、`experts` 各自存 `name_i18n`、`description_i18n`，类型为 `jsonb NOT NULL DEFAULT '{}'::jsonb`；只接收语言标签到非空字符串的对象，规范化 BCP 47 标签、限制条目数量与文本长度，发现规范化后的重复标签或 manifest 与产物元数据同一语言翻译不一致时报预检冲突。manifest 是可下发字段的来源；Skill `skill.json.description_i18n`、Connector `config.name_i18n` 等产物元数据用于一致性校验与缺失时的明确回退，不静默覆盖 manifest。管理员自建及个人资源默认 `{}`，保持基础 `name`/`description`。
- Agent 资源目录四类列表、Expert 的 `/manifest`、`POST /resources/resolve` **都返回原始 `name_i18n`、`description_i18n` 映射**，同时保留现有基础 `name`/`description` 字段，旧 Agent 不因新增字段失效。对应入口为 `backend/internal/agentconfig/resources.go` 的 `ruleDTO`、`skillDTO`、Expert 列表/manifest，以及 `backend/internal/mcp/agent.go` 的 Connector DTO；更新 Agent API 契约。Rule 原本没有基础 `description`，返回空字符串并在有翻译时按选定语言显示其描述，不将 Rule `content` 当作描述。
- **本次不实施 Agent 客户端**。服务端向 Agent API 下发全部可用翻译，并保留基础字段及兼容旧客户端的响应；未来客户端提供显式语言选择并持久保存到设备，未选择时可用设备当前 `locale`，再用 `system_locale`，最后默认 `en-US`。未来客户端渲染时按“规范化后的完整标签 → 对应主语言标签（例如 `en-US` 可匹配样本中的 `en`）→ `en-US`/`en` → 基础字段”取值；缺少翻译不自动生成。样本 Expert 使用 `en` 而非 `en-US`，Skill 描述主要是 `en-US`/`zh-CN`，因此需同时覆盖。切换语言只改变目录/卡片/详情的展示文案，不变更授权、`publisher + slug` 身份、关联 ID，也不修改 `SKILL.md`、Rule `content` 或 Expert `prompt` 的实际指令语言。
- 本期 Agent 列表搜索如果由服务端执行，需在授权过滤后把翻译名称/描述纳入匹配，不能只搜基础名称；未来客户端自行搜索时由客户端按当前语言展示值过滤。仅翻译变化也应更新目录响应的缓存/ETag 和 Expert manifest `version`，以便 Agent 同步新文案；Rule 内容 `sha256`、Skill `package_sha256` 及技能下载路径不因翻译变化而变。返回全部语言映射，语言切换无须重新下载技能包。

数据库变更以新增迁移并同步 `backend/schema/schema.sql` 为准；四类资源各加 `name_i18n`、`description_i18n` JSONB（默认 `{}`），另加 Rule 的 `enabled` 与 Expert 头像键。Rule 当前没有基础 `description`，其翻译描述缺失时以空字符串兜底，不把 `content` 当描述。publisher、slug、摘要与退役状态放在绑定表中，不把导入身份加入普通 Admin CRUD 可写字段。按各资源 SQL 查询与 API 展示需求更新 sqlc 生成物；管理端资源列表和详情显示“管理员创建 / 资源包导入”、publisher/slug 和只读状态。多语言的 Agent API 下发见第 4.2 节；客户端选择语言是后续独立任务，本期不宣称 Agent 界面已支持切换。

## 5. 写入一致性与安全

`resource.CRUD.Save` 每项自行开启并提交事务（`backend/internal/resource/store.go:311`），不能在外层简单循环调用实现“整包原子导入”。专用导入服务应复用已有 Skill、Connector、Expert 的领域校验/副作用约束，在**一个数据库事务**中完成资源、关联、绑定和成功批次记录，并按资源写审计事件；不要绕过现有认证配置变更导致的凭证/工具目录失效逻辑。若复用需要拆出事务内方法，优先最小改动，不复制一套宽松校验。

先完整校验并预写新对象到随机且不可覆盖的 S3 key，再开启短事务：按 publisher 加锁并锁定目标行 → 复核版本、revision、依赖及预览计划 → 写资源/关系/绑定/审计/批次 → 提交。失败回滚数据库并尽力删除**本次新增且未被引用**的对象；崩溃留下的孤儿需要后续清理机制，不能宣称 S3 与 PostgreSQL 真正跨系统原子提交。旧对象不在导入事务中删除。更新 Connector 可能撤销旧凭证，必须在预览中明确告知并要求管理员确认。

新来源资源默认为系统所有权，上传者记作操作者；不自动分配授权、标签、工具启用或凭证，不自动请求包内 URL，不允许修改本地/个人资源。响应和日志不回显认证敏感字段或完整内部解析错误。

## 6. API 与管理端交互

在现有管理员 Cookie 鉴权下增设：

- `POST /api/admin/v1/resource-imports/preview`：`multipart/form-data`，`package` 为整包 ZIP，可带 `options`（认证归属选择、异常 Skill 规范化确认）；返回来源、版本、Agent 资源动作（含移除/恢复）、**经校验但忽略的静态资源数量/路径**、旧授权再生效或 Connector 凭证失效的警告、`package_sha256` 与 `plan_digest`；不写资源。管理员必须确认本包为该 publisher 的最终 Agent 资源集合，缺失资源将停用；变更选项后必须重新预检。
- `POST /api/admin/v1/resource-imports`：再次提交同一 `package`、`options`、`package_sha256`、`plan_digest`，服务端**重新校验文件、选项和数据库状态**后应用；文件、选项、publisher 或目标 revision 改变返回 409 并要求重新预检。摘要只用于对齐预览，不作为客户端可信的授权依据。
- `GET /api/admin/v1/resource-imports` 与 `GET /api/admin/v1/resource-imports/{id}`：展示成功/失败批次、版本、Agent 资源结果、忽略的静态资源数量与脱敏错误；应用请求结果不明时据此核对，不盲目重试。

管理端在“AI 资源”区提供独立入口；步骤为选择 ZIP/目录、展示校验与差异、确认导入、查看批次结果。目录先在浏览器中按相对路径打成可上传 ZIP，再复用相同后端解析逻辑；保留生成的文件供确认时再次上传，避免为了预览引入长期暂存包和过期清理。页面刷新后需要重新选择文件。若实际包体或导入耗时超过同步请求能力，再在不改变预检语义的前提下演进为后台任务，不预先引入队列。

## 7. 实施顺序

1. 以 r0016 解压目录固化文件与摘要兼容样本；补齐原始发布 ZIP、私有 Rule/Skill、非空静态及设计资源的样本，验证已定的 Connector 映射、异常 Skill 规范化与发布端版本序列化。
2. 实现独立解析器与预检计划；覆盖 ZIP 安全、完整性、依赖闭包和冲突分类。
3. 增加迁移、publisher + slug 绑定、退役字段、Rule 启停、批次记录、四类资源 i18n JSONB/头像落点；更新 schema、sqlc、Agent 目录/Expert manifest/resolve DTO 与管理端读接口。
4. 实现含移除/恢复与依赖冲突预检的批量事务导入、对象存储失败补偿、审计及 publisher 级并发控制；接管理员路由。
5. 给四类资源响应加入只读来源信息，在事务内封禁所有人工本体写入口；复用当前已有的独立授权接口，保留现有权限边界下的凭证操作；管理端增加来源/退役展示及上传/预览/确认/历史，保留现有技能导入功能。
6. 后端为 Agent 目录/manifest/resolve 下发原始 i18n 映射并更新契约；Agent 客户端的语言选择、持久化和客户端搜索留给后续独立任务。
7. **本次服务端与管理端全部完成后统一验收**，不在每个小功能后重复做最终测试。

## 8. 验收标准

- r0016 解压目录经管理端打包、以及发布端原始 ZIP，都能通过 canonical manifest、产物摘要及全包校验；篡改、缺失、重复路径、ZIP 炸弹、额外条目及非空设计分区有明确错误，库/S3 无已生效资源；合法非空静态分区经校验后跳过并在预览/历史中标注，静态文件被篡改仍阻断整包。
- 原始 r0016 中异常 Skill 在预览提示并确认后规范化，Rule、Header/OAuth DCR Connector（60 秒超时、OAuth scope/Header 提示均保留）、Expert（含头像）导入后能在管理端查看；额外构造私有 Skill/Rule 样本覆盖 r0016 未包含的情况；Expert 的依赖及 Agent 下发与原有授权语义一致，未授权用户不能单独获取私有依赖。
- 同包重传跳过；新版本稳定更新同源资源；产物字节不变但 manifest i18n/选项变化时判为更新，只有 ZIP 编码变化而已应用内容不变时跳过；同版本换包、版本回退、并发导入返回冲突；管理员创建和个人资源、独立授权及凭证不被意外覆盖。
- 管理员确认上传包为最终 Agent 清单后，缺失资源在同一批次退役，Skill/Rule/Connector/Expert 都不能经直接访问或 Expert 关联继续使用；有活跃外部引用或异常目标状态则整包阻断；重现时复用原 ID 恢复，旧授权与凭证的潜在再生效在预览中可见；S3 包和历史引用仍保留。
- 四类导入资源的 PUT/PATCH/DELETE、技能包/图标替换、标签和工具配置均无法被管理员或用户直接修改；独立授权/组与 Connector 凭证操作按原权限可用，授权导致 revision 变化不误报 diff 冲突；导入器仍可按版本更新/退役/恢复，管理员创建的资源仍可编辑。
- 四类资源的名称/描述翻译均存储并下发到 Agent 目录、Expert manifest 和 resolve；`en`、`en-US`、`zh-CN` 原始映射完整保留，旧 Agent 继续使用基础字段；仅翻译变化能刷新列表/manifest 文案但不重下载 Skill ZIP、不改 Rule 正文或 Expert prompt。Agent 客户端切换语言不属于本次验收。
- 导入中任一资源失败，四类资源及绑定无部分数据库提交；S3 新对象失败补偿和不可补偿孤儿均可定位；审计与批次历史能定位成功、失败及操作者。
- 完成时统一运行解析器/映射单测、数据库集成测试、前端检查和端到端导入验收；检查 schema/sqlc 同步及管理端构建。

## 9. 与现状的关键差异

- 技能包独立导入在 `admin/src/components/skill-import-wizard.tsx`、`backend/internal/skill/service.go`；资源包应是另一个入口。
- `backend/internal/resource/store.go` 的单资源事务、`backend/internal/expert/service.go` 的依赖校验以及 `backend/internal/mcp/service.go` 的认证变更副作用决定了导入不能仅是“读取 JSON 后循环调 CRUD”。
- 现有 `backend/schema/schema.sql` 的 `rules` 无 `enabled`，本方案为自动退役而补齐；Connector 仅有 URL、认证模式/方式、OAuth 配置，不支持发布端的所有配置字段。
- 附件 §9 是建议而非当前实现；其示例 `Manifest` 省略 `design_resources`，但实际哈希契约需要该字段，实施时以 §4–§6 和发布端样本为准。

## 10. 已确认的产品决策与本期限制

1. **最终 Agent 清单**：管理员本次上传的完整包是该 publisher 的最终 Agent 资源集合，无需新增全量标记；按新版本清单同步并停用缺失的旧 Agent 资源，预览须明确影响范围并经管理员确认。仍执行版本递增与同版本冲突校验。
2. **Connector 必须可用**：补齐 Header/OAuth DCR 映射和 Connector 级 60 秒超时。首次导入认证归属默认独立，管理员可在预览显式选集中；重导入保留已选归属。保留 Header 名称与 OAuth scope，认证配置变更可能使凭证失效时须明确提示并确认。
3. **异常 Skill frontmatter 可经确认规范化**：原产物完整性验证后，不合规的 `SKILL.md` 名称可改为经校验的 slug；`content-repurposer` 和 `hyperframes-local-promo` 的未加引号 description 含 `: ` 时，仅补 YAML 引号并保持描述文本及正文不变。两种变更均须在预览展示原值/新值与新存储包 SHA 并由管理员确认，不能擅自扩大到其他格式错误。
4. **独立静态资源本期不导入**：仍校验路径与 SHA，成功批次明确报告“已忽略”而不落库；静态变动不参与 Agent 集合的 diff/退役。非空设计资源仍不支持并在预检中阻断。
5. **只有管理员上传**：本期不接入其他发布来源或自动同步；`publisher` 从上传包读取并作为唯一身份的一部分，管理员承担选择可信包的责任，不在本期引入发布者签名/注册。

上述决策已定；实现时仍须拿原始外层 ZIP 和包含 Expert 独占依赖/非空静态资源的样本完成兼容验证，而非重新讨论产品策略。

## 11. r0016 样本核对记录（2026-10-09）

用户提供的 `release-r0016` 是**解压目录**，不是外层 ZIP。它包含 `release.json`、`manifest.json`、`CHECKSUMS.sha256` 和 39 个 Agent 产物：34 Skill、1 Rule、2 Connector、2 Expert。`release_id=6321da1e-bf59-41a1-9ae9-da60997dd67e`，`version=16`；`design_resources` 各列表与 `static_assets` 为空。

- 用样本内容重新计算，manifest 规范化摘要等于 `sha256:44a280df3279e907e4b8047fc4eb78f4913597b95ed56884ca7aa8c4de1207dd`；`CHECKSUMS.sha256` 共 40 条（39 个产物 + `manifest.json`），与目录里的文件字节摘要全部匹配。未提供外层 ZIP，因此**尚未验证**外层 ZIP 路径/重复条目/解压上限。
- 34 个顶层 Skill ZIP 都有根目录 `SKILL.md`、`skill.json`；`transcription-automation` 的 `SKILL.md` 写 `name: Transcription Automation`，但 `backend/internal/skill/package.go` 仅接受无空格安全目录名，因此该文件会在当前解析器中被拒绝。不能声称“全部原样可导入”。
- 两个 Expert ZIP 分别有 19、13 个 Skill 依赖；内嵌 Skill 的文件内容与顶层同 slug Skill 的文件一致（去掉发布专用 `skill.json` 比对）；`video-storyboard` 包含头像。两个 Expert 均无私有 Skill/Rule 或 Connector 依赖，因此这些分支的实现需要**另外准备测试样本**。
- 两个 Connector 分别是 DCR OAuth 与 Header 认证，超时均为 60 秒：按此前“仅 HTTP + 免认证”的映射策略，**这份包会整包被拒绝**。第 4.1 节是为支持这份包而必须落实的增量工作，不代表当前代码已具备相应能力。
- i18n 覆盖：34 个 Skill 均有 `description_i18n`（`en-US`、`zh-CN`），1 条 Rule 有 `name_i18n.zh-CN`，2 个 Connector 中 1 个有 `name_i18n.zh-CN`，2 个 Expert 中 1 个有 `name_i18n`/`description_i18n`（`en`、`zh-CN`）。不能假定所有资源或字段都提供每种语言。

> 当前状态：本期后端、管理端和 Agent API 代码已完成，Go/SQLC/管理端检查与 r0016 目录解析通过；用户明确选择跳过 PostgreSQL 运行时验收，不声明导入事务已在真实数据库中验证。Agent 客户端语言选择排除本期，外层 ZIP、独占依赖和非空静态资源原始样本仍待补齐。
