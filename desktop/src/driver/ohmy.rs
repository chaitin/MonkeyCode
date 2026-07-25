// OhmyAgentDriver:拉起 ohmyagent --stdio(行分隔 JSON-RPC)并把其事件
// 归一化为 Frame 词汇(frame.rs),UI 归约层零改动。
//
// 关键设计:
// - ohmyagent 无帧日志 → driver 自记 events.jsonl(<app_config>/ohmy-sessions/
//   <sid>/),打开会话时回放,与实时渲染同一词汇
// - 无会话中途切模型/权限模式协议 → 空闲时 destroy + create{resume, …} 变通
// - 审批记忆归引擎(permissionRemember cap):respond 带 remember,引擎按
//   命令段粒度持久化为项目级规则;旧引擎兼容尾巴保留壳侧工具名记忆集
// - 会话元数据(标题/归档)ohmyagent 不管 → sidecar meta.json
//
// 本文件是门面与装配:ShellCtx 依赖界面、OhmyDriver 句柄与共享状态
// Inner。实现按职责拆在同级模块(driver/mod.rs 装配):
// - transport.rs 进程生命周期 + JSON-RPC 通道 + journal 写线程
// - session.rs   会话 CRUD/sidecar/回放/帧管线/本地和解
// - normalize.rs 引擎事件 → Frame 归一化(通知路由 + 对账)
// - subagent.rs  子代理认领/预览/关闭
// - ohmy_tests.rs 测试(经下方 #[path] 挂为 tests 子模块)

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter};

use super::session::SessionsState;
use super::subagent::SubagentState;
use super::transport::TransportState;
use crate::util::LockExt;

/// driver 对壳的最小依赖(事件发射 + 配置目录),经 trait 解耦以便
/// 测试注入替身(tauri MockRuntime 与 Wry 的 AppHandle 泛型不互通)。
pub trait ShellCtx: Send + Sync + 'static {
    fn emit_json(&self, event: &str, payload: Value);
    fn config_dir(&self) -> Result<PathBuf, String>;
    fn local_data_dir(&self) -> Result<PathBuf, String>;

    /// 引擎进程的 home/cwd 与额外环境。生产默认跟随当前用户；测试替身可
    /// 逐子进程注入隔离目录，禁止通过 set_var 污染并行测试进程。
    fn process_home(&self) -> Option<PathBuf> { crate::config::home_dir() }
    fn engine_env_overrides(&self) -> Vec<(String, OsString)> { Vec::new() }
}

impl ShellCtx for AppHandle {
    fn emit_json(&self, event: &str, payload: Value) {
        // 全局事件(session-event)广播给所有窗口;帧/状态事件仅 main 在听,
        // emit 全局同样可达且省一次 label 匹配失败的分支
        let _ = self.emit(event, payload);
    }
    fn config_dir(&self) -> Result<PathBuf, String> {
        crate::config::config_dir(self)
    }
    fn local_data_dir(&self) -> Result<PathBuf, String> {
        crate::config::local_data_dir(self)
    }
}

#[derive(Clone)]
pub struct OhmyDriver(pub(super) Arc<Inner>);

impl OhmyDriver {
    /// system/ready 的增量能力是引擎/壳协商的唯一事实来源。
    pub fn has_capability(&self, capability: &str) -> bool { self.0.has_cap(capability) }

    /// system/ready 宣告的内核版本；发布产物为 Agent commit hash。
    pub fn version(&self) -> String { self.0.transport.engine_version.lock_ok().clone() }
}

/// 驱动共享状态。锁字段按职责归为三个锁组(各组文档注释写明含哪些锁
/// 与允许的嵌套秩序;跨组嵌套仅 subagents → sessions 一条,见
/// subagent.rs::SubagentState):
pub(super) struct Inner {
    pub(super) app: Arc<dyn ShellCtx>,
    /// 传输态锁组(进程/RPC 通道;字段与锁序见 transport.rs::TransportState)
    pub(super) transport: TransportState,
    /// 会话态锁组(会话表/帧缓冲/审批提问簿记;见 session.rs::SessionsState)
    pub(super) sess: SessionsState,
    /// 子代理态锁组(路由/暂存;见 subagent.rs::SubagentState)
    pub(super) sub: SubagentState,
    /// 壳清单模型(name → ohmy 模型 id 映射 + 列表展示)
    pub(super) models: Vec<ManifestModel>,
    /// sidecar 根(<app_config>/ohmy-sessions)
    pub(super) data_dir: PathBuf,
    /// 引擎私有配置目录(<app_config>/ohmyagent;messages.jsonl 存在性检查用)
    pub(super) engine_dir: PathBuf,
    /// 普通对话的独立工作区根(<app_local_data>/chat-workspaces)
    pub(super) chat_workspaces_dir: PathBuf,
    /// 壳侧审批记忆持久化路径(兼容尾巴,配对 SessionsState::perm_remember)
    pub(super) perm_persist_path: PathBuf,
}

#[derive(Clone)]
pub(super) struct ManifestModel {
    pub(super) name: String,
    pub(super) default: bool,
    pub(super) source: String,
}

/// 清单模型解析(壳 models.json 词汇:name/provider/base_url/api_key/model/…)。
pub(super) fn parse_manifest_models(models: &Value) -> Vec<ManifestModel> {
    let Some(arr) = models.as_array() else { return vec![] };
    arr.iter()
        .filter_map(|m| {
            let name = m.get("name").and_then(|v| v.as_str())?.to_string();
            Some(ManifestModel {
                name,
                default: m.get("default").and_then(|v| v.as_bool()).unwrap_or(false),
                source: m.get("source").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "ohmy_tests.rs"]
mod tests;
