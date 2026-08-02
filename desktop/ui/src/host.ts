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

/** 原生「另存为」对话框;返回选定的本地路径,非壳环境或取消返回 null。 */
export async function pickSaveFile(defaultName: string): Promise<string | null> {
  const t = tauri();
  if (!t?.core?.invoke) return null;
  // 裸文件名作 defaultPath 会被解析成相对进程 CWD(Windows 上即应用启动
  // 目录,用户根本找不到):默认落到系统「下载」目录;目录拿不到时才退回
  // 裸文件名兜底
  let defaultPath = defaultName;
  try {
    const dir = await t.path?.downloadDir?.();
    if (dir) defaultPath = (await t.path?.join?.(dir, defaultName)) ?? defaultPath;
  } catch {
    /* 平台拿不到下载目录:保持裸文件名 */
  }
  try {
    const r = await invoke<unknown>("plugin:dialog|save", {
      options: { defaultPath, title: "保存到…" },
    });
    return typeof r === "string" ? r : null;
  } catch {
    return null;
  }
}

/** 当前内核运行环境对应的目录对话框初始位置:WSL 模式返回 guest 家目录的
 * \\wsl$ 视角(引擎持有 prepare 采集的家目录;引擎未就绪退回发行版 UNC 根),
 * 本机模式/读取失败返回 undefined。 */
export async function workdirPickBase(): Promise<string | undefined> {
  if (!tauri()?.core?.invoke) return undefined;
  try {
    const base = await invoke<string | null>("wsl_workdir_base");
    if (base) return base;
  } catch {
    /* 引擎未起/崩溃恢复中:落到配置推导的发行版根 */
  }
  try {
    const env = (await getHostConfig())?.kernel_env ?? "";
    if (env.startsWith("wsl:") && env.length > 4) return `\\\\wsl$\\${env.slice(4)}`;
  } catch {
    /* 非壳或读取失败:不指定初始位置 */
  }
  return undefined;
}

/** 目录是否属于当前内核运行环境。WSL 模式下 guest 形态(/… 或 \\wsl$ UNC)、
 * Windows 盘符(壳映射为 /mnt/<盘>/…)与 ~ 形态(展开为 guest 家目录)全都
 * 可归一化,均放行;本机模式下 guest 形态是 WSL 会话的遗留——Windows 壳上
 * 滤掉(macOS/Linux 本机的 / 开头是正常路径,只滤 UNC)。新任务的"最近
 * 目录/默认目录"按此过滤,切换运行环境后不再预填一个必然失败的路径。 */
export function workdirMatchesEnv(
  dir: string,
  kernelEnv: string,
  windowsShell: boolean = isWindowsShell(),
): boolean {
  const wsl = kernelEnv.startsWith("wsl:");
  const posix = dir.startsWith("/");
  const unc = /^\\\\wsl(\$|\.localhost)\\/i.test(dir);
  if (wsl) return posix || unc || /^[a-zA-Z]:[\\/]/.test(dir) || dir.startsWith("~");
  return windowsShell ? !posix && !unc : !unc;
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

/** 保存应用配置:壳写盘(0600)并重启引擎;引擎 Ready 后 App 经
 * engine-status 统一路径免刷新重连(重拉模型/会话 + 重开当前会话),
 * 调用方只需把自己的表单态重建为最新盘态。 */
export async function saveHostConfig(config: HostConfig): Promise<void> {
  if (!tauri()?.core?.invoke) throw new Error("浏览器模式下配置只读,请在桌面应用中修改");
  await invoke("save_config", { config });
}

/** 事件提示音开关(桌宠页那五种音效的总闸)。真值在壳的 config.json,与
 * 托盘「任务提示音」同源;非壳环境(浏览器模式没有桌宠也就没有音效)返回
 * 开,设置页不渲染这一项。 */
export async function getSoundEnabled(): Promise<boolean> {
  if (!tauri()?.core?.invoke) return true;
  return invoke<boolean>("sound_enabled");
}

/** 切换提示音:与主题一样点一下即生效并落盘,不进保存条、不重启引擎。
 * 壳会广播 sound-enabled 让桌宠页与托盘勾选态一起跟上。 */
export async function setSoundEnabled(enabled: boolean): Promise<void> {
  await invoke("set_sound_enabled", { enabled });
}

/** 在文件管理器中定位随桌面包分发的浏览器扩展目录(用户在扩展管理页
 * 「加载已解压的扩展程序」时选它)。返回目录路径;非壳环境返回 null。 */
export async function openExtensionDir(): Promise<string | null> {
  if (!tauri()?.core?.invoke) return null;
  return invoke<string>("open_extension_dir");
}

/** 在文件管理器中定位引擎日志目录(ohmyagent.log、.prev 与崩溃留存
 * crash-N 都在这)。返回目录路径;非壳环境返回 null。 */
export async function openLogDir(): Promise<string | null> {
  if (!tauri()?.core?.invoke) return null;
  return invoke<string>("open_log_dir");
}

/** 导出引擎最新日志:系统保存对话框另存一份 ohmyagent.log(引擎 stderr
 * 全量,报障附件用)。返回保存路径;用户取消返回 null。 */
export async function exportEngineLog(): Promise<string | null> {
  return invoke<string | null>("export_engine_log");
}

/** 枚举 WSL 发行版(设置页「运行环境」下拉)。非壳环境、非 Windows 或
 * 未装 WSL 均返回空数组。 */
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

/** 窗口级上下文标题:壳内写原生窗口标题(Alt-Tab/任务栏/Mission Control
 * 可见;窗口内不再画重复标题),浏览器模式退回 document.title。 */
export function setWindowTitle(text: string): void {
  if (tauri()?.core?.invoke) {
    void invoke("plugin:window|set_title", { value: text }).catch(() => {});
  } else {
    document.title = text;
  }
}

export const windowMinimize = () => windowCmd("minimize").catch(console.error);
export const windowToggleMaximize = () => windowCmd("toggle_maximize").catch(console.error);
export const windowClose = () => windowCmd("close").catch(console.error);

/** mac 自绘红绿灯的绿点:原生行为是进/出系统全屏(⌥ 点击才是缩放)。 */
export async function windowToggleFullscreen(): Promise<void> {
  try {
    const fullscreen = (await windowCmd("is_fullscreen")) as boolean;
    await invoke("plugin:window|set_fullscreen", { value: !fullscreen });
  } catch (e) {
    console.error(e);
  }
}

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
