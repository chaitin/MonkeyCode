// 自绘文本右键菜单(命令式 DOM,dom 工程按 *.test.tsx 收入)
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openContextMenu } from "./contextMenu";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function rightClickMenu(target: Element) {
  const e = new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 });
  Object.defineProperty(e, "target", { value: target });
  openContextMenu(e);
  return document.querySelector("ul.menu");
}

describe("自绘右键菜单", () => {
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

  it("data URL 图片可复制为 PNG 到系统剪贴板", async () => {
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", { value: { write }, configurable: true });
    let pngBlob: Promise<Blob> | undefined;
    class MockClipboardItem {
      constructor(items: Record<string, Promise<Blob>>) {
        pngBlob = items["image/png"];
      }
    }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["png"], { type: "image/png" }));
    });
    const image = document.createElement("img");
    image.src = "data:image/webp;base64,AAA";
    image.width = 640;
    image.height = 480;
    document.body.appendChild(image);

    const menu = rightClickMenu(image);
    const copyButton = menu?.querySelector("button") as HTMLButtonElement;
    expect(copyButton.textContent).toBe("复制图片");
    expect(copyButton.disabled).toBe(false);
    await userEvent.click(copyButton);

    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 640, 480);
    expect(write).toHaveBeenCalledTimes(1);
    expect((await pngBlob)?.type).toBe("image/png");
  });

  it("超长图片缩放到安全画布范围后再复制", async () => {
    let pngBlob: Promise<Blob> | undefined;
    class MockClipboardItem {
      constructor(items: Record<string, Promise<Blob>>) {
        pngBlob = items["image/png"];
      }
    }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", { value: { write }, configurable: true });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const encodedSizes: Array<[number, number]> = [];
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
      encodedSizes.push([this.width, this.height]);
      callback(new Blob(["png"], { type: "image/png" }));
    });
    const image = document.createElement("img");
    image.src = "data:image/png;base64,AAA";
    Object.defineProperties(image, {
      naturalWidth: { value: 1200 },
      naturalHeight: { value: 40000 },
    });
    document.body.appendChild(image);

    await userEvent.click(rightClickMenu(image)?.querySelector("button") as HTMLElement);

    expect(write).toHaveBeenCalledTimes(1);
    expect(encodedSizes).toEqual([[245, 8192]]);
    expect((await pngBlob)?.type).toBe("image/png");
  });

  it("剪贴板图片 API 不可用时说明原因", () => {
    vi.stubGlobal("ClipboardItem", undefined);
    Object.defineProperty(window.navigator, "clipboard", { value: {}, configurable: true });
    const image = document.createElement("img");
    image.src = "data:image/png;base64,AAA";
    document.body.appendChild(image);

    const button = rightClickMenu(image)?.querySelector("button") as HTMLButtonElement;
    expect(button.textContent).toBe("复制图片");
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("当前环境不支持复制图片");
  });

  it("不为跨域图片提供必然受 canvas 安全限制的复制项", () => {
    const image = document.createElement("img");
    image.src = "https://example.com/result.png";
    document.body.appendChild(image);
    expect(rightClickMenu(image)).toBeNull();
  });
});
