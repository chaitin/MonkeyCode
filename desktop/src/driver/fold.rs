// 回放折叠 + 「一轮一行」的 replay.jsonl 存取。
//
// 为什么存在:events.jsonl 是「一 token 一帧」的原始流,打开会话要把它整份
// 搬到 UI——实测一份 3 轮真实会话 8965 帧 / 1.9MB,其中 98.5% 是最终只会被
// 合并成个位数气泡的流式碎片。折叠把同类连续碎片并回一帧,再按「一轮一行」
// 落到 replay.jsonl:打开只读尾部若干轮,成本与历史长度解耦。
//
// **折叠是等价变换**:UI 侧 reduceBatch(原始) 与 reduceBatch(折叠) 结果逐字段
// 相同。守卫是 fixtures/replay/ 的合成素材(覆盖旧 base64、被打断的流式段、
// 覆盖语义帧、审批、提问卡、图片),Rust 钉输出、TS 钉语义;落地时另在 4 份
// 真实 journal 上验过(8965→89 帧 / 1.85MB→78KB,归约结果逐字段相同)。规则:
// - `agent_message_chunk`/`agent_thought_chunk`:**严格相邻**的同类合并,text
//   拼接,保留首帧 timestamp/seq(reduce 的 appendStream 只在新建项时取
//   timestamp,合并时忽略)。不相邻则不合并——保守规则,不必复刻 reduce 里
//   streamKind + last-item 的全部细节,也就不会因为那些细节演化而失配。
// - `usage_update`/`plan`:整轮只留一帧,首现位置就地更新为最新值。两者在
//   reduce 里都是整体覆盖、不碰 items 也不碰 streamKind,所以既不打断上面的
//   相邻性判定,轮末状态也与原始一致。
// - 其余帧原样保留,并打断流式相邻性。
//
// 折叠之外还有一道**大字段护栏**(Turn::guard),只在物化那一刻施加:超限的
// 工具字段截到头部 + `_meta.mcSrc`,全文按 seq 从 events.jsonl 回读。它是有意
// 的有损变换,**不在等价性契约内**——所以它长在 Turn::guard 而不是折叠里。
//
// 落盘格式(replay.jsonl,一行一轮):
//   {"from":首帧 seq,"to":末帧 seq,"src_end":events.jsonl 字节偏移,"frames":[…]}
// `src_end` 是这一轮写完时 events.jsonl 的长度,打开时据此只读「尚未物化的
// 尾巴」。崩溃只会让最后一行不完整 → 解析失败被跳过 → 那一轮退回原始帧回放,
// 不会丢也不会重。

use std::collections::HashMap;
use std::io::{Read as _, Seek as _, SeekFrom};
use std::path::Path;

use base64::Engine as _;
use serde_json::{json, Value};

/// 打开时回放的尾部窗口:最多这么多轮
pub(super) const TAIL_TURNS: usize = 20;
/// 且最多这么多帧(长轮次一轮就顶满时,至少保证完整的一轮)
pub(super) const TAIL_FRAMES: usize = 3000;

/// 工具字段超过这个字节数就在物化时截断。折叠拿走的是数量级(实测 1.9MB →
/// 77KB),折叠之后 tool_call/tool_call_update 反而成了大头(5 份真实会话里
/// 占折叠后体积的 13%~83%)。但它的价值**不是省中位数**(按 4KB 阈值也只
/// 再省 33%),而是**削峰**:一次 Read 读 2MB 文件、一次大 diff、一张 base64
/// 图,单帧就能几 MB,折叠对这类完全无效。
const FIELD_LIMIT: usize = 4096;
/// 截断后行内保留的头部(足够卡片折叠态的首行摘要与多数展开场景)
const FIELD_HEAD: usize = 1024;

// ==================== 帧检视 ====================

/// 帧 data 归一为内联对象。旧 journal 的 data 是 base64(JSON) 字符串
/// (frame.rs 模块头有历史说明),折叠输出一律内联对象——UI 的 frameData
/// 两种都吃,老会话物化之后就此不再每帧 atob。
fn inline_data(f: &Value) -> Option<Value> {
    match f.get("data") {
        Some(Value::String(s)) => base64::engine::general_purpose::STANDARD
            .decode(s)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok()),
        Some(Value::Null) | None => None,
        Some(v) => Some(v.clone()),
    }
}

/// data 已是内联对象则原样返回,否则重写成内联对象形态。
fn normalized(f: &Value) -> Value {
    match f.get("data") {
        Some(Value::String(_)) => {
            let mut nf = f.clone();
            match inline_data(f) {
                Some(d) => nf["data"] = d,
                // 解不开的 data 保持原样:宁可让 UI 按坏载荷处理,也不丢帧
                None => return f.clone(),
            }
            nf
        }
        _ => f.clone(),
    }
}

fn session_update(data: &Value) -> Option<&str> {
    data.get("update")?.get("sessionUpdate")?.as_str()
}

/// 可合并的流式帧 → 其 sessionUpdate;content 不是 `{type:"text"}` 的
/// 一律不合并(图片等结构化载荷拼不了)
fn stream_kind(data: &Value) -> Option<&str> {
    let u = data.get("update")?;
    let su = u.get("sessionUpdate")?.as_str()?;
    if su != "agent_message_chunk" && su != "agent_thought_chunk" {
        return None;
    }
    let c = u.get("content")?;
    (c.get("type").and_then(|v| v.as_str()) == Some("text") && c.get("text").is_some())
        .then_some(su)
}

fn chunk_text(f: &Value) -> Option<&str> {
    f.get("data")?.get("update")?.get("content")?.get("text")?.as_str()
}

fn is_overwrite(su: &str) -> bool {
    su == "usage_update" || su == "plan"
}

fn frame_seq(f: &Value) -> u64 {
    f.get("seq").and_then(|v| v.as_u64()).unwrap_or(0)
}

pub(super) fn is_turn_end(f: &Value) -> bool {
    f.get("type").and_then(|v| v.as_str()) == Some("task-ended")
}

/// 帧序列是否停在未闭合的轮次上(有 task-started,其后没有 task-ended)。
/// 判据与 is_turn_end 同源:壳的收尾恒为 task-error → task-ended,被硬杀在
/// 两者之间同样算未闭合(补一帧 task-ended 即可,重复的错误文案不会出现)。
pub(super) fn unterminated(frames: &[Value]) -> bool {
    for f in frames.iter().rev() {
        match f.get("type").and_then(|v| v.as_str()) {
            Some("task-ended") => return false,
            Some("task-started") => return true,
            _ => {}
        }
    }
    false
}

// ==================== 大字段护栏 ====================

/// 按字符边界把字符串截到 head 字节以内。
fn cut(s: &str, head: usize) -> String {
    let mut end = head.min(s.len());
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}

/// 递归截断过长的字符串叶子,**保持结构不变**(UI 的 toolResultText /
/// presentToolCall 依赖字段形状,换成占位对象会渲染出乱七八糟的东西)。
/// 返回是否截断过。
fn truncate_strings(v: &mut Value, head: usize) -> bool {
    match v {
        Value::String(s) if s.len() > head => {
            *s = cut(s, head);
            true
        }
        Value::Array(items) => items.iter_mut().fold(false, |acc, x| truncate_strings(x, head) || acc),
        Value::Object(map) => {
            map.iter_mut().fold(false, |acc, (_, x)| truncate_strings(x, head) || acc)
        }
        _ => false,
    }
}

/// 物化前给工具帧的大字段做护栏:超限即就地截断,并在 `_meta.mcSrc` 留下
/// 回读凭据(seq)。完整正文本来就躺在 events.jsonl 里(审计源,不删),
/// 所以**不建 blobs/**——省掉一份重复存储、哈希与孤儿回收。
/// `_meta` 是既有的透传扩展点,reduce 原样带到 LogItem 上,归约层零改动。
fn guard_big_fields(nf: &mut Value) -> bool {
    let seq = frame_seq(nf);
    let Some(update) = nf.pointer_mut("/data/update") else { return false };
    let su = update.get("sessionUpdate").and_then(|v| v.as_str()).unwrap_or("");
    if su != "tool_call" && su != "tool_call_update" {
        return false;
    }
    let mut cut_any = false;
    for key in ["rawInput", "rawOutput", "content"] {
        let Some(field) = update.get_mut(key) else { continue };
        // 只丈量一次:小字段(绝大多数)不进递归
        if serde_json::to_string(field).map(|s| s.len()).unwrap_or(0) <= FIELD_LIMIT {
            continue;
        }
        cut_any |= truncate_strings(field, FIELD_HEAD);
    }
    if cut_any {
        update["_meta"]["mcSrc"] = json!({ "seq": seq });
    }
    cut_any
}

// ==================== 增量折叠器 ====================

/// 一轮的增量折叠。挂在 SessionState 上,push_frame 逐帧喂;轮末
/// (task-ended)取走整轮结果投给 journal 写线程。
///
/// 增量而非「攒原始帧再折叠」:内存里只留折叠后的百来帧,长轮次
/// (一次 10 万 token 输出)不会把原始碎片堆在内存里。
#[derive(Default)]
pub(super) struct TurnFold {
    out: Vec<Value>,
    /// out 中可继续拼接的流式帧 (下标, sessionUpdate)
    tail: Option<(usize, String)>,
    /// 覆盖语义帧的首现位置(sessionUpdate → out 下标)
    over: HashMap<String, usize>,
    from: u64,
    to: u64,
}

impl TurnFold {
    pub(super) fn push(&mut self, f: &Value) {        let seq = frame_seq(f);
        if self.out.is_empty() {
            self.from = seq;
        }
        self.to = self.to.max(seq);

        let nf = normalized(f);
        let Some(data) = nf.get("data") else {
            self.push_opaque(nf);
            return;
        };
        let Some(su) = session_update(data).map(str::to_string) else {
            self.push_opaque(nf);
            return;
        };
        if is_overwrite(&su) {
            // 就地更新首现位置,tail 不动:usage/plan 在 reduce 里既不碰 items
            // 也不碰 streamKind,对流式相邻性是透明的
            match self.over.get(&su) {
                Some(&idx) => self.out[idx] = nf,
                None => {
                    self.over.insert(su, self.out.len());
                    self.out.push(nf);
                }
            }
            return;
        }
        if stream_kind(data).is_some() {
            if let Some((idx, kind)) = &self.tail {
                if kind == &su {
                    let idx = *idx;
                    if let (Some(prev), Some(add)) =
                        (chunk_text(&self.out[idx]).map(str::to_string), chunk_text(&nf))
                    {
                        self.out[idx]["data"]["update"]["content"]["text"] =
                            json!(prev + add);
                        return;
                    }
                }
            }
            self.out.push(nf);
            self.tail = Some((self.out.len() - 1, su));
            return;
        }
        self.push_opaque(nf);
    }

    fn push_opaque(&mut self, nf: Value) {
        self.out.push(nf);
        self.tail = None;
    }

    /// usage 事件(input/output tokens)挂到本轮最后一条 agent_message 帧上,
    /// 供 UI 在每条助手消息旁展示其 token 用量。provider 在同一次模型调用
    /// 的头尾可能各发一次 usage,后到者覆盖前值(取该调用的最终计数)。
    pub(super) fn attach_usage(&mut self, input: u64, output: u64) {
        for f in self.out.iter_mut().rev() {
            let Some(data) = f.get("data") else { continue };
            if session_update(data) != Some("agent_message_chunk") {
                continue;
            }
            if let Some(update) = f.get_mut("data").and_then(|d| d.get_mut("update")).and_then(|u| u.as_object_mut()) {
                update.insert(
                    "usage".into(),
                    json!({ "input_tokens": input, "output_tokens": output }),
                );
            }
            break;
        }
    }

    pub(super) fn is_empty(&self) -> bool {
        self.out.is_empty()
    }

    /// 取走整轮并复位
    pub(super) fn take(&mut self) -> Turn {
        let taken = std::mem::take(self);
        Turn { from: taken.from, to: taken.to, frames: taken.out }
    }
}

/// 一轮的折叠结果
pub(super) struct Turn {
    pub(super) from: u64,
    pub(super) to: u64,
    pub(super) frames: Vec<Value>,
}

impl Turn {
    /// 大字段护栏:**只在物化这一刻**做。折叠必须保持等价(见模块头),
    /// 截断是有意的有损变换;两者混在一起的话"等价性"就只是碰巧成立——
    /// 真实 journal 上一测即破(实测差异全落在被截的 rawOutput/result/_meta)。
    /// 未物化的当前轮因此始终是完整内容。
    pub(super) fn guard(&mut self) {
        for f in &mut self.frames {
            guard_big_fields(f);
        }
    }

    /// 序列化为 replay.jsonl 的一行(不含换行)
    pub(super) fn to_line(&self, src_end: u64) -> String {
        json!({
            "from": self.from,
            "to": self.to,
            "src_end": src_end,
            "frames": self.frames,
        })
        .to_string()
    }
}

/// 批量折叠(整段原始帧 → 折叠帧),用于未物化尾巴的即时回放与老会话迁移。
pub(super) fn fold_frames(frames: &[Value]) -> Vec<Value> {
    let mut f = TurnFold::default();
    for x in frames {
        f.push(x);
    }
    f.take().frames
}

// ==================== replay.jsonl 存取 ====================

/// 一行轮记录的解析结果
pub(super) struct TurnLine {
    /// 该行在文件中的起始偏移(分页 cursor / 大纲跳转锚点)
    pub(super) offset: u64,
    pub(super) from: u64,
    pub(super) to: u64,
    pub(super) src_end: u64,
    pub(super) frames: Vec<Value>,
}

fn parse_turn_line(offset: u64, line: &str) -> Option<TurnLine> {
    let v: Value = serde_json::from_str(line).ok()?;
    Some(TurnLine {
        offset,
        from: v.get("from").and_then(|x| x.as_u64()).unwrap_or(0),
        to: v.get("to").and_then(|x| x.as_u64()).unwrap_or(0),
        src_end: v.get("src_end").and_then(|x| x.as_u64()).unwrap_or(0),
        frames: v.get("frames").and_then(|x| x.as_array()).cloned().unwrap_or_default(),
    })
}

/// 从 `before` 字节处往前读最多 max 行完整行,返回 (行起始偏移, 行内容),
/// 结果按文件正序。`before` 恒落在行边界(我们自己写的行 + 自己给的 cursor)。
///
/// 分块反向读而不是整读:打开成本必须与历史长度解耦,否则前面所有努力
/// 都被"每次仍要把整个 replay.jsonl 读进内存"吃掉。
fn lines_backward(path: &Path, before: u64, max: usize) -> Vec<(u64, String)> {
    const CHUNK: usize = 64 * 1024;
    let Ok(mut f) = std::fs::File::open(path) else { return vec![] };
    let Ok(meta) = f.metadata() else { return vec![] };
    let end = before.min(meta.len());
    if end == 0 {
        return vec![];
    }
    let mut start = end;
    let mut acc: Vec<u8> = Vec::new();
    while start > 0 && acc.iter().filter(|b| **b == b'\n').count() <= max {
        let take = CHUNK.min(start as usize);
        start -= take as u64;
        let mut chunk = vec![0u8; take];
        if f.seek(SeekFrom::Start(start)).is_err() || f.read_exact(&mut chunk).is_err() {
            return vec![];
        }
        chunk.extend_from_slice(&acc);
        acc = chunk;
    }
    // start > 0 时首行多半被切断,丢到第一个换行为止
    let mut base = start;
    let mut body = &acc[..];
    if start > 0 {
        match body.iter().position(|b| *b == b'\n') {
            Some(p) => {
                base += p as u64 + 1;
                body = &body[p + 1..];
            }
            None => return vec![],
        }
    }
    let mut out = Vec::new();
    let mut off = base;
    for part in body.split_inclusive(|b| *b == b'\n') {
        let has_nl = part.last() == Some(&b'\n');
        let text = &part[..part.len() - usize::from(has_nl)];
        if has_nl && !text.is_empty() {
            if let Ok(s) = std::str::from_utf8(text) {
                out.push((off, s.to_string()));
            }
        }
        off += part.len() as u64;
    }
    if out.len() > max {
        out.drain(..out.len() - max);
    }
    out
}

/// 读尾部窗口:最近 TAIL_TURNS 轮且不超过 TAIL_FRAMES 帧(至少一轮)。
/// 返回 (轮列表正序, 是否还有更早的)。
pub(super) fn read_tail(path: &Path) -> (Vec<TurnLine>, bool) {
    read_before(path, u64::MAX, TAIL_TURNS)
}

/// 读 `before` 之前的最多 limit 轮。返回 (轮列表正序, 是否还有更早的)。
pub(super) fn read_before(path: &Path, before: u64, limit: usize) -> (Vec<TurnLine>, bool) {
    let lines = lines_backward(path, before, limit.max(1));
    let mut turns: Vec<TurnLine> = Vec::new();
    let mut frames = 0usize;
    // 从最新往回收,凑够帧数就停——但至少保住一轮,否则长轮次会空窗
    for (off, line) in lines.iter().rev() {
        let Some(t) = parse_turn_line(*off, line) else { continue };
        let n = t.frames.len();
        if !turns.is_empty() && frames + n > TAIL_FRAMES {
            break;
        }
        frames += n;
        turns.push(t);
    }
    turns.reverse();
    let earliest = turns.first().map(|t| t.offset).unwrap_or(0);
    (turns, earliest > 0)
}

/// 按 seq 在 events.jsonl 里回读原始帧(大字段截断后的全文来源)。
/// 先用 replay.jsonl 的轮记录把范围收敛到那一轮对应的字节区间,再扫;
/// 定位不到(未物化的当前轮/记录缺失)才退化为全文件扫描。
pub(super) fn read_frame_by_seq(replay: &Path, events: &Path, seq: u64) -> Option<Value> {
    let mut start = 0u64;
    let mut end = u64::MAX;
    let mut prev_src_end = 0u64;
    for (offset, line) in scan_lines(replay) {
        let Some(t) = parse_turn_line(offset, &line) else { continue };
        if seq >= t.from && seq <= t.to {
            start = prev_src_end;
            end = t.src_end;
            break;
        }
        prev_src_end = t.src_end;
    }
    // 未物化的尾巴:从最后一轮的 src_end 起找到文件尾
    if end == u64::MAX {
        start = prev_src_end;
    }

    use std::io::{BufRead as _, BufReader, Seek as _, SeekFrom};
    let mut f = std::fs::File::open(events).ok()?;
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut r = BufReader::new(f);
    let mut pos = start;
    let mut line = String::new();
    loop {
        line.clear();
        match r.read_line(&mut line) {
            Ok(0) | Err(_) => return None,
            Ok(n) => {
                pos += n as u64;
                if let Ok(v) = serde_json::from_str::<Value>(line.trim_end()) {
                    if frame_seq(&v) == seq {
                        // 回读结果同样归一成内联对象,UI 拿到即用
                        return Some(normalized(&v));
                    }
                }
                if pos >= end {
                    return None;
                }
            }
        }
    }
}

/// 顺序扫描全文(带行偏移);大纲用。文件是折叠后的,量级几十 KB~数 MB。
pub(super) fn scan_lines(path: &Path) -> Vec<(u64, String)> {
    use std::io::{BufRead as _, BufReader};
    let Ok(f) = std::fs::File::open(path) else { return vec![] };
    let mut r = BufReader::new(f);
    let mut out = Vec::new();
    let mut off = 0u64;
    loop {
        let mut line = String::new();
        match r.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let trimmed = line.trim_end_matches('\n');
                if line.ends_with('\n') && !trimmed.is_empty() {
                    out.push((off, trimmed.to_string()));
                }
                off += n as u64;
            }
        }
    }
    out
}

/// 一行轮记录 → 其中的用户提问条目(大纲)
pub(super) fn outline_of_line(offset: u64, line: &str) -> Vec<Value> {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return vec![] };
    let Some(frames) = v.get("frames").and_then(|x| x.as_array()) else { return vec![] };
    frames.iter().filter_map(|f| outline_entry(offset, f)).collect()
}

/// user-input 帧 → 大纲条目(非 user-input 返回 None)。
/// text 保持 base64(与帧内一致),截断与附件行剥离交 UI——那套规则
/// (ATT_LINE)本来就长在 UI 侧,不复制到壳里。
pub(super) fn outline_entry(offset: u64, f: &Value) -> Option<Value> {
    if f.get("type").and_then(|v| v.as_str()) != Some("user-input") {
        return None;
    }
    let data = inline_data(f)?;
    let content = data.get("content").and_then(|v| v.as_str())?;
    Some(json!({
        "seq": frame_seq(f),
        "offset": offset,
        "content": content,
        "timestamp": f.get("timestamp").cloned().unwrap_or(Value::Null),
    }))
}

#[cfg(test)]
#[path = "fold_tests.rs"]
mod tests;
