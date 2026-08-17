// 分屏视图(树形布局):装载卡 tab/分组与排序、拆分/关闭、把手按节点独立、
// 拖格头换位、内嵌新建。ChatView 数据面在格内真实挂载,壳走最小 stub。
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionMeta } from "@/lib/ipc/sessions";
import { SplitView } from "./SplitView";
import { LOAD_MIME } from "./slots";
import { useSplitState } from "./useSplitState";

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  localStorage.clear();
});

function stubShell() {
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string) => {
        if (cmd === "session_open") return Promise.resolve({ frames: [], cursor: 0, has_more: false });
        if (cmd === "session_outline") return Promise.resolve([]);
        if (cmd === "session_call") return Promise.resolve({ result: [], is_git_repo: true });
        if (cmd === "engine_status") return Promise.resolve({ phase: "ready" });
        // 内嵌新建表单挂载即拉模型/配置(与整页形态同一份代码)
        if (cmd === "models_list") return Promise.resolve([{ name: "m", default: true }]);
        if (cmd === "get_config") return Promise.resolve({ models: [], mcp_servers: {} });
        return Promise.resolve(null);
      },
    },
    event: { listen: () => Promise.resolve(() => {}) },
  };
}

const meta = (over: Partial<SessionMeta> & { id: string }): SessionMeta => ({
  title: over.id,
  workdir: "/p/a",
  model: "m",
  turns: 1,
  status: "idle",
  ...over,
});

const SESSIONS: SessionMeta[] = [
  meta({ id: "s1", title: "已入格的任务", updated_at: "2026-08-16T03:00:00Z" }),
  meta({ id: "s2", title: "跑着的任务", status: "running", updated_at: "2026-08-16T02:00:00Z" }),
  meta({ id: "s3", title: "闲着的任务", workdir: "/p/alpha", updated_at: "2026-08-16T01:00:00Z" }),
  meta({ id: "c1", title: "闲聊", kind: "chat", workdir: "", updated_at: "2026-08-16T00:30:00Z" }),
];

function Harness({ sessions = SESSIONS, onAssign }: { sessions?: SessionMeta[]; onAssign?: (slot: number, id: string) => void }) {
  const split = useSplitState();
  return (
    <SplitView
      sessions={sessions}
      split={split}
      epoch={0}
      focusRequest={0}
      onFocusRequestHandled={() => {}}
      onAssign={(slot, id) => {
        onAssign?.(slot, id);
        split.assignTo(slot, id);
      }}
      onLoadSession={(id) => split.place(id)}
      onCreatedInSlot={(slot, created) => split.assignTo(slot, created.id)}
      onCloudCreatedInSlot={() => {}}
      onOpenSettings={() => {}}
      recentDirs={[]}
    />
  );
}

/** 假 dataTransfer(jsdom 无 DataTransfer 构造器;换位拖拽用)。 */
const fakeDT = () => {
  const data: Record<string, string> = {};
  return {
    setData: (k: string, v: string) => {
      data[k] = v;
    },
    getData: (k: string) => data[k] ?? "",
    get types() {
      return Object.keys(data);
    },
    effectAllowed: "",
    dropEffect: "",
  };
};

describe("分屏视图(树形布局)", () => {
  it("首启缺省单格(2026-08-20 定案:新用户不见空栏;存过树不受影响)", () => {
    stubShell();
    render(<Harness />);
    expect(screen.getAllByRole("region")).toHaveLength(1);
  });

  it("存档双格:槽 0 挂会话,槽 1 装载卡——tab、项目分组、临时会话段、已入格判重排除", async () => {
    stubShell();
    localStorage.setItem("mc.workbenchListHidden", "1"); // 钉在装载卡路径(任务列默认展开时空格是提示卡)
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    render(<Harness />);
    const panes = screen.getAllByRole("region");
    expect(panes).toHaveLength(2);
    expect(within(panes[0]!).getByTitle(/已入格的任务/)).toBeTruthy();
    const loader = panes[1]!;
    expect(within(loader).getByRole("tab", { name: "本地" }).getAttribute("aria-selected")).toBe("true");
    expect(within(loader).getByText("运行中")).toBeTruthy();
    expect(within(loader).getByText("跑着的任务")).toBeTruthy();
    expect(within(loader).getByText("alpha")).toBeTruthy();
    // 已入格的 s1 判重不列(装载卡里没有它;细头那份标题不算)
    expect(within(loader).queryByText("已入格的任务")).toBeNull();
    // 组头 = 侧栏同款安静小标签(GroupLabel /50 降色),不是 menu-title
    expect(within(loader).getByText("alpha").className).toContain("text-base-content/50");
    expect(loader.querySelector(".menu-title")).toBeNull();
    // 组内行缩一级(层级靠缩进,§6.2)
    expect(within(loader).getByText("闲着的任务").closest("a")?.className).toContain("ps-8");
    // chat 收进本地 tab 的「临时会话」段(2026-08-18 撤并),不再单设 tab
    expect(within(loader).queryByRole("tab", { name: /本地会话/ })).toBeNull();
    expect(within(loader).getByText("临时会话")).toBeTruthy();
    expect(within(loader).getByText("闲聊")).toBeTruthy();
    expect(within(loader).getByRole("button", { name: "新建任务" })).toBeTruthy();
    expect(within(loader).queryByRole("button", { name: "新建会话" })).toBeNull();
  });

  it("项目组顺序与侧栏一致:运行中的会话也计入项目活跃度(只是行不重复列)", () => {
    stubShell();
    localStorage.setItem("mc.workbenchListHidden", "1"); // 钉在装载卡路径(任务列默认展开时空格是提示卡)
    // 项目 A 最近的活动是一条**运行中**会话(03:00),项目 B 是闲置(02:00)。
    // 侧栏按组内最近活跃排 A 在前;分组若先剔掉运行中再算,A 只剩 01:00
    // 的旧会话,就会错排到 B 之后(用户报障「排序怎么跟 sidebar 不一样」)
    const list: SessionMeta[] = [
      meta({ id: "a1", title: "A 旧任务", workdir: "/p/aaa", updated_at: "2026-08-16T01:00:00Z" }),
      meta({ id: "a2", title: "A 跑着", workdir: "/p/aaa", status: "running", updated_at: "2026-08-16T03:00:00Z" }),
      meta({ id: "b1", title: "B 闲置", workdir: "/p/bbb", updated_at: "2026-08-16T02:00:00Z" }),
    ];
    render(<Harness sessions={list} />);
    const loader = screen.getAllByRole("region")[0]!;
    const html = loader.innerHTML;
    expect(html.indexOf("aaa")).toBeGreaterThan(-1);
    expect(html.indexOf("aaa")).toBeLessThan(html.indexOf("bbb"));
    // 运行中的 a2 只在「运行中」组出现一次,不在项目组里重复
    expect(within(loader).getAllByText("A 跑着")).toHaveLength(1);
  });

  it("右分屏:长出第三格(新格取最小空槽号、装载卡形态、树落盘);满 6 格置灰", async () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    render(<Harness />);
    expect(screen.getAllByRole("region")).toHaveLength(2);
    // 分窗操作收进「格操作」⋯ 菜单(2026-08-18 定案「不是常见的操作」)
    await userEvent.click(within(screen.getAllByRole("region")[0]!).getByRole("button", { name: "格操作" }));
    await userEvent.click(within(document.body.lastElementChild as HTMLElement).getByText("右分屏"));
    expect(screen.getAllByRole("region")).toHaveLength(3);
    expect(screen.getByRole("region", { name: "第 3 格" })).toBeTruthy();
    const saved = JSON.parse(localStorage.getItem("mc.splitTree") ?? "null");
    expect(saved).not.toBeNull();
    // 连拆到 6 格
    for (let i = 0; i < 3; i++) {
      await userEvent.click(screen.getAllByRole("button", { name: "格操作" })[0]!);
      await userEvent.click(within(document.body.lastElementChild as HTMLElement).getByText("下分屏"));
    }
    expect(screen.getAllByRole("region")).toHaveLength(6);
    // 满 6:菜单里两个拆分项置灰
    await userEvent.click(screen.getAllByRole("button", { name: "格操作" })[0]!);
    const capMenu = document.body.lastElementChild as HTMLElement;
    expect((within(capMenu).getByText("右分屏").closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect((within(capMenu).getByText("下分屏").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("关闭格子:兄弟上位、槽位清档;最后一格不可关(钮置灰)", async () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    render(<Harness />);
    await userEvent.click(within(screen.getByRole("region", { name: "第 1 格" })).getByRole("button", { name: /关闭格子/ }));
    const panes = screen.getAllByRole("region");
    expect(panes).toHaveLength(1);
    // 槽 0 的档被清(关格是显式动作,不留隐藏尾巴)
    expect(JSON.parse(localStorage.getItem("mc.splitSlots") ?? "[]")[0]).toBeNull();
    // 独格:关闭钮整颗不渲染(置灰版 2026-08-19 用户「去掉吧」),
    // 细头其余(格操作)仍在
    expect(within(panes[0]!).queryByRole("button", { name: /关闭格子/ })).toBeNull();
    expect(within(panes[0]!).getByRole("button", { name: "格操作" })).toBeTruthy();
  });

  it("平铺分栏(2026-08-19 mockup 终案,当日浮卡退役):格白底无卡衣、细头恒在带拖窗面,右侧无顶条", () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ leaf: 0 }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    render(<Harness />);
    // 列开着:右侧无顶条
    expect(document.querySelector("[data-view-header]")).toBeNull();
    // 平铺:画布无衬(1px 细线由 grid 底色透缝),格无卡衣
    const grid = document.querySelector("[data-split-grid]") as HTMLElement;
    expect(grid.className).not.toContain("p-3");
    const pane = screen.getByRole("region", { name: "第 1 格" });
    expect(pane.className).not.toContain("rounded-box");
    expect(pane.className).not.toContain("shadow");
    // 细头恒在(标题在格上)且自任拖窗面
    expect(within(pane).getByTitle(/已入格的任务/)).toBeTruthy();
    expect(within(pane).getByTitle(/已入格的任务/).closest("[data-tauri-drag-region]")).not.toBeNull();
    expect(within(pane).getByRole("button", { name: "格操作" })).toBeTruthy();
  });

  it("拖放装载落在「创建中」格上:装载优先、表单退场(取消不再连格收走)", async () => {
    stubShell();
    localStorage.setItem("mc.workbenchListHidden", "1"); // 装载卡路径
    render(<Harness />);
    const pane = screen.getAllByRole("region")[0]!;
    await userEvent.click(within(pane).getByRole("button", { name: "新建任务" }));
    expect(within(pane).getByRole("heading", { name: "新建任务" })).toBeTruthy();
    const dt = fakeDT();
    dt.setData(LOAD_MIME, "s2");
    fireEvent.drop(pane, { dataTransfer: dt });
    expect(within(pane).queryByRole("heading", { name: "新建任务" })).toBeNull();
    await waitFor(() => expect(within(pane).getByTitle(/跑着的任务/)).toBeTruthy());
  });

  it("任务列可拖宽:最小 184 钳制、双击回缺省 232、松手落盘 mc.workbenchListWidth", async () => {
    stubShell();
    render(<Harness />);
    const handle = screen.getByRole("separator", { name: "拖动调整任务列宽度" });
    const aside = screen.getByRole("complementary", { name: "选择任务" });
    fireEvent.mouseDown(handle, { clientX: 232 });
    fireEvent.mouseMove(document, { clientX: 300 });
    fireEvent.mouseUp(document);
    expect(aside.style.width).toBe("300px");
    // 低于下限钳到 184
    fireEvent.mouseDown(handle, { clientX: 300 });
    fireEvent.mouseMove(document, { clientX: 50 });
    fireEvent.mouseUp(document);
    expect(aside.style.width).toBe("184px");
    await waitFor(() => expect(localStorage.getItem("mc.workbenchListWidth")).toBe("184"));
    fireEvent.doubleClick(handle);
    expect(aside.style.width).toBe("232px");
  });

  it("把手按树节点独立:四格拖左列横切不牵动右列与贯通竖切;双击回平分", () => {
    stubShell();
    localStorage.setItem(
      "mc.splitTree",
      JSON.stringify({
        dir: "col",
        ratio: 0.5,
        a: { dir: "row", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 2 } },
        b: { dir: "row", ratio: 0.5, a: { leaf: 1 }, b: { leaf: 3 } },
      }),
    );
    const { container } = render(<Harness />);
    const handle = container.querySelector<HTMLElement>('[data-split-handle="a"]')!;
    vi.spyOn(handle.parentElement!, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 500, height: 800, right: 500, bottom: 800, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    fireEvent.mouseDown(handle, { clientY: 400 });
    fireEvent.mouseMove(window, { clientY: 600 }); // 600/800 = 0.75
    fireEvent.mouseUp(window);
    expect(document.body.style.cursor).toBe(""); // 收尾纪律:全局样式收回
    const saved = JSON.parse(localStorage.getItem("mc.splitTree") ?? "null");
    expect(saved.a.ratio).toBeCloseTo(0.75);
    expect(saved.b.ratio).toBe(0.5); // 右列不牵动
    expect(saved.ratio).toBe(0.5); // 贯通竖切不牵动
    fireEvent.doubleClick(container.querySelector('[data-split-handle="a"]')!);
    expect(JSON.parse(localStorage.getItem("mc.splitTree") ?? "null").a.ratio).toBe(0.5);
  });

  it("按住格头标题拖到另一格 = 交换位置(内容跟格走,落点有高亮)", () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    render(<Harness />);
    const first = screen.getByRole("region", { name: "第 1 格" });
    const second = screen.getByRole("region", { name: "第 2 格" });
    expect(within(first).getByTitle(/已入格的任务/)).toBeTruthy();
    const dt = fakeDT();
    fireEvent.dragStart(within(first).getByTitle(/已入格的任务/), { dataTransfer: dt });
    fireEvent.dragOver(second, { dataTransfer: dt });
    expect(second.querySelector("[data-split-drop]")).not.toBeNull(); // 落点高亮
    fireEvent.drop(second, { dataTransfer: dt });
    // 树上两叶交换 = 两格连内容一起对调位置(槽号跟格走,故按 DOM 序断言:
    // 视觉左侧现在是 s2,右侧是 s1)
    const after = screen.getAllByRole("region");
    expect(within(after[0]!).getByTitle(/跑着的任务/)).toBeTruthy();
    expect(within(after[1]!).getByTitle(/已入格的任务/)).toBeTruthy();
  });

  it("布局模板钮退役(2026-08-18 用户定案「没啥用」——拆分/关闭本身就是布局手段):头部无布局组", () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    render(<Harness />);
    // 多格 + 列开:右侧顶条整块退场(2026-08-19「整个 panel 浮上去」),
    // 布局组自然无处安身;全局也无一颗布局钮
    expect(document.querySelector("[data-view-header]")).toBeNull();
    expect(screen.queryByRole("group", { name: "布局" })).toBeNull();
    expect(screen.queryByRole("button", { name: /单格|左右双格|上下双格|四格/ })).toBeNull();
    // 布局手段仍在:格细头「格操作」菜单(多格)/视图头同款(单格融合)
    expect(within(screen.getByRole("region", { name: "第 1 格" })).getByRole("button", { name: "格操作" })).toBeTruthy();
  });

  it("格细头「会话文件」开全局文件抽屉(2026-08-16 报障「看文件的功能咋没了」)", async () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    render(<Harness />);
    await userEvent.click(within(screen.getByRole("region", { name: "第 1 格" })).getByRole("button", { name: "会话文件" }));
    // FilesDrawer 挂上(文件/改动两页签);关掉即收
    expect(await screen.findByRole("tab", { name: /文件/ })).toBeTruthy();
  });

  it("点装载卡行 → onAssign(槽, 会话) 且该格挂载", async () => {
    stubShell();
    localStorage.setItem("mc.workbenchListHidden", "1"); // 钉在装载卡路径(任务列默认展开时空格是提示卡)
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    const assigned = vi.fn();
    render(<Harness onAssign={assigned} />);
    await userEvent.click(screen.getByText("跑着的任务"));
    expect(assigned).toHaveBeenCalledWith(1, "s2");
    expect(within(screen.getAllByRole("region")[1]!).getByTitle(/跑着的任务/)).toBeTruthy();
  });

  // jsdom 无布局,类名机检钉住(layoutContract 同手法):嵌套 flex 的内在
  // 宽度上传只要有一环缺 min-w-0,整棵格区就跟着最宽内容走(2026-08-18
  // 用户报障「右侧 panel 向右溢出」,Chrome 实测:一段长代码把格撑到
  // 8054px、文档 9857px)。真实布局验证走 probe.tmp.mjs 手跑
  it("格区宽度总闸:格区与其父行两层容器都带 min-w-0(2026-08-18 溢出事故根因)", () => {
    stubShell();
    const { container } = render(<Harness />);
    const grid = container.querySelector<HTMLElement>("[data-split-grid]")!;
    expect(grid.className).toContain("min-w-0");
    expect(grid.parentElement!.className).toContain("min-w-0");
  });

  it("每格全套 composer(轻输入条 2026-08-19 撤销「不需要缩小」);细头按钮簇悬停显隐", async () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    render(<Harness />);
    const first = screen.getByRole("region", { name: "第 1 格" });
    const second = screen.getByRole("region", { name: "第 2 格" });
    // 焦点与否都全套 composer,轻输入条不复存在
    await waitFor(() => expect(within(first).getByRole("textbox")).toBeTruthy());
    await waitFor(() => expect(within(second).getByRole("textbox")).toBeTruthy());
    expect(second.querySelector("[data-slim-composer]")).toBeNull();
    // 细头按钮簇默认隐形占位(invisible,不挤布局),悬停/焦点才浮现
    const cluster = within(second).getByRole("button", { name: "格操作" }).parentElement!;
    expect(cluster.className).toContain("invisible");
    expect(cluster.className).toContain("group-hover/pane:visible");
  });

  it("焦点跟随按下:多格并存恰有一枚焦点环,pointerdown 换格即移动", () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    render(<Harness />);
    const panes = screen.getAllByRole("region");
    expect(panes[0]!.querySelector("[data-split-focus]")).not.toBeNull();
    expect(panes[1]!.querySelector("[data-split-focus]")).toBeNull();
    fireEvent.pointerDown(panes[1]!);
    expect(panes[0]!.querySelector("[data-split-focus]")).toBeNull();
    expect(panes[1]!.querySelector("[data-split-focus]")).not.toBeNull();
  });

  it("格内内嵌新建:装载卡「新建任务」原地换成创建表单(不跳整页),取消回装载卡", async () => {
    stubShell();
    localStorage.setItem("mc.workbenchListHidden", "1"); // 钉在装载卡路径(任务列默认展开时空格是提示卡)
    render(<Harness />);
    await userEvent.click(screen.getAllByRole("button", { name: "新建任务" })[0]!);
    const pane = screen.getAllByRole("region")[0]!;
    expect(within(pane).getByRole("heading", { name: "新建任务" })).toBeTruthy();
    expect(document.querySelectorAll("main")).toHaveLength(1);
    // 云端页签在格内同样可用(2026-08-18 整页新建退役,「云端不内嵌」随之作废)
    expect(within(pane).getByRole("tab", { name: /云端任务/ })).toBeTruthy();
    expect(within(pane).getByRole("tab", { name: /本地任务/ })).toBeTruthy();
    await userEvent.click(within(pane).getByRole("button", { name: "取消" }));
    expect(within(pane).queryByRole("heading", { name: "新建任务" })).toBeNull();
    expect(within(pane).getByRole("tab", { name: "本地" })).toBeTruthy();
  });

  it("新建即新格(2026-08-18 定案「创建任务也是一个 panel」):格全被占时拆新格装表单,取消收回", async () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", "s2", null, null, null, null]));
    render(<Harness />);
    const list = screen.getByRole("complementary", { name: "选择任务" });
    await userEvent.click(within(list).getByRole("button", { name: "新建任务" }));
    // 两格都有会话 → 不覆盖任何一格,拆出第 3 格专供创建
    expect(screen.getAllByRole("region")).toHaveLength(3);
    const pane = screen.getByRole("region", { name: "第 3 格" });
    expect(within(pane).getByRole("heading", { name: "新建任务" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "第 1 格" })).getByTitle(/已入格的任务/)).toBeTruthy();
    // 取消:专为创建拆的格收回,不留空格尾巴
    await userEvent.click(within(pane).getByRole("button", { name: "取消" }));
    expect(screen.getAllByRole("region")).toHaveLength(2);
    expect(screen.queryByRole("heading", { name: "新建任务" })).toBeNull();
  });

  it("「临时会话」组:默认在待办之下、项目组之前;与项目组同快照拖动排序", async () => {
    stubShell();
    const list: SessionMeta[] = [
      meta({ id: "a1", title: "甲任务", workdir: "/p/alpha", updated_at: "2026-08-18T02:00:00Z" }),
      meta({ id: "c9", title: "闲聊", kind: "chat", workdir: "", updated_at: "2026-08-18T01:00:00Z" }),
    ];
    render(<Harness sessions={list} />);
    const strip = screen.getByRole("complementary", { name: "选择任务" });
    // 默认序:临时会话在项目组之前(待办组是列表最前的固定段,本 Harness
    // 未接待办 wiring,组间序不受影响)
    const chatsHead = within(strip).getByText("临时会话");
    expect(chatsHead.compareDocumentPosition(within(strip).getByText("alpha")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 拖 alpha 落到临时会话之前:快照写盘且渲染序翻转
    const dt = fakeDT();
    fireEvent.dragStart(within(strip).getByText("alpha").closest("a")!, { dataTransfer: dt });
    fireEvent.dragOver(within(strip).getByText("临时会话").closest("a")!, { dataTransfer: dt });
    fireEvent.drop(within(strip).getByText("临时会话").closest("a")!, { dataTransfer: dt });
    expect(JSON.parse(localStorage.getItem("mc.projectOrder") ?? "[]")).toEqual(["/p/alpha", "\u0000chats"]);
    expect(
      within(strip).getByText("alpha").compareDocumentPosition(within(strip).getByText("临时会话")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("「临时会话」组头「+」快捷新建:内嵌表单落本地页签的「临时会话」档(会话=不选文件夹的任务)", async () => {
    stubShell();
    render(<Harness />);
    const list = screen.getByRole("complementary", { name: "选择任务" });
    // 组头常驻(即使还没有会话),hover「+」是新建会话的常驻入口
    expect(within(list).getByText("临时会话")).toBeTruthy();
    await userEvent.click(within(list).getByRole("button", { name: "新建会话" }));
    const pane = screen.getAllByRole("region")[0]!;
    expect(within(pane).getByRole("tab", { name: /本地任务/ }).getAttribute("aria-selected")).toBe("true");
    expect(within(pane).getByRole("button", { name: "最近目录" }).textContent).toContain("临时会话");
  });

  it("任务列默认展开:新建主钮在列顶 chrome 行(2026-08-18 定案),点行走 place 路由(在场定位/空格装载)", async () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    render(<Harness />);
    const list = screen.getByRole("complementary", { name: "选择任务" });
    // 计数统计行已撤(2026-08-18 用户定案「没啥用」);「新建」主钮住列顶
    // chrome 行(mac 净空标记与列开关同排);列在场时主区头不再有它
    expect(within(list).queryByText(/\d+ 项目/)).toBeNull();
    expect(within(list).getByRole("button", { name: "新建任务" })).toBeTruthy();
    expect(list.querySelector("[data-mac-lights-clear]")).not.toBeNull();
    expect(within(list).getByRole("button", { name: "收起任务列" })).toBeTruthy();
    // 多格 + 列开:右侧无顶条(2026-08-19「整个 panel 浮上去」),画布
    // 自任拖窗面
    expect(document.querySelector("[data-view-header]")).toBeNull();
    expect(document.querySelector("[data-split-grid]")!.hasAttribute("data-tauri-drag-region")).toBe(true);
    // 任务列**包含**已入格的 s1(装载卡才判重),在场信息进行 tooltip
    const onBoardRow = within(list).getByText("已入格的任务").closest("a")!;
    expect(onBoardRow.getAttribute("title")).toContain("已在工作台上");
    // 空格是轻提示卡,不再重复一份列表(左右两份列表像镜子)
    const emptyPane = screen.getByRole("region", { name: "第 2 格" });
    expect(within(emptyPane).getByText("把左侧的任务拖到这里,或新建一个")).toBeTruthy();
    expect(within(emptyPane).queryByRole("tab", { name: "本地" })).toBeNull();
    // 点屏外行 → 装进空格(place:叶序第一个空格)
    await userEvent.click(within(list).getByText("跑着的任务"));
    expect(within(screen.getByRole("region", { name: "第 2 格" })).getByTitle(/跑着的任务/)).toBeTruthy();
    // 点已入格行 → 不重复装载,焦点定位过去
    await userEvent.click(within(list).getByText("已入格的任务"));
    expect(screen.getByRole("region", { name: "第 1 格" }).querySelector("[data-split-focus]")).not.toBeNull();
  });

  it("组头按旧侧栏对表(2026-08-18 报障回归):裸项目名、开合换 Folder/FolderOpen、waiting 徽标、hover「+」快捷新建", async () => {
    stubShell();
    const list: SessionMeta[] = [
      meta({ id: "m1", title: "任务甲", workdir: "/x/MonkeyCode", updated_at: "2026-08-18T02:00:00Z" }),
      meta({ id: "m2", title: "任务乙", workdir: "/y/MonkeyCode", waiting_ask: true, updated_at: "2026-08-18T01:00:00Z" }),
    ];
    render(<Harness sessions={list} />);
    const strip = screen.getByRole("complementary", { name: "选择任务" });
    // 裸项目名:撞名也不缀父目录段(旧侧栏原样,全路径在组头 title 里)。
    // 品牌行字标也是 "MonkeyCode"(2026-08-18 加回),组头按 a[aria-expanded] 收口
    const groupHeads = () =>
      within(strip)
        .getAllByText("MonkeyCode")
        .map((n) => n.closest("a"))
        .filter((a): a is HTMLAnchorElement => !!a && a.hasAttribute("aria-expanded"));
    expect(groupHeads()).toHaveLength(2);
    expect(within(strip).queryByText(/MonkeyCode · /)).toBeNull();
    // waiting 徽标挂在「等待确认」那组(/y 组 m2)的组头
    const heads = groupHeads();
    expect(heads.some((h) => h.querySelector(".badge-warning")?.textContent === "1")).toBe(true);
    // 展开态 FolderOpen ↔ 收起态 Folder(图标随开合)
    expect(heads[0]!.querySelector(".tabler-icon-folder-open")).not.toBeNull();
    await userEvent.click(heads[0]!);
    const headAfter = groupHeads()[0]!;
    expect(headAfter.querySelector(".tabler-icon-folder-open")).toBeNull();
    expect(headAfter.querySelector(".tabler-icon-folder")).not.toBeNull();
    // hover「+」快捷新建:常驻占位(invisible 只切可见性),点它开内嵌预填
    const plus = within(headAfter).getByRole("button", { name: "在此项目新建任务" });
    expect(plus.className).toContain("invisible");
    expect(plus.className).toContain("group-hover/ghead:visible");
    await userEvent.click(plus);
    expect(await screen.findByRole("heading", { name: "新建任务" })).toBeTruthy();
  });

  it("项目归档全套(2026-08-18 报障回归):组头右键归档 → 入底部小节;右键恢复;项目内归档任务小节", async () => {
    stubShell();
    const list: SessionMeta[] = [
      meta({ id: "a1", title: "甲任务", workdir: "/p/alpha", updated_at: "2026-08-18T02:00:00Z" }),
      meta({ id: "a2", title: "甲的旧任务", workdir: "/p/alpha", archived: true, updated_at: "2026-08-18T01:00:00Z" }),
      meta({ id: "b1", title: "乙任务", workdir: "/p/beta", updated_at: "2026-08-18T00:00:00Z" }),
    ];
    render(<Harness sessions={list} />);
    const strip = screen.getByRole("complementary", { name: "选择任务" });
    // 项目内「已归档任务」小节:点开出降色行
    expect(within(strip).queryByText("甲的旧任务")).toBeNull();
    await userEvent.click(within(strip).getByText("已归档任务"));
    expect(within(strip).getByText("甲的旧任务")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("mc.sessionArchivesOpen") ?? "[]")).toContain("/p/alpha");
    // 组头右键「归档项目」:beta 移入底部「已归档项目」小节
    fireEvent.contextMenu(within(strip).getByText("beta"));
    await userEvent.click(within(document.body.lastElementChild as HTMLElement).getByText("归档项目"));
    expect(JSON.parse(localStorage.getItem("mc.archivedProjects") ?? "[]")).toContain("/p/beta");
    expect(within(strip).getByText("已归档项目")).toBeTruthy();
    // 展开小节 → 组头右键「恢复项目」回到活跃区
    await userEvent.click(within(strip).getByText("已归档项目"));
    fireEvent.contextMenu(within(strip).getByText("beta"));
    await userEvent.click(within(document.body.lastElementChild as HTMLElement).getByText("恢复项目"));
    expect(JSON.parse(localStorage.getItem("mc.archivedProjects") ?? "[]")).not.toContain("/p/beta");
  });

  it("组头拖拽排序(mc.projectOrder 全序快照)与「在此项目新建任务」(内嵌预填)", async () => {
    stubShell();
    const list: SessionMeta[] = [
      meta({ id: "a1", title: "甲任务", workdir: "/p/alpha", updated_at: "2026-08-18T02:00:00Z" }),
      meta({ id: "b1", title: "乙任务", workdir: "/p/beta", updated_at: "2026-08-18T00:00:00Z" }),
    ];
    render(<Harness sessions={list} />);
    const strip = screen.getByRole("complementary", { name: "选择任务" });
    const dt = fakeDT();
    fireEvent.dragStart(within(strip).getByText("alpha").closest("a")!, { dataTransfer: dt });
    fireEvent.dragOver(within(strip).getByText("beta").closest("a")!, { dataTransfer: dt });
    fireEvent.drop(within(strip).getByText("beta").closest("a")!, { dataTransfer: dt });
    // alpha 挪到 beta 前?reorderKeys(dragged→before):alpha 落在 beta 之前
    // 「临时会话」哨兵键同一条快照入序(默认居首,项目相对序不受扰)
    expect(JSON.parse(localStorage.getItem("mc.projectOrder") ?? "[]")).toEqual(["\u0000chats", "/p/alpha", "/p/beta"]);
    // 组头右键「在此新建任务」(旧侧栏 newTaskIn 键)→ 格内内嵌创建表单
    fireEvent.contextMenu(within(strip).getByText("beta"));
    await userEvent.click(within(document.body.lastElementChild as HTMLElement).getByText("在此新建任务"));
    expect(await screen.findByRole("heading", { name: "新建任务" })).toBeTruthy();
  });

  it("项目组可折叠:点组头收起行(卸载),与主侧栏共用 mc.collapsedGroups", async () => {
    stubShell();
    render(<Harness />);
    const strip = screen.getByRole("complementary", { name: "选择任务" });
    expect(within(strip).getByText("闲着的任务")).toBeTruthy();
    await userEvent.click(within(strip).getByText("alpha"));
    expect(within(strip).queryByText("闲着的任务")).toBeNull();
    expect(JSON.parse(localStorage.getItem("mc.collapsedGroups") ?? "[]")).toContain("/p/alpha");
    await userEvent.click(within(strip).getByText("alpha"));
    expect(within(strip).getByText("闲着的任务")).toBeTruthy();
  });

  it("任务列可折叠:一键收起回全沉浸(空格换回完整装载卡),开合态落盘", async () => {
    stubShell();
    render(<Harness />);
    expect(screen.getByRole("complementary", { name: "选择任务" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "收起任务列" }));
    expect(screen.queryByRole("complementary", { name: "选择任务" })).toBeNull();
    expect(localStorage.getItem("mc.workbenchListHidden")).toBe("1");
    // 收起后空格回落完整装载卡(装载能力不丢)
    expect(within(screen.getAllByRole("region")[0]!).getByRole("tab", { name: "本地" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "展开任务列" }));
    expect(screen.getByRole("complementary", { name: "选择任务" })).toBeTruthy();
    expect(localStorage.getItem("mc.workbenchListHidden")).toBe("0");
  });

  it("任务列拖行到格 = 定点装载(LOAD 通道与格头换位 SWAP 通道并存)", () => {
    stubShell();
    localStorage.setItem("mc.splitTree", JSON.stringify({ dir: "col", ratio: 0.5, a: { leaf: 0 }, b: { leaf: 1 } }));
    localStorage.setItem("mc.splitSlots", JSON.stringify(["s1", null, null, null, null, null]));
    render(<Harness />);
    const list = screen.getByRole("complementary", { name: "选择任务" });
    const first = screen.getByRole("region", { name: "第 1 格" });
    const dt = fakeDT();
    fireEvent.dragStart(within(list).getByText("跑着的任务").closest("a")!, { dataTransfer: dt });
    fireEvent.dragOver(first, { dataTransfer: dt });
    expect(first.querySelector("[data-split-drop]")).not.toBeNull();
    fireEvent.drop(first, { dataTransfer: dt });
    // 定点顶替第 1 格(move 语义;原 s1 从格上卸下——任务列的行照常在,
    // 断言只看格子)
    expect(within(screen.getByRole("region", { name: "第 1 格" })).getByTitle(/跑着的任务/)).toBeTruthy();
    for (const pane of screen.getAllByRole("region")) {
      expect(within(pane).queryByTitle(/已入格的任务/)).toBeNull();
    }
  });
});
