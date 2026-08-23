import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { BackgroundAgentResultItem } from "@/lib/protocol/types";
import { BackgroundAgentResultCard } from "./BackgroundAgentResultCard";

const COMPLETED: BackgroundAgentResultItem = {
  kind: "background-result",
  agentId: "agent-17",
  agentName: "依赖调查员",
  description: "检查升级风险",
  status: "completed",
  result: "\n\n## 第一条摘要\n\n第二段 **完整内容**",
  text: "后台代理已完成",
};

describe("BackgroundAgentResultCard", () => {
  it("卡片使用蓝色“查看结果”动作，点击后在弹窗渲染完整 Markdown", async () => {
    const user = userEvent.setup();
    const { container } = render(<BackgroundAgentResultCard item={COMPLETED} />);

    expect(container.firstElementChild?.classList.contains("mc-workbench-material")).toBe(true);
    expect(screen.getByText("子代理结果")).toBeTruthy();
    expect(screen.getByText("已完成")).toBeTruthy();
    expect(screen.getByText("检查升级风险")).toBeTruthy();
    expect(screen.queryByText(/依赖调查员/)).toBeNull();
    expect(screen.queryByText("第一条摘要")).toBeNull();
    expect(screen.queryByText("完整内容")).toBeNull();

    const resultButton = screen.getByRole("button", { name: "查看结果" });
    expect(resultButton.className).toContain("link-primary");
    await user.click(resultButton);

    expect(screen.getByRole("dialog", { name: "子代理结果" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "第一条摘要", level: 2 })).toBeTruthy();
    expect(screen.getByText("完整内容")).toBeTruthy();
  });

  it("失败状态通过状态点表达并保留无障碍语义", () => {
    render(
      <BackgroundAgentResultCard
        item={{ ...COMPLETED, agentName: "", agentId: "agent-error", status: "error", result: "执行中断" }}
      />,
    );

    expect(screen.getByText("执行失败")).toBeTruthy();
  });

  it("弹窗可用 Esc 关闭且不提供额外复制按钮", async () => {
    const user = userEvent.setup();
    render(<BackgroundAgentResultCard item={COMPLETED} />);
    await user.click(screen.getByRole("button", { name: "查看结果" }));

    expect(screen.queryByRole("button", { name: "复制结果" })).toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "子代理结果" })).toBeNull();
  });
});
