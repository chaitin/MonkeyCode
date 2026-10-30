# standalone 运行时编排

本轮通过现有 CLI 接入 standalone；不修改 `MonkeyAI/apps/runtime`，不向容器交付宿主私钥、管理员令牌或用户 refresh token。

## 镜像与目录契约

管理员提供固定摘要的 Linux OCI 镜像，必须包含：

| 路径 | 用途 |
| --- | --- |
| `/opt/monkeyai/monkeyai-runtime` | 既有 standalone runtime Linux 发行物 |
| `/opt/monkeyai/ohmyagent` | 对应的任务引擎及其所需依赖 |
| `/usr/bin/tini` | PID 1，负责回收孤儿进程 |
| `/bin/sleep` | 支持 `infinity` 的驻留进程 |

镜像根只读；程序和动态库必须允许 UID/GID 1000 执行。托管规格忽略镜像 Entrypoint/Cmd，固定运行 `tini -g -- /bin/sleep infinity`，并使用固定的 PATH、HOME、USER、LOGNAME、LANG，不继承镜像的身份及执行环境变量。整个固定摘要镜像是这组程序的发行边界，不支持用户替换其中程序或在启动时下载浮动版本。

runtime 卷挂载在 `/var/lib/monkeyai`，实际传入 `--state-dir /var/lib/monkeyai/state`。现有 runtime 在 state-dir 的父目录创建维护锁，所以父目录也必须位于可写持久卷内；不能直接把只读 `/var/lib` 当作维护锁目录。项目与用户目录分别为 `/workspace`、`/home/monkey`。

托管规格必须使用 `public-only`，并确保固定 DNS、后台 HTTPS、中转 WSS 和所需服务可达。后台位于私网时由管理员配置固定服务例外；不自动放宽私网规则。`isolated` 保留给本地容器执行，不可用于客户端云电脑登录。

## 启动流程

1. 后台冻结 `runtime.server/server_id/user_id` 到规范化实例规格；宿主必须报告 `runtime_protocol=1` 才能承载该规格。
2. engine 创建并启动受限容器，在同一实例内调用固定 runtime 的 `status`。仅解析公开 machine ID、公钥和账号状态，不读取私钥文件。
3. 首次初始化或凭据不可用时，运行 `login --device-code --state-dir … --server … --server-id … --user …`；收到 authorize 事件后再次调用 status 取公开身份。
4. 设备申请通过既有签名 exchange 的 runtime 数组提交，绑定宿主、环境、实例、代次、公钥及用户操作。后台只批准现有固定 scopes，拒绝身份变化、旧实例、已停用用户、已撤销设备和已结束操作。首次绑定必须有设备申请；之后允许复用同一持久身份。
5. runtime 自行轮询、保存凭据。engine 核对登录后的账号与身份，再使用固定 exec ID 启动 `serve --state-dir … --engine-bin …`。进程由 containerd 管理，stdio 使用 NullIO，engine 重启不终止它。
6. engine 仅认领仍运行的 serve，不自动重新执行已退出进程。观察阶段不重新登录。启动失败锁定本代次，用户需要停止清理后显式启动新实例。

登录和 status 的输出只进入有界内存，设备码不写入控制日志或用户界面。状态查询最长 15 秒，登录最长 11 分钟，整个编排最长 12 分钟。临时 exec 完成或取消后回收；退出不能确认时报告失败。

## 连接与授权

容器 running 不表示可连接。列表和详情返回 machine_id、runtime_ready、connectable、stale；只有当前代次观察新鲜、容器运行、持久身份属于本实例、设备证明有效且中转控制／数据双通道在线时才可连接。托管创建操作在该连接条件满足后才完成。客户端沿用既有 endpoint connection ticket，不新增另一套连接协议。

普通停止立即禁止新的设备绑定、执行访问和连接签发，关闭中转并撤销连接票据，保留 runtime 授权族与整个状态卷。暂时不可执行返回可重试的授权状态错误，不向 runtime 发送永久撤销信号。重启分配新实例，复核相同身份后恢复；旧实例的迟到报告不能恢复授权。

删除在控制事务内撤销与该 machine 关联的 runtime 授权族和 token，再通知中转与执行密钥治理。显式撤销设备不自动恢复。用户停用、宿主撤销和执行失败同样禁止访问；失联隔离、跨宿主恢复及租约 fencing 仍属于后续运维能力。

## 发布与验收

依次部署迁移 000035～000038、后端、支持 runtime_protocol=1 的 engine 和兼容镜像，最后接入客户端。旧 engine 不承载托管规格；不更改旧实例的启动入口。新 API 在未启用远程执行中转时拒绝创建云电脑。

本轮自动测试覆盖授权身份、代次及宿主隔离、权限集合、重复申请、停止保留／删除撤销、签名同步等待、设备码不落盘和中转就绪判断。真实 Linux 上的完整登录、命令、终端、文件、停止重启、锁冲突与故障恢复仍待统一人工验收，`workload_verified` 保持 false。
