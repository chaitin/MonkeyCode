import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ModelMenuItem } from "./chat";

describe("ModelMenuItem", () => {
  it("本地和云端共用整行 hover 与当前项勾选", () => {
    const html = renderToStaticMarkup(<ModelMenuItem label="测试模型" selected onClick={vi.fn()} />);

    expect(html).toContain('class="hv menu-item"');
    expect(html).toContain("width:100%");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("测试模型");
  });
});
