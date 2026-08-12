// 侧栏:壳布局(h-13 品牌头/滚动列表)+ 信息布局(单行摘要优先、安静行:
// 行尾状态点仅要紧态、归档小节)+ daisyUI 原生形态(menu/details/status/badge)。
// 交互:行右键菜单、行内重命名、组头快捷新建、折叠契约键。
// (搜索行按用户指令暂撤,回归时补测:query 过滤 + 全折叠段强制展开)
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionMeta } from "@/lib/ipc/sessions";
import type { SidebarActions } from "./Sidebar";
import { Sidebar } from "./Sidebar";

afterEach(() => {
  localStorage.clear();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

/** 云端概览统计用的假壳(与 CloudTaskList.test 同法)。 */
function stubShell(invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) {
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
}

const meta = (over: Partial<SessionMeta> & { id: string; workdir: string }): SessionMeta => ({
  title: over.id,
  model: "m",
  turns: 0,
  status: "idle",
  ...over,
});

const SESSIONS: SessionMeta[] = [
  meta({ id: "修复登录", workdir: "/p/alpha", updated_at: "2026-08-03", turns: 3, summary: "修复了闪退,补了用例" }),
  meta({ id: "重构侧栏", workdir: "/p/alpha", updated_at: "2026-08-02", waiting_ask: true }),
  meta({ id: "旧任务", workdir: "/p/beta", updated_at: "2026-08-01", archived: true }),
  meta({ id: "闲聊", workdir: "/hidden/c1", kind: "chat", summary: "问了个问题" }),
];

function actions(over: Partial<SidebarActions> = {}): SidebarActions {
  return {
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onToggleArchive: vi.fn(),
    onRename: vi.fn(),
    onNewTask: vi.fn(),
    onNewTaskIn: vi.fn(),
    ...over,
  };
}

/** 行右键后取命令式菜单(backdrop + menu 追加在 body 末尾)。 */
function contextMenuOf(el: HTMLElement): HTMLElement {
  fireEvent.contextMenu(el);
  return document.body.lastElementChild as HTMLElement;
}

const rowOf = (text: string) => screen.getByText(text).closest("a") as HTMLElement;
const detailsOf = (text: string) => screen.getByText(text).closest("details") as HTMLDetailsElement;

describe("侧栏(local 空间)", () => {
  it("按项目分组(details 折叠):行单行且摘要优先(缺席回落标题);组头等待徽标;行可选中", async () => {
    const acts = actions();
    render(<Sidebar space="local" sessions={SESSIONS} currentId={null} actions={acts} />);
    const alphaGroup = detailsOf("alpha");
    // 有摘要的行主文案 = 摘要,标题只进 tooltip;无摘要的行给标题
    expect(within(alphaGroup).getByText("修复了闪退,补了用例")).toBeTruthy();
    expect(within(alphaGroup).queryByText("修复登录")).toBeNull();
    expect(within(alphaGroup).getByText("重构侧栏")).toBeTruthy();
    expect(within(alphaGroup).getByText("1")).toBeTruthy(); // waiting_ask 计数徽标
    await userEvent.click(screen.getByText("修复了闪退,补了用例"));
    expect(acts.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "修复登录" }));
  });

  it("项目图标随开合切换:展开 folder-open,收起 folder", async () => {
    render(<Sidebar space="local" sessions={SESSIONS} currentId={null} actions={actions()} />);
    const label = screen.getByText("alpha");
    const summary = label.closest("summary") as HTMLElement;
    expect(summary.querySelector(".tabler-icon-folder-open")).toBeTruthy();

    await userEvent.click(label);
    expect(detailsOf("alpha").open).toBe(false);
    expect(summary.querySelector(".tabler-icon-folder")).toBeTruthy();
    expect(summary.querySelector(".tabler-icon-folder-open")).toBeNull();
  });

  it("用户改过名的行:改名压过摘要(title_custom;与 ChatView 头部同一优先级)", () => {
    const renamed = SESSIONS.map((s) => (s.id === "修复登录" ? { ...s, title_custom: true } : s));
    render(<Sidebar space="local" sessions={renamed} currentId={null} actions={actions()} />);
    const alphaGroup = detailsOf("alpha");
    expect(within(alphaGroup).getByText("修复登录")).toBeTruthy();
    expect(within(alphaGroup).queryByText("修复了闪退,补了用例")).toBeNull();
  });

  // 云端多一颗刷新钮(btn-xs = 24px),而 text-xs 的行盒只有 16px——标题行
  // 不预留高度的话,「有钮的云端」比「没钮的本地/对话」整整高 8px,切空间时
  // 概览块往下一跳(2026-08-09 用户报障)。同 LAYOUT §6.2 的 hover 显隐铁律:
  // 行高不许由"这行恰好有没有那个元素"决定。
  it.each(["local", "chat", "cloud"] as const)(
    "%s 概览:标题行恒留一个 btn-xs 的高度,不随刷新钮有无变化",
    (space) => {
      const { container } = render(
        <Sidebar space={space} sessions={SESSIONS} currentId={null} actions={actions()} />,
      );
      const titleRow = container.querySelector(".flex.min-h-\\[calc\\(var\\(--size-field\\,0\\.25rem\\)\\*6\\)\\]");
      expect(titleRow, `${space} 概览标题行缺少预留高度`).not.toBeNull();
    },
  );

  it("概览块:空间标题 + 描述 + 统计(归档不计;等待确认仅 >0 时着色出现)", () => {
    render(<Sidebar space="local" sessions={SESSIONS} currentId={null} actions={actions()} />);
    expect(screen.getByText("本地任务")).toBeTruthy();
    expect(screen.getByText("挑个文件夹,让它在你电脑上干活")).toBeTruthy();
    expect(screen.getByText("1 项目")).toBeTruthy(); // beta 只剩归档任务,不计
    expect(screen.getByText("2 任务")).toBeTruthy();
    expect(screen.getByText("1 等待确认")).toBeTruthy();
    expect(screen.queryByText(/运行中/)).toBeNull(); // 无运行中则不出现
  });

  it("行尾状态点只给要紧态(文字词不上行,词进点 aria);静默行无点,轮次收进 tooltip", () => {
    render(<Sidebar space="local" sessions={SESSIONS} currentId={null} actions={actions()} />);
    // 状态词换成状态点(用户定案 2026-08-05):行内不出现文字词
    expect(within(rowOf("重构侧栏")).queryByText("等待确认")).toBeNull();
    expect(within(rowOf("重构侧栏")).getByRole("img", { name: "等待确认" })).toBeTruthy();
    const quiet = rowOf("修复了闪退,补了用例");
    expect(within(quiet).queryByRole("img")).toBeNull(); // 静默行无点
    expect(within(quiet).queryByText("3 轮")).toBeNull();
    expect(quiet.title).toContain("3 轮");
  });

  // LAYOUT §6.1 承诺「静默态(可继续/未开始/已停止)的词收进行 tooltip」,
  // 实现里却只有 status.turns 搬过去了:tooltip 只插值 trailing?.label,而
  // 静默态根本不给 trailing —— zh.ts 里的 status.interrupted/idle/notStarted
  // 成了没人读的孤儿键。配合"interrupted 不出提醒"那个 bug,被引擎崩溃打断的
  // 后台任务在界面上处处隐身
  it("静默状态词进 tooltip 且不上行:已停止 / 可继续 / 尚未开始", () => {
    const sessions = [
      meta({ id: "被打断的", workdir: "/p/alpha", status: "interrupted", turns: 2 }),
      meta({ id: "可以接着来", workdir: "/p/alpha", status: "idle", turns: 1 }),
      meta({ id: "还没开始", workdir: "/p/alpha", status: "created", turns: 0 }),
    ];
    render(<Sidebar space="local" sessions={sessions} currentId={null} actions={actions()} />);
    for (const [id, word] of [
      ["被打断的", "已停止"],
      ["可以接着来", "可继续"],
      ["还没开始", "尚未开始"],
    ] as const) {
      const row = rowOf(id);
      expect(row.title).toContain(word);
      expect(within(row).queryByText(word)).toBeNull(); // 词不上行
      expect(within(row).queryByRole("img")).toBeNull(); // 静默态不给点
    }
  });

  it("要紧态的词同样在 tooltip 里(点的 aria 之外多一份可读文本)", () => {
    render(<Sidebar space="local" sessions={SESSIONS} currentId={null} actions={actions()} />);
    expect(rowOf("重构侧栏").title).toContain("等待确认");
  });

  it("归档任务收进项目内「已归档任务 · N」小节(默认收起,点开并落契约键);chat 会话不出现", async () => {
    render(<Sidebar space="local" sessions={SESSIONS} currentId={null} actions={actions()} />);
    expect(screen.queryByText("问了个问题")).toBeNull();
    const section = detailsOf("已归档任务");
    expect(section.open).toBe(false);
    await userEvent.click(screen.getByText("已归档任务"));
    expect(section.open).toBe(true);
    expect(JSON.parse(localStorage.getItem("mc.sessionArchivesOpen") ?? "[]")).toContain("/p/beta");
  });

  it("活态点 = 实心点 + 扩散环(运行中/等待确认);终态只给静点", () => {
    const sessions = [
      meta({ id: "跑着的", workdir: "/p/alpha", status: "running" }),
      meta({ id: "等确认", workdir: "/p/alpha", waiting_ask: true }),
      meta({ id: "挂了的", workdir: "/p/alpha", status: "error" }),
    ];
    render(<Sidebar space="local" sessions={sessions} currentId={null} actions={actions()} />);
    // 环是**额外**一层,实心点照旧常驻——用户反馈 animate-pulse 靠淡化制造
    // 动效、点本身反而看不清(2026-08-07);换 ping 后任何相位状态都可读
    const live = within(rowOf("跑着的")).getByRole("img", { name: "运行中" });
    expect(live.querySelectorAll(".status").length).toBe(2);
    expect(live.innerHTML).toContain("animate-ping");
    expect(within(rowOf("等确认")).getByRole("img", { name: "等待确认" }).innerHTML).toContain("animate-ping");
    // 终态不动:出错是结论,不是进行中
    const done = within(rowOf("挂了的")).getByRole("img", { name: "运行出错" });
    expect(done.querySelectorAll(".status").length).toBe(1);
    expect(done.innerHTML).not.toContain("animate-ping");
  });

  it("已归档任务的标题降为弱化色,活跃任务保持正文色(用户报障:归档标题还是黑的)", async () => {
    localStorage.setItem("mc.sessionArchivesOpen", JSON.stringify(["/p/beta"]));
    render(<Sidebar space="local" sessions={SESSIONS} currentId={null} actions={actions()} />);
    // 归档行主文案挂弱化档;活跃行是正文档——两者必须不同,否则归档区与
    // 活跃任务在列表里一样抢眼
    const archived = screen.getByText("旧任务");
    const active = screen.getByText("修复了闪退,补了用例");
    expect(archived.className).toContain("text-base-content/55");
    expect(active.className).not.toContain("text-base-content/55"); // 活跃行走正文色
  });

  it("组头维持安静小标签(用户定案:不走锚点形态)", () => {
    render(<Sidebar space="local" sessions={SESSIONS} currentId={null} actions={actions()} />);
    const label = screen.getByText("alpha");
    expect(label.className).toContain("text-xs");
    expect(label.className).toContain("text-base-content/50");
    expect(label.className).not.toContain("font-semibold");
  });

  it("行右键菜单:归档直接触发;删除二段确认(第二段带后果句)", async () => {
    const acts = actions();
    render(<Sidebar space="local" sessions={SESSIONS} currentId={null} actions={acts} />);
    let menu = contextMenuOf(rowOf("修复了闪退,补了用例"));
    await userEvent.click(within(menu).getByText("归档"));
    expect(acts.onToggleArchive).toHaveBeenCalledWith(expect.objectContaining({ id: "修复登录" }));

    menu = contextMenuOf(rowOf("修复了闪退,补了用例"));
    await userEvent.click(within(menu).getByText("删除"));
    expect(acts.onDelete).not.toHaveBeenCalled(); // 第一次点只换文案
    // 后果句不能丢:旧 UI 的 ConfirmPane 是「删除后不可恢复。」+「确认删除」
    // 两行,命令式菜单只有一行按钮,后果合并进标签(云端「终止」侧一直有
    // 这句,只有会话删除掉了)
    const confirm = within(menu).getByText(/确认删除/);
    expect(confirm.textContent).toContain("不可恢复");
    await userEvent.click(confirm);
    expect(acts.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "修复登录" }));
  });

  // 旧 UI 的 DeleteMenuItem 对运行中的会话直接置灰 + title「运行中,请先停止」;
  // ui-next 此前压根没看 meta.status,于是运行中的会话点得下去,壳/内核拒了
  // 也没人说为什么(用户只看到"点了没反应")
  it("运行中的会话不给删:菜单项置灰并写明理由,点不动", async () => {
    const acts = actions();
    const sessions = [meta({ id: "跑着的", workdir: "/p/alpha", status: "running" })];
    render(<Sidebar space="local" sessions={sessions} currentId={null} actions={acts} />);
    const menu = contextMenuOf(rowOf("跑着的"));
    const del = within(menu).getByText("删除") as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(del.title).toBe("运行中,请先停止");
    expect(del.closest("li")?.className).toContain("menu-disabled");
    await userEvent.click(del);
    expect(acts.onDelete).not.toHaveBeenCalled();
    // 二段确认也不该被"武装":文案原地不动
    expect(within(menu).queryByText(/确认删除/)).toBeNull();
  });

  it("非运行中的会话照常可删(置灰只针对 running)", async () => {
    const acts = actions();
    const sessions = [meta({ id: "停下的", workdir: "/p/alpha", status: "interrupted" })];
    render(<Sidebar space="local" sessions={sessions} currentId={null} actions={acts} />);
    const menu = contextMenuOf(rowOf("停下的"));
    expect((within(menu).getByText("删除") as HTMLButtonElement).disabled).toBe(false);
  });

  it("重命名:右键菜单进入行内输入,Enter 提交新标题", async () => {
    const acts = actions();
    render(<Sidebar space="local" sessions={SESSIONS} currentId={null} actions={acts} />);
    const menu = contextMenuOf(rowOf("修复了闪退,补了用例"));
    await userEvent.click(within(menu).getByText("重命名"));
    const input = screen.getByRole("textbox", { name: "重命名" });
    await userEvent.clear(input);
    await userEvent.type(input, "登录修完了{Enter}");
    expect(acts.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: "修复登录" }), "登录修完了");
    expect(screen.queryByRole("textbox", { name: "重命名" })).toBeNull();
  });

  it("旧版自定义标题缺 title_custom:右键重命名原文确认也发 onRename 补标记", async () => {
    // 行里显示的是 summary、输入框预填的是原 title——旧口径把「文本未变」
    // 当空转拦下,标记永远补不上(头部 4ab809db 修过,侧栏漏了同一条)
    const acts = actions();
    render(<Sidebar space="local" sessions={SESSIONS} currentId={null} actions={acts} />);
    const menu = contextMenuOf(rowOf("修复了闪退,补了用例"));
    await userEvent.click(within(menu).getByText("重命名"));
    const input = screen.getByRole("textbox", { name: "重命名" }) as HTMLInputElement;
    expect(input.value).toBe("修复登录");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(acts.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: "修复登录" }), "修复登录");
  });

  it("已带 title_custom 的行:原文确认是纯空转,不发 onRename", async () => {
    const acts = actions();
    const renamed = SESSIONS.map((s) => (s.id === "修复登录" ? { ...s, title_custom: true } : s));
    render(<Sidebar space="local" sessions={renamed} currentId={null} actions={acts} />);
    const menu = contextMenuOf(rowOf("修复登录"));
    await userEvent.click(within(menu).getByText("重命名"));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "重命名" }), { key: "Enter" });
    expect(acts.onRename).not.toHaveBeenCalled();
  });

  it("项目组头:hover 快捷「在此项目新建任务」带项目目录回调", async () => {
    const acts = actions();
    render(<Sidebar space="local" sessions={SESSIONS} currentId={null} actions={acts} />);
    // alpha 组在前(组按活跃度排序)
    await userEvent.click(screen.getAllByRole("button", { name: "在此项目新建任务" })[0] as HTMLElement);
    expect(acts.onNewTaskIn).toHaveBeenCalledWith("/p/alpha");
  });

  it("项目组头右键:在此新建任务 / 归档项目(沉入底部段并落契约键)", async () => {
    render(<Sidebar space="local" sessions={SESSIONS} currentId={null} actions={actions()} />);
    const summary = screen.getByText("alpha").closest("summary") as HTMLElement;
    const menu = contextMenuOf(summary);
    expect(within(menu).getByText("在此新建任务")).toBeTruthy();
    await userEvent.click(within(menu).getByText("归档项目"));
    expect(screen.getByText("已归档项目")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("mc.archivedProjects") ?? "[]")).toContain("/p/alpha");
  });

  it("头部新建任务按钮", async () => {
    const acts = actions();
    render(<Sidebar space="local" sessions={[]} currentId={null} actions={acts} />);
    await userEvent.click(screen.getByRole("button", { name: "新建任务" }));
    expect(acts.onNewTask).toHaveBeenCalled();
  });
});

describe("侧栏(chat/cloud 空间)", () => {
  it("chat 空间平铺对话,主行用摘要", () => {
    render(<Sidebar space="chat" sessions={SESSIONS} currentId={null} actions={actions()} />);
    expect(screen.getByText("问了个问题")).toBeTruthy();
    expect(screen.queryByText("修复登录")).toBeNull();
  });

  it("chat 归档小节:mc.archivedOpen 契约键(\"1\" 预置即展开)", () => {
    localStorage.setItem("mc.archivedOpen", "1");
    const withArchived = [...SESSIONS, meta({ id: "老对话", workdir: "/hidden/c2", kind: "chat", archived: true })];
    render(<Sidebar space="chat" sessions={withArchived} currentId={null} actions={actions()} />);
    expect(detailsOf("已归档会话").open).toBe(true);
  });

  it("cloud 空间渲染云端任务列表(无数据时空态)", async () => {
    render(<Sidebar space="cloud" sessions={SESSIONS} currentId={null} actions={actions()} />);
    expect(await screen.findByText("还没有云端项目或任务")).toBeTruthy();
  });

  it("cloud 概览统计与本地同构:N 项目/N 任务;运行中 primary、排队中 warning 着色(仅 >0)", async () => {
    stubShell((cmd) => {
      if (cmd === "mc_tasks")
        return Promise.resolve({
          tasks: [
            { id: "a", title: "跑着的", status: "processing" },
            { id: "b", title: "排队的", status: "pending" },
            { id: "c", title: "完结的", status: "finished" },
          ],
          page_info: { total: 3 },
        });
      if (cmd === "mc_projects") return Promise.resolve({ projects: [{ id: "p1", name: "支付服务" }] });
      return Promise.resolve({});
    });
    render(<Sidebar space="cloud" sessions={SESSIONS} currentId={null} actions={actions()} />);
    expect(await screen.findByText("1 项目")).toBeTruthy();
    expect(screen.getByText("3 任务")).toBeTruthy(); // 总数以服务端 total 为准
    expect(screen.getByText("1 运行中").className).toContain("text-primary");
    expect(screen.getByText("1 排队中").className).toContain("text-warning");
  });

  it("cloud 概览:非要紧态不出彩字(全部已结束时只有总量)", async () => {
    stubShell((cmd) => {
      if (cmd === "mc_tasks")
        return Promise.resolve({ tasks: [{ id: "c", title: "完结的", status: "finished" }], page_info: { total: 1 } });
      if (cmd === "mc_projects") return Promise.resolve({ projects: [] });
      return Promise.resolve({});
    });
    render(<Sidebar space="cloud" sessions={SESSIONS} currentId={null} actions={actions()} />);
    expect(await screen.findByText("1 任务")).toBeTruthy();
    expect(screen.queryByText(/运行中/)).toBeNull();
    expect(screen.queryByText(/排队中/)).toBeNull();
  });
});

describe("后台提醒 attention(D3)", () => {
  it("命中会话:行进入 attention 态(data-attention 在 <a> 上);未命中不受影响", () => {
    render(
      <Sidebar
        space="local"
        sessions={SESSIONS}
        currentId={null}
        actions={actions()}
        attentionIds={new Set(["修复登录"])}
      />,
    );
    expect(rowOf("修复了闪退,补了用例").dataset.attention).toBeDefined();
    expect(rowOf("重构侧栏").dataset.attention).toBeUndefined();
  });

  it("chat 空间同样生效", () => {
    render(
      <Sidebar space="chat" sessions={SESSIONS} currentId={null} actions={actions()} attentionIds={new Set(["闲聊"])} />,
    );
    expect(rowOf("问了个问题").dataset.attention).toBeDefined();
  });

  // 警示条的 x 必须跟着本行缩进走(用户报障 2026-08-10「太靠左了」后改的):
  // listKit.LEVELS 里 pad 与 bar 是成对的,谁改一半这条就红
  it("警示条跟随本行缩进:平铺行(L0)与项目内任务行(L1)各用各的 x", () => {
    const { unmount } = render(
      <Sidebar space="chat" sessions={SESSIONS} currentId={null} actions={actions()} attentionIds={new Set(["闲聊"])} />,
    );
    const flat = rowOf("问了个问题").className;
    expect(flat).toContain("before:start-1"); // 文字 12px - 8px
    expect(flat).not.toContain("ps-6");
    unmount();

    render(
      <Sidebar space="local" sessions={SESSIONS} currentId={null} actions={actions()} attentionIds={new Set(["修复登录"])} />,
    );
    const nested = rowOf("修复了闪退,补了用例").className;
    expect(nested).toContain("ps-6"); // 文字 24px
    expect(nested).toContain("before:start-4"); // 24px - 8px
  });
});

describe("嵌套折叠互不串扰", () => {
  it("开合「已归档任务」小节不连带折叠所在项目(React toggle 合成冒泡守卫)", async () => {
    render(<Sidebar space="local" sessions={SESSIONS} currentId={null} actions={actions()} />);
    const sub = screen.getByText("已归档任务");
    await userEvent.click(sub); // 展开小节
    expect(screen.getByText("旧任务")).toBeTruthy();
    await userEvent.click(sub); // 收起小节
    // 项目组必须仍然展开(冒泡未守卫时会被连带折叠)
    const project = screen.getByText("beta").closest("details") as HTMLDetailsElement;
    expect(project.open).toBe(true);
    // 小节自身已收起(收起即卸载)
    expect(screen.queryByText("旧任务")).toBeNull();
  });
});
