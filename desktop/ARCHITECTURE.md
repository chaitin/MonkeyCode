# desktop 架构

> 本文是边界与契约的权威定义。新功能动手前先在这里找"该放哪";
> 需要打破契约时先改本文再改代码。

## 总览

```
┌───────────────────────────────────────────────┐
│  ui/  (React SPA,构建产物 uidist/ 随壳分发)    │
│  只经 Tauri IPC 与壳对话:invoke 上行 + 事件下行 │
└──────────────────────┬────────────────────────┘
                       │ Tauri IPC
┌──────────────────────▼────────────────────────┐
│  src/  (Rust 壳)                               │
│  main.rs     宿主:窗口/托盘/桌宠/更新/生命周期  │
│  config.rs   配置权威事务 + 引擎配置单向派生     │
│  driver/     引擎驱动层                        │
│    frame.rs    Frame 词汇唯一定义(契约 1)      │
│    mod.rs      DriverHost + Caps + 命令层守卫   │
│    ohmy.rs     ohmyagent 适配(stdio JSON-RPC)  │
│  browser/    浏览器扩展桥 + MCP server          │
│  repo.rs uploads.rs  壳原生服务(文件/上传)     │
│  baizhi/     平台服务(百智云/云端)             │
└──────┬──────────────────────┬─────────────────┘
       │ spawn + stdio JSON-RPC │ MCP streamable-http(loopback)
┌──────▼────────┐       ┌──────▲────────┐      ┌─────────────┐
│ ohmyagent      │──────▶│ 壳内 MCP      │      │ 浏览器扩展   │
│ (上游依赖,     │ 工具调用│ (browser_*)   │◀────▶│ (MV3,WS /ext)│
│  零改动接入)   │       └───────────────┘ CDP  └─────────────┘
└────────────────┘
```

职责铁律:
- **UI 不建立任何网络连接**,不知道查询由谁执行。
- **driver 只做协议翻译**,不做策略;产帧必须经 frame.rs 构造器。
- **壳原生服务(repo/uploads/baizhi/browser)与引擎解耦**;引擎经 MCP
  消费浏览器工具,不感知桥的存在。
- **引擎是可替换子进程**:ohmyagent 是不 fork 的上游,版本经仓库根
  agent/ submodule 的 gitlink 钉死;壳按 system/ready 的 capabilities 做版本握手,
  能力缺口自动回退(如 switch RPC → destroy+resume)。

## 契约 1:帧词汇(Frame)

下行流的唯一词汇,两方对表:

| 角色 | 位置 |
|---|---|
| 产帧(壳,引擎事件归一化) | src/driver/frame.rs(唯一入口,禁手拼 JSON) |
| 消费(UI) | ui/src/types.ts + reduce.ts |

帧结构 `{type, kind?, data?(base64 JSON), timestamp(ms), seq}`。
类型:`task-started/ended/error`、`user-input`、`permission-req/resolved`、
`reply-question`、`task-running`(kind=`acp_event` 载 sessionUpdate;
kind=`acp_ask_user_question` 载提问卡)。
sessionUpdate:`agent_message_chunk/agent_thought_chunk/tool_call/
tool_call_update(含 progress 子代理 feed 与 failed 终态)/plan/usage_update/
llm_call_retry/compact_status/model_update/permission_mode_update`。

改词汇的顺序:frame.rs 与 types.ts 同一 PR 内同步,
reduce.test.ts 补对应归约断言。

**折叠是等价变换**(driver/fold.rs):journal 是「一 token 一帧」,回放前把
相邻同类流式碎片合并回一帧(usage/plan 每轮只留最后一条,其余原样)。
规则只增不改词汇。等价性由两侧守:Rust 钉住"折叠输出 == fixtures/replay/
folded.jsonl",TS 钉住 `reduceBatch(raw) ≡ reduceBatch(folded)`
(ui/src/foldEquivalence.test.ts)。素材换了跑
`cargo test regenerate_fold_fixture -- --ignored` 重生成。云端管道帧(ping/cursor/call-response)
是传输层词汇,不属对话流(遗留:归属待正式定义,见审计清单)。

## 契约 2:能力模型(Caps)

`driver/mod.rs::Caps` 是 UI 看到的能力投影，不是手写真值表：引擎能力
(`usage_update/perm_remember`)来自 `system/ready.capabilities`，壳能力
(`browser_ext/attachments`)来自对应运行时模块/壳实现。不得按版本号猜测。

- **强制点唯一在命令层**;driver 实现内不得再各自硬编码能力错误。
- UI 经 `engine_caps` 读取降级(caps 未加载时按"不支持"渲染,不闪现)。

## 契约 3:IPC 规约

- 命令命名 `domain_verb`(session_open/baizhi_login/browser_status…);
  新命令三处同步登记:main.rs invoke_handler、build.rs、tauri.conf.json capability。
  `scripts/check_command_contract.py` 在 CI 同时核对这三处与 UI 字面量 invoke。
- 事件命名 `channel:{id}`:`frames:{sid}`、`conn-status:{sid}`、
  `ws-msg:{pipe}`、`ws-closed:{pipe}`。全局事件(无 id 后缀)共 6 个:
  `session-event`、`engine-crashed`、`open-settings`、`open-session`、
  `browser-mcp-reloaded`(配对后引擎已带新工具集,UI 整页刷新)、
  `browser-mcp-refresh-timeout`(等任务空闲超时放弃,UI 提示手动重启;
  见 main.rs `BROWSER_MCP_REFRESH_DEADLINE`)。UI 侧清单同在 ui/src/ipc.ts。
- `session_open` 返回**尾部回放窗口** `{frames, cursor, has_more}`——历史走
  返回值不走事件(返回值天生有序);更早的按 cursor 走 `session_history`
  (形状对齐云端 `mc_task_rounds`),`session_outline` 给全量提问目录,
  `session_frame` 按 seq 回读被截断的工具大字段原文。
  引擎 resume 不再挡在打开路径上(后台做,conn-status 通知);上行命令经
  `ensure_engine_ready` 等待而非报错。
- **监听先于命令**:壳会在命令处理中同步 emit(回放、管道首帧),
  Tauri 事件不排队,监听未注册即丢。UI 侧必须 `await listenAsync(...)`
  完成后再 invoke;需要壳生成 id 的场景改为 UI 生成 id 先注册。
- 高频帧壳侧 ~30ms 批量后 emit;UI 侧 rAF 批量归约。
- `Conn.send` 语义:resolve(false)=发送失败,调用方保留输入供重试。

## 契约 4:配置所有权

`DesktopConfig`(config.json)是唯一权威;引擎配置是它的**单向物化**,
在引擎(重)启时重写:`app_config_dir/ohmyagent/{settings,mcp}.json`
(经 OHMYAGENT_CONFIG_DIR 注入引擎,桌面版私有目录,不碰用户全局
~/.ohmyagent;扩展完成配对后 mcp.json 才注入 mc-browser 内置条目,
URL/Bearer 进程级新发;首次配对/重置配对在所有前台/后台任务空闲后
自动重启 Agent 刷新工具集)。壳自有偏好(桌宠)走原子 read-modify-write,
只写权威、不触发物化。

所有权威配置事务经 `ConfigStore` 串行：0600 同目录临时文件、fsync、
原子替换，并保留上一份可解析配置为 `config.json.bak`。主文件损坏时只可
从有效备份恢复且保留 `.corrupt-*` 诊断副本；无有效备份必须外显错误，
禁止退成默认值后覆盖用户模型/API Key。启动只物化派生文件，不回写权威。

数据归属:

| 数据 | 权威 |
|---|---|
| 引擎模型上下文 | app_config_dir/ohmyagent/sessions/<engine_id>/messages.jsonl |
| 会话索引/标题/归档/**帧日志**/engine_id 别名 | 壳 sidecar:app_config_dir/ohmy-sessions/<sid>/ |
| 回放物化(一行一轮的折叠帧 + events 偏移) | 同上 replay.jsonl(打开只读尾部窗口,见 fold.rs) |
| 子代理子会话(有流式事件时物化,仅回放) | 同上(sidecar 带 parent);显式后台纯文本任务可能仅有完成通知 |
| 附件 | <workdir>/.monkeycode/uploads(会话工作区内,模型经相对路径可读;旧目录约定的附件按消息内路径回读) |
| 百智云/云端凭证 | app_config_dir/*-cookies.json(双罐,互不牵连) |
| 浏览器扩展配对凭据 | app_config_dir/ext-auth.json |

历史妥协已退出:上游 OHMYAGENT_CONFIG_DIR(969311a)落地后配置随
app_config_dir 走,首启自动迁移旧接管目录的 sessions。
(当年**不可**用覆盖 HOME 隔离的原因仍成立:bash 工具会把错误 HOME
泄给用户命令——env 注入是正解。)

引擎 id 与壳 sid 解耦:壳 sid 是目录/UI 通道的稳定标识;engine_id 是
可替换属性(空会话无法 resume 时 destroy+全新 create 换绑),出站 RPC
映射、入站 shell_sid_of 反查、sidecar 持久化。
`events.jsonl` 从"审计"升格为**大字段全文的权威回读源**:物化时超 4KB 的
工具字段只留头部 + `_meta.mcSrc`,展开卡片经 `session_frame` 按 seq 取原文
(所以不建 blobs/,也所以保留策略不能随手砍——砍了就只剩截断头部)。

sidecar 更新是串行 read-modify-write，并与配置共用跨平台原子替换；
Windows 不得用不能覆盖既有目标的裸 `std::fs::rename`。

## 契约 5:会话状态机

状态词汇(Rust `frame::SessionStatus` ↔ TS `types.SessionStatus`):
`created → running → finished | interrupted | error`
- `created` = 新建未运行,**不是 finished**(否则侧栏/桌宠按完成渲染)。
- `interrupted` = 用户取消,**不是完成**(桌宠不庆祝、侧栏不打勾)。
- `waiting_ask` 是运行时叠加位(有待答复的审批/提问),不落盘。
- 轮次帧序(驱动本地先行,不依赖引擎事件时序):
  `user-input → task-started → …engine 事件… → [task-error] → task-ended`。
- 轮末(`task-ended`,含出错与本地和解两条路径)是**回放物化点**:该轮折叠成
  replay.jsonl 的一行,并记下此刻 events.jsonl 的长度供下次打开续读。
- **和解原则:引擎应答是确认,不是前提。** 引擎停止/崩溃/取消无应答时,
  驱动本地补收尾(未闭合工具 failed 帧 → task-error → task-ended,
  状态落 interrupted,挂起审批/提问一并失效);引擎迟到的 turn/stopped
  被 running 幂等守卫吞掉。没有这条,会话会永久卡"执行中"。

## 浏览器扩展桥(browser/)

壳原生服务(移植自旧 Go 内核,git 历史 e8666a8 前可查)。
扩展side 契约对表 browser-extension/src/protocol.ts,
**扩展零改动**:`ws://127.0.0.1:{7440-7449}/ext`、hello/token/一次性配对码、
Op/Ev/错误码、proto:1、20s ping。

- 9 个 browser_* 工具经壳内 MCP streamable-http server 暴露给引擎
  (Bearer 鉴权;手写最小面:POST json 应答/通知 202/GET 405)。
- **会话隔离并发**:每条 MCP transport 经 `initialize` 取得独立
  `Mcp-Session-Id`；Agent 的 `tools/call._meta` 再携带实际 `session_id` 与
  `work_dir`。两级 key 为父任务和共享 transport 的子 Agent 分配独立
  `BrowserSession`。同一现场串行保护 current tab/ref，不同现场可并行。
  `tabId → owner` 路由保证事件只投给所属任务；普通选择不能抢占其他任务的
  tab，只有用户显式 handoff 才转交。截图按 `work_dir` 精确落盘；旧 Agent
  缺少元数据时回退唯一活跃 workspace，无法确定只跳过本地副本、不拒绝
  操作，图片仍作为 MCP image 返回模型。
- 错误码→中文可行动文案是产品契约(模型行为依赖),改动需过 e2e 断言。

## 引擎监督

壳监视引擎进程(stdout EOF);非 stop() 引发的退出 → 本地和解运行中
会话(契约 5)→ 全局事件 `engine-crashed {engine, detail, log_tail}`
→ UI 横幅 + `engine_restart` 一键重启。引擎日志:app_config_dir/ohmyagent.log。
`DriverHost` 用 lease/维护闸门排空已进入的 IPC 命令并封住新命令，再做
stop/start；浏览器配对这类自动维护额外要求前台会话与后台 Agent 都为空闲。

## 已知上游缺口(ohmyagent)

协议缺口与对应的壳侧变通,上游补齐后应删壳侧实现:stdio 会话索引
(现 sidecar 权威)、空会话 resume 不容忍(壳 engine_id 换绑)。旧引擎兼容
尾巴仍按 ready cap 门控:
无 permissionRemember 时壳侧记忆、无 structuredToolResult 时错误前缀回退。
已补齐(近期):每模型独立凭据(e792858 扁平 per-model schema,
按别名作键,壳一一对应物化,槽位冲突逻辑消亡;壳一律传别名选模型,
防同 wire id 多网关撞 wireIndex)、会话交互性声明(8afc338,
壳 session/create 带 interactive:true,引擎给持久 Task 工具族)。
已补齐:OHMYAGENT_CONFIG_DIR、子代理权限实时继承、上下文用量
(event/stream usage 轮中更新 + turn/stopped 扁平轮后快照)、附件(提示词图片路径内联)、MCP image 结果
直达模型(c1d8482)、工具错误发 tool_result(b02fc77,含 deferred
直调自动提升)、子代理事件带 parent_session_id/parent_tool_call_id
(dab1b85,壳精确认领)。固定引擎已删除“同步 Agent 超时后自动转后台”，
后台执行必须由 `run_in_background:true` 显式声明。

## 开发与构建产物

uidist/ 是纯生成物不入库;壳静态页与 webfonts 在 ui/public/。
引擎 sidecar 来自独立 ohmyagent 仓库:本地打包缺省用仓库根
agent/ submodule(`export OHMYAGENT_SRC=...` 可覆盖),CI 同源。
externalBin 只能落在打包 overlay(`bundle.{macos,windows,win7,linux}.conf.json`):
tauri_build 在编译期就为宿主 triple 解析 sidecar,基础配置一带上,每个
开发者的 `cargo check` 都要先编出 `binaries/ohmyagent-<host-triple>`。
同理**不能**用 `tauri.<平台>.conf.json` 这个名字——它是 Tauri 的平台自动
合并约定(tauri-utils/src/config/parse.rs),存在即生效、不需要 --config,
等于把打包配置塞进了该平台的基础配置。打包配置只经 --config 显式传入。
"任何打包入口都带引擎"这条不变量因此由 `scripts/check_bundle_configs.py`
强制(Makefile 打包前置 + CI),不存在"包里没引擎"的静默。

```bash
cd ui && npm run build      # 生成 uidist(cargo build 的前置)
npx tauri dev --config tauri.dev.conf.json   # HMR 开发
cargo test                  # hermetic 单测；不会从 PATH 猜 ohmyagent
                            # E2E 标 #[ignore]，此处如实报 ignored（缺引擎时
                            # 静默 return 报 "ok" 会让绿灯失去意义）
MC_OHMYAGENT_BIN=/绝对路径/ohmyagent cargo test e2e_ -- --ignored --test-threads=1
                            # 固定引擎 + 假 LLM E2E；缺二进制即硬失败
```
