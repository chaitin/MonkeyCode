# 宿主公网出站网络

执行层支持 `isolated` 和 `public-only`。默认使用 isolated：独立 network namespace，runsc `network=none`。公网策略使用每实例独立的 namespace、CNI ptp／host-local 和 nftables；runsc 使用 sandbox 网络，不共享宿主网络或环境间二层网络。不支持容器内 Docker／Compose。

## 启用

先按安装说明准备专用宿主，升级到包含 CNI ptp 的完整 engine 发行版本。安装器不自动启用公网，也不修改全局 IP 转发或现有防火墙。

管理员选择与全部宿主路由不冲突的 RFC1918 IPv4 /16～/24 地址池，参考 [配置示例](examples/network.json) 在 `/etc/monkeyai-engine/network.json` 创建 root 所有的普通文件，权限 0600。配置不是后台用户可提交的内容，不接受任意 CNI、nft 或宿主命令参数。

```bash
sudo install -o root -g root -m 0600 network.json /etc/monkeyai-engine/network.json
sudo sysctl -w net.ipv4.ip_forward=1
sudo /opt/monkeyai-engine/current/bin/monkeyai-engine doctor \
  --architecture amd64 --data-dir /var/lib/monkeyai-engine/data \
  --cni-dir /opt/monkeyai-engine/current/cni
```

按发行版方式持久化转发设置，并核对现有防火墙允许需要的转发。engine 不改写其他服务的规则；其他 nftables／iptables 链仍能拒绝转发。公网能力预检仅做只读检查，不代表真实工作负载验收。未配置、地址池冲突、工具不可用或转发关闭时，心跳只报告 isolated，原有隔离模式不因此失败。

后台每次创建或重新启动 public-only 环境，均要求宿主最新签名心跳报告 `network_policies` 包含 public-only。旧版 engine 缺少该字段时只能承载 isolated；管理员仍须启用宿主调度并配置容量。

## 访问边界

- 仅 IPv4；入站 veth 的非 IPv4／受控网关 ARP 以外报文拒绝，并核对源 IPv4，防止伪造源地址。
- 默认拒绝私网、共享地址空间、回环、链路本地、组播、保留网段与云元数据地址。所有宿主本地地址、广播地址及非 engine 的非默认路由也受保护。地址池与既有非 engine 路由相交时拒绝启动。
- DNS 仅允许配置中 1～3 个固定公网 IPv4 的 TCP／UDP 53；其他目的的 53 和所有 853 拒绝。每实例只读绑定固定 resolv.conf，不继承宿主解析器或搜索域。
- 普通公网流量仅放行 `public_tcp_ports`，默认示例是 22／80／443；其他 UDP、ICMP、TCP 端口拒绝。只允许已建立连接的返回流量，宿主不能主动连接实例，环境间默认不互通。
- `services` 可显式放行固定 IPv4 和 TCP 端口，例如 `{"address":"10.20.0.10","ports":[443]}`。这是管理员对内部服务的明确授权；硬拒绝地址、宿主本地地址和 `deny_cidrs` 优先，服务例外不能覆盖。端口不允许 0／53／853。
- `deny_cidrs` 是额外 IPv4 拒绝列表。企业 VPN 的宽路由会被保守视为受保护目的，可能限制部分公网访问，需管理员核对路由规划。

以上是 IP／端口策略，无法识别允许的 HTTPS／SSH 上承载的 DoH、代理或隧道。不得据此声称阻止了所有应用层转发。内部服务例外和可信代理应独立评估权限。

## 持久化与恢复

网络绑定保存在 `/var/lib/monkeyai-engine/control/network`，包含环境、实例、配置快照、namespace inode、连接及阶段。CNI 地址分配也落盘，跨进程锁避免并发分配。命名空间、veth alias 和防火墙表 comment 都用于核对归属，拒绝接管同名的未知资源。

创建先保存计划，再创建 namespace，记录 inode 后执行 CNI；CNI 中断在重试前先 DEL，再 ADD。防火墙生效及 DNS 文件落盘前不返回网络附件，用户程序启动前再次核对。规则以 nft 原子批次更新，停止确认并删除任务后才回收网络；网络清理失败不会报告实例已回收，也不删除持久目录。

配置快照对该实例不可变。修改或删除 network.json 只影响新实例；若要立即收紧已有实例，先停止并确认清理，再修改配置并显式重新启动。所有运行实例约每 30 秒检查网络，隔离条件无法核对时尝试 SIGKILL 并报告失败；停止／删除目标仍允许清理。宿主管理员修改路由、关闭转发或清空规则前应协调停机；周期检查不保证管理员主动清空规则时零窗口。

若进程在 namespace 创建成功、inode 写盘前崩溃，engine 无法证明归属，会保守拒绝认领和回收。保留现场，由管理员在停止对应实例后核对 netns、接口、CNI 分配及绑定记录；不要直接删日志冒充已清理。namespace 尚未创建的计划可自动回收。清理仅操作经核对的自有资源，不执行全局 flush／prune。

宿主整机重启后 namespace 消失时，已有实例不会静默重建或再次执行。先提交更高代次停止／删除完成清理，再显式创建新实例并复用持久卷。

## 验证

单元测试覆盖配置、规则优先级、CNI 结果归属、失败恢复、不可变快照与清理重试。Linux 实测测试只允许在有 `/monkeyai-network-test` 隔离标记的可销毁容器中，通过 `MONKEYAI_TEST_NETWORK=1` 启用；它会改变该测试容器的默认路由，不可直接在宿主执行。

独立 Linux ARM64 容器已验证 CNI v1.9.1／nftables 1.0.6 的创建、重复刷新、回收和模拟公网 TCP／UDP 策略，以及宿主入站、跨实例和源地址伪造拒绝。这不替代真实 gVisor、IPv6／ARP、资源和故障注入的统一人工验收。`workload_verified` 保持 false。
