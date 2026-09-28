# MonkeyCode 内网 SSRF 修复情况报告

> **PR**：https://github.com/chaitin/MonkeyCode/pull/899
> **Commit**：https://github.com/chaitin/MonkeyCode/commit/b70e9379

---

## 一、漏洞说明

MonkeyCode 多个接口接收用户传入的 URL 参数后，直接由服务端发起 HTTP 请求，期间未对目标地址做内网校验。攻击者可利用此缺陷构造以下攻击：

| 攻击类型 | 示例 | 危害 |
|---------|------|------|
| 内网服务探测 | `http://10.0.0.1:3306`、`http://192.168.1.1:6379` | 探测内网 MySQL、Redis 等服务，获取内网资产拓扑 |
| 云元数据窃取 | `http://169.254.169.254/latest/meta-data/` | 读取云环境 IAM 凭据、实例信息等敏感数据 |
| 本地文件读取 | `file:///etc/passwd` | 读取服务器配置文件、密钥等 |
| IP 表示绕过 | `http://2130706433`（即 127.0.0.1 的整数表示） | 绕过基于字符串匹配的防御 |

受影响接口覆盖所有用户可控 URL 的出站场景，包括：模型配置（Create/Update）、模型列表获取（GetProviderModelList）、健康检查（CheckByConfig）、MCP 上游连接、LLM 代理转发、Git 身份提供商配置、通知 webhook、OAuth/OIDC 登录回调、任务附件下载等。

---

## 二、修复方案

本次修复新增 `pkg/netguard` 通用内网防护组件，在所有用户可控 URL 的出站路径上实施多层次拦截。

**拦截机制——三层防御：**

| 层级 | 机制 | 说明 |
|------|------|------|
| 入口校验 | `ValidateURL()` | 在业务逻辑入口处显式调用，请求发起前即阻断非法 URL |
| HTTP 客户端包装 | `HTTPClient()` | 包装 `http.Client`，自动对所有出站请求的目标地址做校验 |
| 传输层拦截 | dial 阶段校验 | 在 TCP 连接建立阶段拦截，即使 HTTP 客户端未经包装也能兜底 |

**拦截范围：**

- loopback 地址：`127.0.0.0/8`、`::1`、`localhost`
- 私有地址：`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`
- 链路本地：`169.254.0.0/16`、`fe80::/10`
- 组播/广播：`224.0.0.0/4`、`ff00::/8`
- RFC6890 保留地址：`0.0.0.0/8`、`100.64.0.0/10`、`198.18.0.0/15`、`240.0.0.0/4`、`fec0::/10`
- 非规范 IPv4 表示：整数形式（`2130706433`）、十六进制（`0x7f000001`）、八进制（`0177.0.0.01`）
- 仅允许 `http` 和 `https` 协议，拦截 `file://`、`gopher://`、`dict://` 等危险协议

**核心改动文件：**

| 文件 | 说明 |
|------|------|
| `pkg/netguard/guard.go`（新增） | 内网地址校验、HTTP 客户端包装、传输层拦截 |
| `pkg/netguard/guard_test.go`（新增） | 单元测试，覆盖各类内网地址及绕过手法 |
| `biz/setting/usecase/model.go` | 模型 Create、Update、GetProviderModelList、CheckByConfig 增加入口校验 |
| `biz/setting/usecase/model_ssrf_test.go`（新增） | 模型场景回归测试 |
| `biz/llmproxy/proxy.go` | LLM 代理转发增加传输层拦截 |
| `biz/notify/dispatcher/dispatcher.go` | 通知分发增加传输层拦截 |
| `config/config.go` | 新增 `Security.BlockPrivateNetwork` 配置项 |

本次修复共涉及 39 个文件，+809 行 / -371 行，覆盖模型配置、LLM 代理、MCP 上游、Git 集成、通知渠道、OAuth 登录等全部用户可控 URL 的出站场景。该问题已修复。
