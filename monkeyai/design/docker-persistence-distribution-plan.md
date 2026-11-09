# Docker 持久化、server 镜像分发与 runtime 更新

## 本轮范围

- 沿用两个原工作树：`MonkeyCode-feat-environment-client-api`、`MonkeyCodePro-feat-engine-installer-oss`。
- 保留 Docker；停止环境保留容器，启动复用原容器，删除才清理容器。新容器根文件系统可写；旧只读容器保留既有配置。
- 本轮 Docker/gVisor 实现不设计磁盘限额、磁盘镜像或 Firecracker。后续已确认 Firecracker 作为并存执行引擎，采用稀疏 raw 文件；“不用.img”不适用于该引擎，记录见[执行引擎与计费讨论](environment-engines-billing-discussion.md)，暂不实施。
- 环境镜像由 server 提供标准只读 Registry，完整镜像保存在 server，不向宿主重定向公网。采用成熟 Distribution 实现，固定摘要、双架构及离线导入均需支持。
- 宿主 Docker 配置对应仓库的 CA；Pro 历史提交 `91873b2` 的 `certs/ca.crt` 为 IAM CA，当前 `baizhi-office-ca.crt` 为另一套办公 CA。证书链信任不解决当前内置证书与公网 IP 的名称不匹配，需保留显式 insecure 配置的单仓库兼容范围。
- runtime 独立发行与更新，不重建容器，提供客户端版本查询及更新 API。初期在已确认停止的环境执行，保留身份和用户数据，运行中请求提示先停止。
- 修复 runtime 模式清空开发环境变量的问题，保留已发布开发镜像的国内源及 Go 临时目录设置，过滤运行时凭据。

## 后续讨论状态

Firecracker并存引擎及首版稀疏raw/ext4存储方向已记录，尚未实现。环境本地积分计费服务端已实现：按分配CPU／内存和可确认运行秒数计量，每分钟结算，确认停止后结束，实收尾费可为负余额；失联未知区间不补扣，存储暂不收费。账户级5分钟预警、余额耗尽禁止新建／启动及发起停止均由服务端处理，保留用户数据，不依赖客户端在线。

管理后台配置已按反馈简化为项目统一表单，计费展示已实现；最终浏览器验收待恢复。客户端、邮件和Firecracker实现不在本轮。环境／计费模块完整数据库回归、迁移、鉴权API、16项计费race及314项前端检查通过；重基线main680c554a后的标准check、关键账务race、Pro组合测试／vet和双架构构建通过。云环境及计费结构统一收敛到40，主线1～39不改，默认关闭收费，不追溯旧运行时段；无部署或真实扣款。详见[计费记录](environment-engines-billing-discussion.md)。

## 宿主独立配置与授权

当前表单按单个宿主保存规格、用户配额、费率与授权。统一迁移40直接创建最终结构，重放不改已有配置、授权、环境或余额；撤回权限只限制新建和再启动，不打断原运行／连接。各宿主独立计价和切分时段，免费宿主不因用户余额耗尽而被停止，配置横向滚动已修复。实现以[单宿主计划](host-configuration-access-plan.md)为准。

## 状态

| 工作 | 状态 |
| --- | --- |
| 需求与源码核对 | 完成；历史 CA 已定位 |
| Docker 容器持久化 | 完成；真实 Docker/gVisor 验证同容器、系统修改和身份保留 |
| server Registry 与双架构资源 | 完成；真实 Docker 使用 X-Registry-Auth 拉取并校验摘要／架构 |
| Docker CA 与拉取认证 | 完成；签名／过期／错签／撤销、CA 合并及配置保留验证通过 |
| runtime 独立更新及客户端 API | 完成；双架构资源、迁移 45、停止后更新、原子切换与回退验证通过 |
| 数据库、引擎、发行与集成验证 | 完成；后端 check、引擎及安装器检查、数据库竞态、客户端鉴权、管理端构建、API 校验和双架构编译通过 |

## runtime 更新设计与当前验证

- 客户端新增 `GET /api/v1/environments/{id}/runtime`、`POST /api/v1/environments/{id}/runtime/upgrade`。查询使用 environment:read，更新使用 environment:manage，限定本人环境、已确认停止、幂等键及代次。
- runtime 以官方 `linux/x64/release.json`、`linux/arm64/release.json` 为唯一上游，server 打包时固定同版本／修订、校验大小和 SHA-256，直接缓存官方单文件，不再单独构建或二次发布 runtime。
- OhMyAgent 为 runtime 内嵌的独立可执行引擎。宿主在本架构的临时隔离准备容器中读取 bundle 信息并释放所需引擎，优先复用匹配文件；该容器不挂载用户数据，也不重建用户容器，server 无跨架构执行要求。旧四文件发行资源仍保留兼容读取。
- engine 将版本写入运行时持久卷内受保护的 `_engine/releases/<version>`，校验 SHA-256、大小、ELF 架构及 bundle 关联后原子切换 current.json。下载失败不改活动版本；支持选择 server 已有旧版本回退。
- 更新不重建容器，不修改 `/var/lib/monkeyai/state`。runtime 卷父目录改为 root 所有，state 子目录仍由 UID 1000 使用，避免任务改写受管理程序。
- 新建环境可在首次启动前安装 server 选定版本，已有镜像内程序作为兼容回退。普通停止清除待更新目标，但保留已安装版本。
- 协议通过 environment_protocol=2、runtime_update_protocol=1/2 协商；1 为旧四文件资源包，2 为官方单文件和宿主本地引擎准备。旧宿主维持原行为，旧 server 不收到新增状态字段。
- 本轮独立 PostgreSQL 与 Docker-in-Docker 测试容器及其卷已清理，未改动其他测试容器。验证日志保存在 `/tmp/monkeyai-final-validation-261105`，独立 runtime 发行产物在 `/tmp/monkeyai-runtime-release-261105`；sqlc 1.30 官方校验二进制位于 `/tmp/monkeyai-sqlc-1.30.0/sqlc`。
- runtime 更新、发行脚本、真实 OAuth 客户端鉴权及迁移重放／回滚保护测试通过。后端 make check（sqlc 1.30/schema 一致性、全量测试、vet）、engine 全量测试、关键模块竞态与 vet、Pro installer 全模块及 Go/Python 发行工具回归通过。管理端构建、局部 lint、环境状态测试和三份 OpenAPI YAML／引用检查通过；engine 与 installer 的 Linux amd64/arm64 编译通过。
- 真实 ARM64 Docker 29.4.3 + gVisor 验证发现默认 root:self 写层会丢弃系统修改，已明确设置 `--overlay2=none` 并纳入安装／升级热加载。验证同容器 stop/start、系统层文件保留、独立 runtime 版本切换及 machine ID／公钥保留通过。
- 真实 Docker 从 server Distribution 仓库使用 X-Registry-Auth 拉取验证通过，镜像摘要及架构与目标一致。独立 PostgreSQL 上 environment、enginehost、真实客户端 API 和迁移全量竞态回归通过；迁移45增加待更新回滚保护并验证幂等重放。
- 独立 runtime 26.1105.2 双架构资源已在 `/tmp/monkeyai-runtime-release-261105` 构建并校验，未上传 OSS。当前轮不发布 engine/server、不部署或操作线上用户环境。

## 官方 runtime 上游调整（完成）

用户提供的官方清单包含 schema、version、runtimeRevision、engineRevision、createdAt、expiresAt，以及 artifact 的 OS、架构、path、size、sha256。当前两架构均为 26.1105.2。已删去独立 runtime build/publish 入口，由 server 打包自动解析并锁定两架构清单；同轮全部安装包使用相同快照。在线安装获取固定原始文件，离线包直接携带原始文件和清单，已固定的离线资源不因上游清单后续过期而失效。

宿主使用协议2在本架构、无网络／用户数据挂载的临时 gVisor 容器读取内嵌信息及许可证，优先复用受保护缓存或镜像内的匹配引擎；缺失时自动执行无身份的 install-only 释放。发现基础镜像已有 runtime 命令链接会造成 setup 安装冲突，已在临时准备容器内移除该链接，用户容器不变。旧四文件资源、已安装同内容缓存和协议1保持兼容；官方单文件不会下发给旧宿主。

本轮验证：

- 真实官方 x64／arm64 清单与原始程序的版本、修订、大小、SHA-256、ELF 架构、缓存及离线复制通过；无 runtime 二次发布。
- 原生 amd64（build-dev）与 arm64（Colima）上的 Docker 29.4.3/gVisor，官方单文件更新、匹配引擎复用、强制释放、容器启停、系统修改及 machine ID／公钥保留全部通过；没有遗留 engine-runtime 准备容器。
- 独立 PostgreSQL 的环境／宿主全量竞态、真实 OAuth 客户端 API 和迁移回归通过，包括协议门槛和单文件下发；backend make check、engine 全量测试/vet及关键race、installer全模块/vet、runtime准备race、Go/Python发行脚本回归、API引用检查、engine/installer Linux双架构编译通过。
- 本轮发行物和日志位于 `/tmp/monkeyai-runtime-source-261105`；测试容器与卷收尾清理，不修改线上环境，不发布新版 engine/server。


## 云环境设置简化（完成）

用户要求移除预设名称／镜像输入，不再将二者作为全局业务配置写入数据库。新全局设置只保存资源规格和用户额度；默认镜像取自server安装器导入清单的首项，由安装器确保当前发行镜像排首位。创建时自动匹配宿主架构，并将实际镜像摘要、资源、runtime版本保存在环境快照。旧预设只保留历史引用，不再暴露新增／启停或用于新创建。迁移46从旧默认预设复制资源，保留已有环境spec及旧请求重试语义；新环境不再关联preset_id。已删除旧预设页、管理路由及SQL写操作。

用户补充要求环境列表／详情显示runtime版本：已展示宿主最近实际上报的runtime_version，未知显示“未确认”，不从默认镜像、名称或server发行信息推断。

验证：backend make check（sqlc1.30/schema、全量常规测试、vet）、独立PostgreSQL环境竞态回归（旧架构错误码断言调整后定向重跑通过）、真实OAuth客户端列表／详情版本回归、迁移46回填／重放／回滚保护、envimage默认镜像与Pro目录排序测试、installer全模块测试/vet、backend Linux amd64/arm64编译、管理端构建/局部lint/状态测试、三份OpenAPI及1956本地引用通过。ego-browser本地模拟接口验证表单仅提交resource/quota/revision、镜像未就绪仍可保存、列表及详情版本已知／未确认、375px窄屏与深色模式通过；预览代码和服务已清理，截图与日志位于 `/tmp/monkeyai-resource-settings-261106`。


## MonkeyAI Server HTTP 支持（完成）

Server根地址同时接受HTTP／HTTPS，安装生成／实际curl、installer与engine控制客户端、Registry配置、容器runtime Server字段和Server runtime包下载贯通。HTTP不需额外开关，仅对Server的host:port登记Docker兼容项；TLS设置、宿主签名、认证、SHA／大小校验和拒绝重定向策略保持。runtime已有HTTP→ws、HTTPS→wss适配，现有网络隔离规则不变。

范围仅MonkeyAI Server。GitHub、Docker官方依赖、OSS发行源、依赖镜像的HTTPS校验均不放宽。新增HTTP／HTTPS签名注册心跳与撤销、真实curl HTTP及摘要、非法URL拒绝、runtime更新原子性／身份回归通过。隔离Docker29使用特定非loopback Server HTTP端点的认证拉取与HTTPS回归通过，摘要和架构匹配，临时容器／卷与目录已清理。证据 `/tmp/monkeyai-http-host-261110`。未变更两个已有环境或现有HTTPS部署。

代码需新ENGINE_VERSION的installer／engine及server更新后生效；本轮不发布部署。

## 独立引导与 cgroup v2 准入（完成）

安装引导统一用独立瞬态服务，启动只传唯一 `--unit`，交互经实际解析确认后仅加 `-t`，不传额外的超时、等待、管道和回收参数。私有原子回执确认实际退出码，非交互跟随日志；已开始任务不重试，完成后清理任务和私有目录。installer读取systemctl的Key=value，enable/start分开。启动参数写入0700私有脚本，unit只接收无凭据的脚本路径，避免enrollment出现在systemd默认描述中；引号和命令注入回归通过。

运行栈仅支持cgroup v2，不纳入v1或旧nftables兼容。缺少v2时在准备资源／接入之前拒绝，说明建议使用默认v2的Ubuntu22.04/24.04或Debian12；CentOS7/systemd219优先更换或升级系统，不建议仅改内核启动参数。Docker上报v1或v2控制器无法读取时也给出对应建议，权限错误不误报为v1，完整资源限额与专用运行时校验保持。

已在实际CentOS7 arm64目标运行新版installer，以合成凭据验证在安装前给出建议，不访问后台或创建安装数据。此前旧systemd及现代systemd的8项独立任务控制测试仍有效。引导／错误建议／权限／v2限额回归和backend check通过，临时Docker、容器、构建目录、私有文件与代理隧道已清理。未正式接入宿主或修改启动配置。证据 `/tmp/monkeyai-cgroup-v2-required-261110`。

文案属于installer／engine更新，需以新ENGINE_VERSION打包发布后生效；server引导同步私有参数传递。已发布v26110901不覆盖，本轮不发布或部署。

## 五表数据模型（完成）

按未上线、无历史包袱的新系统设计，新增表由11张减为5张：hosts、environments、environment_operations、environment_defaults、environment_quotas。删除预设及preset_id、磁盘额度列；宿主配置／调度／当前升级并入hosts，运行身份并入environments，默认配置行承接控制锁。表名统一为hosts，不保留engine_hosts。

迁移采用主线39的下一版40，保留38向量模型和39知识库，直接定义新结构，不提供旧开发版38的兼容升级或版本校准。旧测试部署须备份后重建云环境结构，本轮不清库或部署。runtime绑定必须成组、机器ID唯一、实例／代次匹配；身份更新先锁环境行再处理凭据，刷新共享锁等待提交以避免死锁。

验证通过：backend make check（schema/sqlc、全模块测试、vet），完整环境／宿主PostgreSQL竞态、五表迁移／回滚、OAuth/API、运行身份／授权刷新并发及升级回归；管理端311项测试、Lint、构建和API1966引用。实现已完成，原测试部署不变，交付同步现有两仓PR。验证记录在 `/tmp/monkeyai-five-tables-261109`。

## 迁移版本收敛记录（五表调整前）

以下记录对应此前的十一表开发结构，不再作为当前部署步骤。


按用户纠正，PR 新增的38～46收敛为 `000038_cloud_environments` 一对up/down文件，严格使用 main37 的下一个版本。1～37不变，生成schema/sqlc无差异；原测试库46的最终结构须先核对再手动校准为38，不在应用或安装器中自动force。旧中间开发版先用原迁移包补齐结构，不能直接改版本号跳过DDL。

验证通过：37→38、原46与新38完整schema等价、旧46直接用新包拒绝且不dirty、校准后up返回no change，迁移及授权scope回滚race、标准backend检查通过。按明确授权核对测试部署11张云环境表的列／约束／索引及OAuth约束后，已备份并事务校准46→38、dirty=false；全部云环境业务数据指纹不变，db／backend／admin保持健康且启动时间不变。未运行迁移SQL、重建数据或部署服务；后续不得重跑旧迁移镜像。日志在 `/tmp/monkeyai-migration-38-261109`。

## 宿主环境数与下钻（完成）

宿主列表新增服务端 `environment_count`，包含运行、停止、失败和未确认删除的环境；确认删除后移出计数。数字以链接进入环境列表，并在URL中保存 `host_id` 和展示名称；可继续筛选状态、排序和分页、打开详情、刷新及清除宿主条件。后端在排序分页前按宿主过滤，校验UUID和重复参数，保持本人接口的owner约束。无需新增迁移。

新增真实PostgreSQL回归验证多宿主／零环境、停止／删除失败／旧代次删除报告、计数与下钻一致、筛选先于分页排序、owner隔离及非法参数。标准backend make check、相关数据库race、前端308项测试／Lint／构建及API1956引用通过。浏览器验证数字链接、零环境空态、状态组合、刷新与URL分页保留、清除筛选及375px深色布局；相关详情折叠和资源输入统一使用已有UI组件。结果在 `/tmp/monkeyai-host-drilldown-261106`，尚未部署线上。

## Registry单一持久目录、可读标签与启动失败修复（完成）

用户要求消除部署根目录environment-images与data/environment-images的重复持久镜像；新包只挂载data/environment-images，catalog原子保存默认来源和完整镜像状态。installer通过backend无DB的一次性environment-images命令探测／导入并核对确认收据，优先复用完整Registry或旧OCI；临时OCI放在data/environment-images/.imports，成功且新服务健康、state保存后清理已确认的OCI文件，失败保留。旧包流程兼容，旧目录升级后清理，未知文件不删除。

用户补充实际启动失败及镜像名不要hash/@sha256。只读SSH确认119.29.238.142最新环境runtime_failed，engine宿主1.14.130.150的镜像及runtime26.1106.1已就绪、非OOM，但root所有的_engine程序目录为0700，容器UID1000无法遍历；已在Current/Update显式修复受控程序目录0755，保留身份／记录私有权限并补严格umask回归及具体错误日志，未修改线上环境。

实际拉取地址改为environments/<来源basename>:<OCI版本标签>，无版本label使用可读递增vN，不覆盖同名同版本不同摘要；image_digest独立保存和校验，协议3引擎才接收版本标签，旧摘要仓库及快照继续可用。

验证：backend check、envimage/engine核心race及vet、installer全模块和Pro后台全模块测试/vet、数据库可读标签协议门槛与原设置/身份回归、3份API1956引用和engine/installer/Pro后台Linux双架构编译通过。真实UID10001离线无DB导入、删除OCI输入后重启及默认版本恢复、同长度损坏Registry拒绝确认、旧导入目录与健康失败重试/清理范围通过。原生amd64（build-dev）和arm64（Colima）的Docker29.4.3/gVisor均通过实际tag鉴权拉取并检查摘要/架构、严格umask077下的runtime原容器系统层/身份保留及强制引擎释放。测试日志在 `/tmp/monkeyai-image-registry-261106`；本轮只读排查线上，未上传发布或修改用户实例。

已有开发镜像 `runtime-26.1105.2-v26110501` 已在上一轮发布并通过双架构容器验证；相关开发镜像、持久化、分发与更新改动均保存在两个原功能工作树，本轮形成两仓本地提交并同步 Pro 子模块；未推送。本轮未发布新版 engine/server，未修改线上宿主或用户环境。
