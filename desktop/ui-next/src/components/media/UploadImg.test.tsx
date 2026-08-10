import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Lightbox, UploadImg } from "./UploadImg";

describe("UploadImg:壳异步回读", () => {
  it("回读成功才渲染 img,src = data URL", async () => {
    render(<UploadImg load={() => Promise.resolve("data:image/png;base64,AAA")} alt="up/a.png" />);
    const img = await screen.findByRole("img", { name: "up/a.png" });
    expect(img.getAttribute("src")).toBe("data:image/png;base64,AAA");
  });

  it("回读失败不渲染(永不出裂图)", async () => {
    const load = vi.fn().mockRejectedValue(new Error("越界"));
    const { container } = render(<UploadImg load={load} alt="up/b.png" />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("Lightbox:大图浮层", () => {
  it("dialog 语义 + Esc 关闭且截断(不漏给全局链)", async () => {
    const onClose = vi.fn();
    const leaked = vi.fn();
    window.addEventListener("keydown", leaked);
    render(
      <Lightbox alt="up/a.png" onClose={onClose}>
        <img src="data:image/png;base64,AAA" alt="up/a.png" />
      </Lightbox>,
    );
    expect(screen.getByRole("dialog", { name: "up/a.png" })).toBeTruthy();
    // 从 body 派发(bubbles):window capture 先于 window bubble,截断可测
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(leaked).not.toHaveBeenCalled();
    window.removeEventListener("keydown", leaked);
  });
});
