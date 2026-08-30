// 本地终端(侧边栏「终端」tab,2026-08-30 用户定案):portable-pty 起系统
// shell,输出经事件 term-data:{id}(base64 分片)推给 UI,进程退出/PTY 关闭
// 发 term-exit:{id}。id 由 UI 生成并**先 listenAsync 再 term_open**(ipc.ts
// 铁律 2「监听先于命令」:Tauri 事件不排队,监听未注册即丢)。
// 生命周期跟随 UI 侧 termStore 的实例(不跟随组件挂载:收侧边栏/切会话
// 不关):term_close(用户关实例页签/删会话)或应用退出才杀 shell
// (master 端随表项 drop 关闭,shell 收 SIGHUP)。
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct TermState(Mutex<HashMap<String, Term>>);

impl Default for TermState {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

struct Term {
    writer: Box<dyn Write + Send>,
    /// master 端必须活到关闭那一刻:drop 即挂断 PTY(shell 收 SIGHUP),
    /// 这正是 term_close/退出清理的实现方式;resize 也走它。
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// 事件名由 id 拼接,id 必须钉死在无歧义字符集(UI 侧是 randomUUID;
/// 防御任意串把事件名/日志搅浑)。
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// 平台缺省 shell:unix 取 $SHELL(登录 shell,GUI 起的进程环境干净,
/// -l 才能吃到用户 rc/PATH);Windows 取 %COMSPEC%(cmd)。
fn default_shell() -> CommandBuilder {
    #[cfg(windows)]
    {
        CommandBuilder::new(std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into()))
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-l");
        cmd
    }
}

fn size(rows: u16, cols: u16) -> PtySize {
    PtySize {
        rows: rows.max(2),
        cols: cols.max(10),
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[tauri::command]
pub async fn term_open(
    app: AppHandle,
    state: State<'_, TermState>,
    id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("终端 id 不合法".into());
    }
    if state.0.lock().unwrap().contains_key(&id) {
        return Err("终端已存在".into());
    }
    let pty = native_pty_system();
    let pair = pty.openpty(size(rows, cols)).map_err(|e| e.to_string())?;
    let mut cmd = default_shell();
    cmd.env("TERM", "xterm-256color");
    // workdir 不在(会话目录被删/WSL 路径本机不可达)退回 home,不硬失败:
    // 终端本身仍有用,只是起点变了
    let cwd = cwd
        .filter(|dir| std::path::Path::new(dir).is_dir())
        .or_else(|| {
            #[cfg(windows)]
            let home = std::env::var("USERPROFILE").ok();
            #[cfg(not(windows))]
            let home = std::env::var("HOME").ok();
            home
        });
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave); // slave 端交给子进程;留着会让 EOF 永不到来
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let killer = child.clone_killer();
    state.0.lock().unwrap().insert(
        id.clone(),
        Term {
            writer,
            master: pair.master,
            killer,
        },
    );

    // 读泵(专用线程,portable-pty 是同步 IO):输出→事件;EOF 后收尸
    // (wait 防僵尸)、表里出栈(与 term_close 幂等)、广播退出
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app.emit(&format!("term-data:{id}"), B64.encode(&buf[..n]));
                }
            }
        }
        let _ = child.wait();
        if let Some(state) = app.try_state::<TermState>() {
            state.0.lock().unwrap().remove(&id);
        }
        let _ = app.emit(&format!("term-exit:{id}"), ());
    });
    Ok(())
}

#[tauri::command]
pub async fn term_write(
    state: State<'_, TermState>,
    id: String,
    data: String,
) -> Result<(), String> {
    let bytes = B64.decode(data).map_err(|e| e.to_string())?;
    let mut terms = state.0.lock().unwrap();
    let term = terms.get_mut(&id).ok_or("终端不存在")?;
    term.writer.write_all(&bytes).map_err(|e| e.to_string())?;
    term.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn term_resize(
    state: State<'_, TermState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let terms = state.0.lock().unwrap();
    let term = terms.get(&id).ok_or("终端不存在")?;
    term.master
        .resize(size(rows, cols))
        .map_err(|e| e.to_string())
}

/// 前台进程名(tab 标题跟随正在跑的命令,2026-08-30 用户需求):查 PTY 的
/// 前台进程组 leader,取其进程名。UI 轮询本命令——默认 zsh/bash 不发 OSC
/// 标题序列,只靠 xterm onTitleChange 大多数用户永远看不到标题变化;shell
/// 自己发 OSC 时 UI 侧以 OSC 为准、停用轮询。Windows ConPTY 无对应查询,
/// 返回 None(tab 保持默认名)。
#[tauri::command]
pub async fn term_title(state: State<'_, TermState>, id: String) -> Result<Option<String>, String> {
    #[cfg(unix)]
    {
        let pid = {
            let terms = state.0.lock().unwrap();
            let term = terms.get(&id).ok_or("终端不存在")?;
            term.master.process_group_leader()
        };
        Ok(pid.and_then(foreground_name))
    }
    #[cfg(not(unix))]
    {
        let _ = (state, id);
        Ok(None)
    }
}

/// 进程名清洗:ps 的 comm 可能是全路径(/bin/zsh)或登录 shell 记号(-zsh)。
#[cfg(any(unix, test))]
fn clean_comm(raw: &str) -> Option<String> {
    let name = raw.trim();
    let name = name.rsplit('/').next().unwrap_or(name);
    let name = name.strip_prefix('-').unwrap_or(name);
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

#[cfg(target_os = "linux")]
fn foreground_name(pid: i32) -> Option<String> {
    clean_comm(&std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?)
}

/// macOS 等无 /proc 的 unix:ps 查 comm(2s 轮询节奏下开销可忽略)。
#[cfg(all(unix, not(target_os = "linux")))]
fn foreground_name(pid: i32) -> Option<String> {
    let out = std::process::Command::new("ps")
        .args(["-o", "comm=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    clean_comm(&String::from_utf8_lossy(&out.stdout))
}

#[tauri::command]
pub async fn term_close(state: State<'_, TermState>, id: String) -> Result<(), String> {
    // 出栈即挂断:master/writer 随表项 drop 关闭,读泵线程见 EOF 自行收尾;
    // kill 兜底(卡死的前台进程不响应 SIGHUP 也要走)。重复关闭幂等。
    let term = state.0.lock().unwrap().remove(&id);
    if let Some(mut term) = term {
        let _ = term.killer.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_charset_is_pinned() {
        assert!(valid_id("a1B-2c"));
        assert!(valid_id(&"a".repeat(64)));
        assert!(!valid_id(""));
        assert!(!valid_id(&"a".repeat(65)));
        // 事件名拼接位:路径/通配/空白一律拒
        for bad in ["a:b", "a/b", "a b", "a*", "α"] {
            assert!(!valid_id(bad), "{bad} 应当被拒");
        }
    }

    #[test]
    fn comm_is_cleaned() {
        assert_eq!(clean_comm("-zsh\n"), Some("zsh".into()));
        assert_eq!(clean_comm("/bin/zsh"), Some("zsh".into()));
        assert_eq!(clean_comm("/usr/local/bin/npm\n"), Some("npm".into()));
        assert_eq!(clean_comm("vim"), Some("vim".into()));
        assert_eq!(clean_comm("  \n"), None);
    }

    /// 真前台进程名回环:PTY 里跑 sleep,term_title 的底层链路应当量出
    /// "sleep"(exec 落定有窗口期,轮询等)。
    #[cfg(unix)]
    #[test]
    fn foreground_name_follows_command() {
        let pty = native_pty_system();
        let pair = pty.openpty(size(24, 80)).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sleep");
        cmd.arg("5");
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut seen = None;
        for _ in 0..40 {
            if let Some(name) = pair.master.process_group_leader().and_then(foreground_name) {
                if name.contains("sleep") {
                    seen = Some(name);
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(seen.as_deref(), Some("sleep"));
    }

    #[test]
    fn size_has_floor() {
        // xterm 首帧可能量出 0 行 0 列(容器未布局);0 尺寸的 PTY 在部分
        // 平台直接 EINVAL
        let s = size(0, 0);
        assert!(s.rows >= 2 && s.cols >= 10);
    }

    /// 真 PTY 回环:openpty → spawn echo → master 端读回输出。钉的是
    /// portable-pty 依赖在本平台真的能干活,而不只是编译通过。
    #[cfg(unix)]
    #[test]
    fn pty_echo_roundtrip() {
        let pty = native_pty_system();
        let pair = pty.openpty(size(24, 80)).unwrap();
        let mut cmd = CommandBuilder::new("/bin/echo");
        cmd.arg("mc-pty-ok");
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut out = String::new();
        // echo 退出后 master 读到 EOF,read_to_string 自然返回
        let _ = reader.read_to_string(&mut out);
        let _ = child.wait();
        assert!(out.contains("mc-pty-ok"), "PTY 输出缺失: {out:?}");
    }
}
