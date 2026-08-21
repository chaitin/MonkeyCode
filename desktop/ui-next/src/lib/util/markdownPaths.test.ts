import { describe, expect, it } from "vitest";
import { resolveMarkdownPath, resolveMarkdownResource, workspaceRelativePath } from "./markdownPaths";

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

  it("本地资源去掉 raw query/fragment，但保留编码后的特殊文件名字符", () => {
    expect(resolveMarkdownResource("./guide.md#install")).toEqual({ kind: "local", path: "./guide.md" });
    expect(resolveMarkdownResource("./logo.png?v=2")).toEqual({ kind: "local", path: "./logo.png" });
    expect(resolveMarkdownResource("./guide%23draft%3Ffinal.md?download=1#top")).toEqual({
      kind: "local",
      path: "./guide#draft?final.md",
    });
    expect(resolveMarkdownResource("file:///workspace/logo%3Fv2%23dark.png?ignored=1#ignored")).toEqual({
      kind: "local",
      path: "/workspace/logo?v2#dark.png",
    });
  });
});

describe("resolveMarkdownPath", () => {
  it("相对资源按 Markdown 文件目录解析并统一反斜杠", () => {
    expect(resolveMarkdownPath("docs/guide/readme.md", "./images/cat.png")).toBe("docs/guide/images/cat.png");
    expect(resolveMarkdownPath("docs\\guide\\readme.md", "..\\images\\cat.png")).toBe("docs/images/cat.png");
  });

  it("保留并归一化 Unix/Windows 绝对路径", () => {
    expect(resolveMarkdownPath("docs/readme.md", "/workspace/assets/../cat.png")).toBe("/workspace/cat.png");
    expect(resolveMarkdownPath("docs/readme.md", "C:\\Work\\Demo\\cat.png")).toBe("C:/Work/Demo/cat.png");
  });

  it("词法拒绝相对路径逃出工作区根", () => {
    expect(resolveMarkdownPath("docs/readme.md", "../cat.png")).toBe("cat.png");
    expect(resolveMarkdownPath("docs/readme.md", "../../cat.png")).toBeNull();
    expect(resolveMarkdownPath("readme.md", "..\\cat.png")).toBeNull();
  });
});

describe("workspaceRelativePath", () => {
  it("接受工作区内绝对/相对路径,拒绝工作区外及词法逃逸路径", () => {
    expect(workspaceRelativePath("/Users/maxiao/test/cat.jpg", "/Users/maxiao/test")).toBe("cat.jpg");
    expect(workspaceRelativePath("./images/cat.jpg", "")).toBe("images/cat.jpg");
    expect(workspaceRelativePath("../cat.jpg", "/Users/maxiao/test")).toBeNull();
    expect(workspaceRelativePath("/Users/maxiao/test/../other/cat.jpg", "/Users/maxiao/test")).toBeNull();
    expect(workspaceRelativePath("/Users/maxiao/other/cat.jpg", "/Users/maxiao/test")).toBeNull();
  });

  it("Windows 盘符比较不区分大小写", () => {
    expect(workspaceRelativePath("c:\\Work\\Demo\\cat.jpg", "C:\\Work\\Demo")).toBe("cat.jpg");
  });
});
