# Docker 镜像缓存

engine 通过本地 Docker API 拉取固定摘要镜像，原生架构匹配，禁止镜像 VOLUME 声明额外匿名卷。镜像数据位置使用 Docker 报告的 `DockerRootDir`，不扫描或删除其中的宿主文件。

缓存策略仍读取 `/etc/monkeyai-engine/cache.json`，默认预算 64 GiB、最小剩余 8 GiB、100000 个 inode。冷拉取前额外保留 25 GiB 和 1100000 个 inode；准备完成后检查镜像报告大小不超过 16 GiB。Docker 负责拉取和解包，不再对解包流做逐层扫描，因此预算是准入检查，不是硬磁盘配额；仍需管理员维护宿主空间。

engine 在私有控制目录保存拉取归属与最近使用时间，仅将本次由 engine 首次拉取的镜像标为可回收。已有共享镜像不会被接管。预算按受管镜像报告大小保守求和，文件系统实际空闲空间另行核对。

回收按最近使用时间排序；Docker 中任何容器或尚未完成清理的本地环境引用都会保护镜像。删除前重新检查引用，调用 Docker 非 force 删除指定摘要，不删除其他标签、不执行全局 prune。Docker 并发冲突或无法释放足够空间时明确失败。项目、用户目录和 runtime 状态不属于镜像缓存。

```sh
sudo /opt/monkeyai-engine/current/bin/monkeyai-engine cache inspect
sudo /opt/monkeyai-engine/current/bin/monkeyai-engine cache prune
```

旧专用 containerd 的缓存不会由新驱动清理。切换后确认旧实例已清理，再由管理员单独处理旧缓存。
