import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Frame, PermItem, ToolItem } from "@/lib/protocol/types";
import { ToolCard } from "./ToolCard";

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

/** 最小壳桩:engine_caps 全开、session_send 应答成功(乐观态成立)。 */
function stubShell() {
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string) =>
        cmd === "engine_caps"
          ? Promise.resolve({ browser_ext: false, usage_update: true, perm_remember: true, attachments: true })
          : Promise.resolve(undefined),
    },
  };
}

const BASE: ToolItem = { kind: "tool", tcId: "t1", title: "Bash npm test", status: "ok", out: "", rawInput: { command: "npm test" } };

describe("工具卡", () => {
  it("标题拆「动作 + 目标」+ 耗时;悬停露原始标题与完整目标", () => {
    const { container } = render(<ToolCard item={{ ...BASE, durationMs: 1234 }} sessionId="s1" />);
    expect(container.firstElementChild?.classList.contains("mc-workbench-material")).toBe(true);
    expect(screen.getByText("执行命令")).toBeTruthy(); // 动作中文映射
    expect(screen.getByTitle("Bash npm test")).toBeTruthy(); // 动作悬停 = 原始标题
    expect(screen.getByTitle("npm test")).toBeTruthy(); // 目标悬停 = 完整目标
    expect(screen.getByText("1.2s")).toBeTruthy();
  });

  it("path 型目标:目录段与文件名分离(截断保末段),workdir 前缀剥掉", () => {
    render(
      <ToolCard
        item={{ kind: "tool", tcId: "t2", title: "Read /w/src/main.rs", status: "ok", out: "", rawInput: { file_path: "/w/src/main.rs" } }}
        sessionId="s1"
        workdir="/w"
      />,
    );
    expect(screen.getByText("读取文件")).toBeTruthy();
    expect(screen.getByText("src/")).toBeTruthy(); // 目录段(已剥 /w/ 前缀)
    expect(screen.getByText("main.rs")).toBeTruthy(); // 文件名独立节点,始终可见
    expect(screen.getByTitle("/w/src/main.rs")).toBeTruthy(); // 悬停仍露完整路径
  });

  it("失败:外显 out 首行(role=alert)", () => {
    render(<ToolCard item={{ ...BASE, status: "fail", out: "exit 1: 找不到模块" }} sessionId="s1" />);
    expect(screen.getByRole("alert").textContent).toContain("exit 1: 找不到模块");
  });

  it("详情面板 command 型:单 pre 收纳 cwd 弱化行 + $ 命令 + 输出(点开关展开)", async () => {
    render(
      <ToolCard
        item={{ ...BASE, rawInput: { command: "npm test", cwd: "/repo" }, rawOutput: { stdout: "42 passed", stderr: "" } }}
        sessionId="s1"
      />,
    );
    // 未展开时详情不入 DOM(单一面板按需渲染)
    expect(screen.queryByLabelText("工具详情")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "展开工具详情" }));
    const detail = screen.getByLabelText("工具详情");
    expect(detail.classList.contains("mc-workbench-material-muted")).toBe(true);
    const pre = screen.getByText((_, el) => el?.tagName === "PRE" && (el.textContent ?? "").includes("$ npm test"));
    expect(pre.textContent).toContain("/repo"); // cwd 弱化行同在一个 pre
    expect(pre.textContent).toContain("42 passed"); // 输出不再另起盒子
    // 再点收起
    await userEvent.click(screen.getByRole("button", { name: "收起工具详情" }));
    expect(screen.queryByLabelText("工具详情")).toBeNull();
  });

  it("详情面板 command 型输出为空:给 i18n 占位行", async () => {
    render(<ToolCard item={{ ...BASE, rawOutput: { stdout: "", stderr: "" } }} sessionId="s1" />);
    await userEvent.click(screen.getByRole("button", { name: "展开工具详情" }));
    expect(screen.getByText("(命令输出为空)")).toBeTruthy();
  });

  it("详情面板 diff 型:Edit old/new 走 DiffView 行渲染(hunk + 增删行)", async () => {
    render(
      <ToolCard
        item={{
          kind: "tool",
          tcId: "t3",
          title: "Edit a.ts",
          status: "ok",
          out: "",
          rawInput: { file_path: "a.ts", old_string: "const a = 1;", new_string: "const a = 2;" },
        }}
        sessionId="s1"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "展开工具详情" }));
    expect(screen.getByText("@@ -1,1 +1,1 @@")).toBeTruthy(); // hunk 行 → 走了 diff 解析而非纯文本
    expect(screen.getByText("const a = 1;")).toBeTruthy(); // 删除行
    expect(screen.getByText("const a = 2;")).toBeTruthy(); // 新增行
  });

  it("详情面板 diff 型:Edit edits 批量替换不显示 Replaced 回执", async () => {
    render(
      <ToolCard
        item={{
          kind: "tool",
          tcId: "edit-batch",
          title: "Edit src/a.ts",
          status: "ok",
          out: "",
          rawInput: {
            file_path: "src/a.ts",
            edits: [{ old_string: "const a = 1;", new_string: "const a = 2;", replace_all: true }],
          },
          rawOutput: "Replaced 3 occurrence(s) in src/a.ts",
        }}
        sessionId="s1"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "展开工具详情" }));
    expect(screen.getByText("const a = 1;")).toBeTruthy();
    expect(screen.getByText("const a = 2;")).toBeTruthy();
    expect(screen.queryByText(/Replaced 3 occurrence/)).toBeNull();
  });

  it("apply_patch 标题展示文件，详情按文件分段并高亮增删内容", async () => {
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-const a = 1;\n+const a = 2;\n*** End Patch";
    render(
      <ToolCard
        item={{ kind: "tool", tcId: "patch", title: "apply_patch", status: "ok", out: "", rawInput: { patch } }}
        sessionId="s1"
      />,
    );
    expect(screen.getByText("编辑文件")).toBeTruthy();
    expect(screen.getByTitle("src/a.ts")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "展开工具详情" }));
    expect(screen.getByText("Update File: src/a.ts")).toBeTruthy();
    expect(screen.getByText("const a = 1;")).toBeTruthy();
    expect(screen.getByText("const a = 2;")).toBeTruthy();
  });

  it("运行中不出详情入口(终态才可回看入参/结果)", () => {
    render(<ToolCard item={{ ...BASE, status: "run", rawInput: { command: "x" } }} sessionId="s1" />);
    expect(screen.queryByRole("button", { name: "展开工具详情" })).toBeNull();
  });

  it("详情展开时按 _meta.mcSrc.seq 回读原帧,全文顶掉截断头部", async () => {
    const calls: number[] = [];
    const frame: Frame = {
      type: "task-running",
      data: { update: { sessionUpdate: "tool_call_update", rawOutput: { stdout: "完整输出尾巴", stderr: "" } } },
    };
    render(
      <ToolCard
        item={{ ...BASE, rawOutput: { stdout: "截断头部…", stderr: "" }, _meta: { mcSrc: { seq: 7 } } }}
        sessionId="s1"
        loadFullTool={(seq) => {
          calls.push(seq);
          return Promise.resolve(frame);
        }}
      />,
    );
    expect(calls).toEqual([]); // 未展开不回读
    await userEvent.click(screen.getByRole("button", { name: "展开工具详情" }));
    expect(calls).toEqual([7]);
    const pre = await screen.findByText(
      (_, el) => el?.tagName === "PRE" && (el.textContent ?? "").includes("完整输出尾巴"),
    );
    expect(pre.textContent).not.toContain("截断头部…"); // 全文顶掉截断头部
  });

  it("apply_patch 回读完整入参后同步补齐标题中的文件", async () => {
    const partial = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new";
    const complete = `${partial}\n*** Add File: src/b.ts\n+export {}\n*** End Patch`;
    const frame: Frame = {
      type: "task-running",
      data: { update: { sessionUpdate: "tool_call_update", rawInput: { patch: complete } } },
    };
    render(
      <ToolCard
        item={{
          kind: "tool",
          tcId: "patch-full",
          title: "apply_patch",
          status: "ok",
          out: "",
          rawInput: { patch: partial },
          _meta: { mcSrc: { seq: 8 } },
        }}
        sessionId="s1"
        loadFullTool={() => Promise.resolve(frame)}
      />,
    );
    expect(screen.getByTitle("src/a.ts")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "展开工具详情" }));
    expect(await screen.findByTitle("src/a.ts · src/b.ts")).toBeTruthy();
  });

  it("回读失败:行内外显错误(role=alert,带原因)", async () => {
    render(
      <ToolCard
        item={{ ...BASE, rawOutput: { stdout: "截断头部…", stderr: "" }, _meta: { mcSrc: { seq: 9 } } }}
        sessionId="s1"
        loadFullTool={() => Promise.reject(new Error("网络断了"))}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "展开工具详情" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("完整内容取不回来了");
    expect(alert.textContent).toContain("网络断了");
  });

  it("feed 窗口:运行中只显尾部 5 条,完成后收起", () => {
    const feed: ToolItem["feed"] = [
      { kind: "tool", id: "a", title: "第1步", status: "ok" },
      { kind: "tool", id: "b", title: "第2步", status: "ok" },
      { kind: "text", text: "第 3 步说明" },
      { kind: "tool", id: "d", title: "第4步", status: "ok" },
      { kind: "tool", id: "e", title: "第5步", status: "ok" },
      { kind: "tool", id: "f", title: "第6步", status: "run" },
    ];
    const { rerender } = render(<ToolCard item={{ ...BASE, status: "run", feed }} sessionId="s1" />);
    expect(screen.queryByText("第1步")).toBeNull(); // 滚出窗口
    expect(screen.getByText("第2步")).toBeTruthy();
    expect(screen.getByText("第 3 步说明")).toBeTruthy();
    expect(screen.getByText("第6步")).toBeTruthy();

    rerender(<ToolCard item={{ ...BASE, status: "ok", feed }} sessionId="s1" />);
    expect(screen.queryByText("第6步")).toBeNull();
  });

  it("feed 工具行同样过 presentToolCall:动作中文映射 + path 目标剥 workdir", () => {
    const feed: ToolItem["feed"] = [
      { kind: "tool", id: "a", title: "Read", rawInput: { file_path: "/w/lib/util.ts" }, status: "ok" },
    ];
    render(<ToolCard item={{ ...BASE, title: "Agent 调查代码", status: "run", feed }} sessionId="s1" workdir="/w" />);
    expect(screen.getByText("读取文件")).toBeTruthy();
    expect(screen.getByText("lib/")).toBeTruthy();
    expect(screen.getByText("util.ts")).toBeTruthy();
  });

  it("运行中的最新输出行(lastLine)外显", () => {
    render(<ToolCard item={{ ...BASE, status: "run", lastLine: "Compiling crate…" }} sessionId="s1" />);
    expect(screen.getByText("Compiling crate…")).toBeTruthy();
  });

  it("内嵌审批:暂停图标顶掉状态点 + 本地化标题 + 卡底按钮行", () => {
    const perm: PermItem = { kind: "perm", id: "p1", title: "npm test", tool: "Bash", state: "open", toolCallId: "t1" };
    const { container } = render(<ToolCard item={{ ...BASE, status: "run" }} perm={perm} sessionId="s1" />);
    expect(container.querySelector("svg.text-warning")).toBeTruthy(); // 暂停图标
    expect(container.querySelector(".status")).toBeNull(); // 状态点被顶掉
    expect(screen.getByText("需要确认 · 执行命令")).toBeTruthy(); // 工具名过 toolDisplayName
    expect(screen.getByRole("button", { name: "允许" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeTruthy();
  });

  it("内嵌审批乐观态按 perm.id 键控:同卡二次锚定新审批,按钮行重现(H8)", async () => {
    stubShell();
    const perm = (id: string): PermItem => ({ kind: "perm", id, title: "npm test", tool: "Bash", state: "open", toolCallId: "t1" });
    const { rerender } = render(<ToolCard item={{ ...BASE, status: "run" }} perm={perm("p1")} sessionId="s1" />);
    await userEvent.click(screen.getByRole("button", { name: "允许" }));
    expect(screen.queryByRole("button", { name: "允许" })).toBeNull();
    expect(screen.getByText("已允许")).toBeTruthy();

    // 同一张工具卡(同一渲染位)锚定第二张审批:乐观态必须随 id 重置
    rerender(<ToolCard item={{ ...BASE, status: "run" }} perm={perm("p2")} sessionId="s1" />);
    expect(screen.getByRole("button", { name: "允许" })).toBeTruthy();
    expect(screen.queryByText("已允许")).toBeNull();
  });

  it("后台派发卡使用与普通子代理一致的蓝色详情动作，过程不在卡内展开", async () => {
    const feed: ToolItem["feed"] = [
      { kind: "tool", id: "a", title: "Read", rawInput: { file_path: "/w/a.ts" }, status: "ok" },
      { kind: "text", text: "正在继续检查" },
    ];
    render(
      <ToolCard
        item={{
          ...BASE,
          title: "SendMessage",
          status: "run",
          background: true,
          outKey: "chat.tool.bgRunning",
          feed,
          lastLine: "等待下一步",
        }}
        sessionId="s1"
      />,
    );
    expect(screen.queryByText("后台运行中")).toBeNull();
    expect(screen.queryByText("正在继续检查")).toBeNull();
    expect(screen.queryByText("等待下一步")).toBeNull();

    const detailButton = screen.getByRole("button", { name: "查看子代理详情" });
    expect(detailButton.className).toContain("link-primary");
    await userEvent.click(detailButton);
    expect(screen.getByRole("dialog", { name: "子代理详情" })).toBeTruthy();
    expect(screen.getByText("正在继续检查")).toBeTruthy();
    expect(screen.getByText("等待下一步")).toBeTruthy();
  });

  it("childSessionId + onOpenChild:头部出「查看子会话」入口并回传 id", async () => {
    const opened: string[] = [];
    render(<ToolCard item={{ ...BASE, childSessionId: "c1" }} sessionId="s1" onOpenChild={(id) => opened.push(id)} />);
    await userEvent.click(screen.getByRole("button", { name: "查看子会话" }));
    expect(opened).toEqual(["c1"]);
  });

  it("缺 onOpenChild(如云端只读流)时不渲染子会话入口", () => {
    render(<ToolCard item={{ ...BASE, childSessionId: "c1" }} sessionId="s1" />);
    expect(screen.queryByRole("button", { name: "查看子会话" })).toBeNull();
  });

  it("子会话入口缺席但有结果:点击后台卡打开弹窗，不在卡内展开 Markdown", async () => {
    const item: ToolItem = { ...BASE, title: "Agent 调查代码", status: "ok", background: true, result: "**结论**:一切正常" };
    const { container } = render(<ToolCard item={item} sessionId="s1" />);
    expect(screen.queryByText("结论")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "查看子代理详情" }));
    expect(screen.getByRole("dialog", { name: "子代理详情" })).toBeTruthy();
    expect(screen.getByText("结论")).toBeTruthy();
    expect(container.querySelector(".markdown-body")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "子代理详情" })).toBeNull();
  });

  it("有子会话入口时不出结果兜底，后台卡直接打开真实子会话弹窗", async () => {
    const opened: string[] = [];
    const item: ToolItem = {
      ...BASE,
      title: "SendMessage",
      status: "run",
      background: true,
      childSessionId: "c1",
      result: "结论文本",
    };
    render(<ToolCard item={item} sessionId="s1" onOpenChild={(id) => opened.push(id)} />);
    const childButton = screen.getByRole("button", { name: "查看子会话" });
    expect(childButton.className).toContain("link-primary");
    await userEvent.click(childButton);
    expect(opened).toEqual(["c1"]);
    expect(screen.queryByRole("button", { name: "查看结果" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "子代理详情" })).toBeNull();
  });

  it("report_findings:渲染结构化发现列表", () => {
    render(
      <ToolCard
        item={{
          ...BASE,
          title: "ReportFindings: 1 项发现",
          rawInput: {
            findings: [{ file: "src/auth.ts", line: 42, summary: "token 未过期校验", verdict: "CONFIRMED" }],
          },
        }}
        sessionId="s1"
      />,
    );
    expect(screen.getByText("token 未过期校验")).toBeTruthy();
    expect(screen.getByText("已证实")).toBeTruthy();
    expect(screen.getByText("auth.ts:42")).toBeTruthy();
  });

  it("report_findings:onLocalLink 透传为发现行 file:line 的点击定位", async () => {
    const onLocalLink = vi.fn();
    render(
      <ToolCard
        item={{
          ...BASE,
          title: "ReportFindings: 1 项发现",
          rawInput: { findings: [{ file: "src/auth.ts", line: 42, summary: "token 未过期校验" }] },
        }}
        sessionId="s1"
        onLocalLink={onLocalLink}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "auth.ts:42" }));
    expect(onLocalLink).toHaveBeenCalledWith("src/auth.ts");
  });
});

describe("工具产出图片", () => {
  it("有 uploadUrl:images 过滤图片路径渲染缩略图,点击开大图浮层", async () => {
    const item = { kind: "tool", tcId: "t9", title: "浏览器截图", status: "ok", out: "", images: [".monkeycode/uploads/shot.png", "notes.txt"] } as ToolItem;
    render(<ToolCard item={item} sessionId="s1" uploadUrl={() => Promise.resolve("data:image/png;base64,AAA")} />);
    const img = await screen.findByRole("img", { name: ".monkeycode/uploads/shot.png" });
    expect(screen.queryByRole("img", { name: "notes.txt" })).toBeNull();
    await userEvent.click(img);
    expect(await screen.findByRole("dialog", { name: ".monkeycode/uploads/shot.png" })).toBeTruthy();
  });

  it("无 uploadUrl:不渲染图片区", () => {
    const item = { kind: "tool", tcId: "t9", title: "浏览器截图", status: "ok", out: "", images: [".monkeycode/uploads/shot.png"] } as ToolItem;
    render(<ToolCard item={item} sessionId="s1" />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("标题行开合详情(思考块同款交互)", () => {
  it("点标题行任意处展开,再点收起", async () => {
    render(<ToolCard item={{ ...BASE, rawOutput: { stdout: "输出体", stderr: "" } }} sessionId="s1" />);
    await userEvent.click(screen.getByText("执行命令")); // 行内动作词 = 行的一部分
    expect(screen.getByLabelText("工具详情")).toBeTruthy();
    await userEvent.click(screen.getByText("执行命令"));
    expect(screen.queryByLabelText("工具详情")).toBeNull();
  });

  it("行内「查看子会话」点击不误触详情开关", async () => {
    const opened: string[] = [];
    render(
      <ToolCard
        item={{ ...BASE, childSessionId: "c1", rawOutput: { stdout: "输出体", stderr: "" } }}
        sessionId="s1"
        onOpenChild={(id) => opened.push(id)}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "查看子会话" }));
    expect(opened).toEqual(["c1"]);
    expect(screen.queryByLabelText("工具详情")).toBeNull();
  });
});

describe("块级时间", () => {
  it("消息时间不在卡内(在 LogList 的块上方时间线,见 LogList.test)", () => {
    const noon = new Date(2026, 7, 5, 14, 30).getTime();
    const { container } = render(<ToolCard item={{ ...BASE, timestamp: noon }} sessionId="s1" />);
    expect(container.querySelector("time")).toBeNull();
  });
});
