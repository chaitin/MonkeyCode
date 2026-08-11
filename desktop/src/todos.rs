// 待办清单(UI 待办覆盖视图)的落盘:config_dir/todos.json。
//
// 语义:**全量替换**(与 Agent 的 TodoWrite 同口径)——UI 是唯一写者,变更
// 时带完整快照来存,壳不做逐条 patch,也不解释业务字段(status/派发去向的
// 含义都在 UI 层)。写盘走 config.rs::atomic_write_private(同目录临时文件
// 原子替换),损坏的主文件在 load 时**如实报错**而不是静默回空表:空表会被
// 下一次变更的全量落盘覆盖,用户的清单就真没了。
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::config::{atomic_write_private, config_dir};
use crate::util::LockExt;

/// 进程内读改写串行锁(ConfigStore 同款形态;快照小、事务短,不与引擎相干)。
pub struct TodosStore(Mutex<()>);

impl TodosStore {
    pub fn new() -> Self {
        Self(Mutex::new(()))
    }
}

/// 字段形状 = UI 侧 lib/ipc/todos.ts 的线上契约。壳只存不读,未知字段也要
/// 原样保留(flatten extra):将来 UI 加字段不用动壳,旧壳也不吞新数据。
#[derive(Serialize, Deserialize, Clone)]
pub struct TodoItem {
    pub id: String,
    pub content: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dispatched_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dispatched_id: Option<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

fn todos_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("todos.json"))
}

#[tauri::command]
pub fn todos_load(app: AppHandle, store: tauri::State<'_, TodosStore>) -> Result<Vec<TodoItem>, String> {
    let _guard = store.0.lock_ok();
    let path = todos_path(&app)?;
    let data = match fs::read(&path) {
        Ok(data) => data,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("读取待办文件 {} 失败: {e}", path.display())),
    };
    serde_json::from_slice(&data).map_err(|e| format!("待办文件 {} 损坏: {e}", path.display()))
}

#[tauri::command]
pub fn todos_save(
    app: AppHandle,
    store: tauri::State<'_, TodosStore>,
    items: Vec<TodoItem>,
) -> Result<(), String> {
    let _guard = store.0.lock_ok();
    let path = todos_path(&app)?;
    let data = serde_json::to_vec_pretty(&items).map_err(|e| format!("序列化待办失败: {e}"))?;
    atomic_write_private(&path, &data)
}
