# 会话上报后端方案（第一期）

> 状态：设计方案，第一期只采集使用统计事实，不接收会话正文。
>
> 适用范围：MonkeyCode/monkeyai/backend。
>
> 依据：`SESSION-REPORTING-PLAN.md`、`SESSION-REPORTING-SPEC.md`，以及当前会话、网关、计费、设备和统计实现。

## 1. 目标与边界

第一期解决以下问题：

- 以会话和轮次为核心统计单位，准确统计任务数、轮次结局、耗时、失败原因和资源使用。
- 将模型、MCP、生图调用及其计费事实关联到会话，包括子代理会话。
- 支持离线补传、客户端崩溃恢复、重试幂等和多端宿主保护。
- 支持后台按资源、客户端、会话和顶层任务查询统计。
- 不上传或保存对话正文、思考过程、命令内容、工具参数、工具输出、文件内容和附件。

第一期不实现：

- `started`、`running` 轮次和心跳。
- transcript、replay record、文件和对象存储附件。
- 会话正文、标题全文搜索和内容审计。
- 多层子代理递归汇总。第一期最多按一层子代理处理。

## 2. 现有实现与改造点

当前后端已有：

- `sessions` 会话表，但没有会话上报写接口。
- `model_calls`、`mcp_tool_calls` 和计费流水的部分会话关联。
- `endpoints` 设备表和设备管理接口。
- 管理端统计读取 `sessions`，任务统计仍把 `ended_at IS NULL` 当作运行中。

第一期需要新增或修改：

| 模块 | 改造内容 |
| --- | --- |
| `internal/session` | 新增会话 PUT、轮次批量 POST、占位会话、宿主认领、轮次事务和管理员查询能力 |
| `internal/proxy` | 优先读取 `X-MAI-Session-ID`，兼容 `X-Session-ID`，并将归属传到调用与计费链路 |
| `internal/mcp` | 同上，补充 MCP 调用耗时 |
| `internal/imageproxy` / `internal/imagegen` | 读取会话头，在异步 job 创建时保存会话，最终写入生图调用 |
| `internal/model` | 用户自建模型路径写入 `model_calls.session_id` |
| `internal/setting` | 下发 `settings.session_reporting` |
| `internal/endpoint` | 支持 runtime 设备登记和新的设备属性 |
| `internal/stats` | 改用轮次统计，按网关调用计算最近活跃任务 |
| `api/agent.yaml` / `api/admin.yaml` | 增加接口契约和错误响应 |
| `migrations` | 增量迁移，不修改已有迁移文件 |

## 3. 身份与归属模型

### 3.1 会话 ID和设备 ID

客户端 runtime 在创建会话时生成 UUIDv4。此 ID 同时传给引擎、本地存储和服务端，生命周期内不变，服务端不负责签发。

设备级 `machine_id` 由客户端生成并持久化。它通过 `X-MAI-Machine-ID` 参与会话宿主认领，用于防止多个 runtime 同时写入同一个会话，但不是认证凭证。OAuth Bearer token 或现有调用密钥仍然是用户身份来源。

### 3.2 父子会话

- 顶层会话的 `parent_session_id` 为 NULL。
- 子代理会话使用独立的 session ID，并将父会话 ID写入 `parent_session_id`。
- 子代理的模型和 MCP 调用归属于子会话。
- 任务数量只统计已登记、未清除的顶层会话。
- 费用和网关调用向顶层会话汇总。
- 父关系必须满足：父会话存在、属于同一用户、必须是顶层会话、不能指向自身、不能形成环。
- 第一期不新增 `root_session_id`，统计时用一层父关系归并；自引用由数据库 CHECK 拦截，第二层关系由写事务锁定父会话并校验。

正式父子关系以会话 PUT 为准。子代理首次调用可能早于会话 PUT，因此网关允许使用父头创建占位会话：

- `X-MAI-Session-ID`：当前调用的会话 ID。
- `X-MAI-Parent-Session-ID`：可选父会话 ID。

如果父会话不存在、属于其他用户或关系非法，忽略父头，不根据它建立跨用户关系。

### 3.3 请求头兼容

服务端优先读取 `X-MAI-Session-ID`，没有时继续读取已发布的 `X-Session-ID`。两者同时存在时以新头为准。客户端第一期只发送 `X-MAI-*` 头。

服务端处理请求头的顺序：

1. 无会话头：保持现有行为，不创建会话。
2. UUID 格式非法：返回 `400 invalid_session`。
3. 会话存在且属于当前用户：归属到该会话。
4. 会话存在但属于其他用户：返回 `403 invalid_session`。
5. 会话不存在：创建当前用户的占位会话后归属调用。

内部头不得转发给上游模型、MCP 服务或供应商。

## 4. 数据库设计

所有变更使用新的增量 migration，不能修改已经发布的初始迁移。

### 4.1 扩展 `sessions`

保留现有主键、用户归属、软删除和财务关联，增加以下列：

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `group_id` | `uuid NULL` | 创建时的分组快照，关联 `groups(id)` |
| `model_id` | `uuid NULL` | 会话当前模型 |
| `parent_session_id` | `uuid NULL` | 自关联父会话 |
| `mode` | `text NULL` | 会话模式 |
| `workspace_kind` | `text NULL` | 工作区类型 |
| `client_version` | `text NULL` | 客户端版本 |
| `engine_version` | `text NULL` | 引擎版本 |
| `runtime_version` | `text NULL` | runtime 版本 |
| `placeholder` | `boolean NOT NULL DEFAULT false` | 是否由网关临时创建 |
| `started_at_provisional` | `boolean NOT NULL DEFAULT false` | 开始时间是否来自占位创建 |
| `clock_suspect` | `boolean NOT NULL DEFAULT false` | 客户端时间与服务端时间偏差过大 |
| `state_seq` | `bigint NOT NULL DEFAULT 0` | 会话快照序号 |
| `state_hash` | `bytea NULL` | 同序号幂等校验 |
| `state_received_at` | `timestamptz NULL` | 最近会话快照接收时间 |
| `resources_snapshot_id` | `text NULL` | 最新轮次资源快照 |
| `acked_turn` | `integer NOT NULL DEFAULT 0` | 服务端已确认的最大轮次 |
| `facts_version` | `integer NULL` | 当前轮次事实版本 |
| `last_stop_reason` | `text NULL` | 最新轮次结束原因 |
| `active_seconds` | `bigint NOT NULL DEFAULT 0` | 所有已接收轮次耗时之和 |
| `client_deleted_at` | `timestamptz NULL` | 客户端删除时间 |
| `purged_at` | `timestamptz NULL` | 服务端清除墓碑时间 |
| `reporting_enabled_at` | `timestamptz NULL` | 第一次进入一期上报的时间；用于排除功能启用前的旧会话 |

迁移兼容要求：

- 重建现有 `sessions_client_type_check`，允许 `unknown`。占位会话显式写 `session_type='conversation'`、`client_type='unknown'`、`title=''`、`client_name=''`、`started_at=now()`、`last_active_at=NULL`、`placeholder=true`、`started_at_provisional=true`；其他原有非空字段也必须满足现有约束。
- `last_active_at` 改可空，现有业务时间约束迁移时同步调整。
- 替换现有跨列时间 CHECK：客户端业务时间单独校验，不能因时钟偏差阻塞轮次入库；`clock_suspect` 只做质量标记。轮次自身仍要求 `ended_at >= started_at`。
- 保留现有 `deleted_at`，已有统计和 `SessionOwned` 继续排除软删除数据。
- `device_id` 复用为宿主 `machine_id` 的规范化字符串，不额外创建第二个宿主列。
- `parent_session_id` 建自关联外键，并增加非自引用约束；服务层要求父会话为顶层会话。
- 不新增会话级 `status`。第一期不把 `ended_at IS NULL`解释为运行中。
- `reporting_enabled_at` 只在网关创建占位或会话首次 PUT时写入；启用前已有的旧会话不补传，也不进入第一期新增任务统计。

索引：

```sql
CREATE INDEX sessions_group_started_idx
    ON sessions (group_id, started_at DESC)
    WHERE group_id IS NOT NULL AND purged_at IS NULL;

CREATE INDEX sessions_parent_idx
    ON sessions (parent_session_id)
    WHERE parent_session_id IS NOT NULL;
```

现有会话列表、所有权校验和统计查询必须同时过滤 `purged_at IS NULL`、`deleted_at IS NULL`，以及需要正式任务时的 `placeholder = false`。第一期新增任务统计还必须过滤 `reporting_enabled_at IS NOT NULL`，避免旧会话与新轮次混合计算。

### 4.2 `session_resource_snapshots`

保存一轮开始时固定的资源集合。`snapshot_id` 是规范化资源内容的 SHA-256，不依赖服务端 revision 或 engine 实例。

```sql
CREATE TABLE session_resource_snapshots (
    session_id uuid NOT NULL REFERENCES sessions(id),
    snapshot_id text NOT NULL,
    revision bigint,
    state_version bigint,
    items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array'),
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, snapshot_id)
);
```

`items` 只保存统计所需的资源元数据，例如资源 ID、类型、版本、是否启用、是否可用和不可用原因。不得保存技能正文、MCP 参数或文件路径。

### 4.3 `session_resource_snapshot_items`

由服务端从快照展开，客户端不能单独写入此表。

```sql
CREATE TABLE session_resource_snapshot_items (
    session_id uuid NOT NULL,
    snapshot_id text NOT NULL,
    resource_id text NOT NULL,
    kind text NOT NULL,
    name text,
    source text,
    version text,
    digest text,
    enabled boolean NOT NULL,
    available boolean NOT NULL,
    status text,
    reason text,
    PRIMARY KEY (session_id, snapshot_id, resource_id),
    FOREIGN KEY (session_id, snapshot_id)
        REFERENCES session_resource_snapshots(session_id, snapshot_id)
        ON DELETE CASCADE
);

CREATE INDEX session_snapshot_items_resource_idx
    ON session_resource_snapshot_items (resource_id, enabled);
```

### 4.4 `session_turns`

轮次是第一期统计事实的核心表，只存已结束轮次。

```sql
CREATE TABLE session_turns (
    session_id uuid NOT NULL REFERENCES sessions(id),
    turn_index integer NOT NULL CHECK (turn_index > 0),
    facts_version integer NOT NULL,
    report_hash bytea NOT NULL,
    input_seq bigint NOT NULL,
    started_at timestamptz NOT NULL,
    ended_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    stop_reason text NOT NULL CHECK (
        stop_reason IN (
            'complete', 'interrupted', 'error',
            'max_turns', 'output_limit', 'unknown'
        )
    ),
    error_code text,
    recovered boolean NOT NULL DEFAULT false,

    model_id uuid REFERENCES models(id),
    thinking_enabled boolean,
    thinking_effort text,
    resources_snapshot_id text NOT NULL,
    client_version text,
    engine_version text,

    input_tokens bigint,
    output_tokens bigint,
    cache_creation_input_tokens bigint,
    cache_read_input_tokens bigint,
    subagent_input_tokens bigint,
    subagent_output_tokens bigint,
    subagent_cache_creation_input_tokens bigint,
    subagent_cache_read_input_tokens bigint,
    context_used bigint,
    context_window bigint,

    input_kind text NOT NULL,
    input_client_type text,
    input_machine_id text,
    command_skill_id text,
    attachments integer NOT NULL DEFAULT 0,
    canvas_nodes integer NOT NULL DEFAULT 0,
    steers integer NOT NULL DEFAULT 0,
    files_created integer NOT NULL DEFAULT 0,
    files_updated integer NOT NULL DEFAULT 0,
    files_deleted integer NOT NULL DEFAULT 0,
    compactions integer NOT NULL DEFAULT 0,
    permissions_asked integer NOT NULL DEFAULT 0,
    permissions_allowed integer NOT NULL DEFAULT 0,
    permissions_denied integer NOT NULL DEFAULT 0,
    truncated boolean NOT NULL DEFAULT false,

    PRIMARY KEY (session_id, turn_index),
    FOREIGN KEY (session_id, resources_snapshot_id)
        REFERENCES session_resource_snapshots(session_id, snapshot_id),
    CHECK (ended_at >= started_at),
    CHECK (input_tokens IS NULL OR input_tokens >= 0),
    CHECK (output_tokens IS NULL OR output_tokens >= 0),
    CHECK (context_used IS NULL OR context_used >= 0),
    CHECK (context_window IS NULL OR context_window >= 0),
    CHECK (attachments >= 0 AND canvas_nodes >= 0 AND steers >= 0),
    CHECK (files_created >= 0 AND files_updated >= 0 AND files_deleted >= 0),
    CHECK (compactions >= 0 AND permissions_asked >= 0),
    CHECK (permissions_allowed >= 0 AND permissions_denied >= 0)
);

CREATE INDEX session_turns_started_idx
    ON session_turns (started_at);

CREATE INDEX session_turns_model_started_idx
    ON session_turns (model_id, started_at)
    WHERE model_id IS NOT NULL;
```

用量字段是客户端报告的执行事实，不是计费金额。网关 Token 和积分流水仍然是会话级权威账务来源。

### 4.5 `session_turn_tools`

每轮按工具类别、资源和名称聚合调用，不保存参数和输出。

```sql
CREATE TABLE session_turn_tools (
    session_id uuid NOT NULL,
    turn_index integer NOT NULL,
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    category text NOT NULL CHECK (
        category IN ('builtin', 'skill', 'workflow', 'agent',
                     'connector', 'local_mcp')
    ),
    name text,
    resource_id text,
    resource_origin text,
    resource_version text,
    server text,
    target text,
    calls integer NOT NULL CHECK (calls > 0),
    failed integer NOT NULL CHECK (failed >= 0 AND failed <= calls),
    duration_ms bigint NOT NULL CHECK (duration_ms >= 0),
    PRIMARY KEY (session_id, turn_index, ordinal),
    FOREIGN KEY (session_id, turn_index)
        REFERENCES session_turns(session_id, turn_index)
        ON DELETE CASCADE
);

CREATE INDEX session_turn_tools_resource_idx
    ON session_turn_tools (category, resource_id);
```

### 4.6 `session_skill_events`

只记录实际加载技能正文的事件，不把搜索、推荐或未解析名称当作成功使用。

```sql
CREATE TABLE session_skill_events (
    session_id uuid NOT NULL,
    turn_index integer NOT NULL,
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    skill_id text,
    name text,
    origin text,
    version text,
    digest text,
    trigger text NOT NULL CHECK (trigger IN ('user', 'model', 'workflow')),
    ok boolean NOT NULL,
    reason text,
    PRIMARY KEY (session_id, turn_index, ordinal),
    FOREIGN KEY (session_id, turn_index)
        REFERENCES session_turns(session_id, turn_index)
        ON DELETE CASCADE
);

CREATE INDEX session_skill_events_skill_idx
    ON session_skill_events (skill_id, trigger)
    WHERE skill_id IS NOT NULL;
```

### 4.7 现有调用与设备表

增量修改：

```sql
ALTER TABLE image_calls
    ADD COLUMN session_id uuid REFERENCES sessions(id);

CREATE INDEX image_calls_session_started_idx
    ON image_calls (session_id, started_at)
    WHERE session_id IS NOT NULL;
```

`endpoints` 增加：

- `client_type`、`client_name`、`channel`。
- `locale`、`system_locale`、`timezone`。
- `runtime_version`、`engine_version`、`electron_version`。
- `last_reported_at`。
- `protocol_version` 改为可空。
- `platform` 枚举增加 `web`。

已有 `model_calls`、`mcp_tool_calls` 的会话时间索引应复用，不重复建索引。用户自建模型路径必须补写 `model_calls.session_id`。MCP 调用必须补写 `duration_ms`。

### 4.8 生图异步任务归属

仅给 `image_calls` 加列不够。会话 ID必须先落在异步任务上，worker 才能在 HTTP 请求结束后继续传递归属：

```sql
ALTER TABLE image_jobs
    ADD COLUMN session_id uuid REFERENCES sessions(id);

CREATE INDEX image_jobs_session_idx
    ON image_jobs (session_id, created_at)
    WHERE session_id IS NOT NULL;
```

建议让所有生图调用（包括用户自建模型）最终进入统一的 `image_calls`。如果现有 `image_calls.id` 强制对应计费事务，需要改为：

- 已计费调用使用 billing transaction ID；
- 用户自建调用使用 job ID；
- `image_calls.job_id` 唯一，用于幂等；
- 原 `image_calls.id REFERENCES billing_transactions(id)` 外键必须移除；增加可空 `billing_transaction_id uuid UNIQUE REFERENCES billing_transactions(id)`，迁移时将现有行的 `billing_transaction_id` 回填为原 `id`，已计费新行保持 `id=bt.id`；非计费行使用 `id=job.id`。

财务流水仍只记录实际发生的计费事实，不因统计关联改写计费语义。

## 5. 设置和设备登记

### 5.1 会话上报开关

`GET /api/v1/settings` 的 `settings` 增加：

```json
{
  "session_reporting": {
    "enabled": true,
    "level": "stats"
  }
}
```

规则：

- 配置缺失或 `enabled=false`：客户端不发送会话上报和会话请求头。
- `level=stats`：启用第一期。
- `level=full`：属于第二期能力；第一期服务端将其降级为 `stats`，不开放正文接口。
- 未知 level 按 `stats` 处理。
- 设备登记不受该开关影响。
- 现有 ETag 轮询支持配置热更新。
- 新版本服务端通过配置迁移写入 `session_reporting` 默认值 `enabled=true, level=stats`；旧版本服务端没有该配置段时，客户端按关闭处理，以保证旧服务端兼容。
- 需要同步扩展 settings 的数据库 key 约束、白名单、校验、管理端读写和 Agent 配置输出，不能只修改响应 JSON。

服务端必须通过请求字段白名单强制第一期边界，不能只依赖客户端不发送内容。

### 5.2 设备登记

复用 `PUT /api/v1/endpoints/{machine_id}`，由 runtime 在启动、设备信息变化和每 24 小时执行。登记按 `(user_id, machine_id)` 幂等覆盖当前设备属性。

- 已撤销设备不因登记自动恢复。
- 设备数量超限返回 `409 endpoint_limit_exceeded`，不阻断会话上报。
- 设备登记失败不影响模型调用和轮次上传。
- 设备表保存当前慢变属性；历史版本归因使用会话和轮次内固化的版本字段。

## 6. 会话写入接口

### 6.1 `PUT /api/v1/sessions/{id}`

认证：OAuth Bearer。

请求头：

- `X-MAI-Machine-ID`：必填，UUID 格式。
- `Content-Type: application/json`。

请求是完整会话元数据快照，第一期不上传标题正文。主要字段：

- `state_seq`。
- `session_type`、`client_type`、客户端/引擎/runtime 版本。
- `parent_session_id`。
- `expert_id`、`model_id`、`mode`、`workspace_kind`。
- `started_at`。
- `client_deleted_at`。

服务端事务：

1. 校验会话 ID、字段白名单、用户身份和时间关系。
2. 会话不存在时创建正式会话；若由网关提前创建，则补齐占位行。
3. 锁定会话并校验 owner、`deleted_at`、`purged_at`。
4. 首次 PUT 使用条件更新认领空 `device_id`；已有其他宿主时返回 `409 not_host`。
5. 校验父会话同用户、非自身且不成环。
6. `state_seq` 大于现值才更新；相同序号必须比较 `state_hash`，相同为幂等成功，不同返回 `409 state_conflict`；更旧返回 `409 stale_state_seq`。
7. 不修改由轮次接口负责的列。
8. 返回 `{state_seq, acked_turn, server_time}`。

会话 PUT 不允许客户端覆盖已确认的父关系、分组快照、轮次统计和费用事实。

### 6.2 `POST /api/v1/sessions/{id}/turns`

认证和请求头同会话 PUT。请求包含：

- `facts_version`。
- 最多 50 个已完成轮次。
- 本批次所需的资源快照及其展开信息。
- 每轮工具聚合和技能事件。

第一期只接受 `finished` 轮次。客户端上报之前必须本地持久化并 fsync；服务端不接收进行中轮次。

服务端使用一个数据库事务：

1. 锁定会话行，校验 owner、宿主和未清除状态。
2. 校验服务端游标和轮次顺序。
3. 复算每个资源快照摘要；摘要不匹配则拒绝。
4. 先写快照和展开项，再写轮次、工具聚合和技能事件。
5. 对 `(session_id, turn_index)` 做幂等处理：报告 hash 相同则视为已确认，hash 不同返回 `409 report_conflict`。
6. 只接受严格递增的新轮次；批次中间失败时整体回滚。
7. 从 `session_turns` 全量重算会话派生列：`turn_count`、`active_seconds`、`ended_at`、`last_active_at`、`failure_code`、`last_stop_reason`、`resources_snapshot_id` 和 `acked_turn`。`acked_turn` 必须等于连续已确认前缀，而不是简单取最大 `turn_index`。
8. 返回新的 `acked_turn`、快照确认结果和服务端时间。

`ended_at < started_at`、负数计数、未知错误码和越界字段均返回 400，不自动修正。

### 6.3 错误码

| HTTP | 错误码 | 处理 |
| --- | --- | --- |
| 400 | `invalid_session`、`invalid_state`、`time_order` | 客户端修正，不原样重试 |
| 401 | `invalid_token` | 等待凭证刷新 |
| 403 | `session_owned_by_other` | 停止上传 |
| 404 | `session_not_registered` | 先补 PUT |
| 409 | `stale_state_seq`、`state_conflict`、`cursor_mismatch`、`not_host`、`report_conflict` | 按错误码对账或停止 |
| 413 | `payload_too_large` | 拆分批次 |
| 422 | `unsupported_version` | 搁置并提示升级，返回 `supported` |
| 429 | `rate_limited` | 遵守 `Retry-After` |
| 5xx | `temporary_failure` | 退避重试 |

除压缩后批次限制外，还要限制 gzip 解压后的大小、JSON 深度、字段长度、快照项目数、工具组数量和技能事件数量。

## 7. 网关和计费链路

### 7.1 共用会话解析器

实现一个后端内部的会话解析组件，供模型、MCP 和生图网关调用：

```text
ResolveSession(user_id, session_header, parent_header)
    -> session_id, parent_session_id, placeholder_created
```

组件负责：

- 新旧请求头优先级。
- UUID 和归属校验。
- 占位会话 `INSERT ... ON CONFLICT DO NOTHING`。
- 同用户分组快照。
- 父关系校验。
- 每用户占位数量限制。
- 已清除 ID 的墓碑保护。

调用顺序固定为：鉴权确定用户 → 解析会话头并创建/验证占位 → 调用计费 Begin 或用户自建模型记录。否则现有 `billing.Begin` 的 `SessionOwned` 会在占位前返回 403。占位创建及并发冲突处理必须提交成功后再继续调用；不能只在 HTTP handler 读头后丢弃结果，解析结果必须一路传到调用记录和计费事务。

### 7.2 模型

- 系统模型：会话 ID进入现有 billing transaction，并沿 `billing_transactions.session_id -> model_calls.session_id` 入库。
- 用户自建模型：修改直接写 `model_calls` 的路径，增加 `session_id`。
- 会话调用归属不影响费用计算；费用以 billing transaction 和 credit ledger 为准。
- 调用转发前删除 `X-MAI-Session-ID`、`X-MAI-Parent-Session-ID`、`X-MAI-Machine-ID` 和旧会话头。

### 7.3 MCP

- 读取新头并创建或解析会话。
- 传入现有 billing request 和调用记录。
- 结算时写入 `mcp_tool_calls.session_id` 和 `duration_ms`。
- 连接建立、工具列表发现不计为业务工具调用，除非已有明确的调用记录语义。

### 7.4 生图

- 生成和编辑接口读取会话头。
- 创建 `image_jobs` 时立即保存 `session_id`。
- billing Begin、异步 worker、最终 `image_calls` 均从 job 读取会话归属，不读取已经结束的 HTTP context。
- 生图任务的提交、运行、完成、失败和未知状态都必须在实时查询中有明确映射。
- 生图任务查询只按用户和任务权限返回，不因 session 头扩大访问范围。

## 8. 统计口径

### 8.1 任务统计

- 会话数只统计 `placeholder=false`、`purged_at IS NULL`、`deleted_at IS NULL`、`parent_session_id IS NULL` 的顶层会话。
- 轮次数来自 `session_turns`。
- 完成率为 `complete / 已知结局`；`unknown` 不进入分母。
- `interrupted` 单独统计，不视为失败。
- `error`、`max_turns`、`output_limit` 按失败/异常结局统计。
- 平均、P50、P95 耗时使用轮次 `ended_at - started_at`。
- 补传轮次按客户端业务时间统计，不按接收时间伪造当前活动。

### 8.2 实时活跃

第一期没有会话级运行状态。活跃任务定义为统计窗口内有模型、MCP 或生图调用，或仍有运行中计费事务/生图任务的会话，按父链归并到顶层会话。已完成调用用于“最近活跃”，运行中的系统模型/MCP 使用 `billing_transactions`，生图使用 `image_jobs` 状态；用户自建模型如需展示运行中，必须在调用开始时写入 `model_calls` 的 running 记录，结束时更新同一行。

不再使用 `sessions.ended_at IS NULL` 判断运行中。已有实时 SQL 中依赖该语义的逻辑必须改写。

### 8.3 资源统计

区分三类指标：

- 窗口内曾开启：轮次快照中 `enabled=true` 的会话去重。
- 窗口内使用：工具聚合或技能事件实际出现的会话去重。
- 调用和失败：团队连接器的次数、失败率和时延只使用网关 `mcp_tool_calls`；本机 MCP 和网关不可观测的工具使用轮次报告，两路不得相加。

资源改名、删除或升级后，历史按稳定资源 ID和版本聚合，不按当前名称覆盖历史。

### 8.4 客户端统计

- 平台、系统版本、语言使用设备表的当前属性。
- 客户端、引擎、runtime 版本使用轮次内固化的执行版本。
- 版本统计回答实际执行时的成功率，不使用设备当前版本倒推历史。

### 8.5 费用汇总

- 费用使用 `credit_ledger_entries` 的 charge/refund 净额，按流水 `session_id` 关联；冲正时保留既有计费事务和财务可追溯性。
- 子会话费用沿 `parent_session_id` 汇总到顶层会话。网关父头若误先绑定了错误但同用户的顶层父会话，正式 PUT 必须经同用户与无环校验后纠正未确认的占位父关系，并记录异常；一旦有财务/统计输出则不能静默变更历史归因。
- 会话 `group_id` 是任务创建时快照；财务流水的 `group_id` 仍按计费时快照，两者不强行覆盖。
- 客户端上报的 usage 用于轮次详情和对账，不直接换算积分。
- 当前协议只有 session ID，没有可靠 turn ID，因此第一期不承诺把网关 Token/费用精确分配到某一轮。

## 9. 管理端接口

第一期增加或调整以下管理员接口：

- `GET /api/admin/v1/sessions`：分页列出顶层会话，可按用户、分组、专家、模型、时间和客户端筛选，不做正文或标题搜索。
- `GET /api/admin/v1/sessions/{id}`：会话元数据、子会话、轮次、资源快照、工具聚合、技能事件和网关调用。
- `DELETE /api/admin/v1/sessions/{id}`：清除统计数据并保留会话墓碑。
- `GET /api/admin/v1/statistics/resources`：资源开启、使用、调用、失败和可用性。
- `GET /api/admin/v1/statistics/clients`：客户端平台、版本、语言和失败率。
- 现有 `/statistics/tasks`、`/statistics/realtime`、`/statistics/history` 按第 8 节口径改造。

第一期所有管理接口返回统计元数据，不返回正文、工具参数、工具输出、文件路径和附件内容。

### 9.1 页面信息架构

在现有管理后台的统计模块下增加“会话分析”菜单，第一期包含四个页面：

#### A. 会话总览

路由建议：`/admin/statistics/session-reporting`

顶部提供统一筛选条件：时间范围、分组、用户、模型、客户端类型、平台和结局。时间统一使用半开区间 `[from, until)`，默认最近 24 小时。

指标卡：

- 顶层会话数、轮次数。正式会话统计统一过滤 `reporting_enabled_at IS NOT NULL`、`placeholder=false`、`deleted_at IS NULL`、`purged_at IS NULL`。
- 完成率、异常率、中断数。
- 平均/P50/P95 轮次耗时。
- 最近活跃任务数。
- 输入/输出 Token、费用净额。
- 上报延迟、占位会话数、游标冲突数和时钟异常数。

图表：

- 会话和轮次按时间趋势。
- 结局分布。
- 模型、资源和客户端 Top 排名。
- 网关调用量、失败率和费用趋势。

实时卡片只展示“最近活跃任务”，必须明确标注数据窗口和更新时间，不显示“正在运行”的绝对承诺。默认 30 秒刷新，页面离开后停止轮询。

#### B. 会话列表

路由建议：`/admin/statistics/session-reporting/sessions`

列表只展示顶层会话，支持游标分页和服务端排序。列建议：

- 开始时间、最后活跃时间、会话 ID。
- 用户、分组、客户端/平台、客户端版本。
- 模型、轮次数、总活跃时长。
- 最新结局、失败/中断标记、费用净额。
- 子代理数、占位标记、时钟异常标记。

支持按会话 ID、用户、分组、模型、客户端、结局和时间筛选；第一期不支持标题或正文搜索。会话 ID提供复制按钮，长 ID只在视觉上截断，筛选和跳转使用完整值。

占位会话默认不显示，可通过“包含占位会话”筛选查看；已清除会话默认不显示，仅在拥有清除审计权限时显示墓碑摘要。

#### C. 会话详情

路由建议：`/admin/statistics/session-reporting/sessions/:sessionId`

页面头部显示：会话 ID、用户、分组快照、开始/结束时间、客户端、宿主、模型、顶层/子会话关系、费用和数据更新时间。

页面分为四个 Tab：

1. **轮次**：轮次序号、输入来源、开始/结束时间、耗时、结局、错误码、客户端上报 Token、工具数、技能事件数和资源快照摘要。每轮可展开查看工具类别、资源 ID/版本、调用数、失败数、耗时，以及技能 ID、触发来源、版本、成功状态和失败原因。
2. **资源**：每个资源在会话期间的开启状态、使用次数、失败次数、版本和可用性变化。
3. **调用**：模型、MCP、生图调用的开始时间、类型、状态、耗时、网关 Token、错误码和费用；明确标注“会话级网关事实”。
4. **子会话**：子代理 ID、父关系、轮次数、结局、费用和调用汇总。

第一期禁止展示正文、思考、命令、工具参数、工具输出、文件路径和附件。客户端上报 usage 与网关用量不一致时，页面分别展示，不在页面端合并或二次计费。

详情页提供“清除统计数据”按钮，但只对拥有清除权限的管理员显示。操作前要求输入完整 session ID 二次确认，并明确提示：财务流水不会被删除，清除后会话不可恢复。

已清除会话的详情权限分支：普通统计管理员返回 `410 session_purged`，不返回轮次、资源和调用明细；拥有清除审计权限的管理员只能查看固定墓碑摘要（session ID、用户、清除时间、操作人、审计 ID），不能恢复已删除统计明细。

#### D. 资源与客户端分析

路由建议：

- `/admin/statistics/session-reporting/resources`
- `/admin/statistics/session-reporting/clients`

资源页展示“窗口内开启”“窗口内使用”“调用次数”“失败率”“可用性”和趋势，支持资源类型、资源 ID、版本和分组筛选。团队连接器只使用网关 MCP 事实，本机工具使用轮次事实。

客户端页展示平台、系统版本、客户端版本、引擎版本、runtime 版本、语言和时区的会话数、轮次数、完成率、P95 耗时和最近活跃时间。当前设备属性与轮次固化版本分开标注，避免误解为历史回溯。

### 9.2 管理端 API 与页面映射

| 页面 | API | 主要响应 |
| --- | --- | --- |
| 会话总览 | `GET /api/admin/v1/statistics/session-reporting/overview` | KPI、趋势、结局分布、质量指标、更新时间 |
| 会话列表 | `GET /api/admin/v1/sessions` | `items`、`next_cursor`、筛选回显 |
| 会话详情 | `GET /api/admin/v1/sessions/{id}` | 会话摘要、轮次、资源、调用、子会话 |
| 资源分析 | `GET /api/admin/v1/statistics/resources` | 资源维度指标和趋势 |
| 客户端分析 | `GET /api/admin/v1/statistics/clients` | 客户端维度指标和趋势 |
| 清除确认 | `DELETE /api/admin/v1/sessions/{id}?confirm={id}` | 清除结果、墓碑时间、审计 ID |

统计查询共用参数：

- `from`、`until`：RFC3339 时间，使用 `[from, until)`。
- `group_id`、`user_id`、`model_id`、`expert_id`、`client_type`、`platform`。
- `resource_id`、`resource_version`：资源页和会话列表可选筛选。
- `outcome`：`complete`、`interrupted`、`error`、`max_turns`、`output_limit`、`unknown`。
- `include_placeholders`：默认 false；仅会话列表和质量面板可用。
- `include_purged`：默认 false；仅拥有清除审计权限时可用，且只返回墓碑摘要。
- `limit`：默认 50，最大 100。
- `cursor`：不使用 offset 深分页。

列表接口的 `items` 必须返回稳定的 `next_cursor`；统计接口返回 `generated_at`、`from`、`until` 和 `data_freshness_seconds`，让页面能区分“无数据”和“数据尚未同步”。除质量面板外，所有正式会话统计接口默认增加 `reporting_enabled_at IS NOT NULL` 条件。

总览的“异常率”定义为：`error + max_turns + output_limit` 轮次数 / 已知结局轮次数；`interrupted` 单独展示，不计入异常率；`unknown` 不进入分母；没有分母时返回 `null`，页面显示“暂无数据”。

### 9.3 权限和交互状态

- 读取会话统计沿用管理端统计权限；会话详情属于敏感统计，不能开放给普通 Agent 用户。
- 清除权限单独控制，不因拥有统计读取权限自动获得清除权限。
- 所有页面支持加载中、空数据、部分数据延迟、权限不足、超时和服务异常状态。
- 查询失败不清空当前已展示的数据，显示上次更新时间和重试入口。
- 页面不在浏览器 URL、埋点和前端错误日志中写入正文、工具参数或完整上报 payload。
- 后端返回 `private, no-store`；前端不做跨用户缓存。

## 10. 清除、隐私和运维

### 10.1 清除

管理员清除会话时：

1. 事务内删除轮次、工具、技能和资源快照明细。
2. 删除 `model_calls`、`mcp_tool_calls`、`image_calls` 中关联会话的统计调用记录；如果调用记录同时关联计费事务，只删除调用事实，不删除 billing transaction 和 credit ledger。
3. 对会话和子会话保留 `purged_at` 墓碑。
4. 记录审计日志。
5. 网关遇到墓碑 ID时不得重新创建占位；对已清除 ID 返回明确的已清除错误。
6. 计费流水和财务账不因统计清除而删除。

用户删除、服务端清除和财务保留是不同生命周期，不能共用一个删除动作。

### 10.2 隐私

- 只接受字段白名单，不接受正文或任意 JSON 扩展字段。
- `error_code` 只允许机器错误码，不上传原始错误消息。
- 本机 MCP 名称、技能名称、设备名限制长度，并评估敏感信息风险。
- 访问日志不记录上报 body、工具参数和完整快照。
- 统计接口仅管理员可访问，使用 `private, no-store`。

### 10.3 监控与对账

每天运行对账任务，检查：

- 有网关调用但没有正式会话的记录。
- 有轮次但没有对应网关调用的记录。
- 长时间未补齐的占位会话。
- 客户端与服务端时间偏差过大的会话。
- 游标冲突、宿主冲突、未知快照和版本拒收。
- 上报延迟、`recovered`、`unknown` 和各错误码数量。
- 每用户上报字节量和积压情况。

业务发生时间和服务端接收时间必须分开保存。客户端时钟偏差只设置 `clock_suspect`，不改写业务时间。

## 11. 限制和幂等

客户端常量与服务端限制：

| 项目 | 限制 |
| --- | --- |
| 单批轮次 | 最多 50 |
| gzip 压缩后 | 目标 1 MiB，最大 4 MiB |
| 会话 PUT | 客户端去抖 1 秒 |
| 并发会话 | 每账号最多 2 个，会话内串行 |
| 会话请求 | 每用户每分钟 60 次 |
| 轮次请求 | 每用户每分钟 30 批、4 MiB |
| 设备登记 | 每用户每小时 10 次 |
| 重试 | 5 秒起，指数退避至 5 分钟并加抖动 |

幂等键：

- 会话快照由 `(session_id, state_seq, state_hash)` 保护。
- 轮次由 `(session_id, turn_index, report_hash)` 保护。
- 资源快照由 `(session_id, snapshot_id)` 去重。
- 同一轮次相同 hash 重试返回已确认；不同 hash 返回冲突，禁止静默覆盖。
- 生图任务继续使用已有 job 幂等键，并由 `image_calls.job_id` 保证调用落库幂等。

## 12. 实施顺序

1. 新增增量 migration，扩展 `sessions`、`endpoints`、`image_jobs`、`image_calls`，创建五张轮次和资源表。
2. 增加 Agent OpenAPI 契约、设置段和设备登记字段。
3. 实现 `internal/session`：会话 PUT、轮次批次、占位、宿主认领、快照校验和派生列重算。
4. 接入 Agent 路由和依赖初始化。
5. 实现共用会话解析器，接入模型、MCP、生图和 billing。
6. 修正用户自建模型、MCP 时延和生图异步归属。
7. 改造统计 SQL，增加资源、客户端、会话列表和详情。
8. 增加管理后台的会话总览、会话列表、会话详情、资源分析和客户端分析页面。
9. 增加限速、墓碑清除、对账任务、监控指标和审计。
10. 进行空库迁移、升级迁移、接口、并发、统计和页面集成验证。

不建议第一期做按月分区。`(session_id, turn_index)` 的全局幂等和外键关系优先于提前分区；待真实容量和查询模式稳定后再单独设计分区。

## 13. 验收标准

### 数据和事务

- 空库执行 migration up、down、up 成功。
- 现有数据库升级后旧统计和计费链路仍可运行。
- settings 迁移后新服务端默认输出 `session_reporting.enabled=true, level=stats`，旧客户端忽略未知配置。
- 首次会话 PUT 认领宿主后，无论后续元数据 PUT 与轮次 POST 谁先到达，最终派生列一致；未登记的会话不能直接 POST 轮次。
- 并发首个网关调用只创建一个占位会话。
- 轮次重复上传不重复计数；相同序号不同 hash 被拒绝。
- 已清除会话不能被网关重新占位复活。

### 归属和安全

- 跨用户 session ID 返回 403。
- 非宿主写入返回 409 `not_host`。
- 父会话跨用户、自引用和成环关系被拒绝或忽略。
- 新头优先于旧头，内部头不会发送给上游。
- `stats` 模式拒绝正文、原始错误和第二期字段。

### 调用和统计

- 系统模型、用户自建模型、MCP、生图调用都能写入对应 session ID。
- 异步生图在 HTTP 请求结束后仍能正确归属。
- 一个顶层会话带多个子代理时，任务数为 1，费用为所有相关会话费用之和。
- 调整用户分组后，历史会话分组快照不变。
- 关闭资源后，历史轮次使用统计不被当前资源状态覆盖。
- 断网、重启和客户端崩溃恢复后，报告不丢失、不重复。
- 实时活跃任务不再依赖 `ended_at IS NULL`。
- 管理后台总览、列表、详情、资源和客户端页面均能处理加载、空数据、延迟、权限和错误状态。
- 会话详情不展示正文、思考、命令、工具参数、文件路径和附件。
- 统计读取权限与清除权限分离；清除操作要求完整 session ID 二次确认并产生审计 ID。

## 14. 暂不解决的问题

以下问题留到第二期或单独评审：

- transcript、文件、附件和对象存储引用。
- 进行中轮次、心跳和失联判定。
- 多层子代理的 `root_session_id` 物化。
- 内容脱敏、内容保留周期和读取审计。
- 网关调用精确关联到轮次的协议扩展。
- 大表分区和长期归档策略。
