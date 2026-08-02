import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BaizhiCard } from "./baizhi";
import type { BaizhiStatus } from "./types";

const loggedIn: BaizhiStatus = { logged_in: true, host: "baizhi.cloud", profile: { name: "阿茂" } };
const noop = async () => {};

/** 回归:同步流水线(拉取→并入表单→自动保存)必须整体在宿主(SettingsView),
 * 卡只做受控展示。曾经它挂在卡内,而登录会同时起百智云与 MonkeyCode 两路同步
 * ——先落地的那路把分区切到模型页并卸载账号卡,晚到的一路回来只看到自己已被
 * 卸载,整份 {models, mcp_servers} 连同报错一起被丢弃(表现为"登录百智云后只
 * 同步到会员模型,百智云的模型和 MCP 都没有")。 */
describe("BaizhiCard(同步态由宿主持有)", () => {
  it("进行态与结果文案完全来自 props(卡内不再有同步 state)", () => {
    const html = renderToStaticMarkup(
      <BaizhiCard
        status={loggedIn}
        statusErr=""
        refreshStatus={noop}
        syncing
        syncMsg={{ text: "已同步 3 个模型、MCP 条目", color: "var(--ok)" }}
        onSync={vi.fn()}
      />,
    );

    expect(html).toContain("同步中…");
    expect(html).toContain("已同步 3 个模型、MCP 条目");
  });

  it("空闲态给出同步入口,不残留上一轮文案", () => {
    const html = renderToStaticMarkup(
      <BaizhiCard status={loggedIn} statusErr="" refreshStatus={noop} syncing={false} syncMsg={null} onSync={vi.fn()} />,
    );

    expect(html).toContain("同步模型与 MCP");
    expect(html).not.toContain("同步中…");
  });
});
