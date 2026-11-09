# Docker 环境网络

engine 使用 Docker Engine 的用户自定义 bridge 网络，每个环境实例独占一个网络。Docker 自动选择可用网段、配置 IPv4 转发与 NAT。engine 自动读取宿主的非回环 IPv4 DNS，将解析配置只读挂载到 gVisor 环境，缺失时使用 1.1.1.1 和 8.8.8.8；无需配置 `network.json`、CNI 或手工填写 DNS。Docker 默认地址池耗尽、与现有路由冲突或宿主防火墙拦截时会明确失败，不改写其他业务网络。

`isolated` 使用 Docker `none` 网络；`public-only` 使用独立 bridge、禁用 IPv6 和网络内互通，由 engine 在启动容器前建立专用 nftables 规则：

- 允许公网 TCP 22、80、443；DNS 仅允许访问创建网络时选定的解析服务器（TCP／UDP 53）。
- 拒绝宿主入站、宿主主动访问容器、其他环境、私有与保留网段、链路本地、云元数据地址。
- 自动选择的解析服务器可能是内网 DNS；解析结果不绕过 IP 访问限制。不承诺阻止 DNS 隧道或通过允许的 HTTPS 服务转发流量。
- 不自动添加内网服务例外。后台若仅能通过私网或宿主本地地址访问，需要单独设计受控访问路径。

网络、容器与防火墙均核对 engine 标签、实例规格摘要和网络 ID。未知同名对象拒绝接管；删除只清理本实例对象，不执行 Docker 全局 prune 或防火墙 flush。每次启动和周期检查重新核对网络并原子刷新规则；无法确认网络隔离时停止容器并报告失败。管理员主动清空规则时仍存在周期检查窗口，应先停止对应环境。

宿主预检检查 Docker API、cgroup v2 限制、专用 `monkeyai-runsc` runtime、IPv4 转发及 nftables 查询。通过才报告 `public-only`；真实互联网可达性仍取决于宿主路由、防火墙、DNS 与远端服务。

已有 containerd/CNI 网络不自动迁移或接管。切换前用旧 engine 删除运行实例并确认清理，持久目录保留；旧 `network.json` 不再被 Docker 驱动读取。

宿主 DNS 若返回代理 fake-IP（例如 198.18.0.0/15）或私网地址，public-only 会拒绝访问该结果；应在宿主配置返回真实公网地址的 DNS。网络数量受 Docker 默认地址池限制，较大规模需由宿主管理员配置合适的 default-address-pools。
