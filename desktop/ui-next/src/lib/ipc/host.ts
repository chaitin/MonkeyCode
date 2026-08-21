// 宿主域 API:平台探测、窗口控制、壳信息。
// 所有 invoke 命令名保持字面量(契约守卫正则;plugin: 前缀的命令不进 ACL
// 对表,但 capability 已授权)。浏览器模式降级:探测返回 false、hostInfo
// 返回 null、窗控静默 no-op。
import { inDesktopShell, invoke } from "./ipc";

export function isMacShell(): boolean {
  return inDesktopShell() && /Mac/.test(navigator.userAgent);
}

export function isWindowsShell(): boolean {
  return inDesktopShell() && /Windows/.test(navigator.userAgent);
}

export type HostPlatform = "mac" | "windows" | "linux" | "browser";

export function hostPlatform(): HostPlatform {
  if (!inDesktopShell()) return "browser";
  if (isMacShell()) return "mac";
  if (isWindowsShell()) return "windows";
  return "linux";
}

export function isLinuxShell(): boolean {
  return hostPlatform() === "linux";
}

/** 「本端由 UI 自绘窗框条」的唯一判据(LAYOUT §1)。壳在 Windows/Linux 走
 *  decorations(false),UI 补 32px 扁平窗框;mac 走 TitleBarStyle::Overlay,
 *  原生红绿灯浮在工作台视图头左端(壳侧定位,UI 只让位),浏览器无窗体。
 *  组件里不要散写两个平台判断。 */
export function isCustomChromeShell(): boolean {
  return isWindowsShell() || isLinuxShell();
}

/** 启动即调用:CSS/组件按 data-platform 做平台分支(mac 红绿灯让位等)。 */
export function applyPlatformAttr(): void {
  document.documentElement.dataset.platform = hostPlatform();
}

export interface HostInfo {
  version: string;
  engine_version: string | null;
}

export async function hostInfo(): Promise<HostInfo | null> {
  if (!inDesktopShell()) return null;
  try {
    return await invoke<HostInfo>("host_info");
  } catch {
    return null;
  }
}

/* ---- 窗口控制(不带 label 即作用于调用方窗口;close 由壳拦截转托盘) ---- */

const quiet = (p: Promise<unknown>): void => {
  void p.catch(() => {});
};

export function windowMinimize(): void {
  quiet(invoke("plugin:window|minimize"));
}

export function windowToggleMaximize(): void {
  quiet(invoke("plugin:window|toggle_maximize"));
}

export function windowClose(): void {
  quiet(invoke("plugin:window|close"));
}

export function windowIsMaximized(): Promise<boolean> {
  return invoke<boolean>("plugin:window|is_maximized").catch(() => false);
}

/** 无边框窗口的边缘拉伸方向(壳侧 tauri_runtime::ResizeDirection,PascalCase
 *  直传,无 serde 重命名)。 */
export type ResizeDirection =
  | "North"
  | "NorthEast"
  | "East"
  | "SouthEast"
  | "South"
  | "SouthWest"
  | "West"
  | "NorthWest";

/** Linux 走 decorations(false) 后 WM 的 resize 边就没了,由 UI 侧边缘热区
 *  接管(App 的 ResizeEdges)。按下即交给壳做 OS 级拖拽,不自己算几何。 */
export function windowStartResize(direction: ResizeDirection): void {
  quiet(invoke("plugin:window|start_resize_dragging", { value: direction }));
}

/** Windows 窗体系统菜单(移动/大小/最小化/最大化/关闭)。走壳命令而非
 *  WM_NCHITTEST:WebView2 子窗口占满客户区,非客户区命中测试到不了这儿。
 *  入口是窗框条右键与左端应用图标点击(Win95 起的老规矩)。非 Windows 静默。
 *  不传坐标:壳侧自取指针的物理屏幕位,免去 CSS 像素→物理像素的换算。 */
export function windowSystemMenu(): void {
  if (!isWindowsShell()) return;
  quiet(invoke("window_system_menu"));
}

/** mac 绿灯默认行为:切换全屏(⌥ 点击才是最大化,由调用方分流)。 */
export async function windowToggleFullscreen(): Promise<void> {
  try {
    const fullscreen = await invoke<boolean>("plugin:window|is_fullscreen");
    await invoke("plugin:window|set_fullscreen", { value: !fullscreen });
  } catch {
    // 浏览器模式/命令失败:静默
  }
}

/** 窗口标题随视图变化;浏览器模式退回 document.title。
 *
 *  ⚠️ 参数名是 **value**,不是 title(线上契约,别"顺手改成同名")。这条
 *  命令由 Tauri 的 `setter!(set_title, &str)` 宏生成,宏体里的形参恒为
 *  `value`(tauri-2.11.5/src/window/plugin.rs)。传 `{ title }` 会在壳侧
 *  反序列化阶段就被拒:「command argument missing: value」——而 quiet()
 *  把这条拒绝吞掉了,于是**每一次**改标题都静默失败,Alt-Tab / 任务栏 /
 *  调度中心里永远显示 index.html 里那个静态标题,界面上一点异常都看不出来。
 *  旧 UI(ui/src/host.ts::setWindowTitle)一直传的就是 value。 */
export function setWindowTitle(title: string): void {
  if (!inDesktopShell()) {
    document.title = title;
    return;
  }
  quiet(invoke("plugin:window|set_title", { value: title }));
}

/** 外链一律交系统浏览器:壳内 opener 失败时退回 location 导航(壳的
 *  on_navigation 守卫会拒绝并转系统浏览器);浏览器模式新开标签。
 *  只放行 http(s)——工作区文件链接由聊天层专门处理,不走这里。 */
export function openExternal(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (!inDesktopShell()) {
    window.open(url, "_blank", "noopener");
    return;
  }
  void invoke("plugin:opener|open_url", { url }).catch(() => {
    location.href = url;
  });
}

/** 消费壳的待取意图("open-settings" / "open-session:<id>";无则 null)。
 *  壳在窗口唤起前就可能收到意图(托盘/桌宠),启动时取一次。 */
export function takeUiIntent(): Promise<string | null> {
  if (!inDesktopShell()) return Promise.resolve(null);
  return invoke<string | null>("take_ui_intent").catch(() => null);
}

/** 解析 "open-session:<id>" 意图;非字符串/非该前缀返回 null(壳返回值防御)。 */
export function sessionIdFromUiIntent(intent: unknown): string | null {
  if (typeof intent !== "string" || !intent.startsWith("open-session:")) return null;
  const id = intent.slice("open-session:".length);
  return id || null;
}

/** 打开应用存储目录 = 引擎日志目录(app_config_dir,壳侧同一命令:配置、
 *  会话、cookie 与引擎日志都在这);浏览器模式 no-op。
 *  **失败要抛**:此前这里吞掉 Err,壳报什么错都表现为「点了没反应」,
 *  连"命令不存在(壳还是旧版)"都看不出来(2026-08-07 用户报障)。 */
export function openLogDir(): Promise<void> {
  if (!inDesktopShell()) return Promise.resolve();
  return invoke<string>("open_log_dir").then(() => {});
}

/** 在文件管理器中选中程序本体(macOS 为 .app,其余平台为可执行文件);
 *  浏览器模式 no-op。失败要抛,理由同 openLogDir。 */
export function openAppDir(): Promise<void> {
  if (!inDesktopShell()) return Promise.resolve();
  return invoke<string>("open_app_dir").then(() => {});
}

/** WSL 模式下工作目录的家目录基座:guest 家目录的宿主视角
 *  (\\wsl$\<发行版>\home\<用户>;Linux 冒烟为 posix 家目录)。
 *  本机模式壳返回 None、浏览器模式/命令失败一律降级 null。 */
export async function wslWorkdirBase(): Promise<string | null> {
  if (!inDesktopShell()) return null;
  try {
    return (await invoke<string | null>("wsl_workdir_base")) ?? null;
  } catch {
    return null;
  }
}

/** 系统目录选择;取消/浏览器模式返回 null。 */
export async function pickDirectory(defaultPath?: string): Promise<string | null> {
  if (!inDesktopShell()) return null;
  try {
    const res = await invoke<string | string[] | null>("plugin:dialog|open", {
      // defaultPath 决定对话框开在哪:不给的话落点由平台自定(Windows 上是
      // 进程 CWD = 安装目录),WSL 模式下更会开在 Windows 侧、选出来的路径
      // 压根不属于当前运行环境(2026-08-07 对表旧 UI 补回;与导出引擎日志
      // 落「下载」目录同一口径)
      options: { directory: true, multiple: false, ...(defaultPath ? { defaultPath } : {}) },
    });
    if (typeof res === "string") return res;
    if (Array.isArray(res)) return res[0] ?? null;
    return null;
  } catch {
    return null;
  }
}

/** 目录对话框的初始位置,按当前内核运行环境定:
 *  - WSL 模式:引擎 prepare 时采集的 guest 家目录(wsl_workdir_base),
 *    引擎没起来就退回按配置推出的发行版 UNC 根 \\wsl$\<发行版>;
 *  - 本机模式 / 读取失败:返回 undefined(交回平台默认,不硬塞一个位置)。
 *  不给这个值的话,WSL 用户点「选择其他文件夹」会开在 Windows 侧,选出来的
 *  路径不属于当前运行环境,建任务必然失败(2026-08-07 对表旧 UI 补回)。 */
export async function workdirPickBase(): Promise<string | undefined> {
  const base = await wslWorkdirBase();
  if (base) return base;
  try {
    const env = (await invoke<{ kernel_env?: string } | null>("get_config"))?.kernel_env ?? "";
    // UNC 要两道反斜杠开头:模板串里每道写成 \\
    if (env.startsWith("wsl:") && env.length > 4) return `\\\\wsl$\\${env.slice(4)}`;
  } catch {
    // 非壳/读不到配置:不指定初始位置
  }
  return undefined;
}
