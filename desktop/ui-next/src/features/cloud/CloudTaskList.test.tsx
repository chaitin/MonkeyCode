// 云端任务列表(与本地/对话列表同一套 listKit,不做两套):进行中裸行
// 置顶、「历史任务」小节置底(契约键持久化、收起即卸载)、项目分组懒拉、
// 行右键(终止/删除二段确认)、选择回调(假壳 invoke)。
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CloudTask } from "@/lib/ipc/cloudtasks";
import { CloudTaskList, useCloudProjects, useCloudTasks } from "./CloudTaskList";

/** 数据注入随生产接线(Sidebar 顶层调 hook 供数):测试同构一个 Harness,
 * hook 结果注入 props,断言口径不变。 */
function Harness(props: Omit<Parameters<typeof CloudTaskList>[0], "feed" | "projects">) {
  const feed = useCloudTasks(props.reloadKey ?? 0);
  const projects = useCloudProjects(props.reloadKey ?? 0);
  return <CloudTaskList {...props} feed={feed} projects={projects} />;
}

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function stubShell(invoke: Invoke) {
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke } };
}

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  localStorage.clear();
});

const tasks: CloudTask[] = [
  { id: "a", title: "修复登录", status: "processing" },
  { id: "b", summary: "旧任务甲", status: "finished" },
  { id: "c", content: "旧任务乙", status: "error" },
];

/** 行右键后取命令式菜单(backdrop + menu 追加在 body 末尾)。 */
function contextMenuOf(el: HTMLElement): HTMLElement {
  fireEvent.contextMenu(el);
  return document.body.lastElementChild as HTMLElement;
}

const rowOf = (text: string) => screen.getByText(text).closest("a") as HTMLElement;

describe("CloudTaskList", () => {
  it("进行中裸行置顶(无区标签、无常亮状态点——运行/排队是常态,词进 tooltip),历史收进「历史任务」小节(默认收起、收起即卸载);点击回调", async () => {
    stubShell((cmd) => {
      if (cmd === "mc_tasks") return Promise.resolve({ tasks, page_info: { total: 3 } });
      return Promise.resolve({});
    });
    const onSelect = vi.fn();
    render(<Harness currentId={null} onSelect={onSelect} />);
    await screen.findByText("修复登录");
    // 区标签已撤(listKit 统一版式):进行中行直接平铺
    expect(screen.queryByText("进行中")).toBeNull();
    // 点只给要紧态(2026-08-06 定案):processing 是常态,无点,词进 tooltip
    expect(within(rowOf("修复登录")).queryByRole("img")).toBeNull();
    expect(within(rowOf("修复登录")).queryByText("运行中")).toBeNull(); // 词不上行
    expect(rowOf("修复登录").title).toContain("运行中");
    // 历史默认收起(未持久化过);收起即卸载,行不在 DOM
    const history = screen.getByText("历史任务").closest("details") as HTMLDetailsElement;
    expect(history.open).toBe(false);
    expect(screen.queryByText("旧任务甲")).toBeNull();
    await userEvent.click(screen.getByText("历史任务"));
    expect(history.open).toBe(true);
    expect(screen.getByText("旧任务甲")).toBeTruthy(); // title 缺省回退 summary
    expect(within(rowOf("旧任务乙")).getByRole("img", { name: "运行出错" })).toBeTruthy(); // 再回退 content;error 仍给点
    // 安静行:终态无尾注,状态词收进 tooltip
    expect(within(rowOf("旧任务甲")).queryByText("已完成")).toBeNull();
    expect(rowOf("旧任务甲").title).toContain("已完成");
    await userEvent.click(screen.getByText("旧任务甲"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
    // 开合态落契约键
    expect(localStorage.getItem("mc.cloudHistoryOpen")).toBe("1");
  });

  it("mc.cloudHistoryOpen 预置 \"1\":历史直接展开", async () => {
    localStorage.setItem("mc.cloudHistoryOpen", "1");
    stubShell((cmd) => (cmd === "mc_tasks" ? Promise.resolve({ tasks, page_info: { total: 3 } }) : Promise.resolve({})));
    render(<Harness currentId={null} onSelect={() => {}} />);
    await screen.findByText("修复登录");
    expect((screen.getByText("历史任务").closest("details") as HTMLDetailsElement).open).toBe(true);
  });

  it("空列表:空态文案", async () => {
    stubShell((cmd) =>
      cmd === "mc_tasks" ? Promise.resolve({ tasks: [], page_info: { total: 0 } }) : Promise.resolve({}),
    );
    render(<Harness currentId={null} onSelect={() => {}} />);
    await screen.findByText("还没有云端项目或任务");
  });

  it("reloadKey 切换后立即拉新服务并丢弃旧服务迟到响应", async () => {
    let taskCalls = 0;
    let resolveOld: ((value: { tasks: CloudTask[]; page_info: { total: number } }) => void) | undefined;
    const oldResponse = new Promise<{ tasks: CloudTask[]; page_info: { total: number } }>((resolve) => {
      resolveOld = resolve;
    });
    stubShell((cmd) => {
      if (cmd !== "mc_tasks") return Promise.resolve({ projects: [] });
      taskCalls += 1;
      return taskCalls === 1
        ? oldResponse
        : Promise.resolve({ tasks: [{ id: "new", title: "新服务任务", status: "processing" }], page_info: { total: 1 } });
    });

    const { rerender } = render(<Harness currentId={null} onSelect={() => {}} reloadKey={0} />);
    await waitFor(() => expect(taskCalls).toBe(1));
    rerender(<Harness currentId={null} onSelect={() => {}} reloadKey={1} />);
    await screen.findByText("新服务任务");
    resolveOld?.({ tasks: [{ id: "old", title: "旧服务任务", status: "processing" }], page_info: { total: 1 } });
    await act(async () => undefined);

    expect(screen.queryByText("旧服务任务")).toBeNull();
    expect(screen.getByText("新服务任务")).toBeDefined();
  });

  it("reloadKey 切换时立即清空当前服务的旧任务", async () => {
    let taskCalls = 0;
    let resolveNew: ((value: { tasks: CloudTask[]; page_info: { total: number } }) => void) | undefined;
    const newResponse = new Promise<{ tasks: CloudTask[]; page_info: { total: number } }>((resolve) => {
      resolveNew = resolve;
    });
    stubShell((cmd) => {
      if (cmd !== "mc_tasks") return Promise.resolve({ projects: [] });
      taskCalls += 1;
      return taskCalls === 1
        ? Promise.resolve({ tasks: [{ id: "old", title: "旧服务任务", status: "processing" }], page_info: { total: 1 } })
        : newResponse;
    });

    const { rerender } = render(<Harness currentId={null} onSelect={() => {}} reloadKey={0} />);
    await screen.findByText("旧服务任务");
    rerender(<Harness currentId={null} onSelect={() => {}} reloadKey={1} />);
    await waitFor(() => expect(screen.queryByText("旧服务任务")).toBeNull());
    resolveNew?.({ tasks: [{ id: "new", title: "新服务任务", status: "processing" }], page_info: { total: 1 } });
    await screen.findByText("新服务任务");
  });

  it("首屏失败:错误 + 重试按钮可重拉", async () => {
    let calls = 0;
    stubShell((cmd) => {
      if (cmd !== "mc_tasks") return Promise.resolve({});
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("会话失效"))
        : Promise.resolve({ tasks, page_info: { total: 3 } });
    });
    render(<Harness currentId={null} onSelect={() => {}} />);
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("会话失效");
    await userEvent.click(screen.getByText("重试"));
    await screen.findByText("修复登录");
  });

  it("项目分组:组头区块标签,展开按 project_id 懒拉;无快速开始组(已撤)", async () => {
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    stubShell((cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "mc_projects") return Promise.resolve({ projects: [{ id: "p1", name: "支付服务" }] });
      if (cmd !== "mc_tasks") return Promise.resolve({});
      if (args?.projectId === "p1") return Promise.resolve({ tasks: [{ id: "t1", title: "项目内任务", status: "finished" }] });
      return Promise.resolve({ tasks, page_info: { total: 3 } });
    });
    render(<Harness currentId={null} onSelect={() => {}} />);
    await screen.findByText("支付服务");
    // 「项目」区标签已撤:组头(Folder 区块标签)直接排列
    expect(screen.queryByText("项目")).toBeNull();
    expect(screen.queryByText("项目内任务")).toBeNull();
    // 快速开始组已撤(无项目任务本就在进行中/历史里)
    expect(screen.queryByText("快速开始")).toBeNull();
    await userEvent.click(screen.getByText("支付服务"));
    expect(await screen.findByText("项目内任务")).toBeTruthy();
    expect(calls.some((c) => c.cmd === "mc_tasks" && c.args?.projectId === "p1")).toBe(true);
  });

  it("reloadKey 切换时立即撤下旧服务项目", async () => {
    let projectCalls = 0;
    let taskCalls = 0;
    let resolveNew: ((value: { projects: { id: string; name: string }[] }) => void) | undefined;
    const newProjects = new Promise<{ projects: { id: string; name: string }[] }>((resolve) => {
      resolveNew = resolve;
    });
    stubShell((cmd) => {
      if (cmd === "mc_projects") {
        projectCalls += 1;
        return projectCalls === 1 ? Promise.resolve({ projects: [{ id: "old", name: "旧服务项目" }] }) : newProjects;
      }
      if (cmd === "mc_tasks") {
        taskCalls += 1;
        return Promise.resolve({ tasks: [], page_info: { total: 0 } });
      }
      return Promise.resolve({});
    });

    const { rerender } = render(<Harness currentId={null} onSelect={() => {}} reloadKey={0} />);
    await screen.findByText("旧服务项目");
    rerender(<Harness currentId={null} onSelect={() => {}} reloadKey={1} />);
    await waitFor(() => expect(taskCalls).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.queryByText("旧服务项目")).toBeNull());
    resolveNew?.({ projects: [{ id: "new", name: "新服务项目" }] });
    await screen.findByText("新服务项目");
  });

  it("reloadKey 切换后项目组旧请求不得回灌,已展开的组立即重拉", async () => {
    let resolveOldGroup: ((value: { tasks: CloudTask[] }) => void) | undefined;
    const oldGroup = new Promise<{ tasks: CloudTask[] }>((resolve) => {
      resolveOldGroup = resolve;
    });
    let groupCalls = 0;
    stubShell((cmd, args) => {
      if (cmd === "mc_projects") return Promise.resolve({ projects: [{ id: "p1", name: "同名项目" }] });
      if (cmd === "mc_tasks" && args?.projectId === "p1") {
        groupCalls += 1;
        // 首拉挂起(稍后作为迟到的旧代响应回灌);reloadKey 边沿的重拉返回新数据
        return groupCalls === 1
          ? oldGroup
          : Promise.resolve({ tasks: [{ id: "new-group", title: "新组任务", status: "finished" }] });
      }
      if (cmd === "mc_tasks") return Promise.resolve({ tasks: [], page_info: { total: 0 } });
      return Promise.resolve({});
    });

    const { rerender } = render(<Harness currentId={null} onSelect={() => {}} reloadKey={0} />);
    await userEvent.click(await screen.findByText("同名项目"));
    rerender(<Harness currentId={null} onSelect={() => {}} reloadKey={1} />);
    // 已展开的 details 不会再触发 onToggle:重拉必须由 reloadKey 边沿驱动,
    // 只清不拉会让展开中的组永久空白
    await screen.findByText("新组任务");
    resolveOldGroup?.({ tasks: [{ id: "old-group", title: "旧组任务", status: "finished" }] });
    await act(async () => undefined);

    expect(screen.queryByText("旧组任务")).toBeNull();
    expect(screen.getByText("新组任务")).toBeTruthy();
  });

  it("行右键删除:二段确认 → mc_task_delete → 整表重拉 + onDeleted 回调", async () => {
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    stubShell((cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "mc_tasks") return Promise.resolve({ tasks, page_info: { total: 3 } });
      if (cmd === "mc_task_delete") return Promise.resolve({ ok: true });
      return Promise.resolve({});
    });
    const onDeleted = vi.fn();
    render(<Harness currentId={null} onSelect={() => {}} onDeleted={onDeleted} />);
    await screen.findByText("修复登录");
    const menu = contextMenuOf(rowOf("修复登录"));
    await userEvent.click(within(menu).getByText("删除任务"));
    expect(calls.some((c) => c.cmd === "mc_task_delete")).toBe(false); // 一次点击不执行
    await userEvent.click(within(menu).getByText("确认删除"));
    await waitFor(() => expect(calls.some((c) => c.cmd === "mc_task_delete" && c.args?.id === "a")).toBe(true));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("a"));
  });

  it("删除被服务端拒绝(任务仍在运行):原因外显,不静默", async () => {
    stubShell((cmd) => {
      if (cmd === "mc_tasks") return Promise.resolve({ tasks, page_info: { total: 3 } });
      if (cmd === "mc_task_delete") return Promise.reject(new Error("任务仍在运行"));
      return Promise.resolve({});
    });
    render(<Harness currentId={null} onSelect={() => {}} />);
    await screen.findByText("修复登录");
    const menu = contextMenuOf(rowOf("修复登录"));
    await userEvent.click(within(menu).getByText("删除任务"));
    await userEvent.click(within(menu).getByText("确认删除"));
    await screen.findByText(/删除任务失败.*任务仍在运行/);
  });

  it("终止任务:仅运行中行出菜单项,二段确认 → mc_task_stop → 整表重拉", async () => {
    localStorage.setItem("mc.cloudHistoryOpen", "1");
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    stubShell((cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "mc_tasks") return Promise.resolve({ tasks, page_info: { total: 3 } });
      if (cmd === "mc_task_stop") return Promise.resolve({ ok: true });
      return Promise.resolve({});
    });
    render(<Harness currentId={null} onSelect={() => {}} />);
    await screen.findByText("修复登录");
    // 已完成行右键:没有终止项
    let menu = contextMenuOf(rowOf("旧任务甲"));
    expect(within(menu).queryByText("终止任务")).toBeNull();
    fireEvent.mouseDown(menu.previousElementSibling as HTMLElement); // 关掉这层菜单

    menu = contextMenuOf(rowOf("修复登录"));
    await userEvent.click(within(menu).getByText("终止任务"));
    expect(calls.some((c) => c.cmd === "mc_task_stop")).toBe(false);
    await userEvent.click(within(menu).getByText("确认终止"));
    await waitFor(() => expect(calls.some((c) => c.cmd === "mc_task_stop" && c.args?.id === "a")).toBe(true));
    await waitFor(() => expect(calls.filter((c) => c.cmd === "mc_tasks").length).toBeGreaterThanOrEqual(2));
  });

  it("总数超已载:历史段出「加载更多」并续拉合并", async () => {
    localStorage.setItem("mc.cloudHistoryOpen", "1");
    const page2: CloudTask[] = [{ id: "d", title: "更早的", status: "finished" }];
    stubShell((cmd, args) => {
      if (cmd !== "mc_tasks") return Promise.resolve({});
      return Promise.resolve(
        (args?.page as number) === 1 ? { tasks, page_info: { total: 4 } } : { tasks: page2, page_info: { total: 4 } },
      );
    });
    render(<Harness currentId={null} onSelect={() => {}} />);
    await screen.findByText("修复登录");
    await userEvent.click(screen.getByText("加载更多"));
    await screen.findByText("更早的");
    await waitFor(() => expect(screen.queryByText("加载更多")).toBeNull()); // 4/4 载完
  });

  // 自动刷新(旧 UI App.tsx:329-340;ui-next 此前只有创建/终止/删除/手动刷新
  // /切空间会拉数)。没有它,网页/手机端派发的任务永远不出现,状态翻转也一路静止
  it("窗口重获焦点即刷新:网页/手机端刚派发的任务切回来就看得见", async () => {
    let batch: CloudTask[] = [{ id: "a", title: "修复登录", status: "processing" }];
    let calls = 0;
    stubShell((cmd) => {
      if (cmd !== "mc_tasks") return Promise.resolve({});
      calls += 1;
      return Promise.resolve({ tasks: batch, page_info: { total: batch.length } });
    });
    render(<Harness currentId={null} onSelect={() => {}} />);
    await screen.findByText("修复登录");
    expect(calls).toBe(1);
    batch = [{ id: "z", title: "手机上派的活", status: "pending" }, ...batch];
    fireEvent.focus(window);
    await screen.findByText("手机上派的活");
  });

  it("30s 轮询:状态翻转(pending→processing→finished)不用手动刷新", async () => {
    vi.useFakeTimers();
    try {
      let batch: CloudTask[] = [{ id: "a", title: "修复登录", status: "pending" }];
      stubShell((cmd) =>
        cmd === "mc_tasks" ? Promise.resolve({ tasks: batch, page_info: { total: 1 } }) : Promise.resolve({}),
      );
      render(<Harness currentId={null} onSelect={() => {}} />);
      await act(async () => void (await vi.advanceTimersByTimeAsync(100)));
      expect(rowOf("修复登录").title).toContain("排队中");
      // 仍留在「进行中」段(finished 会掉进默认收起的历史小节,断言就跟
      // 折叠态纠缠了):只看状态词跟着云端翻
      batch = [{ id: "a", title: "修复登录", status: "processing" }];
      await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)));
      expect(rowOf("修复登录").title).toContain("运行中");
    } finally {
      vi.useRealTimers();
    }
  });

  it("后台刷新用合并而非整表替换:已翻出来的深层页不会被 30s 一次的轮询收回去", async () => {
    localStorage.setItem("mc.cloudHistoryOpen", "1");
    const page2: CloudTask[] = [{ id: "d", title: "更早的", status: "finished" }];
    stubShell((cmd, args) => {
      if (cmd !== "mc_tasks") return Promise.resolve({});
      return Promise.resolve(
        (args?.page as number) === 1 ? { tasks, page_info: { total: 4 } } : { tasks: page2, page_info: { total: 4 } },
      );
    });
    render(<Harness currentId={null} onSelect={() => {}} />);
    await screen.findByText("修复登录");
    await userEvent.click(screen.getByText("加载更多"));
    await screen.findByText("更早的");
    fireEvent.focus(window); // 后台刷新只拉首页
    await waitFor(() => expect(screen.getByText("更早的")).toBeTruthy());
    expect(screen.queryByText("加载更多")).toBeNull(); // 分页水位没被后台刷新推回去
  });

  it("query:过滤行并强制展开历史", async () => {
    stubShell((cmd) => (cmd === "mc_tasks" ? Promise.resolve({ tasks, page_info: { total: 3 } }) : Promise.resolve({})));
    render(<Harness currentId={null} onSelect={() => {}} query="旧任务甲" />);
    await screen.findByText("旧任务甲"); // 历史被强制展开且命中
    expect(screen.queryByText("修复登录")).toBeNull();
    expect(screen.queryByText("旧任务乙")).toBeNull();
  });
});
