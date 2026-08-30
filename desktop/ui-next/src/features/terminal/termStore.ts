// 终端实例库(模块级,与 ChatView 滚动记忆 scrollMemo 同一存在理由):
// xterm 实例与壳侧 PTY 的生命周期**不跟随组件挂载**——收起侧边栏/切会话/
// 换格只是视图离场,shell、回滚缓冲、标题都必须原地活着(2026-08-30 用户
// 报障「收起侧边栏或切会话杀掉全部 shell 为啥要这样做」)。真正的销毁只有
// 三个时刻:用户点实例页签的 ×(closeTerminal)、会话被删除
// (disposeSessionTerminals,App 删除流程调)、应用退出(OS 收走 PTY)。
//
// 结构:sessionId → { instances[], active, seeded };每个实例攥着自己的
// xterm/FitAddon/常驻宿主 div——组件挂载时把 div append 进面板、卸载时摘走,
// xterm 不 dispose、term_close 不发。React 侧经 useSyncExternalStore 订阅
// 版本号,读库自渲染。
//
// tab 标题(2026-08-30 用户需求「名字跟随执行的命令」)双通道:
// - 轮询壳侧 term_title(PTY 前台进程组的进程名)——默认 zsh/bash 不发
//   OSC 标题序列,只靠 onTitleChange 大多数用户永远看不到变化;
// - shell 自己发 OSC(oh-my-zsh 等)时以 xterm onTitleChange 为准,轮询
//   即刻停用(OSC 通常带参数更有信息量,两个来源交替写会闪)。
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { readTermOptions } from "@/features/cloud/CloudTerminal";
import { termBytes } from "@/lib/cloud/terminal";
import { onTermData, onTermExit, termClose, termOpen, termResize, termTitle, termWrite } from "@/lib/ipc/terminal";
import type { MessageKey } from "@/lib/i18n";
import { b64encode } from "@/lib/protocol/codec";

export const TITLE_POLL_MS = 2000;

export interface TermInstance {
  key: number;
  /** 壳侧 PTY id(事件通道名的一部分;每实例独立) */
  id: string;
  term: Terminal;
  fit: FitAddon;
  /** xterm 的常驻宿主:组件挂载时 append 进面板、卸载时摘走,buffer 不丢 */
  container: HTMLDivElement;
  /** 前台进程名/OSC 标题;空串 = 用默认「终端 {key}」 */
  title: string;
  /** 覆盖层文案键(启动中/失败/已退出);空串 = 正常输出中。词典键而非成品
   *  文案:库不进 React,翻译留给组件,locale 切换即时生效 */
  status: MessageKey | "";
  failReason: string;
  exited: boolean;
  /** 内部簿记 */
  opened: boolean;
  domOpened: boolean;
  disposed: boolean;
  oscSeen: boolean;
  offs: (() => void)[];
  poll: number;
}

export interface SessionTerms {
  instances: TermInstance[];
  active: number;
  nextKey: number;
}

const sessions = new Map<string, SessionTerms>();
let version = 0;
const listeners = new Set<() => void>();
const bump = (): void => {
  version += 1;
  for (const cb of [...listeners]) cb();
};

export function subscribeTerminals(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
export const terminalsVersion = (): number => version;

export function sessionTerminals(sessionId: string): SessionTerms {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { instances: [], active: 0, nextKey: 1 };
    sessions.set(sessionId, s);
  }
  return s;
}

export function openTerminal(sessionId: string, workdir?: string): void {
  const s = sessionTerminals(sessionId);
  const key = s.nextKey++;
  const container = document.createElement("div");
  container.style.height = "100%";
  const motionQuery = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  const term = new Terminal({
    fontSize: 12.5,
    cursorBlink: !motionQuery?.matches,
    ...readTermOptions(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const inst: TermInstance = {
    key,
    id: crypto.randomUUID(),
    term,
    fit,
    container,
    title: "",
    status: "term.starting",
    failReason: "",
    exited: false,
    opened: false,
    domOpened: false,
    disposed: false,
    oscSeen: false,
    offs: [],
    poll: 0,
  };
  const syncCursorBlink = (event: MediaQueryListEvent) => {
    term.options.cursorBlink = !event.matches;
  };
  motionQuery?.addEventListener("change", syncCursorBlink);
  inst.offs.push(() => motionQuery?.removeEventListener("change", syncCursorBlink));
  const offData = term.onData((input) => {
    void termWrite(inst.id, b64encode(input)).catch(() => {});
  });
  inst.offs.push(() => offData.dispose());
  const offTitle = term.onTitleChange((title) => {
    inst.oscSeen = true; // shell 自己管标题:轮询让位
    if (title.trim()) {
      inst.title = title.trim();
      bump();
    }
  });
  inst.offs.push(() => offTitle.dispose());

  const start = async () => {
    // 监听先于命令(ipc.ts 铁律 2):shell 提示符在 term_open 返回后立即到
    inst.offs.push(
      await onTermData(inst.id, (b64) => {
        term.write(termBytes(b64));
        if (inst.status === "term.starting") {
          inst.status = "";
          bump();
        }
      }),
    );
    inst.offs.push(
      await onTermExit(inst.id, () => {
        if (inst.disposed) return;
        inst.exited = true;
        window.clearInterval(inst.poll);
        inst.status = "term.exited";
        bump();
      }),
    );
    if (inst.disposed) return; // 监听注册期间已被关:别再开 PTY
    await termOpen(inst.id, workdir, term.cols, term.rows);
    inst.opened = true;
    if (inst.disposed) {
      // open 在途时被关:dispose 那一拍 opened 还是 false,这里补杀
      void termClose(inst.id).catch(() => {});
      return;
    }
    requestAnimationFrame(() => fitReport(inst));
    inst.poll = window.setInterval(() => {
      // 视图不在场(收起侧边栏/切走会话)不白拉:标题只有面板可见才有人看,
      // macOS 侧每次查询还要起一个 ps;回来后下一拍(≤2s)自然追上
      if (!inst.container.isConnected) return;
      if (inst.oscSeen || inst.exited || inst.disposed) return;
      void termTitle(inst.id)
        .then((name) => {
          if (!name || inst.oscSeen || inst.disposed || name === inst.title) return;
          inst.title = name;
          bump();
        })
        .catch(() => {});
    }, TITLE_POLL_MS);
  };
  void start().catch((e: unknown) => {
    if (inst.disposed) return;
    inst.status = "term.failed";
    inst.failReason = e instanceof Error ? e.message : String(e);
    bump();
  });

  s.instances.push(inst);
  s.active = key;
  bump();
}

export function setActiveTerminal(sessionId: string, key: number): void {
  const s = sessions.get(sessionId);
  if (!s || s.active === key) return;
  s.active = key;
  bump();
}

export function closeTerminal(sessionId: string, key: number): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  const idx = s.instances.findIndex((inst) => inst.key === key);
  if (idx < 0) return;
  const [inst] = s.instances.splice(idx, 1);
  disposeInstance(inst!);
  // 关的是活动页:落焦右邻,没有右邻落左邻
  if (s.active === key && s.instances.length > 0) {
    s.active = s.instances[Math.min(idx, s.instances.length - 1)]!.key;
  }
  bump();
}

/** 会话删除时的整组清场(App 删除流程调):不清的话孤儿 shell 一直跑到
 *  应用退出。 */
export function disposeSessionTerminals(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  sessions.delete(sessionId);
  for (const inst of s.instances) disposeInstance(inst);
  bump();
}

/** 全量清场(测试隔离用;运行期没有合法调用点)。 */
export function disposeAllTerminals(): void {
  for (const id of [...sessions.keys()]) disposeSessionTerminals(id);
}

function disposeInstance(inst: TermInstance): void {
  if (inst.disposed) return;
  inst.disposed = true;
  window.clearInterval(inst.poll);
  for (const off of inst.offs) off();
  if (inst.opened) void termClose(inst.id).catch(() => {});
  inst.term.dispose();
  inst.container.remove();
}

/** 组件挂载时把常驻宿主接进面板;首次接入才 term.open(xterm 量字宽需要
 *  真实布局,建库时元素还在文档外)。 */
export function attachTerminal(inst: TermInstance, host: HTMLElement): void {
  host.appendChild(inst.container);
  if (!inst.domOpened) {
    inst.domOpened = true;
    inst.term.open(inst.container);
  }
  requestAnimationFrame(() => fitReport(inst));
}

export function fitReport(inst: TermInstance): void {
  try {
    inst.fit.fit();
  } catch {
    // 未布局/收起瞬间 fit 会抛,忽略;下一次 RO/attach 会补
  }
  if (inst.opened && !inst.disposed) {
    void termResize(inst.id, inst.term.cols, inst.term.rows).catch(() => {});
  }
}
