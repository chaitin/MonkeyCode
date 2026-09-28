//! 桌宠偏好、精简账号数据、原生菜单与窗口几何。两个渲染后端共用。
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(not(target_os = "windows"))]
use tauri::menu::{ContextMenu, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Manager};

use crate::{config, util::LockExt};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Sound {
    pub enabled: bool,
    pub volume: u8,
    pub source: String,
}
impl Default for Sound {
    fn default() -> Self {
        Self {
            enabled: true,
            volume: 70,
            source: "default".into(),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Sounds {
    pub press: Sound,
    pub release: Sound,
    pub start: Sound,
    pub end: Sound,
    pub error: Sound,
    pub approval: Sound,
    pub question: Sound,
    pub idle: Sound,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct Preferences {
    pub scale: u16,
    pub snap: bool,
    pub bubble: String,
    pub click_bubble: String,
    pub bubble_seconds: u16,
    pub quota_alerts: bool,
    pub quota_warning: u8,
    pub quota_critical: u8,
    pub credits_warning: u64,
    pub quiet_enabled: bool,
    pub quiet_start: u16,
    pub quiet_end: u16,
    pub muted_until: u64,
    pub sounds: Sounds,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            scale: 100,
            snap: true,
            bubble: "tasks".into(),
            click_bubble: "credits".into(),
            bubble_seconds: 6,
            quota_alerts: true,
            quota_warning: 20,
            quota_critical: 10,
            credits_warning: 100,
            quiet_enabled: false,
            quiet_start: 22 * 60,
            quiet_end: 8 * 60,
            muted_until: 0,
            sounds: Sounds::default(),
        }
    }
}
impl Preferences {
    fn validate(&self) -> Result<(), String> {
        if !(75..=150).contains(&self.scale) || self.scale % 5 != 0 {
            return Err("桌宠大小需为 75%–150%，每档 5%".into());
        }
        if !["tasks", "quota", "credits", "none"].contains(&self.bubble.as_str()) {
            return Err("未知的气泡内容".into());
        }
        if !["credits", "greeting", "none"].contains(&self.click_bubble.as_str())
            || self.bubble_seconds > 60
        {
            return Err("点击气泡类型或时长无效（0–60 秒）".into());
        }
        if self.quota_critical == 0
            || self.quota_critical >= self.quota_warning
            || self.quota_warning > 100
        {
            return Err("额度阈值需满足 0 < 紧急阈值 < 提醒阈值 ≤ 100".into());
        }
        if self.quiet_start >= 1440
            || self.quiet_end >= 1440
            || self.credits_warning > 1_000_000_000
        {
            return Err("勿扰时间或积分阈值无效".into());
        }
        if [
            &self.sounds.press,
            &self.sounds.release,
            &self.sounds.start,
            &self.sounds.end,
            &self.sounds.error,
            &self.sounds.approval,
            &self.sounds.question,
            &self.sounds.idle,
        ]
        .iter()
        .any(|s| s.volume > 100 || !crate::pet_audio::valid_source(&s.source))
        {
            return Err("音量需为 0–100，音效来源必须有效".into());
        }
        Ok(())
    }
}

fn merge_patch(base: &mut Value, patch: Value) -> Result<(), String> {
    let (Some(dst), Value::Object(src)) = (base.as_object_mut(), patch) else {
        return Err("偏好必须是对象".into());
    };
    for (key, value) in src {
        let target = dst
            .get_mut(&key)
            .ok_or_else(|| format!("未知偏好: {key}"))?;
        if target.is_object() {
            merge_patch(target, value)?;
        } else {
            *target = value;
        }
    }
    Ok(())
}

fn patched(prefs: &Preferences, patch: Value) -> Result<Preferences, String> {
    let mut value = serde_json::to_value(prefs).map_err(|e| e.to_string())?;
    merge_patch(&mut value, patch)?;
    let next: Preferences = serde_json::from_value(value).map_err(|e| e.to_string())?;
    next.validate()?;
    Ok(next)
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub label: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct View {
    pub state: String,
    pub tone: String,
    pub text: String,
    pub detail: String,
    pub action: String,
    pub tasks: Vec<Task>,
    pub pressed: bool,
    pub bounce: u64,
}

#[derive(Clone, Default, Serialize)]
pub struct Wallet {
    pub scope: String,
    pub credits: Option<f64>,
    pub used_today: Option<f64>,
    pub usage_day: i64,
    pub remaining: Option<f64>,
    pub total: Option<f64>,
    pub updated_at: u64,
    pub stale: bool,
    pub status: String,
}

#[derive(Default)]
struct WalletCache {
    scope: String,
    checked: Option<Instant>,
    value: Wallet,
}

#[derive(Default)]
pub struct PetState {
    pub prefs: Mutex<Preferences>,
    pub view: Mutex<View>,
    wallet: tokio::sync::Mutex<WalletCache>,
    #[cfg(not(target_os = "windows"))]
    menu: Mutex<Option<Menu<tauri::Wry>>>,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn scale(app: &AppHandle) -> f64 {
    f64::from(app.state::<PetState>().prefs.lock_ok().scale) / 100.0
}

#[tauri::command]
pub fn pet_preferences(app: AppHandle) -> Value {
    json!({ "preferences": *app.state::<PetState>().prefs.lock_ok(), "defaults": Preferences::default(),
        "enabled": app.state::<crate::PetEnabled>().0.load(std::sync::atomic::Ordering::Relaxed) })
}

#[tauri::command]
pub fn pet_set_preferences(app: AppHandle, patch: Value) -> Result<Preferences, String> {
    let state = app.state::<PetState>();
    let (next, geometry_changed) = {
        let mut prefs = state.prefs.lock_ok();
        let next = patched(&prefs, patch)?;
        config::update_config_json(&app, |cfg| cfg.pet_preferences = next.clone())?;
        let geometry_changed = next.scale != prefs.scale || next.snap != prefs.snap;
        *prefs = next.clone();
        (next, geometry_changed)
    };
    let _ = app.emit("pet-preferences", pet_preferences(app.clone()));
    // 几何更新不持偏好锁：窗口调用会同步泵消息。
    if geometry_changed {
        fit_window(&app, false)?;
    }
    Ok(next)
}

#[tauri::command]
pub fn pet_account_changed(app: AppHandle) -> Result<(), String> {
    app.emit("pet-wallet-invalidated", ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pet_preview_sound(app: AppHandle, sound: String) -> Result<(), String> {
    if ![
        "press", "release", "start", "end", "error", "approval", "question", "idle",
    ]
    .contains(&sound.as_str())
    {
        return Err("未知音效".into());
    }
    app.emit("pet-preview-sound", sound)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pet_set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    config::update_config_json(&app, |cfg| cfg.pet_enabled = enabled)?;
    app.state::<crate::PetEnabled>()
        .0
        .store(enabled, std::sync::atomic::Ordering::Relaxed);
    if let Some(item) = app.state::<crate::TrayPetItem>().0.lock_ok().as_ref() {
        let _ = item.set_checked(enabled);
    }
    crate::set_pet_visible(&app, enabled);
    let _ = app.emit("pet-preferences", pet_preferences(app.clone()));
    Ok(())
}

fn wallet_scope(svc: &crate::baizhi::Service) -> String {
    let Ok(url) = reqwest::Url::parse(&format!("{}/api/v1/users/wallet", svc.ep.monkeycode)) else {
        return String::new();
    };
    let Some(cookie) = svc.mc.header(&url) else {
        return String::new();
    };
    // 仅用于壳内缓存隔离；Cookie 从不离开壳。
    format!(
        "{:x}",
        Sha256::digest(format!("{}\0{}", svc.ep.monkeycode, cookie).as_bytes())
    )
}

fn account_scope(base_url: &str, user: &Value) -> String {
    let identity = ["id", "user_id", "email", "username"]
        .iter()
        .filter_map(|key| user.get(key))
        .find(|v| v.as_str().is_some_and(|s| !s.is_empty()) || v.is_number());
    identity
        .map(|id| {
            format!(
                "{:x}",
                Sha256::digest(format!("{base_url}\0{id}").as_bytes())
            )
        })
        .unwrap_or_default()
}

fn finite_field(value: &Value, key: &str) -> Option<f64> {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .map(|v| v.max(0.0))
}

#[tauri::command]
pub async fn pet_wallet(app: AppHandle, force: Option<bool>) -> Result<Wallet, String> {
    let state = app.state::<PetState>();
    let mut cache = state.wallet.lock().await;
    let bz = app.state::<crate::baizhi::BaizhiState>();
    let svc = bz.service();
    let scope = wallet_scope(&svc);
    if scope.is_empty() {
        *cache = WalletCache::default();
        return Ok(Wallet {
            status: "signed_out".into(),
            ..Default::default()
        });
    }
    if cache.scope != scope {
        *cache = WalletCache {
            scope: scope.clone(),
            ..Default::default()
        };
    }
    let usage_day = (now_ms() as i64 / 1000 + 8 * 3600) / 86400;
    let ttl = if force.unwrap_or(false) { 5 } else { 60 };
    if cache
        .checked
        .is_some_and(|at| at.elapsed() < Duration::from_secs(ttl))
        && (cache.value.used_today.is_none() || cache.value.usage_day == usage_day)
    {
        return Ok(cache.value.clone());
    }
    // 账号摘要不随 Cookie 续期/重新登录改变，确保同一账号的每日阈值能去重。
    let identity = async {
        if !cache.value.scope.is_empty() {
            return cache.value.scope.clone();
        }
        match crate::baizhi::monkeycode::mc_status(&svc).await {
            Ok((true, user)) => account_scope(&svc.ep.monkeycode, &user),
            _ => String::new(),
        }
    };
    let start = usage_day * 86400 - 8 * 3600;
    let (result, account, usage) = tokio::join!(
        crate::baizhi::monkeycode::mc_wallet(&svc),
        identity,
        tokio::time::timeout(
            Duration::from_secs(10),
            crate::baizhi::monkeycode::mc_pet_used_credits(&svc, start, now_ms() / 1000)
        )
    );
    let current = bz.service();
    if !Arc::ptr_eq(&svc, &current) || wallet_scope(&current) != scope {
        *cache = WalletCache::default();
        return Ok(Wallet {
            status: "changed".into(),
            ..Default::default()
        });
    }
    cache.checked = Some(Instant::now());
    match result {
        Ok(value) => {
            let total = finite_field(&value, "daily_token_limit");
            let remaining = finite_field(&value, "daily_token_balance")
                .map(|n| total.filter(|t| *t > 0.0).map(|t| n.min(t)).unwrap_or(n));
            cache.value = Wallet {
                scope: account,
                credits: finite_field(&value, "balance").map(|v| v / 1000.0),
                used_today: usage.ok().and_then(Result::ok),
                usage_day,
                remaining,
                total,
                updated_at: now_ms(),
                stale: false,
                status: "ready".into(),
            };
        }
        Err(crate::baizhi::BzErr::Unauthorized(_)) => {
            cache.value = Wallet {
                status: "signed_out".into(),
                ..Default::default()
            };
        }
        Err(_) => {
            cache.value.scope = account;
            cache.value.stale = true;
            cache.value.status = "unavailable".into();
        }
    }
    Ok(cache.value.clone())
}

#[tauri::command]
pub fn pet_native_render(app: AppHandle, mut view: View) {
    view.text = view.text.chars().take(120).collect();
    view.detail = view.detail.chars().take(500).collect();
    view.tasks.truncate(100);
    for task in &mut view.tasks {
        task.title = task.title.chars().take(100).collect();
        task.label = task.label.chars().take(30).collect();
    }
    #[cfg(target_os = "windows")]
    crate::native_pet::update(&app, &view);
    *app.state::<PetState>().view.lock_ok() = view;
}

pub fn open_settings(app: &AppHandle, section: &str) {
    app.state::<crate::UiIntent>()
        .0
        .lock_ok()
        .replace(format!("open-settings:{section}"));
    crate::show_any_window(app);
    let _ = app.emit_to("main", "open-settings", section);
}

#[tauri::command]
pub fn pet_activate(app: AppHandle, action: Option<String>) -> Result<(), String> {
    let action = action.unwrap_or_else(|| app.state::<PetState>().view.lock_ok().action.clone());
    if let Some(id) = action.strip_prefix("session:") {
        if crate::open_session_intent(id).is_none() {
            return Err("任务标识无效".into());
        }
        crate::show_main_session(&app, Some(id));
    } else {
        match action.as_str() {
            "menu" => return pet_menu(app),
            "account" => open_settings(&app, "account"),
            "settings" => open_settings(&app, "pet"),
            _ => crate::show_any_window(&app),
        }
    }
    Ok(())
}

pub struct MenuEntry {
    pub id: String,
    pub label: String,
    pub enabled: bool,
}

pub fn menu_entries(app: &AppHandle) -> Vec<MenuEntry> {
    let state = app.state::<PetState>();
    let view = state.view.lock_ok().clone();
    let prefs = state.prefs.lock_ok().clone();
    let mut entries = Vec::new();
    let mut add = |id: &str, label: String, enabled| {
        entries.push(MenuEntry {
            id: id.into(),
            label,
            enabled,
        })
    };
    if !view.detail.is_empty() {
        add("", view.detail.chars().take(180).collect(), false);
    }
    if view.tasks.is_empty() {
        add("", "暂无待处理任务".into(), false);
    }
    for task in &view.tasks {
        add(
            &format!("session:{}", task.id),
            format!("{} · {}", task.label, task.title),
            true,
        );
    }
    add("separator", String::new(), false);
    add("main", "打开主窗口（或双击猴子）".into(), true);
    add("account", "查看账号额度与积分".into(), true);
    add("refresh", "刷新额度".into(), true);
    add("settings", "萌宠设置…".into(), true);
    add(
        "mute",
        if prefs.muted_until > now_ms() {
            "结束临时勿扰"
        } else {
            "勿扰 1 小时"
        }
        .into(),
        true,
    );
    add(
        "snap",
        format!("{}边缘吸附", if prefs.snap { "✓ " } else { "" }),
        true,
    );
    add(
        "smaller",
        format!("缩小（当前 {}%）", prefs.scale),
        prefs.scale > 75,
    );
    add(
        "larger",
        format!("放大（当前 {}%）", prefs.scale),
        prefs.scale < 150,
    );
    add("reset", "重置位置".into(), true);
    add("hide", "隐藏萌宠（可从托盘恢复）".into(), true);
    entries
}

pub fn menu_action(app: &AppHandle, id: &str) {
    let prefs = app.state::<PetState>().prefs.lock_ok().clone();
    let result = match id {
        "refresh" => app.emit("pet-refresh-wallet", ()).map_err(|e| e.to_string()),
        "mute" => pet_set_preferences(app.clone(), json!({"muted_until": if prefs.muted_until > now_ms() { 0 } else { now_ms() + 3_600_000 }})).map(|_| ()),
        "snap" => pet_set_preferences(app.clone(), json!({"snap": !prefs.snap})).map(|_| ()),
        "smaller" => pet_set_preferences(app.clone(), json!({"scale": prefs.scale.saturating_sub(5).max(75)})).map(|_| ()),
        "larger" => pet_set_preferences(app.clone(), json!({"scale": (prefs.scale + 5).min(150)})).map(|_| ()),
        "reset" => pet_reset_position(app.clone()),
        "hide" => pet_set_enabled(app.clone(), false),
        _ => pet_activate(app.clone(), Some(id.into())),
    };
    if let Err(error) = result {
        eprintln!("[pet] 菜单操作失败: {error}");
        let _ = app.emit("pet-error", error);
    }
}

#[tauri::command]
pub fn pet_menu(app: AppHandle) -> Result<(), String> {
    let entries = menu_entries(&app);
    #[cfg(target_os = "windows")]
    {
        let handle = app.clone();
        app.run_on_main_thread(move || crate::native_pet::popup_menu(&handle, &entries))
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let menu = Menu::new(&app).map_err(|e| e.to_string())?;
        for (index, entry) in entries.iter().enumerate() {
            if entry.id == "separator" {
                menu.append(&PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            } else {
                let id = if entry.enabled {
                    format!("pet:{}", entry.id)
                } else {
                    format!("pet:label:{index}")
                };
                menu.append(
                    &MenuItem::with_id(&app, id, &entry.label, entry.enabled, None::<&str>)
                        .map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
            }
        }
        let win = app.get_webview_window("pet").ok_or("桌宠窗口不可用")?;
        *app.state::<PetState>().menu.lock_ok() = Some(menu.clone());
        menu.popup(win.as_ref().window())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Clamp and snap in physical coordinates; negative monitor origins are valid.
pub fn fit_rect(
    pos: (i32, i32),
    size: (i32, i32),
    area: (i32, i32, i32, i32),
    threshold: i32,
) -> (i32, i32) {
    let (left, top, width, height) = area;
    let right = (left + width - size.0).max(left);
    let bottom = (top + height - size.1).max(top);
    let (mut x, mut y) = (pos.0.clamp(left, right), pos.1.clamp(top, bottom));
    if x - left <= threshold {
        x = left;
    } else if right - x <= threshold {
        x = right;
    }
    if y - top <= threshold {
        y = top;
    } else if bottom - y <= threshold {
        y = bottom;
    }
    (x, y)
}

pub fn fit_window(app: &AppHandle, reset: bool) -> Result<(), String> {
    let prefs = app.state::<PetState>().prefs.lock_ok().clone();
    let factor = f64::from(prefs.scale) / 100.0;
    #[cfg(target_os = "windows")]
    let pos = crate::native_pet::position(app);
    #[cfg(not(target_os = "windows"))]
    let pos = app
        .get_webview_window("pet")
        .and_then(|w| w.outer_position().ok())
        .map(|p| (p.x, p.y));
    let Some(pos) = pos else { return Ok(()) };
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let monitor = if reset {
        app.primary_monitor().map_err(|e| e.to_string())?
    } else {
        monitors.into_iter().min_by_key(|m| {
            let (x, y, w, h) = crate::monitor_usable_rect(m);
            let dx = i64::from(pos.0) - i64::from(pos.0.clamp(x, x + w));
            let dy = i64::from(pos.1) - i64::from(pos.1.clamp(y, y + h));
            dx * dx + dy * dy
        })
    };
    let Some(monitor) = monitor else {
        return Ok(());
    };
    let area = crate::monitor_usable_rect(&monitor);
    let dpi = monitor.scale_factor();
    let size = (
        (crate::PET_W * factor * dpi).round() as i32,
        (crate::PET_H * factor * dpi).round() as i32,
    );
    let pos = if reset {
        (
            area.0 + area.2 - size.0 - (24.0 * dpi) as i32,
            area.1 + area.3 - size.1 - (24.0 * dpi) as i32,
        )
    } else {
        pos
    };
    let (x, y) = fit_rect(
        pos,
        size,
        area,
        if prefs.snap && !reset {
            (20.0 * dpi) as i32
        } else {
            0
        },
    );
    #[cfg(target_os = "windows")]
    crate::native_pet::set_geometry(app, x, y, size.0, size.1)?;
    #[cfg(not(target_os = "windows"))]
    if let Some(win) = app.get_webview_window("pet") {
        let logical = tauri::LogicalSize::new(crate::PET_W * factor, crate::PET_H * factor);
        win.set_min_size(None::<tauri::LogicalSize<f64>>)
            .map_err(|e| e.to_string())?;
        win.set_max_size(None::<tauri::LogicalSize<f64>>)
            .map_err(|e| e.to_string())?;
        win.set_size(logical).map_err(|e| e.to_string())?;
        win.set_min_size(Some(logical)).map_err(|e| e.to_string())?;
        win.set_max_size(Some(logical)).map_err(|e| e.to_string())?;
        win.set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    *app.state::<crate::PetPos>().0.lock_ok() = Some((x, y));
    config::update_config_json(app, |cfg| cfg.pet_pos = Some((x, y)))?;
    Ok(())
}

#[tauri::command]
pub fn pet_drag_finished(app: AppHandle) -> Result<(), String> {
    fit_window(&app, false)
}

#[tauri::command]
pub fn pet_reset_position(app: AppHandle) -> Result<(), String> {
    fit_window(&app, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_sound_patch_preserves_other_preferences() {
        let p = patched(
            &Preferences::default(),
            json!({"sounds":{"question":{"volume":35}}}),
        )
        .unwrap();
        assert_eq!(p.sounds.question.volume, 35);
        assert!(p.sounds.question.enabled);
        assert_eq!(p.sounds.end.volume, 70);
        assert!(patched(&p, json!({"scale":0})).is_err());
        assert!(patched(&p, json!({"quota_critical":30})).is_err());
        assert!(patched(&p, json!({"api_key":"no"})).is_err());
    }
    #[test]
    fn existing_sound_settings_gain_touch_sounds_without_overwriting_mutes() {
        let p: Preferences =
            serde_json::from_value(json!({"sounds":{"end":{"enabled":false,"volume":25}}}))
                .unwrap();
        assert!(p.sounds.press.enabled);
        assert!(p.sounds.release.enabled);
        assert!(!p.sounds.end.enabled);
        assert_eq!(p.sounds.end.volume, 25);
        let next = patched(
            &p,
            json!({"sounds":{"press":{"volume":40},"release":{"enabled":false}}}),
        )
        .unwrap();
        assert_eq!(next.sounds.press.volume, 40);
        assert!(!next.sounds.release.enabled);
        assert!(!next.sounds.end.enabled);
    }
    #[test]
    fn snaps_inside_work_area_and_supports_negative_origins() {
        assert_eq!(
            fit_rect((-1910, 110), (116, 120), (-1920, 0, 1920, 1040), 20),
            (-1920, 110)
        );
        assert_eq!(
            fit_rect((1810, 1000), (174, 180), (0, 0, 1920, 1040), 20),
            (1746, 860)
        );
        assert_eq!(
            fit_rect((500, 400), (116, 120), (0, 0, 1920, 1040), 20),
            (500, 400)
        );
    }
    #[test]
    fn missing_wallet_fields_are_unknown_not_zero() {
        assert_eq!(finite_field(&json!({}), "balance"), None);
        assert_eq!(finite_field(&json!({"balance":0}), "balance"), Some(0.0));
    }
    #[test]
    fn account_identity_is_stable_and_isolated_by_server() {
        let scope = account_scope("https://a.example", &json!({"id":42,"email":"old"}));
        assert_eq!(
            scope,
            account_scope("https://a.example", &json!({"id":42,"email":"new"}))
        );
        assert_ne!(scope, account_scope("https://a.example", &json!({"id":43})));
        assert_ne!(scope, account_scope("https://b.example", &json!({"id":42})));
        assert_eq!(account_scope("https://a.example", &json!({})), "");
    }
}
