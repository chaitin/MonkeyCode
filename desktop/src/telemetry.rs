// 装机与使用统计:向自建 Matomo 发一条极小的心跳。
//
// 只回答两个问题:每天新增多少台装机、装了之后有没有真的用起来。
// 载荷固定四项——设备标识、事件名、版本、系统——不含路径、仓库名、会话
// 内容或账号信息。上报由壳发起而非 UI(契约:UI 不建立任何网络连接),
// 顺带也就不受 webview CSP 约束。
//
// 发的是 Matomo 的**事件**而不是页面浏览,于是三个数都等于事件数:
//   当日新增装机 = install
//   当日存活设备 = install + daily-launch
//   当日真实使用 = first-use + daily-use
// 每台设备每天每个槽位恰好一条,所以事件数就是设备数,不经过 Matomo 的访客
// 识别。后者是拿 IP+UA 猜的(trust_visitors_cookies 默认 0),同一出口 IP 的
// 多台机器会被归并成一个访客、多余的 `_id` 在入库时直接丢弃,而看板上看不出
// 任何异常。事件计数绕开了整条不确定链路。
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

/// 事件对 `url` 并非必需,但给一个固定的合成值能让四个事件在报表里有统一的
/// 页面上下文。桌面端没有真实页面地址,这是个占位。
const SYNTHETIC_URL: &str = "https://desktop.monkeycode/launch";

/// 事件类别(`e_c`)。四个动作都归在这一类下,报表路径因此是固定的:
/// 行为 → 事件 → 事件类别 `desktop` → 事件操作 install/daily-launch/first-use/daily-use。
const EVENT_CATEGORY: &str = "desktop";

// ==================== 状态 ====================

#[derive(Default, Serialize, Deserialize)]
struct State {
    /// 16 位小写十六进制的设备标识。同时进 `_id`(访客识别)和 `e_n`(事件
    /// 名称):前者被 Matomo 按 IP+UA 归并时会被丢弃,后者落在动作行上,是唯一
    /// 一份跑不掉的设备身份——出问题时能直接在"事件名称"报表里翻出是哪台机器。
    ///
    /// Matomo 的 `_id` **只接受这个形状**:给错格式它不会报错,而是退回按 IP+UA
    /// 另猜一个访客,而看板上完全看不出异常。valid_install_id 是这条契约的唯一守卫。
    #[serde(default)]
    install_id: String,
    /// 这台机器**至今**有没有成功报过一次使用。只用来区分 `first-use` 与
    /// `daily-use`——"装了到底用没用"现在由两个事件的条数直接回答。
    #[serde(default)]
    used: bool,
    /// 使用槽的游标:最近一次**成功**上报使用事件所属的 UTC 日期。
    #[serde(default)]
    last_used_day: String,
    /// 启动槽的游标:最近一次**成功**上报启动事件所属的 UTC 日期(YYYY-MM-DD)。
    /// 空 = 从没成功报过 = 我们还没见过这台设备(install 的判据)。
    #[serde(default)]
    last_day: String,
}

/// 两个上报槽位,各有各的游标。
///
/// 共用一个游标会互相吞事件:跨午夜后若用户先开对话,使用事件推进了共用游标,
/// 当天的启动事件就再也发不出去——"当日存活设备 = install + daily-launch 的
/// 事件数"因此系统性少算,而且少算的恰好是开着不关的重度用户。
#[derive(Clone, Copy)]
enum Slot {
    Launch,
    Use,
}

/// 上报时刻的环境事实。单独成结构体而不是一串参数:tracking_url 因此能在
/// 测试里完全脱离 AppHandle 与真实时钟,而不必列六个位置参数。
struct Facts {
    version: String,
    platform: String,
    nonce: String,
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

/// telemetry.json 的进程内互斥。启动槽(tick)与使用槽(mark_used)都是
/// load → report(跨一次网络往返)→ save 的整段读改写,且 save 写的是完整
/// State:不串行化时后落盘者会用陈旧快照覆盖对方刚推进的游标,打破"每台
/// 设备每天每个槽位恰好一条"的模块级不变量(装机/启动被重复计数);首次
/// 运行时两路还会各生成并落盘一个 install_id。持锁跨 await,必须用异步锁。
fn state_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
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

/// 每天第一次开对话时调用:上报"今天在干活"。
///
/// 由命令层调用而非 driver 内部——driver 只做协议翻译,埋点属于策略。
/// 一天只碰一次盘,当天后续消息走进程内快速路径,不给每轮对话加 I/O。
///
/// 事件名分两种,因为这是两个不同的问题:`first-use` 是这台机器**有史以来**
/// 第一次用(激活时点,一辈子一条),`daily-use` 是之后每天的第一次。混用一个
/// 名字,激活率就只能靠"扫历史找每台设备最早那条 daily-use"才算得出来——
/// 跨天按设备聚合,Matomo 后台做不了。
pub fn mark_used(app: &AppHandle) {
    // 记"已标记到哪天"而不是一个 bool:跨天要自动放行。
    // Mutex::new 是 const fn,静态初始化即可,无需 LazyLock。
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
        let _guard = state_lock().lock().await;
        let mut st = match load_state(&path) {
            Ok(st) => st,
            Err(e) => return eprintln!("[desktop] 统计: 读状态失败 {e}"),
        };
        // 本进程之前那次运行今天可能已经报过(进程内缓存只覆盖本次运行)
        let Some(action) = use_action(&st, &today) else { return };
        report(&path, &ep, &mut st, Slot::Use, action, &version).await;
    });
}

/// 使用槽今天该发的事件名;今天已成功报过则 None。
///
/// 两个事件名对应两个不同的问题:`first-use` 是这台机器**有史以来**第一次用
/// (激活时点,一辈子一条),`daily-use` 是之后每天的第一次。
fn use_action(st: &State, today: &str) -> Option<&'static str> {
    if st.last_used_day == today {
        return None;
    }
    Some(if st.used { "daily-use" } else { "first-use" })
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
    let _guard = state_lock().lock().await;
    let mut st = match load_state(&path) {
        Ok(st) => st,
        Err(e) => return eprintln!("[desktop] 统计: 读状态失败 {e}"),
    };
    // 先定事件名再交出可变借用(launch_action 读的正是 report 会改的游标)
    let Some(action) = launch_action(&st, &utc_day()) else { return };
    report(&path, &ep, &mut st, Slot::Launch, action, &version).await;
}

/// 启动槽今天该发的事件名:第一次是装机,之后是当天首次启动;今天已成功
/// 报过则 None。
///
/// 装机的判据是"`last_day` 为空 = 这台设备从没成功上报过启动事件 = 我们第一次
/// 见到它"。用游标而不是另加一个 `install_reported` 字段:游标只在**成功**时
/// 推进,所以首次上报失败(开机自启时网络常常还没就绪)后的重试仍然算装机,
/// 不会静默退化成 daily-launch 把装机记录永久丢掉。
///
/// 装机不单独再发一条请求:新设备的第一条启动事件本身就是装机事件。同一
/// 槽位换个名字,"每台设备每天恰好一条启动事件"这条不变量因此保持成立——
/// 它正是"当日存活设备 = install + daily-launch 的事件数"能成立的前提。
fn launch_action(st: &State, today: &str) -> Option<&'static str> {
    if st.last_day == today {
        return None;
    }
    Some(if st.last_day.is_empty() { "install" } else { "daily-launch" })
}

/// 发送一条事件,并在**成功后**推进该槽位的游标。返回是否发成功(供测试断言)。
///
/// 顺序很关键:先写游标再发送会系统性地丢数据——应用随开机自启时,
/// launch+8s 常常早于网络就绪,那一天就永久没有了。成功才推进,失败留给
/// 6 小时后的下一次醒来重试,一天最多四次尝试,不构成重试风暴。
///
/// 两个槽位在这一点上同构:使用事件失败同样不推进,于是重试仍然是
/// `first-use` 而不会退化成 `daily-use` —— 与 install 的判据是同一条理由。
async fn report(
    path: &Path,
    ep: &Endpoint,
    st: &mut State,
    slot: Slot,
    action: &str,
    version: &str,
) -> bool {
    let facts =
        Facts { version: version.to_string(), platform: platform(), nonce: nonce() };
    let url = tracking_url(ep, st, action, &facts);
    match send(&url).await {
        Ok(()) => {
            let today = utc_day();
            match slot {
                Slot::Launch => st.last_day = today,
                Slot::Use => {
                    st.used = true;
                    st.last_used_day = today;
                }
            }
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

/// Matomo Tracking HTTP API 的完整请求地址(一条事件)。
///
/// 发**事件**(e_c/e_a/e_n)而不是页面浏览:装机、存活、使用三个数因此等于
/// 对应事件的条数,一次访客识别都不经过。设备标识同时进 `_id` 和 `e_n` ——
/// 前者在归并时会被丢掉,后者落在动作行上,永远跑不掉。
///
/// 纯函数,单测直接盯住三处静默失败点:`_id` 的形状、`e_c`/`e_a` 非空(空值
/// Matomo 判为无效事件直接丢弃),以及自定义维度的编号(dimension1/2 必须先
/// 在 Matomo 后台建好且 scope 为 **Action**,否则参数被丢弃且不报错)。
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
        ("e_c", EVENT_CATEGORY),
        ("e_a", action),
        // 设备标识落在动作行上的那一份。事件名称报表因此就是设备清单。
        ("e_n", &st.install_id),
        ("dimension1", &facts.version),
        ("dimension2", &facts.platform),
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
        Facts { version: "26071401".into(), platform: platform.into(), nonce: "beef".into() }
    }

    /// used = 曾经用过;used_today = 今天已成功报过使用事件。
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

    /// 必须是事件(e_c/e_a)而不是页面浏览(action_name)。发成页面浏览时
    /// Matomo 照收不误,只是全部落进"页面标题"报表、事件报表恒空,而三个
    /// 指标的口径("等于事件数")悄悄失去依据。
    #[test]
    fn tracking_url_is_an_event_not_a_pageview() {
        let url = tracking_url(&ep(), &state(true, true), "daily-launch", &facts("linux-x86_64"));

        assert!(url.contains("&e_c=desktop"), "事件类别: {url}");
        assert!(url.contains("&e_a=daily-launch"), "事件操作: {url}");
        assert!(!url.contains("action_name="), "不能再发页面浏览: {url}");
    }

    /// 设备标识必须**同时**进 `_id` 和 `e_n`。只留 `_id` 时,同一出口 IP 的
    /// 多台机器被 Matomo 归并成一个访客后,除第一台外的标识在入库时就没了,
    /// 事后无从追查;`e_n` 落在动作行上,归并不掉。
    #[test]
    fn device_id_rides_on_every_event_not_just_the_visitor_field() {
        let st = state(true, true);
        let url = tracking_url(&ep(), &st, "install", &facts("macos-aarch64"));

        assert!(url.contains("&_id=a3f19c02b84e7d61"), "{url}");
        assert!(url.contains("&e_n=a3f19c02b84e7d61"), "事件自带设备标识: {url}");
    }

    /// 自定义维度的编号是与 Matomo 后台配置的约定。改了编号等于把数据写进
    /// 别的维度(或被丢弃),同样不报错。
    #[test]
    fn tracking_url_pins_custom_dimension_slots() {
        let url = tracking_url(&ep(), &state(true, true), "daily-launch", &facts("linux-x86_64"));

        assert!(url.contains("&dimension1=26071401"), "版本 → dimension1: {url}");
        assert!(url.contains("&dimension2=linux-x86_64"), "系统 → dimension2: {url}");
    }

    /// 合成 URL 与事件名必须转义后进查询串,否则 `://` 会截断后面的参数。
    #[test]
    fn tracking_url_percent_encodes_values() {
        let url = tracking_url(&ep(), &state(true, true), "first-use", &facts("windows-x86_64"));
        assert!(url.contains("url=https%3A%2F%2Fdesktop.monkeycode%2Flaunch"), "{url}");
        assert!(url.contains("&e_a=first-use"), "{url}");
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

    /// 启动槽:第一次见到这台设备是装机,之后是当天首次启动,当天报过就不再报。
    #[test]
    fn first_launch_ever_is_an_install_and_later_days_are_routine() {
        let mut st = State::default();
        assert_eq!(launch_action(&st, TODAY), Some("install"));

        st.last_day = TODAY.into(); // 一次成功上报之后
        assert_eq!(launch_action(&st, TODAY), None, "当天不得重复上报");
        assert_eq!(launch_action(&st, "2026-07-27"), Some("daily-launch"));
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
        assert_eq!(launch_action(&st, TODAY), Some("install"), "重试仍应算装机");

        // 只有成功过(游标推进)才不再算装机
        st.last_day = "2026-07-25".into();
        assert_eq!(launch_action(&st, TODAY), Some("daily-launch"));
    }

    /// 一台机器一生的用量序列:第一次是激活(first-use,只此一条),当天再发
    /// 消息不重复上报,隔天变成日常活跃(daily-use)。
    #[test]
    fn first_conversation_ever_is_activation_and_later_days_are_routine() {
        let mut st = State::default();

        assert_eq!(use_action(&st, "2026-07-26"), Some("first-use"));

        // 报成功之后(report 推进的正是这两个字段)
        st.used = true;
        st.last_used_day = "2026-07-26".into();

        // 同一天后续消息:不再上报(否则活跃用户一天几十条)
        assert_eq!(use_action(&st, "2026-07-26"), None);

        // 隔天:仍要上报,但不能再冒充激活
        assert_eq!(use_action(&st, "2026-07-27"), Some("daily-use"));
        // 跳过几天照样是日常活跃,激活只发生过一次
        assert_eq!(use_action(&st, "2026-08-15"), Some("daily-use"));
    }

    /// 从旧版本升级:磁盘上只有 used=true 没有 last_used_day。不能因此把
    /// 这台老机器当成新激活重新报一次 first-use。
    #[test]
    fn upgrade_from_state_without_last_used_day_is_not_a_new_activation() {
        let st: State =
            serde_json::from_str(r#"{"install_id":"0123456789abcdef","used":true}"#).unwrap();
        assert_eq!(st.last_used_day, "");

        assert_eq!(use_action(&st, "2026-07-26"), Some("daily-use"));
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

    /// 从假 Matomo 收到的请求行里取出事件操作名(`e_a`),按到达顺序。
    fn event_actions(seen: &Arc<Mutex<Vec<String>>>) -> Vec<String> {
        seen.lock()
            .unwrap()
            .iter()
            .map(|line| line.split("&e_a=").nth(1).unwrap().split('&').next().unwrap().to_string())
            .collect()
    }

    #[tokio::test]
    async fn successful_report_reaches_matomo_and_advances_the_cursor() {
        let (url, seen) = fake_matomo(204);
        let ep = Endpoint { url, site_id: "7".into() };
        let path = tmp_state("ok");
        let mut st = load_state(&path).unwrap();
        st.used = true;

        assert!(report(&path, &ep, &mut st, Slot::Launch, "daily-launch", "26071401").await);

        let reqs = seen.lock().unwrap().clone();
        assert_eq!(reqs.len(), 1, "应恰好发一条: {reqs:?}");
        let line = &reqs[0];
        assert!(line.starts_with("GET /matomo.php?"), "{line}");
        assert!(line.contains(&format!("_id={}", st.install_id)), "{line}");
        assert!(line.contains(&format!("e_n={}", st.install_id)), "{line}");
        assert!(line.contains("idsite=7"), "{line}");
        assert!(line.contains("e_c=desktop"), "{line}");
        assert!(line.contains("e_a=daily-launch"), "{line}");

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

        assert!(!report(&path, &ep, &mut st, Slot::Launch, "daily-launch", "26071401").await);

        assert_eq!(st.last_day, "", "失败不得推进游标");
        let on_disk: State = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(on_disk.last_day, "", "盘上也不能推进");

        // 下一次醒来重试:同一台机器、同一个标识,这次通了就该记上
        let (ok_url, ok_seen) = fake_matomo(204);
        let ok_ep = Endpoint { url: ok_url, site_id: "1".into() };
        assert!(report(&path, &ok_ep, &mut st, Slot::Launch, "daily-launch", "26071401").await);
        assert_eq!(st.last_day, utc_day());
        assert_eq!(seen.lock().unwrap().len(), 1, "失败的那次确实发出去过");
        let retried = ok_seen.lock().unwrap().clone();
        assert!(retried[0].contains(&format!("_id={}", st.install_id)), "重试用同一标识");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    /// 使用事件失败后的重试**仍然是激活**。与 install 同一条理由:先把
    /// used 记成真再发送,失败一次这台机器就永远不会出现在激活数里。
    #[tokio::test]
    async fn failed_use_report_retries_as_activation_not_routine() {
        let (url, _) = fake_matomo(500);
        let ep = Endpoint { url, site_id: "1".into() };
        let path = tmp_state("use-retry");
        let mut st = load_state(&path).unwrap();
        let today = utc_day();
        assert_eq!(use_action(&st, &today), Some("first-use"));

        assert!(!report(&path, &ep, &mut st, Slot::Use, "first-use", "26071401").await);

        assert!(!st.used, "失败不得把 used 记成真");
        assert_eq!(use_action(&st, &today), Some("first-use"), "重试仍是激活,不能退化成 daily-use");
        let on_disk: State = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert!(!on_disk.used, "盘上也不能推进");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    /// 两个槽位的游标必须互不干扰。共用一个游标时,跨午夜后先开对话的机器
    /// 会把当天的启动事件永久吞掉——"当日存活设备 = install + daily-launch"
    /// 因此系统性少算,而且少算的恰好是开着不关的重度用户。
    #[tokio::test]
    async fn a_use_event_does_not_swallow_the_same_day_launch_event() {
        let (url, seen) = fake_matomo(204);
        let ep = Endpoint { url, site_id: "1".into() };
        let path = tmp_state("two-cursors");
        let mut st = load_state(&path).unwrap();
        st.used = true;
        st.last_day = "2000-01-01".into(); // 昨天两个槽都报过
        st.last_used_day = "2000-01-01".into();
        let today = utc_day();

        // 跨午夜后的常见次序:先开对话,启动事件还没轮到
        let a = use_action(&st, &today).unwrap();
        assert!(report(&path, &ep, &mut st, Slot::Use, a, "26071401").await);

        let a = launch_action(&st, &today).expect("使用事件不得吞掉当天的启动事件");
        assert_eq!(a, "daily-launch");
        assert!(report(&path, &ep, &mut st, Slot::Launch, a, "26071401").await);

        assert_eq!(event_actions(&seen), ["daily-use", "daily-launch"]);
        // 各自推进各自的游标,当天都不再重复
        assert_eq!(launch_action(&st, &today), None);
        assert_eq!(use_action(&st, &today), None);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    /// 一台新机器头两天的完整事件序列,打到真服务器上核对事件名与维度。
    /// 这是四个事件唯一一处被**按顺序**验证的地方——单测只能各自钉一个片段。
    #[tokio::test]
    async fn a_new_machine_emits_install_then_first_use_then_daily_pair() {
        let (url, seen) = fake_matomo(204);
        let ep = Endpoint { url, site_id: "3".into() };
        let path = tmp_state("lifecycle");
        let mut st = load_state(&path).unwrap();
        let id = st.install_id.clone();
        let today = utc_day();

        // 第 1 天:启动(装机)
        let a = launch_action(&st, &today).unwrap();
        assert!(report(&path, &ep, &mut st, Slot::Launch, a, "26071401").await);
        // 第 1 天:第一次对话(激活)
        let a = use_action(&st, &today).unwrap();
        assert!(report(&path, &ep, &mut st, Slot::Use, a, "26071401").await);
        // 第 1 天:再启动一次 / 再发消息 → 两个槽都不再上报
        assert_eq!(launch_action(&st, &today), None);
        assert_eq!(use_action(&st, &today), None);

        // 第 2 天:把两个游标一起拨回过去来伪造跨天(不动系统时钟)
        st.last_day = "2000-01-01".into();
        st.last_used_day = "2000-01-01".into();
        let a = launch_action(&st, &today).unwrap();
        assert!(report(&path, &ep, &mut st, Slot::Launch, a, "26071401").await);
        let a = use_action(&st, &today).unwrap();
        assert!(report(&path, &ep, &mut st, Slot::Use, a, "26071401").await);

        assert_eq!(
            event_actions(&seen),
            ["install", "first-use", "daily-launch", "daily-use"]
        );

        // 全程同一个设备标识,每条事件都自带它,且都带完整维度
        let lines = seen.lock().unwrap().clone();
        assert_eq!(lines.len(), 4);
        for line in &lines {
            assert!(line.contains(&format!("_id={id}")), "{line}");
            assert!(line.contains(&format!("e_n={id}")), "事件自带设备标识: {line}");
            assert!(line.contains("e_c=desktop"), "{line}");
            assert!(line.contains("dimension1=26071401"), "{line}");
            assert!(line.contains("dimension2="), "{line}");
        }
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    /// 端点不可达(断网/防火墙)只能是静默失败:不 panic、不阻塞、不推游标。
    #[tokio::test]
    async fn unreachable_endpoint_fails_silently() {
        // 端口 1 上没有服务,连接会被立刻拒绝
        let ep = Endpoint { url: "http://127.0.0.1:1/matomo.php".into(), site_id: "1".into() };
        let path = tmp_state("offline");
        let mut st = load_state(&path).unwrap();

        assert!(!report(&path, &ep, &mut st, Slot::Launch, "daily-launch", "26071401").await);
        assert_eq!(st.last_day, "");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
