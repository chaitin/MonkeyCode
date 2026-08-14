// 会话层:会话 CRUD、sidecar 元数据与帧管线(ohmy.rs 拆出)。
//
// 职责:会话列表/建删改查(sidecar 目录是桌面版权威索引)、打开时的
// journal 回放(replay_open 无缺口衔接实时流)、对话上行
// (session_send/session_call)、resume/重建(engine_id 换绑)、
// push_frame 帧管线(编 seq → 落盘 → 批量缓冲)与本地和解
// (reconcile_*)。共享状态定义见 ohmy.rs::Inner。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use base64::Engine as _;
use serde_json::{json, Value};

use super::fold::{self, TurnFold};
use super::frame::{self, PermOutcome, SessionStatus};
use super::ohmy::{Inner, OhmyDriver};
use super::transport::JournalMsg;
use crate::util::LockExt;

const CHAT_WORKSPACE_PREFIX: &str = "chat-";

/// cancel 看门狗在引擎自宣的优雅预算之外再让出的余量。引擎收到 cancel 后
/// 要把运行中的工具/模型调用收敛掉才发 turn/stopped,壳必须等得比它久,
/// 否则每次取消都抢在引擎前面本地和解,把正常的收尾路径废掉。
const CANCEL_GRACE_EXTRA_MS: u64 = 10_000;

/// 冷修复补的错误文案。用户视角要能看懂"上一次不是我取消的,是应用没了"。
const COLD_REPAIR_REASON: &str = "上次运行未正常结束(应用被强制退出),已按中断收尾";

/// session/compact 的同步应答要等整段历史的 LLM 摘要跑完,30s 常规 RPC
/// 预算远不够;放宽到大历史 + 慢模型也装得下的量级。超时只是本地放弃,
/// 引擎侧压缩不回滚(见 session_compact 分支注释)。
const COMPACT_RPC_TIMEOUT: Duration = Duration::from_secs(300);

/// 普通对话不绑定用户项目，但引擎仍要求 cwd。每个新对话创建一个独立的
/// 受管工作目录，根目录由 Tauri 按平台解析为本应用的 local data 目录。
fn create_chat_workdir_in(root: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(root).map_err(|e| format!("创建对话工作区根目录失败: {e}"))?;
    // 保留系统返回的原生路径格式；Windows 的 canonicalize 会附加 \\?\ 前缀，
    // 部分命令行工具不能正确处理。删除时再解析真实父目录做边界校验。
    for _ in 0..8 {
        let mut random = [0u8; 10];
        getrandom::getrandom(&mut random).map_err(|e| format!("生成对话工作区标识失败: {e}"))?;
        let suffix = random.iter().map(|b| format!("{b:02x}")).collect::<String>();
        let path = root.join(format!("{CHAT_WORKSPACE_PREFIX}{suffix}"));
        match std::fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("创建对话工作区失败: {e}")),
        }
    }
    Err("创建对话工作区失败: 随机标识连续冲突".into())
}

fn valid_chat_workspace_name(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix(CHAT_WORKSPACE_PREFIX))
        .is_some_and(|suffix| {
            suffix.len() == 20
                && suffix.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        })
}

/// WSL 模式的 workdir 归一化(Inner::resolve_workdir 的 WSL 臂,拆出便于
/// 单测):~ 拼 guest 家目录;\\wsl$ UNC 回译(发行版必须匹配);/ 开头
/// 原样;盘符路径映射 automount(C:\proj → /mnt/c/proj——Windows 盘上的
/// 项目直接可用,而不是硬拒);其余(相对路径等)明确拒绝。
fn resolve_wsl_workdir(w: &super::ohmy::WslCtx, raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    if raw == "~" {
        return Ok(w.guest_home.clone());
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        return Ok(format!("{}/{}", w.guest_home.trim_end_matches('/'), rest));
    }
    if let Some((distro, guest)) = crate::wsl::guest_path_of_unc(raw) {
        if distro != w.distro {
            return Err(format!(
                "所选目录属于发行版 {distro},当前运行环境为 {}(设置里可切换)",
                w.distro
            ));
        }
        return Ok(guest);
    }
    if let Some(guest) = crate::wsl::guest_path_of_drive(&w.mount_root, raw) {
        return Ok(guest);
    }
    if raw.starts_with('/') {
        return Ok(raw.to_string());
    }
    Err(format!("WSL 运行环境无法识别的工作区路径(需为发行版内目录、\\\\wsl$ 或盘符路径),收到: {raw}"))
}

/// 只返回指定应用数据根下、由本应用创建的单层 chat-<随机标识> 目录。
/// 旧版 ~/.monkeycode/chat-workspace 不匹配，删除旧对话不会误删共享历史。
fn managed_chat_workdir(root: &Path, path: &str) -> Option<PathBuf> {
    let candidate = PathBuf::from(path);
    if !valid_chat_workspace_name(&candidate) {
        return None;
    }
    let root = root.canonicalize().ok()?;
    if candidate.parent()?.canonicalize().ok()? != root {
        return None;
    }
    let metadata = std::fs::symlink_metadata(&candidate).ok()?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return None;
    }
    Some(candidate)
}

/// 会话 id 必须是**单段安全目录名**。
///
/// 它不是普通标识符:壳 sid、引擎 session/create 返回的 session_id、子代理
/// 子循环 id 全都会原样拼进 `<data_dir>/<id>/` 与 `<engine_dir>/sessions/<id>/`,
/// 而这些路径的终点是 `remove_dir_all` 与 `atomic_write_private`。
/// `data_dir.join("../../..")` 会被 `remove_dir_all` 一路解析上去——实测能把
/// 用户主目录下的内容清空。同一个未校验的 id 还能让 write_sidecar 在任意
/// 目录写出 meta.json。
///
/// 所以在拼路径**之前**就挡:非空、限长、不含路径分隔符/NUL/冒号
/// (Windows 盘符与 NTFS 数据流),且归一化后仍是同一段普通名(挡掉 "." 与 "..")。
/// 引擎发的是 `uuid.NewString()[:8]`(8 位十六进制),壳自建的 chat- 工作区
/// 同理,正常路径一个都不会被挡。
pub(super) fn valid_session_id(id: &str) -> bool {
    if id.is_empty() || id.len() > 128 {
        return false;
    }
    if id.bytes().any(|b| matches!(b, b'/' | b'\\' | b'\0' | b':')) {
        return false;
    }
    let mut parts = std::path::Path::new(id).components();
    let single = matches!(
        parts.next(),
        Some(std::path::Component::Normal(seg)) if seg == std::ffi::OsStr::new(id)
    );
    single && parts.next().is_none()
}

/// 上行命令的 id 守卫:非法 id 直接外显错误,而不是让下游各自静默降级。
/// 会话思考档位的合法值:""=跟随模型默认,其余四档经 session/setThinking
/// 下发引擎(off = enabled:false,低/中/高 = enabled + effort)。
fn valid_think(level: &str) -> bool {
    matches!(level, "" | "off" | "low" | "medium" | "high")
}

/// 剥同步条目落盘名的来源后缀:`@baizhi` / `@monkeycode[#<服务端配置 id>]`
/// (为什么有这个后缀见 ui/src/settingsConfig.ts syncedName)。
/// 只用于**宽松比对**存量引用,寻址仍以配置里的原名为准。
fn strip_source_suffix(name: &str) -> &str {
    for marker in ["@baizhi", "@monkeycode"] {
        // 从右往左找:名字本身可能含 @,只认结尾那一段后缀
        if let Some(at) = name.rfind(marker) {
            let (base, tail) = name.split_at(at);
            let rest = &tail[marker.len()..];
            // 后缀之后要么到头,要么只剩 `#<id>`(会员条目的区分位)
            if !base.is_empty() && (rest.is_empty() || rest.starts_with('#')) {
                return base;
            }
        }
    }
    name
}

/// 档位 → session/setThinking 参数。
fn think_rpc_params(engine_id: &str, level: &str) -> Value {
    if level == "off" {
        json!({ "session_id": engine_id, "enabled": false })
    } else {
        json!({ "session_id": engine_id, "enabled": true, "effort": level })
    }
}

fn check_session_id(id: &str) -> Result<(), String> {
    if valid_session_id(id) {
        Ok(())
    } else {
        Err(format!("非法会话 id: {id:?}"))
    }
}

#[cfg(test)]
mod source_suffix_tests {
    use super::strip_source_suffix;

    /// 存量引用(加后缀之前建的会话、记忆里的默认模型)记的都是裸名,
    /// 全靠这层比对落到新条目上——会员条目的 `#<配置 id>` 尾巴必须一起剥,
    /// 漏了它等于所有会员模型的老会话开不起来。
    #[test]
    fn strips_source_marker_with_optional_config_id() {
        assert_eq!(strip_source_suffix("深度求索@monkeycode#cfg-9"), "深度求索");
        assert_eq!(strip_source_suffix("深度求索@monkeycode"), "深度求索");
        assert_eq!(strip_source_suffix("deepseek-v3@baizhi"), "deepseek-v3");
        // 手工条目原样;名字里本来就有 @ 或形似后缀的不误伤
        assert_eq!(strip_source_suffix("my@model"), "my@model");
        assert_eq!(strip_source_suffix("@baizhi"), "@baizhi");
        assert_eq!(strip_source_suffix("x@monkeycode-plus"), "x@monkeycode-plus");
        assert_eq!(strip_source_suffix("普通模型"), "普通模型");
    }
}

#[cfg(test)]
mod session_id_tests {
    use super::valid_session_id;

    /// 引擎与壳实际用的 id 形态一个都不能被挡(否则存量会话打不开)。
    #[test]
    fn accepts_the_ids_actually_in_use() {
        // ohmyagent stdio.go: uuid.NewString()[:8]
        for id in ["1f2e3d4c", "0a1b2c3d", "s1", "child9", "agent-1", "chat_ws_01", &"a".repeat(128)] {
            assert!(valid_session_id(id), "正常 id 被误挡: {id:?}");
        }
    }

    /// 路径穿越是本守卫存在的唯一理由:这些一旦漏过去,终点是
    /// remove_dir_all(<data_dir>/<id>) 与 write_sidecar 的任意目录写。
    #[test]
    fn rejects_anything_that_can_escape_the_session_root() {
        for id in [
            "", ".", "..", "../../..", "a/../../b", "foo/bar", "foo\\bar",
            "/etc", "C:windows", "stream:name", "a\0b", &"a".repeat(129),
        ] {
            assert!(!valid_session_id(id), "可逃逸的 id 被放行: {id:?}");
        }
    }
}

#[cfg(test)]
mod wsl_workdir_tests {
    use super::*;

    fn ctx() -> super::super::ohmy::WslCtx {
        super::super::ohmy::WslCtx {
            distro: "Ubuntu-22.04".into(),
            bin_name: "ohmyagent-linux".into(),
            guest_home: "/home/u".into(),
            guest_chat_root: "/mnt/c/data/chat-workspaces".into(),
            networking: "nat".into(),
            mount_root: "/mnt".into(),
        }
    }

    #[test]
    fn wsl_workdir_normalization_table() {
        let w = ctx();
        // ~ 展开到 guest 家目录(而不是宿主主目录)
        assert_eq!(resolve_wsl_workdir(&w, "~"), Ok("/home/u".into()));
        assert_eq!(resolve_wsl_workdir(&w, "~/proj"), Ok("/home/u/proj".into()));
        // guest 绝对路径原样
        assert_eq!(resolve_wsl_workdir(&w, "/opt/x"), Ok("/opt/x".into()));
        // 目录对话框的 UNC 形态回译
        assert_eq!(
            resolve_wsl_workdir(&w, r"\\wsl$\Ubuntu-22.04\home\u\proj"),
            Ok("/home/u/proj".into())
        );
        // 盘符路径映射 automount(本机建的会话/最近目录在 WSL 模式下直接可用)
        assert_eq!(resolve_wsl_workdir(&w, r"C:\Users\u\proj"), Ok("/mnt/c/Users/u/proj".into()));
        assert_eq!(resolve_wsl_workdir(&w, "d:/dev/x"), Ok("/mnt/d/dev/x".into()));
        // 发行版不匹配与相对路径明确报错
        assert!(resolve_wsl_workdir(&w, r"\\wsl$\Debian\home\u").is_err());
        assert!(resolve_wsl_workdir(&w, "relative/path").is_err());
    }
}

#[cfg(test)]
mod chat_workdir_tests {
    use super::*;

    fn test_root(label: &str) -> PathBuf {
        let mut random = [0u8; 8];
        getrandom::getrandom(&mut random).unwrap();
        let suffix = random.iter().map(|b| format!("{b:02x}")).collect::<String>();
        std::env::temp_dir()
            .join(format!("monkeycode-chat-workdir-{label}-{suffix}"))
            .join("chat-workspaces")
    }

    /// 对话工作区在 WSL 下**不能**用宿主视角验存在性——这条把当年的失败
    /// 现场固定下来(2026-08-09 用户报障:选了 WSL 内核后开普通对话必报
    /// 「工作区目录不存在: /mnt/c/Users/…/chat-workspaces/chat-xxxx」)。
    ///
    /// 成因:chat 根落在 Windows 侧,guest 形态是 /mnt/c/…;旧代码把它交给
    /// 「guest 路径 → \\wsl$\<发行版>\… 」的宿主视角去 is_dir(),包出来是
    /// 下面这个串——Windows 穿不过 WSL 共享上的 drvfs 挂载点,于是壳刚
    /// create_dir 成功的目录被判成不存在。本机模式恰好等价,所以只在
    /// Windows+WSL 上现形,Linux 冒烟(guest==host)也复现不了。
    #[test]
    fn host_view_of_a_chat_workdir_under_wsl_is_an_unusable_unc_path() {
        let guest = "/mnt/c/Users/phxa1/AppData/Local/com.chaitin.baizhi.monkeycode\
                     /chat-workspaces/chat-3a6c477966006def8049";
        let host_view = crate::wsl::host_fs_view("Ubuntu-22.04", guest);
        // 只在 Windows 上才拼 UNC(其余平台恒等,见 wsl::host_fs_view)
        if cfg!(windows) {
            assert!(
                host_view.to_string_lossy().starts_with(r"\\wsl$\Ubuntu-22.04\mnt\c\"),
                "宿主视角会把 chat 的 guest 路径包成穿不过去的 UNC: {host_view:?}"
            );
        }
        // 平台无关的那半条:chat 目录由 create_chat_workdir_in 在宿主建成
        // 才返回 Ok,所以根本不需要二次验存在——session_create_with_kind 的
        // (Some(_), _) 分支直接放行,别再引入任何"视角转换"
        let root = test_root("wsl-chat");
        let made = create_chat_workdir_in(&root).unwrap();
        assert!(made.is_dir(), "壳建完即存在,无需再验");
        let _ = std::fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn creates_an_isolated_managed_directory_for_each_chat() {
        let root = test_root("create");
        let first = create_chat_workdir_in(&root).unwrap();
        let second = create_chat_workdir_in(&root).unwrap();

        assert_ne!(first, second);
        assert_eq!(first.parent(), Some(root.as_path()));
        assert!(first.is_dir());
        assert!(second.is_dir());
        assert_eq!(managed_chat_workdir(&root, &first.to_string_lossy()), Some(first));

        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }

    #[test]
    fn cleanup_guard_rejects_paths_outside_the_app_data_root() {
        let root = test_root("guard");
        let managed = create_chat_workdir_in(&root).unwrap();
        let base = root.parent().unwrap();
        let outside = base.join("chat-00000000000000000000");
        std::fs::create_dir(&outside).unwrap();
        let legacy = base.join("chat-workspace");
        std::fs::create_dir(&legacy).unwrap();

        assert!(managed_chat_workdir(&root, &managed.to_string_lossy()).is_some());
        assert!(managed_chat_workdir(&root, &outside.to_string_lossy()).is_none());
        assert!(managed_chat_workdir(&root, &legacy.to_string_lossy()).is_none());

        std::fs::remove_dir_all(base).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn cleanup_guard_rejects_a_symlink_even_inside_the_managed_root() {
        use std::os::unix::fs::symlink;

        let root = test_root("symlink");
        std::fs::create_dir_all(&root).unwrap();
        let base = root.parent().unwrap();
        let target = base.join("target");
        std::fs::create_dir(&target).unwrap();
        let link = root.join("chat-00000000000000000000");
        symlink(&target, &link).unwrap();

        assert!(managed_chat_workdir(&root, &link.to_string_lossy()).is_none());

        std::fs::remove_dir_all(base).unwrap();
    }
}

pub(super) struct SessionState {
    /// 帧序号(回放续接:打开时取日志行数)
    pub(super) seq: u64,
    pub(super) running: bool,
    /// 手动压缩在飞(session_compact 从开轮到应答返回)。normalize 的
    /// compaction 事件据此区分:手动壳侧发起时已实时落 compact_status
    /// "started",事件只补 "ended";自动压缩仍事后补一对。
    pub(super) compacting: bool,
    /// 轮次序号(每次开轮 +1)。只用来给异步兜底认轮:cancel 看门狗到期时
    /// 会话可能已经收尾并开了新的一轮,拿它比对才不会误杀新轮次。
    pub(super) turn: u64,
    /// 本进程内已 session/create(resume)过
    pub(super) created: bool,
    /// 引擎侧会话 id(通常 == 壳 sid;空会话无法 resume 时壳会 destroy +
    /// 全新 create,引擎发新 id——壳 sid/目录/UI 通道保持不变,仅此别名换绑。
    /// 出站 RPC 用它,入站事件经 shell_sid_of 反查;sidecar 持久化)
    pub(super) engine_id: String,
    /// UI 是否在听 frames:{sid}(未打开时帧只入日志不 emit)
    pub(super) opened: bool,
    /// 已发 tool_call 未见 tool_result 的调用(tc_id → 工具名)。
    /// 中断/异常轮次可能不发 tool_result,轮次收尾时对余量补 failed 帧;
    /// 工具名用于子代理认领时兜底缺省的父 Agent 工具 id(claim_subagent)
    pub(super) open_tools: HashMap<String, String>,
    /// 本段模型输出的壳侧累积文本(modelDoneText 对账:model_start 清零,
    /// model_delta 累积,model_done 与权威全文比对补缺,见 handle_event)
    pub(super) model_text: String,
    /// 引擎事件 seq 水位(eventSeq:被丢弃的 delta 仍占号,空洞=丢帧信号,
    /// 记日志与 model_done 全文对账互补;回落=引擎会话重建,水位重置)
    pub(super) last_event_seq: u64,
    /// 最近一次已下发的上下文占用；provider 常在同一次模型调用的头尾各发
    /// usage，context_* 相同，壳侧据此去重，避免 journal/UI 空转。
    pub(super) context_usage: Option<(i64, i64)>,
    pub(super) workdir: String,
    pub(super) model_name: String,
    pub(super) mode: String,
    pub(super) title: String,
    /// 本轮的增量折叠(见 fold.rs)。push_frame 逐帧喂,task-ended 时取走
    /// 投给写线程物化成 replay.jsonl 的一行。内存里只留折叠后的百来帧,
    /// 十万 token 的长轮次也不会把原始碎片堆住。
    pub(super) fold: TurnFold,
}

/// 会话态锁组:会话表、待发帧缓冲与审批/提问簿记。
/// 含锁:sessions、batch、sidecar_write、perm_remember、pending_questions、
/// pending_perms、perm_tools(均 StdMutex)。
/// 加锁秩序(评审梳理,不得反向):
/// - sessions → batch:push_frame 在 sessions 锁内投递 journal 并入缓冲;
/// - sidecar_write 只包围独立的小文件事务，不与其他状态锁嵌套;
/// - pending_perms → pending_questions:sessions_list 的 waiting 快照;
/// - perm_remember/perm_tools 点状取放,不与其他锁嵌套;
/// - 跨组:subagents(SubagentState)→ sessions 允许,反向禁止,
///   见 subagent.rs::SubagentState。
pub(super) struct SessionsState {
    pub(super) sessions: StdMutex<HashMap<String, SessionState>>,
    /// 待发帧批量缓冲(sid → 帧列表;flusher 任务 30ms 排空)
    pub(super) batch: Arc<StdMutex<HashMap<String, Vec<Value>>>>,
    /// sidecar 读改写锁，防并发更新互相覆盖字段。
    pub(super) sidecar_write: StdMutex<()>,
    /// 审批记忆:工具名集合(内存 = 引擎生命周期;persist 追加落盘)。
    /// **兼容尾巴**:仅旧引擎(无 permissionRemember cap)使用——新引擎的
    /// 审批记忆归引擎自身(命令段粒度、项目级持久化),壳不再读写此集合
    pub(super) perm_remember: StdMutex<HashSet<String>>,
    /// 未答复的提问(request_id → (sid, questions));答案映射需要原题
    pub(super) pending_questions: StdMutex<HashMap<String, (String, Value)>>,
    /// 未答复的审批(request_id → sid)
    pub(super) pending_perms: StdMutex<HashMap<String, String>>,
    /// 审批请求的工具名(request_id → tool;"始终允许"回写记忆集用)
    pub(super) perm_tools: StdMutex<HashMap<String, String>>,
    /// 后台 resume 的完成广播(sid → 结果)。打开会话不再串行等引擎握手,
    /// 但所有上行命令必须先经 ensure_engine_ready 等它就绪。
    pub(super) resume:
        StdMutex<HashMap<String, tokio::sync::watch::Receiver<Option<Result<(), String>>>>>,
}

/// 打开会话时下发的回放窗口。cursor 是窗口最早那一轮在 replay.jsonl 里的
/// 字节偏移,UI 拿它调 session_history 往前翻;has_more 为假即已到会话开头。
pub(super) struct ReplayWindow {
    pub(super) frames: Vec<Value>,
    pub(super) cursor: u64,
    pub(super) has_more: bool,
}

/// 从 pos 起补读日志新增部分,解析出的帧追加到 out,pos 前移。
/// 只消费到最后一个完整行:并发追加下可能读到半行(writeln 非单次
/// syscall),半行留待下次补读,绝不把破损 JSON 吞掉或错位 pos;
/// 读失败(含并发写造成的 UTF-8 截断)整段放弃且不动 pos,下次重读。
fn read_journal_tail(path: &std::path::Path, pos: &mut u64, out: &mut Vec<Value>) {
    use std::io::{Read as _, Seek as _};
    let Ok(mut f) = std::fs::File::open(path) else { return };
    if f.seek(std::io::SeekFrom::Start(*pos)).is_err() {
        return;
    }
    let mut buf = String::new();
    if f.read_to_string(&mut buf).is_err() {
        return;
    }
    let cut = buf.rfind('\n').map(|i| i + 1).unwrap_or(0);
    *pos += cut as u64;
    out.extend(buf[..cut].lines().filter_map(|l| serde_json::from_str(l).ok()));
}

impl OhmyDriver {
    // ==================== 会话管理 ====================

    /// 会话列表:sidecar 目录是桌面版的权威索引(stdio 模式下 ohmyagent
    /// 不维护 index.json,messages.jsonl 也无 meta 记录,cwd/model 只有壳知道;
    /// CLI 侧建的会话没有 sidecar,自然不出现在桌面列表——引擎间会话隔离)。
    pub async fn sessions_list(&self) -> Result<Value, String> {
        // 目录扫描 + 逐会话 sidecar 读取是磁盘 I/O,整体挪到阻塞线程,
        // 不占 tokio 运行时(async 路径只等结果)
        let inner = self.0.clone();
        tokio::task::spawn_blocking(move || Self::sessions_list_blocking(&inner))
            .await
            .map_err(|e| format!("列表任务失败: {e}"))?
    }

    fn sessions_list_blocking(inner: &Arc<Inner>) -> Result<Value, String> {
        let mut items: Vec<(u64, Value)> = Vec::new();
        let entries = std::fs::read_dir(&inner.data_dir).map(|it| it.flatten().collect::<Vec<_>>()).unwrap_or_default();
        // 锁内只快照 running 集合,立即放锁:reader 线程每条引擎事件都要拿
        // 同一把 sessions 锁(push_frame),若持锁贯穿下面的逐会话
        // read_sidecar(磁盘 I/O),UI 刷列表会把整条事件流卡在磁盘上
        let running_set: HashSet<String> = {
            let sessions = inner.sess.sessions.lock_ok();
            sessions.iter().filter(|(_, s)| s.running).map(|(id, _)| id.clone()).collect()
        };
        let waiting: HashSet<String> = inner
            .sess.pending_perms
            .lock_ok()
            .values()
            .cloned()
            .chain(inner.sess.pending_questions.lock_ok().values().map(|(s, _)| s.clone()))
            .collect();
        for e in entries {
            if !e.path().is_dir() {
                continue;
            }
            let id = e.file_name().to_string_lossy().into_owned();
            let meta = inner.read_sidecar(&id);
            if meta.as_object().map(|m| m.is_empty()).unwrap_or(true) {
                continue; // 无 sidecar 的目录不是本壳建的会话
            }
            if meta.get("parent").and_then(|v| v.as_str()).map(|p| !p.is_empty()).unwrap_or(false) {
                continue; // 子代理子会话不进列表(经父会话工具卡点开)
            }
            let running = running_set.contains(&id);
            let turns = meta.get("turns").and_then(|v| v.as_u64()).unwrap_or(0);
            let status = if running {
                "running".to_string()
            } else {
                match meta.get("status").and_then(|v| v.as_str()) {
                    // 历史遗留的 sidecar "running"(和解机制上线前的崩溃残留):
                    // 内存里没在跑就不是在跑,读取时自愈为 interrupted
                    Some("running") => "interrupted".to_string(),
                    // 旧版把每轮正常结束写成 finished；顶层会话可继续，读取时
                    // 兼容迁移为 idle，不修改真正子任务（它们已在上方过滤）。
                    Some("finished") => "idle".to_string(),
                    Some(s) => s.to_string(),
                    None if turns > 0 => "idle".to_string(),
                    None => "created".to_string(),
                }
            };
            let updated = meta.get("updated_at").and_then(|v| v.as_u64()).unwrap_or(0);
            items.push((
                updated,
                json!({
                    "id": id,
                    "title": meta.get("title").and_then(|v| v.as_str()).unwrap_or(""),
                    // 用户改过名(session_patch title):头部标题优先级用
                    "title_custom": meta.get("title_custom").and_then(|v| v.as_bool()).unwrap_or(false),
                    // 引擎每轮生成的会话摘要(顶栏副标题展示;不参与命名)
                    "summary": meta.get("summary").and_then(|v| v.as_str()).unwrap_or(""),
                    "workdir": meta.get("workdir").and_then(|v| v.as_str()).unwrap_or(""),
                    "kind": meta.get("kind").and_then(|v| v.as_str()).unwrap_or("local"),
                    "model": meta.get("model_name").and_then(|v| v.as_str()).unwrap_or(""),
                    "think": meta.get("think").and_then(|v| v.as_str()).unwrap_or(""),
                    "mode": meta.get("mode").and_then(|v| v.as_str()).unwrap_or("default"),
                    // 技能启用集(null = 缺省集:旧会话无此字段,UI 侧按
                    // defaultEnabledSkills 同一规则推,见 skills.rs)
                    "skills": meta.get("skills").cloned().unwrap_or(Value::Null),
                    "turns": turns,
                    "status": status,
                    "archived": meta.get("archived").and_then(|v| v.as_bool()).unwrap_or(false),
                    // 契约:SessionMeta.updated_at 是 RFC3339 字符串(与 Go time.Time 的
                    // time.Time 序列化对表);sidecar 内部存毫秒,输出时转换
                    "updated_at": crate::config::ms_to_rfc3339(updated),
                    "waiting_ask": waiting.contains(&id),
                }),
            ));
        }
        items.sort_by(|a, b| b.0.cmp(&a.0));
        Ok(Value::Array(items.into_iter().map(|(_, v)| v).collect()))
    }

    #[cfg(test)]
    pub async fn session_create(&self, workdir: &str, model_name: &str, create_dir: bool) -> Result<Value, String> {
        self.session_create_with_kind(workdir, model_name, create_dir, "local", "").await
    }

    pub async fn session_create_with_kind(
        &self,
        workdir: &str,
        model_name: &str,
        create_dir: bool,
        kind: &str,
        think: &str,
    ) -> Result<Value, String> {
        if !valid_think(think) {
            return Err(format!("不支持的思考档位: {think}"));
        }
        let model_id = self.model_id_of(model_name)?;
        // 普通对话的 cwd 由壳生成，调用方传入值一律不采用；本地项目仍按
        // 用户选择展开 ~、按需创建或前置校验。
        let chat_workdir = if kind == "chat" {
            Some(create_chat_workdir_in(&self.0.chat_workspaces_dir)?)
        } else {
            None
        };
        let workdir_owned = match &chat_workdir {
            Some(path) => self.0.chat_workdir_for_engine(path),
            None => self.0.resolve_workdir(workdir)?,
        };
        // 存在性判定按"谁建的、在哪一侧"分三条路:
        //
        // - **对话工作区:不验**。create_chat_workdir_in 刚在宿主
        //   std::fs::create_dir 成功才走得到这儿,建不出来早已带错返回。
        //   **尤其不能拿 workdir_owned 去验**——它此时已是 guest 形态
        //   (chat_workdir_for_engine 换过前缀),而 workdir_fs_view 在 WSL 下
        //   会把任何 guest 路径包成 \\wsl$\<发行版>\…;chat 根落在 Windows 侧
        //   (/mnt/c/Users/…/AppData/Local/…),包出来就是
        //   \\wsl$\<发行版>\mnt\c\Users\…——Windows 穿不过 WSL 共享上的 drvfs
        //   挂载点,于是刚建好的目录被判成"不存在",WSL 下普通对话必然开不了
        //   (2026-08-09 用户报障)。本机模式下这条路径恰好等价,所以只在
        //   Windows+WSL 上现形。
        // - **本地项目 + WSL**:存在性判定/按需创建/软链 canonical 化在 guest
        //   内一次完成(见 wsl::ensure_guest_dir——\\wsl$ 对 guest 符号链接不可
        //   求值,宿主视角会把软链工作区误报为不存在)。
        // - **本地项目 + 本机**:宿主视角直接判。
        let workdir_owned = match (&chat_workdir, &self.0.wsl) {
            (Some(_), _) => workdir_owned,
            (None, Some(w)) => {
                crate::wsl::ensure_guest_dir(&w.distro, &workdir_owned, create_dir)?
            }
            (None, None) => {
                let host = Path::new(&workdir_owned);
                if !host.is_dir() {
                    if create_dir {
                        std::fs::create_dir_all(host)
                            .map_err(|e| format!("创建工作区目录失败: {e}"))?;
                    } else {
                        return Err(format!("工作区目录不存在: {workdir_owned}"));
                    }
                }
                workdir_owned
            }
        };
        let workdir = workdir_owned.as_str();
        // 技能:创建前把启用集物化到引擎技能目录(新会话取缺省集:官方
        // 四件套 + 用户技能),并把 create RPC 圈进技能闸——引擎 catalog 按
        // 创建时刻的目录内容定格,物化与创建被并发的另一次创建插队就会
        // 拿错技能集(skills.rs 头注)
        let skills_lock = self.0.skills_gate.lock().await;
        let skills = self.materialize_skills(None).await?;
        let result = match self
            .rpc(
                "session/create",
                engine_session_create_params(workdir, None, Some(&model_id), "default"),
            )
            .await
        {
            Ok(result) => result,
            Err(e) => {
                if let Some(path) = &chat_workdir {
                    let _ = std::fs::remove_dir_all(path);
                }
                return Err(e);
            }
        };
        drop(skills_lock);
        // 引擎返回的 session_id 直接成为 sidecar 目录名,校验标准与 IPC 入参
        // 一致:引擎是子进程不是信任边界,一个畸形 id 同样能穿越出 data_dir
        let sid = match result
            .get("session_id")
            .and_then(|v| v.as_str())
            .filter(|id| valid_session_id(id))
        {
            Some(id) => id.to_string(),
            None => {
                if let Some(path) = &chat_workdir {
                    let _ = std::fs::remove_dir_all(path);
                }
                return Err("session/create 未返回可用的 session_id".into());
            }
        };
        self.0.sess.sessions.lock_ok().insert(
            sid.clone(),
            SessionState {
                seq: 0,
                running: false,
                compacting: false,
                turn: 0,
                created: true,
                engine_id: sid.clone(),
                opened: false,
                open_tools: HashMap::new(),
                model_text: String::new(),
                last_event_seq: 0,
                context_usage: None,
                workdir: workdir.to_string(),
                model_name: model_name.to_string(),
                mode: "default".into(),
                title: String::new(),
                fold: TurnFold::default(),
            },
        );
        // 契约 5:新建未运行的会话是 created,不是 finished(否则侧栏打勾、桌宠庆祝)
        self.write_sidecar(&sid, |m| {
            m["model_name"] = json!(model_name);
            m["workdir"] = json!(workdir);
            m["kind"] = json!(kind);
            m["think"] = json!(think);
            // 技能启用集快照(resume/重建按它物化;session_set_skills 改写)
            m["skills"] = json!(skills);
            m["status"] = json!(SessionStatus::Created.as_str());
        });
        // 创建即下发所选档位(引擎新会话按模型默认档起步)
        self.apply_session_think(&sid, &sid).await;
        Ok(json!({
            "id": sid, "title": "", "workdir": workdir, "model": model_name,
            "kind": kind, "mode": "default", "turns": 0, "think": think,
            "status": SessionStatus::Created.as_str(),
        }))
    }

    /// 打开会话:立刻返回尾部回放窗口,引擎 resume 转后台。
    ///
    /// 顺序反转的动机——历史帧是壳自己的 sidecar 数据,本来不依赖引擎;
    /// 旧实现却先 await `session/create{resume}`,而引擎那一步要读回整份
    /// messages.jsonl 并用 tiktoken 重算 context_used(实测 1.4MB 历史
    /// 236ms),这段时间 UI 只有"连接中…"、一个字都画不出来。现在先出图,
    /// resume 完成/失败经 conn-status 通知,上行命令由 ensure_engine_ready
    /// 挡住(等待而非报错),用户观感是"内容秒出、输入框稍后可用"。
    ///
    /// 历史帧改走命令返回值而不是 `frames:{sid}` 事件:返回值天生有序,
    /// "监听先于命令"那条约束对历史部分自然消失(实时流仍走事件,契约不变)。
    pub async fn session_open(&self, id: &str) -> Result<Value, String> {
        check_session_id(id)?;
        let need_create = {
            let sessions = self.0.sess.sessions.lock_ok();
            !sessions.get(id).map(|s| s.created).unwrap_or(false)
        };
        // 恢复期间上行的 user-input 不能在 seq 水位恢复前编号(会从 0 重编、
        // 与旧帧撞号,大纲随之两点同亮/跳错):就绪宣告闸在水位恢复之后。
        let mut seq_gate: Option<tokio::sync::oneshot::Sender<()>> = None;
        if need_create {
            let meta = self.read_sidecar(id);
            let is_child =
                meta.get("parent").and_then(|v| v.as_str()).map(|p| !p.is_empty()).unwrap_or(false);
            let engine_id = meta
                .get("engine_id")
                .and_then(|v| v.as_str())
                .filter(|e| !e.is_empty())
                .unwrap_or(id)
                .to_string();
            // 先登记会话态(零 RPC):push_frame 有落点、replay_open 查得到
            // fold/running,后台 resume 也要靠它回写 engine_id。
            // 子代理子会话是壳侧实体(仅回放),created 直接为真、不向引擎 resume。
            {
                let mut sessions = self.0.sess.sessions.lock_ok();
                let entry = sessions.entry(id.to_string()).or_insert(SessionState {
                    seq: 0,
                    running: false,
                    compacting: false,
                    turn: 0,
                    created: is_child,
                    engine_id: engine_id.clone(),
                    opened: false,
                    open_tools: HashMap::new(),
                    model_text: String::new(),
                    last_event_seq: 0,
                    context_usage: None,
                    workdir: meta.get("workdir").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    model_name: meta.get("model_name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    mode: meta.get("mode").and_then(|v| v.as_str()).unwrap_or("default").to_string(),
                    title: meta.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    fold: TurnFold::default(),
                });
                entry.engine_id = engine_id.clone();
                if is_child {
                    entry.created = true;
                }
            }
            if !is_child {
                let (tx, rx) = tokio::sync::oneshot::channel::<()>();
                seq_gate = Some(tx);
                self.spawn_resume(id, meta, engine_id, rx);
            }
        }
        // 磁盘读与 flush 屏障都在阻塞线程上做,不占 tokio 运行时;
        // 无缺口保证见 replay_open 注释。
        let window = {
            let inner = self.0.clone();
            let sid = id.to_string();
            tokio::task::spawn_blocking(move || inner.replay_open(&sid))
                .await
                .map_err(|e| format!("回放任务失败: {e}"))?
        };
        // seq 水位已随 replay_open 恢复,放行 resume 的就绪宣告(见 spawn_resume)。
        // 早退路径靠 tx 随 seq_gate 丢弃解闸,不会把 resume 挂死。
        if let Some(tx) = seq_gate {
            let _ = tx.send(());
        }
        // 已就绪(新建会话/子会话)直接报连接;等 resume 的由后台任务报
        if self.0.sess.sessions.lock_ok().get(id).map(|s| s.created).unwrap_or(false) {
            self.0
                .app
                .emit_json(&format!("conn-status:{id}"), json!({ "text": "已连接", "connected": true }));
        } else {
            self.0.app.emit_json(
                &format!("conn-status:{id}"),
                json!({ "text": "正在恢复会话…", "connected": false }),
            );
        }
        Ok(json!({
            "frames": window.frames,
            "cursor": window.cursor,
            "has_more": window.has_more,
        }))
    }

    /// 后台 resume:引擎握手挪出打开路径。结果经 watch 广播给
    /// ensure_engine_ready,并经 conn-status 外显(失败文案不能吞)。
    ///
    /// seq_gate:session_open 在 replay_open 恢复完 seq 水位后放行。resume
    /// 的 RPC 照旧与回放并行,只闸「就绪宣告」——ensure_engine_ready 放行
    /// 即可编帧号,水位未恢复就放行会让恢复期间的输入从 0 重编、撞上旧帧。
    fn spawn_resume(
        &self,
        id: &str,
        meta: Value,
        engine_id: String,
        seq_gate: tokio::sync::oneshot::Receiver<()>,
    ) {
        let (tx, rx) = tokio::sync::watch::channel::<Option<Result<(), String>>>(None);
        self.0.sess.resume.lock_ok().insert(id.to_string(), rx);
        let me = self.clone();
        let sid = id.to_string();
        tauri::async_runtime::spawn(async move {
            let r = me.resume_engine(&sid, &meta, engine_id, seq_gate).await;
            let status = match &r {
                Ok(()) => json!({ "text": "已连接", "connected": true }),
                Err(e) => json!({ "text": format!("⚠ 会话恢复失败: {e}"), "connected": false }),
            };
            let _ = tx.send(Some(r));
            me.0.app.emit_json(&format!("conn-status:{sid}"), status);
        });
    }

    /// 引擎侧会话恢复。有历史则 resume 带全参(缺参会回落进程默认值);
    /// 空会话 resume 必失败,改全新 create 换绑 engine_id(壳 sid 不变)。
    /// 记录模型 locked(会员到期降档)照常携带——条目仍在引擎 settings 里
    /// (config.rs 物化全部条目),档位权限由服务端把关;已从配置移除则
    /// 不带 model 退化引擎默认;引擎侧仍拒(壳快照与引擎 settings 口径
    /// 分叉的兜底)去掉 model 重试一次。恢复不因模型失效而打不开。
    async fn resume_engine(
        &self,
        id: &str,
        meta: &Value,
        mut engine_id: String,
        seq_gate: tokio::sync::oneshot::Receiver<()>,
    ) -> Result<(), String> {
        let mode = meta.get("mode").and_then(|v| v.as_str()).unwrap_or("default");
        let has_history = self.engine_session_exists(&engine_id).await;
        let mut workdir = meta.get("workdir").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if workdir.is_empty() {
            // 兼容没有 workdir 的旧 sidecar；不能留空让引擎隐式继承
            // Desktop 引擎进程 cwd，否则 resume 后会话会漂到进程目录。
            // WSL 模式回退 guest 家目录(见 default_workdir)。
            workdir = self.0.default_workdir();
        } else {
            // 运行环境可能已与建会话时不同(本机 ↔ WSL 切换):按当前环境
            // 归一化(盘符 → automount 映射等)。归一不了的明确失败——错误
            // 经 conn-status 外显,好过把另一环境的 cwd 塞给引擎后工具全空转
            workdir = self.0.resolve_workdir(&workdir)?;
        }
        let mut params = engine_session_create_params(
            &workdir,
            has_history.then_some(engine_id.as_str()),
            None,
            mode,
        );
        let model_name = meta.get("model_name").and_then(|v| v.as_str()).unwrap_or("");
        let with_model = match self.model_id_of_any(model_name) {
            Ok(model_id) => {
                params["model"] = json!(model_id);
                true
            }
            Err(_) => false,
        };
        // 技能物化(闸内圈住 create;含下方去模型重试)。失败降级不失败恢复:
        // 磁盘异常时目录可能残留上一会话的技能集(catalog 与勾选短暂错位),
        // 但会话本身要能恢复——错误进日志,不进 conn-status
        let skills_lock = self.0.skills_gate.lock().await;
        if let Err(e) = self.materialize_skills(skills_of_meta(meta)).await {
            eprintln!("[desktop] 会话 {id} 技能物化失败,按现有目录恢复: {e}");
        }
        let result = match self.rpc("session/create", params.clone()).await {
            Ok(r) => r,
            // 壳的模型快照(引擎启动时定格)与引擎 settings 可能口径分叉,
            // 壳放行的模型引擎未必有 provider:去掉 model 重试一次回落
            // 引擎默认,与「模型已删除」同款降级——不让恢复卡死在死模型上
            Err(e) if with_model => {
                eprintln!("[desktop] 会话 {id} 按记录模型恢复失败,回落引擎默认模型重试: {e}");
                if let Some(p) = params.as_object_mut() {
                    p.remove("model");
                }
                self.rpc("session/create", params).await?
            }
            Err(e) => return Err(e),
        };
        // catalog 已随 create 定格,后续 seq_gate 等待不该再占技能闸
        drop(skills_lock);
        // 换绑来的 engine_id 会成为 <engine_dir>/sessions/<id> 的目录名(删会话
        // 时被 remove_dir_all),同样只收单段安全名;畸形值保留原 id 不换绑
        if let Some(e) = result
            .get("session_id")
            .and_then(|v| v.as_str())
            .filter(|e| valid_session_id(e))
        {
            engine_id = e.to_string();
        }
        if engine_id != id {
            let e = engine_id.clone();
            let inner = self.0.clone();
            let sid = id.to_string();
            let _ = tokio::task::spawn_blocking(move || {
                inner.write_sidecar(&sid, |m| m["engine_id"] = json!(e))
            })
            .await;
        }
        // created=true 是 ensure_engine_ready 的快路径:置位前必须等 seq 水位
        // 恢复完(replay_open 末尾放行;发送端丢弃同样放行,不会挂死),
        // 否则恢复期间的 user-input 会从 0 重编帧号、与旧帧撞 seq
        let _ = seq_gate.await;
        if let Some(s) = self.0.sess.sessions.lock_ok().get_mut(id) {
            s.created = true;
            s.engine_id = engine_id.clone();
            // session_open 登记的是 sidecar 原值,可能属于另一运行环境;
            // 换成引擎实际拿到的归一化形态,壳侧消费者(browser workdir 等)
            // 与引擎口径一致
            s.workdir = workdir.clone();
        }
        // resume 重建 loop,思考档位回落到模型默认,重放会话已选档位
        self.apply_session_think(id, &engine_id).await;
        // resume 结果带恢复历史的占用估计,立即可显示(296176a)
        self.0.push_usage(
            id,
            result.get("context_used").and_then(|v| v.as_i64()).unwrap_or(0),
            result.get("context_window").and_then(|v| v.as_i64()).unwrap_or(0),
        );
        Ok(())
    }

    /// 上行命令的引擎就绪门:后台 resume 未完成时**等待**而不是报错
    /// (用户在恢复期间点发送不该丢消息)。会话不存在或恢复失败即上抛。
    pub(super) async fn ensure_engine_ready(&self, id: &str) -> Result<(), String> {
        if self.0.sess.sessions.lock_ok().get(id).map(|s| s.created).unwrap_or(false) {
            return Ok(());
        }
        let Some(mut rx) = self.0.sess.resume.lock_ok().get(id).cloned() else {
            return Err("会话未打开".into());
        };
        loop {
            // borrow 的守卫必须在 await 前落地,否则跨 await 持锁
            let current = rx.borrow().clone();
            if let Some(r) = current {
                return r;
            }
            if rx.changed().await.is_err() {
                return Err("会话恢复中断".into());
            }
        }
    }

    /// 往前翻页:cursor 之前的最多 limit 轮(cursor = replay.jsonl 的轮起始
    /// 字节偏移,与 session_open/大纲同一坐标系)。
    pub async fn session_history(&self, id: &str, cursor: u64, limit: usize) -> Result<Value, String> {
        check_session_id(id)?;
        let inner = self.0.clone();
        let sid = id.to_string();
        tokio::task::spawn_blocking(move || {
            let path = match inner.session_dir(&sid) {
                Some(dir) => dir.join("replay.jsonl"),
                None => return json!({ "frames": [], "next_cursor": 0, "has_more": false }),
            };
            let (turns, has_more) = fold::read_before(&path, cursor, limit.clamp(1, 50));
            let next = turns.first().map(|t| t.offset).unwrap_or(0);
            let frames: Vec<Value> = turns.into_iter().flat_map(|t| t.frames).collect();
            json!({ "frames": frames, "next_cursor": next, "has_more": has_more })
        })
        .await
        .map_err(|e| format!("读取历史失败: {e}"))
    }

    /// 回读单帧原文:物化时被截断的工具大字段,展开卡片时按 seq 取全文。
    /// 完整原帧一直在 events.jsonl 里(审计源),所以不需要第二份存储;
    /// 日志若因保留策略被清理过,明确报错而不是静默给半截。
    pub async fn session_frame(&self, id: &str, seq: u64) -> Result<Value, String> {
        check_session_id(id)?;
        let inner = self.0.clone();
        let sid = id.to_string();
        tokio::task::spawn_blocking(move || {
            let dir = inner.session_dir(&sid).ok_or("非法会话 id")?;
            fold::read_frame_by_seq(&dir.join("replay.jsonl"), &dir.join("events.jsonl"), seq)
                .ok_or_else(|| "原始记录已不可用(帧日志可能已被清理)".to_string())
        })
        .await
        .map_err(|e| format!("回读原始帧失败: {e}"))?
    }

    /// 提问大纲:全量扫 replay.jsonl 的 user-input 帧 + 尚未物化的尾巴。
    /// 折叠后的文件只有几十 KB~数 MB,一次顺序读即可;条目自带轮起始偏移,
    /// UI 点到未加载的早期提问时拿它当 cursor 补历史。
    pub async fn session_outline(&self, id: &str) -> Result<Value, String> {
        check_session_id(id)?;
        let inner = self.0.clone();
        let sid = id.to_string();
        tokio::task::spawn_blocking(move || {
            let Some(dir) = inner.session_dir(&sid) else { return json!([]) };
            let mut out: Vec<Value> = Vec::new();
            let mut src_end = 0u64;
            for (offset, line) in fold::scan_lines(&dir.join("replay.jsonl")) {
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    src_end = v.get("src_end").and_then(|x| x.as_u64()).unwrap_or(src_end);
                }
                out.extend(fold::outline_of_line(offset, &line));
            }
            // 未物化的尾巴(当前轮/崩溃残留)也要出现在大纲里,否则刚问完的
            // 那一条不在目录中。offset 给 0:这段本来就在打开窗口内,不需要翻页
            let mut pos = src_end;
            let mut tail: Vec<Value> = Vec::new();
            read_journal_tail(&dir.join("events.jsonl"), &mut pos, &mut tail);
            out.extend(tail.iter().filter_map(|f| fold::outline_entry(0, f)));
            json!(out)
        })
        .await
        .map_err(|e| format!("读取大纲失败: {e}"))
    }

    pub async fn session_close(&self, id: &str) {
        if let Some(s) = self.0.sess.sessions.lock_ok().get_mut(id) {
            s.opened = false;
        }
        // 不 destroy:后台任务继续跑(关闭页面 ≠ 结束任务)。
        // 主动归还 journal 句柄(会话大概率转入闲置);若后台仍在产帧,
        // 写线程下一帧会自动重开,只是一次多余的 open,无正确性影响
        self.0.journal_close(id, false);
    }

    pub async fn session_delete(&self, id: &str) -> Result<Value, String> {
        // 本命令的终点是 remove_dir_all,是全壳爆炸半径最大的一条:先挡再说
        check_session_id(id)?;
        {
            let sessions = self.0.sess.sessions.lock_ok();
            if sessions.get(id).map(|s| s.running).unwrap_or(false) {
                return Err("会话正在执行,请先取消".into());
            }
        }
        let meta = self.read_sidecar(id);
        let chat_workdir = (meta.get("kind").and_then(|v| v.as_str()) == Some("chat"))
            .then(|| {
                meta.get("workdir")
                    .and_then(|v| v.as_str())
                    // WSL 模式 sidecar 存 guest 形态,宿主删除前换回宿主路径
                    .map(|path| self.0.host_chat_workdir(path))
                    .and_then(|path| managed_chat_workdir(&self.0.chat_workspaces_dir, &path))
            })
            .flatten();
        let created = self.0.sess.sessions.lock_ok().get(id).map(|s| s.created).unwrap_or(false);
        let eng = self.engine_id(id);
        if created {
            let _ = self.rpc("session/destroy", json!({ "session_id": eng })).await;
        }
        self.0.sess.sessions.lock_ok().remove(id);
        // 文件级删除(目录扫描 + 逐 sidecar 读 + 递归删)挪到阻塞线程,
        // 不占 tokio 运行时(对齐 driver/mod.rs 的 spawn_blocking 纪律)。
        // 会话已从 sessions 移除 → 不会再有新帧入队;journal_close 带 ack
        // 等写线程排完队列并关句柄后才删目录——Windows 上打开中的文件删不掉
        let inner = self.0.clone();
        let (id_owned, eng, chat_workdir) = (id.to_string(), eng, chat_workdir);
        tokio::task::spawn_blocking(move || {
            let id = id_owned.as_str();
            // 级联删子代理子会话(sidecar parent == id;壳侧实体,无引擎目录)
            let children: Vec<String> = std::fs::read_dir(&inner.data_dir)
                .map(|it| {
                    it.flatten()
                        .filter(|e| e.path().is_dir())
                        .map(|e| e.file_name().to_string_lossy().into_owned())
                        .filter(|cid| {
                            inner.read_sidecar(cid).get("parent").and_then(|v| v.as_str()) == Some(id)
                        })
                        .collect()
                })
                .unwrap_or_default();
            for cid in children {
                inner.sess.sessions.lock_ok().remove(&cid);
                inner.sub.subagents.lock_ok().remove(&cid);
                inner.journal_close(&cid, true);
                // cid 来自目录扫描,天然是单段名;仍走受校验构造器,
                // 不给"以后有人改成别的来源"留口子
                if let Some(dir) = inner.session_dir(&cid) {
                    let _ = std::fs::remove_dir_all(dir);
                }
            }
            inner.journal_close(id, true);
            // 删 ohmyagent 会话目录(messages.jsonl,目录名是引擎 id)+ 壳 sidecar(含帧日志)
            if let Some(dir) = inner.engine_session_dir(&eng) {
                let _ = std::fs::remove_dir_all(dir);
            }
            if let Some(dir) = inner.session_dir(id) {
                let _ = std::fs::remove_dir_all(dir);
            }
            // 仅清理由 create_chat_workdir 创建并经父目录/命名/符号链接校验的
            // 独立工作区；旧版共享目录和用户项目永远不会走到这里。
            if let Some(path) = chat_workdir {
                if let Err(e) = std::fs::remove_dir_all(&path) {
                    eprintln!("[desktop] 清理对话工作区失败({}): {e}", path.display());
                }
            }
        })
        .await
        .map_err(|e| format!("删除任务失败: {e}"))?;
        Ok(json!({ "ok": true }))
    }

    /// 首条用户消息的首行(≤40 字符,与 session_send 的自动标题同口径)。
    /// 清空标题时用它回填:回落链「用户改名 > summary > 首句」在没有
    /// summary 的会话上也得有着落,不能落成空白标题。找不到返回空串
    /// (会话尚未物化;title 留空,下次发消息 session_send 会自动补首句)。
    fn first_user_line(&self, id: &str) -> String {
        let Some(dir) = self.0.session_dir(id) else { return String::new() };
        for (_, line) in fold::scan_lines(&dir.join("replay.jsonl")) {
            for entry in fold::outline_of_line(0, &line) {
                // 大纲条目的 content 是 base64(与帧内一致,见 fold::outline_entry)
                let Some(b64) = entry.get("content").and_then(|v| v.as_str()) else { continue };
                let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) else { continue };
                let Ok(text) = String::from_utf8(bytes) else { continue };
                let head: String = text.lines().next().unwrap_or("").trim().chars().take(40).collect();
                if !head.is_empty() {
                    return head;
                }
            }
        }
        String::new()
    }

    pub async fn session_patch(&self, id: &str, patch: Value) -> Result<Value, String> {
        check_session_id(id)?;
        // 空标题 = 撤销自定义,回落自动链(用户定案 2026-08-06「清空想用回
        // summary」):摘掉 title_custom 让 UI 回到 summary 优先,title 本身
        // 重填首句——摘了标记但 title 还留着旧改名值的话,无 summary 的会话
        // 会继续显示那个被撤销的名字
        let title = patch.get("title").and_then(|v| v.as_str()).map(|t| {
            // 按字符截断:String::truncate 是字节索引,中文标题在非字符边界截断会 panic
            let t: String = t.trim().chars().take(80).collect();
            if t.is_empty() { (self.first_user_line(id), false) } else { (t, true) }
        });
        if let Some((t, custom)) = title.clone() {
            self.write_sidecar(id, |m| {
                m["title"] = json!(t);
                // 用户改名标记:UI 标题优先级(用户改名 > summary > 首句自动
                // 标题)靠它区分前后两者——title 字段本身分不出来
                m["title_custom"] = json!(custom);
            });
        }
        self.write_sidecar(id, |m| {
            if let Some(a) = patch.get("archived").and_then(|v| v.as_bool()) {
                m["archived"] = json!(a);
            }
        });
        if let Some((t, _)) = title {
            if let Some(s) = self.0.sess.sessions.lock_ok().get_mut(id) {
                s.title = t;
            }
        }
        Ok(json!({ "ok": true }))
    }

    pub async fn models_list(&self) -> Result<Value, String> {
        Ok(Value::Array(
            self.0
                .models
                .iter()
                .map(|m| json!({ "name": m.name, "default": m.default, "source": m.source, "think": m.think, "model": m.model, "locked": m.locked, "owner": m.owner }))
                .collect(),
        ))
    }

    pub async fn session_workdir(&self, id: &str) -> Result<String, String> {
        let raw = {
            let sessions = self.0.sess.sessions.lock_ok();
            sessions.get(id).map(|s| s.workdir.clone()).filter(|w| !w.is_empty())
        };
        let raw = match raw {
            Some(w) => w,
            None => {
                let meta = self.read_sidecar(id);
                meta.get("workdir")
                    .and_then(|v| v.as_str())
                    .filter(|w| !w.is_empty())
                    .map(str::to_string)
                    .ok_or_else(|| format!("会话 {id} 不存在"))?
            }
        };
        // sidecar 里可能是另一运行环境的形态(本机建的 C:\… 切到 WSL 后打开):
        // 消费方(repo/uploads)拿它配 host_fs_view,只认当前环境的形态,
        // 返回前归一化;归一不了的原样交出,由下游按目录不存在外显
        Ok(self.0.resolve_workdir(&raw).unwrap_or(raw))
    }

    // ==================== 对话 ====================

    /// user-input 的返回值契约:Err ⟺ 消息未入会话(未物化任何帧,UI 回队/
    /// 保留输入重投是安全的);Ok ⟺ 回显已落对话流(即使本轮随即失败——错误
    /// 经 task-error 帧外显)。破坏该契约会造成消息在对话流与排队槽双持有。
    pub async fn session_send(&self, id: &str, ftype: &str, payload: Value) -> Result<(), String> {
        // 打开会话已不等引擎握手(见 session_open),上行到这里必须等它就绪:
        // 等待而不是报错——用户在恢复期间敲下的消息不该丢
        self.ensure_engine_ready(id).await?;
        match ftype {
            "user-input" => {
                let content_b64 = payload.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let text = base64::engine::general_purpose::STANDARD
                    .decode(content_b64)
                    .ok()
                    .and_then(|b| String::from_utf8(b).ok())
                    .unwrap_or_default();
                if text.is_empty() {
                    return Err("空输入".into());
                }
                // 忙碌守卫:执行中不再开轮(UI 侧已排队,这里兜底;
                // 不能靠引擎拒绝——乐观帧先落,误开轮会污染回放)
                {
                    let mut sessions = self.0.sess.sessions.lock_ok();
                    let Some(s) = sessions.get_mut(id) else {
                        return Err("会话未打开".into());
                    };
                    if s.running {
                        return Err("当前会话已有任务在执行,请等待完成或先取消".into());
                    }
                    s.running = true;
                    s.turn += 1;
                    if s.title.is_empty() {
                        s.title = text.lines().next().unwrap_or("").chars().take(40).collect();
                    }
                }
                // 本地先行落帧:sendMessage 的 ack 与首批事件在 stdout 上没有
                // 先后保证(引擎收到即起 goroutine 跑轮,快模型下整轮事件可能
                // 先于 ack 到达),回显与开轮不能依赖 ack 时序。
                // user_message 引擎回显事件相应地在 handle_event 里忽略。
                self.push_frame(id, |seq| frame::user_input(&text, seq));
                self.push_frame(id, frame::task_started);
                let title = self.session_title(id);
                // sidecar 读改写(meta.json)是磁盘 I/O,挪阻塞线程再 await:
                // 帧落盘已专职化(push_frame 只入队),meta 每条用户消息才
                // 一次;等它写完再 emit,列表刷新必然看到 running
                {
                    let inner = self.0.clone();
                    let sid = id.to_string();
                    let _ = tokio::task::spawn_blocking(move || {
                        inner.write_sidecar(&sid, |m| {
                            m["status"] = json!(SessionStatus::Running.as_str());
                            if m.get("title").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
                                m["title"] = json!(title);
                            }
                            let turns = m.get("turns").and_then(|v| v.as_u64()).unwrap_or(0);
                            m["turns"] = json!(turns + 1);
                        });
                    })
                    .await;
                }
                self.emit_session_event(id, SessionStatus::Running.as_str());
                match self
                    .rpc("session/sendMessage", json!({ "session_id": self.engine_id(id), "message": text }))
                    .await
                {
                    Ok(_) => Ok(()),
                    Err(e) => {
                        // 引擎没接活:补终止帧关轮,状态回落。注意这里必须回 Ok——
                        // 回显帧已物化进对话流,契约是「Err ⟺ 消息未入会话」:上抛
                        // Err 会让 UI 按排队语义回队,消息同时挂在对话流与队列里
                        // (用户看到"已发出却仍在排队"),且 task-ended 帧一到又
                        // 触发重投,再落一条重复回显。错误经 task-error 帧与
                        // session-status(error) 事件外显,不靠命令返回值
                        if let Some(s) = self.0.sess.sessions.lock_ok().get_mut(id) {
                            s.running = false;
                        }
                        self.push_frame(id, |seq| frame::task_error(&e, seq));
                        self.push_frame(id, frame::task_ended);
                        // 同上:sidecar 落盘走阻塞线程
                        {
                            let inner = self.0.clone();
                            let sid = id.to_string();
                            let _ = tokio::task::spawn_blocking(move || {
                                inner.write_sidecar(&sid, |m| {
                                    m["status"] = json!(SessionStatus::Error.as_str())
                                });
                            })
                            .await;
                        }
                        self.emit_session_event(id, SessionStatus::Error.as_str());
                        Ok(())
                    }
                }
            }
            "user-cancel" => {
                let turn = self.0.sess.sessions.lock_ok().get(id).map(|s| s.turn).unwrap_or(0);
                // 引擎应答是确认而非前提:cancel 无应答(挂死/超时)时本地和解,
                // 否则会话永卡 running;引擎若事后仍发 turn/stopped,
                // 幂等守卫(was_running)会吞掉迟到的收尾
                if let Err(e) = self.rpc("cancel", json!({ "session_id": self.engine_id(id) })).await {
                    self.0.reconcile_session(id, &format!("取消未获引擎应答,已本地中断({e})"));
                    return Ok(());
                }
                // 应答 Ok 只说明引擎**收下**了 cancel,不等于轮次停了:工具调用
                // 挂死(bash 不返回、扩展不应答、无超时的网络请求)时 turn/stopped
                // 永远不来,会话就永卡 running——再点取消也只是又被收下一次。
                // 给引擎自宣的优雅预算 + 余量,到点仍是同一轮在跑就本地和解。
                self.spawn_cancel_watchdog(id, turn);
                Ok(())
            }
            "permission-resp" => {
                let req_id = payload.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let approved = payload.get("approved").and_then(|v| v.as_bool()).unwrap_or(false);
                let remember = payload.get("remember").and_then(|v| v.as_bool()).unwrap_or(false);
                let persist = payload.get("persist").and_then(|v| v.as_bool()).unwrap_or(false);
                if self.has_cap("permissionRemember") {
                    // 审批记忆归引擎:UI 的 remember(旧语义:引擎生命周期内
                    // 记住)与 persist(旧语义:全局持久化)两档统一映射为
                    // respond.remember=true——引擎按命令段粒度(如批准
                    // `git push --force` 记 Bash(git push *))写入会话 cwd 的
                    // 项目级 .ohmyagent/settings.json。语义落差说明:粒度更细
                    // (不再"记住一次 Bash 放行所有命令",安全评审点名的洞)、
                    // 作用域从"全局"收窄到"项目"且必持久,原会话级临时档
                    // 不再单独提供——两档都取引擎单档,强于旧两档的任意一档
                    let mut params = json!({ "request_id": req_id, "approved": approved });
                    if approved && (remember || persist) {
                        params["remember"] = json!(true);
                    }
                    self.respond_rpc("permission/respond", params);
                    self.take_perm_tool(&req_id); // 工具名暂存仅旧路径消费,清掉防泄漏
                } else {
                    // 兼容尾巴:旧引擎无 permissionRemember,保留壳侧工具名
                    // 粒度记忆集(remember=内存,persist=追加落盘)
                    self.respond_rpc(
                        "permission/respond",
                        json!({ "request_id": req_id, "approved": approved }),
                    );
                    let tool = self.take_perm_tool(&req_id);
                    if approved && remember {
                        if let Some(tool) = tool {
                            self.0.sess.perm_remember.lock_ok().insert(tool);
                            if persist {
                                let set = self.0.sess.perm_remember.lock_ok().clone();
                                let _ = std::fs::write(
                                    &self.0.perm_persist_path,
                                    serde_json::to_vec_pretty(&set).unwrap_or_default(),
                                );
                            }
                        }
                    }
                }
                self.resolve_perm(id, &req_id, if approved { PermOutcome::Approved } else { PermOutcome::Denied });
                Ok(())
            }
            "reply-question" => {
                let req_id = payload.get("request_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let answers_json = payload.get("answers_json").and_then(|v| v.as_str()).unwrap_or("{}");
                let cancelled = payload.get("cancelled").and_then(|v| v.as_bool()).unwrap_or(false);
                let answers: HashMap<String, Value> = serde_json::from_str(answers_json).unwrap_or_default();
                let stored = self.0.sess.pending_questions.lock_ok().remove(&req_id);
                let ua: Vec<Value> = stored
                    .as_ref()
                    .and_then(|(_, qs)| qs.as_array())
                    .map(|qs| {
                        qs.iter()
                            .map(|q| {
                                let question = q.get("question").and_then(|v| v.as_str()).unwrap_or("");
                                let header = q.get("header").and_then(|v| v.as_str()).unwrap_or("");
                                let ans = answers.get(question);
                                let selected: Vec<String> = match ans {
                                    Some(Value::String(s)) => vec![s.clone()],
                                    Some(Value::Array(a)) => {
                                        a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()
                                    }
                                    _ => vec![],
                                };
                                // 自由输入 = 答案不在候选项里
                                let opts: HashSet<String> = q
                                    .get("options")
                                    .and_then(|v| v.as_array())
                                    .map(|a| {
                                        a.iter()
                                            .filter_map(|o| o.get("label").and_then(|l| l.as_str()).map(str::to_string))
                                            .collect()
                                    })
                                    .unwrap_or_default();
                                let custom = selected.iter().any(|s| !opts.contains(s));
                                json!({ "header": header, "question": question, "selected": selected, "custom": custom })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                self.respond_rpc(
                    "question/respond",
                    json!({ "request_id": req_id, "answers": ua, "cancelled": cancelled }),
                );
                // 回显帧入日志(回放可见答案)
                self.push_frame(id, |seq| frame::reply_question(&req_id, answers_json, cancelled, seq));
                self.emit_session_ask(id, false);
                Ok(())
            }
            other => Err(format!("ohmyagent 引擎不支持上行帧 {other}")),
        }
    }

    /// cancel 兜底:到期仍是**同一轮**在跑才和解。不比对轮次会误杀——用户
    /// 取消后引擎正常收尾、用户又发了新消息,看门狗到期时会话同样是 running,
    /// 不认轮就把无辜的新一轮打断了。
    fn spawn_cancel_watchdog(&self, id: &str, turn: u64) {
        let me = self.clone();
        let sid = id.to_string();
        let grace = self.0.transport.shutdown_grace_ms.load(Ordering::Relaxed).max(0) as u64;
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(grace + CANCEL_GRACE_EXTRA_MS)).await;
            let stale = me
                .0
                .sess.sessions
                .lock_ok()
                .get(&sid)
                .map(|s| s.running && s.turn == turn)
                .unwrap_or(false);
            if stale {
                eprintln!("[desktop] 取消后引擎未在期限内停止,本地和解: sid={sid} turn={turn}");
                me.0.reconcile_session(&sid, "取消后引擎未在期限内停止,已本地中断");
            }
        });
    }

    pub async fn session_call(&self, id: &str, kind: &str, payload: Value) -> Result<Value, String> {
        // 同 session_send:引擎侧查询/切换都得等后台 resume 落地。
        // 唯独切模型不吃 resume 失败:恢复失败时会话未建成,正好走下方
        // 未建成分支带新选模型重建——这是原模型失效后用户仅剩的自救入口,
        // 堵死就只能续费或手改配置了。其余命令照旧上抛
        let ready = self.ensure_engine_ready(id).await;
        if let Err(e) = &ready {
            if kind != "session_set_model" {
                return Err(e.clone());
            }
        }
        match kind {
            "session_set_model" => {
                let name = payload.get("model").and_then(|v| v.as_str()).unwrap_or("");
                let model_id = self.model_id_of(name)?; // 前置校验,未知模型不动会话
                // 引擎同样拒绝运行中切模型,本地先给友好错误
                if self.0.sess.sessions.lock_ok().get(id).map(|s| s.running).unwrap_or(false) {
                    return Err("执行中不能切换,请先取消当前任务".into());
                }
                if !self.session_created(id) {
                    let mode = self.session_mode(id);
                    self.create_resumed(id, &model_id, &mode).await?;
                } else if self.has_cap("session/switchModel") {
                    self.rpc(
                        "session/switchModel",
                        json!({ "session_id": self.engine_id(id), "model": model_id }),
                    )
                    .await?;
                } else {
                    // 版本握手回退:旧引擎无 switch RPC,destroy+resume 全参重建
                    let mode = self.session_mode(id);
                    self.recreate_fallback(id, &model_id, &mode).await?;
                }
                if let Some(s) = self.0.sess.sessions.lock_ok().get_mut(id) {
                    s.model_name = name.to_string();
                }
                self.write_sidecar(id, |m| m["model_name"] = json!(name));
                // 引擎切模型会把思考态重置为新模型默认档,重放会话已选档位
                self.apply_session_think(id, &self.engine_id(id)).await;
                self.push_frame(id, |seq| frame::model_update(name, seq));
                // resume 失败后的自救成功:恢复失败横幅还挂在会话上,就地改报已连接
                if ready.is_err() {
                    self.0.app.emit_json(
                        &format!("conn-status:{id}"),
                        json!({ "text": "已连接", "connected": true }),
                    );
                }
                Ok(json!({ "result": { "model": name } }))
            }
            // 会话级思考档位:经引擎 session/setThinking 下发(loop 内存态,
            // 无须重建 provider);档位随 sidecar 持久,resume/切模型时由
            // apply_session_think 重放。""(跟随默认)不是可下发的档位。
            "session_set_think" => {
                let level = payload.get("think").and_then(|v| v.as_str()).unwrap_or("");
                if level.is_empty() || !valid_think(level) {
                    return Err(format!("不支持的思考档位: {level:?}"));
                }
                // 引擎同样拒绝运行中改思考,本地先给友好错误
                if self.0.sess.sessions.lock_ok().get(id).map(|s| s.running).unwrap_or(false) {
                    return Err("执行中不能切换,请先取消当前任务".into());
                }
                if !self.session_created(id) {
                    let mode = self.session_mode(id);
                    let model_id = self.model_id_of_any(&self.session_model_name(id))?;
                    self.create_resumed(id, &model_id, &mode).await?;
                }
                self.rpc("session/setThinking", think_rpc_params(&self.engine_id(id), level))
                    .await?;
                self.write_sidecar(id, |m| m["think"] = json!(level));
                self.push_frame(id, |seq| frame::think_update(level, seq));
                Ok(json!({ "result": { "think": level } }))
            }
            "session_set_mode" => {
                // 权限模式切换:运行中也可热切(上游子代理评估器已实时继承
                // 父模式,969311a 起热切对后续子代理同样生效)。
                let mode = payload.get("mode").and_then(|v| v.as_str()).unwrap_or("default");
                if !self.session_created(id) {
                    let model_id = self.model_id_of_any(&self.session_model_name(id))?;
                    self.create_resumed(id, &model_id, mode).await?;
                    self.apply_session_think(id, &self.engine_id(id)).await;
                } else if self.has_cap("session/switchMode") {
                    self.rpc(
                        "session/switchMode",
                        json!({ "session_id": self.engine_id(id), "permission_mode": ohmy_mode_of(mode) }),
                    )
                    .await?;
                } else {
                    // 版本握手回退:旧引擎只能 destroy+resume,那必须空闲
                    if self.0.sess.sessions.lock_ok().get(id).map(|s| s.running).unwrap_or(false) {
                        return Err("当前引擎版本较旧,执行中不能切换权限模式,请先取消任务".into());
                    }
                    let model_id = self.model_id_of_any(&self.session_model_name(id))?;
                    self.recreate_fallback(id, &model_id, mode).await?;
                    self.apply_session_think(id, &self.engine_id(id)).await;
                }
                // 切到 yolo 自动放行本会话所有挂起审批。
                // 先切引擎再排空——切换后引擎新的审批直接放行不再产生 ask,
                // 排空动作不会漏掉切换瞬间的请求
                if mode == "yolo" {
                    let drained: Vec<String> = self
                        .0
                        .sess.pending_perms
                        .lock_ok()
                        .iter()
                        .filter(|(_, sid)| sid.as_str() == id)
                        .map(|(req_id, _)| req_id.clone())
                        .collect();
                    for req_id in drained {
                        self.respond_rpc(
                            "permission/respond",
                            json!({ "request_id": req_id, "approved": true }),
                        );
                        self.take_perm_tool(&req_id);
                        self.resolve_perm(id, &req_id, PermOutcome::Approved);
                    }
                }
                if let Some(s) = self.0.sess.sessions.lock_ok().get_mut(id) {
                    s.mode = mode.to_string();
                }
                self.write_sidecar(id, |m| m["mode"] = json!(mode));
                self.push_frame(id, |seq| frame::permission_mode_update(mode, seq));
                Ok(json!({ "result": { "mode": mode } }))
            }
            // 会话技能启用集:引擎无 skills 协议,唯一生效路径是"重写引擎
            // 技能目录 + destroy/resume 重建让 catalog 重扫"(web 版运行中改
            // 技能同样是重启保会话的语义)。空数组是合法值 = 全部停用。
            "session_set_skills" => {
                let names: Vec<String> = payload
                    .get("skills")
                    .and_then(|v| v.as_array())
                    .ok_or("缺少 skills 列表")?
                    .iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect();
                // 重建只在空闲时安全(与旧引擎切模式的回退同一约束)
                if self.0.sess.sessions.lock_ok().get(id).map(|s| s.running).unwrap_or(false) {
                    return Err("执行中不能切换,请先取消当前任务".into());
                }
                // 先落 sidecar:重建路径(create_resumed)物化时读的就是它;
                // 重建失败也保留用户意图,下次 resume 按新集生效
                self.write_sidecar(id, |m| m["skills"] = json!(names));
                let mode = self.session_mode(id);
                let model_id = self.model_id_of_any(&self.session_model_name(id))?;
                if !self.session_created(id) {
                    self.create_resumed(id, &model_id, &mode).await?;
                } else {
                    self.recreate_fallback(id, &model_id, &mode).await?;
                }
                // 重建回落模型默认思考档,重放会话已选档位(切模型同款)
                self.apply_session_think(id, &self.engine_id(id)).await;
                Ok(json!({ "result": { "skills": names } }))
            }
            // 手动压缩上下文:引擎**同步应答**(stdio.go handleSessionCompact,
            // ForceCompact 跑完才回,成功携 context_used/window,全程不发
            // turn/stopped)——应答即轮次边界,成败都在本分支就地收轮。
            // 压缩期间引擎占忙碌位(sendMessage 被拒、cancel 可打断,打断
            // 表现为本 RPC 返回错误);compaction/usage 事件先于应答到达,
            // compact_status 系统行由事件通路照常外显。
            "session_compact" => {
                if self.0.sess.sessions.lock_ok().get(id).map(|s| s.running).unwrap_or(false) {
                    return Err("执行中不能压缩上下文,请先取消当前任务".into());
                }
                if !self.session_created(id) {
                    // 未在引擎侧物化的会话先 resume:压缩对象是引擎内存里的历史
                    let mode = self.session_mode(id);
                    let model_id = self.model_id_of_any(&self.session_model_name(id))?;
                    self.create_resumed(id, &model_id, &mode).await?;
                    self.apply_session_think(id, &self.engine_id(id)).await;
                }
                if !self.has_cap("session/compact") {
                    return Err("当前引擎版本不支持手动压缩,请升级引擎".into());
                }
                // 乐观开轮:事件先于应答到达,忙碌态与 task_started 不能等
                // RPC 返回;turn 自增让取消看门狗把这次压缩当独立一轮对表。
                // compacting 标记让 normalize 知道 "started" 已在此实时落过
                // (引擎只有"压缩完成"一个事件,不标记的话事件又合成一对,
                // "正在压缩/压缩完成"同刻蹦出两条)。
                if let Some(s) = self.0.sess.sessions.lock_ok().get_mut(id) {
                    s.running = true;
                    s.compacting = true;
                    s.turn += 1;
                }
                self.push_frame(id, frame::task_started);
                self.push_frame(id, |seq| frame::compact_status("started", seq));
                self.emit_session_event(id, SessionStatus::Running.as_str());
                // 应答要等整段历史的 LLM 摘要,30s 常规预算不够,单独放宽。
                // 超时是本地放弃:引擎可能仍在压缩并事后成功,期间上行会被
                // 引擎忙碌守卫拒绝,错误如实外显,不做本地和解
                let r = self
                    .rpc_with_timeout(
                        "session/compact",
                        json!({ "session_id": self.engine_id(id) }),
                        COMPACT_RPC_TIMEOUT,
                    )
                    .await;
                if let Some(s) = self.0.sess.sessions.lock_ok().get_mut(id) {
                    s.running = false;
                    s.compacting = false;
                }
                match r {
                    Ok(resp) => {
                        // 应答携带压缩后的权威上下文快照(usage 事件先行,
                        // 这里兜底对齐,防事件被引擎重启等原因吞掉)
                        if let (Some(used), Some(window)) = (
                            resp.get("context_used").and_then(Value::as_i64),
                            resp.get("context_window").and_then(Value::as_i64),
                        ) {
                            self.0.push_usage(id, used, window);
                        }
                        self.push_frame(id, frame::task_ended);
                        self.emit_session_event(id, SessionStatus::Idle.as_str());
                        Ok(json!({ "result": { "status": "ok" } }))
                    }
                    Err(e) => {
                        // 失败/被取消/超时:与 user-input 同契约——轮已开、
                        // "正在压缩"已落对话流,错误也走帧收进对话流闭合记录
                        // (走 Err/ErrorBar 的话,对话流里悬着一条"正在压缩"
                        // 没有下文),命令本身回 Ok。
                        self.push_frame(id, |seq| frame::task_error(&e, seq));
                        self.push_frame(id, frame::task_ended);
                        self.emit_session_event(id, SessionStatus::Error.as_str());
                        Ok(json!({ "result": { "status": "error" } }))
                    }
                }
            }
            other => Ok(json!({ "error": format!("ohmyagent 引擎不支持 {other}") })),
        }
    }

    /// 会话在引擎中(重)建:有历史则 resume 带全参(缺参会回落进程默认值);
    /// 空会话(存储中无此会话,经 engine_session_exists 判定)resume 必失败,
    /// 改全新 create——
    /// 引擎发新 id,壳 sid/目录/UI 通道不变,engine_id 换绑并落 sidecar。
    async fn create_resumed(&self, id: &str, model_id: &str, mode: &str) -> Result<(), String> {
        let eng = self.engine_id(id);
        let has_history = self.engine_session_exists(&eng).await;
        let mut workdir =
            self.0.sess.sessions.lock_ok().get(id).map(|s| s.workdir.clone()).unwrap_or_default();
        if workdir.is_empty() {
            // 空 workdir 会触发引擎的 os.Getwd 兜底(进程 cwd),显式回退
            // 主目录(WSL 模式 guest 家目录)
            workdir = self.0.default_workdir();
        } else {
            // 同 resume_engine:登记值可能属于另一运行环境,按当前环境归一化
            workdir = self.0.resolve_workdir(&workdir)?;
        }
        let params = engine_session_create_params(
            &workdir,
            has_history.then_some(eng.as_str()),
            Some(model_id),
            mode,
        );
        // 技能物化 + create 圈进技能闸(session_create_with_kind 同理)。
        // 这条路承接 session_set_skills 的重建:物化失败必须外显——吞掉的话
        // 用户以为改完了,引擎拿到的还是旧技能集
        let skills_lock = self.0.skills_gate.lock().await;
        self.materialize_skills(self.session_skills(id)).await?;
        let result = self.rpc("session/create", params).await?;
        drop(skills_lock);
        // 同 resume_engine:换绑的 engine_id 是目录名,畸形值不接受
        let new_eng = result
            .get("session_id")
            .and_then(|v| v.as_str())
            .filter(|e| valid_session_id(e))
            .unwrap_or(&eng)
            .to_string();
        if let Some(s) = self.0.sess.sessions.lock_ok().get_mut(id) {
            s.created = true;
            s.engine_id = new_eng.clone();
        }
        if new_eng != id {
            let e = new_eng.clone();
            self.write_sidecar(id, |m| m["engine_id"] = json!(e));
        }
        // resume 结果带恢复历史的占用估计(296176a)
        self.0.push_usage(
            id,
            result.get("context_used").and_then(|v| v.as_i64()).unwrap_or(0),
            result.get("context_window").and_then(|v| v.as_i64()).unwrap_or(0),
        );
        Ok(())
    }

    /// 按 Agent/壳 session id 精确查工作区。新 MCP 调用同时显式携带
    /// work_dir；本方法用于兼容元数据缺失或旧 Agent。
    pub fn browser_workdir_for(&self, id: &str) -> Option<String> {
        let sessions = self.0.sess.sessions.lock_ok();
        sessions
            .get(id)
            .or_else(|| sessions.values().find(|session| session.engine_id == id))
            .map(|session| session.workdir.clone())
            .filter(|workdir| !workdir.is_empty())
    }

    /// 旧 Agent 没有 MCP 调用元数据时的截图落盘兜底：仅在唯一 owner 可
    /// 确定时返回路径。多 owner 时只跳过落盘，浏览器现场仍正常并发。
    pub fn single_running_workdir(&self) -> Option<String> {
        // 显式后台 Agent 只转发 tool/error 心跳，纯文本任务可能从未物化
        // child SessionState；background_agents 才是其存活/父归属真值。
        let background_parents: Vec<String> = self.0.sub.background_agents.lock_ok()
            .values().map(|(parent_sid, _)| parent_sid.clone()).collect();
        let subs = self.0.sub.subagents.lock_ok();
        let sessions = self.0.sess.sessions.lock_ok();
        let mut owners: HashMap<String, String> = HashMap::new();
        for (sid, session) in sessions.iter().filter(|(_, session)| session.running) {
            let (owner, workdir) = match subs.get(sid) {
                Some(route) => (
                    route.parent_sid.clone(),
                    sessions.get(&route.parent_sid)
                        .map(|parent| parent.workdir.clone())
                        .unwrap_or_else(|| session.workdir.clone()),
                ),
                None => (sid.clone(), session.workdir.clone()),
            };
            owners.entry(owner).or_insert(workdir);
        }
        for parent_sid in background_parents {
            let workdir = sessions.get(&parent_sid)
                .map(|parent| parent.workdir.clone()).unwrap_or_default();
            owners.entry(parent_sid).or_insert(workdir);
        }
        let active: Vec<String> = owners.into_values().collect();
        match active.as_slice() {
            [workdir] if !workdir.is_empty() => Some(workdir.clone()),
            _ => None,
        }
    }

    /// 自动维护不得中断父任务或仍在后台执行的子代理。
    pub fn has_running_sessions(&self) -> bool {
        let foreground = self.0.sess.sessions.lock_ok().values()
            .any(|session| session.running);
        foreground || !self.0.sub.background_agents.lock_ok().is_empty()
    }

    fn session_created(&self, id: &str) -> bool {
        self.0.sess.sessions.lock_ok().get(id).map(|s| s.created).unwrap_or(false)
    }

    /// 会话技能启用集重写到引擎技能目录(skills.rs::materialize,阻塞盘 I/O
    /// 走 blocking 池)。调用方负责持 skills_gate 并圈住随后的 create RPC。
    async fn materialize_skills(&self, enabled: Option<Vec<String>>) -> Result<Vec<String>, String> {
        let engine_dir = self.0.engine_dir.clone();
        let builtin = self.0.skills_builtin_dir.clone();
        let user = self.0.skills_user_dir.clone();
        let defaults = self.0.skills_defaults_path.clone();
        tokio::task::spawn_blocking(move || {
            crate::skills::materialize(
                &engine_dir,
                builtin.as_deref(),
                &user,
                &defaults,
                enabled.as_deref(),
            )
        })
        .await
        .map_err(|e| format!("技能物化任务失败: {e}"))?
    }

    /// sidecar 记录的技能启用集;None = 缺省集(官方四件套 + 用户技能,
    /// skills::DEFAULT_ENABLED)——旧会话无此字段的兜底,也是新会话的
    /// 初始语义,session_create 时落成显式快照。
    fn session_skills(&self, id: &str) -> Option<Vec<String>> {
        skills_of_meta(&self.read_sidecar(id))
    }

    /// 出站 RPC 用的引擎会话 id(通常 == 壳 sid;空会话重建后换绑,
    /// 未加载时回退 sidecar 记录)。
    fn engine_id(&self, id: &str) -> String {
        if let Some(e) = self.0.sess.sessions.lock_ok().get(id).map(|s| s.engine_id.clone()) {
            return e;
        }
        self.read_sidecar(id)
            .get("engine_id")
            .and_then(|v| v.as_str())
            .filter(|e| !e.is_empty())
            .map(String::from)
            .unwrap_or_else(|| id.to_string())
    }

    fn has_cap(&self, cap: &str) -> bool {
        self.0.has_cap(cap)
    }

    /// resume 可用性判定(session/create 带 resume 前的存在性检查)。
    /// sessionQuery cap:调 session/exists,会话存储布局归引擎私有;
    /// 兼容尾巴:旧引擎(或查询意外失败时保守回退)探测
    /// sessions/<id>/messages.jsonl——引擎存储格式的隐式契约仅剩此处。
    pub(super) async fn engine_session_exists(&self, eng: &str) -> bool {
        if self.has_cap("sessionQuery") {
            match self.rpc("session/exists", json!({ "session_id": eng })).await {
                Ok(v) => return v.get("exists").and_then(|e| e.as_bool()).unwrap_or(false),
                // RPC 失败不能直接判"不存在":误判会走全新 create 换绑
                // engine_id,孤儿化既有历史——落回文件探测并外显
                Err(e) => eprintln!("[desktop] session/exists 查询失败,回退文件探测: {e}"),
            }
        }
        self.0
            .engine_session_dir(eng)
            .is_some_and(|dir| dir.join("messages.jsonl").is_file())
    }

    /// destroy + 重建实现切换(仅空闲时安全):模式切换的常规路径
    /// (子代理权限顶棚只在构建时生效)与旧引擎无 switch RPC 的回退。
    async fn recreate_fallback(&self, id: &str, model_id: &str, mode: &str) -> Result<(), String> {
        // destroy 容错:引擎侧可能已无此会话(崩溃重启后),不阻断重建
        let _ = self.rpc("session/destroy", json!({ "session_id": self.engine_id(id) })).await;
        if let Some(s) = self.0.sess.sessions.lock_ok().get_mut(id) {
            s.created = false;
        }
        self.create_resumed(id, model_id, mode).await
    }

    fn session_mode(&self, id: &str) -> String {
        self.0
            .sess.sessions
            .lock_ok()
            .get(id)
            .map(|s| s.mode.clone())
            .unwrap_or_else(|| "default".into())
    }

    fn session_model_name(&self, id: &str) -> String {
        self.0.sess.sessions.lock_ok().get(id).map(|s| s.model_name.clone()).unwrap_or_default()
    }

    // ==================== 辅助 ====================

    /// 模型选择键(严格版,显式选模型用:新建会话/切换模型)。locked
    /// (超会员档)条目拒绝——UI 灰态禁选,显式落在会员档不允许的模型上
    /// 只会在发消息时吃服务端拒绝,前置报错更友好。
    fn model_id_of(&self, name: &str) -> Result<String, String> {
        self.resolve_model(name, false)
    }

    /// 模型选择键(宽松版,恢复/重建已有会话用)。locked 条目照常放行:
    /// 引擎 settings 物化全部条目(config.rs),会员档权限由服务端把关——
    /// 会员到期不能让老会话打不开,进去后用户可自行切换模型。
    fn model_id_of_any(&self, name: &str) -> Result<String, String> {
        self.resolve_model(name, true)
    }

    /// e792858 起 settings.models 按**别名**作键,引擎双解析(别名优先,
    /// wire id 回退)——但同 wire id 多网关会撞 wireIndex,壳一律传别名。
    /// default/首条回退恒滤 locked(旧 config 的 default 可能落在降档后的
    /// 锁定行,不默认选禁用项)。
    fn resolve_model(&self, name: &str, allow_locked: bool) -> Result<String, String> {
        if name.is_empty() {
            return self
                .0
                .models
                .iter()
                .find(|m| m.default && !m.locked)
                .or(self.0.models.iter().find(|m| !m.locked))
                .map(|m| m.name.clone())
                .ok_or_else(|| "尚未配置可用模型,请先在设置中添加".into());
        }
        // 精确没中再按宽松口径找一次:同步条目的落盘名带来源后缀
        //(ui/src/settingsConfig.ts syncedName),而加后缀之前建的会话、
        // 记忆里的默认模型记的都是裸名——不兜这一次,升级后老会话一律
        // "未知模型",连恢复都进不去
        let m = self
            .0
            .models
            .iter()
            .find(|m| m.name == name)
            .or_else(|| self.0.models.iter().find(|m| strip_source_suffix(&m.name) == strip_source_suffix(name)))
            .ok_or_else(|| format!("未知模型 {name:?}"))?;
        if m.locked && !allow_locked {
            return Err(format!("模型 {name:?} 当前会员档不可用,升级后重新同步"));
        }
        Ok(m.name.clone())
    }

    /// 会话思考档位(sidecar 持久;""=跟随模型默认)。畸形值按默认处理。
    fn session_think(&self, id: &str) -> String {
        self.read_sidecar(id)
            .get("think")
            .and_then(|v| v.as_str())
            .filter(|t| valid_think(t))
            .unwrap_or("")
            .to_string()
    }

    /// 把会话已选思考档位重放给引擎(session/setThinking)。引擎的思考态
    /// 是 loop 内存值,create/resume/切模型都会回落到模型默认档,凡引擎
    /// 会话(重)建或换 provider 处都要调;空档位 = 跟随默认,无需下发。
    /// 失败不阻断调用方主流程(思考是增强配置,不该让会话打不开),留痕。
    async fn apply_session_think(&self, id: &str, engine_id: &str) {
        let level = self.session_think(id);
        if level.is_empty() {
            return;
        }
        if let Err(e) = self.rpc("session/setThinking", think_rpc_params(engine_id, &level)).await {
            eprintln!("[desktop] 会话 {id} 思考档位重放失败: {e}");
        }
    }

    fn session_title(&self, id: &str) -> String {
        self.0.sess.sessions.lock_ok().get(id).map(|s| s.title.clone()).unwrap_or_default()
    }

    fn read_sidecar(&self, id: &str) -> Value {
        self.0.read_sidecar(id)
    }

    fn write_sidecar(&self, id: &str, f: impl FnOnce(&mut Value)) {
        self.0.write_sidecar(id, f)
    }

    /// 整读帧日志(测试断言用;线上回放走 replay_open,带 flush 屏障)。
    #[cfg(test)]
    pub(super) fn read_journal(&self, id: &str) -> Vec<Value> {
        let path = self.0.data_dir.join(id).join("events.jsonl");
        let Ok(data) = std::fs::read_to_string(path) else { return vec![] };
        data.lines().filter_map(|l| serde_json::from_str(l).ok()).collect()
    }

    /// 追加一帧:编 seq → 入日志 → (opened 时)入批量缓冲。
    fn push_frame(&self, sid: &str, build: impl FnOnce(u64) -> Value) {
        self.0.push_frame(sid, build)
    }

    fn emit_session_event(&self, sid: &str, status: &str) {
        self.0.emit_session_event(sid, status)
    }

    fn emit_session_ask(&self, sid: &str, open: bool) {
        self.0.emit_session_ask(sid, open)
    }

    fn resolve_perm(&self, sid: &str, req_id: &str, outcome: PermOutcome) {
        self.0.resolve_perm(sid, req_id, outcome)
    }

    fn take_perm_tool(&self, req_id: &str) -> Option<String> {
        self.0.sess.perm_tools.lock_ok().remove(req_id)
    }
}

impl Inner {
    /// 会话 workdir 归一化(kernel_env 语义的单点:session_create 入口、
    /// resume_engine/create_resumed 的恢复重建、session_workdir 的壳侧
    /// 消费读取都走这里——运行环境可能在会话生命周期中途切换,sidecar 里
    /// 的形态不可直信)。本机:展开 ~(现状)。WSL:~ 拼 guest 家目录
    /// (宿主 expand_tilde 会展开成 Windows 主目录,落错环境);目录对话框
    /// 选出的 \\wsl$ UNC 回译为 guest 路径(发行版必须与当前运行环境一致);
    /// 盘符路径映射 automount(C:\proj → /mnt/c/proj);/ 开头视为 guest
    /// 绝对路径原样;其余(相对路径等)明确拒绝。
    pub(super) fn resolve_workdir(&self, raw: &str) -> Result<String, String> {
        match &self.wsl {
            Some(w) => resolve_wsl_workdir(w, raw),
            None => Ok(crate::config::expand_tilde(raw)),
        }
    }

    /// workdir 空缺时的回退(旧 sidecar 兼容/模式切换重建):本机主目录,
    /// WSL 模式 guest 家目录——不能把 Windows 主目录喂给 guest 内的引擎。
    pub(super) fn default_workdir(&self) -> String {
        match &self.wsl {
            Some(w) => w.guest_home.clone(),
            None => crate::config::home_dir()
                .map(|h| h.to_string_lossy().into_owned())
                .unwrap_or_default(),
        }
    }

    // workdir_fs_view 已删(2026-08-09):它做的是"把 guest workdir 包成
    // \\wsl$\<发行版>\… 的宿主视角",而 WSL 下**没有一条路该这么验目录**——
    // 本地项目走 wsl::ensure_guest_dir(在 guest 内 cd+pwd -P,顺带解软链),
    // 对话工作区壳刚在宿主建好、根本不用验。留着只会让人再写出
    // \\wsl$\<发行版>\mnt\c\… 这种 Windows 穿不过去的路径(见
    // session_create_with_kind 里的三分支注释)。宿主侧文件操作请直接用
    // wsl::host_fs_view。

    /// chat 会话 workdir 的会话面形态:目录由壳在宿主创建
    /// (chat_workspaces_dir 下),WSL 模式下存 sidecar/传引擎的字符串换成
    /// guest 形态(guest_chat_root 前缀),维持"WSL 模式 sidecar 一律存
    /// guest 路径"不变量。
    pub(super) fn chat_workdir_for_engine(&self, host_path: &Path) -> String {
        match (&self.wsl, host_path.file_name()) {
            (Some(w), Some(name)) => {
                format!("{}/{}", w.guest_chat_root.trim_end_matches('/'), name.to_string_lossy())
            }
            _ => host_path.to_string_lossy().into_owned(),
        }
    }

    /// chat_workdir_for_engine 的逆:删除会话等宿主文件操作前,把 sidecar
    /// 里的 guest 形态换回宿主形态;非 WSL 或前缀不符原样返回(交给
    /// managed_chat_workdir 的校验兜底)。
    pub(super) fn host_chat_workdir(&self, workdir: &str) -> String {
        let Some(w) = &self.wsl else {
            return workdir.to_string();
        };
        let root = w.guest_chat_root.trim_end_matches('/');
        match workdir.strip_prefix(root).and_then(|r| r.strip_prefix('/')) {
            Some(name) if !name.is_empty() && !name.contains('/') => {
                self.chat_workspaces_dir.join(name).to_string_lossy().into_owned()
            }
            _ => workdir.to_string(),
        }
    }

    /// 会话 sidecar 目录。**唯一**允许把会话 id 拼进 data_dir 的地方:
    /// 校验不过就不构造路径,未校验的名字因此到不了文件系统(见
    /// valid_session_id 注释里的爆炸半径)。
    pub(super) fn session_dir(&self, id: &str) -> Option<PathBuf> {
        valid_session_id(id).then(|| self.data_dir.join(id))
    }

    /// 引擎侧会话目录(messages.jsonl 所在)。engine_id 同样是引擎给的、
    /// 会被 remove_dir_all 的目录名,守卫标准与壳 sid 一致。
    pub(super) fn engine_session_dir(&self, engine_id: &str) -> Option<PathBuf> {
        valid_session_id(engine_id).then(|| self.engine_dir.join("sessions").join(engine_id))
    }

    fn sidecar_path(&self, id: &str) -> Option<PathBuf> {
        Some(self.session_dir(id)?.join("meta.json"))
    }

    pub(super) fn read_sidecar(&self, id: &str) -> Value {
        self.sidecar_path(id)
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|d| serde_json::from_slice(&d).ok())
            .unwrap_or_else(|| json!({}))
    }

    /// 取舍:sidecar 读改写保留同步实现,不并入 journal 写线程——
    /// 量级是"每次用户动作/轮次一次的小文件",且多处调用点依赖
    /// 写后立读的一致性(session_create → sessions_list),经通道
    /// 异步化会引入陈旧读。热路径(每 token 帧)已由写线程专职化;
    /// async command 里的调用点按需套 spawn_blocking(session_send/
    /// session_delete/sessions_list),reader 线程本就是专用 std 线程。
    pub(super) fn write_sidecar(&self, id: &str, f: impl FnOnce(&mut Value)) {
        self.write_sidecar_inner(id, true, f)
    }

    /// 不刷 updated_at 的写法。侧栏按 updated_at 倒序排,而摘要这类
    /// "模型异步回来、与用户动作无关"的字段一刷就把会话无端顶到最前——
    /// 用户没动它,列表却重排了。
    pub(super) fn write_sidecar_keep_updated(&self, id: &str, f: impl FnOnce(&mut Value)) {
        self.write_sidecar_inner(id, false, f)
    }

    fn write_sidecar_inner(&self, id: &str, touch: bool, f: impl FnOnce(&mut Value)) {
        let _write = self.sess.sidecar_write.lock_ok();
        // 非法 id 到这里就停:再往下是 atomic_write_private,它会 create_dir_all
        // 出父目录,等于任意目录写 meta.json
        let Some(path) = self.sidecar_path(id) else {
            eprintln!("[desktop] 拒绝为非法会话 id 写 sidecar: {id:?}");
            return;
        };
        let mut meta = self.read_sidecar(id);
        f(&mut meta);
        if touch {
            meta["updated_at"] = json!(frame::now_ms());
        }
        let data = match serde_json::to_vec_pretty(&meta) {
            Ok(data) => data,
            Err(e) => {
                eprintln!("[desktop] 序列化会话 sidecar {id} 失败: {e}");
                return;
            }
        };
        // Windows 的 std::fs::rename 不能可靠覆盖已有目标，共用配置层的
        // 跨平台原子替换原语。
        if let Err(e) = crate::config::atomic_write_private(&path, &data) {
            eprintln!("[desktop] 写入会话 sidecar {id} 失败: {e}");
        }
    }

    /// 追加一帧:编 seq → 投递写线程落盘 → (opened 时)入批量缓冲。
    /// 编号、通道投递、入缓冲全程在 sessions 锁内完成:同一会话的帧在
    /// journal 通道与 batch 里的顺序即 seq 顺序,落盘/emit 异步化不会
    /// 乱序(旧实现在放锁后写盘,两线程并发 push 本就可能倒序落盘)。
    /// 热路径(model_delta 每 token 一帧)自此无任何磁盘 I/O。
    /// 锁序:sessions → batch(flush_batch 只拿 batch,无反向嵌套)。
    pub(super) fn push_frame(&self, sid: &str, build: impl FnOnce(u64) -> Value) {
        let mut sessions = self.sess.sessions.lock_ok();
        let Some(s) = sessions.get_mut(sid) else { return };
        s.seq += 1;
        let f = build(s.seq);
        let _ = self
            .transport.journal_tx
            .send(JournalMsg::Append { sid: sid.to_string(), line: f.to_string() });
        // 折叠累积与物化跟着帧走:轮末(task-ended,契约 5 的和解点——正常
        // 结束、出错、本地和解都经它)把这一轮折叠成 replay.jsonl 的一行。
        // 与 Append 同在通道内顺序投递,写线程据此取到准确的 events 偏移。
        s.fold.push(&f);
        if fold::is_turn_end(&f) {
            let turn = s.fold.take();
            if !turn.frames.is_empty() {
                let _ = self.transport.journal_tx.send(JournalMsg::Materialize {
                    sid: sid.to_string(),
                    turn,
                    src_end: None,
                });
            }
        }
        if s.opened {
            self.sess.batch.lock_ok().entry(sid.to_string()).or_default().push(f);
        }
    }

    /// 把 events.jsonl 中 `from` 之后的完整轮折叠物化进 replay.jsonl。
    /// 老会话首次打开(无 replay.jsonl,from = 0)即一次性迁移;进程崩溃
    /// 残留的完整轮即补录。流式单遍,不把整份日志读进内存——23MB 的
    /// 病态 journal 也只占一行的内存。返回是否写入过内容。
    fn catch_up(&self, sid: &str, events: &Path, from: u64) -> bool {
        use std::io::{BufRead as _, BufReader, Seek as _, SeekFrom};
        let Ok(mut f) = std::fs::File::open(events) else { return false };
        if f.seek(SeekFrom::Start(from)).is_err() {
            return false;
        }
        let mut r = BufReader::new(f);
        let mut acc = TurnFold::default();
        let mut off = from;
        let mut wrote = false;
        let mut line = String::new();
        loop {
            line.clear();
            match r.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    // 半行(并发追加下可能读到)留给下次,绝不按残行切轮
                    if !line.ends_with('\n') {
                        break;
                    }
                    off += n as u64;
                    let Ok(v) = serde_json::from_str::<Value>(line.trim_end()) else { continue };
                    let end = fold::is_turn_end(&v);
                    acc.push(&v);
                    if end {
                        let _ = self.transport.journal_tx.send(JournalMsg::Materialize {
                            sid: sid.to_string(),
                            turn: acc.take(),
                            src_end: Some(off),
                        });
                        wrote = true;
                    }
                }
            }
        }
        // 末尾未闭合的一段也物化:补录只在会话空闲时做,它不会再有新帧,
        // 留着只会每次打开重折一遍
        if !acc.is_empty() {
            let _ = self.transport.journal_tx.send(JournalMsg::Materialize {
                sid: sid.to_string(),
                turn: acc.take(),
                src_end: Some(off),
            });
            wrote = true;
        }
        wrote
    }

    /// 回放打开(阻塞线程调用):返回**尾部窗口**并置 opened=true 接实时流。
    ///
    /// 窗口 = replay.jsonl 的最近若干轮(折叠后,见 fold.rs)+ events.jsonl
    /// 里尚未物化的尾巴。更早的历史由 session_history 按 cursor 往前翻——
    /// 打开成本自此与会话总长度无关,只与窗口大小有关。
    ///
    /// 旧实现的缺口:opened=false 期间到达的帧只入日志不入缓冲,读完日志
    /// 才置 opened=true——窗口内已落盘的帧既不在回放结果也不进 batch,
    /// UI 要重开会话才能看到。现分两段消除缺口:
    /// 1)flush 屏障后锁外整读日志主体(大文件不卡事件流);
    /// 2)**持 sessions 锁**再发一次屏障并补读尾部:seq 编号与通道投递
    ///    在同一把 sessions 锁内(push_frame),持锁期间不可能再编新帧,
    ///    而此前编号的帧必已入队、屏障后必已落盘——补读完成即"文件覆盖
    ///    所有已编号帧",随后 opened=true,之后的新帧全部进 batch,
    ///    回放与实时流按 seq 无缝衔接、无重复。
    /// 死锁安全:写线程只碰文件系统,不拿 sessions 锁;锁内屏障只等
    /// 窗口内的少量尾帧,阻塞极短。
    pub(super) fn replay_open(&self, sid: &str) -> ReplayWindow {
        if let Some(s) = self.sess.sessions.lock_ok().get_mut(sid) {
            s.opened = false;
        }
        // 清批量缓冲:其中的帧已在日志里,会随回放送达,留着会重帧
        self.sess.batch.lock_ok().remove(sid);
        // 非法 id 给空窗口:调用方(session_open)已在入口挡过,这里是纵深
        let Some(dir) = self.session_dir(sid) else {
            return ReplayWindow { frames: Vec::new(), cursor: 0, has_more: false };
        };
        let (replay, events) = (dir.join("replay.jsonl"), dir.join("events.jsonl"));

        self.journal_barrier();
        // 补录/迁移只在会话空闲且本进程没有累积中的轮次时做:那时 events.jsonl
        // 里 src_end 之后的完整轮必然来自更早的进程,不可能与实时物化撞车
        let idle = self
            .sess
            .sessions
            .lock_ok()
            .get(sid)
            .map(|s| s.fold.is_empty() && !s.running)
            .unwrap_or(true);
        if idle {
            let (last, _) = fold::read_before(&replay, u64::MAX, 1);
            let from = last.last().map(|t| t.src_end).unwrap_or(0);
            if self.catch_up(sid, &events, from) {
                self.journal_barrier(); // 等补录落盘再取窗口
            }
        }

        let (turns, has_more) = fold::read_tail(&replay);
        let cursor = turns.first().map(|t| t.offset).unwrap_or(0);
        let src_end = turns.last().map(|t| t.src_end).unwrap_or(0);
        let mut high = turns.last().map(|t| t.to).unwrap_or(0);
        let mut frames: Vec<Value> = turns.into_iter().flat_map(|t| t.frames).collect();

        // 未物化的尾巴(通常是当前未闭合轮;补录跳过时是全部原始帧)
        let mut pos = src_end;
        let mut raw: Vec<Value> = Vec::new();
        read_journal_tail(&events, &mut pos, &mut raw);
        let mut sessions = self.sess.sessions.lock_ok();
        if let Some(s) = sessions.get_mut(sid) {
            self.journal_barrier();
            read_journal_tail(&events, &mut pos, &mut raw);
            s.opened = true;
            // seq 取 max 防序号回卷(引擎侧回放/历史日志行数与内存编号对齐)
            high = high.max(
                raw.iter().filter_map(|f| f.get("seq").and_then(|v| v.as_u64())).max().unwrap_or(0),
            );
            if src_end == 0 {
                // 无物化记录时 raw 即整份日志,行数是极老 journal(可能缺 seq)
                // 的兜底水位
                high = high.max(raw.len() as u64);
            }
            s.seq = s.seq.max(high);
        }
        drop(sessions);
        frames.extend(fold::fold_frames(&raw));
        if idle && fold::unterminated(&frames) {
            frames.extend(self.repair_unterminated(sid));
        }
        ReplayWindow { frames, cursor, has_more }
    }

    /// 冷修复:进程被硬杀(kill -9 / OOM / 断电 / 系统强制重启)时 journal 就
    /// 停在未闭合的轮次上,而热路径的 reconcile_* 全部以**内存** running 为
    /// 前提(`Some(s) if s.running`),重启后恒 false、一律空转——没有任何
    /// 现存路径补得了这个尾巴。
    ///
    /// 不修的后果不是"少一条收尾":UI 的运行态只由帧推导(reduce.ts 的
    /// task-started → running=true),所以每次打开都按执行中渲染,输入框只排队、
    /// 删除/切模型全灰,取消按钮打到壳里也因为 running=false 而空转——**永不解锁**,
    /// 重装应用都救不回(数据在 sidecar 目录里)。
    ///
    /// 补的两帧直接返回给本次回放窗口,**不入批量缓冲**:窗口是 session_open
    /// 的返回值,再经 frames:{sid} 投一次会让 UI 重复归约出两条收尾。
    fn repair_unterminated(&self, sid: &str) -> Vec<Value> {
        let (err, end) = {
            let mut sessions = self.sess.sessions.lock_ok();
            let Some(s) = sessions.get_mut(sid) else { return Vec::new() };
            s.seq += 1;
            let err = frame::task_error(COLD_REPAIR_REASON, s.seq);
            s.seq += 1;
            let end = frame::task_ended(s.seq);
            for f in [&err, &end] {
                let _ = self.transport.journal_tx.send(JournalMsg::Append {
                    sid: sid.to_string(),
                    line: f.to_string(),
                });
                s.fold.push(f);
            }
            // 冷修复只在 idle 分支触发(fold 必空),take 出来的就是这两帧,
            // 单独物化成一行;被补的那一轮已由 catch_up 物化在前一行
            let turn = s.fold.take();
            if !turn.frames.is_empty() {
                let _ = self.transport.journal_tx.send(JournalMsg::Materialize {
                    sid: sid.to_string(),
                    turn,
                    src_end: None,
                });
            }
            (err, end)
        };
        // sidecar 落终态:侧栏(读 sidecar)与聊天区(读帧)此前会一个显示
        // "已中断"、一个显示"运行中",两个来源就此对齐
        self.write_sidecar(sid, |m| m["status"] = json!(SessionStatus::Interrupted.as_str()));
        eprintln!("[desktop] 冷修复未闭合轮次: sid={sid}");
        vec![err, end]
    }

    pub(super) fn emit_session_event(&self, sid: &str, status: &str) {
        let title = self.sess.sessions.lock_ok().get(sid).map(|s| s.title.clone()).unwrap_or_default();
        self.app.emit_json(
            "session-event",
            json!({ "type": "session-status", "id": sid, "status": status, "title": title }),
        );
    }

    /// 会话摘要更新(引擎每轮异步生成,见 normalize.rs 的 session_summary 分支)。
    /// 单独一个事件类型而不是复用 session-status:后者在 UI 侧会经
    /// noticeForSessionEvent 变成一条「已回复/已完成」提示,而摘要恰好在轮次
    /// 收尾之后才到——复用等于每轮多弹一次重复提示。
    pub(super) fn emit_session_summary(&self, sid: &str, summary: &str) {
        let title = self.sess.sessions.lock_ok().get(sid).map(|s| s.title.clone()).unwrap_or_default();
        self.app.emit_json(
            "session-event",
            json!({ "type": "session-summary", "id": sid, "title": title, "summary": summary }),
        );
    }

    /// 该会话最近一次模型调用的 token 用量(session-event 事件,不落帧):
    /// UI 实时把用量补到当前回合的助手消息与大纲条目上(帧管线里 usage 事件
    /// 晚于流式帧,实时路径走这里;回放路径靠 attach_usage 挂在帧上)。
    pub(super) fn emit_session_usage(&self, sid: &str, input: u64, output: u64) {
        let title = self.sess.sessions.lock_ok().get(sid).map(|s| s.title.clone()).unwrap_or_default();
        self.app.emit_json(
            "session-event",
            json!({ "type": "session-usage", "id": sid, "title": title, "input": input, "output": output }),
        );
    }

    pub(super) fn emit_session_ask(&self, sid: &str, open: bool) {
        let title = self.sess.sessions.lock_ok().get(sid).map(|s| s.title.clone()).unwrap_or_default();
        self.app.emit_json(
            "session-event",
            json!({ "type": "session-ask", "id": sid, "title": title, "open": open }),
        );
    }

    pub(super) fn resolve_perm(&self, sid: &str, req_id: &str, outcome: PermOutcome) {
        self.sess.pending_perms.lock_ok().remove(req_id);
        self.push_frame(sid, |seq| frame::permission_resolved(req_id, outcome, seq));
        self.emit_session_ask(sid, false);
    }

    /// 排空批量缓冲(flusher 周期调用;stop 前同步调用,保证收尾帧送达)。
    pub(super) fn flush_batch(&self) {
        let drained: Vec<(String, Vec<Value>)> = {
            let mut b = self.sess.batch.lock_ok();
            b.drain().collect()
        };
        for (sid, frames) in drained {
            if !frames.is_empty() {
                self.app.emit_json(&format!("frames:{sid}"), Value::Array(frames));
            }
        }
    }

    /// 引擎不再服务(停止/崩溃/取消无应答)时的本地和解——引擎应答是确认
    /// 而非前提。运行中会话补收尾帧(未闭合工具 failed → task-error →
    /// task-ended),sidecar 落 interrupted;不和解会永久卡"执行中"
    /// (不能发/不能删/不能切,重启也救不回)。
    pub(super) fn reconcile_session(&self, sid: &str, reason: &str) {
        let open = {
            let mut sessions = self.sess.sessions.lock_ok();
            match sessions.get_mut(sid) {
                Some(s) if s.running => {
                    s.running = false;
                    s.model_text.clear();
                    std::mem::take(&mut s.open_tools)
                }
                _ => return,
            }
        };
        // 未闭合工具的 agent_result 暂存一并失效(与 turn/stopped 同纪律)
        if !open.is_empty() {
            let mut ar = self.sub.agent_results.lock_ok();
            for tc in open.keys() {
                ar.remove(tc);
            }
        }
        // 引擎不再服务:后台代理连同子循环一起没了,一并收尾(含后台登记)
        self.close_children_of_session(sid, SessionStatus::Interrupted, true);
        for (tc, _name) in open {
            self.push_frame(sid, |seq| frame::tool_call_failed(&tc, "已中断", seq));
        }
        self.push_frame(sid, |seq| frame::task_error(reason, seq));
        self.push_frame(sid, frame::task_ended);
        self.write_sidecar(sid, |m| m["status"] = json!(SessionStatus::Interrupted.as_str()));
        self.emit_session_event(sid, SessionStatus::Interrupted.as_str());
    }

    pub(super) fn reconcile_all(&self, reason: &str) {
        // 挂起审批/提问随引擎一起失效(resolved 帧先于 task-ended 落日志)
        let perms: Vec<(String, String)> =
            self.sess.pending_perms.lock_ok().iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        for (req_id, sid) in perms {
            self.sess.perm_tools.lock_ok().remove(&req_id);
            self.resolve_perm(&sid, &req_id, PermOutcome::Cancelled);
        }
        let questions: Vec<(String, String)> = self
            .sess.pending_questions
            .lock_ok()
            .iter()
            .map(|(k, (s, _))| (k.clone(), s.clone()))
            .collect();
        for (req_id, sid) in questions {
            self.sess.pending_questions.lock_ok().remove(&req_id);
            self.emit_session_ask(&sid, false);
        }
        // 子会话跳过:由各自父会话的和解统一收尾(close_children_of_session)
        let ids: Vec<String> = {
            let subs = self.sub.subagents.lock_ok();
            self.sess.sessions.lock_ok().keys().filter(|id| !subs.contains_key(*id)).cloned().collect()
        };
        for id in ids {
            self.reconcile_session(&id, reason);
        }
    }

    /// 上下文占用 → usage 帧。新引擎在模型调用 usage 到达、压缩/清空后
    /// 经 event/stream usage 实时报告，turn/stopped 再给轮后权威快照；
    /// session/create 的同名字段让 resume 后立即显示。used 是当前 Agent
    /// 历史 + system prompt 的估算，不是含子代理的本轮累计 token。
    pub(super) fn push_usage(&self, sid: &str, used: i64, window: i64) {
        if used < 0 || window <= 0 {
            return;
        }
        let next = (used, window);
        let changed = {
            let mut sessions = self.sess.sessions.lock_ok();
            let Some(s) = sessions.get_mut(sid) else { return };
            if s.context_usage == Some(next) {
                false
            } else {
                s.context_usage = Some(next);
                true
            }
        };
        if changed {
            self.push_frame(sid, |seq| frame::usage_update(used, window, seq));
        }
    }

    /// 入站事件的壳会话反查(引擎 session_id → 壳 sid)。通常同名;
    /// 空会话重建换绑后不同。未命中原样返回(供子代理未知 id 认领)。
    pub(super) fn shell_sid_of(&self, engine: &str) -> String {
        self.sess.sessions
            .lock_ok()
            .iter()
            .find(|(_, s)| s.engine_id == engine)
            .map(|(sid, _)| sid.clone())
            .unwrap_or_else(|| engine.to_string())
    }
}

/// 壳模式词汇 → ohmyagent permission_mode
/// meta/sidecar 的 skills 字段 → 启用集(非数组/缺失 = None = 缺省集,
/// 语义见 skills::materialize)。
fn skills_of_meta(meta: &Value) -> Option<Vec<String>> {
    meta.get("skills")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
}

fn ohmy_mode_of(mode: &str) -> &'static str {
    match mode {
        "yolo" => "bypassPermissions",
        // 历史 sidecar 里可能存着显式 normal。**不能原样转发**:引擎
        // permission.ParseMode 只接受 default/plan/auto/bypassPermissions/yolo,
        // "normal" 只是个未被 ParseMode 收录的遗留别名常量,发过去会得到
        // `unknown permission mode "normal"` —— session/create 失败,
        // 那批老会话直接打不开(此前的映射把这个 bug 钉在了测试里)。
        //
        // 落到 default(逐操作询问)而不是今天的默认 auto:老 normal 的语义是
        // "写操作要问",auto 由分类器裁决、可能自动放行写操作。权限是安全
        // 边界,宁可多问几次,不可替用户悄悄放宽既存意图。
        "normal" => "default",
        // UI 的默认模式使用 auto,由 agent 分类器决定放行、拒绝或询问。
        _ => "auto",
    }
}

/// 构造引擎 session/create 参数。cwd 是逐会话状态，即使 resume 也必须
/// 显式发送；否则引擎会回退到 Desktop 启动它时的进程 cwd。
fn engine_session_create_params(
    cwd: &str,
    resume: Option<&str>,
    model_id: Option<&str>,
    mode: &str,
) -> Value {
    let mut params = json!({
        "cwd": cwd,
        "permission_mode": ohmy_mode_of(mode),
        "interactive": true,
    });
    if let Some(resume) = resume {
        params["resume"] = json!(resume);
    }
    if let Some(model_id) = model_id {
        params["model"] = json!(model_id);
    }
    params
}

#[cfg(test)]
mod permission_mode_tests {
    use super::{engine_session_create_params, ohmy_mode_of};

    /// 映射结果必须全部落在引擎 permission.ParseMode 的受理集合内
    /// (default/plan/auto/bypassPermissions/yolo)。历史遗留的 "normal"
    /// 不在其中:原样转发会让老 sidecar 的会话开不起来。
    #[test]
    fn shell_modes_map_to_agent_permission_modes() {
        const ENGINE_ACCEPTED: [&str; 5] =
            ["default", "plan", "auto", "bypassPermissions", "yolo"];

        assert_eq!(ohmy_mode_of("default"), "auto");
        assert_eq!(ohmy_mode_of("yolo"), "bypassPermissions");
        // 遗留别名退到 default(更严),不退到 auto(分类器可能自动放行写操作)
        assert_eq!(ohmy_mode_of("normal"), "default");

        for stored in ["default", "yolo", "normal", "", "plan", "什么鬼"] {
            let mapped = ohmy_mode_of(stored);
            assert!(
                ENGINE_ACCEPTED.contains(&mapped),
                "sidecar 里的 {stored:?} 映射出引擎不受理的 {mapped:?}",
            );
        }
    }

    #[test]
    fn session_create_params_keep_cwd_when_resuming() {
        let params = engine_session_create_params(
            "/workspace/project",
            Some("session-1"),
            Some("model-1"),
            "default",
        );

        assert_eq!(params["cwd"], "/workspace/project");
        assert_eq!(params["resume"], "session-1");
        assert_eq!(params["model"], "model-1");
        assert_eq!(params["permission_mode"], "auto");
        assert_eq!(params["interactive"], true);
    }
}
