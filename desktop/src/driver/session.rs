// 会话层:会话 CRUD、sidecar 元数据与帧管线(ohmy.rs 拆出)。
//
// 职责:会话列表/建删改查(sidecar 目录是桌面版权威索引)、打开时的
// journal 回放(replay_open 无缺口衔接实时流)、对话上行
// (session_send/session_call)、resume/重建(engine_id 换绑)、
// push_frame 帧管线(编 seq → 落盘 → 批量缓冲)与本地和解
// (reconcile_*)。共享状态定义见 ohmy.rs::Inner。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};

use base64::Engine as _;
use serde_json::{json, Value};

use super::frame::{self, PermOutcome, SessionStatus};
use super::ohmy::{Inner, OhmyDriver};
use super::transport::JournalMsg;
use crate::util::LockExt;

const CHAT_WORKSPACE_PREFIX: &str = "chat-";

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
                    "workdir": meta.get("workdir").and_then(|v| v.as_str()).unwrap_or(""),
                    "kind": meta.get("kind").and_then(|v| v.as_str()).unwrap_or("local"),
                    "model": meta.get("model_name").and_then(|v| v.as_str()).unwrap_or(""),
                    "mode": meta.get("mode").and_then(|v| v.as_str()).unwrap_or("default"),
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
        self.session_create_with_kind(workdir, model_name, create_dir, "local").await
    }

    pub async fn session_create_with_kind(
        &self,
        workdir: &str,
        model_name: &str,
        create_dir: bool,
        kind: &str,
    ) -> Result<Value, String> {
        let model_id = self.model_id_of(model_name)?;
        // 普通对话的 cwd 由壳生成，调用方传入值一律不采用；本地项目仍按
        // 用户选择展开 ~、按需创建或前置校验。
        let chat_workdir = if kind == "chat" {
            Some(create_chat_workdir_in(&self.0.chat_workspaces_dir)?)
        } else {
            None
        };
        let workdir_owned = chat_workdir
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|| crate::config::expand_tilde(workdir));
        let workdir = workdir_owned.as_str();
        let exists = std::path::Path::new(workdir).is_dir();
        if !exists {
            if create_dir {
                std::fs::create_dir_all(workdir).map_err(|e| format!("创建工作区目录失败: {e}"))?;
            } else {
                return Err(format!("工作区目录不存在: {workdir}"));
            }
        }
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
        let sid = match result.get("session_id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => {
                if let Some(path) = &chat_workdir {
                    let _ = std::fs::remove_dir_all(path);
                }
                return Err("session/create 未返回 session_id".into());
            }
        };
        self.0.sess.sessions.lock_ok().insert(
            sid.clone(),
            SessionState {
                seq: 0,
                running: false,
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
            },
        );
        // 契约 5:新建未运行的会话是 created,不是 finished(否则侧栏打勾、桌宠庆祝)
        self.write_sidecar(&sid, |m| {
            m["model_name"] = json!(model_name);
            m["workdir"] = json!(workdir);
            m["kind"] = json!(kind);
            m["status"] = json!(SessionStatus::Created.as_str());
        });
        Ok(json!({
            "id": sid, "title": "", "workdir": workdir, "model": model_name,
            "kind": kind, "mode": "default", "turns": 0,
            "status": SessionStatus::Created.as_str(),
        }))
    }

    pub async fn session_open(&self, id: &str) -> Result<(), String> {
        // 幂等:确保 resume + 标记 opened + 回放日志
        let need_create = {
            let sessions = self.0.sess.sessions.lock_ok();
            !sessions.get(id).map(|s| s.created).unwrap_or(false)
        };
        let mut resume_ctx: Option<(i64, i64)> = None;
        if need_create {
            let meta = self.read_sidecar(id);
            let is_child =
                meta.get("parent").and_then(|v| v.as_str()).map(|p| !p.is_empty()).unwrap_or(false);
            let mut engine_id = meta
                .get("engine_id")
                .and_then(|v| v.as_str())
                .filter(|e| !e.is_empty())
                .unwrap_or(id)
                .to_string();
            if !is_child {
                // 有历史则 resume 带全参(缺参会回落进程默认值);空会话
                // resume 必失败,改全新 create 换绑 engine_id(壳 sid 不变)。
                // 模型已从配置移除时不带 model,退化引擎默认(不阻断打开)
                let mode = meta.get("mode").and_then(|v| v.as_str()).unwrap_or("default");
                let has_history = self.engine_session_exists(&engine_id).await;
                let mut workdir = meta.get("workdir").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if workdir.is_empty() {
                    // 兼容没有 workdir 的旧 sidecar；不能留空让引擎隐式继承
                    // Desktop 引擎进程 cwd，否则 resume 后会话会漂到进程目录。
                    workdir = crate::config::home_dir()
                        .map(|h| h.to_string_lossy().into_owned())
                        .unwrap_or_default();
                }
                let mut params = engine_session_create_params(
                    &workdir,
                    has_history.then_some(engine_id.as_str()),
                    None,
                    mode,
                );
                let model_name = meta.get("model_name").and_then(|v| v.as_str()).unwrap_or("");
                if let Ok(model_id) = self.model_id_of(model_name) {
                    params["model"] = json!(model_id);
                }
                let result = self.rpc("session/create", params).await?;
                if let Some(e) = result.get("session_id").and_then(|v| v.as_str()) {
                    engine_id = e.to_string();
                }
                if engine_id != id {
                    let e = engine_id.clone();
                    self.write_sidecar(id, |m| m["engine_id"] = json!(e));
                }
                // resume 结果带恢复历史的占用估计,立即可显示(296176a)
                resume_ctx = Some((
                    result.get("context_used").and_then(|v| v.as_i64()).unwrap_or(0),
                    result.get("context_window").and_then(|v| v.as_i64()).unwrap_or(0),
                ));
            }
            // 子代理子会话是壳侧实体(仅回放),登记但不向引擎 resume
            let mut sessions = self.0.sess.sessions.lock_ok();
            let entry = sessions.entry(id.to_string()).or_insert(SessionState {
                seq: 0,
                running: false,
                created: true,
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
            });
            entry.created = true;
            entry.engine_id = engine_id.clone();
            drop(sessions);
            if let Some((used, window)) = resume_ctx.take() {
                self.0.push_usage(id, used, window);
            }
        }
        // 回放日志(重开页面/重连:整份重放)。磁盘读与 flush 屏障都在
        // 阻塞线程上做(replay_open),不占 tokio 运行时;无缺口保证见
        // replay_open 注释。
        let journal = {
            let inner = self.0.clone();
            let sid = id.to_string();
            tokio::task::spawn_blocking(move || inner.replay_open(&sid))
                .await
                .map_err(|e| format!("回放任务失败: {e}"))?
        };
        self.0.app.emit_json(&format!("conn-status:{id}"), json!({ "text": "已连接", "connected": true }));
        if !journal.is_empty() {
            self.0.app.emit_json(&format!("frames:{id}"), Value::Array(journal));
        }
        Ok(())
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
                    .and_then(|path| managed_chat_workdir(&self.0.chat_workspaces_dir, path))
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
                let _ = std::fs::remove_dir_all(inner.data_dir.join(&cid));
            }
            inner.journal_close(id, true);
            // 删 ohmyagent 会话目录(messages.jsonl,目录名是引擎 id)+ 壳 sidecar(含帧日志)
            {
                let root = inner.engine_dir.join("sessions");
                let _ = std::fs::remove_dir_all(root.join(&eng));
            }
            let _ = std::fs::remove_dir_all(inner.data_dir.join(id));
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

    pub async fn session_patch(&self, id: &str, patch: Value) -> Result<Value, String> {
        self.write_sidecar(id, |m| {
            if let Some(t) = patch.get("title").and_then(|v| v.as_str()) {
                // 按字符截断:String::truncate 是字节索引,中文标题在非字符
                // 边界截断会 panic
                let t: String = t.trim().chars().take(80).collect();
                m["title"] = json!(t);
            }
            if let Some(a) = patch.get("archived").and_then(|v| v.as_bool()) {
                m["archived"] = json!(a);
            }
        });
        if let Some(t) = patch.get("title").and_then(|v| v.as_str()) {
            if let Some(s) = self.0.sess.sessions.lock_ok().get_mut(id) {
                s.title = t.to_string();
            }
        }
        Ok(json!({ "ok": true }))
    }

    pub async fn models_list(&self) -> Result<Value, String> {
        Ok(Value::Array(
            self.0
                .models
                .iter()
                .map(|m| json!({ "name": m.name, "default": m.default, "source": m.source }))
                .collect(),
        ))
    }

    pub async fn session_workdir(&self, id: &str) -> Result<String, String> {
        if let Some(s) = self.0.sess.sessions.lock_ok().get(id) {
            if !s.workdir.is_empty() {
                return Ok(s.workdir.clone());
            }
        }
        let meta = self.read_sidecar(id);
        meta.get("workdir")
            .and_then(|v| v.as_str())
            .filter(|w| !w.is_empty())
            .map(str::to_string)
            .ok_or_else(|| format!("会话 {id} 不存在"))
    }

    // ==================== 对话 ====================

    pub async fn session_send(&self, id: &str, ftype: &str, payload: Value) -> Result<(), String> {
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
                        // 引擎没接活:补终止帧关轮,状态回落,错误上抛(UI 保留输入)
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
                        Err(e)
                    }
                }
            }
            "user-cancel" => {
                // 引擎应答是确认而非前提:cancel 无应答(挂死/超时)时本地和解,
                // 否则会话永卡 running;引擎若事后仍发 turn/stopped,
                // 幂等守卫(was_running)会吞掉迟到的收尾
                if let Err(e) = self.rpc("cancel", json!({ "session_id": self.engine_id(id) })).await {
                    self.0.reconcile_session(id, &format!("取消未获引擎应答,已本地中断({e})"));
                }
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

    pub async fn session_call(&self, id: &str, kind: &str, payload: Value) -> Result<Value, String> {
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
                self.push_frame(id, |seq| frame::model_update(name, seq));
                Ok(json!({ "result": { "model": name } }))
            }
            "session_set_mode" => {
                // 权限模式切换:运行中也可热切(上游子代理评估器已实时继承
                // 父模式,969311a 起热切对后续子代理同样生效)。
                let mode = payload.get("mode").and_then(|v| v.as_str()).unwrap_or("default");
                if !self.session_created(id) {
                    let model_id = self.model_id_of(&self.session_model_name(id))?;
                    self.create_resumed(id, &model_id, mode).await?;
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
                    let model_id = self.model_id_of(&self.session_model_name(id))?;
                    self.recreate_fallback(id, &model_id, mode).await?;
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
            // 空 workdir 会触发引擎的 os.Getwd 兜底(进程 cwd),显式回退主目录
            workdir = crate::config::home_dir()
                .map(|h| h.to_string_lossy().into_owned())
                .unwrap_or_default();
        }
        let params = engine_session_create_params(
            &workdir,
            has_history.then_some(eng.as_str()),
            Some(model_id),
            mode,
        );
        let result = self.rpc("session/create", params).await?;
        let new_eng =
            result.get("session_id").and_then(|v| v.as_str()).unwrap_or(&eng).to_string();
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
        self.0.engine_dir.join("sessions").join(eng).join("messages.jsonl").is_file()
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

    /// 模型选择键:e792858 起 settings.models 按**别名**作键,引擎双解析
    /// (别名优先,wire id 回退)——但同 wire id 多网关会撞 wireIndex,
    /// 壳一律传别名。
    fn model_id_of(&self, name: &str) -> Result<String, String> {
        if name.is_empty() {
            return self
                .0
                .models
                .iter()
                .find(|m| m.default)
                .or(self.0.models.first())
                .map(|m| m.name.clone())
                .ok_or_else(|| "尚未配置模型,请先在设置中添加".into());
        }
        self.0
            .models
            .iter()
            .find(|m| m.name == name)
            .map(|m| m.name.clone())
            .ok_or_else(|| format!("未知模型 {name:?}"))
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
    fn sidecar_path(&self, id: &str) -> PathBuf {
        self.data_dir.join(id).join("meta.json")
    }

    pub(super) fn read_sidecar(&self, id: &str) -> Value {
        std::fs::read(self.sidecar_path(id))
            .ok()
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
        let _write = self.sess.sidecar_write.lock_ok();
        let mut meta = self.read_sidecar(id);
        f(&mut meta);
        meta["updated_at"] = json!(frame::now_ms());
        let path = self.sidecar_path(id);
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
        if s.opened {
            self.sess.batch.lock_ok().entry(sid.to_string()).or_default().push(f);
        }
    }

    /// 回放打开(阻塞线程调用):返回完整回放帧并置 opened=true 接实时流。
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
    pub(super) fn replay_open(&self, sid: &str) -> Vec<Value> {
        if let Some(s) = self.sess.sessions.lock_ok().get_mut(sid) {
            s.opened = false;
        }
        // 清批量缓冲:其中的帧已在日志里,会随回放送达,留着会重帧
        self.sess.batch.lock_ok().remove(sid);
        let path = self.data_dir.join(sid).join("events.jsonl");
        let mut frames: Vec<Value> = Vec::new();
        let mut pos: u64 = 0;
        self.journal_barrier();
        read_journal_tail(&path, &mut pos, &mut frames);
        let mut sessions = self.sess.sessions.lock_ok();
        if let Some(s) = sessions.get_mut(sid) {
            self.journal_barrier();
            read_journal_tail(&path, &mut pos, &mut frames);
            s.opened = true;
            // seq 取 max 防序号回卷(引擎侧回放/历史日志行数与内存编号对齐)
            let replay_high = frames
                .iter()
                .filter_map(|f| f.get("seq").and_then(|v| v.as_u64()))
                .max()
                .unwrap_or(0)
                .max(frames.len() as u64);
            s.seq = s.seq.max(replay_high);
        }
        frames
    }

    pub(super) fn emit_session_event(&self, sid: &str, status: &str) {
        let title = self.sess.sessions.lock_ok().get(sid).map(|s| s.title.clone()).unwrap_or_default();
        self.app.emit_json(
            "session-event",
            json!({ "type": "session-status", "id": sid, "status": status, "title": title }),
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
