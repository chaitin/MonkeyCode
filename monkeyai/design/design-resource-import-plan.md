# MonkeyAI 服务端设计资源导入与分发实施计划

> **状态：方案已入库，功能尚未实现。** 本文依据原实施计划与 v30 实际发布包离线验证结果修订；执行前先完成 M0 契约与夹具冻结，再按任务设置检查点。仅在用户明确要求时使用子代理。实施进度用复选框追踪，离线包校验通过不代表数据库、S3、HTTP 或 Desktop 联调通过。

**目标：** 导入 respub 设计快照 ZIP，离线提供兼容资源 API，并向 Desktop 下发双源配置与短期凭据。

**架构：** 新建 designcatalog 业务模块保存类型化快照和不可变文件，扩展现有 resourceimport 预览/导入入口。Agent 与设计分区分开计划和激活，不将设计 ID 混入 Agent slug 命名空间。兼容响应对齐 respub 契约。

**实施契约：** 文末「附录 A」固定 hub JWT、config/token、资源包 DTO、导入和对外服务契约。正文与附录应保持一致；发现冲突先修正文档，不允许执行者自行选择。实际包证据见 [v30 资源包验证基线](design-resource-package-baseline.md)。M0 产出小型冻结夹具、摘要向量及与 respub/Desktop 的契约互验结果。

**技术栈：** Go、chi、pgx、sqlc、PostgreSQL、现有 S3 存储、React 管理台。

---

## 0. 范围与实施前提

后端命令工作目录为项目内 `backend`；管理台命令工作目录为同项目的 `admin`。

本次入库仅交付实施方案及真实包验证基线，不导入线上包，不将约 275 MiB 的原始包提交到 Git。[现有 Agent 导入约定](resource-package-import-plan.md) 继续描述当前行为；本文描述后续设计分区扩展，未选择设计分区时保留旧 Agent 宽松业务解析。

原计划提到的 `docs/design-resource-contract-v1.md` 与 `testdata/design-contract/v1/` 在本次提供的材料和当前项目中未找到，不视为已经交付。执行 M0 时在本项目 `design/design-resource-contract-v1.md` 固化与上游互验后的契约，在 `backend/testdata/design-contract/v1/` 保存小型夹具、规范摘要向量与 `SHA256SUMS`；普通自动化测试只读本地副本，不依赖 Downloads、其他仓库或线上服务。

先读 `backend/AGENTS.md`。`api/{admin,agent}.yaml`、`internal/app`、`internal/httpapi`、迁移、sqlc 配置和依赖由集成任务统一修改，生成产物只能执行生成命令。手写 Go 文件采用连续小写名称。未经用户要求不推送、不部署、不导入线上包。

## M0. 冻结真实包契约与最小夹具

**交付：** `design/design-resource-contract-v1.md`、`backend/testdata/design-contract/v1/`；以 [v30 验证基线](design-resource-package-baseline.md) 记录的包 SHA 为真实包识别依据。本阶段是 M1–M5 的前置依赖，未完成项不得标记通过。

- [ ] 按 A.7 固定四类资源的 metadata 字段、缺省/空值规则、集合排序及 JCS 测试向量；使用 respub 生产端和 MonkeyAI 校验器交叉验证。保留包内 `catalog.metadata` 的 camelCase 业务字段，不套用发布层 snake_case DTO。
- [ ] 固定 `manifest_sha256` 的 DTO 投影、字段顺序、Go JSON 转义和排除字段，验证 v30 的声明摘要；不以原始 manifest 字节 SHA 或 JCS 代替。
- [ ] 固定 catalog 权威规则：嵌套摘要允许为空，非空时必须匹配；嵌套 files 可缺 role，由 catalog 提供；其余文件引用逐项核验。覆盖实际 371 个嵌套 ZIP 的行为。
- [ ] 与 respub/Desktop 同步 A.6.11 的 `source_skill_path` 详情字段：`has_skill=false` 时为 null；为 true 时按原逻辑路径或显式反向映射解析，禁止按 basename 猜测。保留参与摘要的原 `skillPath`。该新增字段需两端契约互验后才能进入 M5/Desktop 联调。
- [ ] 固定单一活跃发布者、分区独立提交、部分成功与重试协议，以及 A.10 中 sections 和计划修订的规则；记录到 OpenAPI 源文件变更清单，首次 preview 不要求输入尚未生成的 plan_digest。
- [ ] 构造四类资源、小型 bundle/prompt、外置提示词、设计系统正文、预览与 taxonomy 的合法夹具；冻结预期元数据、逻辑源文件、内容摘要及 manifest 摘要，不从待测导入代码生成期望值。
- [ ] 补充真实包未覆盖的反例：多源共享 archive_path、保留名避让及占用冲突、普通 `._source`、重复 ZIP 条目、文件/目录冲突、损坏摘要、不安全映射，以及同 release 变更 taxonomy/排序。损坏夹具在其他校验层保持有效，以验证对应业务拒绝路径。
- [ ] 明确校验清单仅证明内容完整性；首期接受管理员选择的包，不声称验证发布者签名。若新增 release 的发布者真实性也要求验证，必须先补充发布签名或可信分发契约。


## M1. 类型化设计契约及包校验

**文件：** 新增 `backend/internal/designcatalog/{model,package,package_test}.go`；修改 `backend/internal/resourceimport/{package,artifact}.go`、`package_test.go`；新增 `backend/testdata/design-contract/v1/`。

- [ ] 增加测试：合法新设计分区可解析；未知 schema 拒绝设计导入；旧 Agent 包仍可导入；publisher_id 缺失、条目重复及文件 SHA 错误明确失败。运行 `go test ./internal/designcatalog ./internal/resourceimport -run 'TestDesignPackage|TestParse' -v`，先看到新测试失败。
- [ ] 在 designcatalog 定义独立类型，与 respub DTO 保持 JSON 等价：

```go
type Key struct {
    PublisherID string
    Kind string
    ID string // catalog_id
}
type SnapshotRef struct {
    PublisherID string `json:"publisher_id"`
    ReleaseID string `json:"release_id"`
    SchemaVersion int `json:"schema_version"`
    DigestSchema string `json:"digest_schema"`
}
type File struct {
    Path string
    SHA256 string
    Size int64
    MIME string
    ObjectKey string
}
```

- [ ] 在现有包加载入口先保留原始 release/manifest 和分区是否存在，再执行所选分区的解析；不得在设计校验前进入会重写 release_id、manifest 摘要和 slug 的 Agent 规范化流程。Agent 使用独立内部批次身份；设计始终读取原始发布身份。修改 `load.go` 的无条件 `ParseResources` 调用，使设计-only 不解析 Agent 业务内容。
- [ ] 解析模板/系统嵌套 ZIP、提示词路径、风格媒体与 taxonomy。区分导出元数据与源文件；严格校验路径、保留文件冲突及摘要，不通过宽松 decodeJSON 吞掉设计字段类型错误。catalog 是业务摘要与 files.role 的权威来源；嵌套摘要空字符串允许，非空不符拒绝；嵌套 files 缺 role 时用 catalog 值校验，显式 role 冲突拒绝，不能要求两个 DTO 整体相等。
- [ ] 实现发布路径反向恢复：解析 `source_file_paths` 与 `source_file_refs`（`source_path`/`archive_path`），两者同时存在时必须一致；校验两端均为安全相对路径（拒绝绝对路径、反斜杠、空段、`.`/`..`），源路径唯一、目标存在，拒绝重复 ZIP 条目、文件/目录前缀冲突及恢复后覆盖。允许多个逻辑源路径共享同一 archive_path：bundle 的确定一级包装前缀展平后，带前缀附件和已展平附件同字节只保存一份；须按 catalog files.path 逐个恢复原路径并验证 SHA/size，不能要求归档目标唯一或将显式映射目标从普通源文件集合直接删除。sourceFileMetadata 对无 mapping 的普通文件按原路径兼容，不猜测 strip 前缀；额外媒体不随意改名。可能的保留名避让目标为 `template.json._source`、`design-system.json._source`、`DESIGN.md._source`（v30 未覆盖此类冲突，M0 另造夹具），避让在路径归一后应用；普通 `._source` 文件不得按后缀排除。源文件占用避让目标时即使同字节也拒绝，不能静默覆盖。历史 `.source/<原路径>` 仅依据旧包显式映射读取，不猜测或批量改写旧引用。
- [ ] 校验先于恢复与激活：先按 release/manifest 引用及 `CHECKSUMS.sha256` 验证外包条目和嵌套 ZIP 原始 archive bytes，再核验恢复后的源文件 SHA/size 与 catalog 规范引用。按原逻辑源路径计算 `design-content-v1`，保持 publisher_id、catalog_id、content_digest；生成 template.json/design-system.json、外置提示词等属于导出层元数据，不可作为源文件存储或混入 native ZIP，映射指向的上游同名源文件必须保留。
- [ ] 增加导入回归：上游自带 template.json 能恢复原路径和字节；包装 bundle + 带包装前缀 files 仅一套字体/assets，精确映射恢复完整原源路径；同时存在已展平/带前缀附件时，多源同 archive_path 可恢复，任一源 SHA/size 不符拒绝；不同合法路径即使同字节仍保留；无 mapping 普通文件和无 bundle prompt 路径保持兼容；额外媒体仅补缺。`._source` 目标被源占用拒绝；普通 `._source` 文件通过；不安全、重复源、悬空、两表不一致及恢复覆盖映射拒绝；archive SHA 损坏拒绝；发布包与原生 API 两渠道源字节、规范业务摘要一致。模板包装目录已在发布层展平，不可声称恢复原 ZIP 容器字节或无记录的包装前缀。旧冻结包按原 SHA 读取；布局修复需要新 release，不重新导出并覆盖旧摘要。
- [ ] publisher_id 读取 `release.json.publisher.id`，并核对 `manifest.json.publisher_id`；保存资源 catalog_id 与 provenance，不能用内部 slug 或名称替代这些字段。
- [ ] 旧 design_resources 仅 RawMessage 的逻辑改为有设计导入结果；旧未版本化分区返回 unsupported_design_section 提示，不标记成功。
- [ ] 按 A.6.11 解析并保存独立 `source_skill_path`，不改 metadata.skillPath 或摘要；实际包 110 个 bundle 的路径可由显式映射唯一恢复，109 个 prompt 的 has_skill=false，忽略其遗留 `SKILL.md` 默认值。补充有技能但缺文件/映射歧义拒绝、无技能默认值不误报的测试。
- [ ] 测量夹具及真实测试包的条目数/大小，在外包现有 2 GiB/解压 4 GiB 限制内做流式读取；分别限制嵌套 ZIP，防止层层放大和全包读内存。外包条目上限保留 5000，嵌套单包先使用 5000 条/512 MiB 展开上限，整次导入按所有层实际读取字节累计不超过 4 GiB；v30 嵌套总计 5358 条，不能把 5000 当作所有层条目总和。补充元数据、单文件、临时磁盘与并发导入预算，按实际读取量计数，不只相信 ZIP 声明。运行针对性测试，预期全部 PASS。

## M2. 设计快照数据库与不可变文件存储

**文件：** 新增 `backend/migrations/<递增序号>_design_catalog_snapshots.{up,down}.sql`（用 migrate 生成）；新增 `backend/internal/designcatalog/{postgres,storage}.go`、`query.sql`、`postgres_test.go`、`storage_test.go`；由集成任务修改 `backend/internal/resource/storage.go` 和 `backend/sqlc.yaml`，生成 `backend/schema/schema.sql` 和 `internal/designcatalog/sqlc/`。

- [ ] 写快照持久化测试：同 catalog ID 的 R1/R2 可以共存；同 release 不同内容冲突；current 切换不修改 R1；失败不切 current。运行 `go test ./internal/designcatalog -run 'TestSnapshot|TestStorage' -v`，确认失败。
- [ ] 用迁移工具生成文件：`migrate create -ext sql -dir migrations -seq design_catalog_snapshots`。在 up 中建立设计快照、条目、文件、taxonomy 与设计当前指针表；down 仅用于专用测试库回滚。

```sql
-- 按此身份建立约束，列类型与项目 UUID 约定保持一致。
CREATE UNIQUE INDEX design_snapshot_source_key
ON design_snapshots(publisher_id, source_release_id);
CREATE UNIQUE INDEX design_entry_key
ON design_entries(snapshot_id, resource_type, catalog_id);
CREATE UNIQUE INDEX design_file_key
ON design_files(entry_id, path);
```

- [ ] 写 `query.sql`，在 sqlc.yaml 注册本业务目录；执行 `make generate`，不得手工改生成文件。复用 S3 实现，通过消费者接口注入流式写入、对象头信息及区间读取能力；现有 `Storage.Get` 仅顺序读取、`Put` 接受完整字节数组，不能直接满足本期能力。可复用已有 S3.PutReader，新增接口及调用方适配由集成任务完成。
- [ ] 文件写入字节 SHA 内容地址；元数据存 MIME/尺寸/路径。导入时在受限临时文件中按逻辑路径排序生成确定性 native ZIP，固定时间、权限、压缩方式及打包器版本，保存 ZIP 实际 SHA/size/object_key。current 只指向源文件、元数据及可下载 ZIP 均已持久化的 ready 快照；不在下载请求中重建 ZIP。
- [ ] 使用部署级单行 `design_current` 保存 publisher_id、snapshot_id 和单调递增 revision；该行由迁移预建（无快照时 publisher_id/snapshot_id 为 null、revision=0），外键关联快照，事务保证仅激活完整 ready 快照。提供 `Find(ctx, publisherID, releaseID, kind, id)` 与带 expectedRevision 的激活能力；快照查询不依赖 current 发布者。未配置预期 publisher 时首次激活绑定发布者，后续其他 publisher 返回 409；配置预期 publisher 时导入/激活均须一致。首期不实现跨发布者切换。
- [ ] 将已校验且反向恢复的逻辑源路径关联至不可变内容对象，分别保存导出元数据与源文件清单；不使用 archive 避让路径替代 catalog files.path，不从 respub 在线补文件。旧快照继续引用原不可变对象，新导入不能覆盖其路径或摘要。
- [ ] 内容地址对象采用条件创建或等价的并发安全写入，已有对象必须核对 SHA/size；不得覆盖同 key 的不同字节。失败只清理本次临时文件，不沿用 Agent prepareObjects 的立即删除对象补偿：并发任务或历史快照可能已经引用相同 key。首期保留未引用对象，回收作为独立任务实施，必须具备宽限期及引用复核；补充共享对象下失败不删、并发写入不损坏的测试。
- [ ] 执行 `make sqlc-check` 与针对性测试；预期无生成差异、R1/R2 对象互不覆盖、预生成 ZIP 可进行随机区间读取。

## M3. 导入预览、分区隔离和原子激活

**文件：** 新增 `backend/internal/resourceimport/{design,design_test}.go`；修改 `resourceimport/{service,preview,artifact,package,load,upload}.go`、`query.sql` 及导入/上传状态迁移；新增 `backend/internal/designcatalog/{import,import_test}.go`；集成时修改 `backend/internal/app/app.go`。

- [ ] 写设计包导入不误退役 Agent 的回归：已有 skill A，导入只含设计分区的包，A 不变；新设计损坏不切 current。运行 `go test ./internal/resourceimport ./internal/designcatalog -run 'TestDesignImport|TestDesignOnly' -v`，先确认失败。
- [ ] 新增显式导入分区选项，不把缺省 agent_resources 的空数组当作“退役全部 Agent”：

```go
type ImportSections struct {
    Sections []string `json:"sections"` // agent、design
}
// 旧包 sections 缺省时仍按 Agent-only 处理；新版本设计包要求显式 sections。
// 初次 discovery 只返回可用分区，不生成可执行计划；选择分区后重新 preview。
// 设计单独导入仅计划设计变化，Agent-only 不清空当前设计快照。
```

- [ ] 在现有 Evaluate/Apply 中注入设计消费者接口，签名在调用方定义；设计 preview 返回 publisher_id/release_id/schema、各类型计数及新增/变化/消失项。按 A.10 将 sections、整包 SHA、设计快照指纹和 current revision 纳入计划，各分区返回独立 plan_digest；修改 sections 必须重新预览。
- [ ] 所选分区分别预写对象、分别提交事务，采用固定 agent → design 顺序执行，返回 A.10 的逐分区结果。一个分区失败不回滚另一个成功分区；允许部分成功，已成功分区重试不得重复应用。失败原因在业务回滚后的独立事务中持久化；若数据库故障无法记录，显式保留结果未知状态并按成功回执恢复，不能将未持久化记录算作成功。
- [ ] 同 publisher/release 的设计快照指纹相同则复用快照，不同返回409。指纹覆盖所有资源内容摘要、artifact 引用、provenance、catalog_rank 及完整 taxonomy，按 A.7 编码规则计算；设计不重写源 release_id，也不套用 Agent 版本递增逻辑。快照已存储不代表当前上传/分区已成功；首次将已存在历史快照激活仍须通过本次 preview，已成功请求重放不得偷偷重新激活旧快照。
- [ ] 删除整包 AlreadyImported 提前返回对新分区的影响，以 upload/分区结果及设计快照身份分别判定幂等；同一上传在有效期内可先导入 Agent 再导入设计，第一分区成功不将整包标成不可再处理。旧 Agent-only 的行为保持兼容。
- [ ] 设计事务内 `SELECT ... FOR UPDATE` 锁住单行 current，重新读取 revision 并复核本分区计划，再写快照/条目/文件/taxonomy、切指针并递增 revision。先验证后加锁不算并发保护；并发首次激活、A→B→A 及预览后其他导入成功均须使旧计划409。Agent 继续使用既有 publisher 锁，两种分区不同时持有对方锁。故障时旧快照可读，针对性测试全部 PASS。

## M4. JWT 签发、设备归属与资源源配置

**文件：** 新增 `backend/internal/designcatalog/{tokens,tokens_test,configuration}.go`；修改 `backend/internal/config/{config,config_test}.go`、`backend/internal/endpoint/{service,postgres}.go`、`query.sql`；新增 `backend/internal/app/design.go` 和 `design_test.go`；修改项目 `.env.example`、`docker-compose.yml`，依赖只由集成任务加到 backend/go.mod/go.sum。

> **2026-10-21 新决策：** 控制面固定为 `GET /api/v1/design-resources/config` 与 `POST /api/v1/design-resources/token`。旧计划的 `/api/v1/design/resources` 和 `/api/v1/design/resources/token` 不再使用。控制面前缀属于 MonkeyAI，不属于 respub；respub hub 公开前缀仍为 `/api/design`。

- [ ] 写测试：当前用户设备可签发；其他用户、已移除设备、缺实例身份不可签发；respub 未配置仍返回本地源；密钥不进入 JSON。运行 `go test ./internal/designcatalog ./internal/app ./internal/endpoint -run 'TestDesignToken|TestDesignConfig|TestOwnedDevice' -v`，先确认失败。
- [ ] 配置项固定为：

```text
MONKEYAI_INSTANCE_ID                  部署级稳定实例ID，重启不变
MONKEYAI_DESIGN_RESPUB_URL            可空；完整base，示例 https://hub.monkeycode-ai.com/api/design
                                      未配置表示只用本地渠道；不在运行时自动补 /api/design
MONKEYAI_DESIGN_PUBLISHER_ID           预期发布者身份
MONKEYAI_DESIGN_RESPUB_JWT_SECRET      与respub验证密钥一致
MONKEYAI_DESIGN_MEDIA_JWT_SECRET       本地媒体专用，与respub密钥分离
```

`MONKEYAI_DESIGN_RESPUB_URL` 名称保留，语义改为完整 base，避免与现有配置计划冲突。值必须是绝对 URL，带完整 path，无 userinfo、query、fragment；尾斜杠可归一化但不改变已有路径段。配置存在但非法时启动报错，不把非法值降级成“未配置”。`MONKEYAI_DESIGN_PUBLISHER_ID` 未配置时输出 null。

- [ ] 增加 endpoint 归属查询适配器，校验 `(当前用户ID,machine_id)` 为有效登记设备；不把客户端传入 ID 当已认证事实。JWT client_id 取验证后的 MachineID，不能用 OAuth 的公共 client_id=monkeyai-desktop。
- [ ] 固定控制面响应（由现有 OAuth Bearer 保护）：

```json
{
  "schema_version": 1,
  "publisher_id": "发布者稳定ID",
  "respub": {"base_url": "https://hub.monkeycode-ai.com/api/design"},
  "monkeyai": {"base_url": "https://当前服务端/api/v1/design-resources", "available": true,
    "snapshot": {"publisher_id":"发布者稳定ID","release_id":"源ReleaseID",
      "schema_version":1,"digest_schema":"design-content-v1"}}
}
```

- [ ] 明确 `config` 语义：`respub` 未配置时为 `null`，不是 `{"base_url":""}`；配置时 `base_url` 是可直接拼接 `/catalog/...` 或 `/design-systems/...` 的完整 base。`monkeyai` 始终为对象，`base_url` 固定以 `/api/v1/design-resources` 结尾；未导入本地快照时 `available=false`、`snapshot=null`，但 `base_url` 仍可供认证和错误诊断使用。publisher_id 未配置为 null，不使用 omitempty；响应不含任何 secret。
- [ ] 实现 `GET /api/v1/design-resources/config` 和 `POST /api/v1/design-resources/token`。Token 请求为 `{machine_id,target}`，target=`respub` 或 `monkeyai-media`，响应 `{token,expires_at}`；不使用旧的 `/api/v1/design/resources/token`。Token 端点与 catalog 同前缀但是控制面兄弟路径，不属于 catalog 契约，也不从 respub base 派生。
- [ ] respub Token 固定 HS256/iss=monkeyai/aud=respub-design；本地媒体固定 aud=monkeyai-design-media、sub=用户ID，签名不同。两者均含 instance_id/client_id/iat/exp，10分钟有效。JWT claims 与既有 respub 验证实现保持一致，不因控制面改名而改 claim。缺签发配置 503，不使其他功能启动失败。给 Desktop 签发 hub token 复用此控制面；`monkeyai-media` 是独立本地 token，不与 hub token 混用。
- [ ] 运行针对性测试；与 respub JWT 验证测试互验，且无真实凭据进入夹具。

## M5. 兼容 API 查询和路由集成

**文件：** 新增 `backend/internal/designcatalog/{api,query,files,contract_test,api_test}.go`，SQL 仍在 query.sql；集成修改 `backend/internal/httpapi/router.go`、`backend/internal/app/{app,design}.go`、`backend/api/agent.yaml`、`backend/api/admin.yaml`，以及 `backend/internal/resource/storage.go` 的存储适配。

> **2026-10-21 新决策：** MonkeyAI 面向 Desktop 的全部资源 API 使用完整 base `https://当前服务端/api/v1/design-resources`，资源后缀与 respub hub base `/api/design` 相同。Desktop 新路由不挂 `/openapi/`，本期不提供 `/openapi` 兼容别名：当前 Desktop 尚未实现，不存在需要兼容的旧消费者。respub hub 仍使用 `/api/design/...`，两端只是 base 不同。控制面 `config`/`token` 与资源 base 同前缀，但不是 catalog 路径。路径选择：snapshot、list、detail、模板下载、media、taxonomy 全部位于 `/api/v1/design-resources/catalog/...`；系统下载保持 hub 的兄弟路径 `/api/v1/design-resources/design-systems/{id}/download`，不塞进 `/catalog`，以便两端只替换 base。

- [ ] 用本地已导入夹具写 API 对照测试，覆盖模板、系统、风格、方向、taxonomy、snapshot、资源 ZIP；运行 `go test ./internal/designcatalog ./internal/app -run 'TestCatalogContract|TestDesignRoute' -v`，先确认新路由失败。
- [ ] 固定路径映射；Desktop 只根据配置的完整 base 拼接相对后缀，不从 domain 猜 `/api/design`：

| 用途 | respub hub 路径 | MonkeyAI 本地路径（Desktop 新契约） |
| --- | --- | --- |
| snapshot | `GET /api/design/catalog/snapshot` | `GET /api/v1/design-resources/catalog/snapshot` |
| 列表 list | `GET /api/design/catalog/{templates,design-systems,styles,directions}` | `GET /api/v1/design-resources/catalog/{templates,design-systems,styles,directions}` |
| 详情 detail | `GET /api/design/catalog/{templates,design-systems,styles,directions}/{id}` | `GET /api/v1/design-resources/catalog/{templates,design-systems,styles,directions}/{id}` |
| 模板下载 download | `GET /api/design/catalog/templates/{id}/download` | `GET /api/v1/design-resources/catalog/templates/{id}/download` |
| 系统下载 download | `GET /api/design/design-systems/{id}/download` | `GET /api/v1/design-resources/design-systems/{id}/download` |
| 媒体 media | `GET/HEAD /api/design/catalog/{previews,style-assets}/{id}/*path` | `GET/HEAD /api/v1/design-resources/catalog/{previews,style-assets}/{id}/*path` |
| taxonomy | `GET /api/design/catalog/taxonomy` | `GET /api/v1/design-resources/catalog/taxonomy` |
| 控制面 token | 无（由 MonkeyAI 签发 hub token） | `POST /api/v1/design-resources/token` |
| 控制面 config | 无 | `GET /api/v1/design-resources/config` |

- [ ] 新模块暴露显式 RegisterCatalog 注册函数，挂载上述 `/api/v1/design-resources/...` 路径到顶层 router；现有 httpapi.New 仅挂 admin/agent/auth，因此由集成任务接入新 handler，并更新其调用点测试。不要把所有路径机械改成同一前缀而漏掉 `/design-systems/{id}/download`。
- [ ] JSON/ZIP 使用现有 RequireAgent；媒体仅在专用 GET/HEAD 路由验证本地媒体 token，校验 audience、instance、sub 和有效期，不接受 respub JWT 替代 OAuth。
- [ ] RequireAgent 的既有错误是控制面 error 信封；仅在 catalog/下载资源认证边界转换为兼容 `{code,message,data:null}`，并将 invalid_token、permission_denied、service_unavailable 映射为 unauthorized、forbidden、unavailable，状态码不变。config/token 保留现有控制面错误信封，成功返回裸对象。媒体路由不经过强制 Agent Bearer 中间件，只接受专用本地媒体 JWT；无 current 返回404 snapshot_not_found，存储故障返回503。
- [ ] 对齐 respub 契约的 code/message/data、query 参数、分页、id、asset_snapshot_id 与内容摘要；snapshot 指向已导入源 Release，未知 404，不回落 current。生成当前服务端 URL，文件直出并支持 Range/ETag。
- [ ] 离线 native ZIP 在导入阶段从本地不可变源文件按恢复后的原逻辑路径确定性生成并持久化；下载只流式读取该冻结对象，使用实际 ZIP 字节 SHA 作为强 ETag，以对象长度处理 HEAD/Range/If-Range。包含上游 template.json/design-system.json/DESIGN.md 原字节，不加入发布元数据、提示词导出引用或避让副本。ZIP 容器 SHA 可因重建不同，业务 content_digest 与源文件 SHA 必须和 respub 一致；模板原包装目录/原 ZIP 容器字节未记录时不能恢复。测试关闭 respub 网络后仍能读取历史 snapshot、源文件与 native ZIP，两个渠道逐文件比较路径/字节并核对业务摘要；跨请求/进程验证 ETag 稳定。
- [ ] 补充 OpenAPI 源文件的新增控制面路径和 `/api/v1/design-resources/...` 资源路径，保留两种响应信封各自适用范围；不新增 `/openapi` Desktop 路由。运行 API 金样测试，输出除 base/域名外与 respub 一致。

## M6. 管理台导入设计分区展示

**文件：** 修改 `admin/src/pages/resource-imports-page.tsx`、`admin/src/components/resource-import-dialog.tsx`；新增 `admin/src/lib/design-import.ts`、`admin/test/design-import.test.mjs`；更新已有 i18n 文件时沿用项目语言结构，不插入中文硬编码到多语 key。

- [ ] 写纯函数测试：设计包统计展示四类数量；Agent-only 不显示设计已清空；设计未支持或失败不能展示成功。运行 admin 的 `npm test`，先确认新测试失败。
- [ ] 从页面提取设计预览解析和分区选择函数，保留 Agent 现有 UI，新增 Agent/设计分区选择及设计激活说明。

```ts
export type DesignImportSummary = {
  publisher_id: string
  release_id: string
  schema_version: number
  counts: Record<'template' | 'design-system' | 'style' | 'direction', number>
  status: 'ready' | 'unsupported' | 'failed'
}
```

- [ ] 对话框先发现可用分区，再带 sections 请求正式 preview；确认请求带 sections、package_sha256、总计划与逐分区 plan_digest，严格按 A.10 处理。移除“本包总是最终 Agent 集合”的单一文案假设，按选择分区解释替换语义；选择变化使旧预览失效。
- [ ] 表单展示逐分区导入结果、部分成功及激活的源 Release ID，不把内部批次版本号当目录快照身份。一个分区成功不自动关闭对话框；失败/未选择分区可在上传有效期内重新预览处理，已成功项不得随重试重复应用。历史同时展示分区状态和失败原因。
- [ ] 在 admin 执行 `npm test`、`npm run typecheck`、`npm run build`，预期通过。

## M7. 配置、编译期注入、文档和后端完整检查

**文件：** 新增 `design/design-resource-import.md`，修改项目 `README.md`、`.env.example`、`docker-compose.yml` 和 backend API 文档。

- [ ] 写管理员操作说明：复制部署稳定 instance_id；配置预期 publisher_id；分别配置 respub 签发密钥与本地媒体密钥；离线部署可不配置 respub URL；配置 respub 时填写完整 base（示例 `https://hub.monkeycode-ai.com/api/design`），不要填裸域名后期待运行时补路径。
- [ ] 在 README 和 `design/design-resource-import.md` 写清配置优先级：运行环境变量 > 编译期 `-X` 默认值 > 未配置。必须使用 LookupEnv 一类的存在性判断，显式空值也覆盖默认值，测试空值关闭编译期 respub 配置。`MONKEYAI_DESIGN_RESPUB_URL`、`MONKEYAI_DESIGN_PUBLISHER_ID`、`MONKEYAI_DESIGN_RESPUB_JWT_SECRET`、`MONKEYAI_DESIGN_MEDIA_JWT_SECRET`，以及部署级 `MONKEYAI_INSTANCE_ID`，都允许在构建时通过 `-X` 设置默认字符串；运行环境变量始终覆盖编译期默认值。具体变量符号路径由实现任务按 module path 决定，本节不声称已实现。
- [ ] Go `-X` 只能设置 string 包变量。实现时在 `internal/config`（或该包内明确命名的配置默认值文件）定义空字符串默认变量，并由 config 统一读取；不得在业务包散落 `os.Getenv`，不得把 secret 写进源码、镜像构建参数、日志、错误响应或 API JSON。编译期注入只是构建产物内的默认值，用 `strings`/二进制分析仍可能提取，不等同于安全保管，也不表示可把凭据放进公开客户端。
- [ ] 示例构建命令仅说明形式，占位符由实现任务替换；不得在文档写入真实 secret：

```bash
go build -trimpath -o monkeyai-server \
  -ldflags "-X '<module>/internal/config.defaultDesignRespubURL=https://hub.monkeycode-ai.com/api/design' \
            -X '<module>/internal/config.defaultDesignPublisherID=<publisher-id>' \
            -X '<module>/internal/config.defaultDesignRespubJWTSecret=<secret-from-secure-input>'" \
  ./cmd/server
```

- [ ] 在专用测试库验证迁移、make generate 与 make sqlc-check；不对开发者已有数据执行 down 迁移。
- [ ] 后端运行 `go test ./...`、`go vet ./...`、`make sqlc-check`；记录通过或环境依赖阻塞，不将跳过测试算通过。
- [ ] 用服务端本地测试注册设备调用 `POST /api/v1/design-resources/token`；外来 machine_id 应拒绝，合法 Token 经 respub 验证成功。另验证未配置 respub 时 `config.respub=null`、本地 `monkeyai-media` 仍可签发，以及 `/api/v1/design-resources/catalog/...` 资源可读。

## M8. 与 respub / Desktop 联合验收

**前置：** respub R8 的小型发布 ZIP、Desktop D1–D7。

- [ ] 导入 ZIP 后逐 API 对照 respub 金样，四类资源、taxonomy、正文、系统三文件和图片摘要一致；验证 `config` 下发完整 respub base 与本地 base，Desktop 不再按 domain 拼 `/api/design`，token 通过 `/api/v1/design-resources/token` 获取。
- [ ] respub 更新 draft 或发布下一版本，不重新导入的 MonkeyAI 仍保持旧快照；重新导入 R2 后 R1 snapshot 仍可读取。
- [ ] 关闭 design-prompt/respub 网络，Desktop 使用当前 MonkeyAI 获取目录、ZIP、预览；本地媒体 Token 过期可刷新。
- [ ] 再次导入同包幂等；损坏嵌套文件、预期发布者不匹配、同 publisher/release 的不同快照指纹、过期 preview plan 均拒绝且不改变当前快照。校验清单不是发布签名，不把“伪造全新 release 的发布者真实性”列为首期已支持能力。
- [ ] 验证混合导入一成一败、只重试失败分区、同上传后补另一分区、已成功请求重放、并发 current 切换及内容地址共享对象失败不误删。

**完成定义：** ZIP 设计分区真正落库且可离线提供兼容 API；身份、快照和摘要不被导入端重写；Agent 导入退役规则不误作用于设计-only 包。

---

## 附录 A：设计资源契约与实施细节（可直接实现）

> 本附录固定 M0–M8 的字段、结构体与 HTTP 行为。执行前仍须遵守 `backend/AGENTS.md` 和项目生成流程；M0 将生产端互验后的协议与夹具冻结，不能把本文新增协议描述成上游已经实现。

### A.1 角色、base 与认证

| 角色 | base | 说明 |
| --- | --- | --- |
| respub hub | `https://<hub>/api/design` | 上游同步后的当前设计目录；JSON/ZIP 使用 hub JWT |
| MonkeyAI 本地资源 | `https://<server>/api/v1/design-resources` | 导入快照的离线目录；后缀与 hub 相同 |
| MonkeyAI 控制面 | `https://<server>/api/v1/design-resources` | `config`、`token` 是 catalog 的兄弟路径，不属于资源契约 |

- `MONKEYAI_DESIGN_RESPUB_URL` 保存**完整 base**（示例 `https://hub.monkeycode-ai.com/api/design`），不得由客户端或服务端按域名补 `/api/design`。Desktop 只用“完整 base + 相对后缀”拼 URL。
- JSON、snapshot、ZIP：`Authorization: Bearer <token>`。
- 媒体 GET/HEAD：允许 `?token=`；同时存在 Authorization 时以它为准，失败不降级到 query token。
- 管理控制面（`config`/`token`）走 MonkeyAI 现有登录/Agent 认证，不复用 hub JWT。

### A.2 Hub JWT 签发（M4）

签名密钥来自 `MONKEYAI_DESIGN_RESPUB_JWT_SECRET`，必须与 respub 的 `DESIGN_OPENAPI_JWT_SECRET` 相同；只存在于服务端，绝不下发 Desktop 或写入资源包。

固定 claims（HS256）：

```json
{
  "iss": "monkeyai",
  "aud": "respub-design",
  "instance_id": "<MONKEYAI_INSTANCE_ID>",
  "client_id": "<已登记设备的 MachineID>",
  "iat": 1792108800,
  "exp": 1792109400
}
```

- `instance_id` 取部署级稳定实例 ID；`client_id` 必须来自 `(当前用户, machine_id)` 的已登记设备校验，不能使用客户端传入的任意值，也不能使用 OAuth 公共 `client_id=monkeyai-desktop`。
- `exp` 必须存在，默认 10 分钟；respub 验证允许 30 秒时钟偏差。算法只接受 HS256。
- 其他用户设备、已移除设备：403，拒绝签发。缺部署稳定实例ID或对应密钥：503，不影响其他功能启动。
- 签发结果只在 token 响应中返回；不得写入日志、错误、快照、ZIP、任务文件或缓存到磁盘。
- 本地媒体 token 使用独立密钥 `MONKEYAI_DESIGN_MEDIA_JWT_SECRET` 和 `aud=monkeyai-design-media`，另带 `sub=<用户ID>`；不得接受 hub JWT 替代。

### A.3 控制面协议（M4）

`GET /api/v1/design-resources/config`：

```go
type DesignResourcesConfig struct {
    SchemaVersion int               `json:"schema_version"` // 1
    PublisherID   *string           `json:"publisher_id"` // 未配置为 null
    Respub        *RespubAccess     `json:"respub"`         // 未配置为 null
    MonkeyAI      LocalDesignAccess `json:"monkeyai"`
}
type RespubAccess struct {
    BaseURL string `json:"base_url"` // 完整 base，例如 https://hub.example/api/design
}
type LocalDesignAccess struct {
    BaseURL   string        `json:"base_url"` // https://server/api/v1/design-resources
    Available bool          `json:"available"`
    Snapshot  *SnapshotRef  `json:"snapshot"` // 未导入为 null
}
type SnapshotRef struct {
    PublisherID   string `json:"publisher_id"`
    ReleaseID     string `json:"release_id"`
    SchemaVersion int    `json:"schema_version"`
    DigestSchema  string `json:"digest_schema"`
}
```

`POST /api/v1/design-resources/token`：

```json
{"machine_id":"已登记设备ID","target":"respub"}
```

`target ∈ {respub, monkeyai-media}`。响应：

```json
{"token":"<jwt>","expires_at":"2026-10-21T08:00:00Z"}
```

- `respub` 返回 A.2 的 hub JWT；`monkeyai-media` 返回本地媒体 JWT。
- 响应缓存必须 `no-store`；不得回显 secret 或 claims 之外的凭据。
- Desktop 流程：读 config → 需要时取 token → 读 `/catalog/snapshot` → 后续请求固定使用返回的 snapshot → 401 刷新一次后重试；403 不绕过。

### A.4 资源包结构与 DTO（M1/M2）

#### A.4.1 整包布局

```text
release.json
manifest.json
CHECKSUMS.sha256
design/catalog.json
design/taxonomy.json
design/templates/<slug>.zip
design/design-systems/<slug>.zip
design/styles/<slug>.json
design/style-assets/<slug>/<relative path>
design/directions/<slug>.json
agent/...            # 与设计分区独立
```

#### A.4.2 `release.json`

```go
type ReleaseInfo struct {
    Publisher      Publisher `json:"publisher"`
    ReleaseID      string    `json:"release_id"`
    Version        int64     `json:"version"`
    PublishedAt    string    `json:"published_at,omitempty"`
    ExportedAt     string    `json:"exported_at"`
    ManifestSHA256 string    `json:"manifest_sha256"`
    Counts         map[string]int `json:"counts"`
}
type Publisher struct {
    ID      string `json:"id,omitempty"`
    Name    string `json:"name"`
    Version string `json:"version"`
    URL     string `json:"url"`
}
```

`publisher.id` 是下游发布者身份，必须非空且与 `manifest.publisher_id`、`catalog.publisher_id` 完全一致；名称可改，不得用于识别发布者。

#### A.4.3 `manifest.json`

```go
type Manifest struct {
    PublisherID     string          `json:"publisher_id,omitempty"`
    ReleaseID       string          `json:"release_id"`
    Version         int64           `json:"version"`
    ManifestSHA256  string          `json:"manifest_sha256"`
    GeneratedAt     string          `json:"generated_at"`
    AgentResources  AgentResources  `json:"agent_resources"`
    DesignResources DesignResources `json:"design_resources"`
    StaticAssets    []ManifestAsset `json:"static_assets"`
}

type DesignResources struct {
    SchemaVersion int               `json:"schema_version"` // 必须为 1
    DigestSchema  string            `json:"digest_schema"`  // design-content-v1
    Taxonomy      *ArtifactRef      `json:"taxonomy,omitempty"`
    Templates     []ManifestTemplate     `json:"templates"`
    DesignSystems []ManifestDesignSystem `json:"design_systems"`
    Styles        []ManifestStyle        `json:"styles"`
    Directions    []ManifestDirection    `json:"directions"`
}

type ArtifactRef struct {
    Path   string `json:"path"`
    SHA256 string `json:"sha256"`
}

type DesignIdentity struct {
    CatalogID  string      `json:"catalog_id,omitempty"`
    Provenance *Provenance `json:"provenance,omitempty"`
}

type Provenance struct {
    SourceID                string `json:"source_id"`
    UpstreamID              string `json:"upstream_id"`
    UpstreamDigest          string `json:"upstream_digest,omitempty"`
    UpstreamAssetSnapshotID string `json:"upstream_asset_snapshot_id,omitempty"`
    UpstreamURL             string `json:"upstream_url,omitempty"`
}

type ManifestTemplate struct {
    DesignIdentity
    Slug          string          `json:"slug"`
    Name          string          `json:"name"`
    LocalizedName json.RawMessage `json:"localized_name"`
    Description   string          `json:"description"`
    Mode          string          `json:"mode"`
    Category      string          `json:"category"`
    Platform      string          `json:"platform"`
    Scenario      string          `json:"scenario"`
    Tags          []string        `json:"tags"`          // 业务上是 triggers
    TemplateKind  string          `json:"template_kind"` // bundle | prompt
    Downloadable  bool            `json:"downloadable"`
    HasSkill      bool            `json:"has_skill"`
    SkillPath     string          `json:"skill_path"`
    ContentDigest string          `json:"content_digest"`
    Preview       json.RawMessage `json:"preview"`
    CardPreview   json.RawMessage `json:"card_preview"`
    Path          string          `json:"path"`   // design/templates/<slug>.zip
    SHA256        string          `json:"sha256"`
}

type ManifestDesignSystem struct {
    DesignIdentity
    Slug          string `json:"slug"`
    Name          string `json:"name"`
    Description   string `json:"description"`
    Category      string `json:"category"`
    ContentDigest string `json:"content_digest"`
    Path          string `json:"path"` // design/design-systems/<slug>.zip
    SHA256        string `json:"sha256"`
}

type ManifestStyle struct {
    DesignIdentity
    ContentDigest        string          `json:"content_digest"`
    Path                 string          `json:"path"` // design/styles/<slug>.json
    SHA256               string          `json:"sha256"`
    Slug                 string          `json:"slug"`
    Name                 string          `json:"name"`
    Context              string          `json:"context"`
    Title                string          `json:"title"`
    Description          string          `json:"description"`
    Variant              string          `json:"variant"`
    Category             string          `json:"category"`
    Preview              json.RawMessage `json:"preview"`
    Recommended          bool            `json:"recommended"`
    LocalizedTitle       json.RawMessage `json:"localized_title"`
    LocalizedDescription json.RawMessage `json:"localized_description"`
}

type ManifestDirection struct {
    DesignIdentity
    ContentDigest   string          `json:"content_digest"`
    Path            string          `json:"path"` // design/directions/<slug>.json
    SHA256          string          `json:"sha256"`
    Slug            string          `json:"slug"`
    Name            string          `json:"name"`
    Label           string          `json:"label"`
    LocalizedLabel  json.RawMessage `json:"localized_label"`
    Prompt          json.RawMessage `json:"prompt"`
    LocalizedPrompt json.RawMessage `json:"localized_prompt"`
    Tokens          json.RawMessage `json:"tokens"`
}
```

- `manifest_sha256` 是发布 DTO 投影的 Go JSON 摘要，不能直接对原始 `manifest.json` 文件求 SHA，也不能以 JCS 替代。v30 已复现的投影为：完全排除顶层 `manifest_sha256` 属性，保留其余 DTO 的字段顺序，按 Go `encoding/json` 的紧凑 JSON、HTML 转义及嵌套对象编码规则输出（无缩进/尾换行），再计算 SHA-256，前缀为 `sha256:`。仅置为空串不等价于排除属性。M0 固定实际生产 DTO 投影与测试向量，不能把随机 map 序列化结果视为协议。
- `release.manifest_sha256` 必须与 manifest 声明一致；声明值须与上述投影摘要一致。`CHECKSUMS.sha256` 则校验原始 `manifest.json` 字节，两者用途不同；不得重写声明值来使其通过。
- `schema_version != 1` 或 `digest_schema != design-content-v1`：拒绝设计导入，不能猜旧格式。
- 四类数组条目必须 `catalog_id` 非空、`content_digest` 非空、`path`/`sha256` 非空；同一 `(publisher_id, kind, catalog_id)` 不得重复。

#### A.4.4 `design/catalog.json`

```go
type Catalog struct {
    Snapshot
    Resources []Entry  `json:"resources"`
    Taxonomy  Taxonomy `json:"taxonomy"`
}
type Snapshot struct {
    PublisherID   string `json:"publisher_id"`
    ReleaseID     string `json:"release_id,omitempty"`
    Revision      string `json:"revision,omitempty"`
    SchemaVersion int    `json:"schema_version"` // 1
    DigestSchema  string `json:"digest_schema"`  // design-content-v1
}
type Entry struct {
    Content
    ContentDigest string       `json:"content_digest"`
    Artifact      *ArtifactRef `json:"artifact,omitempty"` // v1 必填
    Provenance    *Provenance  `json:"provenance,omitempty"`
    CatalogRank   *int64       `json:"catalog_rank,omitempty"`
}
type Content struct {
    Kind     string          `json:"kind"` // template|design-system|style|direction
    ID       string          `json:"id"`   // catalog_id
    Metadata json.RawMessage `json:"metadata"`
    Files    []FileRef       `json:"files"`
}
type FileRef struct {
    Path   string `json:"path"`
    SHA256 string `json:"sha256"`
    Size   int64  `json:"size"`
    MIME   string `json:"mime"`
    Role   string `json:"role,omitempty"`
}
```

`catalog.json` 是资源身份、正文、文件引用、role、摘要和词表的权威来源。包内 `design/taxonomy.json` 必须与 `catalog.taxonomy` 表示同一词表；两者不一致即拒绝。模板/系统嵌套 DTO 是发布层表示：v30 的 371 个嵌套 content_digest 均为空，files 均缺 role，不能与 catalog DTO 整体判等。嵌套 content_digest 为空/缺省时以 catalog 校验值为准，非空时必须一致；files 按 path 对齐，path/sha256/size/mime 必须一致，缺省 role 由 catalog 提供，显式 role 不同即拒绝。catalog FileRef 的 role 若缺省，保持缺省参与摘要，不自行写入默认值。

发布包内 `catalog.snapshot` 使用 `release_id`，`revision` 为空，因此 `asset_snapshot_id` 是 `release:<release_id>`；hub 在线当前目录才使用 `current:<revision>`。

#### A.4.5 `design/taxonomy.json`

```go
type Taxonomy struct {
    Modes              []Term             `json:"modes"`
    Categories         []Term             `json:"categories"`
    ModeCategories     []ModeCategory     `json:"mode_categories"`
    ResourceCategories []ResourceCategory `json:"resource_categories"`
}
type Term struct {
    ID            string            `json:"id"`
    Name          string            `json:"name"`
    LocalizedName map[string]string `json:"localizedName"`
    ParentID      string            `json:"parent_id,omitempty"`
    Count         int               `json:"count"`
    Provenance    *Provenance       `json:"provenance,omitempty"`
}
type ModeCategory struct {
    ModeID     string `json:"mode_id"`
    CategoryID string `json:"category_id"`
}
type ResourceCategory struct {
    Kind       string `json:"kind"`
    ID         string `json:"id"`
    ModeID     string `json:"mode_id"`
    CategoryID string `json:"category_id"`
}
```

- ID 已是来源限定值（`source:<source UUID>:<原始ID>`）或本地 `local:<UUID>`，导入后不得重新编号。
- `count` 是发布集去重计数；下游查询不得自行累加跨 mode 计数。

#### A.4.6 `design/templates/<slug>.zip`

```text
template.json              # 发布层元数据
.prompts/*.md              # 外置提示词；template.json 中以相对路径引用
<展平后的 bundle 文件...>
<files 清单中 bundle 未覆盖的附件...>
<保留名冲突映射：template.json._source 等>
```

`template.json` 是 `TemplateDetail` 的 JSON，字段名和语义与 A.6 模板详情一致（但这里的 `files[].path` 是**原始逻辑路径**）：

```go
type TemplateDetail struct {
    TemplateKind         string          `json:"template_kind"`
    Downloadable         bool            `json:"downloadable"`
    HasSkill             bool            `json:"has_skill"`
    LocalizedName        json.RawMessage `json:"localized_name"`
    LocalizedDescription json.RawMessage `json:"localized_description"`
    LocalizedPrompt      json.RawMessage `json:"localized_prompt"`
    ExamplePrompt        string          `json:"example_prompt"`
    Mode                 string          `json:"mode"`
    TemplateCategory     string          `json:"template_category"`
    Platform             string          `json:"platform"`
    Scenario             string          `json:"scenario"`
    Triggers             []string        `json:"triggers"`
    Profile              json.RawMessage `json:"profile"`
    Preview              json.RawMessage `json:"preview"`
    CardPreview          json.RawMessage `json:"card_preview"`
    SkillPath            string          `json:"skill_path"`
    Author               json.RawMessage `json:"author"`
    Featured             bool            `json:"featured"`
    FeaturedPosition     int             `json:"featured_position"`
    ContentDigest        string          `json:"content_digest"` // 发布层可为空；以 catalog 为准
    AssetSnapshotID      string          `json:"asset_snapshot_id"`
    Files                []FileRef       `json:"files"` // 发布层可省略 role
    SourceFilePaths      map[string]string `json:"source_file_paths,omitempty"`
    SourceFileRefs       []SourceFileRef  `json:"source_file_refs,omitempty"`
}
type SourceFileRef struct {
    SourcePath  string `json:"source_path"`
    ArchivePath string `json:"archive_path"`
}
```

- `localized_prompt`/`localized_description`/`example_prompt` 的值是 `.prompts/` 相对路径；导入后对外详情必须还原为完整文本。
- 发布层 `template.json` 是导出元数据，**不是**上游源文件；上游同名源文件在 `template.json._source`（或映射记录的目标），必须按 `files[].path` 恢复原路径和字节。

#### A.4.7 `design/design-systems/<slug>.zip`

```text
design-system.json       # 元数据，body 改为 "DESIGN.md"
DESIGN.md                # 正文
DESIGN.md._source        # 生成正文与源文件冲突时的源文件
<其他源文件/附件...>
```

```go
type DesignSystemDetail struct {
    Name            string            `json:"name"`
    Description     string            `json:"description"`
    Category        string            `json:"category"`
    Colors          json.RawMessage   `json:"colors"`
    Capabilities    json.RawMessage   `json:"capabilities,omitempty"`
    Body            string            `json:"body"` // 值为 "DESIGN.md"；对外字段名为 content
    ContentDigest   string            `json:"content_digest"` // 发布层可为空；以 catalog 为准
    Metadata        json.RawMessage   `json:"metadata,omitempty"`
    Files           []FileRef         `json:"files"` // 发布层可省略 role
    SourceFilePaths map[string]string `json:"source_file_paths,omitempty"`
    SourceFileRefs  []SourceFileRef   `json:"source_file_refs,omitempty"`
}
```

`body` 字段对外仍为 `content`；导入时读取 `body` 指向的 `DESIGN.md`。

#### A.4.8 风格、方向与风格媒体

`design/styles/<slug>.json` 直接是：

```go
type StyleDetail struct {
    Context              string          `json:"context"`
    StyleSlug            string          `json:"style_slug"`
    Title                string          `json:"title"`
    Description          string          `json:"description"`
    Variant              string          `json:"variant"`
    Category             string          `json:"category"`
    Preview              json.RawMessage `json:"preview"`
    Recommended          bool            `json:"recommended"`
    LocalizedTitle       json.RawMessage `json:"localized_title"`
    LocalizedDescription json.RawMessage `json:"localized_description"`
}
```

`design/directions/<slug>.json`：

```go
type DirectionDetail struct {
    Label           string          `json:"label"`
    LocalizedLabel  json.RawMessage `json:"localized_label"`
    Prompt          json.RawMessage `json:"prompt"`
    LocalizedPrompt json.RawMessage `json:"localized_prompt"`
    Tokens          json.RawMessage `json:"tokens"`
}
```

风格媒体位于 `design/style-assets/<slug>/<path>`，路径由 `catalog` 的 `Entry.Files` 与风格 `preview` 引用；`slug` 是产物路径中的存储 slug，不是 `catalog_id`。

#### A.4.9 `CHECKSUMS.sha256`

每行 `<64位小写hex>  <包内相对路径>`，按路径排序，覆盖 `release.json`、`manifest.json` 与所有内容文件（不含自身）。导入必须逐条校验并双向核对覆盖范围；拒绝重复声明、悬空条目、遗漏文件和校验清单自身引用，不能只校验 manifest 引用。校验和不提供发布者签名认证。

#### A.4.10 源路径反向映射

- `source_file_paths`：原始逻辑路径 → 包内实际归档路径。
- `source_file_refs`：显式 `{source_path, archive_path}`，用于 `template.json`、`design-system.json`、`DESIGN.md` 的避让。
- 两表同时存在时必须一致；源路径唯一；归档目标必须存在；只允许安全相对路径。
- 归一路径相同的多个源路径可共享同一归档条目（bundle 展平与带前缀附件同字节），导入按 catalog `files.path` 逐个恢复并校验 `sha256/size`。
- 普通文件可无映射，按原路径读取；不得猜测删除包装前缀。
- `._source` 只是避让结果，不是资源身份或摘要输入。

### A.5 导入与激活规则（M1–M3）

1. 读取 ZIP 中央目录，先做条目数、单文件、累计解压、路径穿越/重复/文件目录冲突校验；嵌套 ZIP 单独限额，整次导入另计累计读取预算。保留原始 release/manifest，禁止在设计校验前运行 Agent 规范化。
2. 发现分区；旧 Agent-only 请求允许省略 sections，新版本设计包正式 preview/Apply 必须显式选择。未选择设计时沿用旧 Agent 宽松业务解析；选择设计时严格读取原始 `release.json`、`manifest.json`，校验 publisher 三处一致、预期发布者、schema/digest schema、release/manifest 版本与 ID。
3. 选择设计时校验 `CHECKSUMS.sha256` 全部条目及双向覆盖、manifest 投影摘要；再按 manifest 的 `path/sha256` 校验四类产物。校验覆盖整个外包，包括未选 Agent 产物的原始字节；因此任意条目损坏都会拒绝本次设计导入。未选 Agent 的业务字段、内嵌依赖不解析，其业务格式不支持不阻断设计。仅选 Agent 时不新增发布协议摘要检查。
4. 解析 `design/catalog.json`；校验每类 `catalog_id` 唯一、`content_digest` 与 Content 投影一致、`files` 的 SHA/大小与嵌套包实际文件一致。不得重算后覆盖包内摘要。
5. 解析嵌套 ZIP：`template.json`/`design-system.json`、`.prompts/`、`DESIGN.md`；区分发布层元数据与源文件，按 A.4.4 处理空摘要和缺省 role。
6. 按 A.4.10 恢复每个逻辑源路径；同一归档条目可对应多个逻辑路径，但各自 SHA/大小必须匹配；冲突明确失败。
7. 文件按 SHA 写入不可变对象（内容寻址），保存 `(entry, 逻辑 path)`、MIME、size、role；不得用归档避让路径替代 catalog path。
8. 在受限临时文件中预生成并持久化 native ZIP；设计事务锁住 current 单行，复核分区计划与 revision 后创建/复用快照及条目/文件/taxonomy，完整 ready 后切 current 并递增 revision。失败保留旧快照；对象存储不属于数据库事务，不在失败回滚中删除共享内容地址对象。同 release 按完整设计快照指纹比较，相同内容幂等，不同内容409。
9. Agent 与设计分别计划、分别提交。新包必须显式选择；设计-only 不退役 Agent。旧 Agent-only 继续允许缺省 sections，保留既有完整清单语义；选择 agent 但包根本不含 agent_resources 时拒绝，不能将缺省分区当空清单。显式存在的空 Agent 清单经预览确认后允许退役。旧未版本化设计分区若被选择则返回 unsupported_design_section，不得标记成功。
10. discovery/正式 preview/Apply 的请求字段与逐分区结果见 A.10。首次 preview 由服务端计算 package_sha256、plan_digest；Apply 携带这些返回值。事务内 revision 变化返回409，不能只在事务外校验计划。

### A.6 对 Desktop 的服务契约（M5）

#### A.6.1 路由

| 用途 | MonkeyAI 本地路径 |
| --- | --- |
| snapshot | `GET /api/v1/design-resources/catalog/snapshot` |
| 列表 | `GET /api/v1/design-resources/catalog/{templates,design-systems,styles,directions}` |
| 详情 | `GET /api/v1/design-resources/catalog/{templates,design-systems,styles,directions}/{id}` |
| 模板下载 | `GET /api/v1/design-resources/catalog/templates/{id}/download` |
| 系统下载 | `GET /api/v1/design-resources/design-systems/{id}/download` |
| 媒体 | `GET/HEAD /api/v1/design-resources/catalog/{previews,style-assets}/{id}/*path` |
| taxonomy | `GET /api/v1/design-resources/catalog/taxonomy` |
| config | `GET /api/v1/design-resources/config` |
| token | `POST /api/v1/design-resources/token` |

#### A.6.2 信封与错误码

成功：`{"code":0,"message":"","data":...}`。失败：`{"code":"<string>","message":"...","data":null}`，并返回下表 HTTP 状态：

| HTTP | code |
| --- | --- |
| 400 | `invalid_argument` |
| 401 | `unauthorized` |
| 403 | `forbidden` |
| 404 | `snapshot_not_found` |
| 404 | `resource_not_found` |
| 409 | `resource_version_mismatch` |
| 416 | `invalid_argument`（Range） |
| 503 | `unavailable` |

现有 Agent 认证中间件的错误仅在 catalog/下载资源边界转换为上表格式，并映射错误码；config/token 保留控制面 error 信封。媒体走独立 JWT 验证器，错误采用上表格式。

#### A.6.3 快照绑定

- 导入快照身份是 `(publisher_id, source_release_id)`；对外 `asset_snapshot_id` 固定为 `release:<source_release_id>`。
- `/catalog/snapshot` 返回 `{publisher_id, release_id, schema_version:1, digest_schema:"design-content-v1"}`。
- 列表、详情、媒体 URL 绑定同一 snapshot；客户端传 `snapshot=release:<id>` 和 `publisher_id`。
- 未知/不可用快照返回 404 `snapshot_not_found`，不得回落到 current；资源摘要或 `asset_snapshot_id` 不符返回 409 `resource_version_mismatch`。
- hub 的 `current:<revision>` 与本地 `release:<id>` 都是不透明版本标识；Desktop 不得自行构造或替换。hub 更新不会自动改变已导入本地快照。

#### A.6.4 分页、过滤与顺序

- 页码从 1 开始，默认 `page_size=20`；page_size 超过100时按100处理，非整数/小于1等非法值400。空目录 `total_pages=0`；超出末页空 items 但保留 total/total_pages。
- 过滤：模板 `q,mode,category,template_kind`；系统 `q,category`；风格 `q,context,category,variant,recommended`；方向 `q`。
- `q` 为确定性文本搜索（不承诺语义排序）。
- 排序必须与导入的 `catalog_rank` 一致：有秩的在前，按 `(catalog_rank, kind, catalog_id)` 升序；无秩在后按 `(kind, catalog_id)` 稳定回退。使用可空/指针类型区分合法 0 与字段缺省；重复秩按 ID 打破平局。过滤保持相对顺序，不得按名称或摘要重排；v30 没有 catalog_rank，全部走稳定回退。
- `mode`/`category` 接受词表中的限定 ID 或原始 ID，语义同 hub 契约。

#### A.6.5 列表与详情字段

统一字段命名（snake_case 包内 → 对外 camelCase）：

| 包内 | 对外 |
| --- | --- |
| `localized_name` | `localizedName` |
| `localized_description` | `localizedDescription` |
| `localized_prompt` | `localizedPrompt` |
| `example_prompt` | `examplePrompt` |
| `skill_path` | `skillPath` |
| `localized_title` | `localizedTitle` |
| `localized_label` | `localizedLabel` |
| `template_category` | `category` |
| `style_slug` | `slug` |

模板列表条目至少包含：`id, template_kind, downloadable, has_skill, content_digest, asset_snapshot_id, name, localizedName, description, localizedDescription, mode, category, preview_url, card_preview`。模板详情追加 `localizedPrompt, examplePrompt, skillPath, source_skill_path, files, download, download_url`；`source_skill_path` 的解析规则见 A.6.11；`download` 固定为 `{url:"..."}`，不可下载时为 `null`。列表不得返回 `examplePrompt, skillPath, source_skill_path, content, metadata`；模板列表也不得返回 `localizedPrompt`。

系统详情返回 `id, name, description, category, colors, capabilities, content, metadata, files, content_digest, asset_snapshot_id, download_url`。风格详情返回 `id, context, slug, title, description, variant, category, preview, localizedTitle, localizedDescription, content_digest, asset_snapshot_id`。方向详情返回 `id, label, localizedLabel, prompt, localizedPrompt, tokens, content_digest, asset_snapshot_id`。

无预览时 `preview_url/card_preview` 为 `null`；无翻译时对象为 `{}`。展示默认值不得写回摘要输入。

#### A.6.6 URL、下载与媒体

- 所有生成的 URL 使用配置的可信公开地址，绑定 `snapshot`、`publisher_id`；有内容摘要时带 `content_digest`。
- 模板/系统下载读取导入阶段保存的确定性 ZIP，直接流式返回，不得请求时重新打包或302到对象存储；支持 `Range`（206/416）、`HEAD`、强 `ETag` 与 `If-None-Match`（304）。ETag 是该 ZIP 对象真实字节 SHA，不能用业务 content_digest 代替。
- 媒体 GET/HEAD 同样支持 Range/ETag；响应头至少 `Cache-Control: private, max-age=0, must-revalidate`、`Vary: Authorization`、`X-Content-Type-Options: nosniff`；`image/svg+xml` 必须加 sandbox CSP。
- 鉴权必须先于 304/Range 返回；错误 HEAD 无正文且禁止缓存。
- 媒体允许 query token，但 token 不得进入快照、ZIP、业务摘要或持久 URL；日志不得记录 query token。
- 原生模板下载 ZIP：导入时从不可变源文件按恢复后的逻辑路径重建并持久化，包含 catalog 明确记录的路径及上游 `template.json` 等源文件原字节，不加入发布层生成的 `template.json`、`.prompts` 或 `._source` 避让副本；原始源文件本身就有这些名称时必须保留。仅恢复有记录的逻辑路径，不猜未记录的包装目录。ZIP 容器字节可与 hub 不同，但逐文件路径/字节与业务 `content_digest` 必须一致。

#### A.6.7 taxonomy

`/catalog/taxonomy` 返回已冻结词表：

- `modes/categories` 保留限定 ID、`parent_id`、`localizedName`、`provenance` 和发布集 `count`；
- `mode_categories` 保留多对多关系；同一二级分类可属于多个 mode；
- `resource_categories` 只列当前快照可见模板关联；
- 计数按发布集去重，父分类累计后代但不跨 mode 重复；零计数词条保留。

#### A.6.8 通用约定

**请求头**

| 头 | 适用 | 说明 |
| --- | --- | --- |
| `Authorization: Bearer <token>` | JSON/ZIP | hub 使用 hub JWT，本地使用现有 Agent 认证；config/token 仅现有 MonkeyAI 认证 |
| `Authorization: Bearer <token>` | 媒体 | hub 使用 hub JWT，本地仅本地媒体 JWT；本地媒体不接受 Agent access token 或 hub JWT |
| `Accept` | 可选 | JSON 接口返回 `application/json` |
| `Range` | 媒体、ZIP | `bytes=start-end`，支持单区间与多区间（最多 32 段） |
| `If-None-Match` | 媒体、ZIP | 与响应 ETag 比较，命中返回 304 |
| `If-Range` | 媒体、ZIP | 与当前 ETag 不一致时忽略 Range，返回完整 200 |

**查询参数通用规则**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `snapshot` | string | 否 | hub：`current:<64位小写hex>` 或历史 `release:<UUID>`；本地：`release:<source_release_id>`。省略表示 current。显式非法/未知返回 404 `snapshot_not_found`，不得回落 current。 |
| `publisher_id` | string | 否 | 传值时与快照发布者比较；不一致返回 403 `forbidden`。 |
| `content_digest` | string | 否 | 详情/媒体/下载使用；与目标资源摘要不一致返回 409 `resource_version_mismatch`。列表接口不要传。 |
| `token` | string | 仅媒体 | 媒体 GET/HEAD 可用；存在 `Authorization` 时以它为准，失败不降级到 query token。 |

重复 `snapshot`/`token` 参数、非法百分号或分号编码：400 `invalid_argument`（认证层）或 404 `snapshot_not_found`（快照解析层），按实现顺序固定，不能使用部分解析结果。

**响应头**

| 头 | 值 |
| --- | --- |
| `Content-Type` | JSON 为 `application/json`；ZIP 为 `application/zip`；媒体为文件 MIME |
| `Cache-Control` | 成功 JSON/ZIP/媒体：`private, max-age=0, must-revalidate`；错误：`no-store` |
| `Vary` | `Authorization` |
| `ETag` | 媒体/ZIP：`"<sha256 的 64 位小写 hex>"`（带引号，不含 `sha256:` 前缀） |
| `Accept-Ranges` | 媒体：`bytes` |
| `Server-Timing` | 可选：`catalog;dur=<毫秒>` |
| `X-Content-Type-Options` | 媒体：`nosniff` |
| `Content-Security-Policy` | `image/svg+xml`：`sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'` |

**错误响应**：`{"code":"<string>","message":"<中文原因>","data":null}`。HEAD 错误无响应体，且 `Cache-Control: no-store`、无 ETag。

| HTTP | code | 触发 |
| --- | --- | --- |
| 400 | `invalid_argument` | 分页/过滤参数非法、非法 Range、查询编码非法 |
| 401 | `unauthorized` | 缺 token、签名/算法/iss/aud/exp/身份声明非法 |
| 403 | `forbidden` | publisher 不匹配、无设备或资源权限 |
| 404 | `snapshot_not_found` | 显式快照未知/过期/非法、无 current |
| 404 | `resource_not_found` | 快照内资源/媒体不存在或 MIME 非媒体 |
| 409 | `resource_version_mismatch` | `content_digest` 与选定资源不符 |
| 416 | `invalid_argument` | Range 全部不可满足 |
| 503 | `unavailable` | JWT 未配置、目录/存储不可用 |

#### A.6.9 `GET /catalog/snapshot`

返回当前（或指定）快照身份。

**参数**：`snapshot`、`publisher_id`。

**响应 200**

```go
type SnapshotData struct {
    PublisherID   string `json:"publisher_id"`
    ReleaseID     string `json:"release_id,omitempty"` // hub current 不返回
    Revision      string `json:"revision,omitempty"`   // hub current 返回
    SchemaVersion int    `json:"schema_version"`       // 1
    DigestSchema  string `json:"digest_schema"`        // design-content-v1
}
```

hub 示例：

```json
{"code":0,"message":"","data":{"publisher_id":"2de5ff13-0471-430e-9b95-0f0c89899408","revision":"d223479bc6d94a5660739ec5daf0bedfbf868306f8910e72f07e28cc622eb692","schema_version":1,"digest_schema":"design-content-v1"}}
```

本地示例：

```json
{"code":0,"message":"","data":{"publisher_id":"fixture-publisher","release_id":"70000000-0000-0000-0000-000000000001","schema_version":1,"digest_schema":"design-content-v1"}}
```

**错误**：401、403、404 `snapshot_not_found`、503。

#### A.6.10 `GET /catalog/{templates|design-systems|styles|directions}`

**路径参数**：资源复数名，只能是 `templates`、`design-systems`、`styles`、`directions`。

**查询参数**

| 参数 | 类型 | 默认 | 适用 | 说明 |
| --- | --- | --- | --- | --- |
| `page` | int ≥1 | 1 | 全部 | 非整数/小于 1：400 |
| `page_size` | int ≥1 | 20 | 全部 | 大于 100 按 100 处理 |
| `q` | string | 空 | 全部 | 确定性文本搜索；匹配 metadata 的 JSON 文本或 catalog_id，大小写不敏感 |
| `mode` | string | 空 | 模板 | 限定 ID 或原始 ID；多 mode 关联任一命中 |
| `category` | string | 空 | 模板、系统、风格 | 同上 |
| `template_kind` | string | 空 | 模板 | `bundle` 或 `prompt` |
| `context` | string | 空 | 风格 | 与 metadata.context 精确匹配 |
| `variant` | string | 空 | 风格 | 精确匹配 |
| `recommended` | `true`/`false` | 空 | 风格 | 其他值 400 |
| `snapshot` / `publisher_id` | string | 空 | 全部 | 见 A.6.8 |

**响应 200**

```go
type PageData struct {
    Items           []map[string]any `json:"items"`
    Total           int              `json:"total"`
    Page            int              `json:"page"`
    PageSize        int              `json:"page_size"`
    TotalPages      int              `json:"total_pages"` // ceil(total/page_size)，空目录为 0
    AssetSnapshotID string           `json:"asset_snapshot_id"`
}
```

各类型 `items[]` 字段：

| kind | 列表字段 |
| --- | --- |
| template | `id, template_kind, downloadable, has_skill, content_digest, asset_snapshot_id, name, localizedName, description, localizedDescription, mode, category, preview_url, card_preview` |
| design-system | `id, content_digest, asset_snapshot_id, name, description, category, colors, capabilities, preview_url` |
| style | `id, content_digest, asset_snapshot_id, context, slug, title, description, variant, category, preview_url, recommended, localizedTitle, localizedDescription` |
| direction | `id, content_digest, asset_snapshot_id, label, localizedLabel, prompt, localizedPrompt, tokens` |

模板列表不返回 `localizedPrompt`、`examplePrompt`、`skillPath`、`source_skill_path`、`files`、`content`、`metadata`。系统列表不返回 `content`、`metadata`、`files`。翻译缺失时为 `{}`，无预览时 `preview_url`/`card_preview` 为 `null`。

示例（本地，page_size=1）：

```json
{"code":0,"message":"","data":{"items":[{"id":"sample.bundle","template_kind":"bundle","downloadable":true,"has_skill":false,"content_digest":"sha256:a9bc5a8a...","asset_snapshot_id":"release:70000000-0000-0000-0000-000000000001","name":"示例模板","localizedName":{},"description":"","localizedDescription":{},"mode":"web","category":"landing","preview_url":null,"card_preview":null}],"total":2,"page":1,"page_size":1,"total_pages":2,"asset_snapshot_id":"release:70000000-0000-0000-0000-000000000001"}}
```

**错误**：400、401、403、404 `snapshot_not_found`、503。

#### A.6.11 `GET /catalog/{templates|design-systems|styles|directions}/{id}`

**路径参数**：`id` 为 `catalog_id`，按单个路径段 URL 编码（允许点号，如 `linear.app`）。

**查询参数**：`snapshot`、`publisher_id`、`content_digest`。

**响应 200**：在对应列表字段基础上追加详情字段。

模板详情追加：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `localizedPrompt` | object | 语言 → 完整提示词文本 |
| `examplePrompt` | string | 完整示例提示词；无为空串 |
| `skillPath` | string | 保留 catalog.metadata.skillPath 原值；可能是发布层相对路径，不能直接用作 native ZIP 的源文件路径 |
| `source_skill_path` | string\|null | 有技能时为已解析的逻辑源文件路径；无技能为 null；服务层计算，不进入 metadata 或业务摘要 |
| `files` | FileRef[] | 源文件清单：`path,sha256,size,mime,role` |
| `download` | object\|null | `{url}`；不可下载为 `null` |
| `download_url` | string | 同 `download.url`；不可下载时省略 |

模板详情的 `source_skill_path` 解析规则（需 M0 同步 hub/Desktop）：has_skill=false 时返回 null，不尝试读取默认 skillPath；为 true 时先匹配 catalog.files 的精确逻辑路径，否则只使用显式 source_file_paths/source_file_refs 的反向映射，必须唯一命中一个源文件。无映射、悬空或歧义返回导入校验错误，不按文件名或包装目录猜测。该字段是可验证的解析结果，不进入 metadata 或 content_digest。v30 的110个 bundle 可通过映射定位；109个 prompt 无技能，skillPath 虽为 SKILL.md 也不需要文件。

系统详情追加：`content`（正文完整文本）、`metadata`、`files`、`download_url`。

风格详情追加：`files`（风格媒体清单）。

方向详情：无额外字段（列表字段即完整业务字段）。

模板详情示例：

```json
{"code":0,"message":"","data":{"id":"sample.bundle","template_kind":"bundle","downloadable":true,"has_skill":false,"content_digest":"sha256:a9bc5a8a...","asset_snapshot_id":"release:70000000-0000-0000-0000-000000000001","name":"示例模板","localizedName":{},"description":"","localizedDescription":{},"mode":"web","category":"landing","preview_url":null,"card_preview":null,"localizedPrompt":{"zh-CN":"创建首页\n"},"examplePrompt":"","skillPath":"","source_skill_path":null,"files":[{"path":"README.md","sha256":"sha256:c4093066...","size":15,"mime":"text/markdown","role":"source"}],"download":{"url":"https://monkeyai.example.com/api/v1/design-resources/catalog/templates/sample.bundle/download?snapshot=release:70000000-0000-0000-0000-000000000001&publisher_id=fixture-publisher&content_digest=sha256%3Aa9bc5a8a..."},"download_url":"https://monkeyai.example.com/api/v1/design-resources/catalog/templates/sample.bundle/download?snapshot=release:70000000-0000-0000-0000-000000000001&publisher_id=fixture-publisher&content_digest=sha256%3Aa9bc5a8a..."}}
```

**错误**：400、401、403、404 `snapshot_not_found` 或 `resource_not_found`、409、503。

#### A.6.12 `GET /catalog/templates/{id}/download`

**参数**：`snapshot`、`publisher_id`、`content_digest`；请求头可带 `Range`、`If-None-Match`、`If-Range`。

**响应 200**：`Content-Type: application/zip`，`Content-Disposition: attachment; filename="<id>.zip"`，正文为原生模板 ZIP。支持：

- `HEAD` → 200，无正文，带 `Content-Length`、`ETag`；
- `Range` → 206，`Content-Range: bytes start-end/total`；
- `If-None-Match` 命中 → 304，无正文；
- `If-Range` 不匹配 → 忽略 Range，返回 200 全量。

**响应 416**：`{"code":"invalid_argument","message":"无效 Range","data":null}`，带 `Content-Range: bytes */<size>`。

**错误**：400、401、403、404、409、416、503。**禁止 302 到对象存储。**

#### A.6.13 `GET /design-systems/{id}/download`

与 A.6.12 相同，只是路径不在 `/catalog` 下，返回冻结源文件 ZIP。响应头、Range/HEAD/304/416 规则一致。

#### A.6.14 `GET|HEAD /catalog/{previews|style-assets}/{id}/*path`

**路径参数**：`id` 为模板或风格 `catalog_id`；`*path` 为 `catalog.files[].path` 按段 URL 编码后的相对路径。

**查询参数**：`snapshot`、`publisher_id`、`content_digest`、`token`（仅媒体）。

**响应 200/206**：媒体原始字节，`Content-Type` 为 `files[].mime`；只允许 `image/*`、`video/*`、`audio/*`，其他返回 404 `resource_not_found`。

必须支持：

| 请求 | 响应 |
| --- | --- |
| 普通 GET | 200，`Content-Length`、`ETag`、`Accept-Ranges` |
| HEAD | 200，无正文，头与 GET 一致 |
| `Range: bytes=0-31` | 206，`Content-Range` |
| 多区间 | 206，`Content-Type: multipart/byteranges; boundary=...`；最多 32 段 |
| 全部区间不可满足 | 416，`Content-Range: bytes */<size>` |
| `If-None-Match` 命中 | 304，无正文 |
| `If-Range` 不匹配 | 200 全量 |

鉴权必须先于 304/206 返回；条件请求不能绕过 token 校验。SVG 必须带 A.6.8 的 sandbox CSP。

**错误**：400、401、403、404、409、416、503。

#### A.6.15 `GET /catalog/taxonomy`

**参数**：`snapshot`、`publisher_id`。

**响应 200**

```go
type TaxonomyData struct {
    Modes              []Term             `json:"modes"`
    Categories         []Term             `json:"categories"`
    ModeCategories     []ModeCategory     `json:"mode_categories"`
    ResourceCategories []ResourceCategory `json:"resource_categories"`
}
type Term struct {
    ID            string            `json:"id"`
    Name          string            `json:"name"`
    LocalizedName map[string]string `json:"localizedName"`
    ParentID      string            `json:"parent_id,omitempty"`
    Count         int               `json:"count"`
    Provenance    *Provenance       `json:"provenance,omitempty"`
}
type ModeCategory struct {
    ModeID     string `json:"mode_id"`
    CategoryID string `json:"category_id"`
}
type ResourceCategory struct {
    Kind       string `json:"kind"`
    ID         string `json:"id"`
    ModeID     string `json:"mode_id"`
    CategoryID string `json:"category_id"`
}
```

示例：

```json
{"code":0,"message":"","data":{"modes":[{"id":"web","name":"网页","localizedName":{"en":"Web"},"count":1}],"categories":[{"id":"landing","name":"首页","localizedName":{"en":"Landing"},"parent_id":"product","count":2}],"mode_categories":[{"mode_id":"web","category_id":"landing"}],"resource_categories":[{"kind":"template","id":"sample.bundle","mode_id":"web","category_id":"landing"}]}}
```

空词表时四个数组均为 `[]`，不能为 `null`。

**错误**：400、401、403、404、503。

#### A.6.16 `GET /api/v1/design-resources/config`

控制面，不属于 catalog 契约。鉴权使用 MonkeyAI 现有登录/Agent 认证，不使用 hub JWT。

**请求参数**：无。

**响应 200**

```go
type ConfigData struct {
    SchemaVersion int               `json:"schema_version"` // 1
    PublisherID   *string           `json:"publisher_id"` // 未配置为 null
    Respub        *RespubAccess     `json:"respub"`         // 未配置为 null
    MonkeyAI      LocalDesignAccess `json:"monkeyai"`
}
type RespubAccess struct {
    BaseURL string `json:"base_url"` // 完整 base，含 /api/design
}
type LocalDesignAccess struct {
    BaseURL   string       `json:"base_url"` // 含 /api/v1/design-resources
    Available bool         `json:"available"`
    Snapshot  *SnapshotRef `json:"snapshot"` // 未导入为 null
}
type SnapshotRef struct {
    PublisherID   string `json:"publisher_id"`
    ReleaseID     string `json:"release_id"`
    SchemaVersion int    `json:"schema_version"`
    DigestSchema  string `json:"digest_schema"`
}
```

示例：

```json
{"schema_version":1,"publisher_id":"2de5ff13-0471-430e-9b95-0f0c89899408","respub":{"base_url":"https://hub.monkeycode-ai.com/api/design"},"monkeyai":{"base_url":"https://monkeyai.example.com/api/v1/design-resources","available":true,"snapshot":{"publisher_id":"2de5ff13-0471-430e-9b95-0f0c89899408","release_id":"70000000-0000-0000-0000-000000000001","schema_version":1,"digest_schema":"design-content-v1"}}}
```

**错误**：401、403、503。

- 未配置 respub：`respub` 为 `null`，不是 `{"base_url":""}`。
- 未导入本地快照：`available=false`、`snapshot=null`，`base_url` 仍返回。
- 响应不得包含 secret；`Cache-Control: no-store`。

#### A.6.17 `POST /api/v1/design-resources/token`

**请求体**

```json
{"machine_id":"已登记设备 MachineID","target":"respub"}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `machine_id` | string | 是 | 必须属于当前认证用户的已登记设备；空或未知返回 403 |
| `target` | string | 是 | `respub` 或 `monkeyai-media`；其他值 400 |

**响应 200**

```json
{"token":"<jwt>","expires_at":"2026-10-21T08:10:00Z"}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `token` | string | `target=respub`：hub JWT（A.2）；`target=monkeyai-media`：本地媒体 JWT |
| `expires_at` | RFC3339 | Token 过期时间，默认签发后 10 分钟 |

**错误**

| HTTP | code | 触发 |
| --- | --- | --- |
| 400 | `invalid_argument` | body 非法、target 不支持 |
| 401 | `unauthorized` | 未登录/凭据无效 |
| 403 | `forbidden` | machine_id 不属于当前用户、设备已移除 |
| 503 | `unavailable` | 对应签发密钥或部署稳定实例ID未配置 |

- `target=respub` 还要求完整 respub base 已配置，未配置返回503；离线场景只影响 hub token，本地媒体 token 仍按独立配置签发。
- config/token 的错误保持现有控制面 `{"error":{"code":"...","message":"..."}}` 信封；本节错误表的 code 是这两个新端点自身的业务错误。既有 RequireAgent 在进入 handler 前产生的控制面错误仍保留现状；不套用 catalog 中间件错误转换。
- 响应 `Cache-Control: no-store`，不得回显 secret 或额外 claims。
- `respub` 与 `monkeyai-media` 不得混用：hub JWT 不能访问本地媒体，本地媒体 JWT 不能访问 hub。
- Token 只返回给已认证 Desktop；不得写入日志、任务文件或持久存储。

#### A.6.18 Desktop 调用顺序

```text
1. GET  {monkeyai}/config
2. POST {monkeyai}/token  {machine_id, target:"respub"}   // 需要 hub 时
3. GET  {respub.base_url}/catalog/snapshot  Authorization: Bearer <hub jwt>
4. GET  {respub.base_url}/catalog/templates?page=1&page_size=20&snapshot=current:<revision>
5. 详情/下载/媒体使用同一 snapshot 与 publisher_id
6. 401：重新取 token，最多重试一次；403 直接失败，不切源绕过
7. 404 snapshot_not_found / 409：提示重新选择，不静默改用 current
```

本地渠道使用 config.monkeyai.base_url 原值拼后缀，JSON/ZIP 使用 Agent 认证；媒体先通过 token 控制面获取 target=monkeyai-media 的独立 JWT，再用 Bearer 或临时 query token 请求。保留同一 snapshot/publisher_id/content_digest，不自行给完整 base 再追加 /api/v1/design-resources。


### A.7 `design-content-v1` 摘要与快照指纹

#### A.7.1 资源内容摘要

摘要输入只允许以下投影，metadata 使用 catalog 中的业务字段名，不能先转发布层 DTO 或 API 展示默认值：

```json
{"kind":"template","id":"<catalog_id>","metadata":{},"files":[{"path":"...","sha256":"sha256:...","size":1,"mime":"...","role":"..."}]}
```

四类 metadata 白名单（v30 实际出现的字段集合，M0 必须逐类型冻结字段类型与向量）：

| kind | 字段 |
| --- | --- |
| template | `author, card_preview, category, description, downloadable, examplePrompt, featured, featured_position, has_skill, localizedDescription, localizedName, localizedPrompt, mode, name, platform, preview, profile, scenario, skillPath, template_kind, triggers` |
| design-system | `capabilities, category, colors, content, description, metadata, name` |
| style | `category, context, description, localizedDescription, localizedTitle, preview, recommended, slug, title, variant` |
| direction | `label, localizedLabel, localizedPrompt, prompt, tokens` |

- 白名单外 metadata 字段不得悄悄丢弃后继续校验；M0 固定拒绝未知字段的 v1 策略。id/kind/metadata/files 必须存在，metadata 为对象，files 为数组；缺省、null、空字符串、空对象和空数组分别保留，不能互相转换。字段是否允许 null、哪些业务字段必填写入 M0 夹具，不能由 Go 零值决定。
- `publisher_id/release_id/asset_snapshot_id/provenance/catalog_rank/object_key/source_skill_path/签名URL/token/时间/内部UUID` 不进入业务摘要。metadata 内 preview 的逻辑文件路径属于业务内容，必须保留；不能将“排除服务端生成 URL”误解为删除整个 preview。
- files 按原逻辑 path 的 UTF-8 字节顺序排序，拒绝重复路径，区分大小写。FileRef 只含 path/sha256/size/mime 和存在时的 role；size 为非负整数，缺省 role 不补成 source。catalog 中的 role 不能因嵌套 DTO 没有该字段而删除。
- triggers、capabilities 按集合规则排序；profile 步骤、colors、预览序列、提示词及 tokens 内数组保留业务顺序，不递归排序所有数组。集合元素类型、是否允许重复及对象集合的比较键在 M0 与生产端固定，不凭单个包推断新规则。taxonomy 不进入单资源摘要，只进入快照指纹。
- 使用 RFC 8785 JCS 编码，再 SHA-256，输出 `sha256:<64位小写hex>`。JSON 解码拒绝重复键、非法 UTF-8、无效 Unicode 代理项和不符合 JCS 数值域的输入；用可保留精度的解码方式，不经过 Go float64 静默舍入。数字表示、UTF-16 对象键排序等由合格 JCS 实现负责，不用 encoding/json 默认输出冒充。
- 正文、提示词和文件字节不修剪、不做 Unicode 归一化、不转换换行。展示层缺翻译时的 `{}`、无预览时的 null 等默认值只在响应时生成。
- 导入方重算以校验包内摘要，不能覆盖 catalog_id/content_digest/文件SHA。v30 的472个条目按 kind/id/原 metadata/按 path 排序的 files 投影重算全部匹配；这只能证明该样本，不代替 M0 的 Unicode、数字、空值与集合反例。

#### A.7.2 设计快照指纹

用于 `(publisher_id, release_id)` 内容冲突判定，与单资源 content_digest、原始 package_sha256 分开存储：

```json
{"schema_version":1,"digest_schema":"design-content-v1","publisher_id":"...","release_id":"...","resources":[{"kind":"template","id":"...","content_digest":"sha256:...","artifact":{"path":"...","sha256":"sha256:..."},"provenance":{},"catalog_rank":0}],"taxonomy":{}}
```

resources 按 `(kind,id)` 排序；artifact/provenance/catalog_rank 保留存在与缺省的差异，schema/身份不能省略。taxonomy 原值包含 count、provenance 和关系；集合按明确主键排序：modes/categories 按 id，mode_categories 按 `(mode_id,category_id)`，resource_categories 按 `(kind,id,mode_id,category_id)`，重复键拒绝。保留每项所有契约字段，不重算 count。使用同一 JCS 编码与 SHA-256 格式。规范 taxonomy 的编码顺序不改变其业务内容；服务端对象 key、导入时间、生成的 native ZIP 容器摘要不进入快照指纹。

同 release 改变条目、产物引用、排序、来源或 taxonomy 任一受保护字段均409，不能仅比较所有资源的 content_digest。设计分区指纹不含 Agent，因 Agent-only 内容变化不制造设计 release 冲突。

### A.8 与 hub 的差异和兼容要求

| 项目 | hub | MonkeyAI 本地 |
| --- | --- | --- |
| 资源 base | `/api/design` | `/api/v1/design-resources` |
| snapshot 标识 | `current:<revision>` | `release:<source_release_id>` |
| JSON/ZIP 认证 | hub JWT（`aud=respub-design`） | 现有 Agent 认证（RequireAgent） |
| 媒体认证 | hub JWT query/Bearer | 本地媒体 JWT（`aud=monkeyai-design-media`） |
| 目录来源 | 当前资源库（含手工/编辑） | 最近一次成功导入的快照 |
| 更新时机 | 同步/编辑后立即 | 重新导入并激活后 |

除上述差异外，响应字段、摘要、分页、过滤、排序、错误码、媒体与 ZIP 行为必须一致，使 Desktop 只替换 base 和凭据即可复用同一解析器。

### A.9 最小实施与验收顺序

1. M0：冻结契约、manifest/JCS 摘要向量、source_skill_path 双端协议与小型夹具；真实大包只作显式离线回归。
2. M1 与 M3 的解析入口前置改造：分区发现、保留原始发布身份、按选择解析；先验证设计-only 不进入 Agent 规范化、幂等或退役分支。
3. M1/M2 最小闭环：一条 bundle、一条 prompt、一套系统的解析、源路径恢复、不可变存储、预生成 ZIP 与本地下载；验证断网可读、真实 ZIP ETag 与 Range。
4. 完成 M1/M2 四类资源与 M3：完整快照、逐分区计划/结果、幂等、部分成功、上传复用、锁内 current revision 复核。
5. M4/M5：config/token、设备归属与两类 JWT，全部资源路由、字段、排序、分页、媒体与响应信封；对照冻结夹具和 hub 验证器。
6. M6/M7：导入对话框与历史记录、配置和 -X 注入、文档、专用测试库及全量检查。
7. M8：与 respub/Desktop 联合验收，两渠道字段/文件/摘要一致，断网、历史快照、Token 过期及失败重试均通过。

### A.10 管理端分区导入协议与状态

本节扩展既有管理端 `/api/admin/v1/resource-imports` 系列，不使用 catalog 信封。保留旧 Agent-only 请求和响应字段，新增字段由 OpenAPI、后端与管理台一起更新。

#### A.10.1 发现与预览

使用同一个 preview 端点区分发现与正式计划：

```json
{"upload_id":"...","discover_only":true}
```

发现只检查安全 ZIP 目录、原始元数据的 JSON 语法及分区存在性，返回 `available_sections` 和逐分区 supported/unsupported 信息，不解析/规范化 Agent 资源，不生成可执行 plan_digest，不允许作为 Apply 输入。

正式 preview：

```json
{"upload_id":"...","sections":["design"],"options":{}}
```

sections 是 agent/design 的非空去重集合，服务端按固定顺序规范化；未知、重复、请求不存在的分区均400。新版本设计包必须显式选择，旧包无 sections 时保留 Agent-only 行为。正式 preview 不要求客户端提供 package_sha256/plan_digest，服务端计算后返回。所有所选分区必须可计划，否则返回明确错误，不产生部分可执行的总计划；可重新选择健康分区单独预览。

预览返回新增字段示意（省略原有 Agent 展示字段）：

```json
{
  "sections":["design"],
  "package_sha256":"sha256:...",
  "plan_digest":"sha256:...",
  "section_plans":{
    "design":{
      "plan_digest":"sha256:...",
      "current_revision":0,
      "snapshot_digest":"sha256:...",
      "publisher_id":"...",
      "release_id":"...",
      "schema_version":1,
      "counts":{"template":1,"design-system":1,"style":1,"direction":1}
    }
  }
}
```

总计划绑定上传、actor、package SHA、规范化 sections、options 及每个分区的 plan_digest。Agent 分区计划覆盖其绑定/资源修订，设计分区计划覆盖设计快照指纹及单行 current revision；两个分区不使用对方的可变状态作为自身计划输入。Apply 开始时校验总计划，每个分区在自身事务锁内再次校验本分区计划。

#### A.10.2 确认与逐分区结果

```json
{
  "upload_id":"...",
  "sections":["agent","design"],
  "package_sha256":"sha256:...",
  "plan_digest":"sha256:...",
  "section_plan_digests":{"agent":"sha256:...","design":"sha256:..."},
  "options":{"confirm_final":true}
}
```

固定 agent → design 顺序执行；每个分区有独立对象预写、业务事务、锁、成功回执与失败记录。设计预检失败不被 Agent 宽松规则忽略；分区执行期间失败不撤销已成功分区。业务写入和该分区成功回执在同一事务提交，失败原因在回滚后的独立事务记录。客户端断连不回滚已经提交的成功分区。

若至少一个分区成功/已成功，返回 HTTP 200，顶层 status 为 succeeded 或 partial；不得仅凭200展示全部成功：

```json
{
  "status":"partial",
  "sections":{
    "agent":{"status":"succeeded","replayed":false},
    "design":{"status":"failed","http_status":409,"error":{"code":"import_conflict","message":"设计当前修订已变化，请重新预览"}}
  }
}
```

若没有任何分区成功，全部为计划冲突返回409，参数/包错误400，存储/数据库故障503；混合原因优先503，其次409，再400。响应仍包含逐分区结果，错误使用管理端现有信封并在 OpenAPI 中定义结果载荷。认证/上传访问权校验失败立即拒绝，不执行任何分区。若故障发生在开始执行之后，也须尽可能返回已知且已提交的分区结果；数据库不可用或提交结果未知时不得声称失败记录已持久化，重试先读取成功回执恢复结果，不能盲目重新执行。失败记录使用业务回滚后的新事务，不能依赖已出错事务。

一个上传的每个分区最多成功应用一次，成功回执持久化原计划与结果。完全相同的已成功请求重放返回原成功结果并标记 replayed，不重新应用/激活，不因当前指针后来变化而改写历史。失败分区需重新 preview，携带新计划后重试；不复用旧总计划绕过修订校验。

上传只要还有未完成的已声明受支持分区就保留 ready；全部完成才记 imported。已完成 Agent 的上传在原有效期内仍可选择 design，重新预览后处理。失败或部分成功不清理上传对象、不延长原保留期；过期后重新上传。历史按上传/分区记录 pending/succeeded/failed、源 release、内部批次及失败原因，不把整包 AlreadyImported 当作所有分区已完成。

multipart 兼容入口接受同等 sections/section_plan_digests 元数据；跨分区分次处理与持久成功回执以封存 upload_id 为准。旧 multipart Agent-only 行为保持，需分次处理的混合包先建立上传会话，不能靠重复传 ZIP 假装相同会话。

### A.11 发布者与凭据的信任边界

- 首期单一活跃发布者：配置 MONKEYAI_DESIGN_PUBLISHER_ID 时导入、激活均要求一致，config 未配置时仍返回 publisher_id=null；部署初次激活可绑定原包 publisher，后续切换发布者须另行设计显式管理操作。当前指针锁与绑定在同一事务内生效。查询历史快照以 `(publisher_id,release_id)` 定位，不用当前指针隐式替换发布者。
- 发布身份三处一致、CHECKSUMS 和业务摘要校验只保证内容自洽，不证明原发布者签名。首期由已授权管理员选择可信来源包；验收拒绝的是身份不一致、配置不符和既有 release 内容冲突，不声称防止重新伪造完整新 release。
- 共享 HS256 secret 的 MonkeyAI 与 hub 处于同一签发信任域。若服务端二进制或密钥会交付给不可信部署方，不能把 instance_id 当作隔离边界；推广前需另设按实例密钥注册/撤销或非对称签发协议，不向该类部署分发全局共享密钥。
- 本地媒体 JWT 是10分钟内有效的 Bearer 凭据，首期不声明设备移除后已签发 token 立即失效；移除后不得继续签发。若要求即时撤销，另加本地用户/设备状态查询及撤销版本校验。密钥独立、签发限制与 audience/issuer/instance/sub/exp 校验仍必须实施。
- 运行环境变量覆盖编译期默认值时使用是否存在的判断（如 os.LookupEnv），显式空值也必须覆盖，以便关闭编译默认 URL 或凭据；不能复用把空值视为未设置的 envOr。非法非空 URL 启动报错，空 URL 表示离线渠道。
