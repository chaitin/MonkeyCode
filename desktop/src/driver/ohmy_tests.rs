// OhmyAgentDriver 测试:E2E(mock 壳 + 真实 ohmyagent + 假 LLM)与
// journal/归一化单元测试(裸 Inner,不起引擎进程)。
// 经 ohmy.rs 的 #[path] 声明挂为 driver::ohmy::tests,super == ohmy。

use std::collections::{HashMap, HashSet};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::*;
use crate::config::DesktopConfig;
use crate::driver::frame;
use crate::driver::session::{SessionState, SessionsState};
use crate::driver::subagent::SubagentState;
use crate::driver::transport::{find_ohmyagent, spawn_journal_writer, JournalMsg, TransportState};


/// E2E 串行锁:限制真实引擎 + 假 LLM 的并发资源占用。async-aware 锁不会
/// 阻塞 tokio worker，也没有一次断言失败毒化其余 E2E 的问题。
static E2E_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

async fn e2e_lock() -> tokio::sync::MutexGuard<'static, ()> {
    E2E_LOCK.lock().await
}

/// E2E 前置守卫。E2E 全部标 `#[ignore]`:缺配套引擎时 `cargo test` 报
/// "ignored"(诚实),而不是静默 return 后报 "ok"——后者让绿灯毫无意义
/// (曾经 6 个 E2E 在 0.00s 内全部 "passed",实则一行没跑)。
/// 一旦被显式选中执行(--include-ignored / --ignored),缺二进制就是硬失败。
fn require_ohmyagent() {
    assert!(
        find_ohmyagent().is_some(),
        "E2E 需要 MC_OHMYAGENT_BIN 指向配套 ohmyagent 二进制\n\
         (测试内不从 PATH 猜版本,见 transport.rs::find_ohmyagent)"
    );
}

fn sse_event(name: &str, data: Value) -> String {
    format!("event: {name}\ndata: {data}")
}

fn sse_head() -> Vec<String> {
    vec![sse_event(
        "message_start",
        json!({"type":"message_start","message":{"id":"m1","role":"assistant","content":[],"model":"test-model","usage":{"input_tokens":10,"output_tokens":0}}}),
    )]
}

fn sse_tail(stop_reason: &str) -> Vec<String> {
    vec![
        sse_event("content_block_stop", json!({"type":"content_block_stop","index":0})),
        sse_event(
            "message_delta",
            json!({"type":"message_delta","delta":{"stop_reason":stop_reason},"usage":{"output_tokens":5}}),
        ),
        sse_event("message_stop", json!({"type":"message_stop"})),
    ]
}

/// 一段纯文本流式应答(end_turn)。
fn sse_text(text: &str) -> String {
    let mut ev = sse_head();
    ev.push(sse_event(
        "content_block_start",
        json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
    ));
    ev.push(sse_event(
        "content_block_delta",
        json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":text}}),
    ));
    ev.extend(sse_tail("end_turn"));
    ev.join("\n\n") + "\n\n"
}

/// 一次工具调用流式应答(stop_reason=tool_use)。
fn sse_tool_use(tu_id: &str, name: &str, input: &Value) -> String {
    let mut ev = sse_head();
    ev.push(sse_event(
        "content_block_start",
        json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":tu_id,"name":name,"input":{}}}),
    ));
    ev.push(sse_event(
        "content_block_delta",
        json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":input.to_string()}}),
    ));
    ev.extend(sse_tail("tool_use"));
    ev.join("\n\n") + "\n\n"
}

/// 引擎 auto 模式下 shell 分类器系统提示的尾句(cmd/ohmyagent/root.go 的
/// shellClassifierPrompt)。假 LLM 靠它把"分类请求"与主循环请求区分开。
const SHELL_CLASSIFIER_MARK: &str = "Respond with a single word: ALLOW or ASK";

/// 引擎会话摘要系统提示的首句(agent/internal/agent/loop.go 的
/// titleSystemPrompt)。摘要生成是**每轮一次的额外 LLM 调用**(c9d229c 起),
/// 同样不属于主循环步序:不单独识别就白吃一个脚本步骤,tool_use id 与后续
/// 步序整体错位——三个子代理/审批 e2e 就是这么一起红的。
const TITLE_PROMPT_MARK: &str = "You generate concise conversation titles";

/// 假 LLM 回给摘要请求的固定文本(e2e 据此断言 sidecar 落的就是它)。
const FAKE_SUMMARY: &str = "假模型给的会话摘要";

/// 假 Anthropic SSE 服务:按请求序回放 steps(超出重复最后一步);
/// delay_ms > 0 时应答前挂起(模拟慢模型,测运行中停止的和解)。
///
/// 另外要扮演**第二个角色**:壳的默认权限模式是 auto(session.rs
/// ohmy_mode_of),引擎 ModelClassifier 在启发式判不出时会单独发一次
/// LLM 请求来裁决 shell 命令。此前假服务不认这类请求,把它当主循环请求
/// 回了一个脚本步骤——后果有两重:裁决拿到空文本按 Allow 放行(该弹的
/// 审批卡不弹),而且**白吃掉一个脚本步骤**让后续步序全部错位。
/// 这也正是 e2e_perm_remember_engine_rules 在假绿灯下被掩盖的失败原因。
/// 现在按真实契约回 ASK(单词应答,不消耗步骤),把 Ask 分支稳定地走出来。
fn fake_anthropic_steps(delay_ms: u64, steps: Vec<String>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut conn) = conn else { continue };
            let counter = counter.clone();
            let steps = steps.clone();
            std::thread::spawn(move || {
                use std::io::{BufRead as _, Write as _};
                if delay_ms > 0 {
                    std::thread::sleep(Duration::from_millis(delay_ms));
                }
                let mut reader = std::io::BufReader::new(conn.try_clone().unwrap());
                let mut line = String::new();
                let _ = reader.read_line(&mut line);
                let mut content_len = 0usize;
                loop {
                    let mut h = String::new();
                    if reader.read_line(&mut h).is_err() || h.trim().is_empty() {
                        break;
                    }
                    if let Some(v) = h.to_ascii_lowercase().strip_prefix("content-length:") {
                        content_len = v.trim().parse().unwrap_or(0);
                    }
                }
                let mut body = vec![0u8; content_len];
                use std::io::Read as _;
                let _ = reader.read_exact(&mut body);
                // 分类/摘要请求必须在取步骤**之前**判定:都不属于主循环步序。
                let body_text = String::from_utf8_lossy(&body);
                let sse = if body_text.contains(SHELL_CLASSIFIER_MARK) {
                    sse_text("ASK")
                } else if body_text.contains(TITLE_PROMPT_MARK) {
                    sse_text(FAKE_SUMMARY)
                } else {
                    let n = counter.fetch_add(1, Ordering::Relaxed);
                    steps[n.min(steps.len() - 1)].clone()
                };
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                    sse.len(),
                    sse
                );
                let _ = conn.write_all(resp.as_bytes());
            });
        }
    });
    format!("http://{addr}")
}

/// 端到端:mock 壳 + 真实 ohmyagent + 假 LLM,验证 create → send → 归一化
/// 帧日志(user-input/task-started/agent 文本/task-ended)与回放。
/// 需要 MC_OHMYAGENT_BIN 显式指定配套的 ohmyagent；未指定则跳过。
/// 壳事件(session-event 等)的收集缓冲:默认没人看,要断言时经
/// bare_inner_events 取这份共享句柄。
type EmittedEvents = Arc<StdMutex<Vec<(String, Value)>>>;

struct TestCtx(PathBuf, EmittedEvents);
impl TestCtx {
    fn new(dir: PathBuf) -> Self {
        Self(dir, Arc::new(StdMutex::new(Vec::new())))
    }
}
impl ShellCtx for TestCtx {
    fn emit_json(&self, event: &str, payload: Value) {
        self.1.lock().unwrap().push((event.to_string(), payload));
    }
    fn config_dir(&self) -> Result<PathBuf, String> {
        Ok(self.0.clone())
    }
    fn local_data_dir(&self) -> Result<PathBuf, String> {
        Ok(self.0.join("local-data"))
    }
    fn process_home(&self) -> Option<PathBuf> {
        self.0.parent().map(PathBuf::from)
    }
    fn engine_env_overrides(&self) -> Vec<(String, std::ffi::OsString)> {
        let home = self.0.parent().unwrap_or(&self.0);
        let mut env = vec![
            ("HOME".into(), home.as_os_str().to_owned()),
            ("XDG_CONFIG_HOME".into(), home.join("xdg").into_os_string()),
        ];
        if cfg!(windows) {
            env.push(("USERPROFILE".into(), home.as_os_str().to_owned()));
        }
        env
    }
}

/// 隔离 HOME 与壳配置目录；HOME/XDG 只注入引擎子进程。
fn e2e_setup(tag: &str, llm_delay_ms: u64) -> (OhmyDriver, PathBuf) {
    e2e_setup_steps(tag, llm_delay_ms, vec![sse_text("你好,任务完成")])
}

fn e2e_setup_steps(tag: &str, llm_delay_ms: u64, steps: Vec<String>) -> (OhmyDriver, PathBuf) {
    e2e_setup_cfg(tag, llm_delay_ms, steps, json!({}), "")
}

/// extra_settings:并进引擎 settings.json 的顶层键。
/// kernel_env:"wsl:<发行版>" 走 WSL spawn 分支(需 MC_WSL_EXE 假脚本)。
fn e2e_setup_cfg(
    tag: &str,
    llm_delay_ms: u64,
    steps: Vec<String>,
    extra_settings: Value,
    kernel_env: &str,
) -> (OhmyDriver, PathBuf) {
    let home = std::env::temp_dir().join(format!("ohmy-e2e-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    // 引擎配置写进壳私有目录(driver 会以 OHMYAGENT_CONFIG_DIR 注入)
    std::fs::create_dir_all(home.join("shellcfg/ohmyagent")).unwrap();
    let llm = fake_anthropic_steps(llm_delay_ms, steps);
    let mut settings = json!({
        "default_model": "测试模型",
        "permission_mode": "default",
        "models": { "测试模型": { "type": "anthropic", "model": "test-model",
            "api_key": "sk-fake", "base_url": format!("{llm}/api/anthropic"),
            "context_window": 200000 } },
    });
    if let Some(extra) = extra_settings.as_object() {
        for (k, v) in extra {
            settings[k] = v.clone();
        }
    }
    std::fs::write(
        home.join("shellcfg/ohmyagent/settings.json"),
        serde_json::to_vec_pretty(&settings).unwrap(),
    )
    .unwrap();

    // 模拟旧版 Desktop 曾写入的全局配置。引擎私有配置由
    // OHMYAGENT_CONFIG_DIR 指向 shellcfg/ohmyagent；即使全局同名模型仍在，
    // 也不能被误当成“项目配置”覆盖私有条目的 context_window。
    let mut legacy_settings = settings.clone();
    legacy_settings["models"]["测试模型"]["context_window"] = json!(128000);
    std::fs::create_dir_all(home.join(".ohmyagent")).unwrap();
    std::fs::write(
        home.join(".ohmyagent/settings.json"),
        serde_json::to_vec_pretty(&legacy_settings).unwrap(),
    )
    .unwrap();

    let ctx: Arc<dyn ShellCtx> = Arc::new(TestCtx::new(home.join("shellcfg")));
    let cfg = DesktopConfig {
        models: json!([{ "name": "测试模型", "provider": "anthropic",
            "base_url": format!("{llm}/api/anthropic"), "api_key": "sk-fake", "model": "test-model", "default": true }]),
        kernel_env: kernel_env.to_string(),
        ..Default::default()
    };
    let driver = OhmyDriver::start_with(ctx, &cfg).expect("引擎启动");
    (driver, home)
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "需 MC_OHMYAGENT_BIN 钉住配套引擎;用 --include-ignored 显式跑"]
async fn e2e_chat_normalization() {
    require_ohmyagent();
    let _g = e2e_lock().await;
    let (driver, home) = e2e_setup("chat", 0);

    let workdir = home.to_string_lossy().into_owned();
    let meta = driver.session_create(&workdir, "测试模型", false).await.expect("建会话");
    // 契约 5:新建未运行的会话是 created(不是 finished)
    assert_eq!(meta.get("status").and_then(|v| v.as_str()), Some("created"));
    assert_eq!(meta.get("kind").and_then(|v| v.as_str()), Some("local"));
    let sid = meta.get("id").and_then(|v| v.as_str()).unwrap().to_string();
    driver.session_open(&sid).await.expect("打开会话");

    let payload = json!({ "content": frame::b64_text("写个 hello world") });
    driver.session_send(&sid, "user-input", payload).await.expect("发送");

    // 轮询帧日志直到 task-ended(假 LLM 一轮即完)
    let mut journal: Vec<Value> = vec![];
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        journal = driver.read_journal(&sid);
        if journal.iter().any(|f| f.get("type").and_then(|v| v.as_str()) == Some("task-ended")) {
            break;
        }
    }
    let types: Vec<&str> = journal.iter().filter_map(|f| f.get("type").and_then(|v| v.as_str())).collect();
    assert!(types.contains(&"task-started"), "缺 task-started: {types:?}");
    assert!(types.contains(&"user-input"), "缺 user-input: {types:?}");
    assert!(types.contains(&"task-ended"), "缺 task-ended: {types:?}");
    // agent 文本增量以 acp_event 形态出现,data 内联对象是 agent_message_chunk
    let has_text = journal.iter().any(|f| {
        if f.get("kind").and_then(|v| v.as_str()) != Some("acp_event") {
            return false;
        }
        let Some(v) = f.get("data").filter(|d| d.is_object()) else { return false };
        v.get("update").and_then(|u| u.get("sessionUpdate")).and_then(|s| s.as_str())
            == Some("agent_message_chunk")
            && v["update"]["content"]["text"].as_str().map(|t| t.contains("任务完成")).unwrap_or(false)
    });
    assert!(has_text, "缺 agent 文本帧: {journal:?}");
    // usage 事件会在模型正文尚未结束时先把主 Agent 当前 context 推给
    // composer；turn/stopped 的扁平字段随后再给轮后权威快照。
    let first_text = journal.iter().position(|f| {
        acp_update(f).is_some_and(|u| {
            u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("agent_message_chunk")
        })
    }).expect("缺 agent 文本位置");
    let first_usage = journal.iter().position(|f| {
        acp_update(f).is_some_and(|u| {
            u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("usage_update")
        })
    }).expect("缺上下文占用位置");
    assert!(first_usage < first_text, "usage 未在流式对话过程中更新: {journal:?}");
    let has_usage = journal
        .iter()
        .filter_map(acp_update)
        .any(|u| {
            u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("usage_update")
                && u.get("used").and_then(|v| v.as_i64()).unwrap_or(0) > 0
                && u.get("size").and_then(|v| v.as_i64()) == Some(200000)
        });
    assert!(has_usage, "缺上下文占用帧: {journal:?}");
    // seq 单调
    let seqs: Vec<u64> = journal.iter().filter_map(|f| f.get("seq").and_then(|v| v.as_u64())).collect();
    assert!(seqs.windows(2).all(|w| w[0] < w[1]), "seq 不单调: {seqs:?}");

    // 会话列表(sidecar 权威):标题取首条输入；一轮结束后会话空闲可继续，
    // 不能误报为整个任务 finished。
    let list = driver.sessions_list().await.unwrap();
    let items = list.as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].get("status").and_then(|v| v.as_str()), Some("idle"));
    assert_eq!(items[0].get("kind").and_then(|v| v.as_str()), Some("local"));
    assert!(items[0].get("title").and_then(|v| v.as_str()).unwrap_or("").contains("hello world"));

    // 会话摘要:引擎每轮异步生成(与轮次收尾无时序保证,轮询等它落盘),
    // 只进 summary 字段——标题仍是首条输入,不被摘要改写。
    let mut items = items.clone();
    for _ in 0..50 {
        if !items[0].get("summary").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        items = driver.sessions_list().await.unwrap().as_array().unwrap().clone();
    }
    assert_eq!(
        items[0].get("summary").and_then(|v| v.as_str()),
        Some(FAKE_SUMMARY),
        "会话摘要未落 sidecar: {items:?}"
    );
    assert!(
        items[0].get("title").and_then(|v| v.as_str()).unwrap_or("").contains("hello world"),
        "摘要不该改写标题: {items:?}"
    );

    // session/switchMode、session/switchModel 通路(会话已激活,走原生 RPC)
    driver
        .session_call(&sid, "session_set_mode", json!({ "mode": "yolo" }))
        .await
        .expect("切权限模式");
    driver
        .session_call(&sid, "session_set_model", json!({ "model": "测试模型" }))
        .await
        .expect("切模型");
    // 会话级思考档位:经引擎 session/setThinking 下发(loop 内存态),
    // 档位落 sidecar 并在会话列表可见;off = 关思考(enabled:false)
    driver
        .session_call(&sid, "session_set_think", json!({ "think": "high" }))
        .await
        .expect("切思考档位");
    let list = driver.sessions_list().await.unwrap();
    assert_eq!(
        list.as_array().unwrap()[0].get("think").and_then(|v| v.as_str()),
        Some("high"),
        "思考档位未落 sidecar: {list:?}"
    );
    driver
        .session_call(&sid, "session_set_think", json!({ "think": "off" }))
        .await
        .expect("关思考");

    // sessionQuery 通路:resume 可用性经 session/exists RPC 判定
    // (存在/不存在两侧;壳不再探测引擎存储的文件布局)
    assert!(driver.engine_session_exists(&sid).await, "跑过一轮的会话应 resume 可用");
    assert!(!driver.engine_session_exists("no-such-session").await, "未知会话应为 false");

    driver.stop();
}

/// WSL 运行环境冒烟:经 MC_WSL_EXE 假脚本走完整条 WSL spawn 链路——
/// find_ohmyagent_linux(MC_OHMYAGENT_LINUX_BIN)→ prepare(home/登录
/// shell/网络模式/路径翻译解析)→ 登录 shell 包装 spawn → 握手 → 会话
/// 全流程 → 优雅停止。跑法:
///   MC_WSL_EXE=$PWD/scripts/fake-wsl.sh \
///   MC_OHMYAGENT_LINUX_BIN=$MC_OHMYAGENT_BIN \
///   cargo test --bin monkeycode-desktop e2e_wsl -- --include-ignored
#[tokio::test(flavor = "multi_thread")]
#[ignore = "需 MC_OHMYAGENT_BIN + MC_WSL_EXE + MC_OHMYAGENT_LINUX_BIN;用 --include-ignored 显式跑"]
async fn e2e_wsl_smoke_full_lifecycle() {
    require_ohmyagent();
    assert!(
        std::env::var("MC_WSL_EXE").is_ok() && std::env::var("MC_OHMYAGENT_LINUX_BIN").is_ok(),
        "WSL 冒烟需 MC_WSL_EXE 指向 scripts/fake-wsl.sh,\
         MC_OHMYAGENT_LINUX_BIN 指向本机引擎二进制(不 set_var 污染并行测试)"
    );
    let _g = e2e_lock().await;
    let (driver, home) = e2e_setup_cfg(
        "wsl",
        0,
        vec![sse_text("你好,任务完成")],
        json!({}),
        "wsl:Ubuntu-22.04",
    );

    // WSL 上下文随引擎启动填入(prepare 采集;fake 报 nat)
    assert_eq!(driver.wsl_distro().as_deref(), Some("Ubuntu-22.04"));
    assert_eq!(driver.wsl_networking().as_deref(), Some("nat"));
    // 目录对话框初始位置 = guest 家目录的宿主视角(冒烟恒等)
    assert_eq!(driver.wsl_workdir_base(), std::env::var("HOME").ok());

    // fake-wsl 下 guest == host,本机绝对路径即 guest 路径
    let workdir = home.to_string_lossy().into_owned();
    let meta = driver.session_create(&workdir, "测试模型", false).await.expect("建会话");
    let sid = meta.get("id").and_then(|v| v.as_str()).unwrap().to_string();
    driver.session_open(&sid).await.expect("打开会话");
    let payload = json!({ "content": frame::b64_text("wsl 冒烟") });
    driver.session_send(&sid, "user-input", payload).await.expect("发送");

    let mut journal: Vec<Value> = vec![];
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        journal = driver.read_journal(&sid);
        if journal.iter().any(|f| f.get("type").and_then(|v| v.as_str()) == Some("task-ended")) {
            break;
        }
    }
    let types: Vec<&str> =
        journal.iter().filter_map(|f| f.get("type").and_then(|v| v.as_str())).collect();
    assert!(types.contains(&"task-started"), "缺 task-started: {types:?}");
    assert!(types.contains(&"task-ended"), "缺 task-ended: {types:?}");

    // "~" 展开到 guest 家目录(prepare 采集;fake 下即本机 $HOME),
    // 而不是宿主 expand_tilde——只建会话不写盘,不污染真实主目录
    let meta = driver.session_create("~", "测试模型", false).await.expect("~ 建会话");
    let sid2 = meta.get("id").and_then(|v| v.as_str()).unwrap();
    let stored = driver.0.read_sidecar(sid2);
    assert_eq!(
        stored.get("workdir").and_then(|v| v.as_str()),
        std::env::var("HOME").ok().as_deref(),
        "~ 应展开为 guest 家目录"
    );

    // 软链工作区:存在性判定在 guest 内做(ensure_guest_dir),不再被宿主
    // \\wsl$ 的符号链接求值限制误报"目录不存在";sidecar 存 canonical 形态
    #[cfg(unix)]
    {
        let target = home.join("link-target");
        std::fs::create_dir_all(&target).unwrap();
        let link = home.join("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let meta = driver
            .session_create(&link.to_string_lossy(), "测试模型", false)
            .await
            .expect("软链建会话");
        let sid3 = meta.get("id").and_then(|v| v.as_str()).unwrap();
        let stored = driver.0.read_sidecar(sid3);
        assert_eq!(
            stored.get("workdir").and_then(|v| v.as_str()),
            std::fs::canonicalize(&target).unwrap().to_str(),
            "软链 workdir 应解为 canonical 目标"
        );
    }

    // 目录真不存在(create=false):错误文案必须含"目录不存在"
    // (前端 offerCreate 按此匹配给"创建"入口)
    let err = driver
        .session_create(&home.join("no-such-dir").to_string_lossy(), "测试模型", false)
        .await
        .expect_err("不存在目录应报错");
    assert!(err.contains("目录不存在"), "文案契约(offerCreate 匹配): {err}");

    // 普通对话 + WSL:工作区由壳在**宿主**建(create_chat_workdir_in),
    // sidecar/引擎侧存 guest 形态(guest_chat_root 前缀)。
    // 存在性判定不得再走宿主视角:真 Windows 上 guest 形态是
    // /mnt/c/Users/…/chat-workspaces/chat-xxxx,包成
    // \\wsl$\<发行版>\mnt\c\Users\… 后 Windows 穿不过 WSL 共享上的 drvfs
    // 挂载点,刚建好的目录被判成"不存在",WSL 下普通对话必然开不了
    // (2026-08-09 用户报障)。fake-wsl 下 guest==host,所以这里锁的是
    // "建得起来 + 存 guest 形态";那条 UNC 误判只在真 Windows 上现形,
    // 防线是 session_create_with_kind 里 (Some(_), _) 那条显式分支。
    let meta = driver
        .session_create_with_kind("", "测试模型", false, "chat", "")
        .await
        .expect("WSL 下建普通对话");
    let sid4 = meta.get("id").and_then(|v| v.as_str()).unwrap();
    let chat_dir = driver
        .0
        .read_sidecar(sid4)
        .get("workdir")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let guest_chat_root = driver.0.wsl.as_ref().expect("WSL 上下文").guest_chat_root.clone();
    assert!(
        chat_dir.starts_with(&guest_chat_root),
        "对话 workdir 应落在 guest chat 根({guest_chat_root})下: {chat_dir}"
    );
    assert!(
        chat_dir.rsplit('/').next().is_some_and(|n| n.starts_with("chat-")),
        "对话 workdir 末段应是受管的 chat-<标识>: {chat_dir}"
    );

    // 优雅停止:stdin EOF 经中继(fake 直执)透传,引擎自退,不走 pkill
    driver.stop();
    let _ = std::fs::remove_dir_all(&home);
}

/// WSL 启动失败外显:prepare 失败(fake-wsl 对发行版 "broken" 报错)时
/// start_with 必须携带排查文案上抛,而不是挂死或降级本机。
#[tokio::test(flavor = "multi_thread")]
#[ignore = "需 MC_WSL_EXE + MC_OHMYAGENT_LINUX_BIN;用 --include-ignored 显式跑"]
async fn e2e_wsl_prepare_failure_surfaces() {
    assert!(
        std::env::var("MC_WSL_EXE").is_ok() && std::env::var("MC_OHMYAGENT_LINUX_BIN").is_ok(),
        "需 MC_WSL_EXE + MC_OHMYAGENT_LINUX_BIN(见 e2e_wsl_smoke_full_lifecycle)"
    );
    let _g = e2e_lock().await;
    let home = std::env::temp_dir().join(format!("ohmy-e2e-wslfail-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join("shellcfg")).unwrap();
    let ctx: Arc<dyn ShellCtx> = Arc::new(TestCtx::new(home.join("shellcfg")));
    let cfg = DesktopConfig { kernel_env: "wsl:broken".into(), ..Default::default() };
    let err = match OhmyDriver::start_with(ctx, &cfg) {
        Ok(driver) => {
            driver.stop();
            panic!("prepare 失败必须上抛");
        }
        Err(e) => e,
    };
    assert!(err.contains("broken") && err.contains("wsl --shutdown"), "缺排查文案: {err}");
    let _ = std::fs::remove_dir_all(&home);
}

/// 运行中停止引擎必须本地和解:补收尾帧、sidecar 落 interrupted——
/// 否则会话永久卡"执行中"(不能发/不能删/不能切,重启也救不回)。
#[tokio::test(flavor = "multi_thread")]
#[ignore = "需 MC_OHMYAGENT_BIN 钉住配套引擎;用 --include-ignored 显式跑"]
async fn e2e_stop_reconciles_running_session() {
    require_ohmyagent();
    let _g = e2e_lock().await;
    // 慢速假 LLM(8s,超过引擎 5s 的内部 shutdown 预算):轮次挂在模型
    // 调用上。stop() 预算 = 引擎宣告 grace(5s)+ 3s 余量,引擎会在
    // 5s 强制收敛后优雅退出,壳等得到;等不到(引擎挂死)才 kill
    let (driver, home) = e2e_setup("stop", 8000);

    let workdir = home.to_string_lossy().into_owned();
    let meta = driver.session_create(&workdir, "测试模型", false).await.expect("建会话");
    let sid = meta.get("id").and_then(|v| v.as_str()).unwrap().to_string();
    driver.session_open(&sid).await.expect("打开会话");
    let payload = json!({ "content": frame::b64_text("会被挂住的任务") });
    driver.session_send(&sid, "user-input", payload).await.expect("发送");

    driver.stop();

    let journal = driver.read_journal(&sid);
    let types: Vec<&str> = journal.iter().filter_map(|f| f.get("type").and_then(|v| v.as_str())).collect();
    assert!(types.contains(&"task-started"), "缺 task-started: {types:?}");
    assert!(types.contains(&"task-error"), "停止未补 task-error: {types:?}");
    assert!(types.contains(&"task-ended"), "停止未补 task-ended: {types:?}");
    let meta = driver.0.read_sidecar(&sid);
    assert_eq!(
        meta.get("status").and_then(|v| v.as_str()),
        Some("interrupted"),
        "sidecar 未落 interrupted: {meta:?}"
    );
}

/// 轮询帧日志直到谓词命中(100ms × 150 = 15s 上限)。
async fn wait_journal(driver: &OhmyDriver, sid: &str, pred: impl Fn(&[Value]) -> bool) -> Vec<Value> {
    let mut journal = vec![];
    for _ in 0..150 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        journal = driver.read_journal(sid);
        if pred(&journal) {
            break;
        }
    }
    journal
}

fn acp_update(f: &Value) -> Option<Value> {
    if f.get("kind").and_then(|v| v.as_str()) != Some("acp_event") {
        return None;
    }
    f.get("data")?.get("update").cloned()
}

/// 复现排查:连续两轮发送**相同文本**的消息,大纲(session_outline)的
/// seq 必须与两条 user-input 帧一一对应且互不重复——重复 seq 会让 UI
/// 大纲两个点同时标绿、点击定位到错误的那条。
#[tokio::test(flavor = "multi_thread")]
#[ignore = "需 MC_OHMYAGENT_BIN 钉住配套引擎;用 --include-ignored 显式跑"]
async fn e2e_outline_two_identical_messages() {
    require_ohmyagent();
    let _g = e2e_lock().await;
    let (driver, home) = e2e_setup("outline-dup", 0);

    let workdir = home.to_string_lossy().into_owned();
    let meta = driver.session_create(&workdir, "测试模型", false).await.expect("建会话");
    let sid = meta.get("id").and_then(|v| v.as_str()).unwrap().to_string();
    driver.session_open(&sid).await.expect("打开会话");

    // 全程高频轮询大纲:物化(Materialize)与大纲读取并发时,任何一个
    // 快照里都不允许出现重复 seq(UI 在轮末刷新大纲,瞬态重复用户看得到)
    let poll_stop = Arc::new(AtomicBool::new(false));
    let poller = {
        let driver = driver.clone();
        let sid = sid.clone();
        let stop = poll_stop.clone();
        tokio::spawn(async move {
            while !stop.load(Ordering::Relaxed) {
                let snap = driver.session_outline(&sid).await.unwrap_or_else(|_| json!([]));
                let seqs: Vec<u64> = snap
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|e| e.get("seq").and_then(|v| v.as_u64()))
                    .collect();
                let uniq: HashSet<u64> = seqs.iter().copied().collect();
                assert_eq!(uniq.len(), seqs.len(), "大纲快照出现重复 seq: {seqs:?}");
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
        })
    };

    let payload = json!({ "content": frame::b64_text("一样的消息") });
    driver.session_send(&sid, "user-input", payload.clone()).await.expect("发送 1");
    let ended = |n: usize| {
        move |j: &[Value]| {
            j.iter().filter(|f| f.get("type").and_then(|v| v.as_str()) == Some("task-ended")).count() >= n
        }
    };
    let journal = wait_journal(&driver, &sid, ended(1)).await;
    assert!(ended(1)(&journal), "第一轮未结束: {journal:?}");
    // 第二条同文本消息。task-ended 帧与内存 running=false 之间可能有
    // 极短间隙,忙碌守卫命中就稍等重试
    for i in 0..50 {
        match driver.session_send(&sid, "user-input", payload.clone()).await {
            Ok(_) => break,
            Err(e) if i < 49 => {
                let _ = e;
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(e) => panic!("发送 2 失败: {e}"),
        }
    }
    let journal = wait_journal(&driver, &sid, ended(2)).await;
    assert!(ended(2)(&journal), "第二轮未结束: {journal:?}");

    // journal 里恰好两条 user-input,seq 各不相同
    let input_seqs: Vec<u64> = journal
        .iter()
        .filter(|f| f.get("type").and_then(|v| v.as_str()) == Some("user-input"))
        .filter_map(|f| f.get("seq").and_then(|v| v.as_u64()))
        .collect();
    assert_eq!(input_seqs.len(), 2, "user-input 帧数不对: {journal:?}");
    assert_ne!(input_seqs[0], input_seqs[1], "两条 user-input 撞 seq: {input_seqs:?}");

    // 大纲与 journal 对表:两条、seq 一致且唯一
    let outline = driver.session_outline(&sid).await.expect("大纲");
    let entries = outline.as_array().cloned().unwrap_or_default();
    let outline_seqs: Vec<u64> =
        entries.iter().filter_map(|e| e.get("seq").and_then(|v| v.as_u64())).collect();
    assert_eq!(outline_seqs, input_seqs, "大纲 seq 与帧不对表: {entries:?}");

    // 重开会话(seq 水位恢复路径)后再发第三条同文本消息,仍不得撞 seq
    driver.session_close(&sid).await;
    driver.session_open(&sid).await.expect("重开会话");
    driver.session_send(&sid, "user-input", payload.clone()).await.expect("发送 3");
    let journal = wait_journal(&driver, &sid, ended(3)).await;
    assert!(ended(3)(&journal), "第三轮未结束: {journal:?}");
    let outline = driver.session_outline(&sid).await.expect("大纲 2");
    let entries = outline.as_array().cloned().unwrap_or_default();
    let seqs: Vec<u64> = entries.iter().filter_map(|e| e.get("seq").and_then(|v| v.as_u64())).collect();
    let uniq: HashSet<u64> = seqs.iter().copied().collect();
    assert_eq!(seqs.len(), 3, "大纲条目数不对: {entries:?}");
    assert_eq!(uniq.len(), seqs.len(), "大纲出现重复 seq: {seqs:?}");

    poll_stop.store(true, Ordering::Relaxed);
    poller.await.expect("大纲轮询任务断言失败");

    // ==== 壳进程重启(新 driver、同一数据目录):seq 水位必须从磁盘恢复 ====
    driver.stop();
    let settings: Value = serde_json::from_slice(
        &std::fs::read(home.join("shellcfg/ohmyagent/settings.json")).unwrap(),
    )
    .unwrap();
    let base_url = settings["models"]["测试模型"]["base_url"].as_str().unwrap().to_string();
    let ctx: Arc<dyn ShellCtx> = Arc::new(TestCtx::new(home.join("shellcfg")));
    let cfg = DesktopConfig {
        models: json!([{ "name": "测试模型", "provider": "anthropic",
            "base_url": base_url, "api_key": "sk-fake", "model": "test-model", "default": true }]),
        ..Default::default()
    };
    let driver = OhmyDriver::start_with(ctx, &cfg).expect("重启引擎");
    driver.session_open(&sid).await.expect("重启后打开会话");
    for i in 0..50 {
        match driver.session_send(&sid, "user-input", payload.clone()).await {
            Ok(_) => break,
            Err(e) if i < 49 => {
                let _ = e;
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(e) => panic!("重启后发送失败: {e}"),
        }
    }
    let journal = wait_journal(&driver, &sid, ended(4)).await;
    assert!(ended(4)(&journal), "重启后一轮未结束: {journal:?}");
    // 全 journal 无重复 seq(水位回卷会让新帧撞上老帧,大纲两个点同亮)
    let all_seqs: Vec<u64> =
        journal.iter().filter_map(|f| f.get("seq").and_then(|v| v.as_u64())).collect();
    let uniq: HashSet<u64> = all_seqs.iter().copied().collect();
    assert_eq!(uniq.len(), all_seqs.len(), "重启后 seq 回卷撞号: {all_seqs:?}");
    let outline = driver.session_outline(&sid).await.expect("重启后大纲");
    let entries = outline.as_array().cloned().unwrap_or_default();
    let seqs: Vec<u64> = entries.iter().filter_map(|e| e.get("seq").and_then(|v| v.as_u64())).collect();
    let uniq: HashSet<u64> = seqs.iter().copied().collect();
    assert_eq!(seqs.len(), 4, "重启后大纲条目数不对: {entries:?}");
    assert_eq!(uniq.len(), seqs.len(), "重启后大纲重复 seq: {seqs:?}");

    driver.stop();
}

/// 恢复期间发送不得重编帧号:壳重启后打开长历史会话,replay_open 还在
/// 恢复 seq 水位时上行 user-input——旧实现只等引擎 resume 就编号,新帧
/// 从 0 重编、与旧帧撞 seq,大纲随之两点同亮、点击跳错。
#[tokio::test(flavor = "multi_thread")]
#[ignore = "需 MC_OHMYAGENT_BIN 钉住配套引擎;用 --include-ignored 显式跑"]
async fn e2e_send_during_replay_recovery_does_not_reuse_seqs() {
    require_ohmyagent();
    let _g = e2e_lock().await;
    let (driver, home) = e2e_setup("seq-recover", 0);

    let workdir = home.to_string_lossy().into_owned();
    let meta = driver.session_create(&workdir, "测试模型", false).await.expect("建会话");
    let sid = meta.get("id").and_then(|v| v.as_str()).unwrap().to_string();
    driver.session_open(&sid).await.expect("打开会话");
    let payload = json!({ "content": frame::b64_text("第一轮") });
    driver.session_send(&sid, "user-input", payload.clone()).await.expect("发送");
    let ended = |n: usize| {
        move |j: &[Value]| {
            j.iter().filter(|f| f.get("type").and_then(|v| v.as_str()) == Some("task-ended")).count() >= n
        }
    };
    let journal = wait_journal(&driver, &sid, ended(1)).await;
    assert!(ended(1)(&journal), "第一轮未结束: {journal:?}");
    let base_seq =
        journal.iter().filter_map(|f| f.get("seq").and_then(|v| v.as_u64())).max().unwrap();
    driver.stop();

    // 数据面伪造长历史(壳自己的帧格式,seq 顺延):把 replay_open 的
    // 恢复窗口拉长到肉眼可见,让竞态必然暴露
    let events = home.join("shellcfg/ohmy-sessions").join(&sid).join("events.jsonl");
    let mut buf = String::new();
    let mut seq = base_seq;
    for i in 0..15000u32 {
        seq += 1;
        buf.push_str(&frame::user_input(&format!("填充 {i}"), seq).to_string());
        buf.push('\n');
        seq += 1;
        buf.push_str(&frame::task_started(seq).to_string());
        buf.push('\n');
        seq += 1;
        buf.push_str(&frame::task_ended(seq).to_string());
        buf.push('\n');
    }
    {
        use std::io::Write as _;
        let mut f = std::fs::OpenOptions::new().append(true).open(&events).unwrap();
        f.write_all(buf.as_bytes()).unwrap();
    }

    // 重启壳,并发地「打开会话 + 立即发送」
    let settings: Value = serde_json::from_slice(
        &std::fs::read(home.join("shellcfg/ohmyagent/settings.json")).unwrap(),
    )
    .unwrap();
    let base_url = settings["models"]["测试模型"]["base_url"].as_str().unwrap().to_string();
    let ctx: Arc<dyn ShellCtx> = Arc::new(TestCtx::new(home.join("shellcfg")));
    let cfg = DesktopConfig {
        models: json!([{ "name": "测试模型", "provider": "anthropic",
            "base_url": base_url, "api_key": "sk-fake", "model": "test-model", "default": true }]),
        ..Default::default()
    };
    let driver = OhmyDriver::start_with(ctx, &cfg).expect("重启引擎");
    let open_task = {
        let d = driver.clone();
        let s = sid.clone();
        tokio::spawn(async move { d.session_open(&s).await })
    };
    // 稍等让 open 走到登记会话态/后台 resume,然后立刻怼一条输入
    tokio::time::sleep(Duration::from_millis(30)).await;
    let payload = json!({ "content": frame::b64_text("恢复期间的输入") });
    for i in 0..200 {
        match driver.session_send(&sid, "user-input", payload.clone()).await {
            Ok(_) => break,
            Err(e) if i < 199 => {
                let _ = e;
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            Err(e) => panic!("恢复期间发送失败: {e}"),
        }
    }
    open_task.await.expect("open 任务").expect("重启后打开会话");
    let journal = wait_journal(&driver, &sid, ended(15002)).await;
    assert!(ended(15002)(&journal), "恢复后一轮未结束");

    // 不变式:全 journal 无重复 seq——水位恢复前编号会撞上旧帧
    let all: Vec<u64> = journal.iter().filter_map(|f| f.get("seq").and_then(|v| v.as_u64())).collect();
    let uniq: HashSet<u64> = all.iter().copied().collect();
    assert_eq!(uniq.len(), all.len(), "恢复期间发送与旧帧撞 seq(重复 {} 个)", all.len() - uniq.len());

    // 大纲同样不得出现重复 seq
    let outline = driver.session_outline(&sid).await.expect("大纲");
    let seqs: Vec<u64> = outline
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|e| e.get("seq").and_then(|v| v.as_u64()))
        .collect();
    let uniq: HashSet<u64> = seqs.iter().copied().collect();
    assert_eq!(uniq.len(), seqs.len(), "大纲重复 seq: {}", seqs.len() - uniq.len());

    driver.stop();
}

/// AskUserQuestion 全链路:deferred 工具经 ToolSearch 载入 → 引擎
/// question/request → 壳 acp_ask_user_question 帧 → 答复 → 轮次完成。
#[tokio::test(flavor = "multi_thread")]
#[ignore = "需 MC_OHMYAGENT_BIN 钉住配套引擎;用 --include-ignored 显式跑"]
async fn e2e_ask_user_question_flow() {
    require_ohmyagent();
    let _g = e2e_lock().await;
    let steps = vec![
        sse_tool_use("tu_1", "ToolSearch", &json!({ "query": "AskUserQuestion" })),
        sse_tool_use("tu_2", "AskUserQuestion", &json!({ "questions": [{
            "question": "选哪个?", "header": "选择",
            "options": [{"label":"A","description":"甲"},{"label":"B","description":"乙"}],
            "multiSelect": false }] })),
        sse_text("好的,按 A 处理"),
    ];
    let (driver, home) = e2e_setup_steps("ask", 0, steps);
    let workdir = home.to_string_lossy().into_owned();
    let meta = driver.session_create(&workdir, "测试模型", false).await.expect("建会话");
    let sid = meta.get("id").and_then(|v| v.as_str()).unwrap().to_string();
    driver.session_open(&sid).await.expect("打开会话");
    driver.session_call(&sid, "session_set_mode", json!({ "mode": "yolo" })).await.expect("yolo");
    driver
        .session_send(&sid, "user-input", json!({ "content": frame::b64_text("问我一个问题") }))
        .await
        .expect("发送");

    // 提问卡帧落日志,取 request_id
    let journal = wait_journal(&driver, &sid, |j| {
        j.iter().any(|f| f.get("kind").and_then(|v| v.as_str()) == Some("acp_ask_user_question"))
    })
    .await;
    let req_id = journal
        .iter()
        .filter(|f| f.get("kind").and_then(|v| v.as_str()) == Some("acp_ask_user_question"))
        .filter_map(|f| f.get("data").cloned())
        .filter_map(|v| {
            v.get("toolCall")
                .and_then(|t| t.get("toolCallId"))
                .and_then(|i| i.as_str())
                .map(String::from)
        })
        .next()
        .unwrap_or_default();
    assert!(!req_id.is_empty(), "未收到提问卡帧,journal: {journal:?}");

    // 答复 → 轮次完成,答案回显帧在日志(回放可见)
    driver
        .session_send(
            &sid,
            "reply-question",
            json!({ "request_id": req_id, "answers_json": "{\"选哪个?\":\"A\"}", "cancelled": false }),
        )
        .await
        .expect("答复");
    let journal = wait_journal(&driver, &sid, |j| {
        j.iter().any(|f| f.get("type").and_then(|v| v.as_str()) == Some("task-ended"))
    })
    .await;
    let types: Vec<&str> =
        journal.iter().filter_map(|f| f.get("type").and_then(|v| v.as_str())).collect();
    assert!(types.contains(&"reply-question"), "缺答案回显帧: {types:?}");
    assert!(types.contains(&"task-ended"), "轮次未完成: {types:?}");
    driver.stop();
}

/// 裸 Inner 没跑过 system/ready,版本为空;句柄生命周期测试只关心状态与
/// 句柄的原子性,给个占位的就绪态即可。
fn ready_status() -> crate::driver::EngineStatus {
    crate::driver::EngineStatus::Ready { version: String::new() }
}

/// 构造裸 Inner(不起引擎进程):journal 写线程 + 会话表,专测回放窗口
/// 与句柄生命周期,不依赖 ohmyagent 二进制。
fn bare_inner(tag: &str) -> Arc<Inner> {
    bare_inner_events(tag).0
}

/// 同 bare_inner,另给一份壳事件缓冲(断言 session-event 用)。
fn bare_inner_events(tag: &str) -> (Arc<Inner>, EmittedEvents) {
    let home = std::env::temp_dir().join(format!("ohmy-journal-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    let data_dir = home.join("ohmy-sessions");
    std::fs::create_dir_all(&data_dir).unwrap();
    let (stdin_tx, _stdin_rx) = mpsc::unbounded_channel();
    let ctx = TestCtx::new(home.clone());
    let events = ctx.1.clone();
    let inner = Arc::new(Inner {
        app: Arc::new(ctx),
        transport: TransportState {
            child: StdMutex::new(None),
            stdin_tx,
            pending: StdMutex::new(HashMap::new()),
            next_id: AtomicI64::new(1),
            journal_tx: spawn_journal_writer(data_dir.clone()),
            engine_caps: StdMutex::new(HashSet::new()),
            engine_version: StdMutex::new("agent-test-commit".into()),
            shutdown_grace_ms: AtomicI64::new(5000),
            stopped: Arc::new(AtomicBool::new(false)),
            instance: 1,
        },
        sess: SessionsState {
            sessions: StdMutex::new(HashMap::new()),
            batch: Arc::new(StdMutex::new(HashMap::new())),
            sidecar_write: StdMutex::new(()),
            perm_remember: StdMutex::new(HashSet::new()),
            pending_questions: StdMutex::new(HashMap::new()),
            pending_perms: StdMutex::new(HashMap::new()),
            perm_tools: StdMutex::new(HashMap::new()),
            resume: StdMutex::new(HashMap::new()),
        },
        sub: SubagentState {
            subagents: StdMutex::new(HashMap::new()),
            agent_results: StdMutex::new(HashMap::new()),
            agent_inputs: StdMutex::new(HashMap::new()),
            background_agents: StdMutex::new(HashMap::new()),
        },
        models: vec![],
        data_dir,
        engine_dir: home.join("ohmyagent"),
        chat_workspaces_dir: home.join("local-data/chat-workspaces"),
        perm_persist_path: home.join("perm.json"),
        stats: crate::stats::UsageStats::new(&home),
        wsl: None,
    });
    (inner, events)
}

fn bare_session(sid: &str) -> SessionState {
    SessionState {
        seq: 0,
        running: true,
        compacting: false,
        turn: 1,
        created: true,
        engine_id: sid.to_string(),
        opened: false,
        open_tools: HashMap::new(),
        model_text: String::new(),
        last_event_seq: 0,
        context_usage: None,
        workdir: String::new(),
        model_name: String::new(),
        mode: "default".into(),
        title: String::new(),
        fold: Default::default(),
    }
}

#[test]
fn concurrent_sidecar_updates_do_not_lose_fields() {
    let inner = bare_inner("sidecar-race");
    let start = Arc::new(std::sync::Barrier::new(33));
    let mut workers = Vec::new();
    for i in 0..32u64 {
        let inner = inner.clone();
        let start = start.clone();
        workers.push(std::thread::spawn(move || {
            start.wait();
            inner.write_sidecar("s1", |meta| {
                meta.as_object_mut().unwrap().insert(format!("field_{i}"), json!(i));
            });
        }));
    }
    start.wait();
    for worker in workers { worker.join().unwrap(); }

    let meta = inner.read_sidecar("s1");
    for i in 0..32u64 {
        let key = format!("field_{i}");
        assert_eq!(meta.get(&key).and_then(Value::as_u64), Some(i));
    }
    assert!(meta.get("updated_at").and_then(Value::as_u64).is_some());
}

#[tokio::test]
async fn sessions_list_treats_legacy_finished_as_idle() {
    let inner = bare_inner("legacy-finished");
    inner.write_sidecar("legacy", |meta| {
        meta["title"] = json!("可继续的旧会话");
        meta["workdir"] = json!("/workspace/legacy");
        meta["turns"] = json!(3);
        meta["status"] = json!("finished");
    });

    let list = OhmyDriver(inner).sessions_list().await.unwrap();
    let legacy = list.as_array().unwrap().iter().find(|item| item["id"] == "legacy").unwrap();
    assert_eq!(legacy["status"], "idle");
    assert_eq!(legacy["turns"], 3);
}

#[test]
fn browser_context_resolves_explicit_sessions_without_rejecting_concurrency() {
    let inner = bare_inner("browser-owner");
    let mut one = bare_session("s1");
    one.workdir = "/workspace/one".into();
    let mut two = bare_session("s2");
    two.workdir = "/workspace/two".into();
    {
        let mut sessions = inner.sess.sessions.lock().unwrap();
        sessions.insert("s1".into(), one);
        sessions.insert("s2".into(), two);
    }
    let driver = OhmyDriver(inner.clone());
    assert_eq!(driver.browser_workdir_for("s1").as_deref(), Some("/workspace/one"));
    assert_eq!(driver.browser_workdir_for("s2").as_deref(), Some("/workspace/two"));
    assert_eq!(driver.single_running_workdir(), None, "多任务时仅停用旧式落盘兜底");

    inner.sess.sessions.lock().unwrap().get_mut("s2").unwrap().running = false;
    assert_eq!(driver.single_running_workdir().as_deref(), Some("/workspace/one"));

    // 即使没有子会话流，显式后台登记也继续归属父 workspace，并阻止维护重启。
    inner.sess.sessions.lock().unwrap().get_mut("s1").unwrap().running = false;
    inner.sub.background_agents.lock().unwrap()
        .insert("agent-1".into(), ("s1".into(), "tc-1".into()));
    assert_eq!(driver.single_running_workdir().as_deref(), Some("/workspace/one"));
    assert!(driver.has_running_sessions());
}

#[test]
fn public_caps_follow_the_ready_handshake() {
    let inner = bare_inner("caps");
    inner.transport.engine_caps.lock().unwrap().insert("turn/stopped".into());
    let driver = OhmyDriver(inner);
    let caps = crate::driver::caps(&driver, false);
    assert!(!caps.browser_ext);
    assert!(caps.usage_update);
    assert!(!caps.perm_remember);
    assert!(caps.attachments);
}

#[test]
fn driver_exposes_the_ready_version() {
    let driver = OhmyDriver(bare_inner("version"));
    assert_eq!(driver.version(), "agent-test-commit");
}

#[test]
fn driver_host_maintenance_drains_leases_and_closes_the_command_gate() {
    let host = Arc::new(crate::driver::DriverHost::new());
    host.set(OhmyDriver(bare_inner("host-lease")), ready_status());
    let lease = host.get().unwrap();
    let (acquired_tx, acquired_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let worker_host = host.clone();
    let worker = std::thread::spawn(move || {
        let _apply = worker_host.begin_apply();
        acquired_tx.send(()).unwrap();
        release_rx.recv().unwrap();
    });

    assert!(acquired_rx.recv_timeout(Duration::from_millis(30)).is_err());
    drop(lease);
    acquired_rx.recv_timeout(Duration::from_secs(1)).expect("维护应在 lease 释放后进入");
    let error = match host.get() {
        Err(error) => error,
        Ok(_) => panic!("维护期间不应发放新 lease"),
    };
    assert!(error.contains("正在应用"));
    release_tx.send(()).unwrap();
    worker.join().unwrap();
    assert!(host.get().is_ok());
}

#[test]
fn idle_maintenance_does_not_churn_the_command_gate_while_work_is_running() {
    let host = crate::driver::DriverHost::new();
    let inner = bare_inner("host-busy");
    inner
        .sess
        .sessions
        .lock().unwrap()
        .insert("s1".into(), bare_session("s1"));
    host.set(OhmyDriver(inner), ready_status());

    assert!(host.try_begin_idle_apply().is_none());
    assert!(host.get().is_ok(), "忙碌轮询不应短暂关闭命令入口");
}

/// 回放窗口不丢帧(修复:旧实现 opened=false 期间到达的帧只入日志
/// 不入缓冲,读完日志才置 opened=true,窗口内的帧 UI 看不到):
/// 并发推帧线程贯穿整个回放过程,回放结果 + 之后的 batch 缓冲按 seq
/// 拼接必须恰好覆盖 1..=N,无缺口无重复;journal 落盘侧同样完整有序。
#[test]
fn replay_window_no_frame_loss() {
    let inner = bare_inner("replay");
    inner.sess.sessions.lock().unwrap().insert("s1".into(), bare_session("s1"));
    // 预置 50 帧历史(opened=false → 只落盘)
    for _ in 0..50 {
        inner.push_frame("s1", |seq| json!({ "type": "t", "seq": seq }));
    }
    // 并发推帧:覆盖回放的读盘窗口
    let inner2 = inner.clone();
    let pusher = std::thread::spawn(move || {
        for _ in 0..200 {
            inner2.push_frame("s1", |seq| json!({ "type": "t", "seq": seq }));
            std::thread::sleep(Duration::from_micros(200));
        }
    });
    std::thread::sleep(Duration::from_millis(5)); // 让并发流先跑起来
    let replay = inner.replay_open("s1");
    pusher.join().unwrap();
    let rseqs: Vec<u64> =
        replay.frames.iter().filter_map(|f| f.get("seq").and_then(|v| v.as_u64())).collect();
    assert!(rseqs.len() >= 50, "回放至少含预置帧: {}", rseqs.len());
    assert_eq!(rseqs.first(), Some(&1));
    assert!(rseqs.windows(2).all(|w| w[1] == w[0] + 1), "回放帧 seq 不连续: {rseqs:?}");
    // opened=true 之后的帧全部进 batch,与回放结果无缝衔接
    let batched: Vec<u64> = inner
        .sess.batch
        .lock().unwrap()
        .get("s1")
        .map(|v| v.iter().filter_map(|f| f.get("seq").and_then(|x| x.as_u64())).collect())
        .unwrap_or_default();
    let mut all = rseqs;
    all.extend(batched);
    assert_eq!(all, (1..=250).collect::<Vec<u64>>(), "回放+缓冲拼接有缺口/重复");
    // 落盘侧同样完整:屏障后日志恰 250 行且 seq 连续(写线程按投递序追加)
    inner.journal_barrier();
    let data =
        std::fs::read_to_string(inner.data_dir.join("s1").join("events.jsonl")).unwrap();
    let jseqs: Vec<u64> = data
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter_map(|f| f.get("seq").and_then(|v| v.as_u64()))
        .collect();
    assert_eq!(jseqs, (1..=250).collect::<Vec<u64>>(), "journal 落盘不完整/乱序");
}

/// 删除路径契约:journal_close(wait=true) 先排空该会话余帧、关句柄,
/// 之后目录才可安全移除(Windows 上打开中的文件删不掉目录)。
#[test]
fn journal_close_drains_before_delete() {
    let inner = bare_inner("close");
    inner.sess.sessions.lock().unwrap().insert("s1".into(), bare_session("s1"));
    for _ in 0..20 {
        inner.push_frame("s1", |seq| json!({ "type": "t", "seq": seq }));
    }
    inner.sess.sessions.lock().unwrap().remove("s1"); // 删除路径先摘会话,不再产新帧
    inner.journal_close("s1", true);
    let dir = inner.data_dir.join("s1");
    let n = std::fs::read_to_string(dir.join("events.jsonl")).unwrap().lines().count();
    assert_eq!(n, 20, "close 前入队的帧须全部落盘");
    std::fs::remove_dir_all(&dir).expect("句柄已关,目录可删");
    assert!(!dir.exists());
}

/// SubAgent 进度:上游转发的子循环事件(未知随机 session_id)被认领到
/// 父会话,归一化为 Agent 工具卡的 progress feed(subagent_text 行)。
#[tokio::test(flavor = "multi_thread")]
#[ignore = "需 MC_OHMYAGENT_BIN 钉住配套引擎;用 --include-ignored 显式跑"]
async fn e2e_subagent_progress() {
    require_ohmyagent();
    let _g = e2e_lock().await;
    let steps = vec![
        sse_tool_use("tu_1", "Agent", &json!({ "prompt": "调查并汇报", "description": "调查任务" })),
        sse_text("子代理调查结果:一切正常\n"),
        sse_text("父任务完成"),
    ];
    let (driver, home) = e2e_setup_steps("sub", 0, steps);
    let workdir = home.to_string_lossy().into_owned();
    let meta = driver.session_create(&workdir, "测试模型", false).await.expect("建会话");
    let sid = meta.get("id").and_then(|v| v.as_str()).unwrap().to_string();
    driver.session_open(&sid).await.expect("打开会话");
    driver.session_call(&sid, "session_set_mode", json!({ "mode": "yolo" })).await.expect("yolo");
    driver
        .session_send(&sid, "user-input", json!({ "content": frame::b64_text("派个子代理") }))
        .await
        .expect("发送");

    let journal = wait_journal(&driver, &sid, |j| {
        j.iter().any(|f| f.get("type").and_then(|v| v.as_str()) == Some("task-ended"))
    })
    .await;
    // Agent 工具卡存在且完成;标题带 description 标签(TUI 面板同源)
    let agent_done = journal.iter().filter_map(acp_update).any(|u| {
        u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("tool_call_update")
            && u.get("toolCallId").and_then(|v| v.as_str()) == Some("tu_1")
            && u.get("status").and_then(|v| v.as_str()) == Some("completed")
    });
    assert!(agent_done, "Agent 工具未完成: {journal:?}");
    let agent_titled = journal.iter().filter_map(acp_update).any(|u| {
        u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("tool_call")
            && u.get("toolCallId").and_then(|v| v.as_str()) == Some("tu_1")
            && u.get("title").and_then(|v| v.as_str()).map(|t| t.contains("调查任务")).unwrap_or(false)
    });
    assert!(agent_titled, "Agent 卡标题缺 description 标签: {journal:?}");
    // 子代理文本行以 progress feed 形态挂在 Agent 工具卡上
    let has_sub_text = journal.iter().filter_map(acp_update).any(|u| {
        u.get("toolCallId").and_then(|v| v.as_str()) == Some("tu_1")
            && u.get("progress").and_then(|p| p.get("kind")).and_then(|v| v.as_str())
                == Some("subagent_text")
            && u.get("progress")
                .and_then(|p| p.get("line"))
                .and_then(|v| v.as_str())
                .map(|l| l.contains("子代理调查结果"))
                .unwrap_or(false)
    });
    assert!(has_sub_text, "缺子代理进度行: {journal:?}");
    // 子会话物化:父卡有 child_session 链接,子 journal 形状完整可回放
    let child_id = journal
        .iter()
        .filter_map(acp_update)
        .find_map(|u| {
            if u.get("toolCallId").and_then(|v| v.as_str()) != Some("tu_1") {
                return None;
            }
            let p = u.get("progress")?;
            if p.get("kind").and_then(|v| v.as_str()) != Some("child_session") {
                return None;
            }
            p.get("childSessionId").and_then(|v| v.as_str()).map(String::from)
        })
        .expect("缺 child_session 链接");
    let ctypes: Vec<String> = driver
        .read_journal(&child_id)
        .iter()
        .filter_map(|f| f.get("type").and_then(|v| v.as_str()).map(String::from))
        .collect();
    for t in ["user-input", "task-started", "task-ended"] {
        assert!(ctypes.iter().any(|x| x == t), "子会话缺 {t}: {ctypes:?}");
    }
    // 子会话不进会话列表(经父卡点开)
    let list = driver.sessions_list().await.unwrap();
    assert!(
        list.as_array()
            .unwrap()
            .iter()
            .all(|s| s.get("id").and_then(|v| v.as_str()) != Some(child_id.as_str())),
        "子会话不应出现在列表"
    );
    driver.stop();
}

/// 审批记忆迁移引擎(permissionRemember):UI 勾选"记住"映射为
/// permission/respond.remember=true——引擎按命令段粒度记成项目级规则
/// (cwd/.ohmyagent/settings.json),二次同命令不再弹卡;壳侧不再记忆,
/// 持久化文件停用。
#[tokio::test(flavor = "multi_thread")]
#[ignore = "需 MC_OHMYAGENT_BIN 钉住配套引擎;用 --include-ignored 显式跑"]
async fn e2e_perm_remember_engine_rules() {
    require_ohmyagent();
    let _g = e2e_lock().await;
    // git push 不在引擎安全命令白名单 → default 模式必弹审批;
    // 同一命令连发两次:第一次批准并记住,第二次考验引擎侧规则
    let steps = vec![
        sse_tool_use("tu_1", "Bash", &json!({ "command": "git push origin main" })),
        sse_tool_use("tu_2", "Bash", &json!({ "command": "git push origin main" })),
        sse_text("推送完成"),
    ];
    let (driver, home) = e2e_setup_steps("perm", 0, steps);
    let workdir = home.to_string_lossy().into_owned();
    let meta = driver.session_create(&workdir, "测试模型", false).await.expect("建会话");
    let sid = meta.get("id").and_then(|v| v.as_str()).unwrap().to_string();
    driver.session_open(&sid).await.expect("打开会话");
    driver
        .session_send(&sid, "user-input", json!({ "content": frame::b64_text("推送代码") }))
        .await
        .expect("发送");

    // 首个 Bash 调用弹审批卡
    let journal = wait_journal(&driver, &sid, |j| {
        j.iter().any(|f| f.get("type").and_then(|v| v.as_str()) == Some("permission-req"))
    })
    .await;
    let req_data = journal
        .iter()
        .filter(|f| f.get("type").and_then(|v| v.as_str()) == Some("permission-req"))
        .filter_map(|f| f.get("data").cloned())
        .next()
        .unwrap_or_default();
    let req_id =
        req_data.get("id").and_then(|i| i.as_str()).map(String::from).unwrap_or_default();
    assert!(!req_id.is_empty(), "未收到审批卡帧: {journal:?}");
    // permissionToolCallId 透传:引擎审批请求带 provider 工具调用 id,
    // 壳原样进帧(UI 据此把审批按钮锚到 tool_call 帧建的那张工具卡)
    assert_eq!(
        req_data.get("tool_call_id").and_then(|v| v.as_str()),
        Some("tu_1"),
        "审批帧缺 tool_call_id 透传: {req_data}"
    );

    // 批准并勾选"记住"(persist 档与 remember 档同映射引擎单档)
    driver
        .session_send(
            &sid,
            "permission-resp",
            json!({ "id": req_id, "approved": true, "remember": true, "persist": true }),
        )
        .await
        .expect("审批");

    let journal = wait_journal(&driver, &sid, |j| {
        j.iter().any(|f| f.get("type").and_then(|v| v.as_str()) == Some("task-ended"))
    })
    .await;
    let types: Vec<&str> =
        journal.iter().filter_map(|f| f.get("type").and_then(|v| v.as_str())).collect();
    assert!(types.contains(&"task-ended"), "轮次未完成: {types:?}");
    // 引擎侧规则生效:二次同命令不再弹卡,审批卡帧全程只出现一次
    let perm_reqs = types.iter().filter(|t| **t == "permission-req").count();
    assert_eq!(perm_reqs, 1, "引擎规则未生效,二次同命令又弹卡: {types:?}");
    // 规则由引擎持久化到项目设置(命令段粒度 Bash(git push *))
    let rules =
        std::fs::read_to_string(home.join(".ohmyagent").join("settings.json")).unwrap_or_default();
    assert!(rules.contains("Bash(git push"), "项目设置缺命令段规则: {rules}");
    // 壳侧持久化文件停用(旧路径才写 ohmy-perm-remember.json)
    assert!(!driver.0.perm_persist_path.exists(), "壳侧审批记忆文件不应再写");
    driver.stop();
}

/// 压缩状态行:引擎只有"压缩完成"一个事件。自动压缩事后补 started+ended
/// 一对(记录有始有终);手动压缩(compacting 在飞)发起时壳已实时落过
/// started,事件只补 ended——否则"正在压缩/压缩完成"同刻蹦出两条。
/// 判据不看 kind:手动的 LLM 失败会降级成 local_fallback。micro 不落帧。
#[test]
fn compaction_frames_skip_started_while_manual_compact_in_flight() {
    let inner = bare_inner("compactline");
    inner.sess.sessions.lock().unwrap().insert("s1".into(), bare_session("s1"));
    let ev = |data: Value| json!({ "type": "compaction", "session_id": "s1", "data": data });
    inner.handle_event(ev(json!({ "kind": "auto", "tokens_saved": 10 })));
    inner.handle_event(ev(json!({ "kind": "micro", "cleared": 3 })));
    inner.sess.sessions.lock().unwrap().get_mut("s1").unwrap().compacting = true;
    inner.handle_event(ev(json!({ "kind": "local_fallback", "tokens_saved": 10 })));
    inner.journal_barrier();
    let data =
        std::fs::read_to_string(inner.data_dir.join("s1").join("events.jsonl")).unwrap();
    let statuses: Vec<String> = data
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter_map(|f| acp_update(&f))
        .filter(|u| u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("compact_status"))
        .filter_map(|u| u.get("status").and_then(|v| v.as_str()).map(String::from))
        .collect();
    assert_eq!(statuses, vec!["started", "ended", "ended"], "压缩状态行序列不符");
}

/// modelDoneText 全文对账:delta 被背压丢弃时,model_done 的权威全文
/// 以壳侧累积为前缀——缺口经正规产帧路径补成增量帧,journal 完整;
/// 完全不一致则不注入(仅日志外显)。
#[test]
fn model_done_reconciles_dropped_deltas() {
    let inner = bare_inner("mdone");
    inner.transport.engine_caps.lock().unwrap().insert("modelDoneText".into());
    inner.sess.sessions.lock().unwrap().insert("s1".into(), bare_session("s1"));
    let ev = |t: &str, data: Value| json!({ "type": t, "session_id": "s1", "data": data });
    inner.handle_event(ev("model_start", Value::Null));
    inner.handle_event(ev("model_delta", json!({ "text": "你好" })));
    // 「,世界」的 delta 被引擎背压丢弃……全文经 model_done 找回
    inner.handle_event(ev("model_done", json!({ "text": "你好,世界" })));
    // 第二段:累积与全文完全不一致 → 不注入
    inner.handle_event(ev("model_start", Value::Null));
    inner.handle_event(ev("model_delta", json!({ "text": "abc" })));
    inner.handle_event(ev("model_done", json!({ "text": "xyz" })));
    inner.journal_barrier();
    let data =
        std::fs::read_to_string(inner.data_dir.join("s1").join("events.jsonl")).unwrap();
    let texts: Vec<String> = data
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter_map(|f| acp_update(&f))
        .filter(|u| u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("agent_message_chunk"))
        .filter_map(|u| u["content"]["text"].as_str().map(String::from))
        .collect();
    assert_eq!(texts, vec!["你好", ",世界", "abc"], "对账补帧不符");
}

/// 会话摘要(引擎每轮异步生成):落 sidecar 的 summary 字段供顶栏副标题
/// 展示——不碰 title(标题归用户与首条消息)、不刷 updated_at(摘要与用户
/// 动作无关,刷了会把会话无端顶到侧栏最前),并经独立的 session-summary
/// 事件通知 UI(复用 session-status 会在轮次收尾后重复弹一次「已回复」)。
#[test]
fn session_summary_lands_in_sidecar_without_touching_title_or_order() {
    let (inner, events) = bare_inner_events("summary");
    inner.sess.sessions.lock().unwrap().insert("s1".into(), bare_session("s1"));
    inner.write_sidecar("s1", |m| m["title"] = json!("首条消息截断而来的标题"));
    let updated_before = inner.read_sidecar("s1").get("updated_at").cloned().unwrap();
    // 时间戳是毫秒:同毫秒内写两次会让"没刷新"这条断言白过
    std::thread::sleep(Duration::from_millis(2));

    inner.handle_event(json!({ "type": "session_summary", "session_id": "s1",
        "data": { "summary": "  修复登录流程  " } }));

    let meta = inner.read_sidecar("s1");
    assert_eq!(meta.get("summary").and_then(Value::as_str), Some("修复登录流程"), "摘要未落盘: {meta}");
    assert_eq!(
        meta.get("title").and_then(Value::as_str),
        Some("首条消息截断而来的标题"),
        "摘要不该改标题: {meta}"
    );
    assert_eq!(meta.get("updated_at"), Some(&updated_before), "摘要不该刷 updated_at: {meta}");

    let session_events = |events: &EmittedEvents| -> Vec<Value> {
        events.lock().unwrap().iter().filter(|(n, _)| n == "session-event").map(|(_, p)| p.clone()).collect()
    };
    let emitted = session_events(&events);
    assert_eq!(emitted.len(), 1, "应只发一条会话事件: {emitted:?}");
    assert_eq!(emitted[0]["type"].as_str(), Some("session-summary"), "事件类型不符: {emitted:?}");
    assert_eq!(emitted[0]["summary"].as_str(), Some("修复登录流程"), "事件缺摘要: {emitted:?}");

    // 空摘要忽略(不覆盖已有的),子代理子会话(sidecar 带 parent)不落也不发
    inner.handle_event(json!({ "type": "session_summary", "session_id": "s1", "data": { "summary": "   " } }));
    inner.sess.sessions.lock().unwrap().insert("child".into(), bare_session("child"));
    inner.write_sidecar("child", |m| m["parent"] = json!("s1"));
    inner.handle_event(json!({ "type": "session_summary", "session_id": "child",
        "data": { "summary": "子代理的摘要" } }));
    assert_eq!(
        inner.read_sidecar("s1")["summary"].as_str(),
        Some("修复登录流程"),
        "空摘要不该覆盖已有摘要"
    );
    assert!(inner.read_sidecar("child").get("summary").is_none(), "子会话不该落摘要");
    assert_eq!(session_events(&events).len(), 1, "空摘要/子会话不该再发事件");
}

/// event/stream usage 只用 context_* 更新事件所属 Agent 的上下文环：
/// 主 Agent 轮中可见，子代理自己的用量不会回填并抬高父会话 composer。
#[test]
fn streaming_usage_updates_emitting_agent_without_parent_leak() {
    let inner = bare_inner("usage-stream");
    {
        let mut sessions = inner.sess.sessions.lock().unwrap();
        sessions.insert("main".into(), bare_session("main"));
        sessions.insert("child".into(), bare_session("child"));
    }

    inner.handle_event(json!({ "type": "usage", "session_id": "main", "seq": 1,
        "data": { "input_tokens": 900, "output_tokens": 20,
            "context_used": 1_234, "context_window": 200_000 } }));
    // Anthropic 等 provider 会在同一调用的 message_start/message_delta
    // 各发 usage；context 未变化时不得重复刷 UI/写 journal。
    inner.handle_event(json!({ "type": "usage", "session_id": "main", "seq": 2,
        "data": { "context_used": 1_234, "context_window": 200_000 } }));
    inner.handle_event(json!({ "type": "usage", "session_id": "child", "seq": 1,
        "parent_session_id": "main", "parent_tool_call_id": "tc-agent",
        "data": { "input_tokens": 40_000, "output_tokens": 5_000,
            "context_used": 45_678, "context_window": 64_000 } }));

    let usage_of = |sid: &str| {
        journal_frames(&inner, sid).iter().filter_map(acp_update)
            .filter(|u| u.get("sessionUpdate").and_then(Value::as_str) == Some("usage_update"))
            .map(|u| (
                u.get("used").and_then(Value::as_i64).unwrap_or(-1),
                u.get("size").and_then(Value::as_i64).unwrap_or(-1),
            ))
            .collect::<Vec<_>>()
    };
    assert_eq!(usage_of("main"), vec![(1_234, 200_000)]);
    assert_eq!(usage_of("child"), vec![(45_678, 64_000)]);
}

/// usage 事件里的 input/output tokens 会记入本地用量统计(按天/会话/模型),
/// 纯 context 快照(无 input/output)不重复记账;模型归属取会话当前 model_name。
#[test]
fn usage_events_accumulate_into_daily_stats() {
    let inner = bare_inner("usage-stats");
    {
        let mut sessions = inner.sess.sessions.lock().unwrap();
        let mut main = bare_session("main");
        main.model_name = "glm-4.5".into();
        main.title = "重构登录".into();
        sessions.insert("main".into(), main);
    }

    inner.handle_event(json!({ "type": "usage", "session_id": "main", "seq": 1,
        "data": { "input_tokens": 900, "output_tokens": 20,
            "context_used": 1_234, "context_window": 200_000 } }));
    // 同一调用的 message_start/message_delta 第二个事件没有 input/output → 不记账
    inner.handle_event(json!({ "type": "usage", "session_id": "main", "seq": 2,
        "data": { "context_used": 1_234, "context_window": 200_000 } }));
    inner.handle_event(json!({ "type": "usage", "session_id": "main", "seq": 3,
        "data": { "input_tokens": 40_000, "output_tokens": 5_000,
            "context_used": 45_678, "context_window": 64_000 } }));

    let snap = inner.stats.snapshot();
    assert_eq!(snap["totals"]["input_tokens"], 40_900, "{snap}");
    assert_eq!(snap["totals"]["output_tokens"], 5_020, "{snap}");
    assert_eq!(snap["totals"]["calls"], 2, "纯 context 快照不应计调用次数: {snap}");

    let today = crate::stats::today();
    assert_eq!(snap["days"][0]["date"], today, "{snap}");
    assert_eq!(snap["days"][0]["input_tokens"], 40_900, "{snap}");

    assert_eq!(snap["models"][0]["model"], "glm-4.5", "{snap}");
    assert_eq!(snap["models"][0]["input_tokens"], 40_900, "{snap}");

    let sess = &snap["sessions"][0];
    assert_eq!(sess["session_id"], "main", "{snap}");
    assert_eq!(sess["title"], "重构登录", "{snap}");
    assert!(sess["parent"].is_null(), "{snap}");
    assert_eq!(sess["input_tokens"], 40_900, "{snap}");
    assert_eq!(sess["days"][0]["output_tokens"], 5_020, "{snap}");
}

/// 最新 Agent 将 turn/stopped 与 usage 统一成扁平字段；旧版嵌套形状仍
/// 接受，保证桌面壳与已分发 sidecar 的滚动升级兼容。
#[test]
fn turn_stopped_accepts_flat_and_legacy_context_shapes() {
    let inner = bare_inner("usage-stopped");
    {
        let mut sessions = inner.sess.sessions.lock().unwrap();
        sessions.insert("flat".into(), bare_session("flat"));
        sessions.insert("legacy".into(), bare_session("legacy"));
    }

    inner.handle_notification("turn/stopped", json!({
        "session_id": "flat", "stop_reason": "complete",
        "context_used": 2_345, "context_window": 200_000
    }));
    inner.handle_notification("turn/stopped", json!({
        "session_id": "legacy", "stop_reason": "complete",
        "context": { "used_tokens": 3_456, "window_tokens": 128_000 }
    }));

    let last_usage = |sid: &str| {
        journal_frames(&inner, sid).iter().filter_map(acp_update)
            .filter(|u| u.get("sessionUpdate").and_then(Value::as_str) == Some("usage_update"))
            .last()
            .map(|u| (
                u.get("used").and_then(Value::as_i64).unwrap_or(-1),
                u.get("size").and_then(Value::as_i64).unwrap_or(-1),
            ))
    };
    assert_eq!(last_usage("flat"), Some((2_345, 200_000)));
    assert_eq!(last_usage("legacy"), Some((3_456, 128_000)));
}

/// structuredToolResult:失败判定用 is_error 结构位(不再嗅探 "Error: "
/// 前缀);Agent 工具卡内容以 agent_result 事件的全量 content 为权威
/// (tool_result 截断 500 字符可能把结果 JSON 截成半截)。
#[test]
fn structured_tool_result_and_agent_result() {
    let inner = bare_inner("sres");
    inner.transport.engine_caps.lock().unwrap().insert("structuredToolResult".into());
    inner.sess.sessions.lock().unwrap().insert("s1".into(), bare_session("s1"));
    let ev = |t: &str, tc: &str, data: Value| {
        json!({ "type": t, "session_id": "s1", "tool_call_id": tc, "data": data })
    };
    // is_error=true 但内容无 "Error: " 前缀 → 仍判失败
    inner.handle_event(ev("tool_call", "tc1", json!({ "name": "Bash", "input": { "command": "x" } })));
    inner.handle_event(ev("tool_result", "tc1", json!({ "tool": "Bash", "content": "exit 1", "is_error": true })));
    // Agent:agent_result 全量内容(远超 500 截断)为权威,tool_result
    // 侧只回了截断破损的半截 JSON
    inner.handle_event(ev("tool_call", "tc2", json!({ "name": "Agent", "input": { "description": "d", "prompt": "p" } })));
    let full = "结".repeat(600);
    inner.handle_event(ev(
        "agent_result",
        "tc2",
        json!({ "status": "completed", "agentId": "a1", "agentType": "explore", "content": full }),
    ));
    inner.handle_event(ev("tool_result", "tc2", json!({ "tool": "Agent", "content": "{\"status\":\"comp", "is_error": false })));
    inner.journal_barrier();
    let data =
        std::fs::read_to_string(inner.data_dir.join("s1").join("events.jsonl")).unwrap();
    let updates: Vec<Value> = data
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter_map(|f| acp_update(&f))
        .filter(|u| u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("tool_call_update"))
        .collect();
    let tc1 = updates
        .iter()
        .find(|u| u.get("toolCallId").and_then(|v| v.as_str()) == Some("tc1"))
        .expect("缺 tc1 收尾帧");
    assert_eq!(tc1.get("status").and_then(|v| v.as_str()), Some("failed"), "is_error 未判失败");
    let tc2 = updates
        .iter()
        .find(|u| u.get("toolCallId").and_then(|v| v.as_str()) == Some("tc2"))
        .expect("缺 tc2 收尾帧");
    assert_eq!(tc2.get("status").and_then(|v| v.as_str()), Some("completed"));
    assert_eq!(
        tc2.get("rawOutput").and_then(|v| v.as_str()),
        Some(full.as_str()),
        "Agent 结果未采用 agent_result 全量内容"
    );
}

/// tool_result 里的 uploads 路径只有图片扩展名才进 images 帧:字段契约是
/// "工具产出图片",docx/json/.gitignore 混进去会被 UI 塞进 <img> 渲染成裂图
/// (壳回读非图片是 application/octet-stream 数据 URL,解不出位图)。
#[test]
fn upload_path_extraction_keeps_only_images() {
    let content = "读取 .monkeycode/uploads/合同.docx 与 .monkeycode/uploads/latest.json,\
                   截图 .monkeycode/uploads/browser-1.png (.monkeycode/uploads/cat.JPG) \
                   忽略 .monkeycode/uploads/.gitignore 与重复 .monkeycode/uploads/browser-1.png";
    assert_eq!(
        crate::driver::normalize::extract_upload_paths(content),
        [".monkeycode/uploads/browser-1.png", ".monkeycode/uploads/cat.JPG"]
    );
}

/// 无 parent_session_id 戳记的子代理事件不再猜测认领(旧启发式按
/// "运行中且持有未闭合 Agent 工具的会话"猜,并发多 Agent 会挂错父卡):
/// 未知会话 + 无戳记 → 丢弃;带戳记 → 精确认领。
#[test]
fn unstamped_subagent_event_not_claimed() {
    let inner = bare_inner("unst");
    let mut s = bare_session("s1");
    s.open_tools.insert("tc1".into(), "Agent".into());
    inner.sess.sessions.lock().unwrap().insert("s1".into(), s);
    // 旧启发式条件齐备(运行中 + 未闭合 Agent 工具)也不认领
    inner.handle_event(json!({ "type": "model_delta", "session_id": "child9", "data": { "text": "hi" } }));
    assert!(!inner.sess.sessions.lock().unwrap().contains_key("child9"), "无戳记事件不应物化子会话");
    assert!(inner.sub.subagents.lock().unwrap().is_empty());
    // 带戳记则精确认领
    inner.handle_event(json!({ "type": "model_delta", "session_id": "child9",
        "parent_session_id": "s1", "parent_tool_call_id": "tc1", "data": { "text": "hi" } }));
    assert!(inner.sess.sessions.lock().unwrap().contains_key("child9"), "带戳记事件应认领");
    assert_eq!(
        inner.sub.subagents.lock().unwrap().get("child9").map(|r| r.parent_tc.clone()),
        Some("tc1".into())
    );
}

// ==================== 显式后台子代理(async_launched) ====================
//
// 事件序列 ground truth(当前固定引擎,Agent 入参 run_in_background=true):
//   tool_call(Agent tu_1)
//   tool_result(tu_1){content=async_launched JSON:{agentId,agentType,
//     description,name,note,reason,status:"async_launched"}——**无 content
//     字段**,is_error=false;后台路径不发 agent_result}
//   (父轮继续;子代理事件带 parent_session_id/parent_tool_call_id/
//    parent_description 戳记,model_delta/model_done 全量转发)
//   task_notification{data:{agent_id,agent_type,name,description,status,
//     message:"<task-notification>\n…\nResult:\n{全量结果}\n</task-notification>"}}
//   (父轮收尾 turn/stopped;子代理无终止事件转发,收尾信号只有通知)

/// async_launched 应答的 JSON(形状对表引擎 subagent.go asyncLaunchedResult)。
fn async_launched_json(agent_id: &str, name: &str, desc: &str) -> String {
    serde_json::to_string_pretty(&json!({
        "agentId": agent_id,
        "agentType": "plan",
        "description": desc,
        "name": name,
        "note": "The agent will notify you with a <task-notification> when it finishes.",
        "status": "async_launched",
    }))
    .unwrap()
}

fn notification_message(agent_id: &str, name: &str, desc: &str, status: &str, result: &str) -> String {
    format!(
        "<task-notification>\nBackground agent {agent_id} (name: {name}) [plan] finished with status: {status}\nTask: {desc}\nResult:\n{result}\n</task-notification>"
    )
}

fn journal_frames(inner: &Inner, sid: &str) -> Vec<Value> {
    inner.journal_barrier();
    std::fs::read_to_string(inner.data_dir.join(sid).join("events.jsonl"))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .collect()
}

/// 后台子代理已流式认领时:async_launched 不把原始 JSON
/// 灌卡、不关活着的子代理路由;turn/stopped 放过后台子会话(跨轮存活);
/// task_notification 以 Result 正文回填父卡终态 + 📌 系统行 + 子会话收尾;
/// 通知全文不再以 agent_text 混进模型正文气泡。
#[test]
fn backgrounded_subagent_survives_and_backfills() {
    let inner = bare_inner("bg");
    inner.transport.engine_caps.lock().unwrap().insert("structuredToolResult".into());
    inner.sess.sessions.lock().unwrap().insert("s1".into(), bare_session("s1"));
    let ev = |t: &str, tc: &str, data: Value| {
        json!({ "type": t, "session_id": "s1", "tool_call_id": tc, "data": data })
    };
    inner.handle_event(ev(
        "tool_call",
        "tc1",
        json!({ "name": "Agent", "input": { "description": "设计解耦接口方案", "prompt": "去设计", "name": "bd" } }),
    ));
    // 后台子代理流式事件(带戳记)→ 认领并投喂父卡
    inner.handle_event(json!({ "type": "model_delta", "session_id": "child1",
        "parent_session_id": "s1", "parent_tool_call_id": "tc1",
        "parent_description": "设计解耦接口方案", "data": { "text": "调查中…\n" } }));
    assert!(inner.sess.sessions.lock().unwrap().contains_key("child1"), "子代理未认领");
    // 显式后台:tool_result 回 async_launched JSON(无 content 字段)
    inner.handle_event(ev(
        "tool_result",
        "tc1",
        json!({ "tool": "Agent", "content": async_launched_json("a1", "bd", "设计解耦接口方案"), "is_error": false }),
    ));
    {
        let subs = inner.sub.subagents.lock().unwrap();
        let r = subs.get("child1").expect("async_launched 不得清掉活着的子代理路由");
        assert!(r.background, "路由未标记后台");
    }
    assert!(
        inner.sub.background_agents.lock().unwrap().contains_key("a1"),
        "后台代理未登记"
    );
    // 父轮收尾:后台子会话跨轮存活,不得按中断收尾
    inner.handle_notification("turn/stopped", json!({ "session_id": "s1", "stop_reason": "complete" }));
    assert!(
        inner.sub.subagents.lock().unwrap().contains_key("child1"),
        "turn/stopped 不得收掉后台子代理路由"
    );
    assert!(
        inner.sess.sessions.lock().unwrap().get("child1").map(|s| s.running).unwrap_or(false),
        "后台子会话应保持 running"
    );
    // 后台期间子代理继续流式 → 仍投喂父卡进度窗
    inner.handle_event(json!({ "type": "model_delta", "session_id": "child1",
        "parent_session_id": "s1", "parent_tool_call_id": "tc1",
        "parent_description": "设计解耦接口方案", "data": { "text": "结论已成\n" } }));
    // 完成通知:结果回填 + 收尾
    inner.handle_event(json!({ "type": "task_notification", "session_id": "s1", "data": {
        "agent_id": "a1", "agent_type": "plan", "name": "bd", "description": "设计解耦接口方案",
        "status": "completed",
        "message": notification_message("a1", "bd", "设计解耦接口方案", "completed", "最终结论正文"),
    }}));
    assert!(inner.sub.background_agents.lock().unwrap().is_empty(), "登记未消费");
    assert!(inner.sub.subagents.lock().unwrap().is_empty(), "通知后路由未清");

    let frames = journal_frames(&inner, "s1");
    let tc1_finals: Vec<Value> = frames
        .iter()
        .filter_map(acp_update)
        .filter(|u| {
            u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("tool_call_update")
                && u.get("toolCallId").and_then(|v| v.as_str()) == Some("tc1")
                && u.get("status").and_then(|v| v.as_str()) != Some("in_progress")
        })
        .collect();
    assert_eq!(tc1_finals.len(), 2, "应有两次终态帧(转后台文案 + 结果回填): {tc1_finals:?}");
    let first = tc1_finals[0].get("rawOutput").and_then(|v| v.as_str()).unwrap_or("");
    assert!(first.contains("已转入后台"), "async_launched 卡应是友好文案: {first}");
    assert!(!first.contains("async_launched"), "原始 JSON 不得灌卡: {first}");
    assert_eq!(tc1_finals[1].get("status").and_then(|v| v.as_str()), Some("completed"));
    assert_eq!(
        tc1_finals[1].get("rawOutput").and_then(|v| v.as_str()),
        Some("最终结论正文"),
        "Result 正文未回填父卡"
    );
    // 📌 系统行(task_notification 帧,独立渲染项)
    let note = frames
        .iter()
        .filter_map(acp_update)
        .find(|u| u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("task_notification"))
        .expect("缺 📌 系统行帧");
    let note_text = note.get("text").and_then(|v| v.as_str()).unwrap_or("");
    assert!(note_text.contains("bd") && note_text.contains("已完成"), "📌 文案不符: {note_text}");
    // 通知全文不得以 agent_text 混进模型正文气泡
    let leaked = frames.iter().filter_map(acp_update).any(|u| {
        u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("agent_message_chunk")
            && u["content"]["text"].as_str().map(|t| t.contains("Background agent")).unwrap_or(false)
    });
    assert!(!leaked, "通知全文混进了正文气泡");
    // 后台期间的流式行仍进父卡进度窗
    let fed = frames.iter().filter_map(acp_update).any(|u| {
        u.get("toolCallId").and_then(|v| v.as_str()) == Some("tc1")
            && u["progress"]["line"].as_str().map(|l| l.contains("结论已成")).unwrap_or(false)
    });
    assert!(fed, "后台期间的子代理进度未进父卡");
    // 子会话按 Finished 收尾
    let ctypes: Vec<String> = journal_frames(&inner, "child1")
        .iter()
        .filter_map(|f| f.get("type").and_then(|v| v.as_str()).map(String::from))
        .collect();
    assert!(ctypes.iter().any(|t| t == "task-ended"), "子会话未收尾: {ctypes:?}");
    assert_eq!(
        inner.read_sidecar("child1").get("status").and_then(|v| v.as_str()),
        Some("finished"),
        "子会话 sidecar 未落 finished"
    );
}

/// 后台代理失败(status=error)→ 父卡 failed 帧回填错误详情,📌 行报失败,
/// 子会话按 error 收尾。
#[test]
fn backgrounded_subagent_error_marks_card_failed() {
    let inner = bare_inner("bgerr");
    inner.transport.engine_caps.lock().unwrap().insert("structuredToolResult".into());
    inner.sess.sessions.lock().unwrap().insert("s1".into(), bare_session("s1"));
    let ev = |t: &str, tc: &str, data: Value| {
        json!({ "type": t, "session_id": "s1", "tool_call_id": tc, "data": data })
    };
    inner.handle_event(ev("tool_call", "tc1", json!({ "name": "Agent", "input": { "description": "d", "prompt": "p" } })));
    inner.handle_event(ev(
        "tool_result",
        "tc1",
        json!({ "tool": "Agent", "content": async_launched_json("a2", "", "d"), "is_error": false }),
    ));
    inner.handle_event(json!({ "type": "task_notification", "session_id": "s1", "data": {
        "agent_id": "a2", "name": "", "description": "d", "status": "error",
        "message": notification_message("a2", "", "d", "error", "provider 炸了"),
    }}));
    let frames = journal_frames(&inner, "s1");
    let failed = frames
        .iter()
        .filter_map(acp_update)
        .find(|u| {
            u.get("toolCallId").and_then(|v| v.as_str()) == Some("tc1")
                && u.get("status").and_then(|v| v.as_str()) == Some("failed")
        })
        .expect("缺 failed 回填帧");
    assert_eq!(failed.get("rawOutput").and_then(|v| v.as_str()), Some("provider 炸了"));
    let note = frames
        .iter()
        .filter_map(acp_update)
        .find(|u| u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("task_notification"))
        .expect("缺 📌 系统行帧");
    assert!(note.get("text").and_then(|v| v.as_str()).unwrap_or("").contains("执行失败"));
}

/// 反查不到登记(壳重启丢内存/SendMessage 续跑二次完成)的 task_notification:
/// 退回整段外显,但剥 <task-notification> 包装标签——markdown 会把标签行
/// 当 HTML 块吞掉后半段(用户实测症状:Result: 后面正文丢失)。
#[test]
fn task_notification_without_registry_falls_back_stripped() {
    let inner = bare_inner("bgfb");
    inner.sess.sessions.lock().unwrap().insert("s1".into(), bare_session("s1"));
    inner.handle_event(json!({ "type": "task_notification", "session_id": "s1", "data": {
        "agent_id": "unknown", "status": "completed",
        "message": notification_message("unknown", "x", "d", "completed", "正文内容"),
    }}));
    let frames = journal_frames(&inner, "s1");
    let text = frames
        .iter()
        .filter_map(acp_update)
        .filter(|u| u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("agent_message_chunk"))
        .filter_map(|u| u["content"]["text"].as_str().map(String::from))
        .next()
        .expect("缺兜底外显帧");
    assert!(text.contains("📌") && text.contains("正文内容"), "兜底外显不完整: {text}");
    assert!(!text.contains("<task-notification>"), "包装标签未剥: {text}");
}

/// E2E:当前引擎的 run_in_background 只收紧子代理工具集为只读，调用仍
/// 同步等待并直接回填结果；不得再按旧契约渲染 async_launched/完成通知。
#[tokio::test(flavor = "multi_thread")]
#[ignore = "需 MC_OHMYAGENT_BIN 钉住配套引擎;用 --include-ignored 显式跑"]
async fn e2e_readonly_subagent_stays_synchronous() {
    require_ohmyagent();
    let _g = e2e_lock().await;
    let steps = vec![
        // req0 父轮:只读 Agent;req1 子代理应答;
        // req2 父轮继续 Bash;req3 父轮收尾。
        sse_tool_use("tu_1", "Agent", &json!({
            "prompt": "深入调查并汇报", "description": "后台调查任务",
            "name": "bg-worker", "run_in_background": true
        })),
        sse_text("子代理最终结论:一切正常\n"),
        sse_tool_use("tu_2", "Bash", &json!({ "command": "echo ok" })),
        sse_text("父任务收尾完成"),
    ];
    let (driver, home) = e2e_setup_steps("bg", 2000, steps);
    let workdir = home.to_string_lossy().into_owned();
    let meta = driver.session_create(&workdir, "测试模型", false).await.expect("建会话");
    let sid = meta.get("id").and_then(|v| v.as_str()).unwrap().to_string();
    driver.session_open(&sid).await.expect("打开会话");
    driver.session_call(&sid, "session_set_mode", json!({ "mode": "yolo" })).await.expect("yolo");
    driver
        .session_send(&sid, "user-input", json!({ "content": frame::b64_text("派个子代理") }))
        .await
        .expect("发送");

    let journal = wait_journal(&driver, &sid, |j| {
        j.iter().any(|f| f.get("type").and_then(|v| v.as_str()) == Some("task-ended"))
    })
    .await;
    let tu1_finals: Vec<Value> = journal
        .iter()
        .filter_map(acp_update)
        .filter(|u| {
            u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("tool_call_update")
                && u.get("toolCallId").and_then(|v| v.as_str()) == Some("tu_1")
                && u.get("status").and_then(|v| v.as_str()) != Some("in_progress")
        })
        .collect();
    assert_eq!(tu1_finals.len(), 1, "同步 Agent 应只有一次终态帧: {journal:?}");
    assert_eq!(tu1_finals[0].get("status").and_then(|v| v.as_str()), Some("completed"));
    assert!(
        tu1_finals[0].get("rawOutput").and_then(|v| v.as_str()).unwrap_or("").contains("子代理最终结论"),
        "同步结果未回填父卡: {tu1_finals:?}"
    );
    let has_note = journal.iter().filter_map(acp_update).any(|u| {
        u.get("sessionUpdate").and_then(|v| v.as_str()) == Some("task_notification")
    });
    assert!(!has_note, "同步 Agent 不应产生后台完成通知: {journal:?}");
    assert!(driver.0.sub.background_agents.lock().unwrap().is_empty());
    driver.stop();
}

// ==================== 回放物化 / 尾部窗口 / 补录 ====================
//
// 折叠规则本身在 fold_tests.rs;这里守的是「壳把它接对了」:轮末物化、
// 打开只读窗口、老会话迁移、补录偏移不重不丢。

/// 空闲会话(running=false),补录/物化路径要求
fn idle_session(sid: &str) -> SessionState {
    let mut s = bare_session(sid);
    s.running = false;
    s
}

fn push_one_turn(inner: &Arc<Inner>, sid: &str, prompt: &str, chunks: usize) {
    inner.push_frame(sid, |seq| frame::user_input(prompt, seq));
    inner.push_frame(sid, frame::task_started);
    for _ in 0..chunks {
        inner.push_frame(sid, |seq| frame::agent_thought("字", seq));
    }
    inner.push_frame(sid, frame::task_ended);
}

/// user-input 帧的 content 是 base64(与云端上行同格式)
fn prompt_of(f: &Value) -> String {
    use base64::Engine as _;
    let b64 = f["data"]["content"].as_str().unwrap();
    String::from_utf8(base64::engine::general_purpose::STANDARD.decode(b64).unwrap()).unwrap()
}

fn replay_lines(inner: &Arc<Inner>, sid: &str) -> Vec<Value> {
    let path = inner.data_dir.join(sid).join("replay.jsonl");
    std::fs::read_to_string(path)
        .map(|t| t.lines().filter_map(|l| serde_json::from_str(l).ok()).collect())
        .unwrap_or_default()
}

#[test]
fn a_finished_turn_is_materialised_as_one_folded_line() {
    let inner = bare_inner("materialize");
    inner.sess.sessions.lock().unwrap().insert("s1".into(), idle_session("s1"));

    push_one_turn(&inner, "s1", "问题", 300);
    inner.journal_barrier();

    let turns = replay_lines(&inner, "s1");
    assert_eq!(turns.len(), 1, "一轮一行");
    let frames = turns[0]["frames"].as_array().unwrap();
    // user-input + task-started + 300 碎片折成 1 帧 + task-ended
    assert_eq!(frames.len(), 4, "折叠后应只剩 4 帧: {frames:?}");
    assert_eq!(
        frames[2]["data"]["update"]["content"]["text"].as_str().unwrap().chars().count(),
        300
    );
    // src_end 必须精确落在这一轮最后一帧写完的位置
    let events = std::fs::metadata(inner.data_dir.join("s1").join("events.jsonl")).unwrap().len();
    assert_eq!(turns[0]["src_end"].as_u64(), Some(events));
    assert_eq!(turns[0]["to"].as_u64(), Some(303));
}

#[test]
fn reopening_reads_the_folded_window_not_the_raw_journal() {
    let inner = bare_inner("window");
    inner.sess.sessions.lock().unwrap().insert("s1".into(), idle_session("s1"));
    push_one_turn(&inner, "s1", "问题", 500);
    inner.journal_barrier();

    let w = inner.replay_open("s1");

    assert_eq!(w.frames.len(), 4, "打开拿到的是折叠帧,不是 503 帧原始流");
    assert!(!w.has_more);
    // 已物化的历史不会被再算一遍:补录不产生第二行
    assert_eq!(replay_lines(&inner, "s1").len(), 1);
}

#[test]
fn an_unmaterialised_legacy_journal_is_migrated_on_first_open_and_only_once() {
    let inner = bare_inner("migrate");
    let dir = inner.data_dir.join("s1");
    std::fs::create_dir_all(&dir).unwrap();
    // 老会话:只有 events.jsonl(两轮),没有 replay.jsonl
    let mut seq = 0u64;
    let mut lines = String::new();
    for turn in 0..2 {
        for f in [
            frame::user_input(&format!("第 {turn} 问"), { seq += 1; seq }),
            frame::task_started({ seq += 1; seq }),
        ] {
            lines.push_str(&f.to_string());
            lines.push('\n');
        }
        for _ in 0..200 {
            lines.push_str(&frame::agent_thought("字", { seq += 1; seq }).to_string());
            lines.push('\n');
        }
        lines.push_str(&frame::task_ended({ seq += 1; seq }).to_string());
        lines.push('\n');
    }
    std::fs::write(dir.join("events.jsonl"), &lines).unwrap();
    inner.sess.sessions.lock().unwrap().insert("s1".into(), idle_session("s1"));

    let first = inner.replay_open("s1");
    inner.journal_barrier();

    assert_eq!(replay_lines(&inner, "s1").len(), 2, "两轮各物化一行");
    assert_eq!(first.frames.len(), 8, "窗口是折叠后的两轮");
    // seq 水位跟上历史,新帧不会与旧行撞号
    assert_eq!(inner.sess.sessions.lock().unwrap()["s1"].seq, seq);

    // 第二次打开:不重复物化、内容一致(补录偏移写对了才可能)
    let second = inner.replay_open("s1");
    inner.journal_barrier();
    assert_eq!(replay_lines(&inner, "s1").len(), 2, "补录必须幂等");
    assert_eq!(second.frames, first.frames);
}

#[test]
fn the_open_window_keeps_only_the_newest_turns_and_pages_back_from_the_cursor() {
    let inner = bare_inner("paging");
    inner.sess.sessions.lock().unwrap().insert("s1".into(), idle_session("s1"));
    for i in 0..(crate::driver::fold::TAIL_TURNS + 5) {
        push_one_turn(&inner, "s1", &format!("第 {i} 问"), 3);
    }
    inner.journal_barrier();

    let w = inner.replay_open("s1");

    let turns = replay_lines(&inner, "s1");
    assert_eq!(turns.len(), crate::driver::fold::TAIL_TURNS + 5);
    assert_eq!(w.frames.len(), crate::driver::fold::TAIL_TURNS * 4, "只回最近 TAIL_TURNS 轮");
    assert!(w.has_more, "前面还有 5 轮");
    assert!(w.cursor > 0);
    // 窗口第一帧是第 5 问(0..24 共 25 轮,尾 20 轮从第 5 轮起)
    assert_eq!(prompt_of(&w.frames[0]), "第 5 问");

    // 往前翻一轮
    let (older, has_more) = crate::driver::fold::read_before(
        &inner.data_dir.join("s1").join("replay.jsonl"),
        w.cursor,
        1,
    );
    assert_eq!(older.len(), 1);
    assert!(has_more);
    assert_eq!(prompt_of(&older[0].frames[0]), "第 4 问");
}

#[test]
fn a_turn_still_running_stays_raw_and_is_not_materialised_early() {
    let inner = bare_inner("openturn");
    inner.sess.sessions.lock().unwrap().insert("s1".into(), idle_session("s1"));
    push_one_turn(&inner, "s1", "已完成", 5);
    // 未闭合轮:没有 task-ended
    inner.push_frame("s1", |seq| frame::user_input("进行中", seq));
    inner.push_frame("s1", frame::task_started);
    inner.push_frame("s1", |seq| frame::agent_thought("正在想", seq));
    inner.journal_barrier();

    assert_eq!(replay_lines(&inner, "s1").len(), 1, "只物化已闭合的那一轮");

    // 打开:窗口 = 已物化的一轮 + 未物化尾巴(折叠后),按 seq 连续
    if let Some(s) = inner.sess.sessions.lock().unwrap().get_mut("s1") {
        s.running = true; // 运行中:补录必须让路
    }
    let w = inner.replay_open("s1");
    let seqs: Vec<u64> =
        w.frames.iter().filter_map(|f| f.get("seq").and_then(|v| v.as_u64())).collect();
    // 已物化轮折成 user-input(1) + started(2) + 正文(3) + ended(8),
    // 后接未物化尾巴 9/10/11——折叠帧取首帧 seq,两段无缝衔接
    assert_eq!(seqs, vec![1, 2, 3, 8, 9, 10, 11]);
}

// ==================== 引擎生命周期(契约 6)====================

/// 进程被硬杀留下的未闭合轮次,必须在冷启动打开会话时补上终态帧。
/// 不补的话 UI 的 running 只由帧推导,会永久按"执行中"渲染:输入只排队、
/// 删除/切模型全灰,取消打到壳里也因内存 running=false 而空转。
#[test]
fn a_journal_killed_mid_turn_is_repaired_on_cold_open() {
    let inner = bare_inner("coldrepair");
    // 直接写日志文件而不经 push_frame:硬杀留下的现场就是这样——文件里有
    // 半截轮次,而**新进程**的会话表是全新的(fold 空、running=false)。
    // 用 push_frame 造场景等于留着上个进程的内存态,测不到冷启动这条路。
    let dir = inner.data_dir.join("s1");
    std::fs::create_dir_all(&dir).unwrap();
    let mut seq = 0u64;
    let mut lines = String::new();
    for f in [
        frame::user_input("被打断的一轮", { seq += 1; seq }),
        frame::task_started({ seq += 1; seq }),
        frame::agent_thought("想到一半", { seq += 1; seq }),
    ] {
        lines.push_str(&f.to_string());
        lines.push('\n');
    }
    std::fs::write(dir.join("events.jsonl"), &lines).unwrap();
    inner.sess.sessions.lock().unwrap().insert("s1".into(), idle_session("s1"));

    let w = inner.replay_open("s1");
    let types: Vec<&str> =
        w.frames.iter().filter_map(|f| f["type"].as_str()).collect();
    assert_eq!(
        types.last().copied(),
        Some("task-ended"),
        "窗口必须以终态帧收口,否则 UI 永远转圈: {types:?}"
    );
    assert!(types.contains(&"task-error"), "补的收尾要说明原因: {types:?}");
    // seq 必须接在最后一帧之后,不能与历史撞号
    let seqs: Vec<u64> =
        w.frames.iter().filter_map(|f| f.get("seq").and_then(|v| v.as_u64())).collect();
    assert!(seqs.windows(2).all(|p| p[0] < p[1]), "seq 必须严格递增: {seqs:?}");

    // 落盘同样收口:第二次打开不再重复补(已闭合就不满足补的条件)
    inner.journal_barrier();
    let again = inner.replay_open("s1");
    let ends = |fs: &[Value]| fs.iter().filter(|f| f["type"] == "task-ended").count();
    assert_eq!(ends(&again.frames), ends(&w.frames), "重开不得重复补帧");
    assert_eq!(
        inner.read_sidecar("s1")["status"].as_str(),
        Some("interrupted"),
        "sidecar 要与帧一起落终态,否则侧栏与聊天区继续各说各话"
    );
}

/// 运行中的会话不能被冷修复碰:那是活的轮次,补终态帧等于凭空打断任务。
#[test]
fn a_live_running_turn_is_never_cold_repaired() {
    let inner = bare_inner("liverepair");
    inner.sess.sessions.lock().unwrap().insert("s1".into(), idle_session("s1"));
    inner.push_frame("s1", |seq| frame::user_input("进行中", seq));
    inner.push_frame("s1", frame::task_started);
    if let Some(s) = inner.sess.sessions.lock().unwrap().get_mut("s1") {
        s.running = true;
    }
    inner.journal_barrier();

    let w = inner.replay_open("s1");
    let types: Vec<&str> = w.frames.iter().filter_map(|f| f["type"].as_str()).collect();
    assert!(!types.contains(&"task-ended"), "运行中会话不该被补收尾: {types:?}");
}

/// cancel 看门狗的认轮守卫:到期时若已开了新的一轮,不得误杀。
#[test]
fn the_cancel_watchdog_only_reconciles_its_own_turn() {
    let inner = bare_inner("watchdog");
    {
        let mut sessions = inner.sess.sessions.lock().unwrap();
        let mut s = idle_session("s1");
        s.running = true;
        s.turn = 7;
        sessions.insert("s1".into(), s);
    }
    let matches = |turn: u64| {
        inner
            .sess
            .sessions
            .lock()
            .unwrap()
            .get("s1")
            .map(|s| s.running && s.turn == turn)
            .unwrap_or(false)
    };
    assert!(matches(7), "同一轮仍在跑:该和解");
    assert!(!matches(6), "上一轮的看门狗不得动到当前轮");

    // 轮次收尾后即使 turn 相同也不再和解(running 已落)
    inner.sess.sessions.lock().unwrap().get_mut("s1").unwrap().running = false;
    assert!(!matches(7));
}

/// 路径穿越回归:`session_delete` 的终点是 `remove_dir_all(<data_dir>/<id>)`,
/// 而 id 是 IPC 入参。未加守卫时 `data_dir.join("../../..")` 会被
/// remove_dir_all 一路解析上去,实测能清空 data_dir 上游几层的全部内容。
///
/// **断言顺序是刻意的**:先钉住路径构造器拒绝(它是所有文件系统操作的唯一
/// 入口),再去调命令。守卫若回归,构造器那条 assert 先炸,后面的
/// session_delete 根本不会带着一个可逃逸的 id 跑起来——这条测试因此不会
/// 反过来把开发机的临时目录删了。
#[tokio::test]
async fn session_commands_refuse_ids_that_escape_the_session_root() {
    let inner = bare_inner("path-traversal");
    let driver = OhmyDriver(inner.clone());

    for evil in ["..", "../..", "../../..", "a/../..", "/etc", "foo/bar", "x\\y", ".", ""] {
        assert!(inner.session_dir(evil).is_none(), "sidecar 目录构造放行了 {evil:?}");
        assert!(inner.engine_session_dir(evil).is_none(), "引擎目录构造放行了 {evil:?}");

        let err = driver
            .session_delete(evil)
            .await
            .expect_err("删除必须对逃逸 id 直接失败,它的终点是 remove_dir_all");
        assert!(err.contains("非法会话 id"), "{evil:?} 的错误文案不对: {err}");
        assert!(driver.session_open(evil).await.is_err(), "打开也不该放行 {evil:?}");
        assert!(driver.session_frame(evil, 1).await.is_err(), "回读也不该放行 {evil:?}");
        assert!(
            driver.session_patch(evil, json!({ "title": "x" })).await.is_err(),
            "sidecar 写也不该放行 {evil:?}",
        );
    }

    // 正常 id(引擎发的是 uuid.NewString()[:8])一个都不能被挡,
    // 且构造出的路径必须仍在会话根之内
    let dir = inner.session_dir("1f2e3d4c").expect("正常 id 被误挡");
    assert!(dir.starts_with(&inner.data_dir));
    let _ = std::fs::remove_dir_all(inner.data_dir.parent().unwrap());
}

/// journal 写线程在文件系统边界上自判会话 id(见 spawn_journal_writer)。
/// 这条钉两件事:
/// 1. 非法 id 的 Append/Materialize 被丢弃,不在会话根之外建目录/写文件;
/// 2. 合法 id 照常落盘,过滤没有误伤;
/// 3. 屏障/Close 的 ack 路径仍走得通。
///
/// 关于第 3 点要说清楚:把 Sync/Close 也纳入过滤**不会**挂死——ack 的 Sender
/// 随消息一起落栈,调用方的 rx.recv() 立刻拿到 Err(实测 62µs)。所以这条
/// 测试抓不住那种回归,真正的后果是屏障返回却不再保证已落盘,得靠
/// replay_window_no_frame_loss 那类端到端断言去守。此处只钉住边界过滤本身。
#[test]
fn journal_writer_drops_escaping_ids_without_stalling_the_barrier() {
    let inner = bare_inner("journal-guard");
    let outside = inner.data_dir.parent().unwrap().join("escaped");

    for evil in ["../escaped", "..", "a/b"] {
        let _ = inner.transport.journal_tx.send(JournalMsg::Append {
            sid: evil.to_string(),
            line: "{\"type\":\"task-started\"}".into(),
        });
    }
    // 合法 id 照常落盘,证明过滤没有误伤
    let _ = inner.transport.journal_tx.send(JournalMsg::Append {
        sid: "1f2e3d4c".into(),
        line: "{\"type\":\"task-started\"}".into(),
    });

    // 屏障必须返回(挂住就是这里回归了);它同时保证上面的投递已被处理完
    inner.journal_barrier();
    // 带 ack 的 Close 同理
    inner.journal_close("1f2e3d4c", true);

    assert!(!outside.exists(), "非法 id 在会话根之外建了目录: {}", outside.display());
    assert!(
        inner.data_dir.join("1f2e3d4c/events.jsonl").is_file(),
        "合法 id 的帧日志被误伤",
    );
    let _ = std::fs::remove_dir_all(inner.data_dir.parent().unwrap());
}

/// 清单解析对 model/locked/owner 字段必须容缺(unwrap_or 而非 ?):旧条目
/// 没有这些字段,用 ? 会让整条从 models_list 消失;locked 缺省 false =
/// 旧数据照常可选。正常条目原样透传,UI 靠 model 判会员档位(name 可能是
/// remark 别名)、靠 locked/owner 做灰态与分节。
#[test]
fn parse_manifest_models_tolerates_missing_model_field() {
    let models = parse_manifest_models(&json!([
        { "name": "旧手编条目", "provider": "anthropic" },
        { "name": "会员别名", "source": "monkeycode", "model": "monkeycode-pro/deepseek-pro",
          "locked": true, "owner": "public" },
    ]));
    assert_eq!(models.len(), 2, "缺 model 的条目不能被丢弃");
    assert_eq!(models[0].model, "");
    assert!(!models[0].locked, "缺 locked 的旧条目必须照常可选");
    assert_eq!(models[0].owner, "");
    assert_eq!(models[1].model, "monkeycode-pro/deepseek-pro");
    assert_eq!(models[1].source, "monkeycode");
    assert!(models[1].locked);
    assert_eq!(models[1].owner, "public");
}
