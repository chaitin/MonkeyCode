import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionMeta } from "@/lib/ipc/sessions";
import {
  groupLocalSessions,
  groupSessions,
  projectKey,
  projectName,
  readArchivedProjects,
  readProjectOrder,
  reorderKeys,
  writeProjectOrder,
  type CustomGroup,
} from "./projects";

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

const meta = (over: Partial<SessionMeta> & { id: string; workdir: string }): SessionMeta => ({
  title: over.id,
  model: "m",
  turns: 0,
  status: "idle",
  ...over,
});

describe("项目 key 归一(跨平台契约)", () => {
  it("反斜杠转正斜杠、去尾斜杠、根目录除外", () => {
    expect(projectKey("C:\\work\\demo\\")).toBe("C:/work/demo");
    expect(projectKey("/home/a/b///")).toBe("/home/a/b");
    expect(projectKey("/")).toBe("/");
    expect(projectName("C:\\work\\demo\\")).toBe("demo");
  });

  it("mc.projectOrder 读写去重且经归一;脏 JSON 回落空", () => {
    writeProjectOrder(["/a/", "\\a", "/b"]);
    expect(JSON.parse(store.get("mc.projectOrder") ?? "")).toEqual(["/a", "/b"]);
    store.set("mc.projectOrder", "not json");
    expect(readProjectOrder()).toEqual([]);
    store.set("mc.archivedProjects", JSON.stringify(["/x/", 42]));
    expect([...readArchivedProjects()]).toEqual(["/x"]);
  });
});

describe("拖拽落点", () => {
  it("移到目标之前;目标为 null/未知移到末尾;拖自己无变化", () => {
    expect(reorderKeys(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(reorderKeys(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
    expect(reorderKeys(["a", "b", "c"], "a", "gone")).toEqual(["b", "c", "a"]);
    expect(reorderKeys(["a", "b", "c"], "b", "b")).toEqual(["a", "c", "b"]);
  });
});

describe("分组", () => {
  const sessions = [
    meta({ id: "a1", workdir: "/p/alpha", updated_at: "2026-08-01" }),
    meta({ id: "b1", workdir: "/p/beta", updated_at: "2026-08-03" }),
    meta({ id: "a2", workdir: "/p/alpha/", updated_at: "2026-08-02", archived: true }),
    meta({ id: "c1", workdir: "/p/gamma", updated_at: "2026-07-01" }),
  ];

  it("按归一 key 聚合;无手动序时按组内最近活跃排序;归档会话入组内折叠区", () => {
    const { projects } = groupSessions(sessions, [], new Set());
    expect(projects.map((p) => p.name)).toEqual(["beta", "alpha", "gamma"]);
    const alpha = projects[1];
    expect(alpha?.sessions.map((s) => s.id)).toEqual(["a1"]);
    expect(alpha?.archivedSessions.map((s) => s.id)).toEqual(["a2"]);
  });

  // 未入序的排最前(旧 UI projectOrder.ts `[...fresh, ...known]` 同款):
  // mc.projectOrder 是全序快照,拖过一次之后新建的项目恒 rank=undefined,
  // 追尾会让它沉到列表最底、项目一多就掉出首屏。
  it("未入手动序的项目排在最前(按活跃度),其后才按手动序;归档项目单列", () => {
    const { projects } = groupSessions(sessions, ["/p/gamma", "/p/alpha"], new Set());
    expect(projects.map((p) => p.name)).toEqual(["beta", "gamma", "alpha"]);

    const grouped = groupSessions(sessions, [], new Set(["/p/beta"]));
    expect(grouped.projects.map((p) => p.name)).toEqual(["alpha", "gamma"]);
    expect(grouped.archivedProjects.map((p) => p.name)).toEqual(["beta"]);
  });

  it("多个未入序项目之间保持活跃度序(sort 稳定)", () => {
    const { projects } = groupSessions(sessions, ["/p/alpha"], new Set());
    // beta(08-03)与 gamma(07-01)都未入序 → 按活跃度排最前;alpha 殿后
    expect(projects.map((p) => p.name)).toEqual(["beta", "gamma", "alpha"]);
  });

  it("组内任务按最近活动(updated_at)倒序,不受传入顺序影响", () => {
    // 增量补丁只改时间戳不改数组位置:最新活跃的会话不在数组最前,
    // 组内顺序必须显式重排而非沿用输入序
    const list = [
      meta({ id: "a1", workdir: "/p/alpha", updated_at: "2026-08-01" }),
      meta({ id: "a3", workdir: "/p/alpha", updated_at: "2026-08-03" }),
      meta({ id: "a2", workdir: "/p/alpha", updated_at: "2026-08-02", archived: true }),
      meta({ id: "a4", workdir: "/p/alpha", updated_at: "2026-08-04", archived: true }),
    ];
    const { projects } = groupSessions(list, [], new Set());
    const alpha = projects[0];
    expect(alpha?.sessions.map((s) => s.id)).toEqual(["a3", "a1"]);
    expect(alpha?.archivedSessions.map((s) => s.id)).toEqual(["a4", "a2"]);
  });
});

describe("折叠态契约键归一(旧 UI 写的是裸 workdir)", () => {
  it("mc.collapsedGroups / mc.sessionArchivesOpen 读写都过 projectKey", async () => {
    const { readCollapsedGroups, writeCollapsedGroups, readSessionArchivesOpen, writeSessionArchivesOpen } =
      await import("./projects");
    // 旧 UI 在 Windows 上落的是反斜杠裸路径,不归一就认不出来
    store.set("mc.collapsedGroups", JSON.stringify(["C:\\work\\demo\\", "/p/a"]));
    expect([...readCollapsedGroups()]).toEqual(["C:/work/demo", "/p/a"]);
    writeCollapsedGroups(new Set(["C:\\work\\demo", "C:/work/demo"]));
    expect(JSON.parse(store.get("mc.collapsedGroups") ?? "")).toEqual(["C:/work/demo"]);

    store.set("mc.sessionArchivesOpen", JSON.stringify(["\\p\\b/"]));
    expect([...readSessionArchivesOpen()]).toEqual(["/p/b"]);
    writeSessionArchivesOpen(new Set(["/p/b/"]));
    expect(JSON.parse(store.get("mc.sessionArchivesOpen") ?? "")).toEqual(["/p/b"]);
  });
});

describe("自定义分组 groupLocalSessions", () => {
  const customGroups: CustomGroup[] = [
    { id: "g1", name: "甲组", createdAt: 1 },
    { id: "g2", name: "乙组", createdAt: 2 },
  ];

  it("项目级归组:分配给自定义组的项目其会话脱离自动项目分组", () => {
    const sessions = [
      meta({ id: "s1", workdir: "/p/proj" }),
      meta({ id: "s2", workdir: "/p/proj" }),
      meta({ id: "s3", workdir: "/p/other" }),
    ];
    const r = groupLocalSessions(sessions, [], new Set(), customGroups, { "/p/proj": "g1" }, new Set());
    const g1 = r.custom.find((g) => g.id === "g1")!;
    expect(g1.projects[0]!.sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    // 未归组的项目仍走自动项目分组
    expect(r.projects[0]!.key).toBe("/p/other");
    expect(r.assigned.has("/p/proj")).toBe(true);
  });

  it("置顶项目排最前;空分组不渲染", () => {
    const sessions = [
      meta({ id: "s1", workdir: "/p/b" }),
      meta({ id: "s2", workdir: "/p/a" }),
      meta({ id: "s3", workdir: "/p/g" }),
    ];
    const r = groupLocalSessions(sessions, [], new Set(), customGroups, { "/p/g": "g1" }, new Set(["/p/b"]));
    expect(r.projects[0]!.key).toBe("/p/b"); // 置顶在前
    expect(r.custom.filter((g) => g.projects.length).map((g) => g.id)).toEqual(["g1"]);
  });
});
