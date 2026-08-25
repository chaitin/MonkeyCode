// 子代理路由:上游转发的子循环事件的认领/物化/预览/关闭(ohmy.rs 拆出)。
//
// 职责:claim_subagent(经事件戳记的 parent_session_id/parent_tool_call_id
// 精确认领并物化为壳侧子会话)、subagent_feed(父卡进度窗内联预览)、
// close_*(工具闭合/轮次收尾时冲洗行缓冲并关闭子会话)。
// 共享状态定义见 ohmy.rs::Inner。

use std::collections::{HashMap, HashSet};
use std::sync::Mutex as StdMutex;

use serde_json::{json, Value};

use super::frame::{self, SessionStatus};
use super::normalize::perm_title;
use super::ohmy::Inner;
use super::session::SessionState;
use crate::util::LockExt;

pub(super) struct SubagentRoute {
    pub(super) parent_sid: String,
    pub(super) parent_tc: String,
    /// model_delta 行缓冲:凑整行再出 subagent_text(防每 token 一帧)
    pub(super) line_buf: String,
    /// 后台代理(Agent 工具回了 async_launched):子循环跨轮存活,
    /// turn/stopped 不得收尾,等 task_notification 才闭合
    pub(super) background: bool,
}

#[derive(Clone)]
pub(super) struct AgentOrigin {
    pub(super) parent_sid: String,
    pub(super) parent_tc: String,
}

#[derive(Clone)]
pub(super) struct ActiveContinuation {
    pub(super) parent_sid: String,
    pub(super) parent_tc: String,
    pub(super) summary: String,
    pub(super) message: String,
    /// 同一续跑的同一 child 可能先后发多条事件；重开轮次/挂链接只做一次。
    pub(super) opened_children: HashSet<String>,
}

/// 子代理态锁组:子会话路由与 Agent 工具入参/结果暂存。
/// 含锁:subagents、agent_results、agent_inputs、agent_names、background_agents、
/// agent_origins、agent_aliases、child_agents、active_continuations(均 StdMutex)。
/// 加锁秩序(评审梳理,不得反向):subagents → sessions(SessionsState;
/// reconcile_all/single_running_workdir 持 subagents 期间读 sessions 表,
/// 反向嵌套禁止);agent_results/agent_inputs/agent_names 点状取放,不与其他锁嵌套。
pub(super) struct SubagentState {
    /// 子代理事件路由(child_sid → 父会话/父 Agent 工具)。上游把子循环事件
    /// 原样转发,session_id 是子循环的随机 id,归属经事件戳记的
    /// parent_session_id/parent_tool_call_id 精确认领(dab1b85);
    /// 无戳记的事件不认领(旧猜测启发式已删,见 claim_subagent)
    pub(super) subagents: StdMutex<HashMap<String, SubagentRoute>>,
    /// 同步子代理全量结果暂存(tool_call_id → (status, content)):引擎先发
    /// agent_result(全量、不截断)再回 tool_result(截断 500 字符,可能把
    /// 结果 JSON 截成半截,subagent.go deliverSyncResult),闭合工具卡时
    /// 以暂存内容为权威(structuredToolResult cap)
    pub(super) agent_results: StdMutex<HashMap<String, (String, String)>>,
    /// 父会话 Agent 工具入参暂存(tc_id → (description, prompt)),
    /// 子会话物化时作标题与首条输入
    pub(super) agent_inputs: StdMutex<HashMap<String, (String, String)>>,
    /// Agent 工具可选 name 暂存(tc_id → name)，同步 agent_result 建 alias 后清理。
    pub(super) agent_names: StdMutex<HashMap<String, String>>,
    /// 后台代理登记(agent_id → (父 sid, 父 Agent tc_id)):Agent 工具回
    /// async_launched(显式 run_in_background)时登记,task_notification 按
    /// agent_id 反查父卡回填最终结果并收尾;引擎不再服务时随会话和解清除
    pub(super) background_agents: StdMutex<HashMap<String, (String, String)>>,
    /// 首次 Agent agent_result/async 应答建立的稳定身份(agent_id → 原始父 Agent 卡)。
    pub(super) agent_origins: StdMutex<HashMap<String, AgentOrigin>>,
    /// Agent 输入/应答里的 name，仅在其父会话内作为 SendMessage alias。
    pub(super) agent_aliases: StdMutex<HashMap<(String, String), String>>,
    /// 子循环身份跨轮保留；即使 task_notification 已删 route，续跑仍可反查。
    pub(super) child_agents: StdMutex<HashMap<String, String>>,
    /// SendMessage 已派发、等待 task_notification 的续跑(agent_id → 当前卡)。
    pub(super) active_continuations: StdMutex<HashMap<String, ActiveContinuation>>,
}

impl Inner {
    fn agent_id_for_origin(&self, parent_sid: &str, parent_tc: &str) -> Option<String> {
        self.sub.agent_origins.lock_ok().iter()
            .find(|(_, origin)| origin.parent_sid == parent_sid && origin.parent_tc == parent_tc)
            .map(|(agent_id, _)| agent_id.clone())
    }

    /// Agent 获得稳定 agent_id 后统一登记 origin/name alias，并把已认领的
    /// child route 补绑到该身份。同步 agent_result 与 async_launched 共用。
    pub(super) fn register_agent_identity(
        &self,
        sid: &str,
        tc_id: &str,
        agent_id: &str,
        name: &str,
    ) {
        if agent_id.is_empty() || tc_id.is_empty() { return; }
        self.sub.agent_origins.lock_ok().entry(agent_id.to_string()).or_insert_with(|| AgentOrigin {
            parent_sid: sid.to_string(), parent_tc: tc_id.to_string(),
        });
        if !name.is_empty() {
            self.sub.agent_aliases.lock_ok()
                .insert((sid.to_string(), name.to_string()), agent_id.to_string());
        }
        let children: Vec<String> = self.sub.subagents.lock_ok().iter()
            .filter(|(_, route)| route.parent_sid == sid && route.parent_tc == tc_id)
            .map(|(child, _)| child.clone()).collect();
        let mut child_agents = self.sub.child_agents.lock_ok();
        for child in children { child_agents.insert(child, agent_id.to_string()); }
    }

    /// SendMessage tool_call 一到就建立 provisional 路由。alias 按父会话隔离，
    /// 避免两个会话恰好都把代理命名为同一个短名时串卡。
    pub(super) fn register_continuation(&self, sid: &str, tc_id: &str, input: &Value) {
        let addressed = input.get("agent_id").and_then(Value::as_str)
            .or_else(|| input.get("to").and_then(Value::as_str)).unwrap_or("");
        if addressed.is_empty() || tc_id.is_empty() { return; }
        let agent_id = self.sub.agent_aliases.lock_ok()
            .get(&(sid.to_string(), addressed.to_string())).cloned()
            .unwrap_or_else(|| addressed.to_string());
        let message = input.get("message").and_then(Value::as_str).unwrap_or("").to_string();
        let summary = input.get("summary").and_then(Value::as_str).filter(|s| !s.is_empty())
            .unwrap_or("继续执行").to_string();
        let continuation = ActiveContinuation {
            parent_sid: sid.to_string(), parent_tc: tc_id.to_string(),
            summary: summary.clone(), message: message.clone(), opened_children: HashSet::new(),
        };
        // 同一 agent 尚有活跃续跑时，引擎会同步拒绝第二次 SendMessage；不能
        // 让这张注定失败的 provisional 卡覆盖仍在执行的真实 route。
        self.sub.active_continuations.lock_ok().entry(agent_id).or_insert(continuation);
        self.sub.agent_inputs.lock_ok().insert(tc_id.to_string(), (summary, message));
    }

    /// async_launched 是 SendMessage 对目标 agent_id 的权威确认。若 tool_call
    /// 阶段以 alias 暂存，这里把 active key 换成响应中的真实 id。
    pub(super) fn confirm_continuation(&self, sid: &str, tc_id: &str, resp: &Value) {
        let confirmed = resp.get("agentId").and_then(Value::as_str).unwrap_or("");
        if confirmed.is_empty() { return; }
        let mut active = self.sub.active_continuations.lock_ok();
        let provisional = active.iter()
            .find(|(_, c)| c.parent_sid == sid && c.parent_tc == tc_id)
            .map(|(agent_id, _)| agent_id.clone());
        if let Some(provisional) = provisional.filter(|id| id != confirmed) {
            if let Some(continuation) = active.remove(&provisional) {
                active.insert(confirmed.to_string(), continuation);
            }
        }
    }

    /// SendMessage 没有真正转后台时撤销该工具卡的 provisional active。
    pub(super) fn cancel_continuation(&self, sid: &str, tc_id: &str) {
        self.sub.active_continuations.lock_ok()
            .retain(|_, c| !(c.parent_sid == sid && c.parent_tc == tc_id));
        self.sub.agent_inputs.lock_ok().remove(tc_id);
    }

    /// 在 known-session 判断前调用。续跑子循环仍携带首次 Agent 的旧 parent
    /// 戳记，因此先用 child identity 或旧 origin 找 agent，再把 route 改绑到
    /// 当前 SendMessage 卡。返回值仅表示发生了续跑重绑。
    pub(super) fn prepare_continuation_event(&self, child_sid: &str, event: &mut Value) -> bool {
        let by_child = self.sub.child_agents.lock_ok().get(child_sid).cloned();
        let agent_id = by_child.or_else(|| {
            let parent = event.get("parent_session_id").and_then(Value::as_str).unwrap_or("");
            let tc = event.get("parent_tool_call_id").and_then(Value::as_str).unwrap_or("");
            if parent.is_empty() || tc.is_empty() { return None; }
            self.agent_id_for_origin(&self.shell_sid_of(parent), tc)
        });
        let Some(agent_id) = agent_id else { return false };
        let (continuation, first_for_child) = {
            let mut active = self.sub.active_continuations.lock_ok();
            let Some(c) = active.get_mut(&agent_id) else { return false };
            let first = c.opened_children.insert(child_sid.to_string());
            (c.clone(), first)
        };
        self.sub.child_agents.lock_ok().insert(child_sid.to_string(), agent_id);
        if let Some(obj) = event.as_object_mut() {
            obj.insert("parent_session_id".into(), json!(continuation.parent_sid));
            obj.insert("parent_tool_call_id".into(), json!(continuation.parent_tc));
            obj.insert("parent_description".into(), json!(continuation.summary));
        }

        let child_exists = self.sess.sessions.lock_ok().contains_key(child_sid);
        if !child_exists {
            // claim_subagent 将按上面重写后的戳记物化；此处若提前插 route，
            // claim 的幂等快路径会误以为 SessionState 也已经存在。
            return true;
        }
        {
            let mut routes = self.sub.subagents.lock_ok();
            match routes.get_mut(child_sid) {
                Some(route) => {
                    route.parent_sid = continuation.parent_sid.clone();
                    route.parent_tc = continuation.parent_tc.clone();
                    route.background = true;
                    route.line_buf.clear();
                }
                None => { routes.insert(child_sid.to_string(), SubagentRoute {
                    parent_sid: continuation.parent_sid.clone(), parent_tc: continuation.parent_tc.clone(),
                    line_buf: String::new(), background: true,
                }); }
            }
        }
        if !first_for_child { return true; }
        let reopened = {
            let mut sessions = self.sess.sessions.lock_ok();
            let Some(child) = sessions.get_mut(child_sid) else { return true };
            if child.running { false } else {
                child.running = true;
                child.compacting = false;
                child.manual_compact = false;
                child.terminal_error_seen = false;
                child.cancel_requested_turn = None;
                child.open_tools.clear();
                child.model_text.clear();
                child.last_event_seq = 0;
                child.turn += 1;
                child.title = continuation.summary.clone();
                true
            }
        };
        if reopened {
            if !continuation.message.is_empty() {
                self.push_frame(child_sid, |seq| frame::user_input(&continuation.message, seq));
            }
            self.push_frame(child_sid, frame::task_started);
            self.write_sidecar(child_sid, |m| {
                m["parent"] = json!(continuation.parent_sid);
                m["title"] = json!(continuation.summary);
                m["status"] = json!(SessionStatus::Running.as_str());
            });
        }
        self.push_frame(&continuation.parent_sid, |seq| frame::tool_call_progress(
            &continuation.parent_tc,
            json!({ "kind": "child_session", "childSessionId": child_sid }), seq,
        ));
        true
    }

    /// 子代理认领 + 物化。上游 dab1b85 起事件自带 parent_session_id/
    /// parent_tool_call_id,精确认领;无戳记的事件**不认领**(旧的"运行中
    /// 且持有未闭合 Agent 工具的会话"猜测启发式已删——并发多 Agent 时会
    /// 把事件挂错父卡,而桌面与引擎同包分发且 protocolVersion 已校验,
    /// 启发式只服务开发期版本偏斜,记日志丢弃比认错安全)。物化为
    /// **壳侧子会话**(sidecar 带 parent,可回放可跟流)——父卡 feed 预览
    /// + child_session 链接点开完整对话。认领不到(迟到/无戳记)返回 false。
    pub(super) fn claim_subagent(&self, child_sid: &str, event: &Value) -> bool {
        if self.sub.subagents.lock_ok().contains_key(child_sid) {
            return true;
        }
        // 认领即物化成壳侧子会话:child_sid 会成为 sidecar 目录名,而它来自
        // 引擎转发的子循环 id。守卫标准与壳 sid 一致(见 valid_session_id)
        if !super::session::valid_session_id(child_sid) {
            eprintln!("[desktop] 子代理事件的会话 id 不是合法目录名,不认领: {child_sid:?}");
            return false;
        }
        // 事件自带父归属:父 sid 经 shell_sid_of 反查(engine_id 换绑兼容)
        let stamped = event
            .get("parent_session_id")
            .and_then(|v| v.as_str())
            .filter(|p| !p.is_empty())
            .map(|p| {
                let psid = self.shell_sid_of(p);
                let ptc = event
                    .get("parent_tool_call_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                (psid, ptc)
            });
        let claimed = match stamped {
            Some((psid, ptc)) => {
                let sessions = self.sess.sessions.lock_ok();
                sessions.get(&psid).map(|s| {
                    // 父工具 id 缺省时兜底找未闭合 Agent 工具
                    let ptc = if !ptc.is_empty() {
                        ptc
                    } else {
                        s.open_tools
                            .iter()
                            .find(|(_, n)| n.as_str() == "Agent")
                            .map(|(tc, _)| tc.clone())
                            .unwrap_or_default()
                    };
                    (psid.clone(), ptc, s.workdir.clone(), s.model_name.clone())
                })
            }
            None => {
                // 无 parent_session_id 戳记:不猜测认领(见函数注释),
                // 记日志外显后丢弃——同包分发下走到这里即引擎侧异常
                eprintln!(
                    "[desktop] 子代理事件缺 parent_session_id,不认领: sid={child_sid} type={}",
                    event.get("type").and_then(|v| v.as_str()).unwrap_or("?")
                );
                None
            }
        };
        let Some((psid, ptc, workdir, model_name)) = claimed else { return false };
        let (mut title, prompt) = self
            .sub.agent_inputs
            .lock_ok()
            .get(&ptc)
            .cloned()
            .unwrap_or_else(|| ("子代理".into(), String::new()));
        // 事件戳的 parent_description 优先(939e03e):后台代理跨轮续跑时
        // tc_id 暂存可能已清,戳记恒在
        if let Some(d) = event.get("parent_description").and_then(|v| v.as_str()).filter(|d| !d.is_empty()) {
            title = d.to_string();
        }
        self.sess.sessions.lock_ok().insert(
            child_sid.to_string(),
            SessionState {
                seq: 0,
                running: true,
                compacting: false,
                manual_compact: false,
                terminal_error_seen: false,
                turn: 1,
                steer_attempt: 0,
                pending_steer: None,
                pending_steer_echoes: Default::default(),
                cancel_requested_turn: None,
                created: true, // 壳侧会话,无引擎实体,open 不做 resume RPC
                resuming: false,
                engine_id: child_sid.to_string(),
                opened: false,
                open_tools: HashMap::new(),
                model_text: String::new(),
                last_event_seq: 0,
                context_usage: None,
                workdir: workdir.clone(),
                model_name: model_name.clone(),
                mode: "default".into(),
                title: title.clone(),
                fold: Default::default(),
            },
        );
        self.write_sidecar(child_sid, |m| {
            m["parent"] = json!(psid);
            m["workdir"] = json!(workdir);
            m["model_name"] = json!(model_name);
            m["title"] = json!(title);
            m["status"] = json!(SessionStatus::Running.as_str());
        });
        // 认领晚于 async_launched 的情形(后台子代理首个转发事件稍后才到):
        // 登记表已有该父工具的后台标记,路由生来即后台,跨轮存活
        let explicitly_background = self.sub.background_agents.lock_ok().values()
            .any(|(s, tc)| s == &psid && tc == &ptc);
        let continuing = self.sub.active_continuations.lock_ok().values()
            .any(|c| c.parent_sid == psid && c.parent_tc == ptc);
        let background = explicitly_background || continuing;
        self.sub.subagents.lock_ok().insert(
            child_sid.to_string(),
            SubagentRoute { parent_sid: psid.clone(), parent_tc: ptc.clone(), line_buf: String::new(), background },
        );
        if let Some(agent_id) = self.agent_id_for_origin(&psid, &ptc) {
            self.sub.child_agents.lock_ok().insert(child_sid.to_string(), agent_id);
        }
        // 子会话回放形状与主会话一致:user-input(任务)→ task-started → …
        if !prompt.is_empty() {
            self.push_frame(child_sid, |seq| frame::user_input(&prompt, seq));
        }
        self.push_frame(child_sid, frame::task_started);
        // 父卡挂子会话链接(UI 点开完整视图)
        self.push_frame(&psid, |seq| {
            frame::tool_call_progress(
                &ptc,
                json!({ "kind": "child_session", "childSessionId": child_sid }),
                seq,
            )
        });
        true
    }

    /// 子代理事件在父卡进度窗的内联预览(完整对话在子会话本体)。
    pub(super) fn subagent_feed(&self, child_sid: &str, etype: &str, event: &Value, data: &Value) {
        let Some((psid, ptc)) = self
            .sub.subagents
            .lock_ok()
            .get(child_sid)
            .map(|r| (r.parent_sid.clone(), r.parent_tc.clone()))
        else {
            return;
        };
        match etype {
            "tool_call" => {
                let tc_id = event
                    .get("tool_call_id")
                    .and_then(|v| v.as_str())
                    .or_else(|| data.get("id").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string();
                let name = data.get("name").and_then(|v| v.as_str()).unwrap_or("工具");
                let input = data.get("input").cloned().unwrap_or(Value::Null);
                let title = perm_title(name, &input);
                self.push_frame(&psid, |seq| {
                    frame::tool_call_progress(
                        &ptc,
                        json!({ "kind": "subagent_tool", "id": tc_id, "title": title,
                            "rawInput": input, "status": "run" }),
                        seq,
                    )
                });
            }
            "tool_result" => {
                let tc_id = event.get("tool_call_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                self.push_frame(&psid, |seq| {
                    frame::tool_call_progress(
                        &ptc,
                        json!({ "kind": "subagent_tool", "id": tc_id, "status": "ok" }),
                        seq,
                    )
                });
            }
            "model_delta" => {
                let text = data.get("text").and_then(|v| v.as_str()).unwrap_or("");
                let lines = {
                    let mut subs = self.sub.subagents.lock_ok();
                    let Some(r) = subs.get_mut(child_sid) else { return };
                    r.line_buf.push_str(text);
                    let mut out = Vec::new();
                    while let Some(pos) = r.line_buf.find('\n') {
                        let line: String = r.line_buf.drain(..=pos).collect();
                        let line = line.trim_end().to_string();
                        if !line.is_empty() {
                            out.push(line);
                        }
                    }
                    out
                };
                for line in lines {
                    self.push_frame(&psid, |seq| {
                        frame::tool_call_progress(&ptc, json!({ "kind": "subagent_text", "line": line }), seq)
                    });
                }
            }
            "error" => {
                let msg = data.get("error").and_then(|v| v.as_str()).unwrap_or("子代理出错");
                self.push_frame(&psid, |seq| {
                    frame::tool_call_progress(
                        &ptc,
                        json!({ "kind": "subagent_text", "line": format!("✗ {msg}") }),
                        seq,
                    )
                });
            }
            // thinking_delta/model_done:进度窗不展示思考流与轮界
            _ => {}
        }
    }

    /// 关闭一个子会话:收尾帧 + sidecar 终态(不发 session-event,不惊动侧栏)。
    fn close_child(&self, child_sid: &str, status: SessionStatus) {
        let was = {
            let mut sessions = self.sess.sessions.lock_ok();
            match sessions.get_mut(child_sid) {
                Some(s) if s.running => {
                    s.running = false;
                    s.compacting = false;
                    s.manual_compact = false;
                    s.terminal_error_seen = false;
                    s.cancel_requested_turn = None;
                    true
                }
                _ => false,
            }
        };
        if !was {
            return;
        }
        self.push_frame(child_sid, frame::task_ended);
        self.write_sidecar(child_sid, |m| m["status"] = json!(status.as_str()));
    }

    /// 父会话某工具闭合:冲洗子代理残留行缓冲、按 status 关闭对应子会话、
    /// 删路由(同步完成 Finished;后台代理经 task_notification 按其终态)。
    pub(super) fn close_subagents_of(&self, sid: &str, tc_id: &str, status: SessionStatus) {
        let closing: Vec<(String, String)> = {
            let mut subs = self.sub.subagents.lock_ok();
            let closing = subs
                .iter_mut()
                .filter(|(_, r)| r.parent_sid == sid && r.parent_tc == tc_id)
                .map(|(child, r)| (child.clone(), std::mem::take(&mut r.line_buf).trim().to_string()))
                .collect();
            subs.retain(|_, r| !(r.parent_sid == sid && r.parent_tc == tc_id));
            closing
        };
        for (child, tail) in closing {
            if !tail.is_empty() {
                self.push_frame(sid, |seq| {
                    frame::tool_call_progress(tc_id, json!({ "kind": "subagent_text", "line": tail }), seq)
                });
            }
            self.close_child(&child, status);
        }
        self.sub.agent_inputs.lock_ok().remove(tc_id);
        self.sub.agent_names.lock_ok().remove(tc_id);
    }

    /// 会话轮次结束/和解:子代理路由失效,残留子会话按 status 收尾。
    /// include_background=false(turn/stopped)放过后台代理——它们的子循环
    /// 跨轮存活,收尾归 task_notification;true(引擎不再服务的和解)全关,
    /// 后台登记一并清除(通知永远不会来了)。
    pub(super) fn close_children_of_session(&self, sid: &str, status: SessionStatus, include_background: bool) {
        let children: Vec<String> = {
            let mut subs = self.sub.subagents.lock_ok();
            let children = subs
                .iter()
                .filter(|(_, r)| r.parent_sid == sid && (include_background || !r.background))
                .map(|(child, _)| child.clone())
                .collect();
            subs.retain(|_, r| !(r.parent_sid == sid && (include_background || !r.background)));
            children
        };
        for child in children {
            self.close_child(&child, status);
        }
        if include_background {
            self.sub.background_agents.lock_ok().retain(|_, (s, _)| s != sid);
            let continuation_tcs: Vec<String> = {
                let mut active = self.sub.active_continuations.lock_ok();
                let tcs = active.values().filter(|c| c.parent_sid == sid)
                    .map(|c| c.parent_tc.clone()).collect();
                active.retain(|_, c| c.parent_sid != sid);
                tcs
            };
            let mut inputs = self.sub.agent_inputs.lock_ok();
            for tc in continuation_tcs { inputs.remove(&tc); }
        }
    }

    /// Agent 工具应答 async_launched(显式 run_in_background):
    /// 子代理还活着——不关路由,登记 agent_id → 父卡供 task_notification
    /// 反查,已认领路由补后台标记(超时前已流式认领的情形;认领在后的
    /// 情形由 claim_subagent 查登记表)。工具卡以友好文案按 completed
    /// 收尾:调用本身成功返回,子代理成败等 task_notification 终态回填。
    pub(super) fn background_agent_launched(&self, sid: &str, tc_id: &str, resp: &Value) {
        let get = |k: &str| resp.get(k).and_then(|v| v.as_str()).unwrap_or("");
        let agent_id = get("agentId");
        if !agent_id.is_empty() {
            self.sub.background_agents
                .lock_ok()
                .insert(agent_id.to_string(), (sid.to_string(), tc_id.to_string()));
            let input_name = self.sub.agent_names.lock_ok().remove(tc_id).unwrap_or_default();
            let response_name = get("name");
            let name = if response_name.is_empty() { input_name.as_str() } else { response_name };
            self.register_agent_identity(sid, tc_id, agent_id, name);
        }
        if let Some(r) = self
            .sub.subagents
            .lock_ok()
            .values_mut()
            .find(|r| r.parent_sid == sid && r.parent_tc == tc_id)
        {
            r.background = true;
        }
        self.push_frame(sid, |seq| {
            frame::tool_call_progress(
                tc_id,
                serde_json::json!({ "kind": "background_agent", "agentId": agent_id, "status": "running" }),
                seq,
            )
        });
        let label = agent_label(get("name"), get("description"), agent_id);
        let text =
            format!("⏳ 子代理已转入后台继续执行({label}),完成后结果将回填此卡,并在对话流以 📌 通知");
        self.push_frame(sid, |seq| frame::tool_call_completed(tc_id, &text, &[], seq));
    }

    /// task_notification 收尾后台代理:按 agent_id 反查父卡,Result 正文
    /// 回填工具卡终态(error → failed 帧),子会话按终态关闭。结构化
    /// 通知帧由 normalize 落到通知实际到达的会话,避免反查成功时重复。
    /// 反查不到
    /// (壳重启丢登记/SendMessage 续跑的二次完成/旧引擎)返回 false,
    /// 调用方仍会落结构化结果帧。
    pub(super) fn background_agent_finished(&self, data: &Value, result: &str) -> bool {
        let get = |k: &str| data.get(k).and_then(|v| v.as_str()).unwrap_or("");
        let agent_id = get("agent_id");
        if agent_id.is_empty() {
            return false;
        }
        // 帧一律落在登记的父会话(通知本就发在父会话,psid 即 sid;
        // 万一不符也以卡所在会话为准,不把结果写岔)
        let Some((psid, ptc)) = self.sub.background_agents.lock_ok().remove(agent_id) else {
            return false;
        };
        let status = get("status");
        let child_status = match status {
            "error" => SessionStatus::Error,
            "stopped" => SessionStatus::Interrupted,
            _ => SessionStatus::Finished,
        };
        // 先冲洗行缓冲/关子会话(残留尾行在终态帧之前落卡),再回填终态
        self.close_subagents_of(&psid, &ptc, child_status);
        if status == "error" {
            self.push_frame(&psid, |seq| frame::tool_call_failed(&ptc, result, seq));
        } else {
            let images = super::normalize::extract_upload_paths(result);
            self.push_frame(&psid, |seq| frame::tool_call_completed(&ptc, result, &images, seq));
        }
        true
    }

    /// 续跑通知只负责关闭当前 route/child 并清 active；完整结果由统一的
    /// task_notification 独立结果卡承载，不能再次灌进 SendMessage 卡。
    pub(super) fn continuation_finished(&self, data: &Value) -> bool {
        let agent_id = data.get("agent_id").and_then(Value::as_str).unwrap_or("");
        if agent_id.is_empty() { return false; }
        let Some(continuation) = self.sub.active_continuations.lock_ok().remove(agent_id) else {
            return false;
        };
        let status = match data.get("status").and_then(Value::as_str).unwrap_or("") {
            "error" => SessionStatus::Error,
            "stopped" => SessionStatus::Interrupted,
            _ => SessionStatus::Finished,
        };
        self.close_subagents_of(&continuation.parent_sid, &continuation.parent_tc, status);
        true
    }
}

/// 后台代理的人话标签:「name(description)」按有啥用啥,全空退 agent_id。
fn agent_label(name: &str, desc: &str, agent_id: &str) -> String {
    match (name.is_empty(), desc.is_empty()) {
        (false, false) => format!("{name}({desc})"),
        (false, true) => name.to_string(),
        (true, false) => desc.to_string(),
        (true, true) => agent_id.to_string(),
    }
}

/// 从 task_notification 渲染消息里取 Result 正文。形状对表引擎
/// notification.go::Render(固定:<task-notification>\n…\nResult:\n{正文}
/// \n</task-notification>);解析不出返回 None,调用方退回全文。
pub(super) fn notification_result(msg: &str) -> Option<String> {
    let body = strip_notification_tags(msg);
    let idx = body.find("\nResult:\n")?;
    Some(body[idx + "\nResult:\n".len()..].trim().to_string())
}

/// 剥掉 <task-notification> 包装标签(markdown 会把标签行当 HTML 块,
/// DOMPurify 再剥标签,块内文本与后续正文的分界随之错乱——外显前去壳)。
pub(super) fn strip_notification_tags(msg: &str) -> String {
    let body = msg.trim();
    let body = body.strip_prefix("<task-notification>").unwrap_or(body);
    let body = body.strip_suffix("</task-notification>").unwrap_or(body);
    body.trim().to_string()
}
