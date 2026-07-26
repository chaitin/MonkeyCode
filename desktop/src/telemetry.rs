// 装机与使用统计:向自建 Matomo 发一条极小的心跳。
//
// 只回答两个问题:每天新增多少台装机、装了之后有没有真的用起来。
// 载荷固定四项——设备标识、版本、系统、用没用——不含路径、仓库名、会话
// 内容或账号信息。上报由壳发起而非 UI(契约:UI 不建立任何网络连接),
// 顺带也就不受 webview CSP 约束。
//
// 不上报的两种情形:端点未配置(只有 release 工作流注入,克隆本仓库自行编译
// 即此状态),或 config.json 里 telemetry_enabled=false(给客户合规问卷留的
// 出口,刻意不做 UI——装机计数不含可关联到人的信息,不需要征求同意)。
// 任一成立则整个模块空转,连线程都不起。
//
// 为什么必须有一个持久的设备标识:没有它,"今天新装 100 台"和"老用户开了
// 100 次"在数据上完全一样。这是这类统计绕不过去的前提,不是可选的增强。
// 但它只需要"同一次安装内稳定"——重装/删配置目录算一台新机器,而这正是
// "装机数"该有的口径。因此用随机数,不用机器指纹:指纹跨重装可追踪(我们
// 不需要的能力)、在 Windows 上还不可靠(虚拟网卡一变就变)。

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::config::{atomic_write_private, config_dir, load_config, ms_to_rfc3339};
use crate::util::{urlencode, LockExt};

/// 状态文件(app_config_dir 下)。与权威 config.json 分开:它不是用户偏好,
/// 只是上报游标,不该挤进配置的备份/损坏恢复事务。
const STATE_FILE: &str = "telemetry.json";

/// 醒来判日的间隔。用 6h 而不是 24h:24h 定时器只在跨过整点时才对齐,常驻
/// 实例(mac 上开一周不关)的上报时刻会随启动时间漂移,漏掉整天;6h 让日切
/// 最多 6 小时内被发现,而按天去重保证一天仍然只成功发一条。
const TICK: Duration = Duration::from_secs(6 * 3600);

/// 启动后首次判日的延迟,让位给窗口创建与引擎拉起。
const FIRST_DELAY: Duration = Duration::from_secs(8);

const TIMEOUT: Duration = Duration::from_secs(10);

/// Matomo 要求 `url` 参数存在。桌面端没有真实页面地址,给一个固定的合成值,
/// 让报表里所有心跳归到同一条"页面"下。
const SYNTHETIC_URL: &str = "https://desktop.monkeycode/launch";

// ==================== 状态 ====================

#[derive(Default, Serialize, Deserialize)]
struct State {
    /// 16 位小写十六进制的设备标识。Matomo 的 `_id` **只接受这个形状**:
    /// 给错格式它不会报错,而是退回按 IP+UA 另猜一个访客——于是每次上报都
    /// 算成新装机,而看板上完全看不出异常。valid_install_id 是这条契约的
    /// 唯一守卫。
    #[serde(default)]
    install_id: String,
    /// 这台机器**至今**有没有真的跑过一轮会话。答"装了到底用没用"(激活率)。
    #[serde(default)]
    used: bool,
    /// 最近一次开对话所属的 UTC 日期。答"今天在不在干活"——`used` 一旦为真
    /// 就永远为真,单靠它分不出"天天在用"和"半年前用过一次"。
    #[serde(default)]
    last_used_day: String,
    /// 最近一次**成功**上报所属的 UTC 日期(YYYY-MM-DD),按天去重用。
    #[serde(default)]
    last_day: String,
}

/// 上报时刻的环境事实。单独成结构体而不是一串参数:tracking_url 因此能在
/// 测试里完全脱离 AppHandle 与真实时钟,而不必列七个位置参数。
struct Facts {
    version: String,
    platform: String,
    nonce: String,
    today: String,
}

/// 上报端点。运行时环境变量优先(本机联调),其次编译期注入(CI 出包时给)。
/// 两者都没有就是 None —— 默认不上报,克隆本仓库自己编译的人不会在毫不知情
/// 的情况下把数据发到我们的服务器。
struct Endpoint {
    /// 形如 https://matomo.example.com/matomo.php
    url: String,
    site_id: String,
}

fn env_or_compiled(key: &str, compiled: Option<&str>) -> Option<String> {
    std::env::var(key)
        .ok()
        .or_else(|| compiled.map(str::to_string))
        .map(|v| v.trim().trim_end_matches('/').to_string())
        .filter(|v| !v.is_empty())
}

fn endpoint() -> Option<Endpoint> {
    Some(Endpoint {
        url: env_or_compiled("MC_MATOMO_URL", option_env!("MC_MATOMO_URL"))?,
        site_id: env_or_compiled("MC_MATOMO_SITE_ID", option_env!("MC_MATOMO_SITE_ID"))
            .unwrap_or_else(|| "1".to_string()),
    })
}

/// 合规出口(config.json,无 UI)。读不出配置时按**关闭**处理:统计是可有可无
/// 的,而"配置异常时仍然照发"是不能接受的默认。
fn enabled(app: &AppHandle) -> bool {
    load_config(app).map(|c| c.telemetry_enabled).unwrap_or(false)
}

// ==================== 对外入口 ====================

/// 起后台心跳。端点未配置时直接不起线程。
pub fn start(app: &AppHandle) {
    if endpoint().is_none() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_DELAY).await;
        loop {
            tick(&app).await;
            tokio::time::sleep(TICK).await;
        }
    });
}

/// 每天第一次开对话时调用:标记"今天在干活"。
///
/// 由命令层调用而非 driver 内部——driver 只做协议翻译,埋点属于策略。
/// 一天只落一次盘,当天后续消息走进程内快速路径,不给每轮对话加 I/O。
///
/// 动作名分两种,因为这是两个不同的问题:`first-use` 是这台机器**有史以来**
/// 第一次用(激活时点,一辈子一条),`daily-use` 是之后每天的第一次。混用一个
/// 名字就再也算不出激活曲线。
pub fn mark_used(app: &AppHandle) {
    // 记"已标记到哪天"而不是一个 bool:跨天要自动放行。
    // Mutex::new 是 const fn(1.63+),不能用 LazyLock——win7 通道锁在 1.77。
    static MARKED_DAY: Mutex<Option<String>> = Mutex::new(None);
    let today = utc_day();
    {
        // 先占位再干活:失败也认作今天已处理。宁可今天这台机器不算"在干活",
        // 也不要让每一条用户消息都去读写磁盘、重试网络。
        let mut marked = MARKED_DAY.lock_ok();
        if marked.as_deref() == Some(today.as_str()) {
            return;
        }
        *marked = Some(today.clone());
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some((ep, path, version)) = context(&app) else { return };
        let mut st = match load_state(&path) {
            Ok(st) => st,
            Err(e) => return eprintln!("[desktop] 统计: 读状态失败 {e}"),
        };
        // 本进程之前那次运行今天可能已经标记过(进程内缓存只覆盖本次运行)
        let Some(action) = advance_used(&mut st, &today) else { return };
        // used/last_used_day 是状态不是游标:先落盘,发送成不成功都不影响
        // 它们已经为真。
        if let Err(e) = save_state(&path, &st) {
            return eprintln!("[desktop] 统计: 写状态失败 {e}");
        }
        report(&path, &ep, &mut st, action, &version).await;
    });
}

/// 今天首次开对话时推进状态,返回该用的动作名;今天已标记过则返回 None。
///
/// 两个动作名对应两个不同的问题:`first-use` 是这台机器**有史以来**第一次用
/// (激活时点,一辈子一条),`daily-use` 是之后每天的第一次。合成一个名字就
/// 再也算不出激活曲线——`first-use` 的日分布会被日常活跃淹掉。
fn advance_used(st: &mut State, today: &str) -> Option<&'static str> {
    if st.last_used_day == today {
        return None;
    }
    let action = if st.used { "daily-use" } else { "first-use" };
    st.used = true;
    st.last_used_day = today.to_string();
    Some(action)
}

// ==================== 内部 ====================

/// 三道闸门(合规出口、端点配置、配置目录可用)与两项环境事实一次取齐。
/// 每次醒来都重取:改了 config.json 之后下一次醒来即生效,不必重启应用。
fn context(app: &AppHandle) -> Option<(Endpoint, std::path::PathBuf, String)> {
    if !enabled(app) {
        return None;
    }
    let ep = endpoint()?;
    let path = config_dir(app).ok()?.join(STATE_FILE);
    let version = crate::display_version(&app.package_info().version.to_string());
    Some((ep, path, version))
}

async fn tick(app: &AppHandle) {
    let Some((ep, path, version)) = context(app) else { return };
    let mut st = match load_state(&path) {
        Ok(st) => st,
        Err(e) => return eprintln!("[desktop] 统计: 读状态失败 {e}"),
    };
    if st.last_day == utc_day() {
        return;
    }
    // 先定动作名再交出可变借用(launch_action 读的正是 report 会改的游标)
    let action = launch_action(&st);
    report(&path, &ep, &mut st, action, &version).await;
}

/// 启动槽位的动作名:第一次是装机,之后是当天首次启动。
///
/// 判据是"`last_day` 为空 = 这台设备从没成功上报过任何东西 = 我们第一次见到
/// 它"。用游标而不是另加一个 `install_reported` 字段:游标只在**成功**时推进,
/// 所以首次上报失败(开机自启时网络常常还没就绪)后的重试仍然算装机,不会
/// 静默退化成 daily-launch 把装机记录永久丢掉。
///
/// 装机不单独再发一条请求:新设备的第一条启动记录本身就是装机记录。同一
/// 槽位换个名字,"每台设备每天最多一条启动记录"这条不变量因此保持成立。
fn launch_action(st: &State) -> &'static str {
    if st.last_day.is_empty() {
        "install"
    } else {
        "daily-launch"
    }
}

/// 发送并在**成功后**推进游标。返回是否发成功(供测试断言)。
///
/// 顺序很关键:先写游标再发送会系统性地丢数据——应用随开机自启时,
/// launch+8s 常常早于网络就绪,那一天就永久没有了。成功才推进,失败留给
/// 6 小时后的下一次醒来重试,一天最多四次尝试,不构成重试风暴。
async fn report(path: &Path, ep: &Endpoint, st: &mut State, action: &str, version: &str) -> bool {
    let facts = Facts {
        version: version.to_string(),
        platform: platform(),
        nonce: nonce(),
        today: utc_day(),
    };
    let url = tracking_url(ep, st, action, &facts);
    match send(&url).await {
        Ok(()) => {
            st.last_day = facts.today;
            if let Err(e) = save_state(path, st) {
                eprintln!("[desktop] 统计: 写状态失败 {e}");
            }
            true
        }
        // 统计失败对用户毫无意义,只留日志,不弹任何提示。
        Err(e) => {
            eprintln!("[desktop] 统计: 上报失败(稍后重试) {e}");
            false
        }
    }
}

async fn send(url: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| format!("构建 HTTP 客户端失败: {e}"))?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("HTTP {}", resp.status()))
    }
}

/// Matomo Tracking HTTP API 的完整请求地址。
///
/// 纯函数,单测直接盯住两处静默失败点:`_id` 的形状,以及自定义维度的编号
/// (dimension1..4 必须先在 Matomo 后台建好,否则参数被丢弃且不报错)。
fn tracking_url(ep: &Endpoint, st: &State, action: &str, facts: &Facts) -> String {
    let params: [(&str, &str); 12] = [
        ("idsite", &ep.site_id),
        ("rec", "1"),
        ("apiv", "1"),
        // 回 204 而不是一张 1x1 GIF
        ("send_image", "0"),
        // 防中间代理缓存这条 GET
        ("rand", &facts.nonce),
        ("_id", &st.install_id),
        ("url", SYNTHETIC_URL),
        ("action_name", action),
        ("dimension1", &facts.version),
        ("dimension2", &facts.platform),
        // 曾经用过(激活率) vs 今天在干活(日活里的真实使用率)。两个都要:
        // used 一旦为真就永远为真,单靠它分不出天天在用和半年前用过一次。
        ("dimension3", if st.used { "true" } else { "false" }),
        (
            "dimension4",
            if st.last_used_day == facts.today { "true" } else { "false" },
        ),
    ];
    let query = params
        .iter()
        .map(|(k, v)| format!("{k}={}", urlencode(v)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{}?{query}", ep.url)
}

fn platform() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// 去重用的 UTC 日期键。用 UTC 而不是本地时区:同一台机器改时区不会凭空
/// 多出/少掉一天。看板上"哪一天"仍以 Matomo 收到的时间为准,客户端这个键
/// 只负责"今天发过没有"。
fn utc_day() -> String {
    ms_to_rfc3339(now_ms())[..10].to_string()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn nonce() -> String {
    let mut raw = [0u8; 4];
    if getrandom::getrandom(&mut raw).is_err() {
        // 熵源不可用只影响防缓存,退回时间戳即可,不该让上报失败。
        return now_ms().to_string();
    }
    hex(&raw)
}

fn new_install_id() -> Result<String, String> {
    let mut raw = [0u8; 8]; // 8 字节 → 恰好 16 位十六进制
    getrandom::getrandom(&mut raw).map_err(|e| format!("系统随机源不可用: {e}"))?;
    Ok(hex(&raw))
}

fn valid_install_id(id: &str) -> bool {
    id.len() == 16 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// 读状态;缺失或损坏都重新生成设备标识并**立刻落盘**——这一步不能省:
/// 设备标识只有跨进程稳定才有意义,只在内存里生成等于每次启动都是新装机。
///
/// 与 config.json 的严格策略(损坏必须外显、绝不静默退默认)刻意不同:那里
/// 静默退默认会覆盖用户的模型和 API Key,这里最坏的后果只是一台机器被重新
/// 计为新装机。为一个统计文件把用户挡在应用外面是不成比例的。
fn load_state(path: &Path) -> Result<State, String> {
    let mut st: State = match std::fs::read(path) {
        Ok(data) => serde_json::from_slice(&data).unwrap_or_default(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => State::default(),
        Err(e) => return Err(format!("读取 {} 失败: {e}", path.display())),
    };
    if !valid_install_id(&st.install_id) {
        st.install_id = new_install_id()?;
        save_state(path, &st)?;
    }
    Ok(st)
}

fn save_state(path: &Path, st: &State) -> Result<(), String> {
    let data = serde_json::to_vec_pretty(st).map_err(|e| format!("序列化统计状态失败: {e}"))?;
    atomic_write_private(path, &data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ep() -> Endpoint {
        Endpoint {
            url: "https://matomo.example.com/matomo.php".into(),
            site_id: "3".into(),
        }
    }

    const TODAY: &str = "2026-07-26";

    fn facts(platform: &str) -> Facts {
        Facts {
            version: "26071401".into(),
            platform: platform.into(),
            nonce: "beef".into(),
            today: TODAY.into(),
        }
    }

    /// used = 曾经用过;used_today = 今天开过对话(last_used_day 落在今天)。
    fn state(used: bool, used_today: bool) -> State {
        State {
            install_id: "a3f19c02b84e7d61".into(),
            used,
            last_used_day: if used_today { TODAY.into() } else { "2026-01-01".into() },
            last_day: String::new(),
        }
    }

    /// `_id` 必须原样落进查询串且保持 16 位十六进制。传错形状 Matomo 会静默
    /// 改用 IP+UA 猜访客,每次上报都算新装机——而看板上看不出任何异常,
    /// 所以只能靠这里守。
    #[test]
    fn tracking_url_carries_a_well_formed_visitor_id() {
        let st = state(true, true);
        let url = tracking_url(&ep(), &st, "daily-launch", &facts("windows-x86_64"));

        assert!(valid_install_id(&st.install_id));
        assert!(url.starts_with("https://matomo.example.com/matomo.php?"), "{url}");
        assert!(url.contains("&_id=a3f19c02b84e7d61"), "{url}");
        assert!(url.contains("idsite=3"), "{url}");
        assert!(url.contains("&rec=1"), "{url}");
    }

    /// 四个自定义维度的编号是与 Matomo 后台配置的约定。改了编号等于把数据
    /// 写进别的维度(或被丢弃),同样不报错。
    #[test]
    fn tracking_url_pins_custom_dimension_slots() {
        let url = tracking_url(&ep(), &state(true, true), "daily-launch", &facts("linux-x86_64"));

        assert!(url.contains("&dimension1=26071401"), "版本 → dimension1: {url}");
        assert!(url.contains("&dimension2=linux-x86_64"), "系统 → dimension2: {url}");
        assert!(url.contains("&dimension3=true"), "曾经用过 → dimension3: {url}");
        assert!(url.contains("&dimension4=true"), "今天用过 → dimension4: {url}");
    }

    /// "装了但没用过"是这套统计的核心问题,false 必须如实上报,不能因为
    /// 默认值/序列化把它抹平成 true。
    #[test]
    fn unused_install_reports_false() {
        let st = state(false, false);
        let url = tracking_url(&ep(), &st, "daily-launch", &facts("macos-aarch64"));
        assert!(url.contains("&dimension3=false"), "{url}");
        assert!(url.contains("&dimension4=false"), "{url}");
    }

    /// 关键区分:一台"半年前用过一次、之后天天只是开着"的机器,dimension3 恒为
    /// true 而 dimension4 必须是 false。两个维度混成一个就再也算不出日活里的
    /// 真实使用率——这正是加 dimension4 的全部理由。
    #[test]
    fn long_dormant_install_is_ever_used_but_not_used_today() {
        let url = tracking_url(&ep(), &state(true, false), "daily-launch", &facts("linux-x86_64"));
        assert!(url.contains("&dimension3=true"), "曾经用过: {url}");
        assert!(url.contains("&dimension4=false"), "但今天没干活: {url}");
    }

    /// 合成 URL 与动作名必须转义后进查询串,否则 `://` 会截断后面的参数。
    #[test]
    fn tracking_url_percent_encodes_values() {
        let url = tracking_url(&ep(), &state(true, true), "first-use", &facts("windows-x86_64"));
        assert!(url.contains("url=https%3A%2F%2Fdesktop.monkeycode%2Flaunch"), "{url}");
        assert!(url.contains("&action_name=first-use"), "{url}");
        // 查询串里只应有一个 '?';值里的保留字符都被编码掉了
        assert_eq!(url.matches('?').count(), 1, "{url}");
    }

    #[test]
    fn generated_install_id_is_sixteen_lowercase_hex() {
        let id = new_install_id().unwrap();
        assert!(valid_install_id(&id), "{id}");
        // 两次生成不应相同(8 字节随机,碰撞概率可忽略)
        assert_ne!(id, new_install_id().unwrap());
    }

    #[test]
    fn install_id_validation_rejects_wrong_shapes() {
        assert!(!valid_install_id(""));
        assert!(!valid_install_id("a3f19c02b84e7d6"), "15 位应拒绝");
        assert!(!valid_install_id("a3f19c02b84e7d611"), "17 位应拒绝");
        assert!(!valid_install_id("A3F19C02B84E7D61"), "大写应拒绝(Matomo 要小写)");
        assert!(!valid_install_id("a3f19c02-b84e-7d6"), "UUID 带横线应拒绝");
        assert!(valid_install_id("0123456789abcdef"));
    }

    /// 启动槽位:第一次见到这台设备是装机,之后是当天首次启动。
    #[test]
    fn first_launch_ever_is_an_install_and_later_days_are_routine() {
        let mut st = State::default();
        assert_eq!(launch_action(&st), "install");

        st.last_day = "2026-07-26".into(); // 一次成功上报之后
        assert_eq!(launch_action(&st), "daily-launch");
    }

    /// 首次上报失败(开机自启时网络常常还没就绪)后的重试**仍然算装机**。
    /// 若判据取"刚生成了 install_id",重试时 id 已在盘上,就会退化成
    /// daily-launch,这台机器永远不会出现在装机数里。
    #[test]
    fn install_survives_a_failed_first_report() {
        // 标识已落盘,但一次都没报成功
        let mut st = State {
            install_id: "0123456789abcdef".into(),
            ..Default::default()
        };
        assert_eq!(launch_action(&st), "install", "重试仍应算装机");

        // 只有成功过(游标推进)才不再算装机
        st.last_day = "2026-07-26".into();
        assert_eq!(launch_action(&st), "daily-launch");
    }

    /// 一台机器一生的用量序列:第一次是激活(first-use,只此一条),当天再发
    /// 消息不重复上报,隔天变成日常活跃(daily-use)。
    #[test]
    fn first_conversation_ever_is_activation_and_later_days_are_routine() {
        let mut st = State::default();

        assert_eq!(advance_used(&mut st, "2026-07-26"), Some("first-use"));
        assert!(st.used);
        assert_eq!(st.last_used_day, "2026-07-26");

        // 同一天后续消息:不再上报(否则活跃用户一天几十条)
        assert_eq!(advance_used(&mut st, "2026-07-26"), None);

        // 隔天:仍要上报,但不能再冒充激活
        assert_eq!(advance_used(&mut st, "2026-07-27"), Some("daily-use"));
        assert_eq!(st.last_used_day, "2026-07-27");
        // 跳过几天照样是日常活跃,激活只发生过一次
        assert_eq!(advance_used(&mut st, "2026-08-15"), Some("daily-use"));
    }

    /// 从旧版本升级:磁盘上只有 used=true 没有 last_used_day。不能因此把
    /// 这台老机器当成新激活重新报一次 first-use。
    #[test]
    fn upgrade_from_state_without_last_used_day_is_not_a_new_activation() {
        let mut st: State =
            serde_json::from_str(r#"{"install_id":"0123456789abcdef","used":true}"#).unwrap();
        assert_eq!(st.last_used_day, "");

        assert_eq!(advance_used(&mut st, "2026-07-26"), Some("daily-use"));
    }

    /// 去重键必须是 YYYY-MM-DD,且与 ms_to_rfc3339 的日期段一致。
    #[test]
    fn utc_day_is_a_bare_date() {
        let day = utc_day();
        assert_eq!(day.len(), 10, "{day}");
        assert_eq!(day.matches('-').count(), 2, "{day}");
        assert_eq!(day, ms_to_rfc3339(now_ms())[..10]);
    }

    /// 端点解析:空串等同未配置(CI 没注入 secret 时给的就是空串),
    /// 末尾斜杠归一化,site_id 缺省为 1。
    #[test]
    fn endpoint_treats_blank_as_unconfigured() {
        assert_eq!(env_or_compiled("MC_TELEMETRY_ABSENT_KEY", None), None);
        assert_eq!(env_or_compiled("MC_TELEMETRY_ABSENT_KEY", Some("  ")), None);
        assert_eq!(
            env_or_compiled("MC_TELEMETRY_ABSENT_KEY", Some("https://m.example.com/matomo.php/")),
            Some("https://m.example.com/matomo.php".into())
        );
    }

    // ---- 端到端:真实 HTTP + 真实状态文件 ----
    //
    // 上面的纯函数单测只能证明"URL 拼对了"。真正会毁掉数据的两件事都在这
    // 下面:设备标识跨进程不稳定(全部算新装机)、失败后游标乱推进(整天丢
    // 数据)。这两条只有把请求真发出去、把文件真写下来才验得了。

    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// 极简假 Matomo:记录收到的每条请求行,按 status 应答后关连接。
    fn fake_matomo(status: u16) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        std::thread::spawn(move || {
            for conn in listener.incoming() {
                let Ok(mut conn) = conn else { continue };
                let mut reader = BufReader::new(conn.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() {
                    continue;
                }
                // 把请求行(含查询串)记下来即可,不必读完头
                sink.lock().unwrap().push(line.trim().to_string());
                let _ = conn.write_all(
                    format!("HTTP/1.1 {status} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                        .as_bytes(),
                );
                let _ = conn.flush();
                let mut drain = Vec::new();
                let _ = reader.read_to_end(&mut drain);
            }
        });
        (format!("http://{addr}/matomo.php"), seen)
    }

    static TMP_SEQ: AtomicUsize = AtomicUsize::new(0);

    fn tmp_state(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "mc-telemetry-{label}-{}-{}",
            std::process::id(),
            TMP_SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(STATE_FILE)
    }

    /// 设备标识必须跨进程稳定,否则每次启动都算一台新装机——所有装机数、
    /// 留存、激活率同时变成垃圾,而且看板上完全看不出异常。
    #[test]
    fn install_id_is_generated_once_and_survives_reload() {
        let path = tmp_state("stable-id");

        let first = load_state(&path).unwrap();
        let second = load_state(&path).unwrap();

        assert!(valid_install_id(&first.install_id), "{}", first.install_id);
        assert_eq!(first.install_id, second.install_id, "重新读取必须拿到同一个标识");
        assert!(path.exists(), "标识必须立刻落盘,只在内存里生成等于每次都是新机器");
        let on_disk: State = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(on_disk.install_id, first.install_id);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    /// 状态文件损坏不该把用户挡在外面,重新生成即可(与 config.json 的严格
    /// 策略刻意不同——那边静默退默认会覆盖 API Key,这边最多丢一台的历史)。
    #[test]
    fn corrupt_state_file_is_regenerated_rather_than_fatal() {
        let path = tmp_state("corrupt");
        std::fs::write(&path, b"{not json").unwrap();

        let st = load_state(&path).unwrap();

        assert!(valid_install_id(&st.install_id), "{}", st.install_id);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn successful_report_reaches_matomo_and_advances_the_cursor() {
        let (url, seen) = fake_matomo(204);
        let ep = Endpoint { url, site_id: "7".into() };
        let path = tmp_state("ok");
        let mut st = load_state(&path).unwrap();
        st.used = true;

        assert!(report(&path, &ep, &mut st, "daily-launch", "26071401").await);

        let reqs = seen.lock().unwrap().clone();
        assert_eq!(reqs.len(), 1, "应恰好发一条: {reqs:?}");
        let line = &reqs[0];
        assert!(line.starts_with("GET /matomo.php?"), "{line}");
        assert!(line.contains(&format!("_id={}", st.install_id)), "{line}");
        assert!(line.contains("idsite=7"), "{line}");
        assert!(line.contains("dimension3=true"), "{line}");
        assert!(line.contains("action_name=daily-launch"), "{line}");

        assert_eq!(st.last_day, utc_day(), "成功后游标推进到今天");
        let on_disk: State = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(on_disk.last_day, utc_day(), "游标必须落盘,否则重启后重复上报");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    /// 失败**不能**推进游标。开机自启时 launch+8s 常常早于网络就绪;先推
    /// 游标再发送会让这类机器每天恒定丢一条,而且是系统性偏差不是偶发。
    #[tokio::test]
    async fn failed_report_leaves_the_cursor_for_the_next_tick() {
        let (url, seen) = fake_matomo(500);
        let ep = Endpoint { url, site_id: "1".into() };
        let path = tmp_state("retry");
        let mut st = load_state(&path).unwrap();

        assert!(!report(&path, &ep, &mut st, "daily-launch", "26071401").await);

        assert_eq!(st.last_day, "", "失败不得推进游标");
        let on_disk: State = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(on_disk.last_day, "", "盘上也不能推进");

        // 下一次醒来重试:同一台机器、同一个标识,这次通了就该记上
        let (ok_url, ok_seen) = fake_matomo(204);
        let ok_ep = Endpoint { url: ok_url, site_id: "1".into() };
        assert!(report(&path, &ok_ep, &mut st, "daily-launch", "26071401").await);
        assert_eq!(st.last_day, utc_day());
        assert_eq!(seen.lock().unwrap().len(), 1, "失败的那次确实发出去过");
        let retried = ok_seen.lock().unwrap().clone();
        assert!(retried[0].contains(&format!("_id={}", st.install_id)), "重试用同一标识");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    /// 一台新机器头两天的完整事件序列,打到真服务器上核对动作名与维度。
    /// 这是四个事件唯一一处被**按顺序**验证的地方——单测只能各自钉一个片段。
    #[tokio::test]
    async fn a_new_machine_emits_install_then_first_use_then_daily_pair() {
        let (url, seen) = fake_matomo(204);
        let ep = Endpoint { url, site_id: "3".into() };
        let path = tmp_state("lifecycle");
        let mut st = load_state(&path).unwrap();
        let id = st.install_id.clone();

        // 第 1 天:启动(装机)
        let a = launch_action(&st);
        assert!(report(&path, &ep, &mut st, a, "26071401").await);
        // 第 1 天:第一次对话(激活)
        let a = advance_used(&mut st, &utc_day()).unwrap();
        assert!(report(&path, &ep, &mut st, a, "26071401").await);
        // 第 1 天:再发消息 → 不再上报
        assert_eq!(advance_used(&mut st, &utc_day()), None);

        // 第 2 天:把两个游标一起拨回过去来伪造跨天(不动系统时钟)。只拨
        // last_day 不拨 last_used_day,advance_used 会认为今天已标记过而返回
        // None —— 这正是两个游标各管一件事的体现。
        st.last_day = "2000-01-01".into();
        st.last_used_day = "2000-01-01".into();
        let a = launch_action(&st);
        assert!(report(&path, &ep, &mut st, a, "26071401").await);
        let a = advance_used(&mut st, &utc_day()).unwrap();
        assert!(report(&path, &ep, &mut st, a, "26071401").await);

        let actions: Vec<String> = seen
            .lock()
            .unwrap()
            .iter()
            .map(|line| {
                line.split("action_name=")
                    .nth(1)
                    .unwrap()
                    .split('&')
                    .next()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(actions, ["install", "first-use", "daily-launch", "daily-use"]);

        // 全程同一个设备标识,且每条都带完整维度
        let lines = seen.lock().unwrap().clone();
        assert_eq!(lines.len(), 4);
        for line in &lines {
            assert!(line.contains(&format!("_id={id}")), "{line}");
            assert!(line.contains("dimension1=26071401"), "{line}");
            assert!(line.contains("dimension2="), "{line}");
        }
        // 装机那条:还没用过 → 两个维度都是 false
        assert!(lines[0].contains("dimension3=false") && lines[0].contains("dimension4=false"));
        // 激活那条:曾经用过 + 今天用过
        assert!(lines[1].contains("dimension3=true") && lines[1].contains("dimension4=true"));
        // 第 2 天启动那条:曾经用过,但**当天还没干活** —— 这一条就是
        // "半年前用过一次、之后天天只是开着"那类机器在数据上的样子,
        // 也是 dimension3/dimension4 必须分开的全部理由。
        assert!(lines[2].contains("dimension3=true"), "{}", lines[2]);
        assert!(lines[2].contains("dimension4=false"), "{}", lines[2]);
        // 第 2 天对话那条:当天开始干活了
        assert!(lines[3].contains("dimension3=true") && lines[3].contains("dimension4=true"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    /// 端点不可达(断网/防火墙)只能是静默失败:不 panic、不阻塞、不推游标。
    #[tokio::test]
    async fn unreachable_endpoint_fails_silently() {
        // 端口 1 上没有服务,连接会被立刻拒绝
        let ep = Endpoint { url: "http://127.0.0.1:1/matomo.php".into(), site_id: "1".into() };
        let path = tmp_state("offline");
        let mut st = load_state(&path).unwrap();

        assert!(!report(&path, &ep, &mut st, "daily-launch", "26071401").await);
        assert_eq!(st.last_day, "");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
