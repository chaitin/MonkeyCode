// 协议归一化:引擎 stdio 事件 → Frame 词汇(ohmy.rs 拆出)。
//
// 职责:handle_notification(permission/question/turn 等通知路由与
// 审批/提问簿记)、handle_event(event/stream 归一化:model_done 全文
// 对账、structuredToolResult/is_error、agent_result 权威内容、eventSeq
// 空洞观测)。事件归一化映射(ohmy → Frame)参考
// ohmyagent/internal/transport/{stdio,protocol}.go 与 types/events.go。

use std::collections::HashMap;

use serde_json::{json, Value};

use super::frame::{self, PermOutcome, SessionStatus};
use super::ohmy::Inner;
use crate::util::LockExt;

impl Inner {
    /// stdio 通知路由(reader 线程调用)。
    pub(super) fn handle_notification(&self, method: &str, params: Value) {
        match method {
            "event/stream" => self.handle_event(params),
            "permission/request" => {
                let req_id = params.get("request_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let sid = self.shell_sid_of(params.get("session_id").and_then(|v| v.as_str()).unwrap_or(""));
                let tool = params.get("tool").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let input = params.get("input").cloned().unwrap_or(Value::Null);
                if req_id.is_empty() || sid.is_empty() {
                    return;
                }
                // 记忆集命中 → 自动放行,不上抛 UI(respond_rpc 不阻塞,
                // reader 线程上调用安全)。兼容尾巴:仅旧引擎走此路径——
                // permissionRemember cap 出现后审批记忆归引擎(命令段粒度
                // 规则,记住后引擎根本不再发 request),壳侧工具名粒度的
                // 自动放行(记住一次 Bash 放行所有命令)随之停用
                if !self.has_cap("permissionRemember") && self.sess.perm_remember.lock_ok().contains(&tool) {
                    self.respond_rpc("permission/respond", json!({ "request_id": req_id, "approved": true }));
                    return;
                }
                let title = perm_title(&tool, &input);
                // provider 工具调用 id 原样透传(UI 把审批锚到对应工具卡);
                // 旧引擎/空 id 不带字段,UI 回退独立审批卡
                let tc_id =
                    params.get("tool_call_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                self.sess.pending_perms.lock_ok().insert(req_id.clone(), sid.clone());
                self.sess.perm_tools.lock_ok().insert(req_id.clone(), tool.clone());
                self.push_frame(&sid, |seq| frame::permission_req(&req_id, &tool, &title, &tc_id, seq));
                self.emit_session_ask(&sid, true);
            }
            "permission/cancelled" => {
                let req_id = params.get("request_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let sid = self.shell_sid_of(params.get("session_id").and_then(|v| v.as_str()).unwrap_or(""));
                let reason = params.get("reason").and_then(|v| v.as_str()).unwrap_or("cancelled");
                self.sess.perm_tools.lock_ok().remove(&req_id);
                if !sid.is_empty() {
                    self.resolve_perm(
                        &sid,
                        &req_id,
                        if reason == "timeout" { PermOutcome::Timeout } else { PermOutcome::Cancelled },
                    );
                }
            }
            "question/request" => {
                let req_id = params.get("request_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let sid = self.shell_sid_of(params.get("session_id").and_then(|v| v.as_str()).unwrap_or(""));
                let questions = params.get("questions").cloned().unwrap_or(json!([]));
                if req_id.is_empty() || sid.is_empty() {
                    return;
                }
                self.sess.pending_questions
                    .lock_ok()
                    .insert(req_id.clone(), (sid.clone(), questions.clone()));
                // kind=acp_ask_user_question 即一等公民提问卡标记,reduce.ts 据此
                // 直接消费 rawInput.questions,不走 tool_call 的标题启发式
                self.push_frame(&sid, |seq| frame::ask_user_question(&req_id, &questions, seq));
                self.emit_session_ask(&sid, true);
            }
            "question/cancelled" => {
                let req_id = params.get("request_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let sid = self.sess.pending_questions.lock_ok().remove(&req_id).map(|(s, _)| s);
                if let Some(sid) = sid {
                    self.emit_session_ask(&sid, false);
                }
            }
            "turn/stopped" => {
                let sid = self.shell_sid_of(params.get("session_id").and_then(|v| v.as_str()).unwrap_or(""));
                let stop_reason = params.get("stop_reason").and_then(|v| v.as_str()).unwrap_or("complete");
                let err = params.get("error").and_then(|v| v.as_str()).unwrap_or("").to_string();
                if sid.is_empty() {
                    // 认不出会话 = 这一轮壳侧永远收不了尾(会话卡 running,
                    // 输入/删除/切模型全锁死)。静默丢弃过一次就再也查不出来,
                    // 必须留痕:引擎漏发 session_id 或 engine_id 换绑后的迟到应答
                    eprintln!("[desktop] turn/stopped 无法映射到壳会话,已丢弃: {params}");
                    return;
                }
                let (was_running, open) = {
                    let mut sessions = self.sess.sessions.lock_ok();
                    match sessions.get_mut(&sid) {
                        Some(s) => {
                            let was = s.running;
                            s.running = false;
                            s.model_text.clear(); // 对账累积不跨轮(model_done 缺席的残留)
                            (was, std::mem::take(&mut s.open_tools))
                        }
                        None => (false, HashMap::new()),
                    }
                };
                // 中断轮次可能留下已暂存未被 tool_result 消费的 agent_result
                if !open.is_empty() {
                    let mut ar = self.sub.agent_results.lock_ok();
                    for tc in open.keys() {
                        ar.remove(tc);
                    }
                }
                // 轮次收尾:残留子代理(未随工具闭合)按中断收尾;后台代理
                // 除外——其子循环跨轮存活,收尾归 task_notification
                self.close_children_of_session(&sid, SessionStatus::Interrupted, false);
                if !was_running {
                    // 已本地和解(取消超时/引擎重启)后迟到的收尾,忽略防重复帧。
                    // 正常的幂等吞掉与"会话表里根本没这个 sid"(engine_id 换绑
                    // 后 shell_sid_of 回退成引擎 id)在这里长得一样,留痕区分
                    eprintln!(
                        "[desktop] turn/stopped 落在非运行会话上,已忽略: sid={sid} reason={stop_reason}"
                    );
                    return;
                }
                // 引擎的工具错误路径不发 tool_result(错误只进模型消息),
                // 未闭合的 tool_call 在此补 failed 帧,否则 UI 永远转圈
                let tool_msg =
                    if stop_reason == "interrupted" { "已中断" } else { "执行失败(引擎未回传详情)" };
                for (tc, _name) in open {
                    self.push_frame(&sid, |seq| frame::tool_call_failed(&tc, tool_msg, seq));
                }
                // 轮后用权威快照收口。新引擎与 usage 事件统一为顶层
                // context_used/context_window；嵌套 context 仅留给旧引擎回放。
                if let Some((used, window)) = context_usage_fields(&params) {
                    self.push_usage(&sid, used, window);
                }
                // turn/stopped 是「本轮结束」而非「整个会话完成」。顶层会话
                // 正常收尾后回 idle；finished 只留给真正终结的子任务。
                let status = match stop_reason {
                    "complete" => SessionStatus::Idle,
                    "error" => SessionStatus::Error,
                    "max_turns" => SessionStatus::Error,
                    "interrupted" => SessionStatus::Interrupted,
                    other => {
                        eprintln!("[desktop] 未知 turn/stopped.stop_reason={other},按 error 收尾");
                        SessionStatus::Error
                    }
                };
                if stop_reason == "error" && !err.is_empty() {
                    self.push_frame(&sid, |seq| frame::task_error(&err, seq));
                }
                self.push_frame(&sid, frame::task_ended);
                // sidecar 状态落盘(重启后列表可见;write_sidecar 一并刷 updated_at)
                self.write_sidecar(&sid, |m| m["status"] = json!(status.as_str()));
                self.emit_session_event(&sid, status.as_str());
            }
            // 背压丢帧上报(modelDoneText):进程级累计计数,不可丢通知。
            // 仅日志外显——按会话的缺口定位靠 eventSeq 空洞,文本找回靠
            // model_done 全文对账(handle_event),此处不动帧流
            "events/dropped" => {
                let n = params.get("count").and_then(|v| v.as_u64()).unwrap_or(0);
                eprintln!("[desktop] 引擎背压丢弃 {n} 条流式事件(全文将经 model_done 对账补齐)");
            }
            _ => {}
        }
    }

    /// event/stream 事件归一化 → Frame。
    pub(super) fn handle_event(&self, event: Value) {
        let etype = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let raw = event.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
        if raw.is_empty() {
            return;
        }
        let sid = self.shell_sid_of(raw);
        let data = event.get("data").cloned().unwrap_or(Value::Null);
        // provider 瞬时错误(kind=transient_retry,loop.go 的
        // isTransientProviderErr 重试路径)引擎自动退避重试后继续跑,
        // 不产 task_error——否则 UI 先报"任务出错"随后任务又正常完成;
        // 仅记日志。终止性 error(无 kind)走下方常规分支不变。早于子代理
        // 认领判断返回:不为一条重试日志物化子会话
        if etype == "error" && data.get("kind").and_then(|v| v.as_str()) == Some("transient_retry") {
            let msg = data.get("error").and_then(|v| v.as_str()).unwrap_or("");
            eprintln!("[desktop] 引擎瞬时错误,自动重试中: {msg}");
            return;
        }
        // 未知 session_id = 上游转发的子代理事件(子循环随机 id):
        // 认领并物化为壳侧子会话,后续事件走正常帧路径;认领不到(迟到)丢弃
        if !self.sess.sessions.lock_ok().contains_key(&sid) && !self.claim_subagent(&sid, &event) {
            return;
        }
        // eventSeq:事件带会话内单调 seq(被背压丢弃的 delta 仍占号),
        // 空洞即丢帧信号,记日志外显(文本缺口由 model_done 对账补齐,
        // 此处只负责"发生过丢弃"的可观测性);seq 回落视为引擎侧会话
        // 重建(destroy+create 换绑)后重新起算,水位跟随重置。
        // 旧引擎不带 seq 字段,自然跳过——无需 caps 门控
        if let Some(eseq) = event.get("seq").and_then(|v| v.as_u64()).filter(|s| *s > 0) {
            if let Some(s) = self.sess.sessions.lock_ok().get_mut(&sid) {
                if s.last_event_seq > 0 && eseq > s.last_event_seq + 1 {
                    eprintln!(
                        "[desktop] 会话 {sid} 事件 seq 空洞 {}→{eseq}(背压丢弃 {} 条)",
                        s.last_event_seq,
                        eseq - s.last_event_seq - 1
                    );
                }
                s.last_event_seq = eseq;
            }
        }
        // 子代理事件在父卡进度窗同步一份内联预览(非子代理为 no-op)
        self.subagent_feed(&sid, etype, &event, &data);
        match etype {
            // user_message:引擎回显忽略——session_send 已本地先行落 user-input
            // 帧(ack 与事件无时序保证,双写会重复气泡)
            "user_message" => {}
            "model_delta" => {
                let text = data.get("text").and_then(|v| v.as_str()).unwrap_or("");
                // modelDoneText 对账:累积本段实收流式文本(旧引擎不宣告
                // 则不累积,免白耗内存;对账逻辑见 model_done 分支)
                if !text.is_empty() && self.has_cap("modelDoneText") {
                    if let Some(s) = self.sess.sessions.lock_ok().get_mut(&sid) {
                        s.model_text.push_str(text);
                    }
                }
                self.push_frame(&sid, |seq| frame::agent_text(text, seq));
            }
            // 新一段模型输出:重置对账累积(上一段 model_done 缺席/中断的
            // 残留不得跨段污染前缀比对)
            "model_start" => {
                if let Some(s) = self.sess.sessions.lock_ok().get_mut(&sid) {
                    s.model_text.clear();
                }
            }
            // model_done 全文对账(modelDoneText;轮次边界仍以 turn/stopped
            // 为准):text 是本段**权威全文**,壳侧累积为其前缀且更短说明
            // delta 被背压丢弃——把缺口补成一条增量帧(走 frame.rs 正规
            // 产帧路径,journal 与 UI 因此同步补齐);完全不一致仅记日志,
            // 不覆写已渲染的流(覆写需要 UI 侧替换语义,帧词汇没有)
            "model_done" => {
                let full = data.get("text").and_then(|v| v.as_str()).unwrap_or("");
                let acc = {
                    let mut sessions = self.sess.sessions.lock_ok();
                    sessions.get_mut(&sid).map(|s| std::mem::take(&mut s.model_text)).unwrap_or_default()
                };
                if full.is_empty() || !self.has_cap("modelDoneText") {
                    // 兼容尾巴:旧引擎 model_done 无 text,无从对账
                } else if let Some(missing) =
                    full.strip_prefix(acc.as_str()).filter(|m| !m.is_empty())
                {
                    eprintln!(
                        "[desktop] 会话 {sid} 流式文本缺 {} 字节(背压丢弃),按 model_done 全文补齐",
                        missing.len()
                    );
                    self.push_frame(&sid, |seq| frame::agent_text(missing, seq));
                } else if full != acc {
                    eprintln!(
                        "[desktop] 会话 {sid} 流式累积与 model_done 全文不一致(壳 {} 字节 / 权威 {} 字节),不自动改写",
                        acc.len(),
                        full.len()
                    );
                }
            }
            "thinking_delta" => {
                let text = data.get("text").and_then(|v| v.as_str()).unwrap_or("");
                self.push_frame(&sid, |seq| frame::agent_thought(text, seq));
            }
            "tool_call" => {
                let tc_id = event
                    .get("tool_call_id")
                    .and_then(|v| v.as_str())
                    .or_else(|| data.get("id").and_then(|v| v.as_str()))
                    .unwrap_or("")
                    .to_string();
                let name = data.get("name").and_then(|v| v.as_str()).unwrap_or("工具调用").to_string();
                let input = data.get("input").cloned().unwrap_or(Value::Null);
                let title = perm_title(&name, &input);
                if !tc_id.is_empty() {
                    if let Some(s) = self.sess.sessions.lock_ok().get_mut(&sid) {
                        s.open_tools.insert(tc_id.clone(), name.clone());
                    }
                    if name == "Agent" {
                        // 暂存入参:子会话物化时作标题(description)与首条输入(prompt)
                        let desc = input
                            .get("description")
                            .and_then(|v| v.as_str())
                            .unwrap_or("子代理")
                            .to_string();
                        let prompt =
                            input.get("prompt").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        self.sub.agent_inputs.lock_ok().insert(tc_id.clone(), (desc, prompt));
                    }
                }
                self.push_frame(&sid, |seq| frame::tool_call(&tc_id, &title, &input, seq));
            }
            // 同步子代理的全量结构化结果(structuredToolResult):引擎先发
            // 此事件(content 不截断)再回 tool_result(截断 500 字符,可能
            // 把结果 JSON 截成半截,subagent.go deliverSyncResult 的顺序
            // 保证)——暂存到 tc_id,随后 tool_result 闭合工具卡时消费。
            // 后台子代理不发此事件(其结果走 task_notification)
            "agent_result" => {
                let tc = event.get("tool_call_id").and_then(|v| v.as_str()).unwrap_or("");
                if !tc.is_empty() {
                    let status =
                        data.get("status").and_then(|v| v.as_str()).unwrap_or("completed").to_string();
                    let content =
                        data.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    self.sub.agent_results.lock_ok().insert(tc.to_string(), (status, content));
                }
            }
            "tool_result" => {
                let tc_id = event.get("tool_call_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let content = data.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let name = self
                    .sess.sessions
                    .lock_ok()
                    .get_mut(&sid)
                    .and_then(|s| s.open_tools.remove(&tc_id));
                // 失败判定:结构化错误位优先(structuredToolResult 的
                // is_error);兼容尾巴:旧引擎无错误位,只能按 b02fc77 约定
                // 嗅探 "Error: " 前缀(误伤正常输出恰以此开头的工具)
                let mut is_error = if self.has_cap("structuredToolResult") {
                    data.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false)
                } else {
                    content.starts_with("Error: ")
                };
                // Agent 工具结果:agent_result 暂存(全量,不截断)为权威;
                // 无暂存时先分流 async_launched(显式后台的应答,
                // 引擎 subagent.go asyncLaunchedResult——**没有 content 字段**,
                // 走下面的退回解析会 unwrap_or 把整段原始 JSON 灌进卡),
                // 其余退回解析截断 500 字符的 {status,…,content} JSON——
                // 可能破损,解析失败原样退回(兼容尾巴)
                let stashed =
                    if tc_id.is_empty() { None } else { self.sub.agent_results.lock_ok().remove(&tc_id) };
                let is_agent = name.as_deref() == Some("Agent");
                if is_agent && stashed.is_none() && !is_error {
                    if let Some(resp) = serde_json::from_str::<Value>(content)
                        .ok()
                        .filter(|v| v.get("status").and_then(|s| s.as_str()) == Some("async_launched"))
                    {
                        // 子代理还活着:不关路由,登记后台,友好文案闭卡
                        self.background_agent_launched(&sid, &tc_id, &resp);
                        return;
                    }
                }
                let content: String = if is_agent {
                    match stashed {
                        Some((status, full)) => {
                            if status == "error" {
                                // 同步子代理失败:引擎把 "Sub-agent error: …"
                                // 当正常结果回给模型(is_error=false),壳侧
                                // 失败位以 agent_result.status 为准
                                is_error = true;
                            }
                            full
                        }
                        None if !is_error => serde_json::from_str::<Value>(content)
                            .ok()
                            .and_then(|v| v.get("content").and_then(|c| c.as_str()).map(str::to_string))
                            .unwrap_or_else(|| content.to_string()),
                        None => content.to_string(),
                    }
                } else {
                    content.to_string()
                };
                let content = content.as_str();
                // Agent 工具闭合:清对应子代理路由(残留行缓冲先冲洗成尾行)
                self.close_subagents_of(&sid, &tc_id, SessionStatus::Finished);
                if is_error {
                    // 失败工具 → failed 帧,否则 UI 渲染成绿勾
                    self.push_frame(&sid, |seq| frame::tool_call_failed(&tc_id, content, seq));
                } else {
                    // 结果文本里的工作区上传路径(浏览器截图等)→ 工具卡内联图
                    let images = extract_upload_paths(content);
                    self.push_frame(&sid, |seq| {
                        frame::tool_call_completed(&tc_id, content, &images, seq)
                    });
                }
            }
            "send_user_message" | "task_notification" => {
                let msg = data
                    .get("message")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .unwrap_or_else(|| data.as_str().unwrap_or("").to_string());
                if msg.is_empty() {
                    return;
                }
                if etype == "task_notification" {
                    // 后台代理完成:登记在案 → Result 正文回填父 Agent 卡 +
                    // 📌 系统行(独立渲染项)。旧行为把整段渲染消息当
                    // agent_text 混进模型正文气泡——<task-notification>
                    // 标签行被 markdown 当 HTML 块吞掉,Result 正文散落
                    // 主流,看着像主/子代理消息交织
                    if !self.background_agent_finished(&data, &msg) {
                        // 反查不到(壳重启丢登记/SendMessage 续跑的二次完成/
                        // 旧引擎):整段外显兜底,剥包装标签防 markdown 吞块
                        let inner = super::subagent::strip_notification_tags(&msg);
                        self.push_frame(&sid, |seq| frame::agent_text(&format!("\n\n📌 {inner}\n\n"), seq));
                    }
                    return;
                }
                self.push_frame(&sid, |seq| frame::agent_text(&msg, seq));
            }
            // TodoWrite 全量清单:引擎专发 todo_update 事件供 host 渲染实时
            // 勾选卡(tool_result 只有截断 500 字符的纯文本,不能用来渲染)
            "todo_update" => {
                let todos = data.get("todos").cloned().unwrap_or_else(|| serde_json::json!([]));
                self.push_frame(&sid, |seq| frame::plan(&todos, seq));
            }
            // 主循环在每次模型调用收到 provider usage 时发一次；压缩/清空
            // 上下文后也会发。只取 context_*，不用本轮累计 input/output
            // 冒充占用。按事件自身 session_id 落帧，子代理用量不会污染父
            // 会话 composer 的主 Agent 上下文环。
            "usage" => {
                if let Some((used, window)) = context_usage_fields(&data) {
                    self.push_usage(&sid, used, window);
                }
                self.record_usage(&sid, &data);
            }
            // 会话摘要:引擎每轮用户消息后异步生成一句 ≤60 字的对话摘要
            // (随对话演进改写,后一轮覆盖前一轮),只给顶层会话生成。
            // 落 sidecar 的 summary 字段供顶栏副标题展示——标题归用户
            // (双击改名)与首条消息,摘要不参与命名。
            "session_summary" => {
                // 上限防御:引擎的提示词卡在 60 字符,但落盘/渲染不该指望
                // 对端守约;按字符截断(String::truncate 是字节索引,中文会 panic)
                let raw = data.get("summary").and_then(|v| v.as_str()).unwrap_or("").trim();
                let summary: String = raw.chars().take(120).collect();
                if summary.is_empty() {
                    return;
                }
                // 子代理子会话没有列表行也没有顶栏(引擎侧压根不给它们生成,
                // 这里是防御)。判据 parent 与 sessions_list 的过滤同源
                let meta = self.read_sidecar(&sid);
                if meta.get("parent").and_then(|v| v.as_str()).is_some_and(|p| !p.is_empty()) {
                    return;
                }
                self.write_sidecar_keep_updated(&sid, |m| m["summary"] = json!(summary.as_str()));
                self.emit_session_summary(&sid, &summary);
            }
            // 微压缩(kind=micro)只是清空旧 tool_result,不调模型也与"接近
            // 上限"无关,且触发频繁;不落帧,免得对话流反复刷压缩提示。
            // 其余 kind(auto/manual/partial/local_fallback)才是整体压缩。
            "compaction" => {
                if data.get("kind").and_then(|v| v.as_str()) == Some("micro") {
                    return;
                }
                // 引擎只有"压缩完成"这一个事件。手动压缩(compacting 在飞,
                // 判据不看 kind:LLM 失败会降级成 local_fallback)发起时壳已
                // 实时落过 "started",这里只补收尾——再合成一对的话"正在
                // 压缩/压缩完成"会同刻蹦出两条。自动压缩没有发起方落帧,
                // 保持事后补一对的旧形态,记录读起来仍有始有终。
                let manual = self
                    .sess
                    .sessions
                    .lock_ok()
                    .get(&sid)
                    .map(|s| s.compacting)
                    .unwrap_or(false);
                if !manual {
                    self.push_frame(&sid, |seq| frame::compact_status("started", seq));
                }
                self.push_frame(&sid, |seq| frame::compact_status("ended", seq));
            }
            "error" => {
                let msg = data.get("error").and_then(|v| v.as_str()).unwrap_or("未知错误");
                self.push_frame(&sid, |seq| frame::task_error(msg, seq));
            }
            // turn_done:轮次边界以 turn/stopped 为准
            _ => {}
        }
    }

    /// usage 事件里的 input/output tokens → 用量统计(按天/会话/模型)。
    /// 引擎每次模型调用发一个 usage 事件,input/output 为该调用全量,直接
    /// 累加进对应桶。模型取会话当前 model_name——运行中不可切模型,归属
    /// 可靠。只记 input/output 非 0 的事件(纯 context 快照不记账)。
    pub(super) fn record_usage(&self, sid: &str, data: &Value) {
        let input = data.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        let output = data.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        if input == 0 && output == 0 {
            return;
        }
        // 跨组嵌套仅 subagents → sessions 一条(见 ohmy.rs::Inner),先取子代理
        let parent = self.sub.subagents.lock_ok().get(sid).map(|r| r.parent_sid.clone());
        let (model, title) = {
            let sessions = self.sess.sessions.lock_ok();
            match sessions.get(sid) {
                Some(s) => (s.model_name.clone(), s.title.clone()),
                None => (String::new(), String::new()),
            }
        };
        self.stats.record(
            &crate::stats::today(),
            sid,
            &title,
            &model,
            parent.as_deref(),
            input,
            output,
        );
    }
}

/// 上下文占用字段防腐层。13c8adc 起所有新入口统一为扁平
/// context_used/context_window；兼容此前 turn/stopped.context 的旧形状。
/// window 出现即表示这是一条上下文快照，used 缺省按 0 处理（清空语义）。
fn context_usage_fields(v: &Value) -> Option<(i64, i64)> {
    if let Some(window) = v.get("context_window").and_then(Value::as_i64) {
        return Some((v.get("context_used").and_then(Value::as_i64).unwrap_or(0), window));
    }
    let legacy = v.get("context")?;
    Some((
        legacy.get("used_tokens").and_then(Value::as_i64).unwrap_or(0),
        legacy.get("window_tokens").and_then(Value::as_i64)?,
    ))
}

/// 工具标题:「名称 主参数」(「动词 目标」的可读形态)。
/// 从工具结果文本提取工作区上传路径(.monkeycode/uploads/…):
/// 浏览器截图等壳内生成物经文本路径外显,驱动转成工具卡 images。
pub(super) fn extract_upload_paths(content: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = content;
    while let Some(i) = rest.find(".monkeycode/uploads/") {
        let tail = &rest[i..];
        let end = tail.find(|c: char| c.is_whitespace() || c == ')' || c == '"' || c == ',').unwrap_or(tail.len());
        let p = &tail[..end];
        // 该字段契约是"工具产出图片":docx/json 等附件路径进了 images 会被
        // UI 塞进 <img> 渲染成裂图(octet-stream 数据 URL 解不出位图)
        if p.len() > ".monkeycode/uploads/".len()
            && crate::uploads::is_image_path(p)
            && !out.iter().any(|x| x == p)
        {
            out.push(p.to_string());
        }
        rest = &rest[i + end.max(1)..];
    }
    out
}

pub(super) fn perm_title(tool: &str, input: &Value) -> String {
    // description 兜底:Agent/任务类工具的 3-5 词任务描述作卡片标签
    // (与引擎 TUI 的子代理活动面板同源,6a61cfd)
    let arg = ["file_path", "path", "command", "pattern", "url", "cwd", "description"]
        .iter()
        .find_map(|k| input.get(k).and_then(|v| v.as_str()))
        .unwrap_or("");
    if arg.is_empty() {
        tool.to_string()
    } else {
        let short: String = arg.chars().take(80).collect();
        format!("{tool} {short}")
    }
}
