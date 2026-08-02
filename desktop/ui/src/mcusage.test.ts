import { describe, expect, it } from "vitest";
import { fmtTokens, planLabel, resolveAssetUrl, usageView } from "./mcusage";
import type { McUsage } from "./types";

/** 各路默认缺席,按用例补齐——壳侧本就允许单路缺席。 */
const usage = (u: Partial<McUsage> = {}): McUsage => ({
  base_url: "https://monkeycode-ai.com",
  wallet: null,
  subscription: null,
  checked_in: null,
  invitations: null,
  ...u,
});

describe("planLabel", () => {
  it("flagship 是 ultra 的服务端别名", () => {
    expect(planLabel("ultra")).toBe("旗舰会员");
    expect(planLabel("flagship")).toBe("旗舰会员");
    expect(planLabel("pro")).toBe("专业会员");
    expect(planLabel(undefined)).toBe("基础会员");
  });
});

describe("fmtTokens", () => {
  it("百万以上缩写为 M,其余千分位", () => {
    expect(fmtTokens(2_500_000)).toBe("2.5M");
    expect(fmtTokens(999_999)).toBe("999,999");
    expect(fmtTokens(0)).toBe("0");
  });
});

describe("resolveAssetUrl", () => {
  it("相对地址按云端基址补全,绝对地址原样", () => {
    expect(resolveAssetUrl("https://mc.io", "/static/a.png")).toBe("https://mc.io/static/a.png");
    expect(resolveAssetUrl("https://mc.io", "static/a.png")).toBe("https://mc.io/static/a.png");
    expect(resolveAssetUrl("https://mc.io", "https://cdn.io/a.png")).toBe("https://cdn.io/a.png");
    expect(resolveAssetUrl("https://mc.io", "//cdn.io/a.png")).toBe("//cdn.io/a.png");
    expect(resolveAssetUrl("", "/static/a.png")).toBe("");
    expect(resolveAssetUrl("https://mc.io", undefined)).toBe("");
  });
});

describe("usageView", () => {
  it("一路都没有时不渲染(空进度条会被读成额度为 0)", () => {
    expect(usageView(null)).toBeNull();
    expect(usageView(usage())).toBeNull();
  });

  it("积分按 /1000 折算,今日额度给出剩余比例", () => {
    const v = usageView(
      usage({
        wallet: { balance: 12_345_678, daily_token_balance: 400_000, daily_token_limit: 1_000_000 },
        subscription: { plan: "pro", expires_at: "2026-08-31T00:00:00Z" },
      }),
    );
    expect(v?.planText).toBe("专业会员");
    expect(v?.expiryText).toBe("有效期至 2026-08-31");
    expect(v?.credits).toBe("12,345");
    expect(v?.quota).toMatchObject({ remaining: 400_000, total: 1_000_000, text: "剩余 400,000 / 1.0M", ratio: 0.4 });
  });

  it("基础档不显示到期日(服务端不给,给了也不代表会降级)", () => {
    const v = usageView(usage({ subscription: { plan: "basic", expires_at: "2026-08-31T00:00:00Z" } }));
    expect(v?.expiryText).toBe("长期有效");
    expect(v?.credits).toBeNull();
    expect(v?.quota).toBeNull();
  });

  it("没有免费额度档位时标注无额度,不做除零", () => {
    const v = usageView(usage({ wallet: { balance: 0, daily_token_balance: 0, daily_token_limit: 0 } }));
    expect(v?.quota).toMatchObject({ text: "无额度", ratio: 0 });
    expect(v?.expiryText).toBe("");
  });

  it("剩余超过上限时按上限收口(服务端口径漂移不该撑爆进度条)", () => {
    const v = usageView(usage({ wallet: { balance: 0, daily_token_balance: 5_000, daily_token_limit: 1_000 } }));
    expect(v?.quota).toMatchObject({ remaining: 1_000, ratio: 1 });
  });

  it("私有化部署只有订阅端点时仍展示会员等级", () => {
    const v = usageView(usage({ subscription: { plan: "pro" } }));
    expect(v?.planText).toBe("专业会员");
    expect(v?.credits).toBeNull();
    expect(v?.checkedIn).toBeNull();
    expect(v?.invite).toBeNull();
  });

  it("签到态原样透传三态,取不到时保持 null(不退化成未签到)", () => {
    expect(usageView(usage({ checked_in: true }))?.checkedIn).toBe(true);
    expect(usageView(usage({ checked_in: false }))?.checkedIn).toBe(false);
    expect(usageView(usage({ subscription: { plan: "pro" } }))?.checkedIn).toBeNull();
  });

  it("邀请:头像最多 4 个、相对地址补全、缺图退首字母,链接带账号 id", () => {
    const v = usageView(
      usage({
        invitations: {
          count: 7,
          items: [
            { id: "u1", name: "阿茂", avatar_url: "/avatars/1.png" },
            { id: "u2", name: "bob", avatar_url: "https://cdn.io/2.png" },
            { id: "u3" },
            { id: "u4", name: "dan" },
            { id: "u5", name: "eve" },
          ],
        },
      }),
      "me-1",
    );
    expect(v?.invite?.count).toBe(7);
    expect(v?.invite?.avatars).toHaveLength(4);
    expect(v?.invite?.avatars[0]).toMatchObject({ url: "https://monkeycode-ai.com/avatars/1.png", initial: "阿" });
    expect(v?.invite?.avatars[1]).toMatchObject({ url: "https://cdn.io/2.png", initial: "B" });
    expect(v?.invite?.avatars[2]).toMatchObject({ url: "", initial: "?" });
    expect(v?.invite?.link).toBe("https://monkeycode-ai.com/?ic=me-1");
  });

  it("count 缺省时退回条目数;基址或账号 id 缺一就不给邀请链接", () => {
    const items = [{ id: "u1", name: "阿茂" }];
    expect(usageView(usage({ invitations: { items } }), "me-1")?.invite?.count).toBe(1);
    expect(usageView(usage({ invitations: { items } }))?.invite?.link).toBe("");
    expect(usageView(usage({ base_url: "", invitations: { items } }), "me-1")?.invite?.link).toBe("");
  });

  it("基址尾部斜杠不会拼出双斜杠", () => {
    const v = usageView(
      usage({ base_url: "https://mc.io/", invitations: { count: 1, items: [{ id: "u1", avatar_url: "/a.png" }] } }),
      "me-1",
    );
    expect(v?.invite?.link).toBe("https://mc.io/?ic=me-1");
    expect(v?.invite?.avatars[0].url).toBe("https://mc.io/a.png");
  });
});
