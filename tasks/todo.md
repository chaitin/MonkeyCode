# M1:mc-agent 内核(headless)实施计划

> 设计依据:`docs/superpowers/specs/2026-07-12-local-agent-design.md`
> 已确认:代码在主仓 `agent/` 目录(独立 Go module);开发/eval 直连 API(百智网关,Anthropic 协议,路由别名 feature/coding → deepseek-v4-pro)。
> M1 完成标准:headless CLI 在真实仓库完成中等复杂度编码任务;eval harness 对首批任务集出基线分。✅ 已达成

## 阶段 0:工程骨架

- [x] `agent/` 目录:独立 Go module(`go.mod`),CGO_ENABLED=0
- [x] 目录结构:`cmd/mc-agent` + `internal/{loop,provider,tools,policy,contextmgr,session,frame,config}`
- [x] 基础设施:slog 不需要(内核输出即帧流)、配置(JSON 文件+环境变量+flag)、cobra CLI 骨架
- [x] CI:`.github/workflows/agent-ci.yml`(vet + test + 六平台交叉编译产物)

## 阶段 1:帧协议 + Provider 层

- [x] `internal/frame`:帧结构对齐云端(type 对齐 consts/task.go;task-running 载荷为 ACP 风格 sessionUpdate,与 Web/移动端渲染层同词汇)+ 单测
- [x] `internal/provider`:Anthropic Messages 流式客户端(自研 SSE 解析:text/thinking/tool_use/signature)+ OpenAI Chat Completions 兼容客户端(reasoning_content、tool_calls delta)
- [x] tool-call 归一化:JSON 修复(代码栅栏/尾逗号/文本包裹提取)+ 解析错误反馈模型重试 + usage 记账;单测覆盖
- [x] 请求重试:指数退避,429/5xx/网络错误可重试,重试事件外显为 llm_call_retry 帧
- [~] 多模型冒烟:网关别名(deepseek-v4-pro)全链路真实验证;GLM/Kimi/Qwen 无可用 key,OpenAI 协议路径以单测(mock SSE)覆盖 → 拿到各家 key 后补冒烟

## 阶段 2:工具层 v1

- [x] `read_file` / `write_file`:行号、分页、大小上限、目录列出
- [x] `edit_file`:精确替换 + 唯一性校验 + 引导性错误 + replace_all
- [x] `bash`:每调用独立进程 + cwd 跨调用保持(标记跟踪)+ 越界拉回 + 进程组终止(unix)/Kill(windows)+ 超时
  - 偏差:未用 creack/pty 常驻 shell(env 不跨调用保持)。M2 若需要交互式/env 保持再引入 pty
- [x] `grep`:系统 rg 优先 + 纯 Go 回退(未嵌入 rg 二进制,嵌入放到打包阶段)
- [x] `glob`(doublestar)/ `git`(只读子命令白名单)/ `todo`(全量替换,外显 plan 帧)
- [x] 工具注册表 + schema:手写 schema map(中文描述可控);偏差:未用 invopop/jsonschema,参数 struct 与 schema 同文件相邻,单一来源程度可接受

## 阶段 3:Policy + Context + Session

- [x] `internal/policy`:只读放行 / 写与未知命令 ask / 危险命令 deny;bash 按命令段白名单;会话内记住决定;--allow 预授权;--yolo
- [x] headless ask:终端 y/n/a/d 交互;非交互模式下 ask 即拒绝(提示 --yolo/--allow)
- [x] `internal/contextmgr`:内置系统提示(含 gofmt 格式化要求——dogfood 教训)+ AGENTS.md/CLAUDE.md 装配 + git 分支 + 仓库树摘要(限深限量)
- [x] `internal/session`:JSONL 事件日志(帧序列)+ messages.json 快照 + meta.json;--resume 续聊;sessions 列表
  - 偏差:未用 SQLite(modernc),JSONL+meta 扫描已满足 M1;会话量大后再上索引

## 阶段 4:Loop 集成 + headless CLI

- [x] `internal/loop`:主循环、流式帧下发、usage_update、步数上限(默认 80)、上下文预算占位(压缩 M3)
- [x] 中断:SIGINT/SIGTERM → context 取消 → 工具进程组终止,会话标记 interrupted 可恢复
- [x] `mc-agent run -p`(--quiet/--dir/--resume)、`mc-agent chat`(REPL)、`sessions`、`config set/get`
- [x] `mc-agent serve` 占位(M2 与桌面端一起交付)

## 阶段 5:eval harness + 基线

- [x] `mc-agent eval`:任务目录(task.json + files/ 夹具)→ 隔离临时 git 仓库执行(yolo)→ check 命令判分 → 通过率/步数/tokens/用时 + JSON 报告
- [x] 首批任务集 3 个:fix-off-by-one(修 bug)、impl-function(按测试实现)、refactor-rename(跨文件重构)
  - 偏差:目标 10~20 个,先交付 3 个覆盖三类任务形态;扩充任务集是纯内容工作,持续补充
- [x] 基线:feature/coding(deepseek-v4-pro)**3/3 通过**(报告 /tmp/eval-baseline.json);多模型分数矩阵待各家 key
- [x] dogfood ≥3 个真实任务(均由 mc-agent 自主完成):
  1. 修复自身 read.go/contextmgr.go 的 lint 警告(发现 gofmt 问题→系统提示已加规则)
  2. 为 internal/frame 编写完整单测(一次通过,gofmt 干净)
  3. 为 internal/session 编写完整单测(一次通过,gofmt 干净)

## Review

**结果**:M1 全部交付。`mc-agent` 已安装到 `~/.local/bin`,配置写入 `~/.config/mc-agent/config.json`(0600,API key 不入仓库)。端到端验证:真实 bug 修复任务(读代码→跑测试→精确编辑→回归→总结)、resume 续聊、事件日志帧格式与云端协议一致、eval 基线 3/3、三平台交叉编译、`go vet`+全部单测通过。

**主要偏差(均已在对应条目标注)**:SQLite→JSONL、pty 常驻 shell→每调用+cwd 跟踪、rg 嵌入→系统 rg+Go 回退、schema 生成库→手写 map、任务集 3/20。皆为降低 M1 复杂度的有意取舍,不阻塞 M2。

**发现的问题与修复**:eval 判分遇 Go VCS stamping(已修:临时区 git init + GOFLAGS=-buildvcs=false);evalResult 用时 defer 不生效(已修:命名返回值);agent 编辑后缩进不规范(已修:系统提示加 gofmt 要求,后续 dogfood 验证有效)。

**遗留(M2)**:serve(localhost WS 宿主)、上下文压缩、Windows ConPTY 实测、权限规则持久化到项目配置、多模型冒烟与分数矩阵、任务集扩充。

---

# M2(进行中):serve 宿主

- [x] `internal/server`:localhost WS 宿主——仅 loopback + 随机 token(REST Bearer / WS query)+ 同源 Origin 校验;REST 会话管理;WS 帧双向流(连接时回放 events.jsonl 再实时,seq 衔接历史);同会话单轮互斥;user-cancel 取消
- [x] 权限审批透传:policy ask → `permission-req` 帧 → UI 审批卡片 → `permission-resp` 回传(带超时);集成测试覆盖拒绝路径
- [x] 内嵌调试 UI(单文件 HTML,go:embed):会话列表/创建、流式对话、工具过程、计划、审批卡片、上下文用量。正式 UI 随桌面壳(Tauri)交付
- [x] 测试:server 集成测试 6 例(鉴权/会话/WS 轮次/重连回放/审批/loopback 强制)全过;真实网关 WS 端到端(含审批批准后文件落盘)验证通过
- [x] 上下文压缩:输入 token 超预算 80% 阈值触发 / 上下文溢出错误触发,全史摘要替换(结构化压缩提示词),compact_status 帧全端可见,--context-budget flag;loop 单测 6 例 + 真实网关小预算验证(压缩后 agent 凭摘要恢复并完成任务)
- [x] Tauri 桌面壳 v0(`mc-desktop/`):拉起内核(随机端口+令牌)、窗口加载内核 UI、stdin 看门狗防孤儿(SIGKILL 壳内核也跟随退出,已验证);托盘/自更新/签名/独立 React UI 列入路线图
- [x] eval 任务集扩充 3→10(跨文件 bug/数据竞争/补测试/CLI 功能/JSON 修复/bash 统计/文档生成),基线 **10/10 通过**(feature/coding)
- [x] worktree 隔离模式:internal/workspace(create/diff/apply/drop,含未跟踪文件)、`--worktree` flag、`mc-agent worktree` 子命令、serve/调试 UI 支持;真实网关端到端验证(隔离执行→原仓库零污染→apply 落回→drop 清理)
- [x] macOS 打包物料:desktop-macos.yml(universal .app/.dmg,内核 sidecar)+ darwin 内核二进制(agent/dist/,本地已构建)
- [x] MCP 客户端(internal/mcp):stdio + Streamable HTTP 传输,tools 适配为内核工具(命名空间化 mcp__server__tool),全局+项目两级配置,只读注解自动放行/其余审批,单点失败不阻塞;mc-agent mcp list 子命令;CLI 与 serve 均接入;单测 6 例(含真实 stdio server 端到端)+ 真实网关模型实调验证
- [x] call/call-response 同步查询 + UI 改动面板/diff 视图:internal/repo(file_list/read_file/file_changes/file_diff,工作区边界强制,未跟踪文件构造全新增 diff),serve 分发(不落日志/只回发起方),调试 UI 改动 Tab + 着色 unified diff;repo 单测 3 例 + server call 测试 + 真实 serve 端到端验证
- [x] 速赢:chat 头部 bug、eval 基线归档、bash env 跨调用保持、权限"此项目永久"持久化、isTerminal 修正
- [~] 平台对接(OAuth 登录/技能规则下发/LLMProxy key):**内核侧完成**(internal/platform + login/logout +
      contextmgr 注入,mock 平台端到端已验证);**后端端点暂缓**(用户决定先不动后端,biz/desktop 实现已回滚,
      端点契约见下方"M2 收尾"节,后端确认后可直接照做)
- [ ] Windows ConPTY 实测(阻塞:需 Windows 机器)、多模型冒烟分数矩阵(阻塞:需 GLM/Kimi/Qwen key)

## MonkeyCode 云端账号同步 + 云端任务补齐(2026-07-18)✅

> 目标:百智云登录成功后,内核复刻移动端的 OAuth 桥接(mc `/api/v1/users/login`
> → 302 → baizhi `/oauth/authorize` 授权页 → 改写为 `/api/v1/oauth/authorize` API
> 带百智 cookie → 302 回调落 monkeycode 会话),同步 monkeycode-ai.com 账号,
> 并把 `GET /api/v1/users/tasks` 渲染进侧栏"云端任务"占位区。

- [x] Go:`Endpoints.MonkeyCode`(env `MC_AGENT_MONKEYCODE_URL`)+ `monkeycode.go`
      (桥接登录/status/tasks 代理;mc 会话独立落盘 monkeycode-cookies.json,0600;
      cookie 按 host:port 分罐,百智/云端登出互不牵连)
- [x] Go:本地路由 `/api/mc/{status,login,logout,tasks}` + 单测 3 例(假 mc + 假 baizhi
      完整重定向链:授权页改写/会话独立/百智未登录与会话失效路径)
- [x] UI:client.ts mc API;App.tsx 启动/离开设置页自动桥接同步 + 已同步时 60s 轮询;
      sidebar.tsx 云端任务行(状态徽标,预览取最近 8 条,点击外开 `/console/task/:id`)
- [x] 验证:go vet/test 全绿、tsc+vite 重建 uidist、7440 调试实例 + **真实生产链路**
      跑通(百智会话 → 桥接拿到 monkeycode 用户 → 拉回真实任务列表 → 内核重启后
      会话持久生效)+ Playwright e2e(侧栏渲染任务行/状态徽标/空态文案断言)

**Review**:桥接完全复用移动端已验证的协议(未新增任何服务端契约);任务数据
对内核不透明(RawMessage 直通),字段契约钉在 backend/domain/task.go。实测发现
线上任务 title 常为空、文案在 summary,展示优先级 title→summary→content。
遗留:侧栏仅预览+外链,云端任务的详情回放/派发(new task 的"云端"模式)另行实施。

## 云端任务二期:过滤 + 桌面内详情/操作 + 云端派发(2026-07-19)✅

> 目标:1) 侧栏默认只展示未结束任务,历史任务可展开查看;2) 点击任务在
> mc-desktop 内查看与操作(回放 + 实时流 + 停止/续聊),不开浏览器;
> 3) 新建任务选"云端"时真实创建云端任务并可操作(替换现占位提示)。
> 协议依据:mobile 端(new-task.tsx / task 详情 / stream.ts / messages/handler.ts)
> 是活契约,backend/ 同构代码钉字段。

- [x] 摸清协议(3 个并行探索):关键结论——云端 WS 下行 TaskStream 与本地 Frame
      逐字段同构(ACP 载荷同一套),渲染链 reduceBatch→LogList 可直接复用;
      rounds 历史 chunk 用 event 字段需归一为 type;seq 全局单调跨轮;
      task-ended 按"轮"下发(kind=turn_end),不是任务终结;建任务最小体 =
      content+model+image+public_host+opencode+repo:{}(服务端自动跑首轮)
- [x] 内核(baizhi 包):`/api/mc/tasks` 加 status 逗号多值过滤;新增
      `/api/mc/tasks/{id}`(详情)、`/{id}/rounds`(回放,event→type/ns→ms 归一)、
      `/{id}/stop`、`POST /api/mc/tasks`(创建,内核补默认值)、`/api/mc/task-options`
      (模型/镜像/项目/订阅);`mcstream.go` WS 代理(内核带 monkeycode cookie 拨
      wss 到云端 stream,双向原样转发,下行读限 32MB)
- [x] UI:侧栏默认只列 pending/processing + "历史任务(N)"折叠展开(记忆);
      `cloudtask.tsx` 详情视图(结束态 rounds 只读回放+"加载更早"游标翻页;
      pending 显示 VM 准备进度 3s 轮询;processing WS attach 实时跟看;
      续聊走 mode=new;停止=WS user-cancel,终止=REST stop,网页打开兜底);
      `cloud.ts` 移植 mobile 默认模型/镜像挑选;newtask 云端模式(项目选择/
      云端模型选择/真实创建→进详情跟看,未同步账号给登录引导)
- [x] 修复:云端流重复渲染——App 内联回调进了 WS effect 依赖,每次重渲染
      重建 attach 连接导致服务端整轮重放;修法:回调走 ref + liveRef 只存
      当前轮(轮结束归档 history)+ (重)连时清当前轮缓存以回放为权威
- [x] 验证:go vet/test + UI 25 单测全绿;帧级诊断(裸连代理 WS 抓全帧确认
      线上流干净);**真实生产端到端**:UI 建云端任务(qwen3.5-plus/devbox)→
      VM 启动进度 → 实时流两轮对话 → 终止回收;Playwright e2e 三阶段
      (侧栏过滤/只读回放/派发续聊终止)+ 截图逐张目检

**Review**:内核继续零翻译代理(凭证不出内核),UI 复用本地渲染链零新组件。
遗留:云端 ask 问答卡(acp_ask_user_question/reply-question)未实现,遇到会
静默丢弃——需要 LogItem 加 ask 变体 + reduce 分支 + 卡片渲染 + WS 回传;
Control WS(文件树/diff/端口/切模型)未接,详情视图给了"网页打开"兜底。

### 三期补齐(2026-07-19 同日,用户反馈驱动)✅

- [x] 刷新:侧栏"云端任务"标题加刷新按钮(同步中转圈)+ 窗口重获焦点自动刷新
      (网页/手机刚派发的任务切回来即可见,不等 60s 轮询)
- [x] 展示统一:云端详情视图对齐 ChatView——56px 双行标题栏(可拖拽窗口)、
      COL_MAX 同列宽同 scrollbar-gutter、运行条 + 停止胶囊、出血 composer 卡片、
      终止任务收进 ⋯ 菜单(与删除会话同交互);COL_MAX 从 chat.tsx 导出共用
- [x] 看文件:内核加 /api/mc/tasks/{id}/control WS 代理(云端 Control 流);
      cloudfiles.tsx 文件抽屉(文件树/内容预览/改动 diff,结构对齐本地抽屉,
      kind 与字段对齐 web task-file-explorer:repo_file_list/read_file/changes/diff,
      call 按 request_id 配对,断线重连+未连先排队)
- [x] 终端:内核加 /api/mc/vms/{id}/terminal WS 代理(云端 VM 终端流);
      cloudterm.tsx = xterm.js + FitAddon,协议对齐 web common/terminal.tsx
      (文本 JSON 帧,data=base64/resize={row,col}/5s ping);底部 280px 面板,
      Esc 透传给 shell(App 快捷键对 .xterm 目标放行)
- [x] 验证:对真实运行中的云端任务只读 e2e 全过——文件树列出 /workspace、
      .gitignore 预览带行号、终端 zsh 里 echo TERM-OK-42 回显;并发上限时
      创建错误条正确外显("你已有一个正在运行的任务");截图逐张目检

### 四期补齐(2026-07-19,ask 问答/切模型/在线预览)✅

- [x] ask 问答卡:reduce.ts 移植 mobile handler.ts 的检测/归一逻辑(tool_call
      词汇判定 + acp_ask_user_question 帧 + rawInput/_meta 双载荷位),LogItem 加
      ask 变体;components.tsx AskCard(单选/多选/自定义输入,已答态答案 chip,
      轮结束未答过期);回答经任务流上行 reply-question(request_id=toolCallId,
      answers_json={问题:答案}),乐观回写;reduce 单测 +6(31 全过)
- [x] 切换模型:composer 行加云端模型选择器(执行中禁用),一次性控制流连接
      调 switch_model(load_session 保留上下文)后刷新详情
- [x] 在线预览:⋯ 菜单打开即拉 port_forward_list,有 access_url 的端口列出
      点击外开;无端口给空态
- [x] 验证:真实云端 e2e 问答闭环全过——agent 真的提问(选项+描述渲染成卡)→
      桌面内选「很好」提交 → 卡片转已答 → agent 复述所选并结束;切模型真实
      生效;预览菜单空态正确;截图目检

遗留(下期):文件下载、restart、共享终端;并行会话同账号 e2e 时注意 1 并发位互挡。

### 五期:视觉整改(2026-07-19,用户反馈"太丑")✅

- [x] 头部收敛:只留「文件 + ⋯」(与本地会话同款两控件);终端/在浏览器打开/
      在线预览/终止任务全部收进 ⋯ 菜单;去掉 ✕(Esc/侧栏切换即关闭);
      副标题改为 状态圆点+状态字 · ☁云端 · 模型名
- [x] 终端改圆角悬浮卡:从通栏黑带改为对话列同宽(COL_MAX 同出血)的
      深色圆角卡,自带状态头(绿点+云端终端+/workspace+✕),融入卡片语言
- [x] composer 状态行精简:只留连接点+状态字,长文案进 tooltip
- [x] 验证:对真实运行中任务只读 e2e——头部按钮断言/菜单四项齐全/终端卡
      echo 回显,截图目检

### 六期:发送与连接解耦(2026-07-19,用户反馈"先连 ws 才能发/不能连发")✅

- [x] 排队投递:composer 任何时刻可发——环境启动中/轮执行中/流未同步/上一条
      未回执时入单槽队列(连发多条合并,不再互踩连接丢消息);轮结束、attach
      同步完自动投递;排队 chip(内容+取消)对齐本地会话;任务结束压着队列
      时外显提醒不静默丢
- [x] 守卫:syncedRef(attach 连上过才信 running)/runningRef(task-started/
      ended 直更)/sendingRef(直发等首帧回执,15s 超时解锁);统统走 ref,
      不进 effect 依赖
- [x] 假云端 e2e 资产(/tmp/pw-e2e/fakecloud.mjs):实现已摸清的最小云端契约
      (建任务/状态机/stream attach 回放+mode=new/运行中拒绝输入),
      MC_AGENT_MONKEYCODE_URL 指过去做确定性回归——不占真实账号/额度/并发位
- [x] 验证:排队矩阵 12 断言全过(启动中入队/连发合并/轮结束自动投递/chip
      清空/空闲直发/运行中入队/全程未触发云端"运行中拒绝");31 UI 单测;
      真实云端回放回归

### 七期:云环境休眠/唤醒外显(2026-07-19)✅

- [x] 常驻控制连接:进对话即连 Control WS(服务端在连接建立时自动唤醒
      休眠 VM,连接存续期间保活),关视图断开开始空闲倒计时——与 web
      控制台一致;switch_model/端口列表复用这条连接
- [x] 外显:头部副标题加「⟳ 环境唤醒中」(amber спиннер)/「环境离线」;
      唤醒期间轮询提速 3s;composer 占位与排队 chip 分场景标注
      "环境唤醒后自动发送"
- [x] 守卫:VM hibernated 时发送入队(hibernatedRef 进 idle 判定),
      轮询看到 online 即自动投递
- [x] 假云端补休眠模拟(无控制连接空闲 6s 休眠/控制连接 2.5s 唤醒/
      休眠中拒绝输入);e2e 9 断言全过:离开视图休眠 → 重进外显唤醒中 →
      唤醒期间入队 → 唤醒后自动投递,全程未触发"休眠中拒绝"

### 八期:attach 重连死循环修复(2026-07-20,用户实测"一直重复自动重连")✅

- [x] 根因:云端对"当前轮已结束"的 attach 会发完 cursor 直接关连接
      (休眠唤醒后回到空闲态必现),客户端把这当断线无脑 2s 重连 → 死循环
- [x] 修复(connectCloudTask 状态机):区分三种关闭——轮结束(不重连)、
      空闲关闭(连上后零活跃帧被关 → onIdle 转"就绪"态,发消息时再建连接;
      cursor/error 不计入活跃帧)、拨号失败(指数退避 2→4→8→16→30s,
      连续 5 次放弃转就绪);mode=new 首条输入拨号失败/零回显被关 →
      onSendFailed 交还队列,绝不静默丢;VM 唤醒中不发起 attach
- [x] 注意:双引擎重构(6f4c53f)后 UI 走 Tauri IPC,浏览器 Playwright e2e
      失效;验证改为 vitest 状态机单测(mock 壳 invoke/listen + 假时钟),
      7 用例覆盖空闲关闭/轮结束/活跃断流/退避放弃/拨号失败交还/零回显
      兜底/有回显正常重连;38 UI 单测全过

## M2 收尾:平台对接实施计划(2026-07-13)

> 设计依据:local-agent-design.md §6 登录流 / §3 上下文 / L180 改动清单。
> 侦察结论:后端登录全为 session cookie(无 Bearer 面);LLMProxy 已存在
> (`/v1/messages|chat/completions`,model_api_keys 经 X-Api-Key/Bearer 鉴权,
> `CreateRuntimeAPIKey` 可复用);技能/规则有 agentresource.Resolver 但只在任务
> VM 分发,无桌面拉取端点;内核零平台代码。

### 后端 `biz/desktop/`(已回滚,暂缓——保留端点契约备查)

> 2026-07-13 曾完整实现并测试(miniredis 全链路 4 例),按用户决定回滚。内核按以下契约实现并 mock 验证,
> 后端恢复实施时照此契约即可零改内核:
>
> - `GET /api/v1/desktop/authorize?redirect_uri&state`(session):校验 redirect_uri(monkeycode:// 或
>   loopback http),未登录 302 /login,已登录发一次性 code(建议 Redis TTL 5min)302 回调
> - `POST /api/v1/desktop/token {code}` → `{access_token(mcd_*), token_type, expires_in, user}`
> - `POST /api/v1/desktop/runtime-key {model_id?}`(Bearer mcd_*)→ `{api_key, model, protocol}`,
>   protocol ∈ anthropic|openai_chat|openai_responses;key 复用 model_api_keys,流量走 LLMProxy
> - `GET /api/v1/desktop/agent-resources`(Bearer)→ `{rules:[{name,content}], skills:[{name,version,description,zip_url}]}`,
>   规则内联、技能 presigned zip;注意 dispatch 查询语义是 {选中}∪{force_delivery},全量下发需先 listing 转选中集

### 内核 `agent/`

- [x] `internal/config`:新增 platform_url / platform_token / platform_model_id(env `MC_AGENT_PLATFORM_*` +
      config 文件);Validate 放宽:直连三元组 或 platform 二元组 任一满足
- [x] `internal/platform`:client(ExchangeCode/FetchRuntimeKey/FetchResources)+ Sync(技能 zip 下载
      解包到 ~/.cache/mc-agent/platform/<host>/,zip-slip/文件数/大小防护,同版本跳过)+
      LoadCached 离线兜底 + LoginViaBrowser(loopback 回调 + state 校验)
- [x] `mc-agent login <url>` / `logout`;config get 显示平台登录态
- [x] applyPlatform:无直连 key 时换运行时 key,protocol→provider(anthropic→平台源;openai_chat→
      平台源+/v1;openai_responses 明确报不支持),run/chat/serve 全路径生效
- [x] `internal/contextmgr`:Build(workdir, extras)——# 平台规则(内联,32KB 截断)+ # 平台技能
      (名称/描述/入口文档索引,模型按需 read_file)
- [x] 技能缓存在工作区外:Env.ReadRoots 只读附加根(仅 read_file 放行,写/编辑仍限工作区),
      loop.Options/server.Options 透传
- [x] 单测:platform 5 例(httptest 假平台、zip-slip、文件数上限、缓存兜底)、contextmgr 3 例、
      config 3 例、tools ResolveForRead 1 例

### 验证

- [x] backend:go build ./... + go vet + biz/desktop 单测过
- [x] agent:gofmt 干净 + go vet + 全部 13 包单测过
- [x] 真实二进制端到端(假平台进程):`mc-agent login` 浏览器流(authorize 302→loopback 回调→
      token 写配置)→ `mc-agent run` 换运行时 key→ 技能 zip 落盘缓存 → 系统提示含平台规则与技能索引
      (假平台侧断言 SYSTEM_HAS_RULE/SKILL=true)→ Anthropic SSE 回复正常渲染

### 偏差(有意取舍)

- 桌面 token 存 Redis 长效(TTL=Session.ExpireDay),keychain 存储属 Tauri 壳(M3);内核配置文件 0600 兜底
- 运行时 key 复用 model_api_keys(持久 uuid),"短时效轮换"待后端 key 过期机制,不阻塞计量/审计(流量已走 LLMProxy)
- 未登录 authorize 302 到 /login?redirect=...,前端登录页暂不消费 redirect 参数(登录后需重开授权 URL);前端支持后自动闭环

---

# M2.5:agent/desktop 能力完善(不动后端,2026-07-13)✅

## 内核:本地技能

- [x] `internal/skills`:本地技能发现——项目 `.mc-agent/skills/<name>/SKILL.md` + 全局
      `<配置目录>/skills/<name>/SKILL.md`,同名项目优先;SKILL.md 可选 frontmatter
      (name/description),缺省取目录名与正文首个非标题行
- [x] 装配:skills.Assemble 合并本地与平台技能(本地优先)进 contextmgr.Extras;全局技能目录进
      ReadRoots(项目技能本在工作区内无需附加);serve 改为 Options.BuildExtras 按会话工作区装配,
      run/chat/serve 全路径生效
- [x] `mc-agent skills` 子命令:列项目/全局/平台缓存三来源(不发网络请求)
- [x] 单测 4 例:发现/frontmatter 解析/项目覆盖全局/本地平台合并与只读根
- [x] README 增"技能"一节

## 桌面壳:托盘常驻

- [x] 托盘图标 + 菜单(显示窗口/退出 MonkeyCode)+ 左键单击恢复窗口;内核运行且托盘可用时关窗
      只隐藏,托盘"退出"才真正退出(内核随 stdin 看门狗回收)
- [x] 降级:托盘创建失败(无 StatusNotifier 宿主)或内核启动失败错误页 → 关窗直接退出,
      并放行 ExitRequested,避免无窗无托盘僵尸进程
- [x] cargo build 过;无头冒烟(xvfb+dbus):壳拉起内核就绪 → SIGKILL 壳 → 内核跟随退出无孤儿
- [x] README:托盘一节 + 路线图勾掉

## 验证

- [x] agent 全部 14 包测试过、gofmt/vet 干净
- [x] 真实二进制端到端:项目技能 + 全局技能 + 平台缓存技能三来源 `mc-agent skills` 正确列出;
      run 时系统提示同时含三来源技能索引与平台规则(假平台侧落盘断言 6 关键词全中)
- [x] mc-desktop 构建 + 无头冒烟过

---

# M2.6:sub-agent + 独立 React UI(2026-07-13)✅

## 只读探索子代理(task 工具,M4 提前)

- [x] `internal/subagent`:task 工具(description+prompt)→ 独立 loop.Engine,受限工具集
      read_file/grep/glob/git(无 bash/写/编辑/todo/task 自身→无递归、整体只读、yolo 无权限旁路)
- [x] 独立探索型系统提示;步数上限 25;部分结论 + 提前终止时不丢弃(附终止说明返回)
- [x] 用量经 OnUsage 回灌主引擎;CLI(buildApp)与 serve 双路径接入,task 自动放行
- [x] 单测 4 例(scripted provider):探索问答/工具集白名单断言/写工具不可用/部分结论容错
- 偏差:子代理帧静默(主流程只见 task 调用卡片),嵌套帧展示留 M4;eval 未注入(保持基线可比)

## 独立 React UI(替换内嵌调试 UI)

- [x] `agent/ui` 工程:React 18 + TS(strict)+ Vite,vite-plugin-singlefile 打成单 HTML,
      产物 `cmd/mc-agent/uidist/index.html` 入库 → serve go:embed,内核 Options.UI 零改动,
      go build 不依赖 node;旧 ui.html 删除
- [x] 功能对齐并增强:会话列表(状态点)/新建(worktree 选项)、流式对话(**Markdown 渲染**,
      DOMPurify 净化)、思考/工具行/计划卡(原地更新不追加)、审批卡四按钮与终态回写、
      改动 Tab + diff 弹层、上下文用量、断线重连、rAF 批量消费、智能吸底滚动
- [x] 帧归约为纯函数(src/reduce.ts)与连接层(src/client.ts)分离,tsc strict 通过
- [x] 验证:npm build + go 全量测试过;真实 serve 冒烟(UI 232KB 正确服务);Node 22 内置
      WebSocket 按 UI 协议路径全链路 e2e(建会话→user-input→帧流→task-ended→call 改动查询
      检出新增文件)PROTO_ALL_OK
- [x] 文档:agent README(子代理 + UI 开发流程)、mc-desktop README 路线图更新

---

# M2.8(进行中):壳持有配置——桌面自足闭环(2026-07-14,方向重定)

> 架构决定(用户拍板):配置与设置归壳,agent 只是壳拉起的进程。
> 曾按"内核配置 REST"实施半程,已全部回滚,agent 零改动。
> 关键接缝:内核 config.Load 的 env 覆盖(MC_AGENT_*)本来就存在——壳把自己
> 存的配置经环境变量注入 spawn 的内核即可,不碰内核代码、不污染 CLI 用户的
> config.json;env 也不像 argv 那样暴露在 ps 里。

> 扩围(用户确认):每会话可用不同模型(可跨 provider),且会话内可切换
> (轮次间生效;消息历史是归一化格式,跨 provider 续聊安全)。
> 一个 agent 进程承载全部会话不变(serve 本就每会话独立 engine/provider)。

## 内核(仅消费侧改动)✅

- [x] 模型清单:config.LoadModels 读 `MC_AGENT_MODELS` JSON 数组(name 缺省取 model、
      名称唯一、default 恰一个);无清单退回现有单配置
- [x] server.Options:NewProvider(model)+ListModels;`GET /api/models`;
      `POST /api/sessions` 带 model(未知名 400);call `session_set_model`(执行中拒绝,
      成功换 engine/子代理 provider + meta 落盘 + model_update 帧进日志,回放可见)
- [x] loop.Engine.SetProvider;顺手修了真 bug:startTurn 延迟收尾可能清掉新轮次
      running(turnSeq 代号守卫)+ task-ended 帧经 emit 先复位 running(帧是客户端
      行为契约,状态先于帧可见)

## 壳(mc-desktop)✅

- [x] 配置存储:app_config_dir/config.json + models.json(0600);壳持有,内核只消费
- [x] 设置页 ui/settings.html:模型增删改/设默认;get_config/save_config/open_settings_window
      三个 command;withGlobalTauri + 内联 capability
- [x] 首启无配置 → 设置窗口(不 spawn 内核);保存 → 写清单 → spawn(env 注入,不走 argv
      防 ps 泄漏)→ 主窗口进内核 UI;托盘加"设置"项,保存即重启内核换新 URL
- [x] 错误页去内核化:文案不再提 mc-agent,加"打开设置"按钮

## UI ✅

- [x] 新建会话模型下拉(默认预选,单模型时隐藏)
- [x] 侧栏底部"⚙ 设置"按钮 → Tauri IPC 唤起壳设置窗口(remote capability 放行
      127.0.0.1 源;浏览器直连模式降级为提示);会话列表不展示模型(用户要求)
- [x] 状态栏模型下拉切换(运行中禁用,title 提示)→ call session_set_model;
      model_update 渲染为"模型已切换为 X"系统行

## 验证 ✅

- [x] 内核单测:models 6 例 + server 端到端 1 例(清单/未知名 400/按会话解析/切换流转/
      运行中拒绝/meta 落盘);全部 15 包过,gofmt/vet 干净;UI tsc+build 过
- [x] e2e(echo-llm 按请求回显 model+key):会话绑乙 → 首轮 MODEL=model-b|KEY=key-b;
      切甲 → 次轮 MODEL=model-a|KEY=key-a;列表 meta 更新(MODEL_E2E_OK)
- [x] 壳无头冒烟:无配置 → 不 spawn 内核、开设置窗;写入配置重启 → 内核环境含
      MC_AGENT_MODELS 指向壳写的清单、就绪;壳被杀内核跟随退出无孤儿

---

# M2.10:桌面体验五连修(2026-07-14,用户反馈)✅

- [x] 1 新建会话选目录:壳接 tauri-plugin-dialog,UI"浏览…"原生目录选择(浏览器模式隐藏);
      server 支持 create_dir,UI 报"目录不存在"时内联"创建该目录并继续"(api 错误改带服务端 message)
- [x] 2 会话按项目组织:侧栏按 workdir 分组(worktree 会话归 Worktree.Repo),组按最近活动
      排序、可折叠(localStorage 记忆),组头"+"预填目录新建;会话条目简化(去目录/模型)
- [x] 3 隐藏 worktree 勾选(内核/CLI 能力保留;worktree 会话条目带"隔离"标记)
- [x] 4 回放提速:loadCompactedReplay——连续同类文本增量合并单帧、usage 只留末帧、
      bash output 进度帧丢弃、其余语义帧透传;主回放与子会话观察者共用;
      3000 帧压到 <50 帧(测试锁定),文本完整性断言
- [x] 5 压缩提示展示:compact_status 帧 React UI 渲染为系统行(此前仅 CLI 有)
- [x] 6 上下文统计虚高(用户反馈):provider 对流式 usage 用 Add 累加,而协议中
      message_delta/chunk 的 usage 是累计快照,网关每增量都带时统计被吹到数倍;
      改为 Usage.Merge 快照语义(input 取最新非零、output 取最大),Add 保留给
      会话级跨请求累计;anthropic/openai 双路径 + 回归测试(累计快照流形态)
- [x] 验证:go 全量过(新增 TestReplayCompaction,改 TestWSReplayLargeHistory 为
      文本完整性+帧数上限);create_dir 端到端(400→create_dir→目录落盘);
      MODEL_E2E_OK 回归;壳 IPC 探针 OK

---

# M2.9:设置增强——MCP 配置 + 单窗口设置页(2026-07-14)✅

- [x] MCP 进设置:壳存 mcp_servers(与内核 mcpServers 同构,壳不解释原样写盘),
      设置页增删改(HTTP url+headers / stdio command+args+env,K=V 行编辑);
      spawn 注入 MC_AGENT_MCP_CONFIG(内核 env 覆盖点已存在,零改动);
      项目级 .mc-agent/mcp.json 不变(同名覆盖全局)
- [x] 设置改单窗口:主窗口存在时窗口内导航到设置页(tauri://localhost origin),
      保存/返回导航回内核 UI(KernelUrl 状态);首启无主窗口才独立开窗;
      新增 close_settings 命令(build.rs + capability 同步授权)
- [x] 验证:cargo build(ACL 编译期校验);无头冒烟——内核环境含
      MC_AGENT_MODELS 与 MC_AGENT_MCP_CONFIG、mcp.json 落盘、IPC 链路 OK;
      探针加 origin 守卫防设置页循环触发

---

# M2.11:子代理步数可配 + 并行执行(2026-07-14,用户反馈)✅

> 反馈:子代理 25 步上限写死不合理;同批多个 task 调用串行排队,没有真并行。

- [x] 步数上限:subagent defaultMaxSteps 25→50;`--subagent-max-steps` 持久 flag
      贯通 run/chat/serve(server.Options.SubagentMaxSteps → sub.MaxSteps)
- [x] 并行执行:tools.Parallelizable 可选接口(只读、无跨调用状态的工具声明可并行),
      loop.execBatch——同批可并行工具并发执行(goroutine + 按 tool_use 原序回填),
      其余工具(bash/写/编辑)在并行组结束后保持串行;task 工具声明可并行,
      工具描述提示模型"互不依赖的探索任务一次发起"
- [x] 并发安全:Engine.emit 加锁(下游渲染器/会话日志免锁)、每次调用独立 tools.Env
      (进度闭包捕获各自 toolCallId,不串扰)、AddUsage 锁保护(子代理用量回灌,
      CLI/serve 两处 OnUsage 改走它);frame.Builder seq 本为 atomic、policy/publishChild
      已有锁、session newID 带随机后缀,均无需改动
- [x] 展示:帧协议不变;React UI reduce 本就按 toolCallId 挂子步骤,并行天然分组;
      CLI 渲染并行时子步骤行交错(可接受,结构化端不受影响)
- [x] 验证:新增 loop 并行单测(屏障工具断言真并发 + 结果顺序 + 进度帧归属),
      全部 16 包 -race 通过,gofmt/vet 干净,--help 现新 flag

---

# M2.12:mc-desktop 自动更新(2026-07-14)✅

> OSS 静态清单 + tauri-plugin-updater,壳整包更新(内核 sidecar 随包);
> 版本号 YYMMDDNN(日期序号占 semver 主版本位),不一致即提示,用户确认后更新重启。
> 发布:CI 出签名产物(Actions Artifacts),人工上传 OSS public/desktop/。

- [x] 签名密钥:minisign 密钥对(~/.tauri/monkeycode-desktop.key,公钥入 tauri.conf.json;
      私钥待配 GitHub secret `TAURI_SIGNING_PRIVATE_KEY`)
- [x] 配置:tauri.conf.json 版本 26071401.0.0 + plugins.updater(pubkey/endpoints);
      tauri.release.conf.json(createUpdaterArtifacts,仅发布构建叠加,本地打包不需私钥)
- [x] 壳(main.rs):check_update(version_comparator 远端≠本地即更新、MC_UPDATE_MANIFEST
      测试覆盖、短版本号展示)→ dialog 询问 → download_and_install → restart(内核经
      RunEvent::Exit 回收);启动 5 秒自检(debug 默认跳过);托盘"检查更新"菜单项
- [x] 发布链:Makefile macos-release(校验私钥 + 叠加 release 配置 + gen-latest-json.py
      汇集 updater/ 产物);CI secret 就绪走发布构建否则回退,Artifacts 加 updater/*
- [x] 验证:cargo build 过;Linux 无头端到端两场景(清单 99999999 → "发现新版本"日志、
      清单同版本 → "当前已是最新版本(26071401)",短版本号正确);gen-latest-json.py
      假产物跑通(双 darwin key 同 URL、多行签名正确转义);macOS 完整链路待真机(README 有步骤)
- [ ] 待办:GitHub 配置 `TAURI_SIGNING_PRIVATE_KEY` secret(cat ~/.tauri/monkeycode-desktop.key);
      OSS 确认 release.monkeycode-ai.com/public/desktop/ 可公网匿名读
- v2 留:内核独立热更新(清单 kernel 段 + find_agent 覆盖位 + 复用重启内核路径)

---

# M2.13:设置 UI 统一进内核 React UI,壳退纯宿主(2026-07-14)✅

> 动机:产品界面分裂在两套栈(聊天=agent/ui React,设置/错误页=壳 vanilla HTML),
> 已造成"重构桌面客户端只改了壳页面"的返工。收敛:设置渲染进内核 UI,
> 配置所有权仍在壳;支点=内核零模型可启动,解开"没配置→内核起不来→没设置页"死锁。

## 内核(agent/)
- [x] LoadModels:空清单 `[]` 合法(返回非 nil 空切片,区分"未设置清单"=nil);
- [x] serve 三分支:多模型 / **零模型**(清单空:ListModels=[]、NewProvider 报"尚未配置模型")/ 单配置(CLI 不变);
      **清单内容错误不致死**(stderr 警告 + 降级零模型,防坏配置持久化后死锁)
- [x] 版本外显:server.Options.Version → /healthz 带 version(v2 内核热更新握手的接缝)
- [x] 测试:TestLoadModelsEmptyManifest、TestZeroModelServe(models=[]、建会话 400 引导文案、healthz 版本)

## React UI(agent/ui/)
- [x] src/settings.tsx:设置视图(模型 CRUD+设默认+provider 三值;MCP http/stdio+KV 文本域;
      parseKV/mcpsToServers 从 settings.html 移植为 TS);保存→壳写盘重启内核→整页导航重载
- [x] client.ts:getHostConfig/saveHostConfig(照 pickDirectory 的 invoke 模式)、onHostEvent(托盘事件);
      openHostSettings 删除;types.ts 加 HostConfig/HostModel
- [x] App.tsx:view 加 "settings";⚙ 按钮/Esc/托盘 open-settings 事件进出;
      桌面壳内模型为空启动直接进设置向导

## 壳(mc-desktop/)
- [x] 无条件拉内核(无配置写空清单);删 open_settings_window/close_settings/open_settings/
      app_page_url/KernelUrl/ModelEntry/valid();DesktopConfig 改 opaque JSON 透传(schema 双定义消除)
- [x] 托盘"设置"→show_any_window + emit_to("main","open-settings");无头探针改验 get_config
- [x] build.rs commands 缩为 get_config/save_config;capabilities:kernel-ui 放行 get/save-config,
      shell-pages 缩为错误页 core:default;删 ui/settings.html,错误页去"打开设置"按钮

## 验证
- [x] agent 全量测试/gofmt/vet 过;UI tsc+build 过;壳 cargo build(ACL 编译期校验)过
- [x] 无头端到端 5 场景:A 无配置首启零模型(/api/models=[]、healthz 带 version)、
      B 写配置重启生效(models.json 落盘+API 返回)、C 坏配置容错(重复名→零模型+警告不死)、
      D IPC 探针(remote origin invoke get_config OK)、E SIGKILL 壳内核跟随退出
- [ ] Mac 真机人工:首启进设置向导→配模型→聊天;托盘"设置";保存后会话列表不丢

---

# M2.14:会话删除/归档(2026-07-15)✅

> 归档=Meta.Archived 标记(可逆,UI 折叠到"已归档"组);删除=不可恢复,
> 级联子会话 + worktree 连带回收,运行中 409 拒绝(先停止再删)。

- [x] session:Meta.Archived;Delete(ID 防逃逸+存在性校验+RemoveAll);
      SetArchived(非 live 磁盘直写;live 必须走内存副本防轮次收尾覆写)
- [x] server:`DELETE/PATCH /api/sessions/{id}`;teardownLive(首个单会话回收路径:
      断客户端/mcp/engine/sess.Close/摘 live 表,running 拒绝);dropChildWatchers;
      删除级联 Parent 子会话 + Worktree.Remove(best-effort)
- [x] UI:SessionRow 悬停 ⋯ 菜单(归档/删除,删除内联确认,worktree 提示连带删除,
      running 禁用);侧栏"已归档 (n)"折叠组(localStorage 记忆);删当前会话复位回新建视图
- [x] 验证:session 2 例 + server 3 例(含 live 归档不被轮次覆写、子会话级联、运行中 409),
      全量测试/gofmt/vet 过;UI tsc+build 过;REST 端到端(归档落盘/删目录/worktree 目录与
      git 登记回收/404);壳无头探针回归 4 项全过
- [ ] Mac 真机人工:行悬停 ⋯ → 归档/展开回看/取消归档;删除当前会话回到新建任务视图

---

# M2.7:子代理可观测性——B 进度通道 + C 子会话(2026-07-13)✅

## B:工具进度通道(通用原语)

- [x] frame.ToolCallUpdate 增 Progress 字段(tool_call_update{status:in_progress, progress},
      旧客户端忽略未知字段,协议向后兼容)
- [x] tools.Env 增 Progress func(ProgressUpdate) + EmitProgress(nil 安全);loop 执行工具前注入
      (闭包捕获 toolCallId),defer 置空;载荷 kind: subagent_tool | output | child_session
- [x] subagent:静默 emitter → progressMapper,子代理 tool_call/tool_call_update 压缩为
      {kind:subagent_tool, id, title, status:run/ok/fail};文本/思考不透传
- [x] bash:CombinedOutput → progressWriter,≥500ms 节流上报最新完整输出行(kind:output,
      跳过内部 cwd 标记行),长命令可见"跑到哪了"
- [x] CLI renderer:`↳ ✓ 读取 auth.go` 缩进渲染子代理步骤(bash output 不刷屏,跳过);
      UI:task 工具行下嵌套子步骤、bash 显示斜体实时输出行(完成后清除)

## C:子会话一等公民

- [x] session.Meta 增 Parent;subagent 创建真实子会话(meta.Parent=主会话,title=description,
      events.jsonl 完整帧流,messages/usage/status 落盘);无 SessionRoot(--no-session)优雅降级
- [x] 进度通道公告 childSessionId(kind:child_session);OnChildFrame 钩子帧落盘后实时外发
- [x] sessions 列表默认隐藏子会话:CLI `--all` 缩进显示,server `?all=1`
- [x] server WS 观察者路径:meta.Parent 非空 → 不建引擎不收上行,持锁回放 + seq 水位订阅
      publishChild(回放/实时无缝无重帧);同进程直发,无需 tail 文件
- [x] UI:task 卡片"查看子会话"→ 弹层 SessionViewer(复用 connect+reduce 只读渲染,支持
      运行中实时跟看与事后回放)

## 验证

- [x] 单测:loop 进度注入(挂对 toolCallId、用后置空)、subagent 子会话落盘/进度序列/无根降级、
      server 观察者(列表过滤、回放 seq、上行忽略、实时分发、水位去重);全部 15 包过,gofmt/vet 干净
- [x] UI tsc strict + vite build 过
- [x] 端到端(有状态假平台:主→task→子代理 read_file→子结论→主收尾):WS 收到 child_session 公告
      与 subagent_tool run/ok 进度帧;子会话观察者回放 8 帧含子代理工具帧与结论;列表过滤与 parent
      字段正确(BC_ALL_OK);CLI 渲染 `⏺ 子代理探索 → ↳ ✓ 读取 hello.txt → ✓ 子结论`;
      sessions/--all 缩进显示子会话

# 会话级 YOLO 模式(2026-07-15)

> 计划:~/.claude/plans/fluffy-dreaming-tome.md。用户拍板:会话内随时切换(⇧Tab);
> 语义与 CLI --yolo 完全一致(完全放行);只改内核+UI,不碰壳。

- [x] policy:Engine.SetMode/Mode(加锁),decide() 改锁内快照读 mode
- [x] frame:KindSessionSetMode + PermissionModeUpdate 帧(sessionUpdate:permission_mode_update)
- [x] session.Meta 增 Mode(omitempty,空=default);newLiveSession 按 meta 恢复引擎模式
- [x] server:liveSession.setMode(幂等校验→切引擎→yolo 时排空 pending asks 自动批准→meta 落盘→广播);handleCall 接线
- [x] UI:reduce 处理 permission_mode_update(sys 行+permMode);App.tsx yolo 状态/toggleYolo(乐观+回滚)/composer 红框+pill(⚡ YOLO / 🛡 默认权限)/⇧Tab 快捷键;openSession 传 meta.mode
- [x] 修复既有竞态:startTurn 两处 Meta 写/SaveMeta 无锁,与 setModel/setMode 并发 race(-race 复现),统一持 ls.mu

## 验证

- [x] 单测:policy 运行期切换(含 sudo 危险命令 yolo 放行)+并发冒烟;server WS 切换/pending 自动批准
      (真实 write_file 落盘)/重建 liveSession 按 meta 恢复;-race ×3 全绿,全仓 go test 过,tsc 过
- [x] 端到端(新构建二进制 + 真实 serve):WS call session_set_mode → call-response + 广播帧;
      重连回放含模式帧;meta.json/sessions API 带 mode;切回 default 后 meta 清空

# 修复:中断丢弃工具结果导致会话报废(2026-07-15)

> 用户报告:多个 subagent 并行时其一报错,继续对话接不上,报 "toolcall result 不存在"。
> 根因:RunTurn 先把 assistant 的 tool_use 消息入历史,execBatch 中断时却丢弃整批
> tool_result → 悬空 tool_use 落盘,后续每轮请求被 API 拒绝
> (`tool_use ids were found without tool_result blocks immediately after`),会话永久报废。
> 多 subagent 使执行窗口长达数分钟,其一报错时用户取消轮次即触发。

- [x] loop.execBatch:中断不再丢结果——已执行的保留真实结果,未执行的补"工具执行被中断"
      占位;RunTurn 先追加结果消息再返回 ErrInterrupted,历史恒保持配对完整
- [x] loop.RepairHistory:为悬空 tool_use 补合成错误 tool_result(尾部悬空插新消息,
      后跟用户文本则插到文本块前);serve 加载会话时过一遍,救活存量损坏会话

## 验证

- [x] 单测:中断时配对完整(2 并行阻塞桩 + 1 串行未执行)+ 中断后续聊;RepairHistory
      四场景(完好不动/尾部悬空/悬空后接文本/部分缺失);-race 全绿,全仓测试过
- [x] e2e(真实网关):手工构造悬空 tool_use 会话 → 旧二进制续聊报
      "tool_use ids found without tool_result"(即用户所见错误),新二进制续聊 task-ended

# 子代理进度窗口重设计(2026-07-15)

> 用户反馈:task 卡片只显示 toolcall,模型回复文本不可见;"已省略前 N 步"不合理,
> 期望固定 3-5 行持续滚动。

- [x] progressMapper:回复文本按行上抛(kind=subagent_text,跨 chunk 拼行,单行 200 字截断,
      工具调用前/轮次结束时冲刷残余;思考流仍不上抛)
- [x] UI:subItems 重构为 feed(工具步骤+文本行时间序混排,内存上限 200 条),
      卡片固定渲染最后 5 条,旧条目自然滚出,删除"已省略前 N 步"行;
      文本行 t5 色无状态标记,工具行样式不变
- [x] 帧进事件日志(回放压缩仅丢 bash output),刷新后卡片内容不丢

## 验证

- [x] 单测 TestProgressMapperTextLines(拼行/空行跳过/冲刷时机/截断);全仓 -race 过,tsc 过
- [x] e2e(真实模型):子代理轮次产生 3 条 subagent_text(探索前说明+结论)与
      subagent_tool run/ok 混排,落盘 events.jsonl

# 单轮步数上限调整(2026-07-15)

> 用户在真实任务中撞上"达到单轮最大步数 80,任务未完成"。

- [x] 默认最终定为主循环 10000、子代理 5000(纯保险丝,交互场景靠用户取消兜底)
- [x] serve 链路接通 --max-steps(此前只有 run/chat 生效,桌面端写死 80)
- [x] 报错文案引导恢复:步数耗尽时历史配对完整,提示"回复「继续」可接着执行"

# 模型级上下文窗口配置(2026-07-15)

> 用户反馈:模型配置没有上下文大小配置,压缩预算全局写死 180k(serve 路径甚至没接线,
> 32k 小模型永不压缩直接溢出,1M 大模型 144k 就开始压缩)。
> 方案:模型清单加高级项 context_window(设置表单默认折叠),默认 200k,配了用配置值。

- [x] `internal/config/models.go`:ModelProfile 加 `context_window`(可选,负数报错)
- [x] `internal/loop`:默认预算 180k→200k;Engine.SetContextBudget(切模型时同步,<=0 回退默认)
- [x] `internal/server`:Options.ContextBudget(model) 回调;newLiveSession/setModel 接线
      (此前 serve 路径压根没接 ContextBudget,桌面端一律 180k)
- [x] `cmd/mc-agent`:serve 多模型分支提供回调;--context-budget 帮助文案改 200000
- [x] UI:HostModel 加 context_window;settings.tsx 模型卡"高级选项"折叠区
      (默认收起;已配置时折叠标题带出当前值;删除模型时折叠态复位防索引错位)
- [x] 验证:models 负值用例 + TestModelContextBudget(usage 帧 size=32000 →切模型→200000);
      全仓 go test -race 过,gofmt/vet 干净;UI tsc+build 过,uidist 重建;
      真实二进制冒烟——带 context_window 清单正常起服,负值降级零模型模式(警告不致死)

# 修复:主题等 UI 偏好重启即丢(2026-07-15)

> 用户反馈:切到亮色,重开应用又回到暗色。
> 根因:壳每次启动随机端口,localStorage 按 origin(协议+主机+端口)隔离,
> 端口一变即全新 origin——主题、项目分组折叠、归档折叠全部每次丢失。

- [x] 壳 kernel_port:端口首次分配后持久化(配置目录 port 文件),之后复用;
      被占用才换新并持久化(打警告);写盘失败不致死
- [x] save_config 重启内核改"先停旧再起新"(同端口复用前提;此前先起新再杀旧,
      固定端口下新内核必撞旧内核占用,还会把持久化端口顶掉)
- [x] README 进程生命周期一节更新

## 验证

- [x] cargo build 过;无头冒烟三场景:首启分配并落盘 45789 → 二次启动复用同端口 →
      预占端口后启动打"被占用换新端口"警告并持久化新端口

# 修复:保存配置永卡"保存中"(端口固定化的回归,2026-07-15)

> 用户反馈:保存配置一直停在"保存并重启内核中"。两个叠加原因:
> ① 端口固定后新旧 URL 仅 #token 不同,同文档导航不重载页面(原先整页重载
>   隐式依赖"端口每次都变");
> ② save_config 命令内同步导航,WebKitGTK 重放"导航时响应未送达"的 IPC
>   请求 → 同一 invoke 二次进入命令,内核被重启两次(配置塞随机指纹实锤:
>   两次调用指纹相同 = 传输层重放)。

- [x] kernel_ui_url:URL 加每次内核启动都变的 boot 查询参数,查询串变化强制整页重载;
      token 仍走 fragment 不上请求行
- [x] save_config:导航延后到命令返回之后(spawn + 200ms),先让 IPC 响应落地
- [x] 探针升级:save_config→内核重启→页面重载全链路(sessionStorage 跨重载标记,
      第二次加载报 reload-after-save-ok);script-injected 带 boot 与标记状态

## 验证

- [x] 无头端到端:script-injected(load1) → invoke-ok → save-ok(响应送达)→
      新 boot 重载(saved=1)→ reload-after-save-ok;save_config 仅执行一次;
      nav-guard-ok 回归不受影响;端口文件持久化正常

# 修复:升级重启后"继续"上下文丢失(2026-07-16)

> 用户反馈:检查更新升级 mc-desktop 后,会话提示"服务已重启,上一轮执行已中断;
> 历史已保留,请重新发送指令继续",发"继续"发现模型没有上下文。
> 根因:messages.json(模型上下文)只在轮次收尾落盘,而壳在升级重启/保存设置/
> 退出时对内核 child.kill()(SIGKILL),执行中轮次的消息全部丢失;
> events.jsonl(UI 回放)逐帧实时落盘所以界面看着完好,更具迷惑性。
> 内核本有优雅退出路径(SIGTERM/stdin 关闭 → 取消轮次 → 等落盘),壳没走。

- [x] mc-desktop/src/main.rs:新增 stop_kernel(关 stdin 管道触发内核优雅退出,
      10s 超时兜底强杀),替换 save_config 与 RunEvent::Exit 里的裸 kill
- [x] agent/internal/server:ListenAndServe 收尾逻辑抽成 drainLive(行为不变),
      补回归测试 TestDrainLiveSavesInFlightTurn 钉住"优雅停机落盘执行中轮次"契约

## 验证

- [x] cargo check 通过(mc-desktop)
- [x] 实测内核 stdin 关闭 → 0.0s 优雅退出、退出码 0(--watch-stdin 契约成立)
- [x] TestDrainLiveSavesInFlightTurn:轮次阻塞在 LLM 请求时 drainLive,
      messages.json 含本轮用户输入、meta 状态 interrupted
- [x] agent 全量 go test ./... 通过


# 重构:按新设计稿重做 agent/ui(2026-07-16)

> 设计稿:agent/ui/MonkeyCode 桌面应用设计.html(bundler 打包,已解包分析)。
> 浅色绿调 macOS 风格,四屏:侧栏 / Chat / New Task / Settings。
> 协议层(client/reduce/types)不动,视图层全部重写并拆分文件。

## 设计稿 → 功能映射决策

- 侧栏:云端任务空态 + 本地会话分组(悬停 +/⋯ 菜单:归档/删除,删除保留内联确认);
  无搜索框(设计稿删除了 ⌘K 搜索,跟随);已归档作为置灰分组
- Chat:标题栏(标题+目录+改动按钮+⋯);空会话态;用户气泡右对齐;思考单行折叠;
  工具/子代理白卡;"本轮结束"分隔线;运行条(轮次+tokens+停止);排队 chip;
  composer(权限 pill 默认/YOLO 循环 ⇧⇥ + 模型菜单 + 上下文圆环 + 发送)
- New Task:居中卡(文件夹下拉:最近目录+选择其他/手动输入)+ 本地/云端分段
  (云端显示"准备中"提示,仍建本地会话)+ 模型 + 开始任务;目录不存在确认创建保留
- Settings:外观(浅色固定,深色置灰"即将支持")/ 关于(版本+检查更新,壳内可用)/
  模型卡(可编辑,高级选项=上下文窗口)/ MCP 段保留(设计稿没画,按同卡风格)
- 主题:跟随设计稿改为浅色单主题,移除深色(mc.theme 弃用)
- 壳新增:host_info(版本)、update_check、update_install 三命令 + capability;
  macOS titleBarStyle Overlay(侧栏顶部留红绿灯拖拽区,仅 mac 壳内渲染)

## 任务

- [x] 壳:host_info/update_check/update_install 三命令 + build.rs 命令清单 +
      capability 权限 + macOS titleBarStyle Overlay(cfg 门控,未在 mac 实测)
- [x] styles.css:新设计令牌(浅色绿调)+ hover/keyframes/md 样式
- [x] icons.tsx:设计稿 SVG 图标集(20 个)
- [x] components.tsx:重样式(Markdown/Thought/Plan/Tool/Perm/Diff/LogList/本轮结束分隔)
- [x] sidebar.tsx / chat.tsx / newtask.tsx / settings.tsx:四屏重写
- [x] App.tsx:精简为状态容器 + 布局切换;client.ts 加宿主更新 API
- [x] index.html:浅色底色,移除主题闪屏脚本
- [x] 构建:tsc 零错误 + vite build(306KB 单文件)→ uidist 入库;cargo check 通过
- [x] 验证:内核 serve + 无头 Chromium 实测

## 验证

- [x] 四屏截图核对:侧栏(分组/悬停⋯菜单/归档组/连接状态)、Chat(标题栏+改动徽标、
      用户气泡、思考折叠、工具卡、本轮结束分隔线、composer 权限 pill/模型菜单/
      上下文圆环)、New Task(文件夹下拉+最近目录+手动输入、本地/云端分段、云端提示)、
      Settings(外观/浏览器只读提示)
- [x] 真实历史会话回放渲染正常(markdown 表格/代码块/子代理卡);改动抽屉 + diff 正常
- [x] 全程无 pageerror/console error
- [ ] macOS 红绿灯 Overlay 与桌面壳内 关于/检查更新 卡片待真机回归(本机无 mac/无显示)


# 2026-07-16:Windows 自绘标题栏 + Windows 自动更新

> 计划:~/.claude/plans/cozy-enchanting-crescent.md(已批准)
> 取向:36px 细自绘标题栏;更新清单拆分端点(latest-windows.json / latest-win7.json)

## A. Windows 无边框 + 自绘标题栏

- [x] main.rs:主窗口 Windows 分支 decorations(false)
- [x] tauri.conf.json:kernel-ui 加 window 权限(已对照 gen/schemas 核实名字)
- [x] client.ts:isWindowsShell + 窗口控制封装
- [x] titlebar.tsx(新):36px 标题栏(拖拽区 + 最小化/最大化/关闭)
- [x] App.tsx:根布局改 column + 条件渲染 TitleBar

## B. Windows 自动更新

- [x] tauri.windows.conf.json:updater 端点 → latest-windows.json
- [x] main.rs:build_updater 加 on_before_exit 回收内核(防 NSIS 文件占用)
- [x] gen-latest-json.py:平台模式 macos/windows/win7
- [x] Makefile:windows-release 目标
- [x] desktop-windows.yml / desktop-win7.yml:secret + release 构建 + 清单 + artifact
- [x] README:发布流程文档

## 验证

- [x] agent/ui npm run build 过;mc-desktop cargo check 过
- [x] gen-latest-json.py 三模式假产物 dry-run
- [ ] 推 CI 核对产物(exe + .sig + 清单)
- [ ] Windows 实机人工验证(标题栏 + 更新全链路)

## Review

- 标题栏:壳 Windows 分支 decorations(false);UI 新增 titlebar.tsx(36px,拖拽区 +
  最小化/最大化-还原/关闭,close hover 红底白字),App 根布局改 column 条件渲染;
  窗口命令走 core.invoke("plugin:window|…")(与 dialog/opener 惯例一致),权限名
  已对照 gen/schemas 核实。关闭按钮走壳的 CloseRequested 拦截 → 隐藏到托盘。
- 自动更新:根因 = Windows 构建无签名 updater 产物 + latest.json 无 windows 条目。
  端点拆分(latest-windows.json / latest-win7.json),gen-latest-json.py 平台模式化,
  两条 Windows CI 加 secret 发布构建(无 secret 降级不红),Makefile 加 windows-release。
  关键坑修复:updater 在 Windows 硬退进程不走 RunEvent::Exit,build_updater 加
  on_before_exit 先 stop_kernel,否则 mc-agent.exe 锁文件 NSIS 安装必败。
- 验证:tsc+vite 过;cargo check 过;清单脚本三模式假产物 dry-run 结构正确;
  无头 Chromium 截图(mock Windows 壳)标题栏渲染正确,浏览器模式无标题栏。
- 遗留:现存 Windows 安装端点烧的是 latest.json,需手动重装一次进新通道(已确认接受);
  Win11 无边框失去最大化按钮 hover 的 Snap Layouts 弹层。

# 功能:会话支持粘贴/拖拽图片(2026-07-16)

> 方案(与用户对齐):图片落成工作区文件 + 对话文本附路径,模型经 read_file
> 查看——不动 RunTurn/帧协议/压缩,图片可被工具二次处理(裁剪/OCR/素材)。
> 三协议对齐:Anthropic 原生 tool_result 图片块;OpenAI Chat/Responses 的
> 工具结果不支持图片(协议限制),序列化层转"占位文本 + 合成 user 图片消息",
> 归一化历史仍是标准 tool_result 块,跨协议切模型一致。

- [x] provider:BlockImage/ImageSource/tool_result Blocks;anthropic 线格式转换;
      openai/openai_responses 降级转换(flattenToolResult)
- [x] tools:BlocksTool 接口;read_file 图片分支(解码/1568px 缩放/重编码,
      x/image 依赖;小图原字节直传);工具描述更新
- [x] loop:execToolUse 走 BlocksTool,单文本块压平;compact 摘要图片占位 [图片]
- [x] server:POST/GET /api/sessions/{id}/uploads(白名单/20MB 上限/防穿越/
      uploads/.gitignore 自免疫)
- [x] UI:composer 粘贴/拖拽(蒙层)→ 上传 → 缩略 chips(可移除)→ 发送拼
      [图片] 路径行;用户气泡缩略图 + 点击大图;排队兼容

## 验证

- [x] Go 单测:三协议 wire 形状 ×3、read_file 图片分支 ×4、上传路由(含防穿越)、
      集成(read_file 读图 → 图片块进入下一次 LLM 请求历史);全量 go test 通过
- [x] UI 端到端(无头 Chromium):拖入 PNG → chip → 发送 → 气泡缩略图加载成功
      (naturalWidth=100)→ 文件落盘 .mc-agent/uploads/ + .gitignore;无 console 错误
- [ ] 真实视觉模型冒烟(本机无可用 vision key,待网关 key 后补)

# 修复+增强:壳内拖拽失效 + 附件放开为任意文件(2026-07-16)

> 用户反馈:粘贴可用但拖拽不行;且希望能传文件。
> 拖拽根因:Tauri 默认原生 drag-drop 处理器在窗口层吞掉文件拖拽,
> HTML5 drop 事件到不了页面(无头浏览器测试无壳,故未暴露)。

- [x] 壳:WebviewWindowBuilder.disable_drag_drop_handler()
- [x] 内核:上传路由放开任意类型;保留清洗后的原始文件名(路径穿越清洗、
      重名序号、空名回退时间戳);GET 非图片按 octet-stream + attachment
      下发(防 html 同源渲染执行)
- [x] UI:粘贴/拖拽收所有文件;非图片渲染文件名 chip;气泡 [文件] 行渲染
      可下载 chip;[图片]/[文件] 前缀区分

## 验证

- [x] go test 全绿(上传测试改为任意类型 + 原名保留 + octet-stream + 穿越清洗)
- [x] 无头端到端:同时拖入 PNG + "启动日志 v2.log" → 双 chips → 发送 →
      气泡缩略图 + 文件 chip → 工作区两文件落盘(原名保留)
- [ ] 壳内拖拽待真机回归(disable_drag_drop_handler 需重新打包)

# 增强:模型视觉能力门禁(2026-07-16)

> 用户看到请求里的大段 base64 质疑可用性。base64 内嵌本身是多模态 API 的
> 标准形态(API 入口解码,不进文本 token);真正的问题是非视觉模型收到
> image 块的行为不可控(网关报错或把 base64 当文本烧 token)。

- [x] config.ModelProfile 加 vision 字段(缺省 false = 安全默认不发图)
- [x] loop:Options.Vision + SetVision;非视觉模型的图片块降级为文本占位
      (提示去设置开启或用工具按路径处理)
- [x] server/serve:ModelVision 接线(镜像 ContextBudget 模式),切模型同步
- [x] 设置 UI:模型卡"支持图片"勾选框
- [x] 测试:vision 模型图片块进下次请求(原集成测试加标记);非 vision 模型
      得到占位文本且无图片块;全量 go test + tsc + 构建通过

# 偿债:agent/ui 架构三项(2026-07-16)

> 评审结论:reduce.ts 零测试、App.tsx→ChatView 22 个 props 钻透、
> 重复内联样式无复用机制。三项全做,协议层行为不变。

- [x] 1. reduce.ts 补单测(vitest)
  - [x] b64/frameData 纯函数从 client.ts 抽到 codec.ts(client.ts 顶层有
        location/prompt 副作用,node 环境不可导入;分层也更干净)
  - [x] vitest 装入 devDependencies + test script
  - [x] reduce.test.ts:24 例——流式聚合、工具生命周期、进度窗口(MAX_FEED)、
        计划卡原地更新、审批状态机、user-input 解码、task-error、
        usage/model/permMode 回写、批量归约、未知帧透传
- [x] 2. 会话状态收进 useSession hook,解掉 ChatView props 钻透
  - [x] src/useSession.ts:WS 连接、chat 归约、composer(input/queued/atts)、
        模型/权限切换、改动查询统一收口(SessionHandle 句柄)
  - [x] ChatView 22 props → 8(meta/session/models/currentModel + 4 个布局回调)
  - [x] App.tsx 只留布局切换、App 级浮层、新任务表单(652 → ~450 行)
- [x] 3. 重复内联样式抽 CSS class(styles.css)
  - [x] .ellipsis/.icon-btn/.backdrop/.pop/.menu-item/.card(-lg)/.spinner;
        chat/sidebar/newtask/settings/components/App 六文件替换使用点,
        删掉 menuItem×2/iconBtn/dropdownItem/cardStyle/card 六个重复常量
  - [x] 一次性数值仍内联(不破坏"数值对应设计稿"的约定)
- [x] 4. 验证:vitest 24/24 绿;tsc + vite build 过(uidist 已更新);
        go build ./... 过;serve 冒烟(healthz / 内嵌 UI / REST 会话列表)正常

## Review(偿债三项)

- 新增 codec.ts(纯编解码)、useSession.ts(会话句柄)、reduce.test.ts;
  行为不变的收口重构,协议层 client/reduce 未动逻辑。
- 遗留:newtask 文件夹下拉原先无入场动画,统一 .pop 后带 mcin .15s(视觉
  微调,与其余菜单一致);设置页 input/select/whiteBtn 本就是单点常量,未动。
- 追加(2026-07-17):颜色令牌化收尾——46 处内联字面量并入 :root 语义令牌,
  预埋 [data-theme="dark"] 空壳与 Chromium 109/Win7 兼容红线注释(禁
  color-mix/相对颜色/嵌套/light-dark,透明变体独立令牌)。
- 提交前 8 视角 review:3 个正确性视角零 bug;修掉 10 项——call-response
  坏载荷挂 15s、connected 字符串推导误翻断线、lastSession 键两处硬编码、
  齿轮激活底/分隔点/禁用态三处设计稿色值保真(--accBg2/--t7/--tDis)、
  --track/--segBg 改 var() 引用、--shadowZoom 并入 --shadowLg、侧栏分隔
  线归 --line、openSession 去掉无谓 useCallback+eslint-disable。
- 后续可选:SessionViewer 复用只读帧流核(useFrameStream 方向);
  useSession 的 model/yolo 镜像 state 可派生化;basename 三处同型逻辑
  下沉公共模块(注意 Windows 反斜杠路径);深色模式落地时样式原语已就位。

# 功能:百智云登录 + 模型/MCP 自动同步(2026-07-17)

## 背景与结论

- 不改 MonkeyCode 后端,桌面直接对接 baizhi.cloud(移动端同源方案)。
- 登录协议移动端已完整逆好:Cap.js PoW 验证码(`mobile/src/api/captcha.ts`,算法与服务端 go-cap 对齐)
  + 手机验证码登录(`mobile/src/api/baizhi.ts`:challenge/redeem → phone_code → login/phone → cookie 会话)。
- 拿到 cookie 后可访问 `ai-api-gateway.app.baizhi.cloud`(模型)与
  `agent-toolkit.app.baizhi.cloud`(MCP),自动同步模型与 MCP 配置。
- 两服务 API 形态未测绘(无 cookie 时全 401,仓库内无对接痕迹)→ 阶段 0 先侦察。

## 架构决策

- **壳零改动**:配置所有权仍在壳;登录与同步全部落在内核 + 内核 UI。
- **内核代理一切 baizhi 流量**:UI 跑在 127.0.0.1 origin,对 baizhi.cloud 带凭证跨域会被 CORS 拦;
  Go 客户端无此约束。内核在本地 HTTP 上暴露 /api/baizhi/*。
- **同步产物写入 models.json/mcp.json**:UI 拿内核返回的清单合并进设置表单,
  走现有 save_config → 壳落盘 → 重启内核。条目打来源标记(source=baizhi),
  再次同步只增量更新/清理自家条目,不碰手工条目。
- **产品形态:一次性向导**:登录一次换出长期凭证进配置,之后不依赖登录态;
  cookie 持久化(0600)仅供"重新同步",过期引导重登。

## 阶段 0:API 侦察(部分完成;字段结构待真实 cookie)

三地址私有化可配(用户纠正):账号域 / 模型网关 / MCP 网关独立配置,
默认官方云,已落 `internal/baizhi/endpoints.go`
(环境变量 MC_AGENT_BAIZHI_URL / _MODEL_GATEWAY / _MCP_GATEWAY)。

无 cookie 侦察结论(从公开前端 bundle + 状态码探测):
- 两网关都是长亭自研 SPA,与 baizhi.cloud 共享 `sl-session`(SameSite=None),
  疑似统一 SSO;**网关层统一 401**(连不存在路径也 401),端点存在性无法靠探测区分
- **ai-api-gateway(模型)REST 契约已从 bundle 挖到**:
  - `GET /api/console/api-keys?page&pageSize` 列 key;`POST /api/console/api-keys` 建 key;
    `POST /api/console/api-keys/{id}/rotate` 轮换(暗示密钥可能仅建/轮换时明文返回)
  - `GET /api/console/models?…` 列模型;`GET /api/console/providers`;`GET /api/console/me`
  - 推理 base_url = `<网关>/api/openai`(chat/completions、responses)与 `/api/anthropic`(v1/messages),
    与移动端 ai-models.app.baizhi.cloud、Web model-square 同构
- **agent-toolkit(MCP)契约未知**:bundle 深度 minify,API 路径运行时拼接、
  前端路由仅见 apps/services/api-keys/usage;需真实 cookie 抓包

- [x] 账号域可配 + 两网关地址可配(私有化)
- [x] ai-api-gateway REST 端点路径与分页形态测绘
- [x] ~~需真实 cookie~~ 已实测(见阶段 2):api-keys 列表仅掩码、POST 创建才给明文;
      models 字段确认;登录 cookie 直接可用于网关(baizhi_session 域 cookie + 网关自发 sl-session)
- [x] agent-toolkit MCP 端点与响应结构(bundle 测绘完成;真实响应待团队开通权限)

## 阶段 1:内核 baizhi 客户端 ✅

- [x] `agent/internal/baizhi`:Cap.js PoW 求解器(黄金值由移动端 JS 实现生成,钉住跨实现一致性)
- [x] 登录客户端:challenge/redeem → phone_code → login/phone;cookie 存储自实现
      (RFC 6265 域后缀/路径匹配,Domain 不匹配请求 host 时降级 host-only),0600 落盘、重启恢复
- [x] serve 本地路由:/api/baizhi/send-code /login /status /logout;
      server 经 Options.AuthRoutes 钩子挂载,对业务零知识
- [x] 假服务端 e2e:发码→登录→status(profile)→内核重启恢复→登出全链路验证
- [x] 微信扫码登录:内核扮演 qrconnect 页面(网页版微信同款协议)——
      oauth/login?platform=wechat → 解析授权页二维码 uuid → 长轮询
      lp.open.weixin.qq.com(408 待扫/404 已扫/403 取消/402|500 过期/405 出码)
      → 带 cookie jar 走百智云回调换会话;/api/baizhi/wechat/{start,poll};
      真实环境无头冒烟通过(真二维码 + waiting),仅"扫码确认→回调"待真机验证
- 侦察发现(误连真实 baizhi.cloud 顺带确认):challenge 端点返回 **HTTP 201**
  (已按 2xx 判成功,对齐移动端 res.ok);匿名会话 cookie 名 `sl-session`(host-only+secure)

## 阶段 2:同步 ✅(2026-07-17 真机测绘重写 + 真机 e2e 通过)

> 推翻此前"切个人 space"方案:真机 `GET /api/console/spaces` → 404,console API
> 是**扁平**的,团队 space 会话可直接列模型/管密钥,无切换概念。

模型网关(ai-api-gateway)真机契约(全部带真实 cookie 实测):
- `GET /api/console/models?page&pageSize` → items{name,interfaceType,enabled,healthStatus,…}
- `GET /api/console/api-keys` → 仅 maskedKey 掩码;**明文只在创建时返回一次**
- `POST /api/console/api-keys {name}` → data{id,key(明文),enabled:**false**(默认停用)}
- `PATCH /api/console/api-keys/{id} {name,enabled}` 启用(name 必填,否则 400)
- 推理 base_url:`<网关>/api/anthropic`(x-api-key)/ `<网关>/api/openai`(Bearer),
  双协议真机推理冒烟 200;`/api/console/me` 返回 spaceId/isTeam
- 探测所建临时 key 均已删除(DELETE /api/console/api-keys/{id} 可用)

MCP 网关(agent-toolkit)契约(子代理挖前端 bundle;本账号团队未开通 app_id=39,
`/api/v1/*` 一律 302 权限申请页,响应结构待有权限账号复核):
- 管理 API 同源 `/api/v1/*`,cookie 鉴权;包壳 code 为字符串 "ok";
  **每 host 独立 sl-session**(先 GET / 领取)
- `GET /api/v1/services`(catalog_code)/ `GET /api/v1/api-keys`(masked_key,status)/
  `GET /api/v1/api-keys/{id}/reveal` → **明文可随时取回** / `POST /api/v1/api-keys
  {name,tool_codes}` / `POST /api/v1/api-keys/{id}/enable`
- 运行时**单端点** `<MCP 网关>/mcp`(Streamable HTTP,Authorization: Bearer)→
  mcp.json 只产出一个条目(baizhi-toolkit)

- [x] `sync.go` 重写:扁平 API;密钥策略=known_keys 掩码前后缀匹配复用(停用先
      PATCH 重启用)→ 都对不上才新建"MonkeyCode"并启用;MCP=握手→services→
      ensureMCPKey(reveal 优先/只重启用自家同名/新建授权全部 tool_codes)→单条目
- [x] 密钥名全局唯一(真机 409"名称已存在",用户桌面同步已建 MonkeyCode 后
      浏览器端撞名 502 复现):pickKeyName 从列表选不冲突名(MonkeyCode-N),
      不动同名旧 key(明文可能在别的设备用);SyncResult 带 key_name 供 UI 展示
- [x] `POST /api/baizhi/sync` 收 {known_keys};UI 传设置表单现有 sk- 密钥,
      结果按名合并(不删手工条目),key_created/key_name 提示新建
- [x] 单测 8 例:新建+启用(PATCH 带 name)/复用/停用重启用/撞名换名/掩码匹配/
      MCP reveal/MCP 新建 tool_codes/未开通 302 优雅降级
- [x] **真机 e2e**(真实 cookie + 真内核 serve):46 模型拉回、known_keys 复用不新建、
      base_url/协议映射正确、MCP 未开通降级 note;账号零残留
- [ ] MCP 真实数据复核(阻塞:团队需开通 Agent 工具包,或换已开通账号跑一次同步)
- [ ] 源标记:HostModel 无 source 字段,当前按"同名覆盖"合并;若要"重同步清理旧条目"需加 source

## 阶段 3:UI(agent/ui 设置视图)

- [x] 百智云账号卡片:微信扫码(默认,自动拉码 + 状态提示 + 过期重取)/
      手机验证码(60s 倒计时)双模式;已登录态展示 + 登出;设置视图新增「百智云账号」段
- [x] 同步结果挑选面板(2026-07-17,用户反馈"不能选"):同步结果先进勾选列表
      (已在表单的同名条目默认勾选=重同步刷新,新条目手动挑;全选/清空;MCP 独立
      开关;notes 面板内展示)→「导入所选」才合并进表单;无头 Chromium 实测
      (46 模型面板/勾选计数/导入文案含实际密钥名)
- [ ] 登录成功 → 自动 sync → 同步结果预览 → 确认合并 → save_config 保存重启(等阶段 0/2)

## 阶段 4:验证

- [ ] 真机全链路:登录 → 同步 → 用同步模型建会话跑任务;MCP 工具会话内可用
- [ ] 坏路径:验证码错误、cookie 过期、同步 401、风控拦截 → 明确报错可重试,不致死

# 模型来源分组 + 独立设置窗口(2026-07-17,用户反馈)✅

> 反馈:① 同步的几十个模型平铺淹没设置页与模型下拉,应作为一个分组;
> ② 设置页经常被意外退回(根因:全局 Esc 无输入守卫,表单里按 Esc 冒泡退出;
> 次因:保存后整页重载回默认视图)。方向拍板:设置改独立窗口。
> 计划:~/.claude/plans/ticklish-sparking-kay.md(已批准)。

## source 分组贯通

- [x] 数据层:ModelProfile/server.ModelInfo/UI 类型加 source(omitempty 纯增量,
      会话绑定仍按 name;壳 opaque 透传零改动);serve ListModels 组装补 Source
- [x] 设置页:模型卡分两节——手工平铺 +「百智云(N)」折叠分节(默认收起,
      导入后自动展开供核对);modelCard 抽函数,回调恒用真实数组索引
- [x] ModelPicker(新任务/状态栏共用):按来源分桶(自定义前、百智云后,节头
      小标题),弹层 maxHeight 320 滚动;>10 个模型时顶部过滤框;menuModels
      下线模型兜底项归自定义组
- [x] 同步导入语义:applySynced 补回被丢弃的 source;改"替换 baizhi 组"——
      手工条目保留、百智云组整体替换为勾选集合(取消勾选即清理);默认模型
      按名重定位;挑选面板预勾选改为"表单里 source=baizhi 的同名条目"

## Esc 意外退出修复

- [x] App 全局 Esc:settings 退出分支加输入守卫(INPUT/TEXTAREA 内只 blur);
      独立设置窗口的 Esc 同守卫(非输入态关窗)

## 独立设置窗口(同一内核 React UI,不分裂技术栈)

- [x] 壳:KernelUrl managed state(M2.13 删除的模式复活,setup/save_config 两处
      写入);open_settings_window 命令 + open_settings(存在聚焦/否则建
      "settings" 窗口加载 当前URL&view=settings#token,原生装饰,共用导航守卫
      is_internal_url);托盘「设置」改开独立窗口;save_config 重启后设置窗口
      一并导航到新令牌 URL 并夺回焦点
- [x] ACL:kernel-ui capability windows 加 "settings";build.rs 命令清单 +
      allow-open-settings-window(远程源自定义命令须显式授权,bb1574e 教训)
- [x] UI:main.tsx 按 ?view=settings 分流 → SettingsWindow(全屏设置视图,
      不建 WS/不恢复会话,返回/Esc 关窗);client.ts openHostSettings/
      isSettingsWindow;⚙ 桌面壳开独立窗口、浏览器模式回退页内视图;
      首启零模型向导维持页内(main 窗口)

## 验证

- [x] agent:go test 全量 + vet 过(source 透传/api-models 断言新用例);
      UI tsc + vitest 24 例 + build(uidist 入库)
- [x] 无头 Chromium(真 serve + 带 source 清单):下拉分组节头与顺序、
      13 模型出过滤框且过滤生效、?view=settings 只渲染设置视图(无侧栏)、
      设置页百智云节 2→5 卡折叠展开、Esc 输入框内不退出/非输入关窗、
      ⚙ 调 open_settings_window 且不切页内视图;截图核对
- [x] 壳:cargo build 过;xvfb+dbus 无头端到端(隔离 XDG_CONFIG_HOME):
      设置窗口以 view=settings 创建、其 remote ACL 生效(settings-invoke-ok)、
      save_config 重启后双窗口都换新 boot URL、nav-guard/save-reload 回归全过
- [ ] Mac/Win 真机人工:托盘「设置」、⚙ 开窗、保存后设置窗口存活且 main 刷新

## 提交前 review(8 角度 × 逐项验证)修复 10 项

- [x] **Windows 死锁**:open_settings_window 同步命令建窗会死锁(tauri doc 明示,wry#583)→ 改 async
- [x] **MCP-only 导入清空模型组**:勾 0 模型只导 MCP 时替换语义把已有 baizhi 组删光
      (模型改名场景不点清空也触发)→ applySynced 对空模型集只并 MCP 不动模型组
- [x] **Esc 误拒审批**(存量,同函数内):deny 分支补 typing(blur)/SELECT/isComposing/
      !isNewView 四重守卫(Enter 分支本有,恢复对称);settings 分支共用
- [x] **KernelUrl 陈死白窗**:save 重启失败后旧 URL 未清 → stop_kernel 时同步 take(),
      失败态落回 show_any_window 回退
- [x] **设置窗 Esc 丢未保存编辑**:挑选面板捕获相先消费 Esc(只关面板);窗口守卫补 SELECT
- [x] **存量无 source 条目兼容**:预勾选放宽为"baizhi 或无 source 的同名条目"
      (旧版同步落盘的条目重同步即迁移归组)
- [x] **折叠分节吞默认标记**:加载时默认模型在同步组则初始展开
- [x] 死代码:onHostEvent("open-settings") 监听 + client.ts helper 删除,README 同步更新
- [x] source 单一事实来源:types.ts SOURCE_BAIZHI + modelSourceLabel 共享(chat/settings
      复用),Go 侧 sourceBaizhi 常量,两侧注释互指
- [x] SettingsWindow 去掉自动 updateCheck(壳自检+主窗口已查,窗口关闭即销毁场景纯冗余)
- [x] 回归:go test/vet、tsc+vitest+build、cargo build 全过;无头 Chromium 分组冒烟全过;
      xvfb 壳端到端全链路(main 重载 saved=1 + reload-after-save-ok + 设置窗新 boot +
      settings-invoke-ok + focus 路径 + nav-guard)——期间修了探针自身时序伪影:
      外域导航测试与 save 整页导航交叠会被 WebKitGTK 吞掉后者,外显为"主窗口不重载"
      的假故障,测试延后到 +6s 错开

# 设置页重设计:账号优先 + 左导航 + 保存条 + 紧凑行(2026-07-17,用户反馈)✅

> 反馈三连:① 独立窗口还有「返回」(页内遗留);② 保存埋在长滚动底部不明显;
> ③ 分组后仍密密麻麻(46 模型 46 张大卡平铺)。产品定位确认:MonkeyCode 是百智云
> 旗下产品,账号优先(登录→同步为主路径)。计划:~/.claude/plans/ticklish-sparking-kay.md。

- [x] 拆分:settings-ui.tsx(共享表单原语)+ baizhi.tsx(BaizhiCard 迁出,登录态改受控);
      settings.tsx 重写为 SettingsShell
- [x] 左侧分类导航(百智云账号/模型/MCP/通用,默认账号页):复用 sidebar 选中态令牌
      (--accSel 底+--onAcc 字+500 字重),图标+文字;「返回」仅页内模式渲染(standalone
      独立窗口不渲染)——问题①
- [x] 脏状态保存条:payloadOf 归一化(save 与 dirty 比较同源)+ baseline/snapshot 快照;
      dirty 时底部浮现「有未保存的更改」+[放弃更改][保存];放弃从快照复原——问题②
- [x] 模型紧凑行 + 手风琴编辑:40px 行(名/provider 徽标/✓默认/hover 操作)点击行下展开
      现有编辑表单;百智云组在前(可折叠)+ 自定义组在后(高级路径,空态虚线卡);
      回调恒用真实索引(review 教训)——问题③
- [x] MCP 同款紧凑行 + 展开;新增即展开末行编辑
- [x] 账号优先:默认进账号页;模型/MCP 页未登录顶部引导条「去登录」;同步导入后自动切模型页;
      首启零模型落在账号登录引导(不再逼手工填模型)
- [x] dirty 关闭确认:SettingsWindow(Esc/onClose)+ App 页内(Esc/返回)dirty 时 confirm;
      输入态 Esc 仍先 blur(第二次才关);挑选面板捕获相/SELECT/MCP-only 守卫全保留
- [x] 壳设置窗口 760×720 → 900×660 + min 760×560(左导航需要横向空间)
- [x] 验证:tsc + vitest + build(uidist 入库)+ cargo build 全过;无头 Chromium——
      四分类页截图核对、8 紧凑行、展开编辑、改字段→保存条浮现→放弃复原、百智云组折叠 8→3、
      dirty+双击 Esc→confirm→关窗、浏览器页内有返回/独立窗口无返回/浏览器只读;
      xvfb 壳端到端(保存重启双窗口导航/settings ACL/nav-guard)全链路回归通过

# 撤独立设置窗口回归页内 + MCP 按来源分组(2026-07-18,用户反馈)✅

> 反馈:① 首启主窗口双侧栏(主侧栏+设置左导航)很怪 → 用户提议"干脆不做独立窗口";
> ② MCP 没区分百智云/自定义。方向拍板:撤独立窗口回页内 + 设置态占满主窗口。
> 计划:~/.claude/plans/ticklish-sparking-kay.md。

## Part A:撤独立设置窗口,回归页内 + 设置态占满

- [x] 删壳独立窗口足迹:KernelUrl 状态(struct/manage/setup/save 共 5 处)、
      open_settings_window 命令、open_settings 函数(含 900×660 尺寸与 settings 探针)、
      settings_ui_url、save_config 双窗口导航块、主窗口探针 open-settings-invoked;
      build.rs 命令、tauri.conf windows["settings"]+allow-open-settings-window
- [x] 删 UI 独立窗口:client.ts openHostSettings/isSettingsWindow、main.tsx 路由(只渲染 App)、
      settings.tsx SettingsWindow 组件/windowClose import/standalone prop
- [x] 改回页内:壳托盘「设置」→ show_any_window + emit_to("main","open-settings")(补回 Emitter);
      client.ts 恢复 onHostEvent;App onOpenSettings→setView("settings")、恢复 open-settings 订阅;
      settings 左导航「返回」恒渲染(页内需要退回);README 措辞
- [x] 布局:App 内容行 view==="settings" 时不渲染主 Sidebar,设置占满(单侧栏);
      sidebar 删 settingsActive prop;设置左导航顶部为 mac 红绿灯预留拖拽区(isMacShell)
- [x] 连根拔掉独立窗口引入的一串 review 问题:Windows 建窗死锁、陈死 URL 白屏、
      跨窗口丢编辑、双窗口导航、dirty 跨窗口确认——全部随删除消失

## Part B:MCP 按来源分组(方案①:source 塞进每个条目)

- [x] 内核 mcp/config.go:ServerConfig 加 Source(对称;内核不解释,解析无 DisallowUnknownFields
      本就容忍未知字段);baizhi/sync.go mcpServers() 产出加 source=baizhi
- [x] UI settings.tsx:McpEntry 加 source;serversToMcps 读 / mcpsToServers 回写(随 mcp.json 落盘保真);
      applySynced MCP 改整组替换(手工保留、百智云组整替、空集不清组);mcpSection 拆
      「百智云 MCP(N)」组(可折叠,前)+「自定义 MCP」组;mcpRow 改 fragment + mcpGroupCard
- [x] 壳零改动(opaque 透传);agent-toolkit 未开通同步暂不产出 MCP,结构先就位(mock 验证)

## 验证

- [x] go test/vet/gofmt(mcp config source 透传 + 未知字段容忍新用例、sync MCP source 断言);
      tsc + vitest + build(uidist 入库);cargo build
- [x] 无头 Chromium:首启零模型→设置占满主窗口(无主侧栏/无双侧栏)+ 返回回主界面;
      ⚙ 进页内设置占满;MCP 分「百智云 MCP(1)/自定义 MCP」组;source 往返(保存后百智云条目
      保留 source、手工条目无 source、编辑正确落盘);截图核对
- [x] xvfb 壳端到端:托盘 emit 链路;save→重启→主窗口 reload-after-save 回归;
      探针删设置窗口相关上报后 open-settings-invoked/settings-* 消失、opener/nav-guard 保留
- [ ] Mac/Win 真机人工:设置态无主侧栏布局、mac 红绿灯拖拽、托盘设置唤起

## Review 修复(83e1e80 的 review 发现)

- [x] 壳→UI 意图就绪保障:UiIntent 待取状态 + take_ui_intent 命令,前端事件+启动双通道消费(修托盘事件丢失/启动竞态)
- [x] open-settings 统一走 openSettings()(复位抽屉/查看器,修遮罩盖设置页)
- [x] MCP 同步合并:同名手工条目保留不被吞(MCP 导入无逐条勾选)
- [x] McpEntry 透传未知字段(extra),保存不再丢 disabled 等
- [x] MacDragSpacer 共享组件(50px),修设置页 40/50 漂移
- [x] 主窗口 min_inner_size 兜底
- [x] settings.tsx 去重:groupCard 泛型 + replaceBaizhiGroup + collapseToggle
- [x] onWindowResized 委托 onHostEvent
- [x] 冒烟探针补 take_ui_intent 与 event.listen ACL 探测
- [x] 重建 uidist + go test + cargo check + UI typecheck

# 浏览器控制能力(自研 MV3 扩展 + 内核桥接,零 Node 依赖)

## 背景

给 mc-desktop 加"操作浏览器"能力。产品决策:控制用户日常真实浏览器(共享登录态)、
不依赖 Node(排除 Playwright MCP)、扩展做哑 CDP 代理、浏览器语义全在 Go 内核。
方案文档见 ~/.claude/plans/humming-finding-graham.md。

## 实施

- [x] S1 协议:internal/browser/protocol.go(op/事件/错误码,扩展侧 protocol.ts 镜像)
- [x] S2 MCP 图片透传:tools.ImageBlockFromBytes 导出 + mcp agentTool.ExecuteBlocks
      (修掉截图被丢成占位文本 tool.go:152,浏览器类 MCP 从此可用视觉)
- [x] A1/A2 bridge.go(独立 loopback listener 7440 顺延、配对码→长期 token、
      单连接新顶旧、ping 保活)+ cdp.go 薄客户端(12 个 CDP 方法,无第三方库)
- [x] A3/A4 session/refs/snapshot/keys/ops + 9 个 browser_ 工具
      (snapshot 注入 JS 枚举 150 元素上限、ref→RemoteObjectId、截图 BlocksTool、
      JS 对话框自动处理、Page.frameNavigated 失效 ref)
- [x] A5 policy:browser_ 前缀分支(快照/截图/滚动/tabs.list 放行,交互统一
      rememberKey="browser" 一次记住全放行)
- [x] A6 装配:serve --ext-addr/--no-browser、server.Options.Browser、
      newLiveSession 注册、/api/browser/status|repair
- [x] B 扩展 browser-extension/(TS+Vite MV3,debugger/tabs/storage/alarms +
      127.0.0.1 host_permissions,popup 交付/收回,options 配对,vitest 19 用例)
- [x] C1 设置页「浏览器」分类:BrowserExtCard(状态/配对码/引导/重新配对,5s 轮询)

## 验证

- [x] go test ./... 全绿(bridge 配对/鉴权/顶替/事件/租约 10 用例、snapshot/ref/
      keys/policy 决策表、MCP resultToBlocks);gofmt/vet 干净
- [x] ui: tsc + vitest 25 用例 + uidist 重建;扩展: tsc + vitest 19 用例 + dist 构建
- [x] **真实端到端(e2e_test.go,Chromium+扩展实机)**:配对码配对 → navigate →
      snapshot(ref 列表)→ click(标题变化验证)→ type(值回读)→ select_option →
      screenshot(BlockImage 断言)→ tabs(受控标注)→ 导航后旧 ref 报错引导重新
      snapshot → 断线自愈重连。无 Chromium/dist 的环境自动 Skip
- [ ] 真机人工:桌面壳里配对真 Chrome、已登录站点交付操作、审批只弹一次、
      Edge 复跑(本机无带头浏览器,待用户环境验证)

## 排障记录(e2e 揭出的真问题与修复)

- coder/websocket OriginPatterns 匹配的是 Origin 的 host(即扩展 ID),
  "chrome-extension://*" 永不匹配 → 扩展握手 403。改 InsecureSkipVerify
  (信任根本就是 token/配对码 + authorize 的扩展 ID 绑定)
- **配对码一次性语义有致命窗口**:连接在扩展持久化 token 前夭折(半死连接)
  会吞掉配对码,扩展带旧码重试永败。改为"token 连入确认后才作废配对码",
  每次用码重新颁发 token —— 真实网络抖动同样受益
- 本机 Chromium(playwright chromium-1155)冷启动怪癖:SW 实例网络请求
  挂起 ~20s 而空闲回收 ~10s,产生半死连接/活锁。e2e 用 options 页 2s 消息泵
  保活 SW 跨过挂起窗口;真实桌面环境无此现象(内核 20s ping 覆盖 30s 回收)

## Review

改动面:内核新增 internal/browser(8 文件+3 测试),policy/serve/server 各一小段,
tools/image.go 抽公共函数,mcp/tool.go 加 ExecuteBlocks;新子项目 browser-extension/;
UI 一卡片一图标两封装。未触碰 loop/provider/session 核心链路;CLI 模式不受影响
(不注册浏览器工具);MCP 图片透传独立成段可单独回滚。

## 增补:扩展随桌面安装包分发(2026-07-19)

- [x] tauri.windows/macos.conf.json bundle.resources 捆绑 ../browser-extension/dist
      → 安装后落地 resources/browser-extension(win7 继承 windows overlay)
- [x] 壳命令 open_extension_dir(资源目录优先,dev 回退仓库 dist;reveal 定位)
      + build.rs ACL + kernel-ui capability
- [x] 设置页引导改双态:桌面壳内「打开扩展目录」按钮一键定位;浏览器模式保留仓库路径文案
- [x] CI 三条桌面流水线 + Makefile macos/windows 目标加扩展构建(资源缺失会打包失败,前置硬依赖)
- [x] cargo check / tsc / vitest / uidist 重建全绿
- [ ] 后续:Chrome Web Store / Edge Add-ons 上架,设置页改商店直链(载入未打包扩展
      仅作过渡——Chrome 每次启动会提示停用开发者模式扩展)

## 增补:多会话并行 + 后台操作(2026-07-19)

- [x] 桥:全局租约(一次一个会话)→ 会话注册表 + tab 归属表,扩展事件按 tabId
      路由到属主会话;handoff 进待领队列(FIFO,会话按需认领)
- [x] 去前台抢占:删除 click/type/press/screenshot 前的 tabs.activate
      (CDP 键鼠/截图直达渲染进程,无需标签页可见)
- [x] 扩展:agent 新建标签页进专属窗口(focused:false 创建,用户窗口不被打扰;
      窗口被用户关掉自动重建)
- [x] e2e 强化:双会话并行(各自标签页/事件路由互不串扰)+ s1 全部操作在
      非活动后台标签页上执行;bridge 单测换事件路由/handoff 队列用例
- [x] go test/vet/gofmt、扩展 tsc+vitest 全绿
- 已知边界:专属窗口最小化会暂停渲染,截图可能失败(错误如实返回);
  同一标签页仍应只属一个会话(归属表保证)

---

# WSL 运行环境支持一期:全局模式开关(2026-07-19)

> 计划:~/.claude/plans/prancy-sniffing-clover.md。用户拍板:路线 C(内核跑进 WSL)
> 第一阶段——设置里选"运行环境:Windows 本地 / WSL(发行版)",壳经
> `wsl.exe -d <distro> --exec` 拉起 Linux 版内核,agent 全走 Linux 代码路径;
> 一次一个内核,按会话选环境留二期。

- [x] 步骤 1 Go:internal/repo/wslpath.go(InWSL/TranslateWindowsPath)+ 表驱动单测 11 例;
      handleCreateSession 接线(UNC/盘符 → Linux 路径,发行版不匹配 400)+ 集成测试;
      Reveal WSL 分支(explorer.exe + wslpath -w)
- [x] 步骤 2 Rust:src/wsl.rs(decode_wsl_output 双解码/run_wsl 超时/wsl_prepare 预热+健康检查+
      批量 wslpath 一体/list_distros 滤 docker-desktop)+ 单测 4 例;DesktopConfig.kernel_env;
      start_kernel WSL 分叉(find_agent_linux:MC_AGENT_LINUX_BIN→资源目录→同目录;WSLENV=/u
      白名单注入;30s 探活,超时文案带 localhostForwarding/wsl --shutdown 排查);stop_kernel
      加 wsl_distro 参数,强杀后 pkill -x mc-agent-linux 兜底(三个调用点接线,save_config 按
      保存前的旧环境回收);kernel_port bind 失败重试 3s(WSL 转发拆除竞态防丢 localStorage);
      kernel.log 尾部读取双解码防 UTF-16 乱码
- [x] 步骤 3 ACL:build.rs + tauri.conf.json kernel-ui capability 加 list_wsl_distros
- [x] 步骤 4 UI:HostConfig.kernel_env;client.ts listWslDistros;settings.tsx 通用页"运行环境"
      卡片(仅 Windows 壳显示;下拉=本机+发行版,已配置但未检测到的发行版保留可见;
      提示会话隔离//mnt/c 变慢/localhost 不可达);payloadOf/baseline/dirty/discard 全接线;uidist 重建
- [x] 步骤 5 打包:Makefile kernel-windows 与 desktop-windows.yml 追加 GOOS=linux 静态编译;
      tauri.windows.conf.json resources 加 mc-agent-linux(不走 externalBin,避免 triple/.exe 拼接);
      win7 通道不加(无 WSL2,UI 自然降级隐藏)
- [x] 步骤 6 验证:agent 全量 17 包 go test + gofmt/vet 干净;cargo build+test 4 例;UI tsc+
      vitest 25 例+uidist 重建;scripts/fake-wsl.sh shim 三形态单测(UTF-16 列表/prepare 恒等
      翻译/serve 透传+stdin EOF 优雅退出)+ 无头壳端到端(xvfb+dbus:WSL 分叉拉起内核就绪、
      端口持久化、healthz 通、MC_AGENT_MODELS/WSLENV 注入正确、杀壳无孤儿内核)

## Review

改动面:agent 侧新增 internal/repo/wslpath.go(纯函数翻译)+ server 接线 8 行 + Reveal 分支;
壳侧新增 src/wsl.rs(全平台编译,MC_WSL_EXE 可 shim)+ start_kernel/stop_kernel/kernel_port 改造;
UI 一卡片一字段一 IPC 封装。内核工具链/loop/policy 零改动——WSL 模式即 Linux 原生路径,
这正是选路线 C 的原因。

**真机(Windows + WSL2)待验证清单**(本机无 Windows,交付前人工过一遍):
1. 多发行版/零发行版/未装 WSL 三态下拉;docker-desktop 被滤
2. 切 WSL 保存 → `wsl -d X -- ps aux | grep mc-agent` 内核在 WSL;UI 正常;origin 未变(主题保留)
3. 新会话三种路径:对话框选 `\\wsl.localhost\...`、粘 `C:\...`、粘 `~/...` 均成功且 bash 走 Linux
4. Reveal 打开 explorer 定位正确;切模式后会话列表按环境隔离
5. 托盘退出后 `wsl -d X -- ps` 无残留;强杀路径 pkill 兜底生效
6. `wsl --shutdown` 后冷启动 30s 内就绪;发行版名错误时错误页无 UTF-16 乱码
7. 含空格安装路径(C:\Program Files)全流程;NSIS 包内含 mc-agent-linux
8. 设置页运行期实际调通 list_wsl_distros(capability 只能运行期验证,bb1574e 教训)
9. 扩展桥 127.0.0.1:7440 在 WSL 模式可用
10. 自动更新 on_before_exit 停 WSL 内核无残留

已知限制(设置页提示已覆盖):localhostForwarding 关闭/睡眠恢复 relay 失效 → 探活超时带排查
指引;drvfs metadata 挂载时 /mnt/c ELF 可能无执行位(后续 hardening:stage 进 WSL home);
Windows 侧 7440 被占扩展桥静默失效;WSL 内核访问不到 Windows localhost 服务(NAT 单向)。

## 增补:iframe 支持 阶段1——同源/同进程 iframe(2026-07-19)

- [x] collectJS 递归进同源 iframe.contentDocument(try/catch 跨源;可见性用
      元素所属 window 的 getComputedStyle);跨源 iframe 仅计数
- [x] locate 改用 DOM.getBoxModel(objectId) 取主视口坐标——浏览器统一计算,
      自动含所有同进程 iframe 偏移,真实鼠标点到 iframe 内元素(不再手动累加)
- [x] ensureTab 加 DOM.enable;isStaleObjectErr 补 DOM 域节点失效模式
- [x] 快照标注 "(iframe 内)";提示改 "N 个跨源 iframe"
- [x] e2e:页面嵌同源 iframe(内含发布按钮,点击 postMessage 改父标题),
      验证快照抓到发布按钮 + 真实鼠标点击生效;单测更新字段
- 说明:type/select/press 本就用 objectId callOn,跨同进程 iframe 自动生效;
      纯内核改动,扩展/UI 无需重建

## 增补:iframe 支持 阶段2——跨源 OOPIF(2026-07-19)

- [x] 协议(Go+TS):Request/Message 加 sessionId;新 op frames.list;FrameInfo
- [x] refTable:ref → elemRef{sessionID, objectID}(sessionID 非空=OOPIF 子会话)
- [x] 内核 cdp.go:CDPSession(带 sessionId 路由)+ FramesList
- [x] 内核 snapshot:collectFrame 统一采集,主 target + FramesList 各 OOPIF 子会话
      各跑 collectJS,元素并入连续编号(标注 framed);对象组按会话逐个释放
- [x] 内核交互按 session 分派:主 target(含同源 iframe)真实鼠标(getBoxModel);
      OOPIF 走子会话 element.click()/DOM 设值兜底(跨进程坐标累加脆弱,故退化合成事件)
- [x] 扩展 cdp.ts:attach 后 setAutoAttach(flatten,filter iframe);Target.attachedToTarget
      记子会话并递归 setAutoAttach(非递归限制,触达嵌套 OOPIF);sendCommand 带 sessionId;
      framesList;detach/onDetach 清理子会话表
- [x] 扩展 background:Target.attach/detachedToTarget 自处理不转发;CDP 事件带 source.sessionId
- [x] e2e:--site-per-process + localhost≠127.0.0.1 造真实 OOPIF,验证快照采到跨源
      按钮 + DOM click 生效(父页面 postMessage 改标题);全绿
- 取舍:OOPIF 用合成 click/DOM 设值(非 isTrusted),覆盖 99% 按钮;真实鼠标坐标
      累加留待需要时再做。嵌套 OOPIF 靠扩展递归 setAutoAttach + frames.list 全深度返回

## 双引擎架构 M1:UI 重宿主 + AgentDriver(2026-07-19)

> 计划:~/.claude/plans/cheerful-swimming-church.md(双 Agent 引擎:ohmyagent 接入 + 业务下沉 Rust 壳)
> M1 目标:UI 从 mc-agent 内嵌迁到 Tauri frontendDist,壳内 driver 层收口全部通信,功能与现状等价

- [x] agent/ui 构建改常规多文件产物 → mc-desktop/uidist(fonts/壳页面合并入内,error.html=原错误页);去 vite-plugin-singlefile
- [x] mc-desktop 模块化:config.rs(DesktopConfig+agent_engine 字段)/ driver/mod.rs(DriverHost+Engine 枚举+全部 IPC 命令)/ driver/mc.rs(McAgentDriver)/ repo.rs / uploads.rs
- [x] McAgentDriver:spawn mc-agent serve --no-ui(含 WSL 分支迁入)+ REST(sessions/models)+ 每会话 WS client(帧透传→frames:{sid} 事件,30ms 批量;call 按 kind FIFO 配对;断线 2s 重连)+ SSE→session-event 事件
- [x] repo.rs:file_list/read_file/file_changes/file_diff/reveal 原生移植(应答 {result}/{error} 同构;WSL 经 UNC+wsl.exe git,待 Windows 实测)
- [x] uploads.rs:.mc-agent/uploads 落盘(命名/清洗/去重对齐 Go 版)+ data URL 回读
- [x] 临时 kernel_http 代理(/api/baizhi、/api/mc REST)+ cloud_ws_open/send/close 通用 WS 桥(M1 指向内核本地,M2 改拨云端)
- [x] client.ts 重写:全量 invoke/listen,导出签名不变;uploadFileURL 改异步(components.tsx 加 UploadImg;文件 chip 改 <a download>);cloudterm.tsx 换管道;settings 保存后自行 location.reload
- [x] pet.html:kernel_info+REST/SSE → sessions_list invoke + session-event 事件 + 10s 探活
- [x] tauri.conf:frontendDist=uidist,capability 收敛为 main-app(本地)+pet-page;build.rs 登记全部新命令
- [x] 验证:cargo build ✓;UI npm test 31/31(reduce.test.ts 零改动)✓;npm run build ✓;xvfb 无头探针:页面加载/invoke/listen/opener/save_config→引擎重启→响应到达、页面存活 ✓
- 已知事项:
  - 探针发现 WebKitGTK 下"页面加载 3s 内并发 save"与"取消中的导航"会挂掉页面 JS(真实用户时序不触发;probe 脚本已调整时序并留注释)
  - agent/cmd/mc-agent/uidist 内嵌调试 UI 停止更新(serve 默认 --no-ui 由壳拉起;独立浏览器调试模式仍可用但为旧版 UI)
  - 待互动验证:真实对话/审批/文件抽屉/附件/云端流(需模型配置,tauri dev 手测)

## 双引擎架构 M2-M4:百智云原生化 + OhmyAgentDriver + 打包(2026-07-19)

### M2 百智云/云端 Rust 原生化
- [x] baizhi/ 模块移植(对应 agent/internal/baizhi 约 2165 行 Go):pow(FNV-1a+xorshift32+SHA256,参考向量单测)/ cookies(RFC6265-lite 双罐,host-only/Secure/Max-Age 语义单测)/ client(信封解包+PoW 登录)/ wechat(qrconnect 长轮询)/ sync(密钥掩码复用+模型/MCP 网关)/ monkeycode(OAuth 桥手动重定向链+云任务 REST+rounds 归一化 ns→ms)
- [x] 云端 3 条 WS(stream/control/terminal)改壳直拨 wss(tokio-tungstenite + mc jar Cookie 头),UI 管道协议不变
- [x] client.ts baizhi_*/mc_* 切原生 invoke;kernel_http 收窄到 /api/browser/*(扩展桥与 browser_ 工具耦合,永驻 mc-agent)
- [x] cookie 登录态从 ~/.config/mc-agent/ 平滑迁移(格式互通,首启复制)
- [x] 验证:假服务端集成测试 4 例(登录全链路含 PoW 服务端独立校验/trace_id 清洗/桥接登录双罐分离/rounds 归一化),cargo test 21 全绿

### M3 OhmyAgentDriver + 引擎切换
- [x] driver/ohmy.rs:stdio JSON-RPC(线程式 reader/writer+oneshot RPC)/ 事件归一化→Frame(映射表见计划)/ 帧日志 events.jsonl 逐帧落盘+打开回放+seq 续接 / sidecar meta(title/archived/workdir/model/status)
- [x] 关键发现:stdio 模式 ohmyagent 不写 index.json 且 messages.jsonl 无 meta 记录 → sidecar 是桌面版会话索引权威(CLI 会话不进桌面列表=引擎隔离)
- [x] set_model/set_mode 经 destroy+resume-create 变通(真机协议验证 ✓);perm remember 记忆集(内存+persist 落盘),命中自动放行不上抛
- [x] config.rs 写 ~/.ohmyagent(settings/mcp,.bak 首次备份;provider 路由冲突默认模型优先+告警;MCP headers 不支持则跳过)
- [x] 设置页引擎选择器 + caps 降级(browser tab 按 engine_caps 隐藏);ShellCtx trait 解耦壳依赖(可测性)
- [x] 验证:真机协议冒烟(ready/create/sendMessage/turn-stopped/destroy+resume/带 mode 重建/优雅退出);driver E2E(假 Anthropic SSE + 真 ohmyagent:task-started/user-input/文本帧/task-ended/seq 单调/列表/切模式)✓;桌面启动冒烟(引擎就绪+配置写出)✓

### M4 打包收尾
- [x] ohmyagent 可选 sidecar:tauri.ohmy.conf.json externalBin 覆盖配置;desktop-windows/macos workflow 加守卫构建步(OHMYAGENT_REPO_TOKEN 就绪才 clone+build+打包,否则跳过,运行时 PATH 兜底);Makefile EXTRA_TAURI_CONFIG 改 += 保环境注入
- [x] 桌宠:M1 已改壳事件流,双引擎通用(ohmy 的 session-event 全局广播 ✓)
- [x] 更新器:on_before_exit 经 DriverHost 停引擎(编译验证);win7 不含 ohmyagent(Go 版本不支持)
- 待真机验证(需凭据/网络/交互):百智云真实登录+同步、云端任务流、ohmyagent 真模型对话、Windows/macOS 打包产物、WSL 回归

## Review 修复轮(2026-07-20)

10 个确认问题(8 视角查找 → 对抗验证)全部修复,附带 5 个次级问题:

- [x] openai 凭据键错位:providers 按 ohmyagent configKey 落盘(openai-chat/openai-responses → "openai"),openai 协议模型恢复可用(config.rs config_key_of)
- [x] 本地提问卡不可答:useSession 增 answerAsk(reply-question 上行+乐观回写),chat.tsx LogList 接 onAskAnswer
- [x] mc 会话流 close→reopen 竞态:SessionConn 加 epoch 代际,ws 循环退出只清理自己那一代
- [x] send() 语义回归:Conn.send → Promise<boolean>,失败保留输入/附件/排队消息;云端 doSend 失败经 onStatus 外显,control call 发送失败立即 reject
- [x] 云端管道丢头帧:pipe id 改 UI 生成,监听(listenAsync 等注册落地)先于 cloud_ws_open;本地 connect() 同样先等监听再 session_open
- [x] ohmy 默认工作区断裂:session_create 补 ~ 展开(expand_tilde)+ create_dir 语义
- [x] 切模型/切模式互相重置:recreate 总是同时带当前 model+permission_mode
- [x] 取消误报完成:turn/stopped 保留 interrupted 状态(不再触发桌宠庆祝)
- [x] 中文标题 rename panic:字节 truncate → chars().take(80)
- [x] repo 查询无超时:repo_call 包 15s tokio timeout(对齐旧 WS call 语义)
- [x] 次级:云端 WS 帧上限 16MiB→64MiB(对齐 Go 32MB 意图);home_dir() 统一 HOME/USERPROFILE(Windows cookie 迁移+二进制查找+~ 展开);turn/stopped 复用 write_sidecar(updated_at 不再漏);session_open 回放清批量缓冲+seq 单调(重开不重帧)
- 验证:cargo test 21/21(含 ohmy E2E 走新 recreate 路径)、UI 31/31、tsc、启动冒烟(探针全过,cookie 迁移顺带实证)
- 已知未修(记录在案):~/.ohmyagent 接管为声明式设计(UI 已提示);ask 卡经 reduce 启发式词汇匹配的跨层耦合;清理类(urlenc×3/正则热编译/journal 每帧开关文件/UploadImg 无缓存/cookie 全量落盘)留后续

## UI 归位 + 内核 headless 化(2026-07-20)

- [x] agent/ui → mc-desktop/ui(git mv 历史保留;标准 Tauri 布局:壳+前端+产物同属一个应用目录)
- [x] vite outDir ../uidist;dev server 1420 + /fonts 中间件;tauri.dev.conf.json 开发覆盖
      (HMR:npx tauri dev --config tauri.dev.conf.json;devUrl 不进主配置——
      tauri-build 给 debug 构建打 cfg(dev),主配置带 devUrl 会让 cargo run 直连不存在的 dev server)
- [x] 删除 mc-agent 冻结内嵌 UI:go:embed uidist(21MB)、Options.UI/UIAssets、
      "/"与"/fonts/"挂载、--no-ui 旗标全部移除,serve 彻底 headless;
      driver/mc.rs spawn 参数同步去掉 --no-ui(旗标已不存在,不删内核起不来)
- [x] 验证:go build+server 测试、UI 38/38、cargo build、无头冒烟(含 save 重启内核)、
      裸内核 / 404 + /healthz 200

## 架构收口(2026-07-20)

- [x] 契约1 帧词汇:driver/frame.rs 唯一 Rust 定义(构造器+SessionStatus/PermOutcome 枚举),
      ohmy.rs 全部产帧点改构造器,mc.rs 共享 now_ms/b64 助手;types.ts 加 SessionStatus union
      顺带修:ohmy 轮次开始改本地先行落帧(sendMessage ack 与首批事件在 stdout 无时序保证,
      快模型下 task-started/user-input 会乱序丢失——E2E flake 暴露的真实缺陷);
      引擎 user_message 回显相应忽略。全量测试 4 连跑绿
- [x] 契约2 能力:Caps 强类型单一事实来源,kernel_http 守卫收口到命令层,
      设置页 browser tab 改 caps 确认后显示;顺带 vision→supports_images 映射
- [x] 契约3 IPC:repo_* 分派下沉到 session_call 命令层,删 UI 侧 REPO_KINDS 与 repo_call 命令
- [x] 引擎监督:mc 2s try_wait 监视 + ohmy stdout EOF 检测 → engine-crashed 事件(带日志尾)
      → App 崩溃横幅 + engine_restart 一键重启(与 save_config 共用 apply_config_and_restart);
      kill -9 内核实测 watcher 触发 ✓
- [x] mc-desktop/ARCHITECTURE.md:分层+五契约(帧词汇/能力/IPC/配置所有权/状态机)+
      引擎数据归属表+上游缺口清单定稿
- 验证:cargo 21/21(4 连跑)、UI 38/38、tsc、无头探针、崩溃注入实测

## worktree 功能移除(2026-07-20)

- [x] 桌面路径从未暴露该功能(UI 无入口),整体删除降低表面积:
      内核:workspace 包、worktree 子命令、--worktree 旗标、Meta.Worktree、
      server 创建/删除的 worktree 分支;壳:Caps.worktree;
      UI:SessionMeta.worktree、侧栏"隔离"徽标与分组归属、删除确认文案、
      引擎提示文案;ARCHITECTURE.md 同步
- [x] 验证:go build/vet/test、cargo build/test 21、UI tsc/38/build 全绿

## uidist 产物策略定型:不入库(2026-07-20)

- [x] 入库的唯一历史理由(go:embed 无 node 构建)已随内核 headless 化消失;
      改标准做法:壳静态页+webfonts 移 ui/public(源码,Vite 构建拷入),
      uidist 100% 生成物 → gitignore + emptyOutDir,堆积问题连根消失
- [x] 打包经 tauri beforeBuildCommand 自动构建 UI(CI 三 workflow 均有 node);
      直接 cargo build 前需先 npm run build 一次(文档已注明)
- [x] 验证:构建产出完整 uidist(assets/fonts/壳页面)、cargo build、无头探针 6 项全过

## macOS 白屏修复(2026-07-20)

- [x] 根因(探针 jserr 定位):ohmy 驱动 sessions_list 的 updated_at 返回毫秒数字,
      契约(types.ts/mc-agent time.Time)是 RFC3339 字符串 → 侧栏排序 .localeCompare
      TypeError → React 整树崩 → 白屏(仅 ohmy 引擎+有历史会话时触发,Linux 探针环境无会话未踩到)
- [x] 修复:config.rs 增共享 ms_to_rfc3339(cookies.rs 复用),ohmy sessions_list 输出转字符串;
      UI 三处 updated_at 排序 String() 加固(历史 sidecar/异构数据不再能炸渲染树)

## ohmyagent 上游更新适配(2026-07-20)

- [x] 切模型/模式:destroy+resume 变通删除,改原生 session/switchModel /
      session/switchMode;模式运行中也可切(上游 evaluator.SetMode 即时生效);
      未激活会话仍走 create(resume) 带全参(switch 要求会话存活)
- [x] 顺手修正 session_open 惰性 resume 只传 {resume} 的老坑:现从 sidecar
      带上会话自身 model/permission_mode(缺参会回落进程默认值);
      模型已删配置时退化引擎默认,不阻断打开
- [x] MCP headers:上游已支持(mcp ServerConfig.headers),config.rs 删跳过
      分支,streamable-http 条目 headers 透传(百智 MCP 网关 Bearer 可挂)
- [x] usage 评估后不接:turn/stopped 的 usage 是整轮累计(loop totalUsage.Add),
      上下文条语义是"当前占用/预算",累计 input 虚高会误触"接近上限"警告;
      用量条继续隐藏,待上游按次出 usage 或给 context_tokens
- [x] compaction 事件上游新增,壳侧此前已有 compact_status 映射,无需改
- [x] ARCHITECTURE.md 上游缺口清单同步(三项已补齐移出)
- [x] 验证:重建 ohmyagent 二进制,cargo test 21/21(E2E 补 switchModel/
      switchMode 真通路断言,对新二进制实测),cargo build 零告警

## 架构再审计:四路并行汇总(2026-07-20)

正面结论:UI 零网络契约成立;命令三处登记逐条一致;agent headless 化无残留;
无迁移孤儿;async 卫生良好(spawn_blocking 到位);reduce 新帧词汇测试实已覆盖(旧账销)。

### A 会话正确性(最高优先)
- [ ] ohmy 运行中会话无和解:stop()/崩溃/cancel 超时都不补帧不落状态,
      会话永久卡 running(不能发/删/切,重启也救不回) ohmy.rs:252,588,937
- [ ] 状态机缺 Created:frame.rs 枚举没有,ohmy 新会话落 "finished",
      侧栏打勾+桌宠庆祝(契约 5 违反) frame.rs:15 ohmy.rs:391
- [ ] ohmy 工具失败渲染为成功:tool_result 一律映射 completed,
      无 failed 状态 ohmy.rs:990 frame.rs:162
- [ ] 云端发送队列卸载后定时器无守卫,可开出无主 WS 管道 cloudtask.tsx:329,267
- [ ] cloud_ws_open pipe 检查跨 await TOCTOU,重连抖动双流交错 monkeycode.rs:383/423

### B 发布链风险
- [ ] ohmyagent 零钉死:CI clone HEAD 无 ref,壳无版本/能力握手,
      旧二进制 Method not found 无从归因 desktop-*.yml ohmy.rs:114
- [ ] 本地 make release 无 ohmyagent 获取路径,updater 会把引擎"更新没了" Makefile:46
- [ ] Windows CI 与 Makefile 双实现已漂移(python3/python、ldflags 四处) windows.yml:36
- [ ] 内核版本恒 0.1.0-dev,无 -X 注入,壳↔内核兼容门禁建不起来 main.go:30
- [ ] beforeBuildCommand 押注 CLI 前端探测启发式 + @^2 浮动版本,
      加自断言与钉版本 tauri.conf.json:8 Makefile:19

### C 契约名存实亡
- [ ] Caps 降级只有设置页落地:用量圆环/审批"总是允许"/附件入口全都不看 caps
      chat.tsx:804 components.tsx:454 useSession.ts:204
- [ ] 引擎重启生命周期:无 restarting/ready 事件、UI 靠整页 reload、
      启动窗口崩溃丢横幅、apply_config_and_restart 无互斥 main.rs:126 App.tsx:713
- [ ] mc_task_rounds 手拼帧(旧账):frame.rs 补 from_cloud_chunk monkeycode.rs:184
- [ ] engines_list 缺失(旧账):下拉+能力文案硬编码 settings.tsx:1005
- [ ] 云端管道词汇(ping/cursor/call-response)无权威定义,parseCursor 双格式
      兼容即烂过的证据;cloudtask 侧第二套 running 记账 client.ts:414 cloudtask.tsx:38
- [ ] 两 driver 产帧/emit 风格分叉:上行帧手拼、emit_to vs emit、
      session-event 壳侧无定义;conn-status 语义分叉 mc.rs:422,465 ohmy.rs:846
- [ ] reply-question 词汇归属不清:frame.go 死常量,mc 侧 server 静默丢弃,
      契约表未标注 ohmy-only frame.go:63 server.go:1138

### D 结构健康(演进摩擦)
- [ ] ohmy.rs 1242 行四职责:按 transport/SessionStore/PermMemory/normalize 拆
- [ ] client.ts 881 行:按 ipc/session/cloud/baizhi/host 五段拆
- [ ] App.tsx 1061 行:FileDrawer 组件 + useCloudTasks hook 拆出
- [ ] 模型可用性双真相:物化跳过仅 eprintln,UI 下拉仍展示无凭据模型 config.rs:233
- [ ] BzErr 到命令边界坍缩 String,401 无法引导重登 baizhi/mod.rs:392
- [ ] 微信长轮询无取消面,wx 状态仅成功清理 wechat.rs:89
- [ ] mc_task_create 产品策略硬编码(镜像/资源/skill),Value 透传 monkeycode.rs:224
- [ ] sync 结果明文密钥往返 UI,应壳侧暂存+掩码句柄 sync.rs:184
- [ ] journal 无轮转,回放整份单 emit 绕过批量契约 ohmy.rs:777,449
- [ ] push_frame 写盘失败静默,回放缺帧无征兆 ohmy.rs:836
- [ ] win7 通道裁剪静默:无 WSL 内核无 ohmy,设置页仍全量展示,包级能力未进 Caps
- [ ] wsl_distro 经 Engine 转手,ohmy+WSL 下 repo/uploads 铁律不成立 mod.rs:170
- [ ] cookie 持锁同步落盘在请求路径上 cookies.rs:172
- [ ] 命令面:mc_ 前缀与 mc-agent 撞车,四条只读可合并 kind 分派
- [ ] 桌宠偏好仍触发全量物化(重启已修,物化未拆) main.rs:545
- [ ] 测试盲区:「监听先于命令」不变式零测试;useSession/connectCloudControl 零测试;
      pet 偏好独立写路径缺测

## yolo 切换排空挂起审批(2026-07-20)

- [x] ohmy 驱动补齐 mc-agent setMode 的既有语义(server.go:1063"切到 yolo
      自动放行所有 pending 审批"):session_set_mode 切到 yolo 后排空本会话
      pending_perms——逐个 permission/respond approved + permission-resolved 帧
      + 清 ask 状态;顺序与 mc 一致(先切引擎再排空,不漏切换瞬间的请求)
- [x] 验证:cargo test 21/21

## A 组会话正确性收官 + 错误外显 + 版本握手(2026-07-20)

- [x] 和解原则落地(契约 5 新增条款):stop()/stdout EOF 崩溃/cancel 无应答
      三路都本地补收尾(未闭合工具 failed 帧 → task-error → task-ended,
      sidecar 落 interrupted,挂起审批/提问一并失效);turn/stopped 加
      running 幂等守卫吞迟到收尾;stop 前同步 flush_batch 不丢帧;
      sessions_list 对历史残留的 sidecar "running" 读取时自愈 interrupted
- [x] 状态机补 created:frame.rs 枚举 + ohmy session_create 落 created,
      新会话不再显示"已完成"(侧栏 default 分支天然正确渲染)
- [x] 工具失败不再绿勾/永久转圈:上游工具错误路径不发 tool_result,
      驱动跟踪 open_tools,轮次收尾对未闭合 tool_call 补 failed 帧
      (reduce 已有 fail 渲染);上游缺口清单补记
- [x] 错误外显分渠道:useSession 新增 notice(自动消退 8s + 手动关),
      切模型/权限/附件失败与 App 级告警全走 notice,ChatView composer 上方
      红色横幅展示;状态行回归纯连接语义
- [x] 版本握手:system/ready 的 capabilities 落 engine_caps,
      切模型/模式缺 RPC 时自动回退 destroy+resume(旧二进制不再 Method not found;
      回退路径模式切换要求空闲,给友好错误)
- [x] 验证:cargo test 22/22 三连跑(新增 e2e_stop_reconciles_running_session:
      8s 慢速假 LLM 挂住轮次 → stop → 断言收尾帧与 interrupted;
      E2E_LOCK 串行防 HOME 互踩);UI tsc + 38/38;E2E 补 created 断言

## AskUserQuestion 与 SubAgent 展示修复(2026-07-20)

- [x] SubAgent 根因:上游 stdioEventSink 原样转发子循环事件,session_id 是
      子循环随机 8 位 id(uuid[:8]),壳 push_frame 查无此会话静默丢弃。
      修复:未知 sid 事件走 handle_subagent_event——首见用"运行中且持有
      未闭合 Agent 工具的会话"启发式认领(open_tools 升级 tc_id→工具名),
      归一化为父会话 Agent 工具卡的 progress feed(subagent_tool 步骤 +
      subagent_text 整行缓冲,UI applyProgress 现成消费);工具闭合/轮次
      收尾/和解时清路由并冲洗残留行缓冲;上游缺口记档(应带 parent_session_id)
- [x] AskUserQuestion 排查:壳/归约/渲染三层全链路验证无缺陷
      (deferred 工具经 ToolSearch 载入 → question/request → 提问卡帧 →
      reply-question → 轮次完成);此前"展示不出来"最可能是旧二进制或
      模型直调 deferred 工具 unknown tool 后静默挂——今日 failed 帧
      修复后该场景已可见
- [x] 测试脚手架升级:fake_anthropic 支持多步回放(按请求序)+
      sse_tool_use 构造器;新增 e2e_ask_user_question_flow、
      e2e_subagent_progress;cargo test 24/24

## SubAgent 展示对齐 mc + yolo 权限顶棚修复(2026-07-20)

- [x] 展示对齐:子代理物化为壳侧子会话(sidecar 带 parent,journal 完整
      可回放)——父卡 feed 预览 + child_session 链接点开完整视图,与
      mc-agent 双通道一致;子会话不进列表、删除级联、重启后可回放
      (session_open 对 parent 会话跳过引擎 resume)
- [x] yolo 权限根因:上游 subagent 工厂在会话构建时快照权限模式,
      switchMode 只改父评估器 → 子代理顶棚仍 default + HeadlessPrompter
      全拒(mc 子代理固定 yolo 所以无此问题)。壳修法:空闲切模式一律
      destroy+重建带新顶棚,运行中才热切(仅父生效,上游缺口记档)
- [x] 连带根治:空会话 resume 必失败(messages.jsonl 未生成)→
      引擎 id 与壳 sid 解耦(SessionState.engine_id 别名,出站 RPC 映射、
      入站 shell_sid_of 反查、sidecar 持久化),空会话重建走全新 create
      换绑,壳 sid/目录/UI 通道稳定;同时治好"打开空历史会话失败"潜在 bug
- [x] 验证:cargo test 24/24 三连跑;ask E2E 恰好全程压过换绑路径

## ohmyagent 单引擎化 M1(2026-07-20)

- [x] 壳内移除 mc-agent:删 driver/mc.rs(619 行)与 Engine 枚举分发,
      DriverHost 直持 OhmyDriver;kernel_http 命令三处注销(浏览器 tab
      随 caps.browser_ext=false 隐藏,M2 迁壳后恢复);config.rs 停写
      models.json/mcp.json,物化只剩 ~/.ohmyagent;agent_engine 字段
      废弃兼容保留;设置页删引擎选择器;EngineCaps 去 engine 维度
- [x] 顺手收账:桌宠偏好拆 save_config_json 只写权威 config.json,
      不再触发含密钥的引擎配置全量物化(审计 D 组旧账)
- [x] 打包链:Makefile 全面转 ohmyagent sidecar(OHMYAGENT_SRC 指源码,
      engine-universal/engine-windows 目标;externalBin 列基础配置——
      缺二进制打包直接失败);删 tauri.ohmy.conf.json 叠加层与
      mc-agent-linux 资源;三个 CI 钉 OHMYAGENT_REF(commit sha)且
      凭据缺失即失败(审计 B1/B2 核销);win7 用同款 go-win7 工具链编译引擎
- [x] 验证:cargo test 24/24、UI tsc+38/38+build 全绿;workflows YAML 校验过

## ohmyagent 单引擎化 M2:浏览器桥迁壳 + MCP 暴露(2026-07-20)

- [x] agent/internal/browser(~2300 行 Go)移植为 mc-desktop/src/browser/
      八模块:protocol(契约逐字,扩展零改动)/bridge(WS server /ext,
      7440 顺延 10 端口,配对/token/新连顶旧连/20s ping)/cdp/session
      (refs/notes/对话框自动应答/OOPIF/detach 自愈)/ops(9 工具语义)/
      keys/refs/snapshot(collectJS 逐字节一致)
- [x] MCP streamable-http server 手写最小面(实测 go-sdk 客户端契约:
      POST json 应答、通知 202、GET 405 被容忍):initialize/tools/list/
      tools/call,截图走 ImageContent;Bearer token 进程级新发,
      经 mcp.json 内置条目 headers 下发引擎;工具串行锁
- [x] 会话归属简化:单一共享浏览器会话(MCP 调用不带会话身份,桌面单用户);
      handoff 队列归全局
- [x] 装配:browser::init 先于引擎启动(物化配置需 MCP URL/token);
      browser_status/browser_repair 命令三处登记;caps.browser_ext=true;
      UI client 弃 kernel_http 改新命令
- [x] 测试:假扩展 WS 集成(配对码 normalize/32hex token/状态外显/调用往返/
      错误码中文文案)+ MCP HTTP 冒烟(401/回显协议版本/9 工具/isError/202);
      cargo 30/30、UI 38/38、build 零告警
- [ ] 待真机冒烟:真实 Chrome + 扩展(配对→navigate→snapshot→click→截图)

## ohmyagent 单引擎化 M4:agent/ 删除 + 文档重写(2026-07-20)

- [x] agent/(32M Go 内核,浏览器语义已迁毕)与 agent-ci.yml 整体删除;
      browser-extension/ 保留(WS 契约面转壳内 browser/,扩展零改动);
      移植 provenance 注释指向 git 历史(e8666a8 前)
- [x] ARCHITECTURE.md 单引擎重写:分层图(引擎经 MCP 消费壳内浏览器工具)、
      契约 1 收敛两方对表(frame.rs 唯一产帧权威)、契约 4 补 engine_id
      解耦与数据归属、浏览器桥章节(单共享会话差异声明)、上游缺口清单
      并入近期全部变通;README 改薄为入口 + 快速上手
- [x] 审计清单核销:双 driver 产帧分叉/engines_list/驱动风格统一/
      settings 引擎硬编码——随单引擎化蒸发
- [ ] M3(WSL)待上游 OHMYAGENT_CONFIG_DIR 就绪后启动

## 上游集成:OHMYAGENT_CONFIG_DIR + 子代理权限实时继承(2026-07-21)

- [x] 引擎配置迁私有目录:app_config_dir/ohmyagent 经 OHMYAGENT_CONFIG_DIR
      注入,settings/sessions/mcp 全派生路径跟随;退出 ~/.ohmyagent 全局
      接管妥协(.bak 逻辑删除);首启一次性迁移旧接管目录 sessions
      (sidecar 权威过滤,多拷无害);三处 messages.jsonl 检查/删除路径
      随 engine_dir 走;E2E 脚手架同步(全程压过注入链)
- [x] 撤销"空闲切模式一律 destroy+重建"变通:上游 969311a 子代理评估器
      改读父模式实时值,yolo 热切对后续子代理生效 → set_mode 恢复原生
      switchMode(旧引擎回退保留)
- [x] OHMYAGENT_REF 钉新:3177558 → f7eea63(三个 workflow;单源化仍在
      评审待办)
- [x] 验证:重建二进制,cargo test 30/30;ARCHITECTURE 契约 4 与缺口清单更新

## 上下文用量:壳侧就绪(2026-07-21)

- [x] frame.rs 增 usage_update(used,size);ManifestModel 带 context_window;
      ohmy handle_event 的 model_done 一旦携带 usage(input+cache 写/读三项
      之和≈该次调用上下文占用)即产 usage_update 帧点亮 UI 上下文环
- [x] 为何不用 turn/stopped:那是整轮累计(loop totalUsage.Add),多步工具
      轮次里对"当前占用/预算"语义严重虚高,会假报"接近上限"
- [ ] 待上游一行:loop.go 的 l.emit(EventModelDone, turnID, nil) 改为
      map[string]any{"usage": usage}(consumeStream 已返回单次 usage)

## 附件目录去 mc-agent 化 + 空 workdir 硬错误(2026-07-21)

- [x] 上传目录 <workdir>/.mc-agent/uploads → <workdir>/.monkeycode/uploads;
      回读改按消息内相对路径解析(旧 .mc-agent 附件继续可读),
      新增越界守卫(仅放行新旧两代上传目录,拒 ../ 与绝对路径)
- [x] 空 workdir 硬错误:相对路径落进程 cwd(终端启动=当前目录,
      打包启动=/)的静默错位改为显式报错"会话缺少工作目录"
- [x] mc-agent 残留清扫:baizhi env MC_AGENT_* → MC_DESKTOP_*;
      删 ~/.config/mc-agent 旧 cookie 迁移;agent_engine 废弃默认值清空;
      设置页两处宿主文案与"项目级 .mc-agent/mcp.json"文案;types.ts 注释;
      ui 包名 mc-agent-ui → monkeycode-ui;ARCHITECTURE 附件行

## 上游集成:上下文用量 + 图片输入(2026-07-21)

- [x] 用量落地(上游 296176a):turn/stopped.context{used_tokens,window_tokens}
      → usage_update 帧;session/create 结果 context_used/window → resume/
      重建后环立即显示;删壳侧 model_done 推测路径与 ManifestModel.context_window
      双真相;caps.usage_update=true;E2E 补占用帧断言(真引擎实测)
- [x] 附件缺口闭合(上游 37feef2):提示词内图片路径自动内联 ContentImage
      (vision 模型,25K 预算;相对路径按会话 cwd 解析)——壳的
      [图片] .monkeycode/uploads/x.png 约定零改动兼容
- [x] OHMYAGENT_REF 钉 296176a(三处);重建二进制,cargo 30/30

## 浏览器截图显示修复(2026-07-21)

- [x] 根因:ohmyagent MCP 客户端只拼 text 内容块,image 块直接丢弃
      (mcp/client.go:188)——截图既没进模型也没进 UI
- [x] 壳侧双保险:MCP screenshot 同时把 PNG 落当前运行会话的
      <workdir>/.monkeycode/uploads/browser-<ms>.png(active_workdir 惰性
      查运行中主会话,跳过子代理),结果文本带"截图已保存: <相对路径>";
      驱动 tool_result 提取上传路径 → tool_call_completed 帧 images 字段
      → UI 工具卡内联渲染(upload_read 守卫天然放行);模型也可按路径
      Read 查看(Read 图片文件出 Images,vision 可见)
- [ ] 待上游:mcp/client.go 解析 {type:"image",data,mimeType} →
      tools.ToolResult.Images(ImageSource{Data,MediaType}),模型直收截图

## 上游集成:MCP 图片/父归属/错误 tool_result(2026-07-21)

- [x] c1d8482 MCP image → 模型:截图闭环(壳落盘路径继续供 UI 工具卡)
- [x] dab1b85 事件带 parent_session_id/parent_tool_call_id:子代理精确
      认领(父 sid 经 shell_sid_of 反查兼容 engine_id 换绑),
      启发式降为旧引擎回退;E2E 实测走标记路径
- [x] b02fc77 工具错误发 tool_result("Error: " 前缀,无独立错误位)→
      壳按前缀转 failed 帧,防失败渲染绿勾;轮次收尾 failed 兜底保留;
      deferred 工具直调自动提升(AskUserQuestion 不再依赖先 ToolSearch)
- [x] OHMYAGENT_REF 钉 c1d8482;重建二进制,cargo 31/31
- [ ] 上游愿望:tool_result 加独立 is_error 位(现前缀约定,正常输出
      以 "Error: " 开头会误判)

## 上游集成:子代理活动标签(2026-07-21)

- [x] 6a61cfd 是引擎 TUI 的并行子代理活动面板(协议无变化);桌面对齐点:
      perm_title 取参键补 description——Agent 卡标题显示任务描述标签
      (与 TUI 面板同源),TaskCreate 等带描述工具通用受益;E2E 锁行为
- [x] cd9c683 并行 Agent 加固(worktree 锁/注册表锁)对壳无感;
      OHMYAGENT_REF 钉 6a61cfd;cargo 31/31

## 上游集成:子代理标签戳 + 空 tc_id 回填(2026-07-21)

- [x] 939e03e 事件戳 parent_description:子会话标题优先取戳记(后台代理
      跨轮续跑时 tc_id 暂存已清,戳记恒在),tc_id 暂存降为回退;
      task_notification data 结构化为纯增量(message 保留),壳零改动
- [x] 4e6193a 空 tool-call id 引擎侧回填,壳既有空 id 守卫自然受益
- [x] OHMYAGENT_REF 钉 4e6193a;cargo 31/31

## mc-agent 残留终清(2026-07-21)

- [x] 全仓 grep 清零(除 uploads 回读守卫的旧目录兼容前缀,功能性保留):
      Cargo.toml 描述、扩展断连文案与 README(改指桌面应用)、
      frame.rs/ohmy.rs/browser/* 全部注释、client.ts 注释、
      ARCHITECTURE 三处、fake-wsl.sh 用法注释
- [x] 验证:cargo 31/31、UI tsc+41/41、扩展构建通过

## 旧 Electron 桌面端删除(2026-07-21)

- [x] desktop/(旧 Electron 客户端)与 electron-release.yml 删除,
      mc-desktop(Tauri)正式接任;无其他引用(根级无 workspace 配置)

## mc-desktop → desktop 目录改名(2026-07-21)

- [x] git mv + 全量引用重写(18 文件):workflow 路径过滤/工作目录、
      .gitignore、Cargo 包名 mc-desktop → monkeycode-desktop(产物路径
      随之)、日志前缀 [mc-desktop] → [desktop]、文档与注释;
      tauri 打包不受影响(productName=MonkeyCode 决定安装名)
- [x] cargo clean 重建(旧缓存存绝对路径);cargo 31/31、UI 43/43、
      workflows YAML 校验过

## 上游集成:扁平 per-model schema + interactive(2026-07-21)

- [x] e792858 providers map 删除 → models 按别名作键、每条自带
      type/api_key/base_url:物化重写为一一对应,configKey 槽位/冲突
      跳过/默认占槽逻辑整体删除——每模型独立凭据缺口销账
      (claude-opus-4-6 类多网关同协议场景解锁)
- [x] 模型选择改传别名(model_id_of 返回 name):引擎双解析但同 wire id
      多网关撞 wireIndex,别名唯一;default_model 亦别名
- [x] 8afc338 会话交互性:四处 session/create 带 interactive:true
      (桌面是有人的 UI,引擎给持久 Task 工具族而非 TodoWrite)
- [x] E2E 换新 schema(别名"测试模型"全链路);OHMYAGENT_REF 钉 06f945e;
      cargo 31/31、零告警

## 架构评审全量修复(2026-07-21,四路评审 → 分波实施)

> 评审范围:壳 Rust 核心 / baizhi+browser / React UI / 壳↔引擎契约。
> 结论:骨架不动,修四条主线——真实缺陷、引擎 API 缺口逼出的壳侧补偿、
> 云端未纳入既有抽象、三段手写契约漂移。

### Wave 1:P0 真实缺陷(按文件分区并行)✅
- [x] ohmy.rs 五连修:respond 改带 id 的 fire-and-log RPC(防 reader 自等死锁,
      EOF 统一清 pending)、sessions_list 锁内快照放锁再读盘、write_sidecar
      temp+rename、error 帧 transient_retry 不产 task_error、protocolVersion
      校验(不匹配拒启,防双报 engine-crashed)
- [x] monkeycode.rs cloud_ws_open TOCTOU:PipeEntry 代次占位,连接前 claim、
      失败/收尾只删自己那代;select biased 先消费 Close
- [x] mcp.rs token:getrandom + bridge::ct_eq(弱随机退化路径删除)
- [x] tauri.conf.json CSP:script-src 'self' 禁远程脚本,远程图片一并封
      (注入外泄通道);探针 fetch 被拦有 invoke 兜底,无头冒烟验证通过
- [x] client.ts 云端控制流:指数退避+5 次放弃+短命断开闸、放弃后懒重连、
      断开即 reject 在途 pending、CloudConn.send 真实 Promise<boolean>
      (调用方改"成功才回写")、call 超时按调用覆盖(switch_model 90s+唤醒文案)

### Wave 2:P1 结构收编 ✅
- [x] journal 专职写线程+句柄缓存(上限 16 LRU):热路径零磁盘 I/O;帧序与
      seq 编号同锁;session_open 回放缺口经锁内屏障+字节位点补读确定性消除
      (并发推帧单测锁定);sidecar/回放/删除 spawn_blocking;崩溃日志轮转 .prev
- [x] 引擎协议补齐(ohmyagent):permission/respond.remember(命令段粒度规则
      +项目设置持久化)、session/exists+list、model_done 带全文、events/dropped
      不可丢通知、AgentEvent.seq(被丢 delta 占号=空洞可测)——新增 caps 5 个
      +shutdownGraceMs;go test -race 23 包全绿
- [x] 引擎契约加固:wire 防腐层(TestWireShapes 钉序列化)、tool_result.is_error、
      agent_result 全量结构化事件、退出预算宣告、integration-guide/架构文档修正
- [x] 壳侧收编(全部 caps 门控,旧路径注释"兼容尾巴"):审批记忆移引擎(壳
      perm_remember 新引擎下停用,E2E 断言二次同命令不弹卡)、session/exists
      取代 messages.jsonl 磁盘探测、model_done 前缀对账补帧+seq 空洞告警、
      is_error/agent_result 取代 "Error: " 嗅探与截断 JSON 解析、停止预算
      grace+3s
- [x] 抽 useCloudTask:createCloudTaskCore 零 React 依赖(11 ref 收敛为核心
      字段,trySendRef hack 消失),cloudtask.tsx 1014→543;新增状态机测试 9 例

### Wave 3:P2 收敛与测试 ✅
- [x] UI 共享件:filesdrawer.tsx(FsAdapter 适配双端,删两份 ~630 行实现)、
      composer.tsx(Composer/QueuedChip/RunningBar+IME helpers)、components
      ViewHeader/HeaderMenu/ConfirmPane;六视图共删 996 行重复
- [x] ohmy.rs 3039→96 门面 + transport/session/normalize/subagent/ohmy_tests
      五文件;Inner 拆 3 锁组且锁序成文;逆变换逐行比对零逻辑漂移。
      client.ts 1014 行拆 ipc/session/uploads/baizhiapi/cloudapi/host 六域,
      74 导出符号无遗漏,IPC 载荷类型归位 types.ts
- [x] 测试补白:wechat 全链路 fixture(22/22,顺手抓到二维码 URL 丢端口真 bug)、
      browser 可编程假扩展 5 条集成(snapshot→click/ref 失效/detached 自愈/
      新连顶旧连/tab 清理+对话框,12/12)、connectCloudControl 状态机(随 W1-C)
- [x] 杂项:urlencode/UNC/git 合并、time crate 换手写历算(非法日期拒绝)、
      TLD 级 Domain 防护、detached 走 [ERR_DETACHED] 标记、bridge 出站有界
      64+Notify 关闭、repair 清 tabs/handoffs、单会话 debug_assert 守卫、
      LazyLock、ms_to_rfc3339 补测(date -u 对表)、config↔browser 显式传参、
      探针 include_str! 外置、云端默认值常量块+task_defaults 迁移通道、
      model/permMode 单一真值(镜像 state 清零)、NewTaskView props 15→7、
      envelope 四合一(策略参数化,语义差异测试钉死)、go-sdk 发包形态测试

### Wave 4:P3 长期债 ✅
- [x] ts-rs 12(仅 dev-dep,cfg(test) 门控):Frame wire 结构典型化且 build()
      经它序列化(生成物=真实产帧路径),SessionStatus/PermOutcome 导出
      ui/src/gen/,types.ts 复用;幂等三连验证。HostConfig 留手写(config.rs
      范围外),SOURCE_BAIZHI 常量留手写
- [x] 帧 base64 层去除:壳只产内联 JSON;codec.frameData 三态容错唯一收口
      (存量 journal/云端裸对象两条兼容边界注释钉死),旧格式回归 3 例
- [x] 子代理认领启发式删除:无 parent_session_id 记日志丢弃,精确路径保留

### Review(2026-07-21)

终验:引擎 go vet + go test 23 包全绿;桌面 `MC_OHMYAGENT_BIN` 新引擎
cargo test **60/60 零警告**(4 个真实引擎 E2E + perm remember/对账/结构化/
不认领新 E2E);UI tsc 干净 + vitest **66/66** + vite build + uidist 重建;
无头冒烟(xvfb+dbus+探针)CSP 生效下 IPC 全链路 OK,新引擎 caps=14。

**未尽事项(留待用户决策)**:
1. 两仓库改动均未 commit(含引擎侧);引擎提交后需 bump 三个 workflow 的
   OHMYAGENT_REF 并同步 desktop/README·ARCHITECTURE 的钉版说明
2. 兼容尾巴按设计保留:codec 旧格式读路径(存量 journal/云端契约)、壳侧
   旧引擎 caps 回退路径(同包分发,可在下个版本清理)
3. 评审建议未采纳项:引擎崩溃自动重试(现状"外显+一键恢复"是可辩护的
   显式设计,未改);CloudPipes 并入 BaizhiState(收益小改动面大,未动)

# 桌面端审计修复(2026-07-25,四路探索 → 分波实施)

> 来源:对 desktop/ 的 Rust 壳 / React UI / 构建发布链三路探索 + 实跑验证。
> 范围经用户确认:P0/P1/P2 全量 + 结构重构。

## Wave 1:P0 正确性(用户当场可踩)

- [x] WSL 死路:settings.tsx:1178 仍渲染 WSL 下拉,transport.rs:144 对
      `kernel_env=wsl:*` 硬错误。改为默认不提供 WSL 选项;仅当已存配置为
      `wsl:*` 时显示只读警告行 + 一键切回本机(否则误配用户无路可退)
- [x] E2E 假绿灯:6 个 `e2e_*` 无 MC_OHMYAGENT_BIN 时 eprintln 后 return,
      测试报 ok(实跑 `cargo test e2e_` = 6 passed / 0.00s)。改 `#[ignore]`
      诚实上报 + `MC_REQUIRE_E2E=1` 时缺二进制直接 panic;CI 显式跑 --ignored

## Wave 2:P1 发布链

- [x] Makefile:109 `windows-release` 缺 `set-release-version`(macos-release:57 有),
      本地出包会把占位版本 26071401 烙进安装包名/updater/latest-windows.json
- [x] externalBin 文档漂移:README:41 / ARCHITECTURE:185 / Makefile:91 三处称
      "在基础配置",实际只在 macos/windows overlay。**让文档成真**:移进
      tauri.conf.json 基础配置(而非改文档迁就代码)
- [x] Cargo.lock.win7 无 CI 校验:加 lockfile 新鲜度检查(cargo metadata --locked)
- [x] desktop-check.yml 无 macOS job:mac 独有代码(tauri-nspanel/macos-private-api)
      只在手动 dispatch 的 workflow 编译,破坏在发版时才暴露

## Wave 3:P2 小 bug

- [x] cookies.rs:206 凭证落盘弱于配置落盘:先 `fs::write` 后 `set_permissions(0600)`
      有 umask 窗口,且用裸 rename。改走 config::atomic_write_private
- [x] main.rs:145 `schedule_browser_mcp_refresh` 250ms 无限重试无超时,
      长跑会话可让线程转到进程结束。加截止时间 + 放弃时外显
- [x] 锁中毒处理不一致:driver/config 用 `into_inner()`,main.rs:222/261/711/874
      与 browser/baizhi 大量裸 unwrap()。统一为不 panic 的取锁助手

## Wave 4:结构重构

- [x] components.tsx 1744 行拆分(markdown / 工具卡 / 权限卡 / diff / 代码查看器 /
      通用 chrome),被 14 个文件依赖,保持 barrel 导出不破坏调用方
- [x] settings.tsx 1339 行:纯函数(parseKV/mcpsToServers/serversToMcps/
      modelsToConfig/replaceBaizhiGroup)析出独立模块,便于测试
- [x] App.tsx / useSession.ts 零测试:按 useCloudTask 的 React-free core 模式补
- [x] 深色模式:styles.css:90 `[data-theme="dark"]` 块为空,切换是 no-op;
      填全令牌并放开设置页开关

## 验证

- [x] cargo test(含 MC_OHMYAGENT_BIN 真引擎 E2E)、npm test、tsc --noEmit
- [x] scripts/check_command_contract.py + python unittest
- [x] cargo build 零告警

## 实施中新发现并修掉的(不在原清单内)

- [x] `uploads::save_raw` 未清洗文件名:pub 函数,`../../../x.png` 能写出工作区。
      过 sanitize_name;测试反向验证过(旧实现下断言失败)
- [x] `baizhi::Service::new` 用 `.expect()` 构建 HTTP 客户端:在 setup 里 panic,
      Windows GUI 子系统下等于双击没反应零线索。改 `Option<Client>` 降级——
      云端/账号逐条报错,本地会话不受影响(仅 3 个使用点)
- [x] MCP server 读头无界:Bearer 校验**之前**就读头,一条不含换行的超长头能
      吃光内存;头条数无限;`incoming()` 无条件 spawn。加 32KB/100 条/32 连接上限,
      补 e2e(无上限时该测试 5s 超时失败,有上限 0.01s 通过)
- [x] 浏览器工具在引擎重启期整体失败:WorkdirFn 里 `DriverHost::get()` 报错就返 Err,
      与它上方"无法确定只跳过落盘,不阻断操作"的注释自相矛盾。按契约退化为 Ok(None)
- [x] `ohmy_mode_of("normal")` 原样转发 `"normal"`,而引擎 ParseMode 只受理
      default/plan/auto/bypassPermissions/yolo → 老 sidecar 的会话**根本打不开**。
      落到 default(更严,不替用户放宽既存意图);测试改为断言映射结果全在受理集合内
- [x] E2E 假 LLM 缺"分类器"角色:壳默认模式是 auto,引擎 ModelClassifier 启发式
      判不出时会单独发一次 LLM 请求;假服务把它当主循环请求,既让裁决拿空文本按
      Allow 放行(该弹的审批卡不弹),又白吃掉一个脚本步骤使步序错位。
      这正是 e2e_perm_remember_engine_rules 被假绿灯掩盖的失败——补上分类器应答后
      6/6 真引擎 E2E 通过,原断言一条没削弱
- [x] `viewChrome.tsx` 硬编码 `rgba(255,255,255,.42)` 会在深色下变亮白横带;
      提为 `--headerBg` 令牌(浅色沿用原值→零视觉变化)
- [x] 主题令牌防漂移:`scripts/check_theme_tokens.py` + 7 个单测。放 scripts/ 而非
      vitest——vitest 默认把 CSS 导入 stub 成空串(`?raw` 拿不到内容),
      浏览器工程也不该为读文件引 @types/node

## 用户反馈补充(2026-07-25)

- [x] 深色配色改为对齐移动端设计令牌 `mobile/src/theme.tsx`(`darkBase` +
      ACCENTS['清新绿'] 经 makeTheme 推导)。移动端只有 4 档面色/3 档文字,
      桌面 76 个令牌的缺口按"先按浅色角色定位、再落到移动端同角色令牌、
      无对位刻度时在相邻两档间内插"补齐,规则写进 styles.css 头部
      **遗留**:`--onAcc` 照移动端 acInk 用白色,白字对 `--acc #16b364` 只有
      2.74:1(浅色同位 4.33:1),低于 3:1 的 UI 文字底线。保持与设计稿一致、
      在令牌上就地标注;要过线得在设计侧改 acInk 或 ac,不在桌面偷偷翻深色字
- [x] desktop-check.yml 的固定引擎 E2E 缺 token 改硬失败(`exit 1`),
      与 desktop-{windows,macos,win7}.yml 一致——软跳过等于把"引擎集成没验证"
      伪装成绿灯,和刚修掉的 `#[ignore]` 是同一类病。仅 push 触发保留:
      fork PR 拿不到 secrets,那里跳过是机制使然而非掩盖

## 验证结果(全绿)

| 项 | 结果 |
|---|---|
| `cargo check --all-targets --locked` | 0 告警 0 错误 |
| `cargo test --locked` | 100 passed / 6 ignored(E2E 如实上报) |
| 真引擎全量 `-- --include-ignored` | **106 passed / 0 ignored**(10.1s 真实执行) |
| `tsc --noEmit` / `vitest` / `vite build` | OK / 27 files **199 passed** / built |
| 三个契约检查器 + scripts 单测 | 全 OK / Ran 18 OK |

基线对比:Rust 96 真实测试 → 106;UI 149 → 199;scripts 6 → 18。
