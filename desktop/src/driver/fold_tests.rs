// fold.rs 的单测:折叠规则(等价变换的壳侧一半)与 replay.jsonl 的
// 反向分页读取。UI 侧还有一条端到端等价性断言(foldEquivalence.test.ts),
// 两边合起来才是完整守卫。

use super::*;
use std::path::PathBuf;

fn chunk(su: &str, text: &str, seq: u64, ts: u64) -> Value {
    json!({
        "type": "task-running",
        "kind": "acp_event",
        "data": { "update": { "sessionUpdate": su, "content": { "type": "text", "text": text } } },
        "timestamp": ts,
        "seq": seq,
    })
}

fn acp(update: Value, seq: u64) -> Value {
    json!({ "type": "task-running", "kind": "acp_event", "data": { "update": update },
            "timestamp": 1, "seq": seq })
}

fn lifecycle(t: &str, seq: u64) -> Value {
    json!({ "type": t, "timestamp": 1, "seq": seq })
}

fn text_of(f: &Value) -> String {
    f["data"]["update"]["content"]["text"].as_str().unwrap_or_default().to_string()
}

fn temp_dir(label: &str) -> PathBuf {
    let mut random = [0u8; 8];
    getrandom::getrandom(&mut random).unwrap();
    let suffix = random.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let dir = std::env::temp_dir().join(format!("monkeycode-fold-{label}-{suffix}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn merges_adjacent_chunks_of_the_same_kind_keeping_the_first_frames_stamp() {
    let out = fold_frames(&[
        chunk("agent_thought_chunk", "用户", 3, 1_000),
        chunk("agent_thought_chunk", "只", 4, 1_200),
        chunk("agent_thought_chunk", "问了一句", 5, 1_400),
    ]);

    assert_eq!(out.len(), 1);
    assert_eq!(text_of(&out[0]), "用户只问了一句");
    // 首帧的 seq/timestamp:reduce 的 appendStream 只在新建项时取 timestamp
    assert_eq!(out[0]["seq"], json!(3));
    assert_eq!(out[0]["timestamp"], json!(1_000));
}

#[test]
fn does_not_merge_across_a_different_kind_or_an_opaque_frame() {
    let out = fold_frames(&[
        chunk("agent_thought_chunk", "先想", 1, 1),
        chunk("agent_message_chunk", "再说", 2, 1),
        chunk("agent_thought_chunk", "又想", 3, 1),
        acp(json!({ "sessionUpdate": "tool_call", "toolCallId": "t1", "title": "Read" }), 4),
        chunk("agent_thought_chunk", "还想", 5, 1),
    ]);

    let kinds: Vec<&str> = out
        .iter()
        .map(|f| f["data"]["update"]["sessionUpdate"].as_str().unwrap())
        .collect();
    assert_eq!(
        kinds,
        ["agent_thought_chunk", "agent_message_chunk", "agent_thought_chunk", "tool_call", "agent_thought_chunk"]
    );
}

#[test]
fn usage_and_plan_collapse_to_one_frame_and_stay_transparent_to_merging() {
    let out = fold_frames(&[
        chunk("agent_message_chunk", "前半", 1, 1),
        acp(json!({ "sessionUpdate": "usage_update", "used": 10, "size": 100 }), 2),
        chunk("agent_message_chunk", "后半", 3, 1),
        acp(json!({ "sessionUpdate": "usage_update", "used": 20, "size": 100 }), 4),
    ]);

    // usage 只剩一帧且是最新值;正文没被它打断
    assert_eq!(out.len(), 2);
    assert_eq!(text_of(&out[0]), "前半后半");
    assert_eq!(out[1]["data"]["update"]["used"], json!(20));
}

#[test]
fn legacy_base64_payloads_are_normalised_to_inline_objects() {
    let payload = json!({ "update": { "sessionUpdate": "agent_message_chunk",
                                      "content": { "type": "text", "text": "旧格式" } } });
    let encoded = base64::engine::general_purpose::STANDARD.encode(payload.to_string());
    let legacy = json!({ "type": "task-running", "kind": "acp_event",
                         "data": encoded, "timestamp": 1, "seq": 1 });

    let out = fold_frames(&[legacy, chunk("agent_message_chunk", "接上", 2, 1)]);

    assert_eq!(out.len(), 1);
    assert!(out[0]["data"].is_object(), "折叠输出一律内联对象,老会话物化后不再每帧 atob");
    assert_eq!(text_of(&out[0]), "旧格式接上");
}

#[test]
fn images_and_other_structured_content_are_never_concatenated() {
    let img = acp(
        json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "image", "data": "…" } }),
        2,
    );
    let out = fold_frames(&[chunk("agent_message_chunk", "看图", 1, 1), img]);

    assert_eq!(out.len(), 2, "非文本 content 拼不了,必须原样保留");
}

// ==================== replay.jsonl 读取 ====================

fn write_turns(dir: &PathBuf, turns: &[(u64, u64, usize)]) -> PathBuf {
    use std::io::Write as _;
    let path = dir.join("replay.jsonl");
    let mut f = std::fs::File::create(&path).unwrap();
    for (from, to, n) in turns {
        let frames: Vec<Value> = (0..*n).map(|i| chunk("agent_message_chunk", "x", from + i as u64, 1)).collect();
        let turn = Turn { from: *from, to: *to, frames };
        writeln!(f, "{}", turn.to_line(to * 10)).unwrap();
    }
    path
}

#[test]
fn read_tail_returns_the_newest_turns_in_order_with_a_paging_cursor() {
    let dir = temp_dir("tail");
    let path = write_turns(&dir, &[(1, 9, 2), (10, 19, 2), (20, 29, 2)]);

    let (turns, has_more) = read_tail(&path);

    assert_eq!(turns.len(), 3);
    assert_eq!(turns[0].to, 9, "正序返回");
    assert_eq!(turns[2].to, 29);
    assert!(!has_more, "已经读到文件头");
    assert_eq!(turns[2].src_end, 290);

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn read_before_pages_backwards_from_a_cursor() {
    let dir = temp_dir("page");
    let path = write_turns(&dir, &[(1, 9, 1), (10, 19, 1), (20, 29, 1)]);
    let (tail, _) = read_before(&path, u64::MAX, 1);
    assert_eq!(tail.len(), 1);
    assert_eq!(tail[0].to, 29);

    let (older, has_more) = read_before(&path, tail[0].offset, 1);

    assert_eq!(older.len(), 1);
    assert_eq!(older[0].to, 19);
    assert!(has_more, "前面还有第一轮");

    let (first, no_more) = read_before(&path, older[0].offset, 5);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].to, 9);
    assert!(!no_more);

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn read_tail_stops_on_the_frame_budget_but_always_keeps_one_turn() {
    let dir = temp_dir("budget");
    // 单轮就超预算:窗口仍必须给出完整的一轮,否则长轮次会开出空白
    let path = write_turns(&dir, &[(1, 9, 10), (10, 19, TAIL_FRAMES + 100)]);

    let (turns, has_more) = read_tail(&path);

    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].to, 19);
    assert!(has_more);

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_torn_last_line_degrades_to_the_previous_turn_instead_of_corrupting_the_window() {
    use std::io::Write as _;
    let dir = temp_dir("torn");
    let path = write_turns(&dir, &[(1, 9, 1), (10, 19, 1)]);
    // 模拟崩溃:半行没有换行结尾
    let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
    write!(f, "{{\"from\":20,\"to\":29,\"frames\":[").unwrap();
    drop(f);

    let (turns, _) = read_tail(&path);

    assert_eq!(turns.len(), 2, "残行不成行,被跳过");
    assert_eq!(turns[1].to, 19);

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn outline_entries_come_from_user_input_frames_only() {
    let ui = json!({
        "type": "user-input",
        "data": { "content": base64::engine::general_purpose::STANDARD.encode("帮我看下这个 panic") },
        "timestamp": 1_784_088_476_056u64,
        "seq": 7,
    });

    assert!(outline_entry(0, &lifecycle("task-started", 1)).is_none());
    let e = outline_entry(512, &ui).unwrap();
    assert_eq!(e["seq"], json!(7));
    assert_eq!(e["offset"], json!(512));
    assert_eq!(e["timestamp"], json!(1_784_088_476_056u64));
    // content 保持 base64:截断与附件行剥离的规则长在 UI,不复制到壳里
    assert_eq!(
        String::from_utf8(
            base64::engine::general_purpose::STANDARD.decode(e["content"].as_str().unwrap()).unwrap()
        )
        .unwrap(),
        "帮我看下这个 panic"
    );
}

// ==================== 跨语言等价性守卫 ====================
//
// 折叠是**等价变换**这条,靠两侧各一半守:
//   这里(Rust):折叠输出必须与 fixtures/replay/folded.jsonl 逐字节一致;
//   UI  (TS)  :reduceBatch(raw) ≡ reduceBatch(folded)。
// 任一侧改了折叠规则而没同步,这两条里必有一条红。
// 素材换了以后跑 `cargo test regenerate_fold_fixture -- --ignored` 重生成。

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/replay")
}

fn read_jsonl(path: &std::path::Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("读不到 {}: {e}", path.display()))
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("fixture 不是合法 JSONL"))
        .collect()
}

#[test]
fn folding_the_fixture_matches_the_committed_output() {
    let dir = fixture_dir();
    let folded = fold_frames(&read_jsonl(&dir.join("raw.jsonl")));
    let expected = read_jsonl(&dir.join("folded.jsonl"));

    assert_eq!(
        folded, expected,
        "折叠输出与 fixtures/replay/folded.jsonl 不一致。\
         \n改了折叠规则就跑 `cargo test regenerate_fold_fixture -- --ignored` 重生成,\
         \n并确认 UI 侧 foldEquivalence.test.ts 仍绿(等价性是这套方案的地基)。"
    );
}

#[test]
#[ignore = "素材/规则变更时手动重生成 fixture"]
fn regenerate_fold_fixture() {
    let dir = fixture_dir();
    let folded = fold_frames(&read_jsonl(&dir.join("raw.jsonl")));
    let body: String = folded.iter().map(|f| format!("{f}\n")).collect();
    std::fs::write(dir.join("folded.jsonl"), body).expect("写 fixture");
}

// ==================== 大字段护栏 ====================

fn big_tool_update(seq: u64, bytes: usize) -> Value {
    acp(
        json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "t1",
            "status": "completed",
            "rawOutput": { "output": "x".repeat(bytes) },
        }),
        seq,
    )
}

/// 护栏只在物化那一刻施加(Turn::guard),折叠本身保持等价
fn materialized(frames: &[Value]) -> Vec<Value> {
    let mut turn = Turn { from: 0, to: 0, frames: fold_frames(frames) };
    turn.guard();
    turn.frames
}

#[test]
fn folding_alone_never_truncates_only_materialising_does() {
    let big = big_tool_update(5, 200_000);

    let folded = fold_frames(&[big.clone()]);
    let stored = materialized(&[big]);

    // 折叠输出必须原样保留(等价性契约);截断是物化那一步的事
    assert_eq!(folded[0]["data"]["update"]["rawOutput"]["output"].as_str().unwrap().len(), 200_000);
    assert!(stored[0]["data"]["update"]["rawOutput"]["output"].as_str().unwrap().len() < 2000);
}

#[test]
fn oversized_tool_fields_are_truncated_in_place_and_marked_for_re_read() {
    let out = materialized(&[big_tool_update(5, 200_000)]);

    let update = &out[0]["data"]["update"];
    // 结构不变(UI 的 toolResultText/presentToolCall 依赖字段形状)
    let text = update["rawOutput"]["output"].as_str().unwrap();
    assert!(text.len() < 2000, "行内只留头部: {}", text.len());
    assert!(text.ends_with('…'));
    assert_eq!(update["_meta"]["mcSrc"]["seq"], json!(5), "留下按 seq 回读的凭据");
}

#[test]
fn fields_under_the_limit_are_left_alone_and_unmarked() {
    let out = materialized(&[big_tool_update(5, 100)]);

    let update = &out[0]["data"]["update"];
    assert_eq!(update["rawOutput"]["output"].as_str().unwrap().len(), 100);
    assert!(update.get("_meta").is_none(), "没截断就不该留标记");
}

#[test]
fn truncation_never_splits_a_multibyte_character() {
    // 全中文:1KB 边界必然落在字符中间,切错就会产出非法 UTF-8
    let out = materialized(&[acp(
        json!({ "sessionUpdate": "tool_call", "toolCallId": "t1",
                "rawInput": { "text": "中".repeat(5000) } }),
        1,
    )]);

    let text = out[0]["data"]["update"]["rawInput"]["text"].as_str().unwrap();
    assert!(text.chars().all(|c| c == '中' || c == '…'));
}

#[test]
fn only_tool_frames_are_guarded() {
    // 正文再长也不截:模型输出本身就是要给用户看的内容
    let out = materialized(&[chunk("agent_message_chunk", &"字".repeat(20_000), 1, 1)]);

    assert_eq!(text_of(&out[0]).chars().count(), 20_000);
    assert!(out[0]["data"]["update"].get("_meta").is_none());
}

#[test]
fn the_full_frame_is_read_back_by_seq_from_the_raw_journal() {
    use std::io::Write as _;
    let dir = temp_dir("readback");
    // events.jsonl:两轮原始帧;replay.jsonl:对应的轮记录
    let mut events = String::new();
    let full = big_tool_update(3, 200_000);
    for f in [lifecycle("user-input", 1), lifecycle("task-started", 2), full.clone(), lifecycle("task-ended", 4)] {
        events.push_str(&f.to_string());
        events.push('\n');
    }
    let src_end = events.len() as u64;
    for f in [lifecycle("user-input", 5), lifecycle("task-started", 6)] {
        events.push_str(&f.to_string());
        events.push('\n');
    }
    std::fs::write(dir.join("events.jsonl"), &events).unwrap();
    let mut turn = Turn { from: 1, to: 4, frames: fold_frames(&[full.clone()]) };
    turn.guard();
    let mut f = std::fs::File::create(dir.join("replay.jsonl")).unwrap();
    writeln!(f, "{}", turn.to_line(src_end)).unwrap();
    drop(f);

    let got = read_frame_by_seq(&dir.join("replay.jsonl"), &dir.join("events.jsonl"), 3).unwrap();

    assert_eq!(got["data"]["update"]["rawOutput"]["output"].as_str().unwrap().len(), 200_000);
    // 找不到的 seq 明确返回 None(UI 据此外显"原始记录已不可用")
    assert!(read_frame_by_seq(&dir.join("replay.jsonl"), &dir.join("events.jsonl"), 999).is_none());

    std::fs::remove_dir_all(&dir).unwrap();
}


