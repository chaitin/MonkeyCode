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

    /// 内置技能目录(bundle 资源;需要 Tauri 路径解析,故挂在 ShellCtx)。
    /// 测试替身缺省 None = 只有用户技能。
    fn skills_builtin_dir(&self) -> Option<PathBuf> { None }

    /// 引擎进程非 stop() 退出(reader 读到 stdout EOF)。driver 只负责**报告**
    /// 事实,摘句柄/置崩溃态/退避重启这些策略全在壳侧(main.rs),transport
    /// 因此不必知道 DriverHost 与 Tauri State 的存在。
    /// `instance` 标明是**哪一个**引擎进程退出了,壳据此忽略早已被弃用的实例。
    fn on_engine_exit(&self, _instance: u64, _detail: &str, _log_tail: &str) {}
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
    fn on_engine_exit(&self, instance: u64, detail: &str, log_tail: &str) {
        crate::engine_exited(self, instance, detail, log_tail);
    }
    fn skills_builtin_dir(&self) -> Option<PathBuf> {
        crate::skills::builtin_dir(self)
    }
}

#[derive(Clone)]
pub struct OhmyDriver(pub(super) Arc<Inner>);

impl OhmyDriver {
    /// system/ready 的增量能力是引擎/壳协商的唯一事实来源。
    pub fn has_capability(&self, capability: &str) -> bool { self.0.has_cap(capability) }

    /// system/ready 宣告的内核版本；发布产物为 Agent commit hash。
    pub fn version(&self) -> String { self.0.transport.engine_version.lock_ok().clone() }

    /// 引擎进程实例号:壳用它判定退出通知是否来自当前这一个。
    pub fn instance(&self) -> u64 { self.0.transport.instance }

    /// WSL 运行环境的发行版名(本机模式 None)。repo/uploads 的
    /// wsl_distro 参数从这里接回,不再翻配置。
    pub fn wsl_distro(&self) -> Option<String> {
        self.0.wsl.as_ref().map(|w| w.distro.clone())
    }

    /// WSL guest 网络模式("mirrored"/"nat";本机模式 None)。
    /// 浏览器 MCP 等回连宿主 127.0.0.1 的能力按此降级。
    pub fn wsl_networking(&self) -> Option<String> {
        self.0.wsl.as_ref().map(|w| w.networking.clone())
    }

    /// WSL 模式下目录选择对话框的初始位置:guest 家目录的宿主视角
    /// (\\wsl$\<发行版>\home\<用户>;Linux 冒烟恒等)。本机模式 None。
    pub fn wsl_workdir_base(&self) -> Option<String> {
        self.0.wsl.as_ref().map(|w| {
            crate::wsl::host_fs_view(&w.distro, &w.guest_home).to_string_lossy().into_owned()
        })
    }
}

/// WSL 运行环境上下文(kernel_env=wsl:* 时随引擎启动填入;一次 prepare
/// 采集,生命周期与引擎实例一致——换发行版必然经引擎重启,不会串)。
pub(super) struct WslCtx {
    pub(super) distro: String,
    /// 引擎二进制 basename(pkill 兜底用)
    pub(super) bin_name: String,
    /// guest 内用户家目录(~ 展开与 workdir 空缺回退)
    pub(super) guest_home: String,
    /// chat-workspaces 根的 guest 侧形态(/mnt/c/...;chat 会话 workdir
    /// 以此拼接,维持"WSL 模式 sidecar 存 guest 路径"不变量)
    pub(super) guest_chat_root: String,
    /// wslinfo --networking-mode("mirrored"/"nat")
    pub(super) networking: String,
    /// guest 内 automount 根(常态 /mnt,wsl.conf [automount] root 可改;
    /// 从 prepare 的 wslpath 翻译对反推)。盘符 workdir 映射 guest 路径用
    pub(super) mount_root: String,
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
    /// WSL 运行环境上下文(本机模式 None;见 WslCtx)
    pub(super) wsl: Option<WslCtx>,
    /// 技能库来源(skills.rs):内置(bundle 资源,可缺)与用户目录,
    /// 及默认启用开关文件(skills-defaults.json)
    pub(super) skills_builtin_dir: Option<PathBuf>,
    pub(super) skills_user_dir: PathBuf,
    pub(super) skills_defaults_path: PathBuf,
    /// 技能物化闸:同一会话的"重写目录 → session/create"必须成对,
    /// 避免并发切换互相覆盖。目录本身已按 engine session id 隔离。
    pub(super) skills_gate: tokio::sync::Mutex<()>,
}

#[derive(Clone)]
pub(super) struct ManifestModel {
    pub(super) name: String,
    pub(super) default: bool,
    pub(super) source: String,
    /// 模型设置里的思考深度默认档(low/medium/high;""=关闭)。composer
    /// 未显式选档时按它显示当前生效档位。
    pub(super) think: String,
    /// 底层模型串(条目 "model" 字段)。name 可能是 remark 别名,UI 判
    /// 会员档位(monkeycode-{basic|pro|ultra}/…)只能靠它。
    pub(super) model: String,
    /// 超出会员档的条目:引擎 settings 照常物化(档位权限归服务端把关,
    /// 缺条目会让到期前选它的老会话恢复即 unknown model);显式选择拒绝
    /// (session.rs model_id_of),恢复/重建已有会话放行(model_id_of_any),
    /// UI 灰态禁选。
    pub(super) locked: bool,
    /// 会员条目的服务端归属(public/private/team;非会员条目为空),
    /// UI 会员 tab 按它分「付费/我的/团队」节。
    pub(super) owner: String,
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
                think: m.get("think").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                // unwrap_or 而非 ?:旧条目可能没有这些字段,缺省不能让
                // 整条从选择器消失(locked 缺省 false = 旧数据照常可选)
                model: m.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                locked: m.get("locked").and_then(|v| v.as_bool()).unwrap_or(false),
                owner: m.get("owner").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "ohmy_tests.rs"]
mod tests;
