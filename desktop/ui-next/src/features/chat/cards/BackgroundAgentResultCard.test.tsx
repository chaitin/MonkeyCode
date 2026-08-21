import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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
  it("收起态显示标题、代理、状态、描述与首条摘要，点击后渲染完整 Markdown", async () => {
    const user = userEvent.setup();
    render(<BackgroundAgentResultCard item={COMPLETED} />);

    expect(screen.getByText("后台子代理")).toBeTruthy();
    expect(screen.getByText("依赖调查员")).toBeTruthy();
    expect(screen.getByText("已完成")).toBeTruthy();
    expect(screen.getByText("检查升级风险")).toBeTruthy();
    expect(screen.getByText("第一条摘要")).toBeTruthy();
    expect(screen.queryByText("完整内容")).toBeNull();

    await user.click(screen.getByRole("button", { expanded: false }));

    expect(screen.getByRole("heading", { name: "第一条摘要", level: 2 })).toBeTruthy();
    expect(screen.getByText("完整内容")).toBeTruthy();
  });

  it("失败状态显示失败语义文案，无名代理回退 agentId", () => {
    render(
      <BackgroundAgentResultCard
        item={{ ...COMPLETED, agentName: "", agentId: "agent-error", status: "error", result: "执行中断" }}
      />,
    );

    expect(screen.getByText("agent-error")).toBeTruthy();
    expect(screen.getByText("执行失败")).toBeTruthy();
  });

  it("展开后可复制完整结果", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    try {
      render(<BackgroundAgentResultCard item={COMPLETED} />);
      await user.click(screen.getByRole("button", { expanded: false }));
      await user.click(screen.getByRole("button", { name: "复制结果" }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(COMPLETED.result));
      expect(screen.getByRole("button", { name: "结果已复制" })).toBeTruthy();
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
      else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    }
  });
});
