import { describe, expect, it } from "vitest";
import { rankPreviewFiles, selectTurnPreviewArtifact, targetForFile, touchedTurnChanges, turnWarrantsArtifactPreview, typedWorkdirRelativePath, writtenToolPaths } from "./previewArtifact";

describe("typedWorkdirRelativePath", () => {
  it("盘符/分隔符/大小写不敏感地折算 workdir 内的绝对路径", () => {
    expect(typedWorkdirRelativePath("C:\\Proj\\pages\\home.html", "c:/proj")).toBe("pages/home.html");
    expect(typedWorkdirRelativePath("c:/proj/index.html", "C:\\Proj\\")).toBe("index.html");
    expect(typedWorkdirRelativePath("/home/me/proj/index.html", "/home/me/proj")).toBe("index.html");
  });

  it("非绝对路径、工作区外与前缀撞名不折算", () => {
    expect(typedWorkdirRelativePath("pages/home.html", "c:/proj")).toBeNull();
    expect(typedWorkdirRelativePath("c:/other/home.html", "c:/proj")).toBeNull();
    expect(typedWorkdirRelativePath("c:/projx/home.html", "c:/proj")).toBeNull();
    expect(typedWorkdirRelativePath("c:/proj/a.html", undefined)).toBeNull();
  });
});

const files = [
  { path: "src/app.ts", kind: "text" as const, mime: "text/plain", size: 1 },
  { path: "screens/home.png", kind: "image" as const, mime: "image/png", size: 2 },
  { path: "index.html", kind: "html" as const, mime: "text/html", size: 3 },
];

describe("preview artifact selection", () => {
  it("ranks HTML, images and text and filters by path", () => {
    expect(rankPreviewFiles(files).map((f) => f.path)).toEqual(["index.html", "screens/home.png", "src/app.ts"]);
    expect(rankPreviewFiles(files, "HOME").map((f) => f.path)).toEqual(["screens/home.png"]);
  });

  it("turns a candidate into an artifact target", () => {
    expect(targetForFile(files[0]!)).toEqual({ kind: "artifact", path: "src/app.ts", artifactKind: "text" });
  });

  it("prefers changed HTML over images, preferred/user-mentioned names, additions, then keeps index as fallback", () => {
    const selected = selectTurnPreviewArtifact([
      { path: "index.html", status: "A" },
      { path: "screens/hero.png", status: "A" },
      { path: "pages/account.html", status: "A" },
      { path: "pages/design-preview.html", status: "M" },
    ], "Please update the account page design", "Implemented the page");
    expect(selected?.path).toBe("pages/account.html");
    expect(selectTurnPreviewArtifact([
      { path: "index.html", status: "A" },
      { path: "about.html", status: "A" },
    ], "design a website", "done")?.path).toBe("about.html");
  });

  it("uses an existing HTML entry for a design component change and never chooses text", () => {
    expect(selectTurnPreviewArtifact(
      [{ path: "src/Home.tsx", status: "M" }],
      "redesign the home page",
      "updated the UI",
      [
        { path: "README.md", kind: "text", mime: "text/plain", size: 1 },
        { path: "dist/index.html", kind: "html", mime: "text/html", size: 2 },
      ],
    )?.path).toBe("dist/index.html");
    expect(selectTurnPreviewArtifact([{ path: "README.md", status: "A" }], "update docs", "done")).toBeNull();
  });

  it("derives touched paths without admitting stale dirty HTML", () => {
    const baseline = [{ path: "legacy.html", status: "M" }];
    const ending = [...baseline, { path: "src/Login.tsx", status: "M" }];
    expect(touchedTurnChanges(baseline, ending, [])).toEqual([{ path: "src/Login.tsx", status: "M" }]);
    expect(selectTurnPreviewArtifact(touchedTurnChanges(baseline, ending, []), "设计登录页面", "完成", [
      { path: "index.html", kind: "html", mime: "text/html", size: 1 },
    ])?.path).toBe("index.html");
  });

  it("extracts recursive paths only from write-like tools and matches an already dirty file", () => {
    const paths = writtenToolPaths([
      { title: "Read legacy", toolKind: "read", rawInput: { file_path: "legacy.html" } },
      { title: "Write login", toolKind: "write", rawInput: { payload: { filePath: "/p/a/pages/login.html" } } },
    ]);
    expect(paths).toEqual(["/p/a/pages/login.html"]);
    expect(touchedTurnChanges(
      [{ path: "legacy.html", status: "M" }, { path: "pages/login.html", status: "M" }],
      [{ path: "legacy.html", status: "M" }, { path: "pages/login.html", status: "M" }],
      paths,
    )).toEqual([{ path: "pages/login.html", status: "M" }]);
  });

  it("maps absolute write paths into the workdir when the workspace is not a git repo", () => {
    const paths = ["/Users/dev/test-design/index.html"];
    expect(touchedTurnChanges([], [], paths, "/Users/dev/test-design"))
      .toEqual([{ path: "index.html", status: "M" }]);
  });

  it("maps Windows absolute write paths before opening an automatic artifact preview", () => {
    const workdir = "C:/Users/chaitin/AppData/Local/com.chaitin.baizhi.monkeycode/chat-workspaces/chat-4c0b3ca1d3ea2142e40f";
    const paths = [`${workdir}/snake.html`];
    const touched = touchedTurnChanges([], [], paths, workdir.toLocaleLowerCase());
    expect(touched).toEqual([{ path: "snake.html", status: "M" }]);
    expect(selectTurnPreviewArtifact(touched, "写一个贪吃蛇页面", "已完成")?.path).toBe("snake.html");
  });

  it("does not synthesize an artifact for an absolute write path outside the workdir", () => {
    expect(touchedTurnChanges([], [], ["C:/Users/other/snake.html"], "C:/Users/project"))
      .toEqual([]);
  });

  it("classifies only tool action tokens, never read-like substrings in filenames", () => {
    expect(writtenToolPaths([
      { title: "Edit README.md", toolKind: undefined, rawInput: { file_path: "README.md" } },
      { title: "Write search-page.html", toolKind: undefined, rawInput: { path: "search-page.html" } },
      { title: "README.md", toolKind: "functions.Edit", rawInput: { path: "docs/README.md" } },
      { title: "search-page.html", toolKind: "opencode_write", rawInput: { path: "pages/search-page.html" } },
      { title: "Read search-page.html", toolKind: undefined, rawInput: { path: "ignored-title.html" } },
      { title: "README.md", toolKind: "functions.Read", rawInput: { path: "ignored-kind.md" } },
    ])).toEqual(["README.md", "search-page.html", "docs/README.md", "pages/search-page.html"]);
  });

  it("conservatively gates stale whole-worktree changes", () => {
    expect(turnWarrantsArtifactPreview("fix API timeout", "tests pass", [{ path: "old/index.html", status: "M" }])).toBe(false);
    expect(turnWarrantsArtifactPreview("fix API timeout", "tests pass", [{ path: "server.rs", status: "M" }])).toBe(false);
    expect(turnWarrantsArtifactPreview("实现认证接口", "开发完成", [{ path: "src/auth.ts", status: "M" }])).toBe(false);
    expect(turnWarrantsArtifactPreview("设计登录页面", "完成", [{ path: "src/Login.tsx", status: "M" }])).toBe(true);
    expect(turnWarrantsArtifactPreview("build a website", "created it", [{ path: "index.html", status: "A" }])).toBe(true);
  });

  it("opens HTML changed in the current turn without relying on generic development words", () => {
    expect(selectTurnPreviewArtifact(
      [{ path: "index.html", status: "M" }],
      "开始开发",
      "已经实现",
    )?.path).toBe("index.html");
    expect(selectTurnPreviewArtifact(
      [{ path: "src/auth.ts", status: "M" }],
      "实现认证接口",
      "开发完成",
      [{ path: "index.html", kind: "html", mime: "text/html", size: 1 }],
    )).toBeNull();
  });
});
