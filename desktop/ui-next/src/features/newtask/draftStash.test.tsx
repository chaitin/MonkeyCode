import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearNewTaskDraft,
  readCloudTaskDraft,
  readNewTaskDraft,
  resetNewTaskDraftsForTests,
  revokeStalePreviews,
  saveCloudTaskDraft,
  saveNewTaskDraft,
  type NewTaskDraft,
  type StagedAtt,
} from "./draftStash";

const att = (name: string, preview?: string): StagedAtt => ({ file: new File([], name), name, preview });
const draft = (over: Partial<NewTaskDraft> = {}): NewTaskDraft => ({
  kind: "local",
  text: "",
  atts: [],
  dir: null,
  model: "",
  thinkOverride: null,
  enabledSkills: null,
  ...over,
});

afterEach(() => {
  resetNewTaskDraftsForTests();
  vi.restoreAllMocks();
});

describe("新建任务草稿暂存", () => {
  it("正文与附件都空 = 空档不占条目;有内容才留,且不与调用方共享数组", () => {
    saveNewTaskDraft(draft({ text: "  " }));
    expect(readNewTaskDraft()).toBeNull();

    const skills = ["feature-design"];
    saveNewTaskDraft(draft({ text: "改登录页", dir: "/p", model: "gpt-5", thinkOverride: "high", enabledSkills: skills }));
    expect(readNewTaskDraft()).toMatchObject({ text: "改登录页", dir: "/p", model: "gpt-5", thinkOverride: "high", enabledSkills: ["feature-design"] });
    skills.push("code-review");
    expect(readNewTaskDraft()?.enabledSkills).toEqual(["feature-design"]);

    saveNewTaskDraft(draft({ atts: [att("a.txt")] }));
    expect(readNewTaskDraft()?.atts.map((a) => a.name)).toEqual(["a.txt"]);
    saveNewTaskDraft(draft());
    expect(readNewTaskDraft()).toBeNull();
  });

  it("停在云端页签:云端描述非空才值得把页签记住;云端档自己也按描述判空", () => {
    saveNewTaskDraft(draft({ kind: "cloud" }));
    expect(readNewTaskDraft()).toBeNull();

    saveCloudTaskDraft({ content: "跑一遍测试", project: null, repoUrl: "https://x/y.git" });
    saveNewTaskDraft(draft({ kind: "cloud" }));
    expect(readNewTaskDraft()?.kind).toBe("cloud");
    expect(readCloudTaskDraft()).toEqual({ content: "跑一遍测试", project: null, repoUrl: "https://x/y.git" });

    saveCloudTaskDraft({ content: "   ", project: { id: "p1" } as never, repoUrl: "" });
    expect(readCloudTaskDraft()).toBeNull();
  });

  it("预览 URL 跟档走:被替换掉的释放、仍引用的保留、清档全释放", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    saveNewTaskDraft(draft({ atts: [att("a.png", "blob:a"), att("b.png", "blob:b")] }));
    saveNewTaskDraft(draft({ atts: [att("b.png", "blob:b"), att("c.png", "blob:c")] }));
    expect(revoke.mock.calls.map((c) => c[0])).toEqual(["blob:a"]);

    clearNewTaskDraft();
    expect(revoke.mock.calls.map((c) => c[0])).toEqual(["blob:a", "blob:b", "blob:c"]);
    expect(readNewTaskDraft()).toBeNull();
  });

  it("revokeStalePreviews 只撤没人再用的 URL;无预览的条目不碰", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    revokeStalePreviews([att("a", "blob:a"), att("b", "blob:b"), att("c")], [att("b", "blob:b")], []);
    expect(revoke.mock.calls.map((c) => c[0])).toEqual(["blob:a"]);
  });
});
