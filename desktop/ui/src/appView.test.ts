// appView.ts(App 壳层纯判定)单测:视图回落、窗口上下文文案、模型菜单
// 兜底,以及全局快捷键路由。快捷键是重点——⏎ 允许 / esc 拒绝都是不可逆
// 动作,守卫(输入态、视图、输入法组合、浮层优先级)一条改错就会误应答
// 背景会话的审批,而这条链此前完全裸奔在 App.tsx 的 40 行 if 里。
import { describe, expect, it } from "vitest";
import {
  fallbackView,
  isNewTaskView,
  modelMenuList,
  resolveKeyAction,
  windowContextLabel,
  type KeyContext,
} from "./appView";

describe("主区视图选择", () => {
  it("关闭浮层视图后有会话回会话,没会话回新建任务", () => {
    expect(fallbackView("s1")).toBe("session");
    expect(fallbackView(null)).toBe("new");
  });

  it("没有打开的会话时,即便 view=session 也按新建任务页处理", () => {
    expect(isNewTaskView("new", "s1")).toBe(true);
    expect(isNewTaskView("session", null)).toBe(true);
    expect(isNewTaskView("session", "s1")).toBe(false);
    expect(isNewTaskView("cloud", null)).toBe(true);
  });
});

describe("窗口上下文文案", () => {
  it("按视图取当前对象,逐级回退到缺省文案", () => {
    expect(windowContextLabel("settings", null, undefined)).toBe("设置");
    expect(windowContextLabel("cloud", { summary: "修一下登录" }, undefined)).toBe("修一下登录");
    expect(windowContextLabel("cloud", {}, undefined)).toBe("云端任务");
    expect(windowContextLabel("session", null, { title: "重构侧栏", kind: "local" })).toBe("重构侧栏");
    expect(windowContextLabel("session", null, { title: "", kind: "chat" })).toBe("会话");
    expect(windowContextLabel("session", null, { title: "", kind: "local" })).toBe("本地任务");
    // 会话视图但侧栏快照里还没有这条会话(刚创建):回缺省
    expect(windowContextLabel("session", null, undefined)).toBe("新建任务");
    expect(windowContextLabel("new", null, undefined)).toBe("新建任务");
  });
});

describe("模型菜单兜底", () => {
  it("会话在用的模型已下线时补一条,否则原样返回", () => {
    const models = [{ name: "a", default: true }];
    expect(modelMenuList(models, "a")).toBe(models);
    expect(modelMenuList(models, "")).toBe(models);
    expect(modelMenuList(models, "gone")).toEqual([
      { name: "a", default: true },
      { name: "gone", default: false },
    ]);
  });
});

// ==================== 全局快捷键 ====================

const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
  key: "Escape",
  view: "session",
  sessionId: "s1",
  childOpen: false,
  drawerOpen: false,
  openPermId: null,
  inputText: "",
  ...over,
});

describe("全局快捷键:⇧⇥ 切权限模式", () => {
  it("只在打开了会话的会话视图生效", () => {
    expect(resolveKeyAction(ctx({ key: "Tab", shiftKey: true }))).toEqual({ type: "toggle-yolo", preventDefault: true });
    expect(resolveKeyAction(ctx({ key: "Tab", shiftKey: true, view: "cloud" })).type).toBe("none");
    expect(resolveKeyAction(ctx({ key: "Tab", shiftKey: true, sessionId: null })).type).toBe("none");
    expect(resolveKeyAction(ctx({ key: "Tab" })).type).toBe("none"); // 裸 Tab 归浏览器焦点导航
  });
});

describe("全局快捷键:esc 的优先级链", () => {
  it("浮层先吃:子会话回放 > 文件抽屉 > 其余", () => {
    expect(resolveKeyAction(ctx({ childOpen: true, drawerOpen: true })).type).toBe("close-child");
    expect(resolveKeyAction(ctx({ drawerOpen: true })).type).toBe("close-drawer");
  });

  it("浮层期间不误应答审批(哪怕有待决审批)", () => {
    expect(resolveKeyAction(ctx({ childOpen: true, openPermId: "p1" })).type).toBe("close-child");
    expect(resolveKeyAction(ctx({ drawerOpen: true, openPermId: "p1" })).type).toBe("close-drawer");
  });

  it("输入态只收敛焦点,绝不当作审批拒绝(deny 不可逆)", () => {
    for (const tag of ["TEXTAREA", "INPUT", "SELECT"]) {
      expect(resolveKeyAction(ctx({ targetTag: tag, openPermId: "p1" })).type).toBe("blur");
    }
    // 焦点在普通元素上才应答
    expect(resolveKeyAction(ctx({ targetTag: "DIV", openPermId: "p1" }))).toEqual({
      type: "answer-perm",
      id: "p1",
      action: "deny",
    });
  });

  it("输入法组合中不应答:候选词的 esc 属于输入法", () => {
    expect(resolveKeyAction(ctx({ targetTag: "DIV", openPermId: "p1", isComposing: true })).type).toBe("none");
  });

  it("仅会话视图应答审批:新任务/云端/设置视图不误拒背景会话", () => {
    expect(resolveKeyAction(ctx({ targetTag: "DIV", openPermId: "p1", view: "new" })).type).toBe("none");
    expect(resolveKeyAction(ctx({ targetTag: "DIV", openPermId: "p1", sessionId: null })).type).toBe("none");
    expect(resolveKeyAction(ctx({ targetTag: "DIV", openPermId: "p1", view: "cloud" })).type).toBe("close-cloud");
    expect(resolveKeyAction(ctx({ targetTag: "DIV", openPermId: "p1", view: "settings" })).type).toBe("close-settings");
  });

  it("设置/云端视图:输入态先 blur,再按一次才关视图", () => {
    expect(resolveKeyAction(ctx({ view: "settings", targetTag: "INPUT" })).type).toBe("blur");
    expect(resolveKeyAction(ctx({ view: "settings", targetTag: "DIV" })).type).toBe("close-settings");
    expect(resolveKeyAction(ctx({ view: "cloud", targetTag: "TEXTAREA" })).type).toBe("blur");
    expect(resolveKeyAction(ctx({ view: "cloud", targetTag: "DIV" })).type).toBe("close-cloud");
  });

  it("云端终端里的 esc 透传给 shell:不 blur 也不关视图", () => {
    expect(resolveKeyAction(ctx({ view: "cloud", targetTag: "TEXTAREA", inTerminal: true })).type).toBe("none");
    // 终端标记只在云端视图读取,浮层仍然优先
    expect(resolveKeyAction(ctx({ view: "cloud", inTerminal: true, drawerOpen: true })).type).toBe("close-drawer");
  });

  it("没有待决审批时 esc 在会话视图无动作", () => {
    expect(resolveKeyAction(ctx({ targetTag: "DIV" })).type).toBe("none");
  });
});

describe("全局快捷键:⏎ 允许审批", () => {
  it("焦点在普通元素上直接允许,并拦下默认行为", () => {
    expect(resolveKeyAction(ctx({ key: "Enter", targetTag: "DIV", openPermId: "p1" }))).toEqual({
      type: "answer-perm",
      id: "p1",
      action: "allow",
      preventDefault: true,
    });
  });

  it("正在输入内容时让给 composer,清空输入后才当作允许", () => {
    expect(resolveKeyAction(ctx({ key: "Enter", targetTag: "TEXTAREA", openPermId: "p1", inputText: "还没写完" })).type).toBe("none");
    expect(resolveKeyAction(ctx({ key: "Enter", targetTag: "TEXTAREA", openPermId: "p1", inputText: "   " })).type).toBe("answer-perm");
    expect(resolveKeyAction(ctx({ key: "Enter", targetTag: "TEXTAREA", openPermId: "p1" })).type).toBe("answer-perm");
  });

  it("SELECT 不算输入态(原生 select 不吃 ⏎,算了会吞掉快捷键)", () => {
    expect(resolveKeyAction(ctx({ key: "Enter", targetTag: "SELECT", openPermId: "p1", inputText: "写着的" })).type).toBe("answer-perm");
  });

  it("输入法组合、无待决审批、非会话视图都不应答", () => {
    expect(resolveKeyAction(ctx({ key: "Enter", targetTag: "DIV", openPermId: "p1", isComposing: true })).type).toBe("none");
    expect(resolveKeyAction(ctx({ key: "Enter", targetTag: "DIV" })).type).toBe("none");
    expect(resolveKeyAction(ctx({ key: "Enter", targetTag: "DIV", openPermId: "p1", view: "new" })).type).toBe("none");
    expect(resolveKeyAction(ctx({ key: "Enter", targetTag: "DIV", openPermId: "p1", sessionId: null })).type).toBe("none");
  });

  it("⏎ 不受浮层影响(浮层只抢 esc)", () => {
    expect(resolveKeyAction(ctx({ key: "Enter", targetTag: "DIV", openPermId: "p1", drawerOpen: true })).type).toBe("answer-perm");
  });
});
