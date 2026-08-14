import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Markdown, renderMarkdown } from "./Markdown";

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
  bindFunctions: vi.fn(),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: mermaidMock.initialize,
    render: mermaidMock.render,
  },
}));

beforeEach(() => {
  mermaidMock.initialize.mockReset();
  mermaidMock.render.mockReset().mockResolvedValue({
    svg: '<svg data-testid="mermaid-svg"><text>流程图</text></svg>',
    bindFunctions: mermaidMock.bindFunctions,
  });
  mermaidMock.bindFunctions.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.colorScheme = "";
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

describe("markdown 渲染", () => {
  it("标题/列表/行内代码正常产出(preflight 清零后靠 md.css 补齐,这里断结构)", () => {
    const { container } = render(<Markdown source={"# 标题\n\n- 甲\n- 乙\n\n`code`"} />);
    expect(container.querySelector("h1")?.textContent).toBe("标题");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("围栏代码带高亮与复制按钮;点复制写剪贴板并给反馈", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = render(<Markdown source={"```js\nconst a = 1;\n```"} />);
    expect(container.querySelector("code.hljs")).toBeTruthy();
    const btn = screen.getByRole("button", { name: "复制" });
    await userEvent.click(btn);
    expect(writeText).toHaveBeenCalledWith("const a = 1;");
    expect(btn.textContent).toBe("已复制");
  });

  it("Mermaid 围栏渲染为 SVG 并绑定交互", async () => {
    const { container } = render(<Markdown source={"```mermaid\ngraph TD\nA-->B\n```"} />);
    await waitFor(() => expect(container.querySelector(".md-mermaid svg")).toBeTruthy());
    const diagram = container.querySelector<HTMLElement>(".md-mermaid");
    expect(diagram?.textContent).toBe("流程图");
    expect(mermaidMock.bindFunctions).toHaveBeenCalledWith(diagram);
  });

  it("暗色模式使用 Mermaid dark 主题", async () => {
    document.documentElement.style.colorScheme = "dark";
    render(<Markdown source={"```mermaid\ngraph TD\nA-->B\n```"} />);
    await waitFor(() =>
      expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "dark" })),
    );
  });

  it("Mermaid 右键菜单可复制 PNG 与 SVG 源码", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(window.navigator, "clipboard", { value: { write, writeText }, configurable: true });
    let pngTypes: string[] = [];
    let pngBlob: Promise<Blob> | undefined;
    class MockClipboardItem {
      constructor(items: Record<string, Promise<Blob>>) {
        pngTypes = Object.keys(items);
        pngBlob = items["image/png"];
      }
    }
    class MockImage {
      onload: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    vi.stubGlobal("Image", MockImage);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mermaid");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      scale: vi.fn(),
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["png"], { type: "image/png" }));
    });

    render(<Markdown source={"```mermaid\ngraph TD\nA-->B\n```"} />);
    const svg = await screen.findByTestId("mermaid-svg");
    fireEvent.contextMenu(svg, { clientX: 20, clientY: 30 });
    expect((screen.getByRole("button", { name: "复制图片" }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "复制 SVG 源码" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("<svg"));

    fireEvent.contextMenu(svg, { clientX: 20, clientY: 30 });
    await userEvent.click(screen.getByRole("button", { name: "复制图片" }));
    expect(pngTypes).toEqual(["image/png"]);
    expect(write).toHaveBeenCalledTimes(1);
    expect((await pngBlob)?.type).toBe("image/png");
  });

  it("保留 Mermaid architecture 图中的 foreignObject 内容", async () => {
    mermaidMock.render.mockResolvedValueOnce({
      svg: '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">API</div></foreignObject></svg>',
    });
    const { container } = render(<Markdown source={'```mermaid\narchitecture-beta\nservice api "API"\n```'} />);
    await waitFor(() => expect(container.querySelector("foreignObject")?.textContent).toBe("API"));
  });

  it("Mermaid 异步生成的本地图片通过回读通道加载", async () => {
    mermaidMock.render.mockResolvedValueOnce({
      svg: '<svg><foreignObject><img src=".monkeycode/uploads/shot.png"></foreignObject></svg>',
    });
    const localImageUrl = vi.fn(async () => "data:image/png;base64,AA==");
    const { container } = render(
      <Markdown source={'```mermaid\ngraph TD\nA["<img src=\'.monkeycode/uploads/shot.png\'>"]\n```'} localImageUrl={localImageUrl} />,
    );
    const image = await waitFor(() => {
      const img = container.querySelector<HTMLImageElement>(".md-mermaid img");
      expect(img?.src).toBe("data:image/png;base64,AA==");
      return img;
    });
    expect(image).toBeTruthy();
    expect(localImageUrl).toHaveBeenCalledWith(".monkeycode/uploads/shot.png");
  });

  it("Mermaid image 节点在渲染前解析本地图片", async () => {
    const localImageUrl = vi.fn(async () => "data:image/png;base64,AA==");
    render(
      <Markdown
        source={'```mermaid\nflowchart TD\nA@{ img: ".monkeycode/uploads/shot.png", label: "截图" }\n```'}
        localImageUrl={localImageUrl}
      />,
    );
    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalled());
    expect(mermaidMock.render.mock.calls[0]?.[1]).toContain('img: "data:image/png;base64,AA=="');
  });

  it("CSSStyleSheet 不可构造时安装 Mermaid 兼容实现", async () => {
    vi.stubGlobal("CSSStyleSheet", function CSSStyleSheet() {
      throw new TypeError("Illegal constructor");
    });
    mermaidMock.render.mockImplementationOnce(async () => {
      const sheet = new CSSStyleSheet();
      sheet.insertRule(".node { color: red; }");
      expect(sheet.cssRules[0]?.cssText).toBe(".node { color: red; }");
      return { svg: "<svg></svg>" };
    });
    render(<Markdown source={"```mermaid\ngraph TD\nA-->B\n```"} />);
    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalled());
  });

  it("流式阶段暂缓 Mermaid，结束后只提交一次渲染", async () => {
    const source = "```mermaid\ngraph TD\nA-->B\n```";
    const { container, rerender } = render(<Markdown source={source} deferMermaid />);
    expect(container.querySelector(".md-mermaid")?.getAttribute("aria-busy")).toBe("true");
    expect(mermaidMock.render).not.toHaveBeenCalled();

    rerender(<Markdown source={source} />);
    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalledTimes(1));
  });

  it("卸载后不再把剩余 Mermaid 图加入队列", async () => {
    let finishFirst: ((value: { svg: string }) => void) | undefined;
    mermaidMock.render.mockImplementationOnce(
      () =>
        new Promise<{ svg: string }>((resolve) => {
          finishFirst = resolve;
        }),
    );
    const source = "```mermaid\ngraph TD\nA-->B\n```\n\n```mermaid\ngraph TD\nC-->D\n```";
    const { unmount } = render(<Markdown source={source} />);
    await waitFor(() => expect(mermaidMock.render).toHaveBeenCalledTimes(1));
    unmount();
    finishFirst?.({ svg: "<svg></svg>" });
    await Promise.resolve();
    expect(mermaidMock.render).toHaveBeenCalledTimes(1);
  });

  it("Mermaid 初始化失败时结束 busy 并保留源码", async () => {
    mermaidMock.initialize.mockImplementationOnce(() => {
      throw new Error("chunk failed");
    });
    const { container } = render(<Markdown source={"```mermaid\ngraph TD\nA-->B\n```"} />);
    const diagram = container.querySelector<HTMLElement>(".md-mermaid");
    await waitFor(() => expect(diagram?.hasAttribute("aria-busy")).toBe(false));
    expect(diagram?.textContent).toContain("graph TD");
  });

  it("链接不走 webview 导航:壳内交 opener", async () => {
    const calls: string[] = [];
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string) => {
          calls.push(cmd);
          return Promise.resolve(null);
        },
      },
    };
    render(<Markdown source={"[官网](https://example.com)"} />);
    await userEvent.click(screen.getByRole("link", { name: "官网" }));
    expect(calls).toContain("plugin:opener|open_url");
  });

  it("净化:script 与事件属性被剥掉;表格包进横滚容器", () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>\n\n|a|b|\n|-|-|\n|1|2|');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).toContain('class="md-scroll"');
  });
});

describe("本地资源(工作区图片/文件链接)", () => {
  it("本地图打标去 src,经 localImageUrl 异步注入 data URL", async () => {
    render(
      <Markdown
        source={"![截图](.monkeycode/uploads/shot.png)"}
        localImageUrl={() => Promise.resolve("data:image/png;base64,AAA")}
      />,
    );
    const img = await screen.findByRole("img", { name: "截图" });
    await waitFor(() => expect(img.getAttribute("src")).toBe("data:image/png;base64,AAA"));
  });

  it("正文伪造的 data-mc-local-src 被清除,不指使 UI 读任意路径", () => {
    const html = renderMarkdown('<img data-mc-local-src="/etc/passwd" src="https://ok.example/x.png">');
    expect(html).not.toContain("/etc/passwd");
    expect(html).toContain("https://ok.example/x.png");
  });

  it("本地链接触发 onLocalLink 而非 openExternal;外链仍走 opener", async () => {
    const calls: string[] = [];
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: (cmd: string) => {
          calls.push(cmd);
          return Promise.resolve(null);
        },
      },
    };
    const local: string[] = [];
    render(<Markdown source={"[看这个文件](src/main.rs)"} onLocalLink={(p) => local.push(p)} />);
    await userEvent.click(screen.getByRole("link", { name: "看这个文件" }));
    expect(local).toEqual(["src/main.rs"]);
    expect(calls).not.toContain("plugin:opener|open_url");
  });
  it("Mermaid 图内相对链接触发 onLocalLink", async () => {
    mermaidMock.render.mockResolvedValueOnce({
      svg: '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="src/main.rs"><text>看图内文件</text></a></svg>',
    });
    const onLocalLink = vi.fn();
    render(<Markdown source={'```mermaid\ngraph TD\nclick A "src/main.rs"\n```'} onLocalLink={onLocalLink} />);
    await userEvent.click(await screen.findByText("看图内文件"));
    expect(onLocalLink).toHaveBeenCalledWith("src/main.rs");
  });

  // hljs 是同步 CPU 活,兆级代码块一块就是秒级主线程冻结(2026-08-10
  // 切会话/跳转卡顿分析)——超过 50KB 降级为转义直出,等宽样式保留
  it("超大代码块(>50KB)不做语法高亮,内容仍转义直出", () => {
    const big = "const a = 1;\n".repeat(5000); // ~65KB
    const { container } = render(<Markdown source={"```ts\n" + big + "```"} />);
    const code = container.querySelector("code");
    expect(code?.className).not.toContain("language-ts");
    expect(container.querySelector(".hljs-keyword")).toBeNull();
    expect(code?.textContent).toContain("const a = 1;");
  });

  // marked 18 把整条 info string 塞进 lang:```ts twoslash 这类围栏不切首词
  // 就永远命不中 hljs.getLanguage,一律降级成无高亮
  it("围栏 info string 带元信息时仍按首词高亮", () => {
    const { container } = render(<Markdown source={"```ts twoslash\nconst a = 1;\n```"} />);
    const code = container.querySelector("code");
    expect(code?.className).toContain("language-ts");
    expect(container.querySelector(".hljs-keyword")).not.toBeNull();
  });

  it("未知语言不加 language- 类,内容照常转义", () => {
    const { container } = render(<Markdown source={"```不存在的语言\n<b>x</b>\n```"} />);
    const code = container.querySelector("code");
    expect(code?.className).not.toContain("language-");
    expect(code?.textContent).toContain("<b>x</b>");
  });

  // GFM 的 |---:| / |:-:| 全靠 td 的 align;不发就是整表左对齐
  it("表格数据行带 align(表头由 md.css 统一左对齐,不发)", () => {
    const { container } = render(<Markdown source={"| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |"} />);
    const tds = [...container.querySelectorAll("td")].map((td) => td.getAttribute("align"));
    expect(tds).toEqual(["left", "center", "right"]);
  });
});
