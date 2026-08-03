// 提问大纲:条目文案规则(纯函数)与两态渲染。
// 跳转本身是 chat.tsx 的滚动锚点逻辑,靠手动验收 + 既有锚点用例守。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OutlineNav, OUTLINE_JUMP_INSET, mergeLiveOutline, outlineActiveSeq, outlineEntries } from "./components";
import type { LogItem } from "./types";
import type { OutlineItem } from "./useSession";

const item = (over: Partial<OutlineItem> = {}): OutlineItem => ({
  seq: 1,
  offset: 0,
  text: "帮我看下这个 panic",
  timestamp: Date.UTC(2026, 6, 25, 2, 24),
  ...over,
});

describe("outlineEntries", () => {
  it("剥掉附件行,只留正文", () => {
    const [e] = outlineEntries([item({ text: "看下这张图\n[图片] .monkeycode/uploads/a.png" })]);
    expect(e.label).toBe("看下这张图");
  });

  it("纯附件消息回退成计数,不出现空条目", () => {
    const [e] = outlineEntries([
      item({ text: "[图片] .monkeycode/uploads/a.png\n[文件] .monkeycode/uploads/b.pdf" }),
    ]);
    expect(e.label).toBe("📎 2 个附件");
  });

  it("多行压平并截断,超长带省略号", () => {
    const [e] = outlineEntries([item({ text: "第一行\n第二行\n" + "长".repeat(80) })]);
    expect(e.label.startsWith("第一行 第二行 ")).toBe(true);
    expect(e.label.endsWith("…")).toBe(true);
    expect(e.label.length).toBe(61);
  });

  it("保留 seq 与轮偏移(跳转与翻页都靠它们)", () => {
    const [e] = outlineEntries([item({ seq: 42, offset: 1024 })]);
    expect(e.seq).toBe(42);
    expect(e.offset).toBe(1024);
  });

  it("缺时间戳时不渲染时间", () => {
    const [e] = outlineEntries([item({ timestamp: undefined })]);
    expect(e.time).toBe("");
  });

  it("撞 seq 的条目只留首条(帧号撞号的坏数据防御:两点同亮、点击跳错)", () => {
    const entries = outlineEntries([
      item({ seq: 1, text: "第一问" }),
      item({ seq: 1, text: "撞号的重复问" }),
      item({ seq: 5, text: "第二问" }),
    ]);
    expect(entries.map((e) => e.seq)).toEqual([1, 5]);
    expect(entries[0].label).toBe("第一问");
  });
});

describe("mergeLiveOutline", () => {
  const user = (seq: number, text: string, timestamp?: number): LogItem => ({
    kind: "user",
    text,
    seq,
    ...(timestamp !== undefined ? { timestamp } : {}),
  });

  it("刚发出的提问(目录里还没有)从对话流补进大纲尾部", () => {
    const merged = mergeLiveOutline([item({ seq: 1, text: "第一问" })], [
      user(1, "第一问"),
      { kind: "agent", text: "回答" },
      user(9, "最新一问", 1722_000_000_000),
    ]);
    expect(merged.map((it) => it.seq)).toEqual([1, 9]);
    expect(merged[1]).toEqual({ seq: 9, offset: 0, text: "最新一问", timestamp: 1722_000_000_000 });
  });

  it("目录已有的条目以目录为准(带真实翻页偏移),不重复", () => {
    const merged = mergeLiveOutline([item({ seq: 1, offset: 1024 })], [user(1, "第一问")]);
    expect(merged).toHaveLength(1);
    expect(merged[0].offset).toBe(1024);
  });

  it("无 seq 的用户条目(旧记录)与非用户条目都不进大纲", () => {
    const noSeq: LogItem = { kind: "user", text: "旧记录" };
    const merged = mergeLiveOutline([], [noSeq, { kind: "sys", text: "— 本轮结束 —" }]);
    expect(merged).toEqual([]);
  });

  it("没有新增时原样返回目录(引用不变,memo 不空转)", () => {
    const items = [item()];
    expect(mergeLiveOutline(items, [user(1, "第一问")])).toBe(items);
  });
});

describe("outlineActiveSeq", () => {
  it("跳转目标落在顶部留白线时标记目标，而不是上一问", () => {
    expect(
      outlineActiveSeq(
        [
          { top: -120, seq: 7 },
          { top: OUTLINE_JUMP_INSET, seq: 40 },
          { top: 80 },
        ],
        0,
      ),
    ).toBe(40);
  });

  it("尚未滚到顶部留白线的下一问不会提前标记", () => {
    expect(outlineActiveSeq([{ top: -20, seq: 7 }, { top: 40, seq: 40 }], 0)).toBe(7);
  });
});

describe("OutlineNav", () => {
  const entries = outlineEntries([
    item({ seq: 7, offset: 0, text: "第一问" }),
    item({ seq: 40, offset: 512, text: "第二问" }),
  ]);

  it("收起态是一列点,当前项带标记", () => {
    const html = renderToStaticMarkup(<OutlineNav entries={entries} activeSeq={40} onJump={() => {}} />);
    expect(html.match(/mc-outline-dot/g)?.length).toBe(2);
    expect(html).toContain('data-outline-current="true"');
    // 收起态不渲染浮窗
    expect(html).not.toContain("mc-outline-panel");
    expect(html).not.toContain("第一问");
  });

  it("一条提问的会话不占轨道", () => {
    const one = outlineEntries([item({ seq: 7, text: "唯一一问" })]);
    expect(renderToStaticMarkup(<OutlineNav entries={one} onJump={() => {}} />)).toBe("");
  });

  it("带 aria-label,便于键盘/读屏定位", () => {
    const html = renderToStaticMarkup(<OutlineNav entries={entries} onJump={() => {}} />);
    expect(html).toContain('aria-label="提问大纲"');
  });
});
