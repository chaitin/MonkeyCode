import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { McUsagePanel } from "./settings";
import type { McUsage } from "./types";

const usage = (u: Partial<McUsage> = {}): McUsage => ({
  base_url: "https://monkeycode-ai.com",
  wallet: null,
  subscription: null,
  checked_in: null,
  invitations: null,
  ...u,
});
const noCheckin = async () => null;

/** 账号权益块:桌面端此前完全看不到自己的额度(只有移动端「我的」页有),
 * 已关联的用户要能看到会员等级、今日 token 余量、积分、签到与邀请。 */
describe("McUsagePanel", () => {
  it("渲染会员等级、今日额度与积分余额", () => {
    const html = renderToStaticMarkup(
      <McUsagePanel
        usage={usage({
          wallet: { balance: 12_345_678, daily_token_balance: 400_000, daily_token_limit: 1_000_000 },
          subscription: { plan: "pro", expires_at: "2026-08-31T00:00:00Z" },
        })}
        onCheckin={noCheckin}
      />,
    );

    expect(html).toContain("专业会员");
    expect(html).toContain("有效期至 2026-08-31");
    expect(html).toContain("剩余 400,000 / 1.0M");
    expect(html).toContain("12,345");
  });

  it("还没拉到数据时整块不占位(空进度条会被读成额度为 0)", () => {
    expect(renderToStaticMarkup(<McUsagePanel usage={null} onCheckin={noCheckin} />)).toBe("");
    expect(renderToStaticMarkup(<McUsagePanel usage={usage()} onCheckin={noCheckin} />)).toBe("");
  });

  it("私有化部署没有钱包端点时只显示会员等级,不出现额度/签到/邀请", () => {
    const html = renderToStaticMarkup(<McUsagePanel usage={usage({ subscription: { plan: "basic" } })} onCheckin={noCheckin} />);

    expect(html).toContain("基础会员");
    expect(html).not.toContain("今日额度");
    expect(html).not.toContain("积分余额");
    expect(html).not.toContain("签到");
    expect(html).not.toContain("已邀请");
  });

  it("未签到给可点的签到入口,已签到转低调态", () => {
    const todo = renderToStaticMarkup(<McUsagePanel usage={usage({ checked_in: false })} onCheckin={noCheckin} />);
    expect(todo).toContain("签到 +100");
    expect(todo).not.toContain("今日已签到");

    const done = renderToStaticMarkup(<McUsagePanel usage={usage({ checked_in: true })} onCheckin={noCheckin} />);
    expect(done).toContain("今日已签到");
    expect(done).not.toContain("签到 +100");
  });

  it("邀请行给出人数、奖励与复制入口", () => {
    const html = renderToStaticMarkup(
      <McUsagePanel
        usage={usage({ invitations: { count: 3, items: [{ id: "u1", name: "阿茂" }] } })}
        userId="me-1"
        onCheckin={noCheckin}
      />,
    );

    expect(html).toContain("已邀请 3 人");
    expect(html).toContain("每邀请一位 +5,000 积分");
    expect(html).toContain("复制邀请链接");
    expect(html).toContain("https://monkeycode-ai.com/?ic=me-1");
  });

  it("拿不到账号 id 时不给复制入口(链接拼不出来)", () => {
    const html = renderToStaticMarkup(
      <McUsagePanel usage={usage({ invitations: { count: 3, items: [] } })} onCheckin={noCheckin} />,
    );

    expect(html).toContain("已邀请 3 人");
    expect(html).not.toContain("复制邀请链接");
  });
});
