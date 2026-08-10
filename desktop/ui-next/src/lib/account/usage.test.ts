import { describe, expect, it } from "vitest";

import type { McUsage } from "@/lib/ipc/account";
import { fmtTokens, planTier, usageVM } from "./usage";

describe("planTier:会员档归一", () => {
  it("flagship 归一为 ultra;未知/缺省归 basic", () => {
    expect(planTier("ultra")).toBe("ultra");
    expect(planTier("flagship")).toBe("ultra");
    expect(planTier("pro")).toBe("pro");
    expect(planTier("basic")).toBe("basic");
    expect(planTier("weird")).toBe("basic");
    expect(planTier(undefined)).toBe("basic");
  });
});

describe("fmtTokens:token 数缩写", () => {
  it("百万以上一位小数 M(截断不四舍五入),其余千分位", () => {
    expect(fmtTokens(3_000_000)).toBe("3.0M");
    expect(fmtTokens(1_560_000)).toBe("1.5M");
    expect(fmtTokens(999_999)).toBe("999,999");
    expect(fmtTokens(0)).toBe("0");
  });
});

const full: McUsage = {
  base_url: "https://mc.example",
  wallet: { balance: 12345, daily_token_balance: 1_500_000, daily_token_limit: 3_000_000 },
  subscription: { plan: "pro", expires_at: "2026-12-31T00:00:00Z" },
  checked_in: false,
  invitations: { count: 2, items: [{ id: "i1", name: "甲" }] },
};

describe("usageVM:面板派生", () => {
  it("usage 为 null / 四路全缺席 → null(整块不占位)", () => {
    expect(usageVM(null)).toBeNull();
    expect(usageVM(undefined)).toBeNull();
    expect(usageVM({ wallet: null, subscription: null, checked_in: null, invitations: null })).toBeNull();
  });

  it("完整载荷:等级/到期日/积分/额度/签到/邀请链接", () => {
    const vm = usageVM(full, "u1");
    expect(vm).toEqual({
      plan: "pro",
      hasSubscription: true,
      expiresAt: "2026-12-31",
      credits: "12", // 12345 / 1000 取整
      quota: { total: 3_000_000, remaining: 1_500_000, ratio: 0.5, remainingText: "1.5M", totalText: "3.0M" },
      checkedIn: false,
      invite: { count: 2, link: "https://mc.example/?ic=u1", avatars: [{ key: "i1", url: "", initial: "甲" }] },
    });
  });

  it("基础档不给到期日(服务端给了也不代表会降级)", () => {
    const vm = usageVM({ ...full, subscription: { plan: "basic", expires_at: "2026-12-31T00:00:00Z" } });
    expect(vm?.plan).toBe("basic");
    expect(vm?.expiresAt).toBeNull();
    expect(vm?.hasSubscription).toBe(true);
  });

  it("额度上限为 0:无额度档位,ratio 0 且余额不按剩余/总量截断", () => {
    const vm = usageVM({ ...full, wallet: { balance: 0, daily_token_balance: 500, daily_token_limit: 0 } });
    expect(vm?.quota).toEqual({ total: 0, remaining: 500, ratio: 0, remainingText: "500", totalText: "0" });
  });

  it("余额越界按 [0, total] 截断", () => {
    const over = usageVM({ ...full, wallet: { daily_token_balance: 9_999_999, daily_token_limit: 3_000_000 } });
    expect(over?.quota?.remaining).toBe(3_000_000);
    const neg = usageVM({ ...full, wallet: { daily_token_balance: -5, daily_token_limit: 3_000_000 } });
    expect(neg?.quota?.remaining).toBe(0);
  });

  it("checked_in 缺席 → checkedIn null(签到入口不出现,不误报未签)", () => {
    expect(usageVM({ ...full, checked_in: null })?.checkedIn).toBeNull();
  });

  it("邀请人头像:相对地址按 base_url 补全,绝对/data: 原样,无 base 或无地址给空串(渲染侧退首字母)", () => {
    const vm = usageVM(
      {
        ...full,
        invitations: {
          count: 4,
          items: [
            { id: "a", name: "甲", avatar_url: "/av/a.png" },
            { id: "b", name: "乙", avatar_url: "https://cdn/x.png" },
            { id: "c", name: "丙" },
            { id: "d" },
          ],
        },
      },
      "u1",
    );
    expect(vm?.invite?.avatars).toEqual([
      { key: "a", url: "https://mc.example/av/a.png", initial: "甲" },
      { key: "b", url: "https://cdn/x.png", initial: "乙" },
      { key: "c", url: "", initial: "丙" },
      { key: "d", url: "", initial: "?" }, // 无名回落 ?
    ]);
    // 没有 base 就不拼:宁可退首字母,也不请求一个必然 404 的地址
    expect(usageVM({ ...full, base_url: "", invitations: { items: [{ id: "a", avatar_url: "/av/a.png" }] } })?.invite?.avatars[0]?.url).toBe("");
  });

  it("头像最多取 5 个(再多一行叠不下,人数由 count 兜着)", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, name: "甲" }));
    expect(usageVM({ ...full, invitations: { count: 9, items } })?.invite?.avatars.length).toBe(5);
  });

  it("邀请链接:缺基址或账号 id 都拼不出(空串);count 缺席回落 items 长度", () => {
    expect(usageVM(full)?.invite?.link).toBe(""); // 无 userId
    expect(usageVM({ ...full, base_url: "" }, "u1")?.invite?.link).toBe("");
    expect(usageVM({ ...full, base_url: "https://mc.example/" }, "u1")?.invite?.link).toBe("https://mc.example/?ic=u1");
    const vm = usageVM({ ...full, invitations: { items: [{ id: "a" }, { id: "b" }] } });
    expect(vm?.invite?.count).toBe(2);
  });

  it("仅订阅可用(私有化部署):钱包/邀请为 null,面板仍有会员行", () => {
    const vm = usageVM({ wallet: null, subscription: { plan: "ultra" }, checked_in: null, invitations: null });
    expect(vm).toEqual({
      plan: "ultra",
      hasSubscription: true,
      expiresAt: null,
      credits: null,
      quota: null,
      checkedIn: null,
      invite: null,
    });
  });
});
