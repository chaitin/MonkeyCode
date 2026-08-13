// 待办清单(UI 待办覆盖视图)的落盘:config_dir/todos.json。
//
// 语义:**全量替换**(与 Agent 的 TodoWrite 同口径)——UI 是唯一写者,变更
// 时带完整快照来存,壳不做逐条 patch,也不解释业务字段(status/派发去向的
// 含义都在 UI 层)。写盘走 config.rs::atomic_write_private(同目录临时文件
// 原子替换),损坏的主文件在 load 时**如实报错**而不是静默回空表:空表会被
// 下一次变更的全量落盘覆盖,用户的清单就真没了。
//
// 图片附件:落 config_dir/todo-uploads/(平铺一层,条目里只存裸文件名)。
// 命令面复刻会话附件那套(uploads.rs)但不绑 sessionId:begin 开句柄后由
// **共用的** upload_chunk/finish/abort 推完内容;路径直拷/回读/删除各一条。
// 回读走 uploads::read_data_url 且 root 钉在 todo-uploads 本目录——canonicalize
// 后前缀校验防 `..`/符号链接越界,且只放行常见图片(待办附件只收图)。
// 文件生命周期归 UI(useTodos):移除图/删待办时逐个 todo_upload_delete;
// UI 崩溃遗留的孤儿文件无害,不做壳侧 GC。
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::config::{atomic_write_private, config_dir};
use crate::uploads;
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
    /// 图片附件:todo-uploads 目录内的裸文件名列表(生命周期归 UI)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
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

// ==================== 图片附件(config_dir/todo-uploads)====================

/// 附件目录(建好再回)。config_dir 不在任何 git 仓库里,不需要工作区通道
/// 那个自免疫 .gitignore。
fn ensured_uploads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?.join("todo-uploads");
    fs::create_dir_all(&dir).map_err(|e| format!("创建待办图片目录失败: {e}"))?;
    Ok(dir)
}

/// 开始分块上传(粘贴的截图等只有内容的来源):句柄进 uploads 的共用表,
/// 后续块走 upload_chunk/finish/abort。rel_prefix 空串 = finish 回裸文件名。
#[tauri::command]
pub async fn todo_upload_begin(app: AppHandle, name: String, media_type: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = ensured_uploads_dir(&app)?;
        let handle = uploads::begin_in_dir(dir, "", &name, &media_type)?;
        Ok(serde_json::json!({ "handle": handle }))
    })
    .await
    .map_err(|e| format!("上传失败: {e}"))?
}

/// 按源路径直拷(系统文件对话框给真实路径):内容零穿越 IPC。返回 {path: 裸文件名}。
#[tauri::command]
pub async fn todo_upload_path(app: AppHandle, src: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = ensured_uploads_dir(&app)?;
        uploads::save_from_path_in_dir(dir, "", &src)
    })
    .await
    .map_err(|e| format!("上传失败: {e}"))?
}

/// 回读图片为 data URL:root 钉在 todo-uploads,canonicalize 防越界,
/// 仅放行常见图片(与会话通道同一套校验)。
#[tauri::command]
pub async fn todo_upload_read(app: AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = ensured_uploads_dir(&app)?;
        uploads::read_data_url(&dir.to_string_lossy(), None, &path)
    })
    .await
    .map_err(|e| format!("读取失败: {e}"))?
}

/// 删除一张图(UI 移除图/删待办时逐个调):名字必须已是清洗后的裸文件名
/// (写入侧保证),不等于原样即拒——不给 `..`/分隔符任何解释空间。缺席视为
/// 已删,幂等。
#[tauri::command]
pub async fn todo_upload_delete(app: AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if uploads::sanitize_name(&path) != Some(path.clone()) {
            return Err("文件名无效".to_string());
        }
        let dir = ensured_uploads_dir(&app)?;
        match fs::remove_file(dir.join(&path)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("删除图片失败: {e}")),
        }
    })
    .await
    .map_err(|e| format!("删除失败: {e}"))?
}

/// 附件目录绝对路径:派发成任务时 UI 用它拼图片的源路径(path-backed File,
/// 建完会话后按路径直拷进会话工作区)。
#[tauri::command]
pub fn todo_uploads_dir(app: AppHandle) -> Result<String, String> {
    Ok(ensured_uploads_dir(&app)?.to_string_lossy().into_owned())
}
