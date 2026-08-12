//! 本地会话 token 用量统计(按天 → 会话 → 模型聚合)。
//!
//! 数据源:引擎每收到一次模型调用的 provider usage 就推一个 `usage` 事件,
//! 壳在 normalize.rs 的 usage 分支里把 `input_tokens`/`output_tokens` 记到这里。
//! 仅统计本机桌面会话,不涉及云端任务。
//!
//! 落盘:`<app_config>/usage-stats.json`,结构:
//! `{ "<YYYY-MM-DD>": { "<session_id>": { "<model>": Record } } }`。
//! 每次 record 全量原子写(文件小,usage 事件按模型调用频次,量级可接受)。

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex as StdMutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::config::atomic_write_private;
use crate::util::LockExt;

/// 保留最近多少天的记录,避免落盘文件无限膨胀。
const KEEP_DAYS: i64 = 366;

/// 某天某会话某模型的累计消耗(合并幂等:同名桶只累加 token 与调用次数)。
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub(super) struct Record {
    pub(super) title: String,
    /// 子代理会话的父会话 id(顶层任务为 None,UI 可据此归并)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) parent: Option<String>,
    pub(super) input_tokens: u64,
    pub(super) output_tokens: u64,
    /// 模型调用次数(即收到的 usage 事件数)
    pub(super) calls: u64,
}

type ModelBuckets = HashMap<String, Record>;
type SessionBuckets = HashMap<String, ModelBuckets>;
type Days = HashMap<String, SessionBuckets>;

pub(super) struct UsageStats {
    path: PathBuf,
    days: StdMutex<Days>,
}

impl UsageStats {
    pub(super) fn new(config_dir: &Path) -> Self {
        let path = config_dir.join("usage-stats.json");
        let days = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<Days>(&s).ok())
            .unwrap_or_default();
        let store = Self { path, days: StdMutex::new(days) };
        store.prune();
        store
    }

    /// 记一条模型调用的 token 消耗(usage 事件里的 input/output 全量累加)。
    pub(super) fn record(
        &self,
        date: &str,
        sid: &str,
        title: &str,
        model: &str,
        parent: Option<&str>,
        input_tokens: u64,
        output_tokens: u64,
    ) {
        if input_tokens == 0 && output_tokens == 0 {
            return;
        }
        let model = if model.is_empty() { "<unknown>" } else { model };
        let mut days = self.days.lock_ok();
        let rec = days
            .entry(date.to_string())
            .or_default()
            .entry(sid.to_string())
            .or_default()
            .entry(model.to_string())
            .or_default();
        if !title.is_empty() {
            rec.title = title.to_string();
        }
        if parent.is_some() {
            rec.parent = parent.map(|p| p.to_string());
        }
        rec.input_tokens += input_tokens;
        rec.output_tokens += output_tokens;
        rec.calls += 1;
        drop(days);
        self.prune();
        self.persist();
    }

    /// 丢掉超过 KEEP_DAYS 的旧天。
    fn prune(&self) {
        let cutoff = today_inner_checked_sub(KEEP_DAYS);
        let mut days = self.days.lock_ok();
        days.retain(|date, _| date.as_str() >= cutoff.as_str());
    }

    /// 全量原子落盘。
    fn persist(&self) {
        let days = self.days.lock_ok();
        let _ = serde_json::to_vec_pretty(&*days)
            .map(|data| atomic_write_private(&self.path, &data));
    }

    /// 聚合快照,供 `usage_stats` IPC 命令返回给 UI。
    /// - totals:全部记录汇总
    /// - days:按天汇总(倒序)
    /// - models:按模型汇总(用量倒序)
    /// - sessions:按会话汇总(用量倒序),每条含 parent 与按天/按模型子拆分
    pub(super) fn snapshot(&self) -> Value {
        let days = self.days.lock_ok();
        let mut totals = (0u64, 0u64, 0u64);
        let mut by_day: BTreeMap<String, (u64, u64, u64)> = BTreeMap::new();
        let mut by_model: BTreeMap<String, (u64, u64, u64)> = BTreeMap::new();
        // sid → (title, parent, total, by_day, by_model)
        let mut by_session: BTreeMap<String, SessionAgg> = BTreeMap::new();

        for (date, sessions) in days.iter() {
            for (sid, models) in sessions.iter() {
                for (model, rec) in models.iter() {
                    totals.0 += rec.input_tokens;
                    totals.1 += rec.output_tokens;
                    totals.2 += rec.calls;

                    let d = by_day.entry(date.clone()).or_default();
                    d.0 += rec.input_tokens;
                    d.1 += rec.output_tokens;
                    d.2 += rec.calls;

                    let m = by_model.entry(model.clone()).or_default();
                    m.0 += rec.input_tokens;
                    m.1 += rec.output_tokens;
                    m.2 += rec.calls;

                    let s = by_session.entry(sid.clone()).or_insert_with(|| SessionAgg {
                        title: rec.title.clone(),
                        parent: rec.parent.clone(),
                        ..Default::default()
                    });
                    if !rec.title.is_empty() {
                        s.title = rec.title.clone();
                    }
                    if rec.parent.is_some() {
                        s.parent = rec.parent.clone();
                    }
                    s.total.0 += rec.input_tokens;
                    s.total.1 += rec.output_tokens;
                    s.total.2 += rec.calls;
                    let d2 = s.by_day.entry(date.clone()).or_default();
                    d2.0 += rec.input_tokens;
                    d2.1 += rec.output_tokens;
                    d2.2 += rec.calls;
                    let m2 = s.by_model.entry(model.clone()).or_default();
                    m2.0 += rec.input_tokens;
                    m2.1 += rec.output_tokens;
                    m2.2 += rec.calls;
                }
            }
        }
        drop(days);

        let sessions_json = {
            let mut rows: Vec<(&String, &SessionAgg)> = by_session.iter().collect();
            rows.sort_by(|a, b| {
                let ta = a.1.total.0 + a.1.total.1;
                let tb = b.1.total.0 + b.1.total.1;
                tb.cmp(&ta).then(a.0.cmp(b.0))
            });
            rows.into_iter().map(|(sid, s)| json!({
                "session_id": sid,
                "title": s.title,
                "parent": s.parent,
                "input_tokens": s.total.0,
                "output_tokens": s.total.1,
                "calls": s.total.2,
                "days": s.by_day.iter().rev().map(|(date, d)| json!({
                    "date": date,
                    "input_tokens": d.0,
                    "output_tokens": d.1,
                    "calls": d.2,
                })).collect::<Vec<_>>(),
                "models": sorted_bucket_json(s.by_model.clone()),
            })).collect::<Vec<_>>()
        };

        json!({
            "totals": bucket_json(totals),
            "days": by_day.iter().rev().map(|(date, d)| json!({
                "date": date,
                "input_tokens": d.0,
                "output_tokens": d.1,
                "calls": d.2,
            })).collect::<Vec<_>>(),
            "models": sorted_bucket_json(by_model),
            "sessions": sessions_json,
        })
    }
}

#[derive(Default)]
struct SessionAgg {
    title: String,
    parent: Option<String>,
    total: (u64, u64, u64),
    by_day: BTreeMap<String, (u64, u64, u64)>,
    by_model: BTreeMap<String, (u64, u64, u64)>,
}

fn bucket_json(b: (u64, u64, u64)) -> Value {
    json!({ "input_tokens": b.0, "output_tokens": b.1, "calls": b.2 })
}

fn sorted_bucket_json(map: BTreeMap<String, (u64, u64, u64)>) -> Vec<Value> {
    let mut rows: Vec<(&String, &(u64, u64, u64))> = map.iter().collect();
    rows.sort_by(|a, b| (b.1).0.cmp(&(a.1).0).then(b.0.cmp(a.0)));
    rows.into_iter()
        .map(|(k, v)| json!({
            "model": k,
            "input_tokens": v.0,
            "output_tokens": v.1,
            "calls": v.2,
        }))
        .collect()
}

/// 本地时区的今天,`YYYY-MM-DD`。取不到本地时区时退回 UTC。
pub(super) fn today() -> String {
    let now = time::OffsetDateTime::now_local().unwrap_or_else(|_| time::OffsetDateTime::now_utc());
    let d = now.date();
    format!("{:04}-{:02}-{:02}", d.year(), d.month() as u8, d.day())
}

/// today() 往前推 n 天(仅用于剪枝,不解析历史日期)。
fn today_inner_checked_sub(days: i64) -> String {
    let now = time::OffsetDateTime::now_local().unwrap_or_else(|_| time::OffsetDateTime::now_utc());
    let d = now.date().checked_sub(time::Duration::days(days)).unwrap_or(now.date());
    format!("{:04}-{:02}-{:02}", d.year(), d.month() as u8, d.day())
}
