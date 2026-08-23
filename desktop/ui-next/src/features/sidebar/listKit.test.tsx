import { IconClipboardList, IconMessages } from "@tabler/icons-react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FixedGroupHeader } from "./listKit";

describe("FixedGroupHeader", () => {
  it("紧跟标题显示非零计数，并由整行按钮控制折叠", () => {
    const onToggle = vi.fn();
    const onAdd = vi.fn();
    render(
      <FixedGroupHeader
        icon={IconClipboardList}
        name="待办"
        count={3}
        collapsed={false}
        onToggle={onToggle}
        onAdd={onAdd}
        addLabel="添加"
      />,
    );

    const title = screen.getByText("待办");
    const count = screen.getByText("3");
    expect(title.nextElementSibling).toBe(count);

    const toggle = title.closest("button");
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle!);
    expect(onToggle).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("临时会话不渲染组级计数，折叠箭头保持在组头尾部", () => {
    const { container } = render(
      <FixedGroupHeader
        icon={IconMessages}
        name="临时会话"
        collapsed
        onToggle={() => undefined}
        onAdd={() => undefined}
        addLabel="新建会话"
      />,
    );

    const toggle = screen.getByText("临时会话").closest("button");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle?.querySelector(".badge")).toBeNull();
    expect(container.querySelector("svg.absolute.end-2")).not.toBeNull();
  });
});
