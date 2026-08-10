// 下拉三件套的空态契约。ModelMenu 一直有空/无匹配那一档,OptionMenu 漏了:
// 调用方在"还没拉到 / 拉取失败"时给的就是空数组(云端 models===null →
// sections=[]),没有这一档菜单展开就是个**没有任何内容的空盒子**——看着像
// 点坏了,而不是"暂时没有可选项"。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ModelMenu, OptionMenu } from "./pickers";

describe("OptionMenu:空清单也要说话", () => {
  it("options 为空:展开给「暂无可选项」,不是空盒子", async () => {
    render(<OptionMenu ariaLabel="宿主机" value="" options={[]} onPick={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "宿主机" }));
    const menu = screen.getByRole("list", { name: "宿主机" });
    expect(menu.textContent).toContain("暂无可选项");
  });

  it("sections 为空(云端模型未拉到):同一档空态", async () => {
    render(<OptionMenu ariaLabel="模型" value="" sections={[]} onPick={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "模型" }));
    expect(screen.getByRole("list", { name: "模型" }).textContent).toContain("暂无可选项");
  });

  it("有条目时不出空态", async () => {
    render(
      <OptionMenu ariaLabel="镜像" value="a" options={[{ value: "a", label: "基础镜像" }]} onPick={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "镜像" }));
    const menu = screen.getByRole("list", { name: "镜像" });
    expect(menu.textContent).toContain("基础镜像");
    expect(menu.textContent).not.toContain("暂无可选项");
  });

  it("兄弟组件 ModelMenu 的同款空态仍在(两处形态必须一致)", async () => {
    render(<ModelMenu models={[]} current="" onPick={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "切换模型" }));
    expect(screen.getByRole("list", { name: "切换模型" }).textContent).toContain("尚未配置模型");
  });
});
