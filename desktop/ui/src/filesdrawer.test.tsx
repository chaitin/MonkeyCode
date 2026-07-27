import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FilesDrawer, type FsAdapter } from "./filesdrawer";

const adapter: FsAdapter = {
  listDir: async () => [],
  readFile: async () => ({ content: "" }),
  diff: async () => "",
  diffTransientKind: "diff",
};

const renderDrawer = (showChangesTab: boolean, initialTab: "files" | "changes" = "files") =>
  renderToStaticMarkup(
    <FilesDrawer
      adapter={adapter}
      onClose={() => {}}
      initialTab={initialTab}
      changes={[]}
      showChangesTab={showChangesTab}
      errPad="0"
      changesEmptyText="没有文件改动"
      viewerCloseTitle="关闭预览"
    />,
  );

describe("FilesDrawer 上传入口", () => {
  it("adapter 无 upload:不渲染上传按钮(本地抽屉保持只读现状)", () => {
    expect(renderDrawer(true)).not.toContain("上传文件到工作区根目录");
  });

  it("adapter 带 upload(云端 VM 就绪):header 出现根目录上传按钮", () => {
    const html = renderToStaticMarkup(
      <FilesDrawer
        adapter={{ ...adapter, upload: async () => {} }}
        onClose={() => {}}
        changes={[]}
        errPad="0"
        changesEmptyText="没有文件改动"
        viewerCloseTitle="关闭预览"
      />,
    );
    expect(html).toContain("上传文件到工作区根目录");
  });
});

describe("FilesDrawer tabs", () => {
  it("hides the changes tab for a non-git workspace", () => {
    const html = renderDrawer(false, "changes");

    expect(html).toContain(">文件</button>");
    expect(html).not.toContain(">改动</button>");
  });

  it("shows the changes tab for a git workspace", () => {
    expect(renderDrawer(true)).toContain(">改动</button>");
  });
});
