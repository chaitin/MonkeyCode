import { describe, expect, it } from "vitest";
import { resolveMarkdownResource, workspaceRelativePath } from "./markdownPaths";

describe("resolveMarkdownResource", () => {
  it("解码 macOS/Unix 空格路径", () => {
    expect(resolveMarkdownResource("/Users/maxiao/My%20Cat/cat.jpg")).toEqual({
      kind: "local",
      path: "/Users/maxiao/My Cat/cat.jpg",
    });
  });

  it("解码 Marked 编码后的 Windows 路径", () => {
    expect(resolveMarkdownResource("C:%5CUsers%5Cmaxiao%5Ccat.jpg")).toEqual({
      kind: "local",
      path: "C:\\Users\\maxiao\\cat.jpg",
    });
  });

  it("支持 file URL 并把协议相对 CDN 固定为 HTTPS", () => {
    expect(resolveMarkdownResource("file:///Users/maxiao/My%20Cat/cat.jpg")).toEqual({
      kind: "local",
      path: "/Users/maxiao/My Cat/cat.jpg",
    });
    expect(resolveMarkdownResource("//cdn.example.com/cat.jpg")).toEqual({
      kind: "url",
      src: "https://cdn.example.com/cat.jpg",
    });
  });
});

describe("workspaceRelativePath", () => {
  it("接受工作区内绝对/相对路径,拒绝工作区外路径", () => {
    expect(workspaceRelativePath("/Users/maxiao/test/cat.jpg", "/Users/maxiao/test")).toBe("cat.jpg");
    expect(workspaceRelativePath("./images/cat.jpg", "/Users/maxiao/test")).toBe("images/cat.jpg");
    expect(workspaceRelativePath("/Users/maxiao/other/cat.jpg", "/Users/maxiao/test")).toBeNull();
  });

  it("Windows 盘符比较不区分大小写", () => {
    expect(workspaceRelativePath("c:\\Work\\Demo\\cat.jpg", "C:\\Work\\Demo")).toBe("cat.jpg");
  });
});
