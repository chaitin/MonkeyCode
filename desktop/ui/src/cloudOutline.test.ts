// 云端提问大纲:时间戳锚归一、user-input 帧盖章、REST 索引条目转换。
// 交互(跳转补页/当前项跟踪)是 DOM 滚动逻辑,靠手动验收 + 本地大纲既有用例守。
import { describe, expect, it } from "vitest";

import { cloudOutlineAnchor, cloudOutlineItems, framesHaveAnchor, withCloudOutlineAnchors } from "./cloudOutline";
import { mergeLiveOutline } from "./outline";
import type { Frame, LogItem } from "./types";

// 同一时刻的四种精度写法(2026-07-26T00:00:00Z 附近)
const MS = 1_784_937_600_123;
const NS = MS * 1e6;

describe("cloudOutlineAnchor", () => {
  it("纳秒(REST 索引)与毫秒(帧流)归一到同一个 10ms 锚", () => {
    expect(cloudOutlineAnchor(NS)).toBe(cloudOutlineAnchor(MS));
    expect(cloudOutlineAnchor(MS)).toBe(Math.floor(MS / 10));
  });

  it("纳秒超出 JS 安全整数的精度漂移被 10ms 取整吸收", () => {
    // 模拟 JSON 解析后的浮点近似(±256ns 级):不该翻过 10ms 边界
    expect(cloudOutlineAnchor(NS + 300)).toBe(cloudOutlineAnchor(NS));
  });

  it("微秒与秒精度也能对上", () => {
    expect(cloudOutlineAnchor(MS * 1e3)).toBe(cloudOutlineAnchor(MS));
    // 秒粒度会丢毫秒尾数,只要求落在同一坐标系(10ms 单位)
    expect(cloudOutlineAnchor(1_784_937_600)).toBe(1_784_937_600 * 100);
  });

  it("空值/非法值返回 undefined(条目会被丢弃而不是锚在 0 上)", () => {
    expect(cloudOutlineAnchor(undefined)).toBeUndefined();
    expect(cloudOutlineAnchor(0)).toBeUndefined();
    expect(cloudOutlineAnchor(Number.NaN)).toBeUndefined();
  });
});

describe("withCloudOutlineAnchors", () => {
  it("user-input 帧的 seq 改写为时间戳锚(chunk seq 是另一套坐标,必须盖掉)", () => {
    const frames: Frame[] = [
      { type: "user-input", timestamp: MS, seq: 3 },
      { type: "task-started", timestamp: MS, seq: 4 },
    ];
    const [ui, started] = withCloudOutlineAnchors(frames);
    expect(ui.seq).toBe(Math.floor(MS / 10));
    expect(started.seq).toBe(4); // 非 user-input 不动
  });

  it("缺时间戳的 user-input 保持原样,不喂 0 锚", () => {
    const f: Frame = { type: "user-input", seq: 3 };
    expect(withCloudOutlineAnchors([f])[0]).toBe(f);
  });
});

describe("framesHaveAnchor", () => {
  it("REST 索引锚(纳秒)能在毫秒时间戳的帧集里找到同一条提问", () => {
    const frames: Frame[] = [
      { type: "task-started", timestamp: MS },
      { type: "user-input", timestamp: MS },
    ];
    const restAnchor = cloudOutlineAnchor(NS)!;
    expect(framesHaveAnchor(frames, restAnchor)).toBe(true);
  });

  it("非 user-input 帧与无时间戳帧不参与判定", () => {
    expect(framesHaveAnchor([{ type: "task-started", timestamp: MS }], Math.floor(MS / 10))).toBe(false);
    expect(framesHaveAnchor([{ type: "user-input" }], Math.floor(MS / 10))).toBe(false);
  });
});

describe("cloudOutlineItems", () => {
  it("倒序索引转正序条目,纳秒换算毫秒供时间列展示", () => {
    const items = cloudOutlineItems([
      { id: "user-input-2", content: "第二问", timestamp: (MS + 60_000) * 1e6 },
      { id: "user-input-1", content: "第一问", timestamp: NS },
    ]);
    expect(items.map((it) => it.text)).toEqual(["第一问", "第二问"]);
    expect(items[0].seq).toBe(Math.floor(MS / 10));
    expect(items[0].timestamp).toBe(Math.floor(MS / 10) * 10);
  });

  it("缺时间戳的条目丢弃(没锚定位不了,留着是点不动的死条目)", () => {
    expect(cloudOutlineItems([{ id: "x", content: "无时间戳" }])).toEqual([]);
  });

  it("与盖过章的对话流合并:REST 覆盖历史,实时补最新一问,同锚去重", () => {
    const rest = cloudOutlineItems([{ content: "第一问", timestamp: NS }]);
    const live: LogItem[] = [
      { kind: "user", text: "第一问", seq: Math.floor(MS / 10), timestamp: MS },
      { kind: "user", text: "最新一问", seq: Math.floor((MS + 60_000) / 10), timestamp: MS + 60_000 },
    ];
    const merged = mergeLiveOutline(rest, live);
    expect(merged.map((it) => it.text)).toEqual(["第一问", "最新一问"]);
  });
});
