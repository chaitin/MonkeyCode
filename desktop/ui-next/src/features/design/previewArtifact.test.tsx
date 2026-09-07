import { describe, expect, it } from "vitest";
import { rankPreviewFiles, targetForFile, typedWorkdirRelativePath } from "./previewArtifact";

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
    // sort 原地排的是 filter 产出的新数组,入参顺序不动
    expect(files.map((f) => f.path)).toEqual(["src/app.ts", "screens/home.png", "index.html"]);
  });

  it("turns a candidate into an artifact target", () => {
    expect(targetForFile(files[0]!)).toEqual({ kind: "artifact", path: "src/app.ts", artifactKind: "text" });
  });

});
