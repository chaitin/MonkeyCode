// Frame 词汇的唯一定义(产帧权威;词汇源自旧 Go 内核的 frame.go,
// git 历史可查)。
//
// 对表:本模块产帧、UI 消费(desktop/ui/src/{types.ts,reduce.ts})——
// 任何新帧类型/字段先改这里与 types.ts,driver 禁止手拼 Frame JSON。
//
// 帧结构:{ type, kind?, data?(内联 JSON 对象), timestamp(ms), seq }
// task-running + acp_event 的 data 为 { update: { sessionUpdate, ... } }。
//
// 历史:data 曾编码为 base64(JSON) 字符串(对齐旧 Go 内核 []byte 的
// JSON 序列化)——纯历史包袱,双重编码 +33% 体积已去除。兼容边界:
// ① 用户磁盘上的存量 journal(events.jsonl)仍是旧格式,回放原样转发,
//    由 UI 侧 codec.ts::frameData 双格式容错解码;
// ② 云端任务流的帧来自云端服务(壳只做管道透传,契约不归本仓库),
//    同样由 frameData 容错。壳侧不再产旧格式。
//
// Rust→TS 类型生成:Frame/SessionStatus/PermOutcome 带 ts_rs 导出
// (derive 经 cfg_attr(test) 门控,不进产物二进制)。再生成命令:
//   cargo test export_bindings
// 产出 desktop/ui/src/gen/(生成物入库,勿手改);ui/src/types.ts 从
// gen/ 复用这些类型,手写与注释对表自此只剩"跑一次生成"。

use base64::Engine as _;
use serde_json::{json, Value};

/// 会话状态词汇(SessionMeta.status;UI/桌宠按此渲染,勿用裸字符串)。
/// ts-rs 导出 → ui/src/gen/SessionStatus.ts(types.ts 复用);
/// rename_all 小写与 as_str 一致(两处同改才算改)。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../ui/src/gen/", rename_all = "lowercase"))]
pub enum SessionStatus {
    Created,
    Running,
    /// 当前轮已正常结束，会话空闲并可继续发送消息。
    Idle,
    /// 真正结束的子任务；顶层本地会话不以一轮回复作为完成。
    Finished,
    Interrupted,
    Error,
}

impl SessionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionStatus::Created => "created",
            SessionStatus::Running => "running",
            SessionStatus::Idle => "idle",
            SessionStatus::Finished => "finished",
            SessionStatus::Interrupted => "interrupted",
            SessionStatus::Error => "error",
        }
    }
}

/// 审批终态词汇(permission-resolved.outcome)。
/// ts-rs 导出 → ui/src/gen/PermOutcome.ts(rename_all 小写与 as_str 一致)。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../ui/src/gen/", rename_all = "lowercase"))]
pub enum PermOutcome {
    Approved,
    Denied,
    Timeout,
    Cancelled,
}

impl PermOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            PermOutcome::Approved => "approved",
            PermOutcome::Denied => "denied",
            PermOutcome::Timeout => "timeout",
            PermOutcome::Cancelled => "cancelled",
        }
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// user-input.content 的文本编码(帧内嵌字段,与云端上行格式一致;
/// 区别于已去除的 data 层 base64——这是上行/回显契约,保留)。
pub fn b64_text(s: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(s)
}

/// 下行帧 wire 结构:所有产帧经 build() 走这里序列化,类型即契约。
/// ts-rs 导出 → ui/src/gen/Frame.ts(types.ts 在此之上放宽 data/seq/
/// timestamp 以容存量 journal 与云端帧,见 ui/src/types.ts::Frame)。
#[derive(serde::Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "../ui/src/gen/"))]
pub struct Frame {
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub kind: Option<String>,
    /// 内联 JSON 对象载荷(产帧侧恒为对象;历史 base64 格式见模块头注)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional, type = "Record<string, unknown>"))]
    pub data: Option<Value>,
    /// Unix 毫秒
    #[cfg_attr(test, ts(type = "number"))]
    pub timestamp: u64,
    /// 会话内单调帧序号(回放/去重锚点)
    #[cfg_attr(test, ts(type = "number"))]
    pub seq: u64,
}

fn build(ftype: &str, kind: Option<&str>, payload: Option<Value>, seq: u64) -> Value {
    // Frame 的所有字段都是 JSON 安全类型,to_value 不可能失败
    serde_json::to_value(Frame {
        r#type: ftype.to_string(),
        kind: kind.map(str::to_string),
        data: payload,
        timestamp: now_ms(),
        seq,
    })
    .unwrap_or_default()
}

fn acp(update: Value, seq: u64) -> Value {
    build("task-running", Some("acp_event"), Some(json!({ "update": update })), seq)
}

// ==================== 顶层帧 ====================

pub fn task_started(seq: u64) -> Value {
    build("task-started", None, None, seq)
}

pub fn task_ended(seq: u64) -> Value {
    build("task-ended", None, None, seq)
}

pub fn task_error(msg: &str, seq: u64) -> Value {
    build("task-error", None, Some(json!({ "error": msg })), seq)
}

/// 引擎已报告错误/告警，但轮次尚未以 turn/stopped 权威收尾。沿用
/// task-error 的展示词汇并显式标 terminal=false，让新 UI 保持 running；
/// 缺字段的旧帧仍按历史语义视为终止，云端拒绝帧不受影响。
pub fn task_error_pending(msg: &str, seq: u64) -> Value {
    build("task-error", None, Some(json!({ "error": msg, "terminal": false })), seq)
}

/// 用户输入回显(content 为 base64 文本,与云端上行格式一致)。
pub fn user_input(text: &str, seq: u64) -> Value {
    build("user-input", None, Some(json!({ "content": b64_text(text) })), seq)
}

/// tool_call_id:引擎透传的 provider 工具调用 id(permissionToolCallId cap,
/// 与先行到达的 tool_call 帧同 id)。UI 据此把审批按钮嵌进对应工具卡;
/// 空则省略字段(旧引擎/provider 未给 id),UI 回退独立审批大卡。
pub fn permission_req(id: &str, tool: &str, title: &str, tool_call_id: &str, seq: u64) -> Value {
    let mut d = json!({ "id": id, "tool": tool, "title": title });
    if !tool_call_id.is_empty() {
        d["tool_call_id"] = json!(tool_call_id);
    }
    build("permission-req", None, Some(d), seq)
}

pub fn permission_resolved(id: &str, outcome: PermOutcome, seq: u64) -> Value {
    build("permission-resolved", None, Some(json!({ "id": id, "outcome": outcome.as_str() })), seq)
}

/// 提问卡答复回显(回放可见答案;request_id 即 askId)。
pub fn reply_question(request_id: &str, answers_json: &str, cancelled: bool, seq: u64) -> Value {
    build(
        "reply-question",
        None,
        Some(json!({ "request_id": request_id, "answers_json": answers_json, "cancelled": cancelled })),
        seq,
    )
}

/// AI 提问卡(kind=acp_ask_user_question 即一等公民标记,reduce.ts 直接消费
/// toolCall.rawInput.questions,不走 tool_call 的标题启发式)。
pub fn ask_user_question(request_id: &str, questions: &Value, seq: u64) -> Value {
    build(
        "task-running",
        Some("acp_ask_user_question"),
        Some(json!({ "toolCall": {
            "toolCallId": request_id,
            "title": "Ask User Question",
            "kind": "ask-user-question",
            "status": "in_progress",
            "rawInput": { "questions": questions },
        } })),
        seq,
    )
}

// ==================== ACP session update 帧 ====================

pub fn agent_text(delta: &str, seq: u64) -> Value {
    acp(json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": delta } }), seq)
}

pub fn agent_thought(delta: &str, seq: u64) -> Value {
    acp(json!({ "sessionUpdate": "agent_thought_chunk", "content": { "type": "text", "text": delta } }), seq)
}

/// TodoWrite 计划清单(引擎 todo_update 事件的 todos 数组,条目
/// {content,status[,activeForm]})→ ACP plan 帧,UI 渲染 PlanCard 勾选卡。
pub fn plan(entries: &Value, seq: u64) -> Value {
    acp(json!({ "sessionUpdate": "plan", "entries": entries }), seq)
}

pub fn tool_call(tc_id: &str, title: &str, raw_input: &Value, seq: u64) -> Value {
    acp(
        json!({ "sessionUpdate": "tool_call", "toolCallId": tc_id, "title": title,
            "status": "in_progress", "rawInput": raw_input }),
        seq,
    )
}

/// images:工具产出图片的工作区相对路径(UI 工具卡内联渲染,经 upload_read 回读)。
pub fn tool_call_completed(tc_id: &str, raw_output: &str, images: &[String], seq: u64) -> Value {
    let mut u = json!({ "sessionUpdate": "tool_call_update", "toolCallId": tc_id,
        "status": "completed", "rawOutput": raw_output });
    if !images.is_empty() {
        u["images"] = json!(images);
    }
    acp(u, seq)
}

/// 工具执行期进度(status=in_progress + progress 载荷;词汇见 types.ts
/// ToolProgress:subagent_tool/subagent_text/output/child_session)。
/// 子代理活动即经此挂到父会话 Agent 工具卡的进度窗。
pub fn tool_call_progress(tc_id: &str, progress: Value, seq: u64) -> Value {
    acp(
        json!({ "sessionUpdate": "tool_call_update", "toolCallId": tc_id,
            "status": "in_progress", "progress": progress }),
        seq,
    )
}

/// 工具失败/中断收尾。ohmyagent 的工具错误路径不发 tool_result 事件
/// (错误只进模型消息),由驱动在轮次结束时对未闭合的 tool_call 补此帧,
/// 否则 UI 工具卡永远转圈。
pub fn tool_call_failed(tc_id: &str, raw_output: &str, seq: u64) -> Value {
    acp(
        json!({ "sessionUpdate": "tool_call_update", "toolCallId": tc_id,
            "status": "failed", "rawOutput": raw_output }),
        seq,
    )
}

/// 上下文用量(环形指示):used = 当前 Agent 历史 + system prompt 的
/// token 估算，size = 模型上下文预算；不使用含子代理的整轮累计用量。
pub fn usage_update(used: i64, size: i64, seq: u64) -> Value {
    acp(json!({ "sessionUpdate": "usage_update", "used": used, "size": size }), seq)
}

pub fn compact_status(status: &str, seq: u64) -> Value {
    acp(json!({ "sessionUpdate": "compact_status", "status": status }), seq)
}

/// 后台子代理完成通知(📌):独立系统行。不复用 agent_text——它会被
/// reduce.ts 并进正在流式的模型正文气泡,通知与模型的话混作一团。
pub fn task_note(text: &str, seq: u64) -> Value {
    acp(json!({ "sessionUpdate": "task_notification", "text": text }), seq)
}

pub fn model_update(model: &str, seq: u64) -> Value {
    acp(json!({ "sessionUpdate": "model_update", "model": model }), seq)
}

/// 会话思考档位变更(""=跟随模型默认);与 model_update 同形,UI 据此
/// 同步 composer 的思考深度选择器。
pub fn think_update(think: &str, seq: u64) -> Value {
    acp(json!({ "sessionUpdate": "think_update", "think": think }), seq)
}

pub fn permission_mode_update(mode: &str, seq: u64) -> Value {
    acp(json!({ "sessionUpdate": "permission_mode_update", "mode": mode }), seq)
}
