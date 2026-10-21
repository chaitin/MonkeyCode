# 设计资源导入与离线分发

后端支持设计资源 v1 发布包，四类目录独立于 Agent 资源保存。控制面与本地资源完整 base 均为 `<MONKEYAI_PUBLIC_URL>/api/v1/design-resources`；hub base 由配置原样下发。实现计划与验证状态见 [实施方案](design-resource-import-plan.md)，包格式见 [本地契约](design-resource-contract-v1.md)。

## 部署配置

升级前运行数据库迁移，新增设计快照、条目、源文件、current 指针和逐分区回执。生产不执行 down；先备份数据库与对象存储，并保留现有 S3 配置。

| 环境变量 | 用途 |
| --- | --- |
| MONKEYAI_INSTANCE_ID | 部署级稳定身份，生成一次后持久保存；不要每次重启生成 |
| MONKEYAI_DESIGN_PUBLISHER_ID | 可选预期发布者；配置时导入与激活必须匹配 |
| MONKEYAI_DESIGN_RESPUB_URL | 可选完整 hub base，例如 `https://hub.monkeycode-ai.com/api/design` |
| MONKEYAI_DESIGN_RESPUB_JWT_SECRET | 与可信 hub 验证端一致的服务端签名密钥 |
| MONKEYAI_DESIGN_MEDIA_JWT_SECRET | 独立的本地媒体签名密钥，不能复用 hub 密钥 |

不配置 hub URL 即离线模式，config.respub 为 null；本地资源只依赖 PostgreSQL/S3。缺少签发密钥或实例身份时相应 token 端点503，不使其他功能启动失败。无设计快照时 available=false、snapshot=null，目录请求404 snapshot_not_found。非法非空 hub URL 在启动时报错：必须包含完整路径，禁止 userinfo/query/fragment，不能只填裸域名后期待补 `/api/design`。

首期每部署只激活一个发布者：预期发布者未配置时，首次成功激活绑定源 publisher；随后其他 publisher 返回409。config 顶层 publisher_id 仅表示预期配置，未配置时仍为 null；实际身份从 snapshot 读取。暂不提供发布者切换操作。

建议使用高熵随机密钥，保存到服务端运行环境或部署密钥设施；不要写入前端、任务、资源包、日志或 Git。共享 HS256 密钥的服务端与 hub 位于同一签发信任域，不应向不可信私有部署分发全局共享密钥。媒体凭据有效期10分钟，移除设备后停止签发；本期不提供已签发短期凭据的即时撤销。

## 管理台流程

1. 打开“资源管理 → 导入资源包”，上传 ZIP、字节分卷或选择解压目录。总大小上限2 GiB，封存上传按原保留期保存24小时。
2. 服务端先发现可用分区。选择 Agent、设计或二者，再解析并预览；旧未版本化设计分区显示不支持，不算设计成功。
3. 核对 Agent 新增/更新/停用，以及设计发布者、源 release ID、四类计数和快照变化。选择设计不计划 Agent 退役；选择 Agent 表示确认该发布者的完整 Agent 清单。
4. 确认后固定 Agent→设计分别提交。部分成功保留成功结果并显示失败原因，不把HTTP200等同全部成功；失败分区需重新预览后重试。
5. 同一上传在有效期内可补导另一分区。成功回执重放只返回原结果，不重新应用或激活；处理完成后点击“完成”，在历史中查看逐分区状态与源 release。

设计严格校验整包 CHECKSUMS、发布身份、产物 SHA、业务摘要、逻辑源文件和 taxonomy；未选 Agent 的业务内容不解析，但其外包原始字节仍包含在完整性校验内。Agent-only 继续使用旧宽松业务解析。校验和证明完整性，不提供发布者签名认证；包来源由已授权管理员确认。

同 publisher/release 的不同设计快照指纹返回409；指纹包含 taxonomy、排序、来源和产物引用，不仅比较单个资源摘要。旧快照、源文件和已生成 ZIP 保持不可变。损坏内容、过期计划或事务失败不会替换 current。

## 客户端协议

- config/token：使用现有 Agent OAuth Bearer，成功返回裸对象，错误沿用控制面 error 信封，no-store。
- JSON/ZIP：使用现有 Agent OAuth Bearer；资源响应使用 `{code:0,message:"",data:...}`，错误 code 为字符串，data=null。
- 媒体：先以自己的已登记 machine_id 请求 target=monkeyai-media，使用独立本地媒体 JWT 的 Bearer 或临时 query token。存在 Authorization 时优先验证它，失败不降级；hub JWT 和 Agent access token 不能代替本地媒体 JWT。
- hub：target=respub 返回 HS256/iss=monkeyai/aud=respub-design 的短期JWT，client_id取服务端验证后的MachineID。需要 hub base、对应密钥与实例身份。
- 从 config 读取完整 base，再请求 `/catalog/snapshot`，后续固定 snapshot/publisher_id/content_digest。明确指定的未知快照404、摘要不符409，不静默回落 current；401最多刷新一次，403不切源绕过。
- 模板/系统下载直接读取冻结 ZIP，不302到S3。Range、HEAD、If-None-Match、If-Range 使用真实字节强ETag；鉴权先于304/206。媒体只允许image/video/audio，SVG加sandbox CSP，缓存私有。
- 原 metadata.skillPath 保留；模板详情 source_skill_path 是独立解析的源文件逻辑路径，无技能时null，不参与业务摘要。这个新增字段尚待 respub/Desktop 跨项目互验，不能假定旧客户端已消费。

源文件按 catalog 记录的逻辑路径恢复，ZIP包含原源文件，不加入生成的发布元数据或避让副本。可恢复已记录的包装路径，不能重现未记录的原 ZIP 容器字节。业务摘要及逐文件字节与发布源保持一致，ZIP容器SHA不承诺跨渠道相同。

## 临时文件与对象存储

设计导入流式处理，外包最多5000条，单嵌套包最多5000条/512 MiB展开，元数据单文件8 MiB，所有资源保留的发布元数据累计最多64 MiB，整次实际读取展开字节累计4 GiB。拼接/解析/预览/确认的并发请求最多2个，预算在下载上传块或解析multipart前取得，取消等待会释放请求；服务端应为上传拼接、源对象及预生成ZIP预留足够临时磁盘空间。

Compose 将 TMPDIR 放到 `import_tmp` 磁盘卷，并在后端镜像中创建归属运行用户的 `/app/import-tmp`，避免大包落到内存 tmpfs。二进制部署可设置 TMPDIR 为权限受控的独立磁盘目录。请求成功/失败正常退出时清理临时文件；进程异常退出留下的临时目录需在确认没有活跃导入后清理，不应删除已有快照对象。

S3复用现有bucket，需要条件创建、HeadObject和字节Range读取能力。对象按SHA寻址，已存在同key必须核对SHA/大小；事务失败不立即删除共享对象。当前保留未引用的内容地址对象，自动回收尚未实现。过期上传会清理传输块，分区成功/失败历史与回执保留。

## 编译期默认值

配置优先级为运行环境变量 > 编译期 `-X` 默认值 > 未配置。显式空环境变量也会覆盖默认值，可以关闭编译预置的hub或签发配置。Compose示例显式传入空值时会关闭镜像内的对应默认值；使用编译默认值的部署需移除相应运行环境项。

实际字符串符号位于 `github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config`：

```bash
go build -trimpath -o monkeyai-server \
  -ldflags "-X 'github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config.defaultInstanceID=<stable-instance-id>' \
            -X 'github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config.defaultDesignRespubURL=https://hub.monkeycode-ai.com/api/design' \
            -X 'github.com/chaitin/MonkeyCode/monkeyai/backend/internal/config.defaultDesignPublisherID=<publisher-id>'" \
  ./cmd/server
```

密钥对应 defaultDesignRespubJWTSecret/defaultDesignMediaJWTSecret，推荐运行时注入。编译默认密钥可被二进制分析提取，不是安全保管；若必须使用，应通过受控构建过程注入，不将真实密钥写入源码、镜像参数、公开客户端或构建日志。

## 本地验证与剩余验收

普通测试读取 backend/testdata/design-contract/v1 冻结夹具；修改夹具须审查SHA256SUMS。大包只通过 MONKEYAI_DESIGN_FIXTURE_ZIP 显式启用，不提交原包。

已验证独立校验器对v30的472项、专用PostgreSQL迁移升级/回滚、真实S3条件写入与Range、HTTP快照/媒体/ZIP、分区部分成功与历史保留，以及本机管理台设计-only导入。后端全量测试、管理台测试/构建和最终检查结果由实施方案进度表记录。

尚未完成：respub生产验证器与JWT验证器互验、Desktop真实双源/刷新与断网联调、生产部署。不要用本地夹具或浏览器验收替代这些跨项目检查。
