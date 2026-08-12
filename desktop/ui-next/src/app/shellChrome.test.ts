import { describe, expect, it } from "vitest";

import { isDevtoolsHotkey, windowContextLabel } from "./shellChrome";

const key = (o: Partial<Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "metaKey" | "shiftKey">>) => ({
  code: "",
  key: "",
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...o,
});

describe("devtools 快捷键判定", () => {
  it("F12 与 ⌃⇧I 命中;普通 I/Ctrl+I 不命中", () => {
    expect(isDevtoolsHotkey(key({ key: "F12" }))).toBe(true);
    expect(isDevtoolsHotkey(key({ code: "KeyI", key: "I", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsHotkey(key({ code: "KeyI", key: "i", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsHotkey(key({ code: "KeyI", key: "I", ctrlKey: true }))).toBe(false);
    expect(isDevtoolsHotkey(key({ code: "KeyI", key: "I" }))).toBe(false);
  });

  it("mac 的 ⌘⇧I 同样命中(只判 ctrlKey 时 mac 用户打不开 devtools)", () => {
    expect(isDevtoolsHotkey(key({ code: "KeyI", key: "I", metaKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsHotkey(key({ code: "KeyI", key: "I", metaKey: true }))).toBe(false);
  });

  it("认物理键位而非 key:输入法/非拉丁布局下 key 不是 I,仍要命中", () => {
    // 俄文布局按同一个物理键得到的是 "ш";按 key 判会整块失效
    expect(isDevtoolsHotkey(key({ code: "KeyI", key: "ш", ctrlKey: true, shiftKey: true }))).toBe(true);
    // 反向:别的物理键即使 key 恰好是 I 也不该命中
    expect(isDevtoolsHotkey(key({ code: "KeyJ", key: "I", ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});

describe("windowContextLabel(原生窗口标题的上下文)", () => {
  const t = ((k: string) =>
    (
      ({
        "settings.title": "设置",
        "create.title": "新建任务",
        "rail.cloud": "云端任务",
        "rail.chat": "本地会话",
        "rail.local": "本地任务",
        "rail.stats": "用量统计",
        "main.welcome.title": "开始一个任务",
      }) as Record<string, string>
    )[k] ?? k) as Parameters<typeof windowContextLabel>[3];
  const view = (over: Partial<Parameters<typeof windowContextLabel>[0]> = {}) => ({
    settingsOpen: false,
    creating: false,
    cloudSpace: false,
    statsSpace: false,
    ...over,
  });

  // 优先级 = 主区分支的渲染优先级;此前标题只认 current,开着本地任务切到
  // 设置/新建/云端任务时,窗口切换器里仍挂着上一个本地会话的标题
  it("按主区渲染优先级取:设置 > 新建 > 云端 > 用量统计 > 本地会话 > 欢迎页", () => {
    const cur = { title: "重构登录页", kind: "local" };
    expect(windowContextLabel(view({ settingsOpen: true }), null, cur, t)).toBe("设置");
    expect(windowContextLabel(view({ creating: true }), null, cur, t)).toBe("新建任务");
    expect(windowContextLabel(view({ cloudSpace: true }), { title: "修 CI" }, cur, t)).toBe("修 CI");
    expect(windowContextLabel(view({ statsSpace: true }), null, cur, t)).toBe("用量统计");
    expect(windowContextLabel(view(), null, cur, t)).toBe("重构登录页");
    expect(windowContextLabel(view(), null, null, t)).toBe("开始一个任务");
  });

  it("云端任务标题逐级回退 title → summary → content → 「云端任务」;未选任务回欢迎页", () => {
    const v = view({ cloudSpace: true });
    expect(windowContextLabel(v, { summary: "摘要" }, null, t)).toBe("摘要");
    expect(windowContextLabel(v, { content: "正文" }, null, t)).toBe("正文");
    expect(windowContextLabel(v, {}, null, t)).toBe("云端任务");
    expect(windowContextLabel(v, null, null, t)).toBe("开始一个任务");
  });

  it("无标题的会话按 kind 回退", () => {
    expect(windowContextLabel(view(), null, { title: "", kind: "chat" }, t)).toBe("本地会话");
    expect(windowContextLabel(view(), null, { title: "", kind: "local" }, t)).toBe("本地任务");
  });
});
