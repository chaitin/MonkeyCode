// 自绘文本右键菜单(命令式 DOM,dom 工程按 *.test.tsx 收入)
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openTextContextMenu } from "./contextMenu";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function rightClickMenu(target: Element) {
  const e = new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 });
  Object.defineProperty(e, "target", { value: target });
  openTextContextMenu(e);
  return document.querySelector("ul.menu");
}

describe("自绘文本右键菜单", () => {
  it("可写输入框带选区:剪切/复制/粘贴/全选齐全;点复制写剪贴板", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText, readText: () => Promise.resolve("") }, configurable: true });
    const input = document.createElement("input");
    input.value = "hello world";
    document.body.appendChild(input);
    input.setSelectionRange(0, 5);
    const menu = rightClickMenu(input);
    const labels = [...(menu?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
    expect(labels).toEqual(["剪切", "复制", "粘贴", "全选"]);
    const copyBtn = [...(menu?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "复制");
    await userEvent.click(copyBtn as HTMLElement);
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(document.querySelector("ul.menu")).toBeNull(); // 点完即收
  });

  it("密码框不给剪切/复制;只读框不给剪切/粘贴", () => {
    const pwd = document.createElement("input");
    pwd.type = "password";
    pwd.value = "secret";
    document.body.appendChild(pwd);
    pwd.setSelectionRange(0, 6);
    let labels = [...(rightClickMenu(pwd)?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
    expect(labels).toEqual(["粘贴", "全选"]);

    document.body.innerHTML = "";
    const ro = document.createElement("textarea");
    ro.value = "abc";
    ro.readOnly = true;
    document.body.appendChild(ro);
    ro.setSelectionRange(0, 3);
    labels = [...(rightClickMenu(ro)?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
    expect(labels).toEqual(["复制", "全选"]);
  });

  it("非输入区无选区:什么都不弹;Esc 关闭已开菜单", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(rightClickMenu(div)).toBeNull();

    const input = document.createElement("input");
    input.value = "x";
    document.body.appendChild(input);
    const menu = rightClickMenu(input);
    expect(menu).toBeTruthy();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector("ul.menu")).toBeNull();
  });
});
