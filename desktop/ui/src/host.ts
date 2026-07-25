// 宿主(桌面壳)集成域:浏览器扩展桥、原生对话框、应用配置、窗口控制、
// 应用更新、宿主事件/意图、外链打开。IPC 原语在 ipc.ts,载荷纯数据类型
// 在 types.ts。
import { invoke, listen, tauri } from "./ipc";
import type { BrowserExtStatus, HostConfig, HostInfo, UpdateStatus } from "./types";

// ==================== 浏览器扩展桥(壳内 browser/ 模块) ====================

export const getBrowserExtStatus = () => invoke<BrowserExtStatus>("browser_status");

/** 重置配对:吊销扩展长期凭据并生成新配对码(扩展侧需重新配对)。 */
export const repairBrowserExt = () => invoke<BrowserExtStatus>("browser_repair");

// ==================== 壳环境与原生能力 ====================

/** 原生目录选择(桌面壳内可用);非壳环境或取消返回 null。
 * defaultPath:对话框初始位置(WSL 模式传发行版 UNC 根,否则默认落在
 * Windows 目录,选出来的路径环境不对)。 */
export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  if (!tauri()?.core?.invoke) return null;
  try {
    const r = await invoke<unknown>("plugin:dialog|open", {
      options: { directory: true, multiple: false, title: "选择工作区目录", ...(defaultPath ? { defaultPath } : {}) },
    });
    return typeof r === "string" ? r : null;
  } catch {
    return null;
  }
}

/** 当前内核运行环境对应的目录对话框初始位置:WSL 模式返回发行版 UNC 根
 * (\\wsl$\<发行版>,老新 Windows 通吃),本机模式/读取失败返回 undefined。 */
export async function workdirPickBase(): Promise<string | undefined> {
  try {
    const env = (await getHostConfig())?.kernel_env ?? "";
    if (env.startsWith("wsl:") && env.length > 4) return `\\\\wsl$\\${env.slice(4)}`;
  } catch {
    /* 非壳或读取失败:不指定初始位置 */
  }
  return undefined;
}

/** 是否运行在桌面壳内。 */
export function inDesktopShell(): boolean {
  return !!tauri()?.core?.invoke;
}

/** 读取壳持有的应用配置(模型 + MCP);非壳环境返回 null。 */
export async function getHostConfig(): Promise<HostConfig | null> {
  if (!tauri()?.core?.invoke) return null;
  return invoke<HostConfig>("get_config");
}

/** 保存应用配置:壳写盘(0600)并重启引擎;resolve 后调用方整页刷新
 * (location.reload())以复位所有状态并重连。 */
export async function saveHostConfig(config: HostConfig): Promise<void> {
  if (!tauri()?.core?.invoke) throw new Error("浏览器模式下配置只读,请在桌面应用中修改");
  await invoke("save_config", { config });
}

/** 在文件管理器中定位随桌面包分发的浏览器扩展目录(用户在扩展管理页
 * 「加载已解压的扩展程序」时选它)。返回目录路径;非壳环境返回 null。 */
export async function openExtensionDir(): Promise<string | null> {
  if (!tauri()?.core?.invoke) return null;
  return invoke<string>("open_extension_dir");
}

/** 枚举 WSL 发行版。非壳环境、非 Windows 或未装 WSL 均返回空数组。
 *
 * 当前无调用方:WSL 运行环境尚未移植(driver/transport.rs 对
 * kernel_env=wsl:* 硬错误),设置页因此不提供发行版下拉。Rust 侧命令
 * 与 wsl.rs 一并保留,移植完成后此函数原地复用。 */
export async function listWslDistros(): Promise<string[]> {
  if (!tauri()?.core?.invoke) return [];
  try {
    return (await invoke<string[]>("list_wsl_distros")) ?? [];
  } catch {
    return [];
  }
}

/** 是否 macOS 桌面壳(标题栏为 Overlay,侧栏顶部须为红绿灯预留拖拽区)。 */
export function isMacShell(): boolean {
  return inDesktopShell() && /Mac/.test(navigator.userAgent);
}

/** 是否 Windows 桌面壳(壳去掉了原生装饰栏,UI 须自绘 36px 标题栏)。 */
export function isWindowsShell(): boolean {
  return inDesktopShell() && /Windows/.test(navigator.userAgent);
}

// ==================== 窗口控制(自绘标题栏按钮用) ====================
// core window 命令不带 label 即作用于调用方窗口。
// 关闭走壳的 CloseRequested 拦截 → 隐藏到托盘,与原生关闭按钮行为一致。

function windowCmd(cmd: string): Promise<unknown> {
  return invoke(`plugin:window|${cmd}`);
}

export const windowMinimize = () => windowCmd("minimize").catch(console.error);
export const windowToggleMaximize = () => windowCmd("toggle_maximize").catch(console.error);
export const windowClose = () => windowCmd("close").catch(console.error);

export async function windowIsMaximized(): Promise<boolean> {
  try {
    return (await windowCmd("is_maximized")) as boolean;
  } catch {
    return false;
  }
}

/** 监听窗口尺寸变化(最大化/还原图标切换用);返回解除监听函数。 */
export const onWindowResized = (cb: () => void): (() => void) => onHostEvent("tauri://resize", cb);

/** 订阅壳事件(如托盘"设置"/桌宠打开会话),返回退订函数;非壳环境为空操作。 */
export function onHostEvent<T = unknown>(name: string, cb: (payload: T) => void): () => void {
  return listen(name, (payload) => cb(payload as T));
}

/** 从壳的字符串意图中取出桌宠要求打开的会话 ID。 */
export function sessionIdFromUiIntent(intent: string | null): string | null {
  const prefix = "open-session:";
  if (!intent?.startsWith(prefix)) return null;
  const id = intent.slice(prefix.length);
  return id || null;
}

/** 取走(消费)壳的待处理意图(如托盘"设置"/桌宠打开会话)。事件发后不管,页面未就绪时
 * 会丢;意图同时落在壳的待取状态,启动完成后经此补取。非壳环境返回 null。 */
export async function takeUiIntent(): Promise<string | null> {
  if (!tauri()?.core?.invoke) return null;
  try {
    return (await invoke<string | null>("take_ui_intent")) ?? null;
  } catch {
    return null;
  }
}

/** 宿主与内核信息(应用版本、Agent commit hash);非壳环境返回 null。 */
export async function getHostInfo(): Promise<HostInfo | null> {
  if (!tauri()?.core?.invoke) return null;
  try {
    return await invoke<HostInfo>("host_info");
  } catch {
    return null;
  }
}

/** 检查应用更新(壳内可用);非壳环境或检查失败抛错。 */
export async function updateCheck(): Promise<UpdateStatus> {
  if (!tauri()?.core?.invoke) throw new Error("浏览器模式下不可用");
  return invoke<UpdateStatus>("update_check");
}

/** 下载安装更新并重启应用(update_check 确认有新版后调用)。 */
export async function updateInstall(): Promise<void> {
  if (!tauri()?.core?.invoke) throw new Error("浏览器模式下不可用");
  await invoke("update_install");
}

/** 在系统浏览器打开外部链接:壳内经 opener 插件,浏览器模式开新标签页。 */
export function openExternal(url: string): void {
  if (tauri()?.core?.invoke) {
    invoke("plugin:opener|open_url", { url }).catch((e) => {
      // 调用被拒(ACL/scope 配置问题)也不能毫无反应:退回整页导航,
      // 壳的 on_navigation 守卫会拒绝并转系统浏览器(Rust 侧不走 ACL)
      console.error("opener 调用失败,退回导航守卫路径:", e);
      location.href = url;
    });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
