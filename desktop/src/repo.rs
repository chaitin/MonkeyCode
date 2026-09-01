// 工作区只读文件浏览与 diff 查询(agent/internal/repo 的 Rust 移植)。
// 应答字段与内核 WS call 完全对齐:{result} / {error},UI 归约层零改动。
// 全部操作强制限定在工作区目录内。
//
// WSL 模式(kernel_env = "wsl:<发行版>"):workdir 是 guest 内 Linux 路径。
// WSL 文件系统路径经 \\wsl$ UNC 访问，automount 盘符路径(/mnt/c/…)
// 反解回 C:\…；git 经 wsl.exe 在 guest 内执行(UNC 上跑 Windows git 会撞
// ownership 校验且行尾语义不对)。

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde_json::{json, Value};

const MAX_FILE_BYTES: u64 = 1 << 20; // 单文件读取上限 1MB
const MAX_LIST_ITEMS: usize = 2000;
const MAX_PREVIEW_FILES: usize = 500;
const MAX_PREVIEW_SCAN_ENTRIES: usize = 20_000;
const MAX_PREVIEW_SCAN_DIRS: usize = 2_000;
const MAX_PREVIEW_SCAN_DEPTH: usize = 12;

fn preview_kind(path: &Path) -> Option<(&'static str, &'static str)> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "html" | "htm" => ("html", "text/html"),
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "gif" => ("image", "image/gif"),
        "webp" => ("image", "image/webp"),
        "bmp" => ("image", "image/bmp"),
        "svg" => ("image", "image/svg+xml"),
        "avif" => ("image", "image/avif"),
        "txt" | "md" | "markdown" | "css" | "scss" | "less" | "js" | "mjs" | "cjs" | "jsx"
        | "ts" | "tsx" | "json" | "yaml" | "yml" | "toml" | "xml" | "csv" | "rs" | "go" | "py"
        | "rb" | "java" | "kt" | "c" | "h" | "cpp" | "hpp" | "sh" | "zsh" | "fish" | "sql"
        | "vue" | "svelte" => ("text", "text/plain"),
        _ => return None,
    })
}

/// 一次 repo 查询的执行环境。
pub struct RepoCtx {
    /// 工作区绝对路径(WSL 模式下是 guest 内 Linux 路径)
    pub workdir: String,
    /// WSL 发行版(仅 Windows + kernel_env=wsl:* 时 Some)
    pub wsl_distro: Option<String>,
    /// WSL automount 根(通常 /mnt，允许 wsl.conf 自定义)。
    pub wsl_mount_root: Option<String>,
}

impl RepoCtx {
    /// 本地文件系统视角的工作区根(WSL 文件系统转 UNC，盘符挂载转宿主盘符)。
    fn fs_root(&self) -> PathBuf {
        match (&self.wsl_distro, &self.wsl_mount_root) {
            (Some(distro), Some(mount_root)) => {
                crate::wsl::host_fs_view_with_mount_root(distro, mount_root, &self.workdir)
            }
            (Some(distro), None) => crate::wsl::host_fs_view(distro, &self.workdir),
            (None, _) => PathBuf::from(&self.workdir),
        }
    }

    /// 解析相对路径并防目录穿越;返回本地 fs 视角的绝对路径。
    fn resolve(&self, rel: &str) -> Result<PathBuf, String> {
        // 第一道:归一化组件级校验,拒绝绝对路径与任何 .. 成分。
        // 目标可能尚不存在(file_diff 要为已删除文件出 diff),所以这一道
        // 不能依赖 canonicalize。
        let p = Path::new(rel);
        if p.is_absolute()
            || p.components().any(|c| {
                matches!(
                    c,
                    std::path::Component::ParentDir | std::path::Component::Prefix(_)
                )
            })
        {
            return Err(format!("路径 {rel} 超出工作区"));
        }
        // join("") 会补一个尾分隔符(C:\proj → C:\proj\):工作区根(rel = "")
        // 正走这条,而带尾分隔符的路径交给 Windows 的 shell 解析会失败,表现是
        // 侧栏「打开文件夹」开到默认位置(2026-08-08 用户报障)。空 rel 直接用根。
        // 另:相对路径按内核协议一律 `/` 拼(list_files 出的就是),Windows 上
        // join 完会留下混合分隔符(C:\proj\src/a.ts);按 components 重组归一到
        // 平台分隔符——交给 shell API / 文件管理器的路径必须是规范形态
        let joined: PathBuf = if rel.is_empty() {
            self.fs_root()
        } else {
            self.fs_root().join(rel).components().collect()
        };
        // 第二道:符号链接不受组件校验约束——工作区里一个指向外部的链接就能
        // 把这套"只读浏览"带出工作区(link/passwd 之类)。路径已存在时做一次
        // 实解析边界校验,标准与 uploads.rs::read_data_url 对齐;不存在时留给
        // 调用方按"文件不存在"失败即可。
        if joined.exists() {
            let root = std::fs::canonicalize(self.fs_root())
                .map_err(|e| format!("工作区路径无效: {e}"))?;
            let real =
                std::fs::canonicalize(&joined).map_err(|e| format!("路径 {rel} 解析失败: {e}"))?;
            if !real.starts_with(&root) {
                return Err(format!("路径 {rel} 超出工作区"));
            }
        }
        Ok(joined)
    }

    /// 在工作区内执行 git 的唯一通道(WSL 模式经 wsl.exe 在 guest 内跑)。
    /// allow_fail:非零退出码不视为错误,只取 stdout(diff --no-index 有
    /// 差异时退出码为 1 这类"正常失败")。
    fn run_git(&self, args: &[&str], allow_fail: bool) -> Result<String, String> {
        let mut cmd = match &self.wsl_distro {
            Some(d) => {
                let mut c = Command::new(crate::wsl::wsl_exe());
                c.args(["-d", d, "--cd", &self.workdir, "--exec", "git"])
                    .args(args);
                c
            }
            None => {
                let mut c = Command::new("git");
                c.current_dir(&self.workdir).args(args);
                c
            }
        };
        crate::wsl::no_console(&mut cmd); // Windows 下每次文件树/diff 查询不闪黑窗
        let out = cmd.output().map_err(|e| format!("git 执行失败: {e}"))?;
        if !allow_fail && !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn git(&self, args: &[&str]) -> Result<String, String> {
        self.run_git(args, false)
    }

    fn git_allow_fail(&self, args: &[&str]) -> String {
        // spawn 失败也吞掉返回空:调用方(未跟踪文件 diff)按无差异降级
        self.run_git(args, true).unwrap_or_default()
    }

    fn is_git_repo(&self) -> bool {
        self.git(&["rev-parse", "--is-inside-work-tree"])
            .map(|s| s.trim() == "true")
            .unwrap_or(false)
    }
}

/// 统一入口:kind 分派,返回 {result} 或 {error}(与内核 call-response 载荷同构)。
pub fn dispatch(ctx: &RepoCtx, kind: &str, payload: &Value) -> Value {
    let path = payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
    if kind == "repo_file_changes" {
        return match file_changes(ctx) {
            Ok((changes, is_git_repo)) => {
                json!({ "result": changes, "is_git_repo": is_git_repo })
            }
            Err(e) => json!({ "error": e }),
        };
    }
    let r = match kind {
        "repo_file_list" => list_files(ctx, path),
        "repo_read_file" => read_file(ctx, path),
        "repo_preview_files" => preview_files(ctx),
        "repo_artifact_read" => artifact_read(ctx, path),
        "repo_file_diff" => file_diff(ctx, path),
        "repo_reveal" => reveal(ctx, path),
        _ => Err(format!("未知 call kind: {kind}")),
    };
    match r {
        Ok(v) => json!({ "result": v }),
        Err(e) => json!({ "error": e }),
    }
}

/// 列出目录内容(单层,非递归)。dir 为空表示工作区根。目录在前,再按名排序。
fn list_files(ctx: &RepoCtx, dir: &str) -> Result<Value, String> {
    let target = ctx.resolve(dir)?;
    let mut out: Vec<(bool, String, u64)> = Vec::new();
    match std::fs::read_dir(&target) {
        Ok(items) => {
            for it in items.flatten() {
                let name = it.file_name().to_string_lossy().into_owned();
                if name == ".git" {
                    continue;
                }
                let Ok(md) = it.metadata() else { continue };
                out.push((md.is_dir(), name, md.len()));
                if out.len() >= MAX_LIST_ITEMS {
                    break;
                }
            }
        }
        Err(host_error) if ctx.wsl_distro.is_some() => {
            out = list_files_in_wsl(ctx, dir).map_err(|wsl_error| {
                format!(
                    "读取目录失败({}): {host_error}; WSL 读取也失败: {wsl_error}",
                    target.display()
                )
            })?;
        }
        Err(error) => return Err(format!("读取目录失败({}): {error}", target.display())),
    }
    out.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let base = if dir.is_empty() {
        String::new()
    } else {
        format!("{}/", dir.trim_end_matches('/'))
    };
    let entries: Vec<Value> = out
        .into_iter()
        .map(|(is_dir, name, size)| {
            json!({ "name": name, "path": format!("{base}{name}"), "is_dir": is_dir, "size": size })
        })
        .collect();
    Ok(Value::Array(entries))
}

/// Windows 无法读取某些 WSL/DrvFs 路径时，在对应发行版内读取单层目录。
/// readlink -f 同时把符号链接收敛成真实路径，case 守住 workdir 边界；find
/// 用 NUL 分隔三元组，文件名中的空格、换行、引号和反斜杠都不会破坏协议。
fn list_files_in_wsl(ctx: &RepoCtx, dir: &str) -> Result<Vec<(bool, String, u64)>, String> {
    let distro = ctx.wsl_distro.as_deref().ok_or("缺少 WSL 发行版")?;
    let target = if dir.is_empty() {
        ctx.workdir.clone()
    } else {
        format!(
            "{}/{}",
            ctx.workdir.trim_end_matches('/'),
            dir.replace('\\', "/")
        )
    };
    let script = format!(
        r#"set -eu
root=$(readlink -f -- "$1")
target=$(readlink -f -- "$2")
if [ "$target" != "$root" ]; then
  case "$target" in "$root"/*) ;; *) echo '路径超出工作区' >&2; exit 13 ;; esac
fi
find "$target" -mindepth 1 -maxdepth 1 -printf '%f\0%y\0%s\0' | head -z -n {}"#,
        MAX_LIST_ITEMS * 3
    );
    let args = vec![
        "-d".into(),
        distro.into(),
        "--exec".into(),
        "/bin/sh".into(),
        "-c".into(),
        script,
        "monkeycode-repo-list".into(),
        ctx.workdir.clone(),
        target,
    ];
    let output = crate::wsl::run_wsl_bytes(&args, Duration::from_secs(10))?;
    parse_wsl_directory_entries(&output)
}

fn parse_wsl_directory_entries(data: &[u8]) -> Result<Vec<(bool, String, u64)>, String> {
    let mut fields = data.split(|byte| *byte == 0);
    let mut entries = Vec::new();
    loop {
        let Some(name) = fields.next() else { break };
        if name.is_empty() {
            break;
        }
        let kind = fields.next().ok_or("WSL 目录响应缺少类型")?;
        let size = fields.next().ok_or("WSL 目录响应缺少大小")?;
        let name = String::from_utf8_lossy(name).into_owned();
        if name == ".git" {
            continue;
        }
        let size = std::str::from_utf8(size)
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or("WSL 目录响应大小无效")?;
        entries.push((kind == b"d", name, size));
        if entries.len() >= MAX_LIST_ITEMS {
            break;
        }
    }
    Ok(entries)
}

fn preview_files(ctx: &RepoCtx) -> Result<Value, String> {
    const SKIP: &[&str] = &[".git", "node_modules", "target", "vendor", ".venv", "venv"];
    let root = ctx.resolve("")?;
    let mut pending = vec![(root, String::new(), 0usize)];
    let mut files = Vec::new();
    let mut scanned = 0usize;
    let mut scanned_dirs = 0usize;
    let mut truncated = false;
    while let Some((dir, base, depth)) = pending.pop() {
        scanned_dirs += 1;
        if scanned_dirs > MAX_PREVIEW_SCAN_DIRS {
            truncated = true;
            break;
        }
        let entries = std::fs::read_dir(dir).map_err(|e| format!("扫描预览文件失败: {e}"))?;
        for entry in entries.flatten() {
            scanned += 1;
            if scanned > MAX_PREVIEW_SCAN_ENTRIES {
                truncated = true;
                break;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if SKIP.contains(&name.as_str()) {
                continue;
            }
            let Ok(md) = std::fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if md.file_type().is_symlink() {
                continue;
            }
            let rel = if base.is_empty() {
                name
            } else {
                format!("{base}/{name}")
            };
            if md.is_dir() {
                if depth < MAX_PREVIEW_SCAN_DEPTH {
                    pending.push((entry.path(), rel, depth + 1));
                } else {
                    truncated = true;
                }
                continue;
            }
            if let Some((kind, mime)) = preview_kind(&entry.path()) {
                files.push(json!({ "path": rel, "kind": kind, "mime": mime, "size": md.len() }));
                if files.len() >= MAX_PREVIEW_FILES {
                    truncated = true;
                    break;
                }
            }
        }
        if truncated {
            break;
        }
    }
    files.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
    Ok(json!({ "files": files, "truncated": truncated }))
}

fn reject_artifact_symlink(ctx: &RepoCtx, rel: &str) -> Result<(), String> {
    let mut current = ctx.fs_root();
    for component in Path::new(rel).components() {
        current.push(component.as_os_str());
        if std::fs::symlink_metadata(&current)
            .map_err(|e| format!("读取失败: {e}"))?
            .file_type()
            .is_symlink()
        {
            return Err("工作区预览不允许符号链接".into());
        }
    }
    Ok(())
}

fn artifact_read(ctx: &RepoCtx, rel: &str) -> Result<Value, String> {
    let p = ctx.resolve(rel)?;
    reject_artifact_symlink(ctx, rel)?;
    let md = std::fs::metadata(&p).map_err(|e| format!("读取失败: {e}"))?;
    if !md.is_file() {
        return Err(format!("{rel} 不是文件"));
    }
    let (kind, mime) = preview_kind(&p).ok_or("不支持的预览文件类型")?;
    match kind {
        "html" => Ok(json!({ "path": rel, "kind": kind, "mime": mime,
            "content": crate::uploads::read_workspace_html_bundle(&ctx.workdir, ctx.wsl_distro.as_deref(), rel)? })),
        "image" => Ok(json!({ "path": rel, "kind": kind, "mime": mime,
            "data_url": crate::uploads::read_data_url(&ctx.workdir, ctx.wsl_distro.as_deref(), rel)? })),
        _ => {
            if md.len() > MAX_FILE_BYTES {
                return Err(format!(
                    "文件过大({} 字节),超过 {} 上限",
                    md.len(),
                    MAX_FILE_BYTES
                ));
            }
            let bytes = std::fs::read(&p).map_err(|e| format!("读取失败: {e}"))?;
            let content =
                String::from_utf8(bytes).map_err(|_| "文本预览文件必须是 UTF-8".to_string())?;
            Ok(json!({ "path": rel, "kind": kind, "mime": mime, "content": content }))
        }
    }
}

/// 读取文件内容(1MB 上限)。
fn read_file(ctx: &RepoCtx, rel: &str) -> Result<Value, String> {
    let p = ctx.resolve(rel)?;
    let md = std::fs::metadata(&p).map_err(|e| format!("读取失败: {e}"))?;
    if md.is_dir() {
        return Err(format!("{rel} 是目录"));
    }
    if md.len() > MAX_FILE_BYTES {
        return Err(format!(
            "文件过大({} 字节),超过 {} 上限",
            md.len(),
            MAX_FILE_BYTES
        ));
    }
    let data = std::fs::read(&p).map_err(|e| format!("读取失败: {e}"))?;
    Ok(json!({ "path": rel, "content": String::from_utf8_lossy(&data) }))
}

/// `git status --porcelain=v1 -z` 的路径以 NUL 分隔且不做 C 引号转义。
/// rename/copy 的**目标路径在前、源路径在后**；消费第二个字段即可，不再
/// 从文件名中搜索含歧义的 ` -> `。
fn parse_status_porcelain_z(out: &str, prefix: &str) -> Vec<(String, &'static str)> {
    let mut records = out.split('\0');
    let mut changes = Vec::new();
    while let Some(record) = records.next() {
        if record.len() < 4 {
            continue;
        }
        let code = &record[..2];
        let mut path = record[3..].to_string();
        if code.contains('R') || code.contains('C') {
            // -z 的 rename/copy 额外跟一个 NUL 字段（源路径）。目标路径已经
            // 在当前 record 中，源路径只需消费，不能当成下一条状态记录。
            let _source = records.next();
        }
        if !prefix.is_empty() {
            match path.strip_prefix(prefix) {
                Some(relative) => path = relative.to_string(),
                None => continue,
            }
        }
        let status = if code.contains('?') || code.contains('A') {
            "A"
        } else if code.contains('D') {
            "D"
        } else {
            "M"
        };
        changes.push((path, status));
    }
    changes
}

/// 相对 HEAD 的变更列表(含未跟踪文件)，同时返回工作区是否属于 git 仓库。
/// 路径统一为相对 workdir(porcelain 输出仓库根相对路径,须剥前缀);
/// 使用 NUL 模式保留空格、换行、引号、反斜杠和 ` -> ` 等合法文件名。
fn file_changes(ctx: &RepoCtx) -> Result<(Value, bool), String> {
    let is_git_repo = ctx.is_git_repo();
    if !is_git_repo {
        return Ok((Value::Array(vec![]), false));
    }
    let prefix = ctx
        .git(&["rev-parse", "--show-prefix"])
        .unwrap_or_default()
        .trim_end_matches(['\r', '\n'])
        .to_string();
    let out = ctx
        .git(&[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            ".",
        ])
        .unwrap_or_default();
    let mut changes = parse_status_porcelain_z(&out, &prefix);
    changes.sort_by(|a, b| a.0.cmp(&b.0));
    Ok((
        Value::Array(
            changes
                .into_iter()
                .map(|(p, s)| json!({ "path": p, "status": s }))
                .collect(),
        ),
        true,
    ))
}

/// 单个文件相对 HEAD 的 unified diff。未跟踪文件构造为全新增 diff。
fn file_diff(ctx: &RepoCtx, rel: &str) -> Result<Value, String> {
    ctx.resolve(rel)?;
    if !ctx.is_git_repo() {
        return Err("非 git 仓库,无法生成 diff".into());
    }
    // 已跟踪文件:直接 diff HEAD(rel 为 workdir 相对,与 file_changes 一致)
    if let Ok(out) = ctx.git(&["-c", "core.quotepath=false", "diff", "HEAD", "--", rel]) {
        if !out.trim().is_empty() {
            return Ok(json!({ "path": rel, "diff": out }));
        }
    }
    // 未跟踪文件:git diff --no-index 生成新增 diff
    let untracked = ctx
        .git(&["ls-files", "--others", "--exclude-standard", "--", rel])
        .unwrap_or_default();
    if !untracked.trim().is_empty() {
        // guest 内跑 git 时 null 设备始终是 /dev/null;仅本机 Windows 用 NUL
        let null_dev = if ctx.wsl_distro.is_none() && cfg!(windows) {
            "NUL"
        } else {
            "/dev/null"
        };
        let d = ctx.git_allow_fail(&[
            "-c",
            "core.quotepath=false",
            "diff",
            "--no-index",
            "--",
            null_dev,
            rel,
        ]);
        return Ok(json!({ "path": rel, "diff": d }));
    }
    Ok(json!({ "path": rel, "diff": "" }))
}

/// 在系统文件管理器中定位路径:目录直接打开,文件在父目录中选中。
///
/// 一律走 tauri_plugin_opener(与壳内其它「打开/定位」同一机制,见
/// main.rs 的 open_log_dir/open_app_dir),不再自己拼 explorer 命令行。
/// explorer.exe 的失败方式是**静默开默认文件夹**(不报错、不退非零码),
/// 只要参数它没看懂就是这个结果——2026-08-08 用户报障「侧栏点打开文件夹,
/// 开出来是文档/此电脑」就是这么来的(直接诱因见 resolve 里的尾分隔符)。
/// 而经命令行喂它本身就不稳:Rust 按 CommandLineToArgvW 规则转义(带空格
/// 加引号、引号前的反斜杠翻倍),explorer 用的却是自己那套解析,两边对不上;
/// 目录名形如 /e、/select,… 时参数还会被当成 explorer 的选项。插件那边:
/// 目录走 PowerShell Start-Process(路径经环境变量传,根本不过命令行),
/// 文件走 SHOpenFolderAndSelectItems(shell API,同样不过命令行),整类
/// 转义/引号问题随之消失,顺带 mac/Linux 也不用各留一条分支。
///
/// WSL 模式的文件是唯一例外:路径是 \\wsl$ UNC,select 在那上面定位不到
/// (见 16dfce86),退回打开所在目录——少一个选中高亮,但位置是对的。
fn reveal(ctx: &RepoCtx, rel: &str) -> Result<Value, String> {
    let p = ctx.resolve(rel)?;
    let md = std::fs::metadata(&p).map_err(|e| format!("路径不存在: {e}"))?;
    let open_dir = if md.is_dir() {
        Some(p.clone())
    } else if ctx.wsl_distro.is_some() {
        Some(
            p.parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| p.clone()),
        )
    } else {
        None
    };
    match open_dir {
        Some(dir) => tauri_plugin_opener::open_path(&dir, None::<&str>)
            .map_err(|e| format!("打开文件管理器失败: {e}"))?,
        None => {
            tauri_plugin_opener::reveal_item_in_dir(&p).map_err(|e| format!("定位文件失败: {e}"))?
        }
    }
    Ok(json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wsl_directory_protocol_preserves_special_names_and_filters_git() {
        let data = b"src\0d\04096\0line one\nline two.txt\0f\012\0.git\0d\04096\0";
        assert_eq!(
            parse_wsl_directory_entries(data).unwrap(),
            vec![
                (true, "src".into(), 4096),
                (false, "line one\nline two.txt".into(), 12),
            ]
        );
        assert!(parse_wsl_directory_entries(b"name\0f\0bad\0").is_err());
        assert!(parse_wsl_directory_entries(b"name\0").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn wsl_automount_workspace_uses_the_host_drive() {
        let ctx = RepoCtx {
            workdir: "/mnt/c/Users/chaitin/project".into(),
            wsl_distro: Some("Ubuntu".into()),
            wsl_mount_root: Some("/mnt".into()),
        };
        assert_eq!(ctx.fs_root(), PathBuf::from(r"C:\Users\chaitin\project"));
    }

    #[test]
    fn porcelain_z_rename_does_not_parse_arrow_inside_source_name() {
        let parsed = parse_status_porcelain_z(
            "R  nested/new.txt\0nested/old -> name.txt\0?? nested/a -> b.txt\0",
            "nested/",
        );
        assert_eq!(
            parsed,
            vec![
                ("new.txt".to_string(), "M"),
                ("a -> b.txt".to_string(), "A")
            ]
        );
    }

    /// 组件级校验挡不住符号链接:工作区内一条指向外部的链接,足以让只读
    /// 文件浏览读到工作区外的文件。与 uploads.rs::read_data_url 同标准,
    /// 已存在的路径要做实解析边界校验。
    #[cfg(unix)]
    #[test]
    fn resolve_rejects_symlinks_that_point_outside_the_workspace() {
        use std::os::unix::fs::symlink;

        let base = std::env::temp_dir().join(format!("mc-repo-symlink-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let ws = base.join("workspace");
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::write(base.join("secret.txt"), b"outside").unwrap();
        std::fs::create_dir_all(base.join("outside-dir")).unwrap();
        std::fs::write(ws.join("inside.txt"), b"inside").unwrap();
        symlink(base.join("secret.txt"), ws.join("leak.txt")).unwrap();
        symlink(base.join("outside-dir"), ws.join("leak-dir")).unwrap();
        symlink(ws.join("inside.txt"), ws.join("ok-link.txt")).unwrap();

        let ctx = RepoCtx {
            workdir: ws.to_string_lossy().into_owned(),
            wsl_distro: None,
            wsl_mount_root: None,
        };

        assert!(
            ctx.resolve("leak.txt").is_err(),
            "指向外部文件的链接应被拒绝"
        );
        assert!(
            ctx.resolve("leak-dir").is_err(),
            "指向外部目录的链接应被拒绝"
        );
        // 读文件与列目录是实际出口,必须一起挡住
        assert!(read_file(&ctx, "leak.txt").is_err());
        assert!(list_files(&ctx, "leak-dir").is_err());
        // 工作区内的链接与普通文件照常可用,不能误伤
        assert!(
            ctx.resolve("ok-link.txt").is_ok(),
            "工作区内的链接不该被误挡"
        );
        assert!(read_file(&ctx, "inside.txt").is_ok());
        // 尚不存在的路径仍按组件校验放行(file_diff 要为已删除文件出 diff)
        assert!(ctx.resolve("not-created-yet.txt").is_ok());
        assert!(ctx.resolve("../escape").is_err());

        let _ = std::fs::remove_dir_all(&base);
    }

    /// 工作区根(rel = "")解析出的路径不许带尾分隔符:`join("")` 会补一个,
    /// 而带尾分隔符的路径交给 Windows 的 shell 解析会失败——explorer 认不出
    /// 就不报错直接开默认文件夹,现象是侧栏「打开文件夹」开到了「文档/此电脑」
    /// (2026-08-08 用户报障)。只有根这条会踩(文件路径不以分隔符结尾),
    /// 所以必须单独钉住。
    #[test]
    fn resolve_root_has_no_trailing_separator() {
        let dir = std::env::temp_dir().join(format!("mc-repo-root-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ctx = RepoCtx {
            workdir: dir.to_string_lossy().into_owned(),
            wsl_distro: None,
            wsl_mount_root: None,
        };

        let root = ctx.resolve("").unwrap();
        assert_eq!(root, dir, "根路径应恒等于工作区,不多一个尾分隔符");
        let s = root.to_string_lossy();
        assert!(
            !s.ends_with(std::path::MAIN_SEPARATOR) && !s.ends_with('/'),
            "根路径不该以分隔符结尾: {s}"
        );

        // 相对路径按 `/` 拼进来(内核协议口径),解析后归一到平台分隔符:
        // 混合分隔符的路径喂给 shell API / 文件管理器同样定位不到
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/a.ts"), b"x").unwrap();
        assert_eq!(
            ctx.resolve("src/a.ts").unwrap(),
            dir.join("src").join("a.ts")
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn preview_scan_and_artifact_read_are_bounded_and_typed() {
        let dir = std::env::temp_dir().join(format!("mc-preview-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("site/assets")).unwrap();
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::create_dir_all(dir.join("dist")).unwrap();
        std::fs::create_dir_all(dir.join("build")).unwrap();
        std::fs::write(
            dir.join("site/index.html"),
            "<link rel=\"stylesheet\" href=\"assets/a.css\">",
        )
        .unwrap();
        std::fs::write(dir.join("site/assets/a.css"), "body{color:red}").unwrap();
        std::fs::write(dir.join("note.txt"), "hello").unwrap();
        std::fs::write(dir.join("node_modules/hidden.html"), "hidden").unwrap();
        std::fs::write(dir.join("dist/index.html"), "dist").unwrap();
        std::fs::write(dir.join("build/index.html"), "build").unwrap();
        let ctx = RepoCtx {
            workdir: dir.to_string_lossy().into_owned(),
            wsl_distro: None,
            wsl_mount_root: None,
        };
        let listed = dispatch(&ctx, "repo_preview_files", &json!({}));
        let paths: Vec<_> = listed["result"]["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v["path"].as_str().unwrap())
            .collect();
        assert!(paths.contains(&"site/index.html"));
        assert!(paths.contains(&"note.txt"));
        assert!(paths.contains(&"dist/index.html"));
        assert!(paths.contains(&"build/index.html"));
        assert!(!paths.contains(&"node_modules/hidden.html"));
        let html = dispatch(
            &ctx,
            "repo_artifact_read",
            &json!({"path":"site/index.html"}),
        );
        assert!(html["result"]["content"]
            .as_str()
            .unwrap()
            .contains("data:text/css;base64,"));
        assert_eq!(
            dispatch(&ctx, "repo_artifact_read", &json!({"path":"note.txt"}))["result"]["content"],
            "hello"
        );
        assert!(
            dispatch(&ctx, "repo_artifact_read", &json!({"path":"../bad.txt"}))["error"]
                .is_string()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn preview_scan_and_read_reject_symlinks() {
        use std::os::unix::fs::symlink;
        let dir = std::env::temp_dir().join(format!("mc-preview-link-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("real.html"), "ok").unwrap();
        symlink(dir.join("real.html"), dir.join("linked.html")).unwrap();
        let ctx = RepoCtx {
            workdir: dir.to_string_lossy().into_owned(),
            wsl_distro: None,
            wsl_mount_root: None,
        };
        let listed = preview_files(&ctx).unwrap();
        assert!(!listed["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["path"] == "linked.html"));
        assert!(artifact_read(&ctx, "linked.html").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changes_response_marks_non_git_workspace() {
        let dir = std::env::temp_dir().join(format!("mc-non-git-changes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let ctx = RepoCtx {
            workdir: dir.to_string_lossy().into_owned(),
            wsl_distro: None,
            wsl_mount_root: None,
        };

        let response = dispatch(&ctx, "repo_file_changes", &json!({}));

        assert_eq!(response["is_git_repo"], false);
        assert_eq!(response["result"], json!([]));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changes_response_marks_git_workspace() {
        let dir = std::env::temp_dir().join(format!("mc-git-changes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let initialized = Command::new("git")
            .args(["init", "-q"])
            .current_dir(&dir)
            .status()
            .unwrap();
        assert!(initialized.success());
        std::fs::write(dir.join("new.txt"), b"new").unwrap();
        let ctx = RepoCtx {
            workdir: dir.to_string_lossy().into_owned(),
            wsl_distro: None,
            wsl_mount_root: None,
        };

        let response = dispatch(&ctx, "repo_file_changes", &json!({}));

        assert_eq!(response["is_git_repo"], true);
        assert_eq!(
            response["result"],
            json!([{ "path": "new.txt", "status": "A" }])
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
