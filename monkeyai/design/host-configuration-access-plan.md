# 八表云环境实施计划

状态：八表方案实施与本地验收完成。远端gitlink与CI以原两份PR最新提交及交付回执为准。沿用原两工作树及两份PR，保持各一个中文提交；主线同步至a060360f。按用户最新选择保留主线迁移1～39，云环境顺延为单版40，38向量模型与39知识库不重编号。不部署、不访问实际数据库、不操作真实宿主或环境；浏览器仍由用户控制。

## 已确认模型

- hosts：创建者user_id、enabled、max_environments、activated_at；保留身份、状态和业务报告时间。删除接入hash／expiry、一次性challenge／expiry、enrolled_at、调度权重及累计值。
- host_environment_configs：host_id、resource、user_max_environments、billing。无配置或价格revision；最后有效提交覆盖。
- host_upgrades：独立任务历史，包含from_version及目标版本、安装程序／清单摘要；每宿主最多一个pending/running任务。
- environments：18字段。创建幂等归入operations；spec只保存执行配置，ID、实例、代次、目标及CPU／内存由列组装；删除compute_reserved。保留目标与实际状态、停止确认、使用量及两类原因。
- environment_runtimes：environment_id、machine_id、public_key、instance_id、generation、runtime_version。身份四字段同空或同有，machine_id唯一；无runtime_request_id。
- environment_operations：保留异步操作、历史与幂等；增加所有者user_id，kind包含create，创建幂等以(user_id,request_key)限定；每环境每代次一条。
- environment_quotas：仅host_id、user_id、max_environments。
- environment_billing_periods：保留价格／资源快照和持久结算进度，移除pricing_revision，比较价格内容切分区间。
- 删除environment_defaults，统一使用PostgreSQL事务级advisory lock，保持先控制锁、再宿主／环境／账户锁的顺序。

## 数量调度与计费边界

- 宿主和用户都统计所有未确认删除环境，停止仍占名额，确认删除后释放；新建在同一事务计数并分配。
- 不限制CPU／内存分配总量及同时运行数，允许超卖；单环境限制、资源监控与按分配规格计费保持。
- 再次启动不新增数量，只校验状态、授权、余额等；降低数量上限不清理或停止现有环境。
- 保留持久化容器、系统修改、runtime身份、原用户数据与财务历史；授权撤回仅限制新建及再次启动，不打断原运行／连接。

## 无专用接入／挑战状态

- 服务端使用持久服务器级签名密钥签发短期接入凭证，含宿主ID、目标版本及过期时间；凭证不落库，不放进report或新认证表。
- 注册验证凭证和宿主公钥签名，再原子绑定公钥、记录首次activated_at；升级和重启复用宿主私钥。
- 重发接入命令撤销旧待接入宿主并创建新ID，避免旧签名凭证仍能接入。
- 新心跳／交换签名包含用途、服务器地址、宿主ID、报告时间及完整内容摘要。通过无状态时间接口取得服务器时间，避免宿主时钟偏差。
- 在事务中用last_seen_at／environment_synced_at作为已接受业务报告时间，拒绝旧时间或重复时间；不新增认证序列、不缓存nonce。交换时间校验与状态更新／计量在同一事务，重复报告不能推进费用。
- Registry短期公钥签名凭证保持；Server HTTP支持保持，第三方HTTPS校验不改。

## 实施顺序

1. 修改统一40及查询，生成schema/sqlc；实现advisory lock、配置和升级拆表、计数调度及创建幂等。
2. runtime拆表、精简spec、报告与计费调整，保留并发／身份／历史保护。
3. 无状态接入签发及新请求签名，同时更新OSS engine、Pro安装器及服务端显式生命周期接入。
4. 调整管理页／API／模拟预览、领域术语和部署说明，保持纵向表单、简洁提示与文字操作。
5. 独立PostgreSQL升降级／重放、全模块及竞态、实际鉴权／超卖／数量／费用／重放验证；前端检查；Pro真实gitlink独立测试／vet／双架构构建。
6. 备份后单中文提交同步OSS再Pro，精确旧SHA force-with-lease，核对远端gitlink／CI并清理专用测试资源。

## 进度

- 已备份并重基线原工作树，确认Go模块版本与迁移边界。
- 已实施八表40、按schema的事务级advisory lock、宿主创建者／激活时间、独立配置与升级历史、runtime拆表及精简spec。
- 已实施数量调度与用户数量覆盖，取消资源总量准入和compute_reserved；操作承接创建幂等，价格按内容切分时段。
- 已实施服务器级持久签名凭证、重发替换待接入ID、v2心跳／交换时间签名及业务时间原子推进；engine与Pro installer同步。
- 后端标准make check、环境／宿主／设备关联全量DB、真实OAuth／管理员审计／迁移、数量／runtime／计费／报告重放竞态均通过。标准检查出现一次已有安装器断连用例5秒等待超时，单独及完整重跑通过，未改断言；旧快照比较、数据库时钟夹具、长签名命令及worker模拟接口测试已按新模型校正，未放宽身份和财务保护。
- 新主线前端319测试、变更文件lint、类型与生产构建通过。全量lint的43项错误位于与main逐字节相同的已有知识库／应用文件，回执记录基线；不把这些错误计作本轮通过项。预览保留原模拟状态，未恢复浏览器操作。
- engine、installer、Pro实际gitlink完整测试／vet及Linux双架构构建通过；适配本次主线TUI构造接口变化，根模块Go1.25保持。
- API、领域术语及部署文档已同步八表／数量／新签名协议；补齐主线知识库引用的ResourceID／IfMatch参数，2172个OpenAPI引用校验通过。两仓保持单中文提交并按精确旧SHA同步，最终交付回执记录远端gitlink与CI。
- 用户确认云环境顺延40以保留新主线38／39。主线1～39的78个SQL文件逐字节不改；40保留kb授权类型，真实数据库回归证明云环境up／down／重放不改变知识库记录与授权。
