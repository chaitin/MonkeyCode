# 后端日志实施验收记录

日期：2026-10-20。对应[设计方案](../../design/error-logging-optimization-plan.md)与[运行日志说明](logging.md)。本记录描述本地实现和测试，不代表镜像已发布或已部署。

## 实现结果

- 公共安全 Handler、错误链分类、原始源码位置、根 logger 注入与共享动态阈值。
- 完整应用请求 ID、HTTP 完成统计、安全 panic 恢复、精确 ResponseWriter 能力转发和审计 ID 复用。
- 资源及相关响应接口显式接受 context，主诊断归属先于级别过滤和去重；独立补偿、审计和结算保留。
- 模型、SSE、relay、上传与导入、readiness、计费、媒体、MCP 及清理 worker 的关联和事件边界；业务结果与用量确定性分开观察。
- 明确登记的事件策略、有界指纹、固定窗口、定时摘要、有限样本、恢复前刷新、关闭幂等及迟到事件直出。
- 日志／HTTP／业务调用统计、容量和输出错误计数；实际依赖检查的恢复事件。
- 默认入口读取日志构造配置并在业务退出后关闭 Runtime；嵌入入口不覆盖调用方 logger。
- Compose 日志参数及日志轮转，Nginx 受控 JSON、敏感路径禁日志、HTTP 错误日志隔离。

## 已执行验证

| 验证 | 结果与边界 |
| --- | --- |
| 专用 PostgreSQL / RustFS 全量集成 | 普通完整回归 1404 项通过；共享能力的嵌入式入口验证中，完整 `-race` 回归 38 个测试包、1411 项通过；最终同步后的开源工作树完整 `-race` 回归 1422 项通过。两轮各有 8 项因专项环境跳过 |
| 专项 Nginx | `TestNginxSafeLogging`、`TestNginxRelay`、`TestNginxPreviewTLS`、`TestNginxUpgrade` 均通过 |
| 实际展开配置 | `nginx -T` 验证 64 MiB 分块、2064 MiB 传统导入、无请求缓冲、长超时及 Upgrade 配置保留 |
| Nginx 日志安全 | 普通路由本地 ID、OAuth 查询参数、路径 grant、未知路径、过大 Header 提前拒绝、上游断开；access/error 均未出现测试秘密 |
| 浏览器预览 | 使用 ego-browser / Chromium 运行 `TestBrowserPreviewSandbox`；localStorage、Cookie、IndexedDB、Service Worker 均为 blocked |
| 竞态与安全单元 | logging/config/server、资源、HTTP、模型、relay、上传、计费、媒体、MCP、认证及 app 定向 `-race` 通过；后续新增分类／生命周期检查已复跑 |
| 生命周期 | 并发提交和 Close、重复 Close、关闭后迟到事件、所有事件计数一致、调度器和指纹容量有界 |
| 故障 | DNS、TLS、拒绝／重置连接、数据库 SQLSTATE、包装 URL、取消、超时、输出失败、容量溢出、恢复前摘要刷新 |
| 网关 | 无 billing/recorder 的非 2xx、SSE 错误、缺终止事件、已知用量下的业务失败均记录一次完成事件且不改变转发内容 |
| 静态与目标编译 | `go vet ./...`、gofmt、diff 检查和 Linux/amd64 无 CGO 编译通过 |

提交 PR 前已同步 `a1cccb86` 主线，再次使用隔离 PostgreSQL / RustFS 执行完整竞态回归：1442 项通过、8 项跳过。随后将未提交响应的 panic 恢复补为通用 JSON 错误，并补充格式断言；logging/httpapi/app/audit 的定向竞态回归通过。

完整后端竞态回归中跳过的 8 项里，5 项已通过上述 Nginx／浏览器专项补验。其余为已有的 `TestPublishedReleaseZIP`、`TestPublishedReleaseFixture`（没有提供实际发布资源包）以及 `TestBrowserDeviceConsent`（设备确认 UI 专项）；它们不作为本轮日志验收通过的证据。

测试基础设施是本次新建的隔离 PostgreSQL 18.6 和 RustFS，不使用生产数据库。大量 schema 迁移并行运行时，默认 PostgreSQL 锁容量不足；隔离实例提高 `max_locks_per_transaction` 后重新执行通过。协议测试使用临时 root 测试镜像兼容已有夹具；Nginx 日志安全还单独在实际 nginx 用户与只读根文件系统下验证。

## 性能

Apple M1 Pro、darwin/arm64、Go 1.27，`go test ./logging -run '^$' -bench . -benchmem -benchtime=300ms -count=1`：

| 场景 | ns/op | B/op | allocs/op |
| --- | ---: | ---: | ---: |
| 裸 slog JSON 基线 | 588 | 0 | 0 |
| 安全日志，去重关闭，并发 | 1741 | 2024 | 18 |
| 安全日志，单热点并发去重 | 2857 | 2822 | 39 |
| 单热点，顺序提交 | 2594 | 2129 | 32 |
| 4096 指纹分布 | 3554 | 2239 | 33 |
| 5000 指纹、容量溢出 | 10189 | 2657 | 37 |
| HTTP 10 次 SSE 写入与 flush | 3675 | 8042 | 43 |

安全日志包含分类、属性清理、源码和关联等工作，裸 slog 基线没有这些工作；开启去重还增加指纹和计数成本。因此不能据此声称单条事件更快。重复错误的收益是减少序列化与输出数量；真实 stdout 阻塞、日志采集器和多副本表现还取决于部署环境。SSE 基准包含 httptest 请求／响应对象分配，不是端到端网络延迟。此处是短基准及有界状态验证，不冒充长期生产压力测试。

## 复核

```sh
cd monkeyai/backend
go test ./... -count=1
go test -race ./... -count=1
go vet ./...
go test ./logging -run '^$' -bench . -benchmem
```

完整集成需专用 `MONKEYAI_TEST_DATABASE_URL` 和 `MONKEYAI_S3_*`。Nginx 专项需 `MONKEYAI_TEST_NGINX_IMAGE`、Docker，以及镜像架构匹配；`TestNginxSafeLogging` 使用包含实际 ACME 模块与 entrypoint 的管理镜像。已有协议夹具会复制 0600 配置及测试证书，需使用允许读取这些文件的专用测试镜像。浏览器专项通过 `MONKEYAI_BROWSER_PREVIEW_DIR` 的 ready/result 协议驱动。

强杀、崩溃及输出目标失败仍可能丢失日志；没有跨实例去重、强一致审计或自动发布承诺。业务证据继续以审计、交易及任务的原持久化记录为准。
