import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Markdown, renderMarkdown } from "./Markdown";

afterEach(() => {
  vi.unstubAllGlobals();
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
