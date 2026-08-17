// 子代理路由:上游转发的子循环事件的认领/物化/预览/关闭(ohmy.rs 拆出)。
//
// 职责:claim_subagent(经事件戳记的 parent_session_id/parent_tool_call_id
// 精确认领并物化为壳侧子会话)、subagent_feed(父卡进度窗内联预览)、
// close_*(工具闭合/轮次收尾时冲洗行缓冲并关闭子会话)。
// 共享状态定义见 ohmy.rs::Inner。

use std::collections::HashMap;
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

/// 子代理态锁组:子会话路由与 Agent 工具入参/结果暂存。
/// 含锁:subagents、agent_results、agent_inputs(均 StdMutex)。
/// 加锁秩序(评审梳理,不得反向):subagents → sessions(SessionsState;
/// reconcile_all/single_running_workdir 持 subagents 期间读 sessions 表,
/// 反向嵌套禁止);agent_results/agent_inputs 点状取放,不与其他锁嵌套。
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
    /// 后台代理登记(agent_id → (父 sid, 父 Agent tc_id)):Agent 工具回
    /// async_launched(显式 run_in_background)时登记,task_notification 按
    /// agent_id 反查父卡回填最终结果并收尾;引擎不再服务时随会话和解清除
    pub(super) background_agents: StdMutex<HashMap<String, (String, String)>>,
}

impl Inner {
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
                cancel_requested_turn: None,
                created: true, // 壳侧会话,无引擎实体,open 不做 resume RPC
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
        let background = self
            .sub.background_agents
            .lock_ok()
            .values()
            .any(|(s, tc)| s == &psid && tc == &ptc);
        self.sub.subagents.lock_ok().insert(
            child_sid.to_string(),
            SubagentRoute { parent_sid: psid.clone(), parent_tc: ptc.clone(), line_buf: String::new(), background },
        );
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
        }
        if let Some(r) = self
            .sub.subagents
            .lock_ok()
            .values_mut()
            .find(|r| r.parent_sid == sid && r.parent_tc == tc_id)
        {
            r.background = true;
        }
        let label = agent_label(get("name"), get("description"), agent_id);
        let text =
            format!("⏳ 子代理已转入后台继续执行({label}),完成后结果将回填此卡,并在对话流以 📌 通知");
        self.push_frame(sid, |seq| frame::tool_call_completed(tc_id, &text, &[], seq));
    }

    /// task_notification 收尾后台代理:按 agent_id 反查父卡,Result 正文
    /// 回填工具卡终态(error → failed 帧),子会话按终态关闭,对话流落
    /// 一条 📌 系统行(task_note 帧,独立渲染项不混模型气泡)。反查不到
    /// (壳重启丢登记/SendMessage 续跑的二次完成/旧引擎)返回 false,
    /// 调用方整段外显兜底。
    pub(super) fn background_agent_finished(&self, data: &Value, msg: &str) -> bool {
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
        let result = notification_result(msg).unwrap_or_else(|| msg.to_string());
        let child_status = match status {
            "error" => SessionStatus::Error,
            "stopped" => SessionStatus::Interrupted,
            _ => SessionStatus::Finished,
        };
        // 先冲洗行缓冲/关子会话(残留尾行在终态帧之前落卡),再回填终态
        self.close_subagents_of(&psid, &ptc, child_status);
        if status == "error" {
            self.push_frame(&psid, |seq| frame::tool_call_failed(&ptc, &result, seq));
        } else {
            let images = super::normalize::extract_upload_paths(&result);
            self.push_frame(&psid, |seq| frame::tool_call_completed(&ptc, &result, &images, seq));
        }
        let label = agent_label(get("name"), get("description"), agent_id);
        let note = match status {
            "error" => format!("📌 后台代理 {label} 执行失败,详情见其任务卡"),
            "stopped" => format!("📌 后台代理 {label} 已停止"),
            _ => format!("📌 后台代理 {label} 已完成,结果已回填其任务卡"),
        };
        self.push_frame(&psid, |seq| frame::task_note(&note, seq));
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
fn notification_result(msg: &str) -> Option<String> {
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
