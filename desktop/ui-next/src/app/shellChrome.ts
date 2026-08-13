// 壳级 chrome 行为(main.tsx 启动时安装,浏览器模式不生效):
// - 右键:拦掉 WebView 原生菜单(带"检查元素/重新加载"且裁不掉),换自绘文本菜单
// - F12 / ⌃⇧I / ⌘⇧I:打开 devtools(壳命令)
import { openTextContextMenu } from "@/lib/contextMenu";
import { inDesktopShell, invoke } from "@/lib/ipc/ipc";

/** 判据两点(2026-08-09 对表旧工程补回):
 *  ① **mac 认 ⌘**——⌘⇧I 是 macOS 上 devtools 的标准手势,只判 ctrlKey 等于
 *     mac 用户根本打不开(壳内 devtools 未必有别的入口,排障就断在这);
 *  ② 用 `code` 而非 `key`——`key` 跟随键盘布局与输入法状态(俄/希腊/中文
 *     输入态下按同一个物理键得到的不是 "I"),`KeyI` 认的是物理键位。 */
export function isDevtoolsHotkey(e: Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "metaKey" | "shiftKey">): boolean {
  if (e.key === "F12") return true;
  return (e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyI";
}

/** 原生窗口标题的上下文文案(旧 UI appView.ts::windowContextLabel 随迁)。
 *
 *  写给系统 = Alt-Tab 缩略图 / 任务栏悬停 / GNOME·mac 窗口切换器可见,窗口内
 *  不再复述。**必须跟主区实际渲染的那个视图走**:此前标题 effect 只认
 *  `current`(本地会话),与决定主区分支的 settingsOpen/creating/space/cloudTask
 *  四个状态完全脱钩——开着本地任务「重构登录页」,切到云端空间打开「修 CI」,
 *  窗口切换器里显示的仍是「重构登录页」。同一处代码自己就承认了这层脱钩:
 *  MainArea 拿的是 `current={space === "cloud" ? null : current}`,标题却没做
 *  同样的收敛(切空间也不清 currentId)。
 *
 *  优先级 = 主区分支的渲染优先级(App.tsx 的三元链):设置 > 新建 > 云端
 *  任务 > 本地会话 > 欢迎页。(待办不再入链:2026-08-12 定案清单本体进
 *  侧栏,主区没有待办视图了。) */
export function windowContextLabel(
  view: { settingsOpen: boolean; creating: boolean; cloudSpace: boolean },
  cloudTask: { title?: string; summary?: string; content?: string } | null,
  current: { title?: string; kind?: string } | null,
  t: (k: "settings.title" | "create.title" | "rail.cloud" | "rail.chat" | "rail.local" | "main.welcome.title") => string,
): string {
  if (view.settingsOpen) return t("settings.title");
  if (view.creating) return t("create.title");
  if (view.cloudSpace) {
    if (!cloudTask) return t("main.welcome.title");
    return cloudTask.title || cloudTask.summary || cloudTask.content || t("rail.cloud");
  }
  if (current) return current.title || t(current.kind === "chat" ? "rail.chat" : "rail.local");
  return t("main.welcome.title");
}

export function installShellChrome(): void {
  // 壳判定放进处理器而非注册时(旧工程同款):`window.__TAURI__` 由壳的初始化
  // 脚本注入,与本模块求值的先后不该被当成前提——注册时判一次,万一那次为假
  // 就是整个会话永远没有右键菜单和 devtools,且无从察觉
  window.addEventListener("contextmenu", (e) => {
    if (!inDesktopShell()) return;
    e.preventDefault();
    openTextContextMenu(e);
  });
  window.addEventListener("keydown", (e) => {
    if (!inDesktopShell()) return;
    if (!isDevtoolsHotkey(e)) return;
    e.preventDefault();
    void invoke("open_devtools").catch(() => {});
  });
}
