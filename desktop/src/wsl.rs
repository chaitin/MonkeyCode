// WSL 运行环境支持:Windows 上壳把 ohmyagent 引擎 spawn 进 WSL 发行版
// (wsl.exe -d <d> --exec <登录shell> -l -c …,stdio 经中继透传)。引擎数据
// 留 Windows 侧经 /mnt/c 访问;会话 workdir 是 guest Linux 路径,壳侧经
// \\wsl$ UNC 访问(repo 浏览、附件上传共用 host_fs_view/unc_path)。
//
// 本模块全平台编译:Linux 开发机可经 MC_WSL_EXE 指向假 wsl 脚本冒烟整条
// 代码路径;仅 CREATE_NO_WINDOW 之类 Windows 细节 cfg 局部化。

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// wsl 可执行名(MC_WSL_EXE 覆盖,开发机 shim 冒烟用)。
pub fn wsl_exe() -> String {
    std::env::var("MC_WSL_EXE").unwrap_or_else(|_| "wsl.exe".into())
}

/// guest 内 Linux 绝对路径 → Windows 侧可见的 UNC 路径(\\wsl$\<发行版>\…)。
/// 壳跨 host/guest 的文件系统访问统一经 host_fs_view 走到这里。
#[cfg_attr(not(windows), allow(dead_code))] // 非 Windows 只有 host_fs_view 的恒等分支
pub fn unc_path(distro: &str, guest_path: &str) -> PathBuf {
    PathBuf::from(format!(r"\\wsl$\{}{}", distro, guest_path.replace('/', r"\")))
}

/// unc_path 的逆:`\\wsl$\<d>\…` / `\\wsl.localhost\<d>\…` → (发行版, guest 路径)。
/// 目录选择对话框在 WSL 模式下返回 UNC 形态,入会话前经此回译为引擎可用的
/// Linux 路径;非 UNC(或不是 WSL 共享)返回 None。前缀按 Windows 语义
/// 不区分大小写。
pub fn guest_path_of_unc(path: &str) -> Option<(String, String)> {
    fn strip_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
        let head = s.get(..prefix.len())?;
        head.eq_ignore_ascii_case(prefix).then(|| &s[prefix.len()..])
    }
    let rest =
        strip_ci(path, r"\\wsl$\").or_else(|| strip_ci(path, r"\\wsl.localhost\"))?;
    let (distro, tail) = match rest.split_once('\\') {
        Some((d, t)) => (d, format!("/{}", t.replace('\\', "/"))),
        None => (rest, "/".to_string()),
    };
    if distro.is_empty() {
        return None;
    }
    // 去掉对话框可能带的尾随分隔符(\\wsl$\d\home\u\ → /home/u)
    let tail = if tail.len() > 1 { tail.trim_end_matches('/').to_string() } else { tail };
    Some((distro.to_string(), tail))
}

/// Windows 盘符路径 → guest 内 automount 路径(C:\a\b → <mount_root>/c/a/b)。
/// WSL 模式下用户项目几乎都在盘符路径上(最近目录、旧会话 sidecar、
/// 资源管理器里拷来的路径),一律映射进 automount 而不是拒绝。盘符按
/// wslpath 语义小写;裸 "C:foo" 是"C 盘当前目录"的相对语义,不猜,
/// 与其余非盘符形态一起返回 None。
pub fn guest_path_of_drive(mount_root: &str, path: &str) -> Option<String> {
    let bytes = path.as_bytes();
    if bytes.len() < 2 || bytes[1] != b':' || !bytes[0].is_ascii_alphabetic() {
        return None;
    }
    let rest = &path[2..];
    if !rest.is_empty() && !rest.starts_with(['\\', '/']) {
        return None;
    }
    let drive = bytes[0].to_ascii_lowercase() as char;
    let tail: Vec<&str> = rest.split(['\\', '/']).filter(|s| !s.is_empty()).collect();
    let root = mount_root.trim_end_matches('/');
    Some(if tail.is_empty() {
        format!("{root}/{drive}")
    } else {
        format!("{root}/{drive}/{}", tail.join("/"))
    })
}

/// guest_path_of_drive 的 automount 根从哪来:prepare 已经拿 wslpath 翻译过
/// 一批 Windows 路径,从(宿主路径, 翻译结果)对反推——wslpath 对盘符路径的
/// 映射形状恒为 `<root>/<盘符小写>/<其余段>`,wsl.conf [automount] root
/// 自定义(含 root=/)也能对上。宿主路径不是盘符形态(Linux 冒烟的恒等
/// 翻译)返回 None,调用方退默认 /mnt。
pub fn derive_mount_root(host: &Path, guest: &str) -> Option<String> {
    // 空根产出的就是 `/c/Users/…` 纯尾巴,正好用作后缀匹配
    let tail = guest_path_of_drive("", &host.to_string_lossy())?;
    guest.strip_suffix(&tail).map(|root| root.trim_end_matches('/').to_string())
}

/// guest 路径的宿主文件系统视角:Windows 经 \\wsl$ UNC;非 Windows
/// (MC_WSL_EXE 假脚本冒烟,guest == host)原样返回。会话目录判定/创建、
/// repo 浏览、附件落盘等所有"壳侧 std::fs 摸 guest 文件"的点统一走这里。
pub fn host_fs_view(distro: &str, guest_path: &str) -> PathBuf {
    #[cfg(windows)]
    {
        unc_path(distro, guest_path)
    }
    #[cfg(not(windows))]
    {
        let _ = distro;
        PathBuf::from(guest_path)
    }
}

/// kernel_env 配置值解析:"wsl:<distro>" → Some(distro),其余(本机)→ None。
pub fn distro_of(kernel_env: &str) -> Option<&str> {
    kernel_env.strip_prefix("wsl:").filter(|d| !d.is_empty())
}

/// 解码 wsl.exe 输出:老版本以 UTF-16LE 打印(WSL_UTF8=1 只有新版认),
/// 以 NUL 字节嗅探区分;去 BOM 与 \r。
pub fn decode_wsl_output(bytes: &[u8]) -> String {
    let s = if bytes.contains(&0) {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    s.replace('\u{feff}', "").replace('\r', "")
}

/// 运行一次 wsl.exe 并收集输出。环境采集需要原始 NUL 分隔 stdout，
/// 因此字节收集与普通文本解码分开。
pub fn run_wsl_bytes(args: &[String], timeout: Duration) -> Result<Vec<u8>, String> {
    let mut cmd = Command::new(wsl_exe());
    cmd.args(args)
        .env("WSL_UTF8", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_console(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 {} 失败: {e}", wsl_exe()))?;
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let (stdout_tx, stdout_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut out = Vec::new();
        use std::io::Read;
        let _ = stdout.read_to_end(&mut out);
        let _ = stdout_tx.send(out);
    });
    let (stderr_tx, stderr_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut out = Vec::new();
        use std::io::Read;
        let _ = stderr.read_to_end(&mut out);
        let _ = stderr_tx.send(out);
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() > deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("wsl 命令超时({}s): {}", timeout.as_secs(), args.join(" ")));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                let _ = child.kill();
                return Err(format!("等待 wsl 进程失败: {e}"));
            }
        }
    };
    let stdout = stdout_rx.recv_timeout(Duration::from_millis(200)).unwrap_or_default();
    let stderr = stderr_rx.recv_timeout(Duration::from_millis(200)).unwrap_or_default();
    if !status.success() {
        let stdout_text = decode_wsl_output(&stdout);
        let stderr_text = decode_wsl_output(&stderr);
        let msg = if stderr_text.trim().is_empty() { &stdout_text } else { &stderr_text };
        return Err(format!("wsl 命令失败({status}): {}", msg.trim()));
    }
    Ok(stdout)
}

pub fn run_wsl(args: &[String], timeout: Duration) -> Result<String, String> {
    run_wsl_bytes(args, timeout).map(|out| decode_wsl_output(&out))
}

/// 枚举 WSL 发行版(设置视图"运行环境"下拉用);未装 WSL/任何失败 → 空。
/// Windows 直接读取当前用户的 Lxss 注册表，避免为了填一个下拉框启动
/// wsl.exe（会唤醒 WSL，部分机器还会闪出控制台窗口）。
pub fn list_distros() -> Vec<String> {
    #[cfg(windows)]
    {
        match list_distros_from_registry() {
            Ok(names) => names,
            Err(e) => {
                eprintln!("[desktop] 枚举 WSL 发行版失败: {e}");
                Vec::new()
            }
        }
    }

    // Linux 开发机保留 MC_WSL_EXE 假脚本入口，用于冒烟 WSL 命令链路。
    #[cfg(not(windows))]
    {
        if std::env::var("MC_WSL_EXE").is_err() {
            return Vec::new();
        }
        match run_wsl(&["-l".into(), "-q".into()], Duration::from_secs(10)) {
            Ok(out) => parse_distro_list(&out),
            Err(e) => {
                eprintln!("[desktop] 枚举 WSL 发行版失败: {e}");
                Vec::new()
            }
        }
    }
}

#[cfg(windows)]
fn list_distros_from_registry() -> Result<Vec<String>, String> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{ERROR_NO_MORE_ITEMS, ERROR_SUCCESS};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_READ, REG_SZ,
    };

    struct RegKey(HKEY);
    impl Drop for RegKey {
        fn drop(&mut self) {
            // SAFETY:句柄只由本函数成功的 RegOpenKeyExW 创建，并由此 guard
            // 唯一持有；预定义的 HKEY_CURRENT_USER 不放入 guard。
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn open_key(parent: HKEY, path: &str) -> Result<RegKey, String> {
        let path = wide(path);
        let mut key = HKEY::default();
        // SAFETY:path 是以 NUL 结尾且在调用期间存活的 UTF-16；key 是有效
        // 输出指针。只请求 KEY_READ，不会写注册表或触发 UAC。
        let status =
            unsafe { RegOpenKeyExW(parent, PCWSTR(path.as_ptr()), None, KEY_READ, &mut key) };
        if status != ERROR_SUCCESS {
            return Err(format!("打开注册表项失败({})", status.0));
        }
        Ok(RegKey(key))
    }

    fn string_value(key: HKEY, name: &str) -> Result<String, String> {
        let name = wide(name);
        let mut value_type = Default::default();
        let mut byte_len = 0u32;
        // SAFETY:name 是有效的 NUL 结尾 UTF-16；第一次查询只获取长度和类型。
        let status = unsafe {
            RegQueryValueExW(
                key,
                PCWSTR(name.as_ptr()),
                None,
                Some(&mut value_type),
                None,
                Some(&mut byte_len),
            )
        };
        if status != ERROR_SUCCESS || value_type != REG_SZ {
            return Err(format!("读取注册表字符串长度失败({})", status.0));
        }

        let mut value = vec![0u16; (byte_len as usize).div_ceil(2).max(1)];
        // SAFETY:value 以 u16 对齐，容量至少为注册表报告的 byte_len；API
        // 按字节写入，返回后仍按 UTF-16 解释。
        let status = unsafe {
            RegQueryValueExW(
                key,
                PCWSTR(name.as_ptr()),
                None,
                Some(&mut value_type),
                Some(value.as_mut_ptr().cast()),
                Some(&mut byte_len),
            )
        };
        if status != ERROR_SUCCESS || value_type != REG_SZ {
            return Err(format!("读取注册表字符串失败({})", status.0));
        }
        let units = (byte_len as usize / 2).min(value.len());
        let value = &value[..units];
        let end = value.iter().position(|&u| u == 0).unwrap_or(value.len());
        Ok(String::from_utf16_lossy(&value[..end]))
    }

    let lxss = open_key(
        HKEY_CURRENT_USER,
        r"Software\Microsoft\Windows\CurrentVersion\Lxss",
    )?;
    let mut names = Vec::new();
    let mut index = 0u32;
    loop {
        // WSL 的子项名是 GUID；留 256 个 UTF-16 单元也兼容未来扩展。
        let mut subkey_name = [0u16; 256];
        let mut name_len = (subkey_name.len() - 1) as u32;
        // SAFETY:缓冲区和长度指针在调用期间有效；其余可选输出均不需要。
        let status = unsafe {
            RegEnumKeyExW(
                lxss.0,
                index,
                Some(PWSTR(subkey_name.as_mut_ptr())),
                &mut name_len,
                None,
                None,
                None,
                None,
            )
        };
        if status == ERROR_NO_MORE_ITEMS {
            break;
        }
        if status != ERROR_SUCCESS {
            return Err(format!("枚举注册表子项失败({})", status.0));
        }
        index += 1;

        let subkey_name = String::from_utf16_lossy(&subkey_name[..name_len as usize]);
        let Ok(subkey) = open_key(lxss.0, &subkey_name) else {
            continue;
        };
        let Ok(name) = string_value(subkey.0, "DistributionName") else {
            continue;
        };
        if !name.is_empty() && !name.starts_with("docker-desktop") {
            names.push(name);
        }
    }
    names.sort_unstable_by_key(|name| name.to_lowercase());
    names.dedup();
    Ok(names)
}

fn parse_distro_list(out: &str) -> Vec<String> {
    out.lines()
        .map(str::trim)
        // docker-desktop* 是 Docker Desktop 的后端盘,不是用户开发环境
        .filter(|l| !l.is_empty() && !l.starts_with("docker-desktop"))
        .map(String::from)
        .collect()
}

/// prepare 的产出:guest 环境概况 + 与 win_paths 一一对应的 Linux 路径。
pub struct WslPrep {
    /// guest 内用户家目录($HOME):`~` 展开与 workdir 空缺回退用
    pub guest_home: String,
    /// 用户登录 shell(getent passwd 第 7 列):引擎经 `<shell> -l -c` 包一层
    /// 启动,PATH 才带上 profile 里的 nvm/pyenv 等(MCP stdio 子进程依赖)
    pub login_shell: String,
    /// `wslinfo --networking-mode` 的结果:"mirrored" 时 guest 访 127.0.0.1
    /// 可直达宿主(浏览器 MCP 可用);"nat"(或老版无 wslinfo)降级
    pub networking: String,
    /// 与入参 win_paths 一一对应的 guest 侧 Linux 路径
    pub paths: Vec<String>,
}

/// 预热 VM + 校验发行版可运行 + 采集 guest 环境(home/登录 shell/网络模式)
/// + 批量把 Windows 路径翻译为发行版内 Linux 路径,一次 wsl 调用完成
/// (VM 冷启的秒数在此吸收,45s 预算)。每次引擎启动调用,不做进程级缓存
/// (用户可能换发行版)。
pub fn prepare(distro: &str, win_paths: &[&Path]) -> Result<WslPrep, String> {
    // 前三行恒非空(有兜底值),第四行起逐路径翻译;任一 wslpath 失败即整体失败
    const SCRIPT: &str = r#"printf '%s\n' "${HOME:-/root}"
s="$(getent passwd "$(id -un)" | cut -d: -f7)"; printf '%s\n' "${s:-/bin/sh}"
wslinfo --networking-mode 2>/dev/null || echo nat
for p in "$@"; do wslpath -u "$p" || exit 1; done"#;
    let mut args: Vec<String> = vec![
        "-d".into(),
        distro.into(),
        "--exec".into(),
        "/bin/sh".into(),
        "-c".into(),
        SCRIPT.into(),
        "sh".into(),
    ];
    args.extend(win_paths.iter().map(|p| p.to_string_lossy().into_owned()));
    let out = run_wsl(&args, Duration::from_secs(45)).map_err(|e| {
        format!(
            "无法在 WSL 发行版 {distro} 中准备内核: {e}\n排查:`wsl -l -v` 确认发行版存在且为 WSL2;\
             系统睡眠恢复后异常可先执行 `wsl --shutdown` 再重启应用。"
        )
    })?;
    parse_prepare_output(&out, win_paths.len())
}

/// prepare 输出解析(拆出便于单测):HOME、登录 shell、网络模式各一行,
/// 随后 expected_paths 行路径翻译。
fn parse_prepare_output(out: &str, expected_paths: usize) -> Result<WslPrep, String> {
    let lines: Vec<String> = out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    if lines.len() != expected_paths + 3 {
        return Err(format!(
            "WSL 环境采集结果异常(期望 {} 行,得到 {} 行): {}",
            expected_paths + 3,
            lines.len(),
            out.trim()
        ));
    }
    Ok(WslPrep {
        guest_home: lines[0].clone(),
        login_shell: lines[1].clone(),
        networking: lines[2].to_lowercase(),
        paths: lines[3..].to_vec(),
    })
}

/// guest 内校验(可选创建)工作区目录,返回 canonical 路径(cd + pwd -P,
/// 符号链接就地解干净)。
///
/// 壳对 workdir 的存在性判定原先走 \\wsl$ UNC,但 Windows 对远程共享上
/// 符号链接的求值默认禁用(fsutil SymlinkEvaluation 的 R2L/R2R),guest 内
/// 软链指向的目录在宿主视角 stat 必败——用户在发行版里给项目建软链是常态,
/// 表现为"WSL 终端里明明看得到,应用却报目录不存在"。判定挪进 guest 一次
/// 调用完成;sidecar 落 canonical 形态,后续宿主侧文件操作(repo/uploads
/// 的 UNC 视角)也不再穿越 symlink 组件。
pub fn ensure_guest_dir(distro: &str, path: &str, create: bool) -> Result<String, String> {
    let script = if create {
        r#"mkdir -p -- "$1" && cd -- "$1" && pwd -P"#
    } else {
        r#"cd -- "$1" && pwd -P"#
    };
    let args: Vec<String> =
        ["-d", distro, "--exec", "/bin/sh", "-c", script, "sh", path].map(String::from).to_vec();
    match run_wsl(&args, Duration::from_secs(30)) {
        Ok(out) => {
            let canon = out.lines().rev().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
            if canon.starts_with('/') {
                Ok(canon.to_string())
            } else {
                Err(format!("guest 工作区目录解析结果异常: {}", out.trim()))
            }
        }
        // run_wsl 对脚本非零退出的错误恒以"wsl 命令失败"开头(见上),脚本里
        // 只有 mkdir/cd,失败即目录不存在/不可进入;文案必须含"目录不存在"
        // (前端 offerCreate 按此匹配给"创建"入口)。其余错误(wsl.exe 起
        // 不来、超时)按环境错误原样上抛,不能伪装成目录问题诱导用户点创建
        Err(e) if e.starts_with("wsl 命令失败") => {
            Err(format!("工作区目录不存在或不可进入(发行版 {distro} 内): {path}\n{e}"))
        }
        Err(e) => Err(e),
    }
}

/// guest 内网络模式探测(mcp.json 物化时决定浏览器 MCP 是否可用)。
/// 失败(未装 WSL、老版无 wslinfo、发行版异常)一律视为 "nat" 降级。
pub fn networking_mode(distro: &str) -> String {
    let args: Vec<String> = ["-d", distro, "--exec", "/bin/sh", "-c",
        "wslinfo --networking-mode 2>/dev/null || echo nat"]
        .map(String::from)
        .to_vec();
    match run_wsl(&args, Duration::from_secs(30)) {
        Ok(out) => {
            let mode = out.trim().to_lowercase();
            if mode.is_empty() { "nat".into() } else { mode }
        }
        Err(e) => {
            eprintln!("[desktop] WSL 网络模式探测失败,按 nat 处理: {e}");
            "nat".into()
        }
    }
}

/// 兜底清理 guest 内残活的引擎进程。`child.kill()` 只杀 wsl.exe 中继,
/// guest 引擎可能继续活着写 sessions——启动失败/强杀/崩溃重启前都补一刀。
/// pkill -x 按 comm 精确匹配(内核截 15 字符,名字先截齐);无匹配
/// (退出码 1,引擎已自退的常态)与失败都只记日志,不上抛。
pub fn kill_guest_engine(distro: &str, bin_name: &str) {
    let pattern: String = bin_name.chars().take(15).collect();
    let args: Vec<String> =
        ["-d", distro, "--exec", "pkill", "-x", &pattern].map(String::from).to_vec();
    if let Err(e) = run_wsl(&args, Duration::from_secs(10)) {
        eprintln!("[desktop] WSL 引擎兜底清理(无匹配即已退出,属常态): {e}");
    }
}

/// Windows 上 GUI 进程 spawn 控制台子系统 exe 会弹黑窗,统一在此加
/// CREATE_NO_WINDOW(非 Windows 空操作)。壳内所有 std Command 的
/// spawn 点(引擎/git/wsl)共用这一处。
pub(crate) fn no_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_utf16le_with_bom_and_crlf() {
        // BOM + "Ubuntu\r\nDebian\r\n" 的 UTF-16LE 编码
        let mut bytes: Vec<u8> = vec![0xFF, 0xFE];
        for u in "Ubuntu\r\nDebian\r\n".encode_utf16() {
            bytes.extend_from_slice(&u.to_le_bytes());
        }
        assert_eq!(decode_wsl_output(&bytes), "Ubuntu\nDebian\n");
    }

    #[test]
    fn decode_utf8_passthrough() {
        assert_eq!(decode_wsl_output("Ubuntu-22.04\n发行版\n".as_bytes()), "Ubuntu-22.04\n发行版\n");
    }

    #[test]
    fn unc_path_mapping() {
        assert_eq!(
            unc_path("Ubuntu-22.04", "/home/u/proj"),
            PathBuf::from(r"\\wsl$\Ubuntu-22.04\home\u\proj")
        );
    }

    #[test]
    fn distro_of_parsing() {
        assert_eq!(distro_of("wsl:Ubuntu-22.04"), Some("Ubuntu-22.04"));
        assert_eq!(distro_of(""), None);
        assert_eq!(distro_of("wsl:"), None);
        assert_eq!(distro_of("Ubuntu"), None);
    }

    #[test]
    fn guest_path_of_unc_roundtrip() {
        assert_eq!(
            guest_path_of_unc(r"\\wsl$\Ubuntu-22.04\home\u\proj"),
            Some(("Ubuntu-22.04".into(), "/home/u/proj".into()))
        );
        assert_eq!(
            guest_path_of_unc(r"\\wsl.localhost\Debian\home\u"),
            Some(("Debian".into(), "/home/u".into()))
        );
        // 前缀大小写不敏感(Windows 语义);发行版名大小写保留
        assert_eq!(
            guest_path_of_unc(r"\\WSL$\Ubuntu\opt"),
            Some(("Ubuntu".into(), "/opt".into()))
        );
        // 尾随分隔符去除;裸发行版根 → "/"
        assert_eq!(
            guest_path_of_unc(r"\\wsl$\Ubuntu\home\u\"),
            Some(("Ubuntu".into(), "/home/u".into()))
        );
        assert_eq!(guest_path_of_unc(r"\\wsl$\Ubuntu"), Some(("Ubuntu".into(), "/".into())));
        // 中文发行版名
        assert_eq!(
            guest_path_of_unc(r"\\wsl$\测试版\home"),
            Some(("测试版".into(), "/home".into()))
        );
        // 非 WSL UNC 与本机路径
        assert_eq!(guest_path_of_unc(r"\\server\share"), None);
        assert_eq!(guest_path_of_unc(r"C:\Users\u"), None);
        assert_eq!(guest_path_of_unc("/home/u"), None);
        assert_eq!(guest_path_of_unc(r"\\wsl$\"), None);
    }

    #[test]
    fn drive_path_mapping() {
        // 盘符小写、分隔符归一、重复/尾随分隔符收敛
        assert_eq!(
            guest_path_of_drive("/mnt", r"C:\Users\u\proj"),
            Some("/mnt/c/Users/u/proj".into())
        );
        assert_eq!(guest_path_of_drive("/mnt", "d:/dev//x/"), Some("/mnt/d/dev/x".into()));
        // 盘根;automount root=/(空根)与自定义根
        assert_eq!(guest_path_of_drive("/mnt", r"C:\"), Some("/mnt/c".into()));
        assert_eq!(guest_path_of_drive("", r"C:\a"), Some("/c/a".into()));
        assert_eq!(guest_path_of_drive("/custom/", r"E:\a"), Some("/custom/e/a".into()));
        // 相对盘符语义、UNC、posix、相对路径都不接
        assert_eq!(guest_path_of_drive("/mnt", "C:foo"), None);
        assert_eq!(guest_path_of_drive("/mnt", r"\\wsl$\Ubuntu\home"), None);
        assert_eq!(guest_path_of_drive("/mnt", "/home/u"), None);
        assert_eq!(guest_path_of_drive("/mnt", "relative"), None);
    }

    #[test]
    fn mount_root_derivation() {
        // 默认根、自定义根、根挂载(root=/)
        assert_eq!(
            derive_mount_root(Path::new(r"C:\Users\u\AppData"), "/mnt/c/Users/u/AppData"),
            Some("/mnt".into())
        );
        assert_eq!(
            derive_mount_root(Path::new(r"D:\dev"), "/custom/d/dev"),
            Some("/custom".into())
        );
        assert_eq!(derive_mount_root(Path::new(r"C:\a"), "/c/a"), Some("".into()));
        // 反推不出:形状对不上或宿主路径不是盘符(Linux 冒烟恒等翻译)
        assert_eq!(derive_mount_root(Path::new(r"C:\a"), "/mnt/d/a"), None);
        assert_eq!(derive_mount_root(Path::new("/opt/x"), "/opt/x"), None);
    }

    #[test]
    fn prepare_output_parsing() {
        let out = "/home/u\n/usr/bin/zsh\nmirrored\n/mnt/c/bin/ohmyagent-linux\n/mnt/c/cfg\n";
        let p = parse_prepare_output(out, 2).unwrap();
        assert_eq!(p.guest_home, "/home/u");
        assert_eq!(p.login_shell, "/usr/bin/zsh");
        assert_eq!(p.networking, "mirrored");
        assert_eq!(p.paths, vec!["/mnt/c/bin/ohmyagent-linux", "/mnt/c/cfg"]);

        // 网络模式统一小写;空行被滤掉不影响行数(CRLF 已由 decode 处理)
        let p = parse_prepare_output("/root\n/bin/sh\nNAT\n\n/mnt/c/a\n", 1).unwrap();
        assert_eq!(p.networking, "nat");
        assert_eq!(p.paths, vec!["/mnt/c/a"]);

        // 行数不符(某个 wslpath 失败提前退出)→ 报错带原文
        assert!(parse_prepare_output("/root\n/bin/sh\nnat\n", 2).is_err());
    }

    #[test]
    fn distro_list_filtering() {
        assert_eq!(
            parse_distro_list("Ubuntu-22.04\n\ndocker-desktop\ndocker-desktop-data\n Debian \n"),
            vec!["Ubuntu-22.04".to_string(), "Debian".to_string()]
        );
    }
}
