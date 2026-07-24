import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LogList } from "./components";

describe("思考块布局", () => {
  it("与 assistant 正文使用相同的最大宽度", () => {
    const html = renderToStaticMarkup(
      <LogList
        items={[{ kind: "thought", text: "正在分析问题" }]}
        onPermAnswer={() => {}}
      />,
    );

    expect(html).toContain("max-width:92%");
    expect(html).toContain("思考");
  });
});
