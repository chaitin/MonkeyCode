// 传输层:ohmyagent 进程生命周期与 JSON-RPC 通道(ohmy.rs 拆出)。
//
// 职责:二进制查找/进程拉起(--stdio)、writer/reader 线程、system/ready
// 协议握手(版本校验 + 能力宣告 + 停止预算协商)、RPC 请求/应答配对
// (rpc/respond_rpc)、journal 专职写线程与帧批量 flusher 的装配、
// stop 的优雅退出。共享状态定义见 ohmy.rs::Inner。

use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::{mpsc, oneshot};

use super::ohmy::{parse_manifest_models, Inner, OhmyDriver, ShellCtx, WslCtx};
use super::session::{valid_session_id, SessionsState};
use super::subagent::SubagentState;
use crate::config::DesktopConfig;
use crate::util::LockExt;

const RPC_TIMEOUT: Duration = Duration::from_secs(30);
const FRAME_FLUSH_MS: u64 = 30;
/// 支持的引擎 stdio 协议版本(system/ready.protocolVersion,stdio.go)。
/// 上游契约:该值**仅在不兼容变更时**改动(新增功能走 capabilities 宣告),
/// 不匹配即词汇错位,静默降级比启动失败更难排查——ready 时校验拒启
const SUPPORTED_PROTOCOL_VERSION: &str = "1.0";

/// 传输态锁组:引擎进程与 JSON-RPC 通道的共享状态。
/// 含锁:child、pending、engine_caps、engine_version(均 StdMutex);next_id/
/// shutdown_grace_ms/stopped 为原子,stdin_tx/journal_tx 为通道端。
/// 加锁秩序:本组各锁均为点状取放,不与本组或其他锁组的锁嵌套持有。
pub(super) struct TransportState {
    pub(super) child: StdMutex<Option<Child>>,
    /// 上行 JSON-RPC 行(writer 线程串行写 stdin;None 哨兵 = 关闭 stdin 触发优雅退出)
    pub(super) stdin_tx: mpsc::UnboundedSender<Option<String>>,
    pub(super) pending: StdMutex<HashMap<i64, oneshot::Sender<Value>>>,
    pub(super) next_id: AtomicI64,
    /// journal 专职写线程入口(帧落盘;通道内 Append 顺序即 seq 顺序,
    /// 由 push_frame 在 sessions 锁内投递保证,见 spawn_journal_writer)
    pub(super) journal_tx: mpsc::UnboundedSender<JournalMsg>,
    /// system/ready 宣告的引擎能力(版本握手:缺 switch RPC 时回退 destroy+resume)
    pub(super) engine_caps: StdMutex<HashSet<String>>,
    /// system/ready.version；发布包由 Desktop 构建链注入 Agent commit hash。
    pub(super) engine_version: StdMutex<String>,
    /// 引擎宣告的优雅退出预算毫秒(system/ready.shutdownGraceMs,缺省 5000):
    /// stop() 的等待预算取此值 + 3s 余量——必须**严格大于**引擎内部等待,
    /// 否则两边各等 5s 时壳先到期,优雅退出永远被 kill 抢断
    pub(super) shutdown_grace_ms: AtomicI64,
    pub(super) stopped: Arc<AtomicBool>,
    /// 本引擎进程的实例号(见 NEXT_ENGINE_INSTANCE)。
    pub(super) instance: u64,
}

/// journal 写线程消息。落盘专职化的动机(架构评审):
/// - 旧实现 push_frame 每帧 open+write+close,model_delta 每 token 一帧
///   即每 token 三次系统调用外加一次路径解析,30ms flusher 只批了 IPC
///   emit 没批落盘;
/// - push_frame 的调用方一半在 async command(tokio 运行时线程),同步
///   文件 I/O 会卡住运行时(对比 driver/mod.rs 对 repo git 操作走
///   spawn_blocking 的纪律)。
///
/// 现在 async/reader 路径只入队,写线程用缓存句柄追加。
pub(super) enum JournalMsg {
    /// 追加一行(已含换行前的完整 JSON;按到达顺序 == seq 顺序写入)
    Append { sid: String, line: String },
    /// 轮结束物化:折叠后的一轮写进 replay.jsonl(一行一轮,见 fold.rs)。
    /// `src_end` = None 时由写线程取 events.jsonl 当前长度——通道内该轮的
    /// Append 必然先于本消息到达,单线程顺序处理,此刻的文件长度精确等于
    /// "这一轮最后一帧写完"的位置。补录/迁移的旧轮后面还跟着别的帧,
    /// 必须显式给出那一轮自己的结束偏移。
    Materialize { sid: String, turn: super::fold::Turn, src_end: Option<u64> },
    /// 关闭并移除该会话的缓存句柄;带 ack 时处理完即应答——
    /// 删除会话目录前必须等到(Windows 上打开中的文件删不掉目录)
    Close { sid: String, ack: Option<std::sync::mpsc::Sender<()>> },
    /// flush 屏障:写线程处理到此处即应答,意味着此前入队的 Append
    /// 已全部落盘(回放/停机前的一致性栅栏)
    Sync { ack: std::sync::mpsc::Sender<()> },
}

impl JournalMsg {
    /// 会拿会话 id 去拼文件路径的变体(写线程据此做边界校验)。
    /// Close/Sync 不建路径,也**不参与**校验:它们带 ack,被丢弃时调用方拿到
    /// 的是"屏障已完成"的假象(Sender 随消息落栈 → recv 立刻 Err),
    /// 落盘保证就此静默失效。
    fn path_sid(&self) -> Option<&str> {
        match self {
            JournalMsg::Append { sid, .. } | JournalMsg::Materialize { sid, .. } => Some(sid),
            JournalMsg::Close { .. } | JournalMsg::Sync { .. } => None,
        }
    }
}

/// 起 journal 专职写线程,返回投递端。线程内维护「sid → append 句柄」
/// 缓存:数量上限 + 最久未用淘汰,防长期多会话累积句柄泄漏;
/// 写失败即丢句柄,下一帧重新 open 重试,坏句柄不会永久卡死一个会话。
/// 通道随 Inner 释放而关闭,线程自然退出。
pub(super) fn spawn_journal_writer(data_dir: PathBuf) -> mpsc::UnboundedSender<JournalMsg> {
    let (tx, mut rx) = mpsc::unbounded_channel::<JournalMsg>();
    std::thread::spawn(move || {
        const MAX_HANDLES: usize = 16;
        let mut handles: HashMap<String, (u64, std::fs::File)> = HashMap::new();
        let mut tick: u64 = 0; // 最近使用刻度(简易 LRU)
        while let Some(msg) = rx.blocking_recv() {
            // 写线程是帧落盘的文件系统边界:它自己 create_dir_all + 追加文件。
            // 上游(push_frame)只对 sessions 表里的会话产帧,而入表的 id 都过了
            // session::valid_session_id——但那是**跨模块的隐式不变量**,一旦哪天
            // 有人从别处投递,这里就是任意目录追加。在边界上自己再判一次,
            // 契约 3 那句"唯一允许拼路径的构造器"才是真的。
            //
            // 只判真正拼路径的两个变体。Sync 与 Close(wait=true)带 ack,
            // **不能**一起过滤:那不会挂死(ack 的 Sender 随消息丢弃,调用方
            // 的 rx.recv() 立刻拿到 Err),而是更隐蔽的——屏障照常返回,却不再
            // 保证"此前入队的 Append 已落盘"。后果是 replay_open 读到未落盘的
            // journal(开会话丢帧),以及 Windows 上句柄未关就去删目录。
            if let Some(sid) = msg.path_sid() {
                if !valid_session_id(sid) {
                    eprintln!("[desktop] 帧日志收到非法会话 id,已丢弃: {sid:?}");
                    continue;
                }
            }
            match msg {
                JournalMsg::Append { sid, line } => {
                    tick += 1;
                    if !handles.contains_key(&sid) {
                        if handles.len() >= MAX_HANDLES {
                            let oldest =
                                handles.iter().min_by_key(|(_, (t, _))| *t).map(|(k, _)| k.clone());
                            if let Some(k) = oldest {
                                handles.remove(&k); // drop 即关闭
                            }
                        }
                        let dir = data_dir.join(&sid);
                        let _ = std::fs::create_dir_all(&dir);
                        match std::fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(dir.join("events.jsonl"))
                        {
                            Ok(f) => {
                                handles.insert(sid.clone(), (tick, f));
                            }
                            Err(e) => {
                                eprintln!("[desktop] 打开帧日志失败({sid}): {e}");
                                continue;
                            }
                        }
                    }
                    let Some((t, f)) = handles.get_mut(&sid) else { continue };
                    *t = tick;
                    if writeln!(f, "{line}").is_err() {
                        handles.remove(&sid);
                    }
                }
                // 一轮一次,不值得为它留句柄(留了反而是 Windows 删目录时
                // 的又一个待关文件):每轮 open-append-close。
                JournalMsg::Materialize { sid, mut turn, src_end } => {
                    // 截断只发生在写进 replay.jsonl 的这一刻(见 Turn::guard)
                    turn.guard();
                    let dir = data_dir.join(&sid);
                    let end = match src_end {
                        Some(v) => v,
                        None => std::fs::metadata(dir.join("events.jsonl"))
                            .map(|m| m.len())
                            .unwrap_or(0),
                    };
                    match std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(dir.join("replay.jsonl"))
                    {
                        Ok(mut f) => {
                            if let Err(e) = writeln!(f, "{}", turn.to_line(end)) {
                                eprintln!("[desktop] 写回放日志失败({sid}): {e}");
                            }
                        }
                        // 写不成只是这轮下次打开要现折,不影响正确性
                        Err(e) => eprintln!("[desktop] 打开回放日志失败({sid}): {e}"),
                    }
                }
                JournalMsg::Close { sid, ack } => {
                    handles.remove(&sid);
                    if let Some(a) = ack {
                        let _ = a.send(());
                    }
                }
                JournalMsg::Sync { ack } => {
                    let _ = ack.send(());
                }
            }
        }
    });
    tx
}

/// 崩溃现场留存份数。
const CRASH_LOG_KEEP: usize = 3;

/// 引擎实例号发号器。壳生命周期内可能先后起过多个引擎进程,而"某个引擎
/// 退出了"这条通知必须能对应到**具体哪一个**——否则一个早已被弃用的进程
/// (启动超时后残留、重启中途自行退出)几分钟后咽气,会被当成当前引擎崩溃:
/// 摘掉活引擎的句柄、发崩溃横幅、再排一次自动重启。
static NEXT_ENGINE_INSTANCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// 把崩溃当时的引擎日志另存一份。start 的 `.prev` 轮转只保留上一次运行,
/// 而自动重启是连着退避重试好几轮的——首次崩溃(最有诊断价值的那次)会被
/// 后面几次覆盖掉,只剩事件里的 15 行 tail。copy 而非 rename:原文件要留给
/// 下一次 start 的 `.prev` 轮转,且 Windows 上重命名刚被进程持有过的文件易失败。
fn preserve_crash_log(log: &std::path::Path) {
    let Some(dir) = log.parent() else { return };
    let nth = |n: usize| dir.join(format!("ohmyagent.crash-{n}.log"));
    let _ = std::fs::remove_file(nth(CRASH_LOG_KEEP));
    for n in (1..CRASH_LOG_KEEP).rev() {
        let _ = std::fs::rename(nth(n), nth(n + 1));
    }
    if let Err(e) = std::fs::copy(log, nth(1)) {
        eprintln!("[desktop] 留存崩溃日志失败: {e}");
    }
}

/// 启动失败的收尾:置 stopped(reader 据此不把随后的 EOF 当崩溃上报——
/// 启动错误已由返回值外显,不能双报;flusher 也据此退出,否则它会永远
/// 持有 Arc<Inner>)、关 stdin、杀掉并回收子进程。原样返回错误便于
/// `return Err(abort_startup(...))` 收口每条早退分支。
fn abort_startup(inner: &Arc<Inner>, err: String) -> String {
    inner.transport.stopped.store(true, Ordering::Relaxed);
    let _ = inner.transport.stdin_tx.send(None);
    if let Some(mut child) = inner.transport.child.lock_ok().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    // kill 只终结 wsl.exe 中继;guest 引擎若已拉起需补刀,否则残活进程
    // 继续持有 OHMYAGENT_CONFIG_DIR 下的 sessions
    if let Some(w) = &inner.wsl {
        crate::wsl::kill_guest_engine(&w.distro, &w.bin_name);
    }
    err
}

impl OhmyDriver {
    // ==================== 生命周期 ====================

    pub fn start(app: AppHandle, cfg: &DesktopConfig) -> Result<Self, String> {
        Self::start_with(Arc::new(app), cfg)
    }

    pub fn start_with(app: Arc<dyn ShellCtx>, cfg: &DesktopConfig) -> Result<Self, String> {
        let cfg_dir = app.config_dir()?;
        let chat_workspaces_dir = app.local_data_dir()?.join("chat-workspaces");
        let log_path = cfg_dir.join("ohmyagent.log");
        // 崩溃日志轮转:File::create 会截断,崩溃后一键重启就把现场抹掉,
        // 只剩 engine-crashed 事件里的 15 行 tail——先把旧日志挪成 .prev
        // 保留完整上一份现场(rename 同目录原子,失败也只是丢旧日志不阻断启动)
        if log_path.is_file() {
            let _ = std::fs::rename(&log_path, cfg_dir.join("ohmyagent.log.prev"));
        }
        let log_file = std::fs::File::create(&log_path).ok();

        // 引擎私有配置目录(OHMYAGENT_CONFIG_DIR):settings/sessions/mcp 等
        // 全部派生路径随之落在 app_config_dir/ohmyagent,不再接管全局 ~/.ohmyagent。
        // 一次性迁移:旧接管目录的 sessions 拷过来(sidecar 权威过滤,多拷无害)。
        let engine_dir = cfg_dir.join("ohmyagent");
        let process_home = app.process_home();
        migrate_legacy_sessions(&engine_dir, process_home.as_deref());

        // 目录先建好:本机分支 cwd 要用,WSL 分支 prepare 的 wslpath 要翻译它们
        std::fs::create_dir_all(&engine_dir)
            .map_err(|e| format!("创建引擎运行目录失败({}): {e}", engine_dir.display()))?;
        let (mut cmd, wsl_ctx) =
            build_engine_command(cfg, app.as_ref(), &engine_dir, &chat_workspaces_dir)?;
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(log_file.map(Stdio::from).unwrap_or_else(Stdio::null));
        // 引擎(或 wsl.exe 中继)是控制台子系统 exe,Windows 上 GUI 壳直接
        // spawn 会弹黑窗
        crate::wsl::no_console(&mut cmd);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("启动 ohmyagent 失败: {e}"))?;

        // 管道拿不到就地杀掉:此时 Inner 还没建起来,走不了 abort_startup,
        // 直接 return 会把刚 spawn 的进程漏在外面
        let (stdin, stdout) = match (child.stdin.take(), child.stdout.take()) {
            (Some(i), Some(o)) => (i, o),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                if let Some(w) = &wsl_ctx {
                    crate::wsl::kill_guest_engine(&w.distro, &w.bin_name);
                }
                return Err("ohmyagent 标准输入/输出管道不可用".into());
            }
        };

        let models = parse_manifest_models(&cfg.models);
        let data_dir = cfg_dir.join("ohmy-sessions");
        let _ = std::fs::create_dir_all(&data_dir);
        // 壳侧审批记忆持久化(兼容尾巴):仅旧引擎会消费;新引擎
        // (permissionRemember cap)的记忆归引擎项目设置,此文件停用
        let perm_persist_path = cfg_dir.join("ohmy-perm-remember.json");
        let perm_remember: HashSet<String> = std::fs::read(&perm_persist_path)
            .ok()
            .and_then(|d| serde_json::from_slice(&d).ok())
            .unwrap_or_default();

        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<Option<String>>();
        // ready 信道携带握手结果:Ok=就绪,Err=协议版本不兼容(启动失败外显)
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();

        let inner = Arc::new(Inner {
            app,
            transport: TransportState {
                child: StdMutex::new(Some(child)),
                stdin_tx,
                pending: StdMutex::new(HashMap::new()),
                next_id: AtomicI64::new(1),
                journal_tx: spawn_journal_writer(data_dir.clone()),
                engine_caps: StdMutex::new(HashSet::new()),
                engine_version: StdMutex::new(String::new()),
                shutdown_grace_ms: AtomicI64::new(5000),
                stopped: Arc::new(AtomicBool::new(false)),
                instance: NEXT_ENGINE_INSTANCE.fetch_add(1, Ordering::Relaxed),
            },
            sess: SessionsState {
                sessions: StdMutex::new(HashMap::new()),
                batch: Arc::new(StdMutex::new(HashMap::new())),
                sidecar_write: StdMutex::new(()),
                perm_remember: StdMutex::new(perm_remember),
                pending_questions: StdMutex::new(HashMap::new()),
                pending_perms: StdMutex::new(HashMap::new()),
                perm_tools: StdMutex::new(HashMap::new()),
                resume: StdMutex::new(HashMap::new()),
            },
            sub: SubagentState {
                subagents: StdMutex::new(HashMap::new()),
                agent_results: StdMutex::new(HashMap::new()),
                agent_inputs: StdMutex::new(HashMap::new()),
                background_agents: StdMutex::new(HashMap::new()),
            },
            models,
            data_dir,
            engine_dir,
            chat_workspaces_dir,
            perm_persist_path,
            stats: crate::stats::UsageStats::new(&cfg_dir),
            wsl: wsl_ctx,
        });

        // writer 线程:串行写 stdin;收到 None 哨兵或通道关闭即丢弃 stdin
        // (EOF → ohmyagent stdio server 优雅退出)
        std::thread::spawn(move || {
            let mut stdin = stdin;
            loop {
                let msg = tauri::async_runtime::block_on(stdin_rx.recv());
                match msg {
                    Some(Some(line)) => {
                        if stdin.write_all(line.as_bytes()).is_err() || stdin.write_all(b"\n").is_err() {
                            break;
                        }
                        let _ = stdin.flush();
                    }
                    Some(None) | None => break,
                }
            }
            // drop(stdin) → EOF
        });

        // reader 线程:逐行路由(RPC 应答 / 通知)
        let inner_r = inner.clone();
        let crash_log = log_path.clone();
        // 崩溃 tail 取「引擎自己的运行日志优先」那份(engine_log_file):
        // stderr 正常跑一轮是 0 字节,只认它的话横幅里那 15 行永远是空的
        let crash_cfg_dir = cfg_dir.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                if v.get("id").and_then(|i| i.as_i64()).is_some() && v.get("method").is_none() {
                    // RPC 应答
                    let id = v.get("id").and_then(|i| i.as_i64()).unwrap();
                    if let Some(tx) = inner_r.transport.pending.lock_ok().remove(&id) {
                        let _ = tx.send(v);
                    }
                    continue;
                }
                let method = v.get("method").and_then(|m| m.as_str()).unwrap_or("");
                let params = v.get("params").cloned().unwrap_or(Value::Null);
                match method {
                    "system/ready" => {
                        // 协议版本校验:不匹配(含缺失=过旧引擎)即不兼容,
                        // 经 ready 信道转成启动失败;不继续记 caps——
                        // 词汇已不可信,能力宣告也无意义
                        let proto = params
                            .get("protocolVersion")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if proto != SUPPORTED_PROTOCOL_VERSION {
                            let shown = if proto.is_empty() { "未知(过旧)" } else { proto };
                            let _ = ready_tx.send(Err(format!(
                                "ohmyagent 引擎协议版本不兼容(引擎 {shown},应用支持 {SUPPORTED_PROTOCOL_VERSION}),请更新应用后重试"
                            )));
                            continue;
                        }
                        // 版本握手:记录引擎宣告的能力,缺口路径运行时回退
                        let caps: HashSet<String> = params
                            .get("capabilities")
                            .and_then(|v| v.as_array())
                            .map(|a| a.iter().filter_map(|c| c.as_str().map(String::from)).collect())
                            .unwrap_or_default();
                        let version =
                            params.get("version").and_then(|v| v.as_str()).unwrap_or("?").to_string();
                        eprintln!("[desktop] ohmyagent 就绪 version={version} caps={}", caps.len());
                        *inner_r.transport.engine_version.lock_ok() = version;
                        *inner_r.transport.engine_caps.lock_ok() = caps;
                        // 停止预算协商:记下引擎内部的优雅退出预算,stop()
                        // 的等待取 grace+3s(见 shutdown_grace_ms 字段注释)
                        if let Some(g) =
                            params.get("shutdownGraceMs").and_then(|v| v.as_i64()).filter(|g| *g > 0)
                        {
                            inner_r.transport.shutdown_grace_ms.store(g, Ordering::Relaxed);
                        }
                        let _ = ready_tx.send(Ok(()));
                    }
                    _ => inner_r.handle_notification(method, params),
                }
            }
            // stdout EOF = 进程退出:无论优雅停止还是崩溃都先释放在途 RPC
            // 等待者(此后不可能再有应答;respond_rpc 的 fire-and-log 任务
            // 也靠 sender 丢弃收尾,否则优雅停止后任务悬挂到 Inner 释放)
            inner_r.transport.pending.lock_ok().clear();
            // stop() 未置位即崩溃,外显
            if !inner_r.transport.stopped.load(Ordering::Relaxed) {
                inner_r.reconcile_all("引擎进程异常退出"); // 运行中会话本地收尾,不留永久 running
                inner_r.flush_batch(); // 收尾帧要立刻到 UI,不等 flusher 的下一拍
                let tail = super::engine_log_file(&crash_cfg_dir)
                    .map(|p| super::log_tail(&p, 15))
                    .unwrap_or_default();
                preserve_crash_log(&crash_log); // stderr 那份照旧留档(崩溃现场可能只在它里面)
                eprintln!("[desktop] ohmyagent 引擎异常退出");
                // 置位收摊:flusher 只认 stopped 退出,不置位它会永远持有
                // Arc<Inner>——每崩一次就泄漏一整份会话状态与 journal 写线程,
                // 自动重启下这个泄漏会按崩溃次数累积
                inner_r.transport.stopped.store(true, Ordering::Relaxed);
                // 回收子进程:Rust 的 Child::drop **不** wait,不收就是僵尸
                if let Some(mut child) = inner_r.transport.child.lock_ok().take() {
                    let _ = child.wait();
                }
                // WSL 模式:stdout EOF 只证明 wsl.exe 中继死了,guest 引擎
                // 可能还活着(wsl --shutdown、VM 休眠恢复、外因杀中继)。
                // 必须在通知壳(→退避重启)之前补刀,否则新老两个引擎并存
                // 共写同一个 OHMYAGENT_CONFIG_DIR。reader 是专职线程,
                // 同步跑 10s 超时的 wsl 调用可接受。
                if let Some(w) = &inner_r.wsl {
                    crate::wsl::kill_guest_engine(&w.distro, &w.bin_name);
                }
                inner_r.app.on_engine_exit(
                    inner_r.transport.instance,
                    "ohmyagent 进程异常退出",
                    &tail,
                );
            }
        });

        // 批量 flusher:30ms 排空待发帧
        let inner_f = inner.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(FRAME_FLUSH_MS)).await;
                if inner_f.transport.stopped.load(Ordering::Relaxed) {
                    return;
                }
                inner_f.flush_batch();
            }
        });

        // 等 system/ready;协议版本不匹配与握手超时走同一条收尾。
        // WSL 模式放宽到 30s:VM 冷启已被 prepare 吸收,余量给 /mnt/c 上
        // 9p 读取大二进制 + Defender 扫描。
        let ready_budget = if inner.wsl.is_some() { 30 } else { 15 };
        match ready_rx.recv_timeout(Duration::from_secs(ready_budget)) {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(abort_startup(&inner, e)),
            // 超时此前直接 return:进程没杀、stopped 没置——留下一个孤儿引擎
            // 常驻,它的 flusher 永远持有 Arc<Inner>,而它日后咽气时 reader
            // 还会把这次 EOF 当成"当前引擎崩溃"上报
            Err(_) => {
                return Err(abort_startup(
                    &inner,
                    format!("ohmyagent 未在 {ready_budget} 秒内就绪(查看 ohmyagent.log)"),
                ))
            }
        }
        eprintln!("[desktop] ohmyagent 引擎就绪");
        Ok(OhmyDriver(inner))
    }

    pub fn stop(&self) {
        // 先本地和解运行中会话(补收尾帧)并同步排空缓冲——
        // 此后 flusher 退出也不丢帧,sidecar 不会残留 running
        self.0.reconcile_all("引擎已停止");
        self.0.flush_batch();
        // 收尾帧经写线程落盘完毕再返回:停机路径(以及紧随其后的读日志)
        // 必须看到完整 journal,不能让队列里的尾帧悬在内存
        self.0.journal_barrier();
        self.0.transport.stopped.store(true, Ordering::Relaxed);
        let _ = self.0.transport.stdin_tx.send(None); // 关 stdin → 优雅退出
        let Some(mut child) = self.0.transport.child.lock_ok().take() else { return };
        // 停止预算协商:引擎收到 EOF 后自己也要等运行中 loop 收敛
        // (ready.shutdownGraceMs,缺省 5s)再退出——壳若同样只等 5s,
        // 两个 5s 叠死,壳必先到期 kill,优雅退出永远走不完。
        // 壳预算 = 引擎宣告预算 + 3s 余量(引擎强制清理与进程退出的时间)
        let grace = self.0.transport.shutdown_grace_ms.load(Ordering::Relaxed).max(0) as u64;
        let deadline = std::time::Instant::now() + Duration::from_millis(grace + 3000);
        while std::time::Instant::now() < deadline {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(_) => break,
            }
        }
        eprintln!("[desktop] ohmyagent 未在期限内优雅退出,强制终止");
        let _ = child.kill();
        let _ = child.wait();
        // 强杀只终结 wsl.exe 中继,guest 引擎补刀(优雅路径不需要:
        // stdin EOF 透传到 guest,引擎自退,中继随之退出)
        if let Some(w) = &self.0.wsl {
            crate::wsl::kill_guest_engine(&w.distro, &w.bin_name);
        }
    }

    // ==================== JSON-RPC ====================

    pub(super) async fn rpc(&self, method: &str, params: Value) -> Result<Value, String> {
        self.rpc_with_timeout(method, params, RPC_TIMEOUT).await
    }

    /// 同 rpc,但放宽等待预算——仅供**引擎同步应答且本身耗时**的方法
    /// (如 session/compact:应答要等整段历史的 LLM 摘要跑完)。常规命令
    /// 一律走 rpc:预算越长,引擎挂死时用户等白屏的时间就越久。
    pub(super) async fn rpc_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        // 引擎已收摊就别再登记等待者。stdin_tx 是 unbounded 通道,writer 线程
        // 早退后 send 依然"成功",于是这条请求会挂到超时才报错——
        // 崩溃瞬间在途的命令因此白等半分钟。reader 清 pending 与本次登记之间
        // 的窗口就是靠这个标志收口的。
        if self.0.transport.stopped.load(Ordering::Relaxed) {
            return Err("引擎已退出".into());
        }
        let id = self.0.transport.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.0.transport.pending.lock_ok().insert(id, tx);
        let line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string();
        if self.0.transport.stdin_tx.send(Some(line)).is_err() {
            self.0.transport.pending.lock_ok().remove(&id);
            return Err("引擎已退出".into());
        }
        let resp = match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(v)) => v,
            Ok(Err(_)) => return Err("引擎已退出".into()),
            Err(_) => {
                self.0.transport.pending.lock_ok().remove(&id);
                return Err(format!("{method} 超时"));
            }
        };
        if let Some(err) = resp.get("error").filter(|e| !e.is_null()) {
            let msg = err.get("message").and_then(|m| m.as_str()).unwrap_or("未知错误");
            return Err(msg.to_string());
        }
        Ok(resp.get("result").cloned().unwrap_or(Value::Null))
    }

    /// respond 型上行(permission/question 应答)——委托 Inner::respond_rpc,
    /// 带 id 发送并异步消费应答(不能用无 id 通知,见 Inner::respond_rpc)。
    pub(super) fn respond_rpc(&self, method: &str, params: Value) {
        self.0.respond_rpc(method, params);
    }
}

impl Inner {
    pub(super) fn has_cap(&self, cap: &str) -> bool {
        self.transport.engine_caps.lock_ok().contains(cap)
    }

    /// respond 型上行(permission/respond、question/respond)带 id 发送,
    /// 应答注册 pending 等待者异步消费(fire-and-log)。引擎把这两类当
    /// **请求**处理且必回应答(stdio.go handlePermissionRespond /
    /// handleQuestionRespond),过期 question 还特意回 -32000 错误;若按
    /// 无 id 通知发,引擎 NewErrorResponse(nil,…) 产出 id:null 应答,
    /// reader 的 as_i64 判定不成立 → 落进 method 分派被静默丢弃,错误蒸发。
    /// 绝不同步阻塞等应答:部分调用点在 reader 线程上(handle_notification
    /// 的记忆集自动放行),而 pending 应答正由 reader 线程回填,阻塞即
    /// 自死锁——spawn 到 async 运行时 await,错误仅 eprintln 外显。
    pub(super) fn respond_rpc(&self, method: &str, params: Value) {
        // 同 rpc:引擎收摊后登记的等待者永远等不到应答,只会挂到 Inner 释放
        if self.transport.stopped.load(Ordering::Relaxed) {
            return;
        }
        let id = self.transport.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.transport.pending.lock_ok().insert(id, tx);
        let line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string();
        if self.transport.stdin_tx.send(Some(line)).is_err() {
            self.transport.pending.lock_ok().remove(&id);
            return;
        }
        let method = method.to_string();
        tauri::async_runtime::spawn(async move {
            // 引擎按协议必回应答,不设超时;进程退出时 reader EOF 清 pending
            // 表丢弃 sender → rx Err 收尾任务,崩溃路径已另行外显不重复报
            if let Ok(resp) = rx.await {
                if let Some(err) = resp.get("error").filter(|e| !e.is_null()) {
                    let msg = err.get("message").and_then(|m| m.as_str()).unwrap_or("未知错误");
                    eprintln!("[desktop] {method} 被引擎拒绝: {msg}");
                }
            }
        });
    }

    /// flush 屏障:等写线程排空此前入队的所有 Append(阻塞,勿在
    /// async 上下文直接调用——回放/删除路径经 spawn_blocking 进来)。
    /// 通道已关(引擎停闭后期)则直接返回。
    pub(super) fn journal_barrier(&self) {
        let (tx, rx) = std::sync::mpsc::channel();
        if self.transport.journal_tx.send(JournalMsg::Sync { ack: tx }).is_ok() {
            let _ = rx.recv();
        }
    }

    /// 关闭并移除某会话的 journal 缓存句柄;wait=true 时等到写线程处理
    /// 完毕(队列中该会话的余帧先落盘、句柄已 drop)——删目录前必须等。
    pub(super) fn journal_close(&self, sid: &str, wait: bool) {
        let (tx, rx) = std::sync::mpsc::channel();
        let ack = wait.then_some(tx);
        if self.transport.journal_tx.send(JournalMsg::Close { sid: sid.to_string(), ack }).is_err() {
            return;
        }
        if wait {
            let _ = rx.recv();
        }
    }
}

/// 一次性迁移:接管时代写在 ~/.ohmyagent 的会话搬进私有目录
/// (仅当私有目录还没有 sessions;拷贝失败静默,最坏丢历史不丢功能)。
fn migrate_legacy_sessions(engine_dir: &std::path::Path, legacy_home: Option<&std::path::Path>) {
    let new_sessions = engine_dir.join("sessions");
    if new_sessions.exists() {
        return;
    }
    let Some(home) = legacy_home else { return };
    let old_sessions = home.join(".ohmyagent").join("sessions");
    if !old_sessions.is_dir() {
        return;
    }
    fn copy_dir(src: &std::path::Path, dst: &std::path::Path) {
        let _ = std::fs::create_dir_all(dst);
        let Ok(entries) = std::fs::read_dir(src) else { return };
        for e in entries.flatten() {
            let (s, d) = (e.path(), dst.join(e.file_name()));
            if s.is_dir() {
                copy_dir(&s, &d);
            } else {
                let _ = std::fs::copy(&s, &d);
            }
        }
    }
    copy_dir(&old_sessions, &new_sessions);
    eprintln!("[desktop] 已迁移 ~/.ohmyagent/sessions → {}", new_sessions.display());
}

/// 登录 shell 环境补齐(unix):从 Finder/Dock/桌面启动器点开时,GUI 会话
/// 给壳的环境是贫瘠子集(macOS 下 PATH 仅系统四目录),shell profile 里
/// export 的 PATH/代理/密钥全部缺席——引擎的 bash 工具与其 spawn 的
/// MCP stdio 子进程(npx 等)会齐刷刷"命令找不到"。这里跑一次用户登录
/// shell 取完整 env(VS Code 同款手法),进程级缓存(save_config 重启
/// 引擎不反复起 shell)。Windows 的 GUI 进程本就继承完整用户环境,不需要。
///
/// 合并策略见 engine_env_additions:**只补壳进程缺失的键**——GUI 会话
/// 独有的值(如 launchd 的 SSH_AUTH_SOCK)不被登录 shell 的覆盖;
/// PATH 例外,取"登录 shell 在前 + 壳独有段追加"的并集。终端启动开发时
/// 登录 env 基本是当前 env 的子集,合并自然无感。
#[cfg(unix)]
fn login_shell_env() -> &'static HashMap<String, String> {
    static CACHE: std::sync::OnceLock<HashMap<String, String>> = std::sync::OnceLock::new();
    CACHE.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        // env -0 防值内换行;老 env 无 -0 时回退普通形态(值内换行的键会解坏,
        // 解析层跳过坏行即可)。command 前缀绕开同名 alias/函数。
        let mut child = match Command::new(&shell)
            .args(["-lc", "command env -0 2>/dev/null || command env"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[desktop] 登录 shell({shell})启动失败,引擎环境不补齐: {e}");
                return HashMap::new();
            }
        };
        // stdout 必须并发读:env 输出超过管道缓冲时,先 wait 后读会互相卡死
        let mut out = child.stdout.take().expect("piped");
        let reader = std::thread::spawn(move || {
            let mut buf = Vec::new();
            use std::io::Read;
            let _ = out.read_to_end(&mut buf);
            buf
        });
        // 5s 超时:用户 profile 挂死(等输入/网络)不能拖住壳启动
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if std::time::Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    eprintln!("[desktop] 登录 shell 5s 未返回(profile 挂死?),引擎环境不补齐");
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(30)),
                Err(_) => break,
            }
        }
        let buf = reader.join().unwrap_or_default();
        let env = parse_env_output(&buf);
        if !env.is_empty() {
            eprintln!("[desktop] 登录 shell 环境已解析({} 项)", env.len());
        }
        env
    })
}

/// env(-0) 输出 → 键值表:优先按 NUL 分隔,无 NUL(回退形态)按行分隔;
/// 无 '=' 的坏行(回退形态下值内换行的碎片)跳过。
fn parse_env_output(buf: &[u8]) -> HashMap<String, String> {
    let text = String::from_utf8_lossy(buf);
    let sep = if text.contains('\0') { '\0' } else { '\n' };
    text.split(sep)
        .filter_map(|kv| kv.split_once('='))
        .filter(|(k, _)| !k.is_empty())
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

/// 引擎子进程的补齐项(在继承壳环境的基础上叠加)。纯函数,current 由
/// 调用方传入以便测试。会话性噪音键(PWD/SHLVL 等)不搬。
fn merge_login_env(
    login: &HashMap<String, String>,
    current: &HashMap<String, String>,
) -> Vec<(String, String)> {
    const SKIP: [&str; 4] = ["PWD", "OLDPWD", "SHLVL", "_"];
    let mut out = Vec::new();
    for (k, v) in login {
        if SKIP.contains(&k.as_str()) {
            continue;
        }
        if k == "PATH" {
            // 登录 shell 的 PATH 在前(用户配置的优先级),壳环境独有段追加
            let mut parts: Vec<&str> = v.split(':').filter(|s| !s.is_empty()).collect();
            for p in current.get("PATH").map(String::as_str).unwrap_or("").split(':') {
                if !p.is_empty() && !parts.contains(&p) {
                    parts.push(p);
                }
            }
            out.push((k.clone(), parts.join(":")));
        } else if !current.contains_key(k) {
            out.push((k.clone(), v.clone()));
        }
    }
    out
}

#[cfg(unix)]
fn engine_env_additions() -> Vec<(String, String)> {
    let current: HashMap<String, String> = std::env::vars().collect();
    merge_login_env(login_shell_env(), &current)
}

#[cfg(not(unix))]
fn engine_env_additions() -> Vec<(String, String)> {
    Vec::new()
}

#[cfg(test)]
mod login_env_tests {
    use super::*;

    #[test]
    fn parse_nul_and_line_forms() {
        let nul = b"A=1\0PATH=/a:/b\0EMPTY=\0BAD\0";
        let m = parse_env_output(nul);
        assert_eq!(m.get("A").map(String::as_str), Some("1"));
        assert_eq!(m.get("PATH").map(String::as_str), Some("/a:/b"));
        assert_eq!(m.get("EMPTY").map(String::as_str), Some(""));
        assert!(!m.contains_key("BAD"));
        // 回退形态:按行;值内换行的碎片行(无 =)被跳过
        let lines = b"A=1\nWRAPPED=first\nsecond half\nB=2";
        let m = parse_env_output(lines);
        assert_eq!(m.get("B").map(String::as_str), Some("2"));
        assert!(!m.contains_key("second half"));
    }

    #[test]
    fn merge_only_fills_missing_and_unions_path() {
        let login: HashMap<String, String> = [
            ("PATH", "/opt/homebrew/bin:/usr/bin"),
            ("HTTP_PROXY", "http://127.0.0.1:7890"),
            ("SSH_AUTH_SOCK", "/login/sock"),
            ("PWD", "/home/u"),
        ]
        .into_iter()
        .map(|(k, v)| (k.into(), v.into()))
        .collect();
        let current: HashMap<String, String> =
            [("PATH", "/usr/bin:/bin"), ("SSH_AUTH_SOCK", "/gui/launchd.sock")]
                .into_iter()
                .map(|(k, v)| (k.into(), v.into()))
                .collect();
        let out: HashMap<String, String> = merge_login_env(&login, &current).into_iter().collect();
        // PATH 并集:登录在前,壳独有段(/bin)追加,去重(/usr/bin)
        assert_eq!(out.get("PATH").map(String::as_str), Some("/opt/homebrew/bin:/usr/bin:/bin"));
        // 缺失键补上
        assert_eq!(out.get("HTTP_PROXY").map(String::as_str), Some("http://127.0.0.1:7890"));
        // 壳已有的键不覆盖(GUI 会话的 SSH_AUTH_SOCK 保留)、噪音键不搬
        assert!(!out.contains_key("SSH_AUTH_SOCK"));
        assert!(!out.contains_key("PWD"));
    }

    #[test]
    fn login_shell_whitelist_falls_back_to_sh() {
        assert_eq!(pick_login_shell("/bin/bash"), "/bin/bash");
        assert_eq!(pick_login_shell("/usr/bin/zsh"), "/usr/bin/zsh");
        assert_eq!(pick_login_shell("/bin/dash"), "/bin/dash");
        // fish/csh 的 -c 参数语义不同,回退 /bin/sh
        assert_eq!(pick_login_shell("/usr/bin/fish"), "/bin/sh");
        assert_eq!(pick_login_shell("/bin/csh"), "/bin/sh");
        assert_eq!(pick_login_shell(""), "/bin/sh");
    }

    #[test]
    fn legacy_migration_uses_the_injected_home() {
        let root = std::env::temp_dir().join(format!("mc-migrate-home-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let home = root.join("isolated-home");
        let old = home.join(".ohmyagent/sessions/s1");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("messages.jsonl"), b"one\n").unwrap();
        let engine = root.join("engine");

        super::migrate_legacy_sessions(&engine, Some(&home));

        assert_eq!(std::fs::read(engine.join("sessions/s1/messages.jsonl")).unwrap(), b"one\n");
        let _ = std::fs::remove_dir_all(&root);
    }
}

/// 组装引擎启动命令。本机模式:直接执行 ohmyagent;WSL 模式
/// (kernel_env=wsl:*):`wsl.exe -d <发行版> --exec <登录shell> -l -c
/// 'cd "$1" && exec "$2" --stdio'`,stdio 经中继透传,协议/握手/日志
/// 全部原样复用。env 装配秩序:补齐项 → 测试覆盖 → OHMYAGENT_CONFIG_DIR
/// (恒最后,不被前两者影响——历史 bug:登录 shell 若 export 同名变量
/// 会把私有配置指走)。
fn build_engine_command(
    cfg: &DesktopConfig,
    app: &dyn ShellCtx,
    engine_dir: &std::path::Path,
    chat_workspaces_dir: &std::path::Path,
) -> Result<(Command, Option<WslCtx>), String> {
    // WSL 仅 Windows 支持(Linux 开发机经 MC_WSL_EXE 假脚本冒烟例外);
    // 其他平台残留的 wsl:* 配置(坏值同理经 distro_of 滤掉)降级本机运行,
    // 不进必然失败的启动路径。这里是 kernel_env 的唯一消费点,配置层不再兜底。
    let wsl_supported = cfg!(windows) || std::env::var("MC_WSL_EXE").is_ok();
    let distro = crate::wsl::distro_of(&cfg.kernel_env).filter(|_| {
        if !wsl_supported {
            eprintln!("[desktop] kernel_env={:?} 在当前平台不可用,按本机运行", cfg.kernel_env);
        }
        wsl_supported
    });
    let Some(distro) = distro else {
        // 本机模式(原有行为,零变化)
        let bin = find_ohmyagent().ok_or_else(|| {
            "找不到 ohmyagent 可执行文件(查找顺序: MC_OHMYAGENT_BIN 环境变量 → 应用同目录 → PATH)"
                .to_string()
        })?;
        // agent 会把 <进程 cwd>/.ohmyagent/settings.json 当项目级配置加载。
        // 若 cwd 是用户主目录,旧版 Desktop 遗留的 ~/.ohmyagent 会反过来
        // 覆盖 OHMYAGENT_CONFIG_DIR 指向的壳私有配置(典型表现是 200k 又
        // 退回 128k)。因此进程固定在私有引擎目录;各会话工作目录仍由
        // session/create 显式传入,不受这里影响。
        let mut cmd = Command::new(&bin);
        cmd.current_dir(engine_dir)
            .envs(engine_env_additions())
            .envs(app.engine_env_overrides())
            .env("OHMYAGENT_CONFIG_DIR", engine_dir)
            .arg("--stdio");
        return Ok((cmd, None));
    };

    let bin = find_ohmyagent_linux().ok_or_else(|| {
        "找不到 Linux 版 ohmyagent(查找顺序: MC_OHMYAGENT_LINUX_BIN 环境变量 → 应用同目录 \
         ohmyagent-linux)。WSL 运行环境需要随安装包分发的 Linux 引擎,请重装应用或切换回本机"
            .to_string()
    })?;
    // chat 工作区根也要参与翻译(guest_chat_root),先确保存在
    let _ = std::fs::create_dir_all(chat_workspaces_dir);
    // 一次 wsl 调用:预热 VM + 健康检查 + 采集 home/登录 shell/网络模式 +
    // 批量 wslpath 翻译。失败即启动失败,文案含排查指引,经既有三条外显
    // 路径(setup 失败页/设置页报错/退避重启横幅)呈现。
    let prep = crate::wsl::prepare(distro, &[bin.as_path(), engine_dir, chat_workspaces_dir])?;
    let [guest_bin, guest_engine_dir, guest_chat_root]: [String; 3] =
        prep.paths.try_into().map_err(|_| "WSL 路径翻译数量异常".to_string())?;
    // guest cwd 必须钉在引擎私有目录(同上本机分支的 ~/.ohmyagent 反向覆盖
    // bug);wsl.exe 的 --cd 老版本没有,横竖要包登录 shell,cd 顺手做掉。
    // 登录 shell(-l)读 profile,guest PATH 才带上 nvm/pyenv 等——引擎
    // spawn 的 MCP stdio 子进程(npx …)依赖它。
    let shell = pick_login_shell(&prep.login_shell);
    let mut cmd = Command::new(crate::wsl::wsl_exe());
    cmd.args(["-d", distro, "--exec", &shell, "-l", "-c"])
        .arg(r#"cd "$1" && exec "$2" --stdio"#)
        .args(["mc-engine", &guest_engine_dir, &guest_bin])
        .envs(engine_env_additions())
        .envs(app.engine_env_overrides())
        // wsl.exe 自身的报错走 UTF-8,不往 ohmyagent.log 里混 UTF-16
        // (log_tail 的整块 NUL 嗅探会把混合日志整份解坏)
        .env("WSL_UTF8", "1")
        // wsl.exe 不透传任意环境变量,白名单点名;/u = 仅 Win→WSL 方向
        // 且值已是 Linux 路径,不再翻译
        .env("WSLENV", "OHMYAGENT_CONFIG_DIR/u")
        .env("OHMYAGENT_CONFIG_DIR", &guest_engine_dir);
    let bin_name = bin
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "ohmyagent-linux".into());
    // 盘符 workdir 映射需要 automount 根:上面 prepare 刚用 wslpath 翻译过
    // 三个 Windows 路径,从翻译对反推(wsl.conf 自定义根也对);Linux 冒烟
    // 的恒等翻译反推不出,退默认 /mnt
    let mount_root = [
        (bin.as_path(), guest_bin.as_str()),
        (engine_dir, guest_engine_dir.as_str()),
        (chat_workspaces_dir, guest_chat_root.as_str()),
    ]
    .into_iter()
    .find_map(|(host, guest)| crate::wsl::derive_mount_root(host, guest))
    .unwrap_or_else(|| "/mnt".into());
    let ctx = WslCtx {
        distro: distro.to_string(),
        bin_name,
        guest_home: prep.guest_home,
        guest_chat_root,
        networking: prep.networking,
        mount_root,
    };
    Ok((cmd, Some(ctx)))
}

/// 登录 shell 白名单:`-l -c '<script>' $0 $1 $2` 的参数语义对 POSIX 系
/// shell 一致;fish/csh 语义不同,回退 /bin/sh(其 PATH 至少含
/// /etc/profile 级配置,降级可接受)。
fn pick_login_shell(login_shell: &str) -> String {
    const POSIX_LIKE: [&str; 5] = ["bash", "zsh", "sh", "dash", "ksh"];
    let name = std::path::Path::new(login_shell)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if POSIX_LIKE.contains(&name.as_str()) {
        login_shell.to_string()
    } else {
        "/bin/sh".into()
    }
}

/// 查找 WSL 模式的 Linux 引擎:MC_OHMYAGENT_LINUX_BIN → 应用同目录
/// ohmyagent-linux(随包 bundle.resources 落安装根,经 /mnt/c 在 guest 内
/// 直接执行)。不搜 PATH——Windows 的 PATH 里只可能捡到错架构的二进制。
fn find_ohmyagent_linux() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("MC_OHMYAGENT_LINUX_BIN") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    // 测试同 find_ohmyagent:必须显式钉住,不捡应用目录残留
    #[cfg(test)]
    return None;

    #[cfg(not(test))]
    {
        let exe = std::env::current_exe().ok()?;
        let p = exe.parent()?.join("ohmyagent-linux");
        p.is_file().then_some(p)
    }
}

/// 查找 ohmyagent 二进制:MC_OHMYAGENT_BIN → 应用同目录 → PATH(含 ~/.local/bin)。
pub(super) fn find_ohmyagent() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("MC_OHMYAGENT_BIN") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    // 测试必须显式钉住配套引擎，不能从开发机 PATH 捡到旧二进制。
    #[cfg(test)]
    return None;

    #[cfg(not(test))]
    {
        let name = if cfg!(windows) {
            "ohmyagent.exe"
        } else {
            "ohmyagent"
        };
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let p = dir.join(name);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
        let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|v| std::env::split_paths(&v).collect())
            .unwrap_or_default();
        if let Some(home) = crate::config::home_dir() {
            paths.push(home.join(".local/bin"));
        }
        paths.into_iter().map(|d| d.join(name)).find(|p| p.is_file())
    }
}
