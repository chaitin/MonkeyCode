import { describe, expect, it } from "vitest";

import type { SessionMeta } from "@/lib/ipc/sessions";
import { SessionSkillsConsumptionCoordinator } from "./SessionSkillsConsumption";
import { acceptHigherSessionSkills, preserveNewerSessionSkills } from "./sessionSkillsState";

const meta = (skills: string[], revision: number): SessionMeta => ({
  id: "s1",
  title: "s1",
  workdir: "/w",
  model: "m",
  skills,
  skills_revision: revision,
  turns: 0,
  status: "idle",
});

describe("会话 skills revision 状态层", () => {
  it("旧轮询可更新普通字段但不能回退 skills/skills_revision", () => {
    const result = preserveNewerSessionSkills(
      [{ ...meta(["new"], 8), title: "old title" }],
      [{ ...meta(["stale"], 7), title: "new title" }],
    );
    expect(result[0]).toMatchObject({ title: "new title", skills: ["new"], skills_revision: 8 });
    expect(preserveNewerSessionSkills([meta(["old"], 8)], [meta(["new"], 9)])[0]).toMatchObject({
      skills: ["new"],
      skills_revision: 9,
    });
  });

  it("Composer 只用更高 server revision 确认规范化技能，旧响应不回退", () => {
    const optimistic = { serverRevision: 4, enabledSkills: ["optimistic"] };
    expect(acceptHigherSessionSkills(optimistic, ["stale"], 4)).toBe(optimistic);
    const confirmed = acceptHigherSessionSkills(optimistic, ["normalized"], 6);
    expect(confirmed).toEqual({ serverRevision: 6, enabledSkills: ["normalized"] });
    expect(acceptHigherSessionSkills(confirmed, ["late-old-response"], 5)).toBe(confirmed);
  });

  it("catalog 屏障只等待当前挂载 Composer 消费目标 revision，卸载会解除等待", async () => {
    const coordinator = new SessionSkillsConsumptionCoordinator();
    const token = Symbol("composer");
    coordinator.register(token, "s1", 2);
    let done = false;
    const waiting = coordinator.waitFor(new Map([["s1", 3]])).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    coordinator.register(token, "s1", 3);
    await waiting;
    expect(done).toBe(true);

    coordinator.register(token, "s1", 3);
    const unmounted = coordinator.waitFor(new Map([["s1", 4]]));
    coordinator.unregister(token);
    await expect(unmounted).resolves.toBeUndefined();
  });
});
