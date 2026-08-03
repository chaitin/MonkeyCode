// 引擎域 API:状态快照/重启/状态事件。EngineStatus 判别联合来自 ts-rs 生成
// (gen/EngineStatus.ts)。浏览器模式:快照 null、事件 no-op、重启静默失败。
import type { EngineStatus } from "@/gen/EngineStatus";
import { inDesktopShell, invoke, listen } from "./ipc";

export type { EngineStatus };

/** 状态快照补拉(事件可能在挂监听前就 emit 过,进视图先拉一次)。 */
export function engineStatus(): Promise<EngineStatus | null> {
  if (!inDesktopShell()) return Promise.resolve(null);
  return invoke<EngineStatus>("engine_status").catch(() => null);
}

/** 按当前配置重启引擎(幂等;错误页同款入口)。
 *  失败不吞:调用方(横幅)需要据此复位忙态并外显错误,吞掉就是按钮永转。 */
export function engineRestart(): Promise<void> {
  return invoke<void>("engine_restart");
}

export function onEngineStatus(cb: (s: EngineStatus) => void): () => void {
  return listen<EngineStatus>("engine-status", cb);
}

/** 引擎重启后的首个命令要能撞上壳的「配置应用中」闸门再退回来,退避重试抹平。
 *
 * 壳侧契约(main.rs):`restart_engine_locked` 在 `adopt_engine` 里就 emit 了
 * engine-status Ready,而调用方(save_config / schedule_browser_mcp_refresh)
 * **仍持着 EngineApply 锁**,要到整个闭包返回才释放。于是 UI 一收到 Ready 就
 * 发的命令必然落在这段窗口里被闸门拒掉;连着两次重启(保存紧跟浏览器配对
 * 刷新)窗口还会更长。
 *
 * 症状:浏览器配对后会话重开被拒且无人重试,对话仍挂在旧引擎上——表现为
 * 「配对了但对话没加载 browser MCP」(2026-08-07 用户报障)。旧 UI App.tsx
 * 的 afterEngineReady 就是干这个的,ui-next 首版漏迁。
 *
 * 全败也不外显:重连是后台自愈动作,调用方各自保留原状态。 */
export async function afterEngineReady<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= tries - 1) throw e;
      await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
    }
  }
}
