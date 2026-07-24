import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LogList } from "./components";

describe("MessageTime", () => {
  it("用户气泡时间保持在气泡上方", () => {
    const html = renderToStaticMarkup(
      <LogList
        items={[{ kind: "user", text: "用户消息", timestamp: 1_000 }]}
        onPermAnswer={vi.fn()}
      />,
    );

    expect(html).toContain("top:-20px;right:0");
    expect(html).not.toContain("top:-16px;right:0");
  });
});
