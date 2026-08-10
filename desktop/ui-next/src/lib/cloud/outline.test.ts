// 云端大纲锚定层:时间戳归一(ns/µs/ms/s → 10ms 锚)、索引正序化、
// 对话流投影(锚只活在大纲层,不回写帧/状态)与补页判定。
import { describe, expect, it, vi } from "vitest";

import type { ChatItem } from "@/lib/protocol/types";
import {
  cloudAnchorIndex,
  cloudOutlineAnchor,
  cloudOutlineItems,
  fetchCloudOutline,
  MAX_INDEX_PAGES,
  withCloudAnchors,
} from "./outline";

// 同一时刻的四种精度(REST 纳秒 / 帧流毫秒是主要两路)
const MS = 1754190123456; // 2025-08 左右的毫秒时间戳
const NS = MS * 1e6;
const US = MS * 1e3;

describe("cloudOutlineAnchor", () => {
  it("ns/µs/ms/s 四种精度归一到同一 10ms 锚", () => {
    const anchor = Math.floor(MS / 10);
    expect(cloudOutlineAnchor(NS)).toBe(anchor);
    expect(cloudOutlineAnchor(US)).toBe(anchor);
    expect(cloudOutlineAnchor(MS)).toBe(anchor);
    expect(cloudOutlineAnchor(Math.floor(MS / 1000))).toBe(Math.floor(MS / 1000) * 100);
  });

  it("壳侧 ns→ms 整除后再取锚,与直接从 ns 取锚一致(不因舍入跨 10ms 边界)", () => {
    const shellMs = Math.floor((NS + 9_999_999) / 1e6); // 壳整除丢掉的亚毫秒
    expect(cloudOutlineAnchor(shellMs)).toBe(cloudOutlineAnchor(NS + 9_999_999));
  });

  it("无效输入回 undefined", () => {
    expect(cloudOutlineAnchor(undefined)).toBeUndefined();
    expect(cloudOutlineAnchor(0)).toBeUndefined();
    expect(cloudOutlineAnchor(-5)).toBeUndefined();
    expect(cloudOutlineAnchor(Number.NaN)).toBeUndefined();
  });
});

describe("cloudOutlineItems", () => {
  it("倒序索引转正序;无时间戳条目丢弃;timestamp 回到毫秒", () => {
    const items = cloudOutlineItems([
      { content: "新问题", timestamp: NS + 20_000_000 },
      { content: "没锚的", timestamp: undefined },
      { content: "旧问题", timestamp: NS },
    ]);
    expect(items.map((i) => i.text)).toEqual(["旧问题", "新问题"]);
    expect(items[0]).toEqual({ seq: Math.floor(MS / 10), offset: 0, text: "旧问题", timestamp: Math.floor(MS / 10) * 10 });
  });
});

describe("withCloudAnchors / cloudAnchorIndex", () => {
  const items: ChatItem[] = [
    { kind: "user", text: "有时间戳", timestamp: MS, seq: 3 }, // 原 seq 是帧水位,须换成锚
    { kind: "agent", text: "回答" },
    { kind: "user", text: "没时间戳", seq: 7 }, // 没锚:剥 seq,进不了大纲
  ];

  it("用户消息 seq 换成时间锚;无时间戳剥 seq;非用户项原样", () => {
    const out = withCloudAnchors(items);
    expect(out[0]).toEqual({ kind: "user", text: "有时间戳", timestamp: MS, seq: Math.floor(MS / 10) });
    expect(out[1]).toBe(items[1]);
    expect(out[2]).toEqual({ kind: "user", text: "没时间戳" });
    // 投影不改原数组(锚不许污染归约状态)
    expect(items[0]).toMatchObject({ seq: 3 });
  });

  it("cloudAnchorIndex:按锚找用户消息下标,找不到 -1", () => {
    expect(cloudAnchorIndex(items, Math.floor(MS / 10))).toBe(0);
    expect(cloudAnchorIndex(items, 42)).toBe(-1);
  });
});

describe("fetchCloudOutline", () => {
  it("按游标翻到头,聚合后正序", async () => {
    const pages: Record<string, { items: { content: string; timestamp: number }[]; next_cursor?: string; has_more?: boolean }> = {
      "": { items: [{ content: "第二问", timestamp: NS + 10_000_000 }], next_cursor: "c1", has_more: true },
      c1: { items: [{ content: "第一问", timestamp: NS }], has_more: false },
    };
    const fetchPage = vi.fn((_id: string, cursor = "") => Promise.resolve(pages[cursor]!));
    const out = await fetchCloudOutline("t1", fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(out.map((i) => i.text)).toEqual(["第一问", "第二问"]);
  });

  it("护栏:has_more 一直为真也只翻 MAX_INDEX_PAGES 页", async () => {
    const fetchPage = vi.fn((_id: string, cursor = "") =>
      Promise.resolve({ items: [{ content: "q" + cursor, timestamp: NS }], next_cursor: "c" + cursor, has_more: true }),
    );
    await fetchCloudOutline("t1", fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(MAX_INDEX_PAGES);
  });
});
