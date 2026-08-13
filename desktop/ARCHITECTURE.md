# desktop 架构

> 本文是边界与契约的权威定义。新功能动手前先在这里找"该放哪";
> 需要打破契约时先改本文再改代码。

## 总览

```
┌───────────────────────────────────────────────┐
│ ui-next/ (React SPA,构建产物 uidist/ 随壳分发) │
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
│  wsl.rs      WSL 运行环境原语(路径翻译/prepare)│
│  telemetry.rs 装机/使用心跳(自建 Matomo)        │
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
- **壳原生服务(repo/uploads/baizhi/browser/telemetry)与引擎解耦**;
  引擎经 MCP 消费浏览器工具,不感知桥的存在。
- **引擎是可替换子进程**:ohmyagent 是不 fork 的上游,版本经仓库根
  agent/ submodule 的 gitlink 钉死;壳按 system/ready 的 capabilities 做版本握手,
  能力缺口自动回退(如 switch RPC → destroy+resume)。

## 契约 1:帧词汇(Frame)

下行流的唯一词汇,两方对表:

| 角色 | 位置 |
|---|---|
| 产帧(壳,引擎事件归一化) | src/driver/frame.rs(唯一入口,禁手拼 JSON) |
| 消费(UI) | ui-next/src/lib/protocol/{types,reduce}.ts(Frame/SessionStatus/PermOutcome/EngineStatus 由 ts-rs 自 frame.rs 生成到 ui/src/gen/ 并同步一份到 ui-next/src/gen/(genSync.test.ts 钉字节一致),types.ts 复用) |

帧结构 `{type, kind?, data?(内联 JSON), timestamp(ms), seq}`——data 的
base64 双重编码已去除,只剩存量 journal 与云端帧两条兼容边界;
`user-input.content` 仍是 base64 文本。
类型:`task-started/ended/error`、`user-input`、`permission-req/resolved`
(req 带可选 tool_call_id)、`reply-question`、`task-running`(kind=`acp_event`
载 sessionUpdate;kind=`acp_ask_user_question` 载提问卡)。
sessionUpdate:`agent_message_chunk/agent_thought_chunk/tool_call/
tool_call_update(completed 含 images;progress 载子代理 feed
subagent_tool/subagent_text/output/child_session;failed 终态)/plan/
usage_update/compact_status/task_notification(后台子代理完成通知)/
model_update/think_update(会话思考档变更)/permission_mode_update`。
`llm_call_retry` 仅云端流产出,壳不产,UI 归约兼容。

改词汇的顺序:frame.rs 是唯一权威(ts-rs 重新生成 ui/src/gen/,ui-next/src/gen/ 随之同步),与
types.ts/reduce.ts 同一 PR 内同步,reduce.test.ts 补对应归约断言。

**折叠是等价变换**(driver/fold.rs):journal 是「一 token 一帧」,回放前把
相邻同类流式碎片合并回一帧(usage/plan 每轮只留最后一条,其余原样)。
规则只增不改词汇。等价性由两侧守:Rust 钉住"折叠输出 == fixtures/replay/
folded.jsonl",TS 钉住 `reduceBatch(raw) ≡ reduceBatch(folded)`
(ui-next/src/lib/protocol/foldEquivalence.test.ts)。素材换了跑
`cargo test regenerate_fold_fixture -- --ignored` 重生成。云端管道帧(ping/cursor/call-response)
是传输层词汇,不属对话流(遗留:归属待正式定义,见审计清单)。

## 契约 2:能力模型(Caps)

`driver/mod.rs::Caps` 是 UI 看到的能力投影，不是手写真值表：引擎能力
(`usage_update` ← turn/stopped、`perm_remember` ← permissionRemember)来自
`system/ready.capabilities`，壳能力(`browser_ext/attachments`)来自对应
运行时模块/壳实现;`browser_ext` 另要求 WSL 网络为 mirrored(与 mcp.json
物化同判定)。不得按版本号猜测。

- **强制点唯一在命令层**;driver 实现内不得再各自硬编码能力错误。
- UI 经 `engine_caps` 读取降级(caps 未加载时按"不支持"渲染,不闪现)。

## 契约 3:IPC 规约

- 命令命名 `domain_verb`(session_open/baizhi_login/browser_status…);
  新命令三处同步登记:main.rs invoke_handler、build.rs、tauri.conf.json capability。
  `scripts/check_command_contract.py` 在 CI 同时核对这三处与 UI 字面量 invoke。
- 事件命名 `channel:{id}`:`frames:{sid}`、`conn-status:{sid}`、
  `ws-msg:{pipe}`、`ws-closed:{pipe}`。全局事件(无 id 后缀)共 6 个:
  `session-event`、`engine-status`(契约 6)、`open-settings`、`open-session`、
  `browser-mcp-reloaded`(配对后引擎已带新工具集,UI 整页刷新)、
  `browser-mcp-refresh-timeout`(等任务空闲超时放弃,UI 提示手动重启;
  见 main.rs `BROWSER_MCP_REFRESH_DEADLINE`)。UI 侧清单同在 ui-next/src/lib/ipc/。
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
- **会话 id 是目录名,不是普通标识符**:壳 sid、引擎返回的 session_id、
  子代理子循环 id 都会拼进 `<data_dir>/<id>/` 与 `<engine_dir>/sessions/<id>/`,
  终点是 `remove_dir_all` 与 `atomic_write_private`。因此一律经
  `session::valid_session_id` 判定为单段安全名(非空、限长、无分隔符/NUL/冒号、
  归一化后仍是同一段普通名)才允许拼路径——`data_dir.join("../../..")` 会被
  `remove_dir_all` 一路解析上去,实测可清空用户主目录。
  强制点有两处:`Inner::session_dir` / `Inner::engine_session_dir` 是**唯一**
  允许把 id 拼进根目录的构造器(拒绝即不构造,未校验的名字到不了文件系统);
  上行命令另在入口 `check_session_id` 快速失败,让用户看到原因而不是静默降级。
  **引擎不是信任边界**:它返回的 session_id / 换绑 engine_id 走同一套判定。

## 契约 4:配置所有权

`DesktopConfig`(config.json)是唯一权威;引擎配置是它的**单向物化**,
在引擎(重)启时重写:`app_config_dir/ohmyagent/{settings,mcp}.json`
(经 OHMYAGENT_CONFIG_DIR 注入引擎,桌面版私有目录,不碰用户全局
~/.ohmyagent;WSL 模式下引擎数据仍留宿主侧,该路径经 wslpath 翻成 guest
形态注入;扩展完成配对后 mcp.json 才注入 mc-browser 内置条目,URL/Bearer
进程级新发,WSL 下另要求 networking-mode=mirrored;首次配对/重置配对在
所有前台/后台任务空闲后自动重启 Agent 刷新工具集)。壳自有偏好(桌宠、
提示音)走原子 read-modify-write,只写权威、不触发物化——它们不在设置页
表单里,表单保存必须从磁盘合并这几个字段,否则被 serde 默认值打回。
提示音 `sound_enabled` 有设置页与托盘两个入口,壳持运行时真值并经
`sound-enabled` 事件广播,音效本身由桌宠页 pet.html 播放(桌宠隐藏后
webview 仍在跑,所以"关桌宠"不等于"静音",两个开关独立)。

模型物化按**别名**作键,每条恒写 8 键:`type/model/base_url/api_key/
context_window/supports_images/max_output/thinking`。桌面缺省显式压过
引擎兜底:context_window 200000(引擎 128000)、max_output 32768(引擎
16384)、thinking 未配置按 low(统一 `{enabled,effort}` 形,anthropic
budget_tokens legacy 已消亡);supports_images 恒显式写,vision 未勾选写
false(引擎侧生效缺口见上游清单)。`default_model` 一律传别名。

**技能(skills,src/skills.rs)**:引擎无任何技能协议入口,只在
session/create 时扫描磁盘(`$OHMYAGENT_CONFIG_DIR/skills/<name>/SKILL.md`
等),所以技能走**按会话物化**而非引擎重启物化:技能库(内置 = 仓库根 plugins/
submodule(MonkeyCodeOfficialPlugins)的 skills/,gitlink 钉版本、经
bundle.resources 目标名 "skills" 随更新分发,dev 回退同一 submodule 目录,
升级技能 = bump submodule;用户 = app_config_dir/skills/,skills_* 命令
即时读写,同名用户覆盖内置)是权威;
driver 在**每次**引擎 session/create 前(新建/resume/重建)把该会话启用
集整体重写到 `<engine_dir>/skills/`(纯派生,整删整建),"物化 + create"
经 Inner::skills_gate 串行成对。启用集快照落 sidecar `skills` 字段
(缺省 null = 缺省集:出厂规则「官方四件套 skills::DEFAULT_ENABLED +
全部用户技能」⊕ app_config_dir/skills-defaults.json 的「默认启用」显式
开关,解析单点在壳 skills::is_default_enabled,skills_list 以
default_enabled 字段下发,UI 不复刻规则;开关只影响新会话与无快照的
旧会话);中途改选择 = session_call `session_set_skills`
→ destroy+resume 重建让引擎 catalog 重扫(仅空闲,历史保留)。已知取舍:
引擎技能目录全局一份,并发会话选择不同时后创建者重写目录,先前会话
catalog 不变但被移走的技能正文加载会失败(引擎友好报错);按会话目录的
唯一出路是 cwd,会污染用户项目,不做。技能不进 config.json 事务(与
telemetry.json 同理);打包不变量由 check_bundle_configs.py 强制。

所有权威配置事务经 `ConfigStore` 串行：0600 同目录临时文件、fsync、
原子替换，并保留上一份可解析配置为 `config.json.bak`。主文件损坏时只可
从有效备份恢复且保留 `.corrupt-*` 诊断副本；无有效备份必须外显错误，
禁止退成默认值后覆盖用户模型/API Key。启动只物化派生文件，不回写权威。

数据归属:

| 数据 | 权威 |
|---|---|
| 引擎模型上下文 | app_config_dir/ohmyagent/sessions/<engine_id>/messages.jsonl |
| 会话索引/标题/摘要/归档/**帧日志**/engine_id 别名 | 壳 sidecar:app_config_dir/ohmy-sessions/<sid>/(摘要来自引擎 session_summary 事件,写入刻意不刷 updated_at,否则侧栏无端重排) |
| 回放物化(一行一轮的折叠帧 + events 偏移) | 同上 replay.jsonl(打开只读尾部窗口,见 fold.rs) |
| 子代理子会话(有流式事件时物化,仅回放) | 同上(sidecar 带 parent);显式后台纯文本任务可能仅有完成通知 |
| 附件 | <workdir>/.monkeycode/uploads(会话工作区内,模型经相对路径可读;旧目录约定的附件按消息内路径回读) |
| 用户技能库 | app_config_dir/skills/<name>/SKILL.md(内置技能在 bundle 资源,只读;<engine_dir>/skills/ 是按会话物化的派生物,勿手编) |
| 百智云/云端凭证 | app_config_dir/*-cookies.json(双罐,互不牵连) |
| 浏览器扩展配对凭据 | app_config_dir/ext-auth.json |
| 遥测游标/install_id | app_config_dir/telemetry.json(刻意独立于权威配置事务,不进备份/损坏恢复) |

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

状态词汇(Rust `frame::SessionStatus`,ts-rs 生成 ui/src/gen/SessionStatus.ts,ui-next/src/gen/ 同步一份):
`created → running → idle | finished | interrupted | error`
- `created` = 新建未运行,**不是完成**(否则侧栏/桌宠按完成渲染)。
- `idle` = 当前轮正常结束、会话空闲可继续;`finished` 留给真正结束的
  子任务——顶层本地会话不以一轮回复作为完成。旧 sidecar 的 `finished`
  读取时兼容迁移为 idle,和解机制上线前残留的 `running` 读取时自愈为
  interrupted。
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
  - cancel **应答 Ok 也不是前提**:引擎"收下"不等于"停了"(工具挂死时
    turn/stopped 永远不来)。看门狗在 `shutdownGraceMs + 10s` 后按轮次号
    比对,仍是同一轮在跑就本地和解。比对轮次是必要的——不比对会误杀
    "用户取消后又发的新一轮"。
- **冷修复:热路径的和解都以内存 `running` 为前提,进程被硬杀后恒 false。**
  kill -9 / OOM / 断电留下的 journal 停在 `task-started`,而 UI 的运行态只由
  帧推导,所以每次打开都按执行中渲染且**永不解锁**(输入只排队、删除/切模型
  全灰、取消打到壳里空转)。`replay_open` 因此在会话空闲且窗口未闭合时补写
  task-error + task-ended 并把 sidecar 落 interrupted——这是唯一能修它的位置。

## 浏览器扩展桥(browser/)

壳原生服务(移植自旧 Go 内核,git 历史 e8666a8 前可查,移植时扩展零改动)。
桥接协议唯一权威定义在 browser/protocol.rs,扩展侧
browser-extension/src/protocol.ts 是其 TS 镜像:
`ws://127.0.0.1:{7440-7449}/ext`、hello/token/一次性配对码、
Op/Ev/错误码、proto:1、20s ping。

- 9 个 browser_* 工具经壳内 MCP streamable-http server 暴露给引擎
  (Bearer 鉴权;手写最小面:POST json 应答/通知 202/GET 405)。
- **会话隔离并发**:每条 MCP transport 经 `initialize` 取得独立
  `Mcp-Session-Id`；Agent 的 `tools/call._meta` 再携带实际 `session_id` 与
  `work_dir`。两级 key 为父任务和共享 transport 的子 Agent 分配独立
  `BrowserSession`。同一现场串行保护 current tab/ref，不同现场可并行。
  `tabId → owner` 路由保证事件只投给所属任务；普通选择不能抢占其他任务的
  tab，只有用户显式 handoff 才转交。截图按 `work_dir` 精确落盘(WSL 模式
  经 `\\wsl$` 视图写 guest 目录);旧 Agent 缺少元数据时回退唯一活跃
  workspace，无法确定只跳过本地副本、不拒绝操作，图片仍作为 MCP image
  返回模型。
- 错误码→中文可行动文案是产品契约(模型行为依赖),改动需过 e2e 断言。

## 遥测(telemetry.rs)

自建 Matomo 的极小心跳,只回答"每天新增多少装机/装了有没有用起来":
启动槽 install/daily-launch(首次延迟 8s,之后 6h tick)+ 使用槽
first-use/daily-use(挂在命令层 session_send 的 user-input)。两槽独立
游标、每台设备每天每槽至多一条成功请求,失败不推进游标。载荷只有
版本/平台/随机 install_id,**不含路径、仓库名、会话内容、账号**。
两道开关:构建期不注入 MC_MATOMO_URL/SITE_ID(仅 release CI 注入
secret)即整个模块空转、连线程都不起;运行期 config.json
`telemetry_enabled`(默认 true,刻意无 UI,合规问卷的出口;表单保存必须
从磁盘合并该字段,防 serde 默认值打回)。游标/install_id 落
telemetry.json,刻意不进权威配置事务。

## 契约 6:引擎生命周期

```
                 ┌───────────────── 退避重试 ────────────────┐
                 ▼                                          │
  [Stopped] ──start──▶ [Starting] ──ready──▶ [Ready] ──EOF+!stopped──▶ [Crashed]
                          │                                          │
                       启动失败                                   熔断(5 次)
                          ▼                                          ▼
                      [Failed] ◀────────────────────────────────────┘
```

状态是 `driver::EngineStatus`,**与 `DriverHost` 的引擎句柄同一把锁维护**——
不允许出现"句柄已摘、状态还是 Ready"。所有转移经 main.rs 的
`publish_engine_status`/`adopt_engine` 收口,那里同时 emit 全局事件
`engine-status`;UI 另有 `engine_status` 命令补拉快照(窗口建起来之前发生的
状态只靠监听必然错过)。引擎不在位时 IPC 的错误文案由状态派生
(`EngineStatus::unavailable`),不再各命令自己拼。

- **启动入口**(4 条,全部经 `restart_engine_locked` 或 setup):冷启动、
  保存设置、手动重启、浏览器配对刷新。任何一条失败都落 `Failed` 并外显——
  配对刷新那条没有调用方接错误,不外显就等于静默失去引擎且无恢复入口。
- **停止入口**(4 条):应用退出(`RunEvent::Exit`)、更新器
  `on_before_exit`、重启前置、**崩溃**。四条都摘句柄:崩溃路径不摘会让
  `running()` 恒真(关窗只隐藏,用户以为退出了进程还在),且每条 IPC 都能
  借到一个必然失败的死引擎。
- **崩溃检测**:reader 读到 stdout EOF 且 `stopped` 未置位 → 释放在途 RPC →
  本地和解运行中会话(契约 5)→ 留存 `ohmyagent.crash-N.log`(最近 3 份;
  start 的 `.prev` 轮转只保留上一次运行,退避重试几轮就把首次现场冲没了)→
  置 `stopped` 并 `child.wait()` 收摊(不置位 flusher 会永远持有 `Arc<Inner>`,
  不 wait 则留僵尸)→ `ShellCtx::on_engine_exit`。driver 只报告事实,
  摘句柄/退避/重启的**策略在壳侧**。
- **实例号是死讯的身份证**。壳内先后起过的每个引擎进程带唯一 `instance`,
  退出通知携带它,`DriverHost::take_instance` 只在**在位的就是它**时才摘句柄。
  没有这道闸,一条过期死讯(启动握手超时后残留的孤儿进程日后咽气、重启期间
  旧引擎抢在 `stop()` 置位前自行退出)会摘掉**当前活引擎**的句柄,再发一轮
  崩溃横幅和自动重启,把刚起来的引擎踹掉。
- **启动失败一律经 `abort_startup` 收尾**:置 `stopped`(reader 据此不把随后的
  EOF 当崩溃双报)、关 stdin、kill + wait 子进程。每条早退分支都要走它——
  握手超时那条曾经直接 return,留下一个常驻孤儿引擎。
- `adopt_engine` 顺带把监督代次 +1:**只要有引擎活着,排队中的重启就没意义了**。
  放在"就位"这个事实上而不是各调用点,才不会漏掉浏览器配对刷新那条路径。
  但**不重置 attempt**——那归稳定期判据,在这里清零等于认定"起来了就算成功",
  而"起来就崩"恰恰是必须能触发熔断的故障。
- **自动重启**:退避 1/2/4/8/16s,连续 5 次后熔断(状态停在 Crashed、
  `retry_in_ms=None`),只能人工重启。**稳定期判据是命门**:引擎就绪后连续
  存活满 `ENGINE_STABLE_UPTIME`(60s)才把 attempt 归零,否则"起来就崩"的
  引擎每次都被当作首次崩溃,退避永远停在 1s、熔断永远触发不到,自动重启
  退化成 1s 一次的死循环。决策是纯函数 `driver::next_retry`,有单测。
- **人工介入**(保存设置 / 点横幅重启)会 `reset_engine_supervision`:代次 +1
  作废在途退避线程,attempt 归零。否则用户手动救回来之后,几秒前排下的那次
  自动重启还会再把引擎踹一遍。
- `DriverHost` 用 lease/维护闸门排空已进入的 IPC 命令并封住新命令,再做
  stop/start;浏览器配对这类自动维护额外要求前台会话与后台 Agent 都为空闲。
- 引擎日志:app_config_dir/ohmyagent.log(`.prev` 上一次运行,
  `crash-N.log` 崩溃留存)。启动失败页与横幅都提供"打开日志目录"。

## WSL 运行环境(Windows)

`kernel_env`(config.json)选择引擎宿主:空 = 本机,`wsl:<发行版>` = 引擎
spawn 进 WSL(设置页「运行环境」下拉,发行版列表读注册表 Lxss,不启动
wsl.exe)。**唯一消费点是 transport 的 `build_engine_command`**——平台
不支持(非 Windows 且无 MC_WSL_EXE)就地降级本机,配置层不兜底。

- **引擎二进制**:WSL 用 `ohmyagent-linux`(MC_OHMYAGENT_LINUX_BIN →
  应用同目录,**不搜 PATH**),Windows 包经 bundle.resources 附带、guest
  经 /mnt/c 直接执行不拷入发行版;"nsis 配置必含它"由
  check_bundle_configs.py 强制。
- **spawn 形状**:`wsl.exe -d <d> --exec <登录shell> -l -c 'cd "$1" &&
  exec "$2" --stdio' …`,stdio 经 wsl.exe 中继透传,协议/握手/日志复用
  本机路径。启动前一次 prepare(45s 预算)拿 guest home/登录 shell/
  networking-mode/wslpath 翻译;ready 握手 WSL 30s(本机 15s)。
  `child.kill()` 只杀中继,四条退出路径(启动中止/管道早退/EOF/强杀)都
  必须补 `kill_guest_engine`(pkill 进发行版)——残活 guest 引擎会与下一个
  实例共写同一 OHMYAGENT_CONFIG_DIR。
- **路径语义**:引擎数据仍留宿主侧,OHMYAGENT_CONFIG_DIR 经 wslpath 翻成
  guest 路径注入(WSLENV 白名单透传,且恒最后设置,防登录 shell export
  同名变量指走私有配置)。壳侧 std::fs 摸 guest 文件**统一经
  `wsl::host_fs_view`**(\\wsl$ UNC)——repo/uploads/session/浏览器截图
  四处消费;workdir 归一化单点 `resolve_workdir`(~ 按 guest home 展开、
  跨发行版 UNC 拒绝、盘符映射 automount(C:\p → /mnt/c/p,根从 prepare
  的 wslpath 翻译对反推)、相对路径拒绝),create/resume 重建/
  session_workdir 读取三类入口都走它——运行环境可能中途切换,sidecar
  形态不可直信。**唯一例外**:本地会话 workdir 的存在性判定/按需创建走
  `wsl::ensure_guest_dir` 在 guest 内执行并 canonical 化(\\wsl$ 对 guest
  符号链接不可求值,宿主视角会把软链工作区误报为不存在);新建会话
  sidecar 存 canonical guest 形态,宿主操作前经逆翻译回 UNC。git 在 guest 内执行(UNC 上跑 Windows git
  撞 ownership 校验且行尾语义不对)。运行时 distro 以引擎实例接回为准,
  不再翻配置。
- **浏览器桥**:仅 networking-mode=mirrored 才物化 mc-browser MCP 条目并
  开 `browser_ext` 能力(nat 下 guest 的 127.0.0.1 与宿主不互通)。
- **冒烟契约**:`MC_WSL_EXE=scripts/fake-wsl.sh` + MC_OHMYAGENT_LINUX_BIN
  指向本机引擎,即可在 Linux 跑完整链路(E2E:ohmy_tests 的 e2e_wsl_*;
  发行版名 broken 恒失败、FAKE_WSL_NETWORKING/FAKE_WSL_UTF16 冒烟分支)。

## 已知上游缺口(ohmyagent)

协议缺口与对应的壳侧变通,上游补齐后应删壳侧实现:

- **stdio 会话索引**:部分补齐——引擎 sessionQuery cap(session/exists +
  session/list)后,壳已用 session/exists 判 resume 可用性,探
  messages.jsonl 只剩 cap 缺失/RPC 失败时的回退;session/list 未消费,
  标题/摘要/归档/帧日志仍 sidecar 权威。
- **空会话 resume 不容忍**:仍成立,壳 engine_id 换绑变通。
- **supports_images:false 压不过内置目录**:引擎 json tag 带 omitempty 且
  解析取 `mc.SupportsImages || caps.SupportsImages`,壳写 false 等价不写
  ——内置目录里 supports_images:true 的已知 model id 无法经配置关闭视觉。
- 旧引擎兼容尾巴仍按 ready cap 门控:无 permissionRemember 时壳侧记忆、
  无 structuredToolResult 时错误前缀回退、无 modelDoneText 时文案回退、
  无 session/switchModel 时 recreate 回退、无 session/switchMode 时
  destroy+resume(钉死引擎已全部宣告,这些是死路径,按契约保留)。

已补齐(近期):每模型独立凭据(e792858 扁平 per-model schema,按别名作键,
壳一一对应物化,槽位冲突逻辑消亡;壳一律传别名选模型,防同 wire id 多网关
撞 wireIndex)、会话交互性声明(8afc338,壳 session/create 带
interactive:true,引擎给持久 Task 工具族)、会话思考档 session/setThinking
(9af68c5+,壳不做 cap 门控,旧引擎直接报 Method not found)、max_output
引擎消费打通(anthropic budget_tokens legacy 已消亡)。
已补齐:OHMYAGENT_CONFIG_DIR、子代理权限实时继承、上下文用量
(event/stream usage 轮中更新 + turn/stopped 扁平轮后快照)、附件(提示词图片路径内联)、MCP image 结果
直达模型(c1d8482)、工具错误发 tool_result(b02fc77,含 deferred
直调自动提升)、子代理事件带 parent_session_id/parent_tool_call_id
(dab1b85,壳精确认领)。固定引擎已删除“同步 Agent 超时后自动转后台”，
后台执行必须由 `run_in_background:true` 显式声明。

## 开发与构建产物

uidist/ 是纯生成物不入库;壳静态页与 webfonts 在 ui-next/public/。
引擎 sidecar 来自独立 ohmyagent 仓库:本地打包缺省用仓库根
agent/ submodule(`export OHMYAGENT_SRC=...` 可覆盖),CI 同源。
externalBin 只能落在打包 overlay(`bundle.{macos,windows,linux}.conf.json`):
tauri_build 在编译期就为宿主 triple 解析 sidecar,基础配置一带上,每个
开发者的 `cargo check` 都要先编出 `binaries/ohmyagent-<host-triple>`。
同理**不能**用 `tauri.<平台>.conf.json` 这个名字——它是 Tauri 的平台自动
合并约定(tauri-utils/src/config/parse.rs),存在即生效、不需要 --config,
等于把打包配置塞进了该平台的基础配置。打包配置只经 --config 显式传入。
"任何打包入口都带引擎"这条不变量因此由 `scripts/check_bundle_configs.py`
强制(Makefile 打包前置 + CI),不存在"包里没引擎"的静默;同一脚本另强制
nsis 配置必含 WSL 引擎 `binaries/ohmyagent-linux`(经 bundle.resources,
externalBin 的 `<name>-<triple>` 解析装不下第二平台)。
UI 颜色一律走主题 token(主题色可切换),写死颜色由
`scripts/check_theme_tokens.py` 在 CI 拦下。

```bash
cd ui && npm run build      # 生成 uidist(cargo build 的前置)
npx tauri dev --config tauri.dev.conf.json   # HMR 开发
cargo test                  # hermetic 单测；不会从 PATH 猜 ohmyagent
                            # E2E 标 #[ignore]，此处如实报 ignored（缺引擎时
                            # 静默 return 报 "ok" 会让绿灯失去意义）
MC_OHMYAGENT_BIN=/绝对路径/ohmyagent cargo test e2e_ -- --ignored --test-threads=1
                            # 固定引擎 + 假 LLM E2E；缺二进制即硬失败
```
