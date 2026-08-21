import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesignTemplateSelectionItem } from "@/lib/protocol/types";
import { createDesignTemplateBlobUrl, DesignTemplateSelectionCard } from "./DesignTemplateSelectionCard";

const ITEM: DesignTemplateSelectionItem = {
  kind: "design-template-selection",
  requestId: "d1",
  mode: "direction",
  title: "Visual direction",
  description: "Pick one",
  items: [
    { id: "clean", title: "Clean", image: "clean.png", previewDigest: "sha-clean", recommended: true, reason: "Matches your brief" },
    { id: "live", title: "Live", image: "fallback.png", preview: { type: "html", path: "bundle/index.html" }, previewDigest: "sha-live" },
    { id: "bold", title: "Bold", image: "bold.png", previewDigest: "sha-bold" },
  ],
  allowedActions: { select: true, next: true, direct: true, cancel: true },
  refinement: { enabled: true },
  state: "open",
};

afterEach(() => vi.restoreAllMocks());

describe("DesignTemplateSelectionCard", () => {
  it("renders recommendation, trusted reason, optional refinement and the three actions", () => {
    render(<DesignTemplateSelectionCard item={ITEM} sessionId="s1" sendFrame={vi.fn()} />);
    expect(screen.getByText("推荐")).toBeTruthy();
    expect(screen.getByText(/Matches your brief/)).toBeTruthy();
    const clean = screen.getByRole("button", { name: /Clean/ });
    expect(clean.className).toContain("flex");
    const choices = clean.parentElement as HTMLElement;
    expect(choices.className).toContain("grid");
    expect(choices.className).toContain("items-start");
    expect(choices.className).toContain("content-start");
    expect(choices.style.gridTemplateColumns).toContain("auto-fit");
    expect(clean.lastElementChild?.className).not.toContain("flex-1");
    expect(clean.querySelector(".aspect-video")).toBeTruthy();
    expect(clean.querySelector("strong")?.className).toContain("line-clamp-2");
    expect(screen.getByText(/Matches your brief/).className).toContain("line-clamp-3");
    const refinement = screen.getByRole("textbox", { name: "补充你的设计条件（可选）" });
    const templatePanel = screen.getByRole("region", { name: "Visual direction" });
    expect(refinement.tagName).toBe("TEXTAREA");
    expect(refinement.className).not.toContain("input-sm");
    expect(templatePanel.contains(refinement)).toBe(true);
    expect(refinement.closest("footer")).toBe(templatePanel.lastElementChild);
    expect(screen.getByRole("button", { name: "选择" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "换一批" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "不使用设计方向" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
  });

  it.each([
    ["Clean", "clean", "clean.png", "sha-clean"],
    ["Live", "live", "fallback.png", "sha-live"],
    ["Bold", "bold", "bold.png", "sha-bold"],
  ])("binds the %s card to its own id, rendered path and digest", async (title, id, path, digest) => {
    const sender = vi.fn();
    const uploadUrl = vi.fn(async (previewPath: string) => `data:image/png;base64,${previewPath}`);
    render(<DesignTemplateSelectionCard item={ITEM} sessionId="s1" sendFrame={sender} uploadUrl={uploadUrl} />);
    await screen.findByRole("img", { name: title });
    expect(uploadUrl).toHaveBeenCalledWith(path, digest);
    await userEvent.click(screen.getByRole("button", { name: new RegExp(title) }));
    await userEvent.click(screen.getByRole("button", { name: "选择" }));
    await userEvent.click(screen.getByRole("button", { name: "按这个设计开发" }));
    await waitFor(() => expect(sender).toHaveBeenCalledWith("design/selection/respond", {
      request_id: "d1", action: "select", selected_id: id,
      selected_preview_path: path, selected_preview_digest: digest,
    }));
  });

  it("uses template-specific confirmation and skip labels", async () => {
    const sender = vi.fn();
    render(<DesignTemplateSelectionCard item={{ ...ITEM, mode: "template" }} sessionId="s1" sendFrame={sender} uploadUrl={async (path) => path} />);
    await screen.findByRole("img", { name: "Clean" });
    await userEvent.click(screen.getByRole("button", { name: /Clean/ }));
    await userEvent.click(screen.getByRole("button", { name: "选择" }));

    expect(screen.getByRole("button", { name: "按此模板开发" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "重新选择" }));
    const skip = screen.getByRole("button", { name: "不使用模板" });
    expect(skip).toBeTruthy();
    await userEvent.click(skip);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已选择不使用模板"));
    expect(sender).toHaveBeenLastCalledWith("design/selection/respond", { request_id: "d1", action: "direct" });
  });

  it("confirms the selected design before sending, retries on failure, then becomes terminal", async () => {
    let rejectFirst = true;
    const sender = vi.fn(async () => {
      if (rejectFirst) throw new Error("offline");
    });
    render(<DesignTemplateSelectionCard item={ITEM} sessionId="s1" sendFrame={sender} uploadUrl={async (path) => `data:image/png;base64,${path}`} />);
    await screen.findByRole("img", { name: "Clean" });
    await userEvent.click(screen.getByRole("button", { name: /Clean/ }));
    await userEvent.click(screen.getByRole("button", { name: "选择" }));

    expect(sender).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "按这个设计开发" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新选择" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "换一批" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "补充你的设计条件（可选）" })).toBeTruthy();
    expect(screen.getByText("已选择：Clean")).toBeTruthy();
    const selectedImage = await screen.findByRole("img", { name: "Clean" });
    expect(selectedImage.className).toContain("object-contain");
    expect(selectedImage.closest(".aspect-video")).toBeNull();

    const confirm = screen.getByRole("button", { name: "按这个设计开发" });
    await userEvent.click(confirm);
    expect((await screen.findByRole("alert")).textContent).toContain("提交失败，请重试");
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    rejectFirst = false;
    await userEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已选择 · Clean"));
    expect(sender).toHaveBeenLastCalledWith("design/selection/respond", {
      request_id: "d1", action: "select", selected_id: "clean",
      selected_preview_path: "clean.png", selected_preview_digest: "sha-clean",
    });
    expect(screen.queryByRole("button", { name: "按这个设计开发" })).toBeNull();
  });

  it("keeps the selected design visible in history", async () => {
    const uploadUrl = vi.fn(async (path: string) => `data:image/png;base64,${path}`);
    render(
      <DesignTemplateSelectionCard
        item={{
          ...ITEM,
          items: [{ id: "clean", title: "Clean", image: "clean.png", reason: "Matches your brief" }],
          state: "responded", action: "select", selectedId: "clean",
        }}
        sessionId="s1"
        uploadUrl={uploadUrl}
      />,
    );

    const card = screen.getByRole("region", { name: "Visual direction" });
    expect(screen.getByRole("status").textContent).toContain("已选择 · Clean");
    expect(card.textContent).toContain("Matches your brief");
    const image = await screen.findByRole("img", { name: "Clean" });
    expect(image.className).toContain("h-auto");
    expect(image.className).toContain("object-contain");
    expect(image.closest(".aspect-video")).toBeNull();
    expect(uploadUrl).toHaveBeenCalledWith("clean.png", undefined);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("sends next with refinement text from the confirmation view", async () => {
    const sender = vi.fn();
    render(<DesignTemplateSelectionCard item={ITEM} sessionId="s1" sendFrame={sender} uploadUrl={async (path) => path} />);
    await screen.findByRole("img", { name: "Clean" });
    await userEvent.click(screen.getByRole("button", { name: /Clean/ }));
    await userEvent.click(screen.getByRole("button", { name: "选择" }));
    await userEvent.type(screen.getByRole("textbox", { name: "补充你的设计条件（可选）" }), "更亮一点");
    await userEvent.click(screen.getByRole("button", { name: "换一批" }));
    await waitFor(() =>
      expect(sender).toHaveBeenCalledWith("design/selection/respond", { request_id: "d1", action: "next", refinement_text: "更亮一点" }),
    );
    expect(screen.getByRole("status").textContent).toContain("已请求换一批");
  });

  it("requires selection again when refreshed candidates invalidate the confirmation", async () => {
    const sender = vi.fn();
    const uploadUrl = async (path: string) => path;
    const { rerender } = render(<DesignTemplateSelectionCard item={ITEM} sessionId="s1" sendFrame={sender} uploadUrl={uploadUrl} />);
    await screen.findByRole("img", { name: "Clean" });
    await userEvent.click(screen.getByRole("button", { name: /Clean/ }));
    await userEvent.click(screen.getByRole("button", { name: "选择" }));

    const refreshed = {
      ...ITEM,
      items: ITEM.items.map((candidate) => candidate.id === "clean"
        ? { ...candidate, image: "clean-v2.png", previewDigest: "sha-clean-v2" }
        : candidate),
    };
    rerender(<DesignTemplateSelectionCard item={refreshed} sessionId="s1" sendFrame={sender} uploadUrl={uploadUrl} />);
    await userEvent.click(screen.getByRole("button", { name: /Bold/ }));

    expect(screen.getByRole("button", { name: "选择" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "按这个设计开发" })).toBeNull();
    expect(sender).not.toHaveBeenCalled();
  });

  it("renders a cancel fallback when cancel is the only allowed action", async () => {
    const sender = vi.fn();
    render(
      <DesignTemplateSelectionCard
        item={{ ...ITEM, allowedActions: { select: false, next: false, direct: false, cancel: true } }}
        sessionId="s1"
        sendFrame={sender}
      />,
    );
    expect(screen.queryByRole("button", { name: "选择" })).toBeNull();
    expect(screen.queryByRole("button", { name: "换一批" })).toBeNull();
    expect(screen.queryByRole("button", { name: "不使用设计方向" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    await waitFor(() => expect(sender).toHaveBeenCalledWith("design/selection/respond", { request_id: "d1", action: "cancel" }));
    expect(screen.getByRole("status").textContent).toContain("已取消选择");
  });

  it("renders open cards readonly without actions", () => {
    render(<DesignTemplateSelectionCard item={ITEM} sessionId="child" readonly />);
    expect(screen.getByRole("status").textContent).toContain("未答复");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("prefers reliable thumbnail images when HTML previews are also available", async () => {
    const uploadUrl = vi.fn(async (path: string) => `data:image/png;base64,${path}`);
    const loadHtml = vi.fn(async () => "<main>preview</main>");
    render(
      <DesignTemplateSelectionCard
        item={ITEM}
        sessionId="s1"
        sendFrame={vi.fn()}
        uploadUrl={uploadUrl}
        loadHtml={loadHtml}
      />,
    );
    await waitFor(() => expect(uploadUrl).toHaveBeenCalledTimes(3));
    expect(uploadUrl.mock.calls).toEqual([
      ["clean.png", "sha-clean"],
      ["fallback.png", "sha-live"],
      ["bold.png", "sha-bold"],
    ]);
    expect(loadHtml).not.toHaveBeenCalled();
  });

  it("shows an error and prevents selection when digest-verified image reading fails", async () => {
    const uploadUrl = vi.fn(async () => { throw new Error("digest mismatch"); });
    render(
      <DesignTemplateSelectionCard
        item={{ ...ITEM, items: [ITEM.items[2]!] }}
        sessionId="s1"
        sendFrame={vi.fn()}
        uploadUrl={uploadUrl}
      />,
    );
    expect(await screen.findByText("动态预览加载失败")).toBeTruthy();
    expect(uploadUrl).toHaveBeenCalledWith("bold.png", "sha-bold");
    expect((screen.getByRole("button", { name: /Bold/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "选择" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps a broken HTML preview blank instead of showing loading forever", async () => {
    const loadHtml = vi.fn(() => new Promise<string>(() => {}));
    render(
      <DesignTemplateSelectionCard
        item={{ ...ITEM, items: [{ ...ITEM.items[1]!, image: undefined, previewDigest: undefined }] }}
        sessionId="s1"
        sendFrame={vi.fn()}
        loadHtml={loadHtml}
      />,
    );
    await waitFor(() => expect(loadHtml).toHaveBeenCalledOnce());
    expect(screen.queryByText("动态预览加载中…")).toBeNull();
  });

  it("creates UTF-8 HTML blobs and uses an opaque script sandbox when no thumbnail exists", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const { unmount } = render(
      <DesignTemplateSelectionCard
        item={{ ...ITEM, items: [{ ...ITEM.items[1]!, image: undefined, previewDigest: undefined }] }}
        sessionId="s1"
        sendFrame={vi.fn()}
        loadHtml={async () => "<script>window.previewRan=true</script>"}
      />,
    );
    await waitFor(() => expect(screen.getByTitle("Live 动态预览")).toBeTruthy());
    const iframe = screen.getByTitle("Live 动态预览");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(create).toHaveBeenCalledOnce();
    const blob = create.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("text/html;charset=utf-8");
    expect(createDesignTemplateBlobUrl("<p>x</p>")).toBe("blob:preview");
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:preview");
  });
});
