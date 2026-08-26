// 云端任务详情冒烟:结束态 rounds 回放、启动态时间线、提问大纲(REST 索引
// 合并 + 跳转补页)、云端文件面板、审批答复经 WS 上行(假壳 invoke;协议
// 状态机的行为契约在 lib/cloud/stream.test.ts,这里只验编排与渲染)。
// 形态与 ChatView 同构(LAYOUT §3/§4/§7):头部图标钮 + ⋯ 菜单(终止/删除
// 二段确认)、状态徽标不进头部、拖拽属性逐节点、运行条入输入卡、结束态
// LogList 只读。
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { b64decode, b64encode } from "@/lib/protocol/codec";
import {
  cloudSendQueueTarget,
  createSendQueueItem,
  emptySendQueueLane,
  enqueue,
  writeSendQueueLane,
} from "@/features/chat/composer/sendQueue";
import { CloudQueueCoordinatorProvider } from "./CloudQueueCoordinator";
import { CloudTaskView } from "./CloudTaskView";

function renderCloud(ui: ReactElement) {
  return render(
    <CloudQueueCoordinatorProvider
      loadIdentity={() => Promise.resolve({
        logged_in: true,
        base_url: "http://localhost:8000/private/team-a",
        user: { id: "view-test-user" },
      })}
    >
      {ui}
    </CloudQueueCoordinatorProvider>,
  );
}

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function stubShell(invoke: Invoke) {
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: { invoke },
    event: { listen: () => Promise.resolve(() => {}) },
  };
}

/** 带事件管道的假壳:记录 ws-msg/ws-closed 监听,测试可向下行推帧。 */
function stubShellWs(invoke: Invoke) {
  const listeners = new Map<string, (e: { payload: unknown }) => void>();
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: { invoke },
    event: {
      listen: (name: string, cb: (e: { payload: unknown }) => void) => {
        listeners.set(name, cb);
        return Promise.resolve(() => listeners.delete(name));
      },
    },
  };
  return listeners;
}

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  localStorage.clear();
});

describe("CloudTaskView", () => {
  it("启动期可连续追加，草稿逐条清空且不旁路 transport", async () => {
    let infoCalls = 0;
    const streamModes: string[] = [];
    stubShellWs((cmd, args) => {
      if (cmd === "mc_task_info") {
        infoCalls += 1;
        return Promise.resolve({ id: "queue-start", status: "pending" });
      }
      if (cmd === "cloud_ws_open" && args?.kind === "stream") {
        streamModes.push(String((args.params as { mode?: string })?.mode ?? ""));
      }
      return Promise.resolve({});
    });
    renderCloud(<CloudTaskView task={{ id: "queue-start", status: "pending" }} />);
    const box = await screen.findByLabelText("消息输入");
    await waitFor(() => expect(infoCalls).toBeGreaterThan(0));
    fireEvent.change(box, { target: { value: "第一条" } });
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    expect((box as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(box, { target: { value: "第二条" } });
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText("第一条")).toBeTruthy();
    expect(screen.getByText("第二条")).toBeTruthy();
    expect(streamModes).toEqual([]);
  });

  it("结束态异常队列提供停止并清除入口", async () => {
    const accountScope = "http://localhost:8000/private/team-a|view-test-user";
    writeSendQueueLane(cloudSendQueueTarget(accountScope, "terminal-queue"), {
      ...enqueue(emptySendQueueLane(), createSendQueueItem("未发送", [])),
      blocked: { code: "task-ended", message: "Task ended before queued messages were sent", at: 1 },
    });
    stubShellWs((cmd) => {
      if (cmd === "mc_task_info") return Promise.resolve({ id: "terminal-queue", status: "finished" });
      if (cmd === "mc_task_rounds") return Promise.resolve({ frames: [] });
      return Promise.resolve({});
    });
    renderCloud(<CloudTaskView task={{ id: "terminal-queue", status: "finished" }} />);
    expect(await screen.findByText("未发送")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "停止并清除队列" }));
    await waitFor(() => expect(screen.queryByText("未发送")).toBeNull());
    expect(Object.keys(localStorage).some((key) => key.includes("terminal-queue"))).toBe(false);
  });

  it("运行态零回显恢复为 uncertain，并明确提供重试或移除", async () => {
    const accountScope = "http://localhost:8000/private/team-a|view-test-user";
    const item = createSendQueueItem("可能已送达", [], { id: "uncertain-message", createdAt: 1 });
    writeSendQueueLane(cloudSendQueueTarget(accountScope, "uncertain-queue"), {
      version: 1,
      pending: [],
      inFlight: { item, phase: "uncertain", startedAt: 1 },
      blocked: { code: "receipt-unknown", message: "No delivery receipt", at: 2 },
    });
    stubShellWs((cmd) => {
      if (cmd === "mc_task_info") return Promise.resolve({ id: "uncertain-queue", status: "processing" });
      return Promise.resolve({});
    });
    renderCloud(<CloudTaskView task={{ id: "uncertain-queue", status: "processing" }} />);
    expect(await screen.findByText("可能已送达")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "移除此消息" }));
    await waitFor(() => expect(screen.queryByText("可能已送达")).toBeNull());
  });

  it("结束态:mc_task_rounds 回放经归约渲染,只读提示,无 composer", async () => {
    stubShell((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t1", status: "finished", title: "完结任务" });
        case "mc_task_rounds":
          return Promise.resolve({
            frames: [
              { type: "user-input", seq: 1, timestamp: 1000, data: { content: b64encode("部署到测试环境") } },
              { type: "task-ended", seq: 2, timestamp: 2000 },
            ],
            next_cursor: "",
            has_more: false,
          });
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t1", title: "完结任务", status: "finished" }} />);
    await screen.findByText("部署到测试环境"); // 回放的用户消息(content 解 base64)
    // 轮次边界收敛为呼吸位:不渲染文字,全文留在 title(LogList turn-end 分流)
    expect(screen.queryByText("— 本轮结束 —")).toBeNull();
    expect(screen.getByTitle("— 本轮结束 —")).toBeTruthy();
    expect(screen.getByText(/只读回放/)).toBeTruthy();
    expect(screen.queryByLabelText("消息输入")).toBeNull(); // 结束态无 composer
    expect(screen.queryByText("终止任务")).toBeNull(); // 终止收进 ⋯ 菜单,结束态连菜单项都没有
    // ⋯ 菜单:结束态只剩删除(终止无意义)
    await userEvent.click(screen.getByRole("button", { name: "任务操作" }));
    expect(screen.queryByText("终止任务")).toBeNull();
    expect(screen.getByText("删除任务")).toBeTruthy();
  });

  it("启动态:整屏时间线,composer **可用**(桌面独有:启动期照常输入),停止按钮在", async () => {
    stubShell((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({
            id: "t2",
            status: "pending",
            virtualmachine: { id: "", status: "creating", conditions: [{ type: "ImagePulled", status: 1, progress: 30 }] },
          });
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t2", title: "新任务", status: "pending" }} />);
    await screen.findByText("正在拉取系统镜像…");
    expect(screen.getByText("30%")).toBeTruthy();
    // VM 建成以分钟计:退化成只读等待页就是让用户干等(旧 UI
    // cloudStartup.tsx:6-8「composer 保持可用…这是桌面侧独有的能力」)
    const composer = screen.getByLabelText<HTMLTextAreaElement>("消息输入");
    expect(composer.disabled).toBe(false);
    expect(composer.placeholder).toContain("就绪后自动发出");
    // 状态徽标已撤(LAYOUT §3:任务状态不进头部;启动态由整屏时间线表意)
    expect(screen.queryByText("排队中")).toBeNull();
    // 终止收进 ⋯ 菜单(危险动作不常驻头部)
    await userEvent.click(screen.getByRole("button", { name: "任务操作" }));
    expect(screen.getByText("终止任务")).toBeTruthy();
  });

  it("进入任务:composer 输入框自动获得焦点(切换任务即可直接开打)", async () => {
    stubShell((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t3", status: "processing", title: "跑着的任务" });
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t3", title: "跑着的任务", status: "processing" }} />);
    const composer = await screen.findByLabelText<HTMLTextAreaElement>("消息输入");
    await waitFor(() => expect(document.activeElement).toBe(composer));
  });

  // 居中容器 + overflow-y-auto:内容高过容器时向两端等量溢出,顶端那截
  // 滚不回去(步骤多、窗口矮时正好看不到最前面几步)。LAYOUT §5 另要求
  // overflow-y 必须搭 overflow-x-hidden
  it("启动页滚动安全:不用 items-center 居中,且横向截断", async () => {
    stubShell((cmd) =>
      cmd === "mc_task_info"
        ? Promise.resolve({
            id: "t2b",
            status: "pending",
            virtualmachine: { id: "", conditions: [{ type: "ImagePulled", status: 1, progress: 30 }] },
          })
        : Promise.resolve({}),
    );
    renderCloud(<CloudTaskView task={{ id: "t2b", status: "pending" }} />);
    const box = (await screen.findByText("正在拉取系统镜像…")).closest(".overflow-y-auto") as HTMLElement;
    expect(box.className).toContain("overflow-x-hidden");
    expect(box.className).not.toContain("items-center");
    expect(box.className).not.toContain("justify-center");
    expect(box.querySelector(".m-auto")).toBeTruthy(); // auto margin:没余量时归零,退化成顶端对齐
  });

  it("加载更早:有游标才出现,点击往前翻一轮并前插", async () => {
    let roundsCalls = 0;
    stubShell((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t3", status: "finished" });
        case "mc_task_rounds":
          roundsCalls += 1;
          return roundsCalls === 1
            ? Promise.resolve({
                frames: [{ type: "user-input", seq: 10, data: { content: b64encode("第二轮提问") } }],
                next_cursor: "c-early",
                has_more: true,
              })
            : Promise.resolve({
                frames: [{ type: "user-input", seq: 1, data: { content: b64encode("第一轮提问") } }],
                next_cursor: "",
                has_more: false,
              });
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t3", status: "finished" }} />);
    await screen.findByText("第二轮提问");
    const btn = await screen.findByText("加载更早");
    btn.click();
    await screen.findByText("第一轮提问");
    // 前插:更早的一轮在前(按 LogList 的 data-user-seq 结构锚,不断样式类)
    const seqs = [...document.querySelectorAll("[data-user-seq]")].map((el) => el.getAttribute("data-user-seq"));
    expect(seqs).toEqual(["1", "10"]);
  });

  it("懒加载:滚动到距顶阈值内自动补拉更早轮次,不用点按钮", async () => {
    let roundsCalls = 0;
    stubShell((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t3b", status: "finished" });
        case "mc_task_rounds":
          roundsCalls += 1;
          return roundsCalls === 1
            ? Promise.resolve({
                frames: [{ type: "user-input", seq: 10, data: { content: b64encode("第二轮提问") } }],
                next_cursor: "c-early",
                has_more: true,
              })
            : Promise.resolve({
                frames: [{ type: "user-input", seq: 1, data: { content: b64encode("第一轮提问") } }],
                next_cursor: "",
                has_more: false,
              });
        default:
          return Promise.resolve({});
      }
    });
    const { container } = renderCloud(<CloudTaskView task={{ id: "t3b", status: "finished" }} />);
    await screen.findByText("第二轮提问");
    const log = container.querySelector("[data-chat-log]") as HTMLElement;
    log.scrollTop = 0; // jsdom 默认即 0(落在距顶阈值内)
    fireEvent.scroll(log);
    await screen.findByText("第一轮提问");
    // 前插保序:更早的一轮在前
    const seqs = [...document.querySelectorAll("[data-user-seq]")].map((el) => el.getAttribute("data-user-seq"));
    expect(seqs).toEqual(["1", "10"]);
  });

  it("⋯ 菜单:「在浏览器打开」拼控制台 URL;「在线预览」开菜单即拉端口,条目直开 access_url", async () => {
    const opened: string[] = [];
    stubShellWs((cmd, args) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t9", status: "processing", virtualmachine: { id: "vm9", status: "running" } });
        case "mc_status":
          return Promise.resolve({
            logged_in: true,
            host: "localhost",
            base_url: "http://localhost:8000/private/team-a",
          });
        case "cloud_ws_open":
          return Promise.resolve(null);
        case "plugin:opener|open_url":
          opened.push(String(args?.url));
          return Promise.resolve(null);
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t9", status: "processing" }} />);
    await userEvent.click(await screen.findByRole("button", { name: "任务操作" }));

    // 控制台入口用完整 base_url,保留 http、端口与私有部署路径。
    await userEvent.click(await screen.findByRole("menuitem", { name: /在浏览器打开/ }));
    expect(opened).toEqual(["http://localhost:8000/private/team-a/console/task/t9"]);
  });

  it("⋯ 菜单:无云端主机名不出「在浏览器打开」(不给死链);无开放端口给交代", async () => {
    stubShellWs((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t10", status: "processing", virtualmachine: { id: "vm10", status: "running" } });
        case "mc_status":
          return Promise.resolve(null); // 未登录/浏览器模式
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t10", status: "processing" }} />);
    await userEvent.click(await screen.findByRole("button", { name: "任务操作" }));
    expect(screen.queryByRole("menuitem", { name: /在浏览器打开/ })).toBeNull();
    // 端口检测走控制流(假壳不应答 call),菜单停在「检测中」而非空白
    expect(screen.getByText("在线预览")).toBeTruthy();
    expect(screen.getByText("检测开放端口…")).toBeTruthy();
  });

  it("云端 composer 的 Ctrl+Enter 插入换行,不触发发送", async () => {
    stubShellWs((cmd) => {
      if (cmd === "mc_task_info") {
        return Promise.resolve({ id: "t-ctrl-enter", status: "processing", virtualmachine: { id: "vm-ctrl-enter", status: "running" } });
      }
      return Promise.resolve({});
    });
    renderCloud(<CloudTaskView task={{ id: "t-ctrl-enter", status: "processing" }} />);
    const box = await screen.findByRole("textbox", { name: "消息输入" });

    await userEvent.type(box, "第一行");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect((box as HTMLTextAreaElement).value).toBe("第一行\n");
  });

  it("云端 composer 斜杠指令:/ 弹面板(与本地同一件),↩ 填入;清单粘住不随重算空掉", async () => {
    const listeners = stubShellWs((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t11", status: "processing", virtualmachine: { id: "vm11", status: "running" } });
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t11", status: "processing" }} />);
    const box = await screen.findByRole("textbox", { name: "消息输入" });
    await waitFor(() => expect([...listeners.keys()].some((name) => name.startsWith("ws-msg:"))).toBe(true));
    // 指令清单经 available_commands_update 帧下发(与本地同一归约链)
    const push = (payload: unknown) => {
      for (const [name, cb] of listeners) if (name.startsWith("ws-msg:")) cb({ payload });
    };
    push(
      JSON.stringify({
        type: "task-running",
        kind: "acp_event",
        seq: 1,
        timestamp: 1,
        data: {
          update: {
            sessionUpdate: "available_commands_update",
            availableCommands: [{ name: "compact", description: "压缩上下文" }],
          },
        },
      }),
    );
    await userEvent.type(box, "/");
    const panel = await screen.findByRole("listbox", { name: "斜杠指令" });
    expect(within(panel).getByText("/compact")).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    expect((box as HTMLTextAreaElement).value).toBe("/compact ");
    expect(screen.queryByRole("listbox", { name: "斜杠指令" })).toBeNull(); // 填入即收
  });

  it("提问大纲:REST 索引 + 回放窗口按时间锚合并;跳转未加载锚经 rounds 大步长补页", async () => {
    // 同一时刻的两种精度:REST 索引纳秒,帧流毫秒(壳已 ns→ms)
    const T1 = 1754190000456; // 第一问(最早,初始窗口外)
    const T15 = 1754190050789; // 第一点五问(同页补入,轮间倒序在前)
    const T2 = 1754190100123; // 第二问(已回放)
    const roundsArgs: Record<string, unknown>[] = [];
    stubShell((cmd, args) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t6", status: "finished" });
        case "mc_task_rounds":
          roundsArgs.push(args ?? {});
          return args?.cursor === ""
            ? Promise.resolve({
                frames: [
                  { type: "user-input", seq: 10, timestamp: T2, data: { content: b64encode("第二问") } },
                  { type: "task-ended", seq: 11, timestamp: T2 + 1000 },
                ],
                next_cursor: "c-early",
                has_more: true,
              })
            : Promise.resolve({
                // backward 契约:一批多轮时**轮间倒序**(新轮在前、轮内正序),
                // UI 必须时序归一后再前插(2026-08-06 乱序报障)
                frames: [
                  { type: "user-input", seq: 5, timestamp: T15, data: { content: b64encode("第一点五问") } },
                  { type: "task-ended", seq: 6, timestamp: T15 + 1000 },
                  { type: "user-input", seq: 1, timestamp: T1, data: { content: b64encode("第一问") } },
                  { type: "task-ended", seq: 2, timestamp: T1 + 1000 },
                ],
                next_cursor: "",
                has_more: false,
              });
        case "mc_task_user_inputs":
          return Promise.resolve({
            items: [
              { content: "第二问", timestamp: T2 * 1e6 },
              { content: "第一点五问", timestamp: T15 * 1e6 },
              { content: "第一问", timestamp: T1 * 1e6 },
            ],
            has_more: false,
          });
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t6", status: "finished" }} />);
    await screen.findByText("第二问"); // 初始窗口只有最新一轮
    const nav = await screen.findByRole("navigation", { name: "提问大纲" });
    // 悬停到点上浮出条目面板(7e86e9e9 起面板只在点上展开,不再整列悬停):
    // 全量目录(含未加载的更早提问)与回放窗口合并去重
    fireEvent.mouseEnter(nav.querySelector("[data-outline-dot]")!);
    const panelEntries = screen.getAllByText(/第[一二].*问/).filter((el) => el.closest("nav"));
    expect(panelEntries.map((el) => el.textContent)).toEqual(["第一问", "第一点五问", "第二问"]);

    // 点第一问:目标未加载 → 经 mc_task_rounds 大步长补页后定位到气泡
    fireEvent.click(panelEntries[0]!);
    await waitFor(() => {
      // 补页发生且用了大步长(减少跳远时的串行往返)
      expect(roundsArgs.some((a) => a.cursor === "c-early" && a.limit === 10)).toBe(true);
    });
    // 第一问已前插进对话流(nav 面板之外的正文气泡)
    await waitFor(() => {
      expect(screen.getAllByText("第一问").some((el) => !el.closest("nav"))).toBe(true);
    });
    // 时序归一:补入的一页轮间倒序,前插后对话流仍是全局正序(乱序报障回归钉)
    const seqs = [...document.querySelectorAll("[data-user-seq]")].map((el) => el.getAttribute("data-user-seq"));
    expect(seqs).toEqual(["1", "5", "10"]);
  });

  it("云端文件:vmId 就绪才可用,点开右滑面板挂 CloudFiles,可关闭", async () => {
    stubShell((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t7", status: "finished", virtualmachine: { id: "vm7" } });
        case "mc_task_rounds":
          return Promise.resolve({ frames: [], next_cursor: "", has_more: false });
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t7", status: "finished" }} />);
    const btn = await screen.findByRole("button", { name: "云端文件" });
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false)); // vmId 到位才可用
    await userEvent.click(btn);
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy(); // CloudFiles 头部已挂载
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("button", { name: "刷新" })).toBeNull();

    // 重开后 Esc(window capture)也能关,且截断传播——审批热键(esc = deny
    // 不可逆)同挂 window,这一下按键绝不能双消费(与 FilesDrawer 同契约)
    await userEvent.click(btn);
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy();
    const leaked = vi.fn();
    window.addEventListener("keydown", leaked);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "刷新" })).toBeNull();
    expect(leaked).not.toHaveBeenCalled();
    window.removeEventListener("keydown", leaked);
  });

  it("云端文件:pending(VM 未建)时按钮禁用", async () => {
    stubShell((cmd) =>
      cmd === "mc_task_info"
        ? Promise.resolve({ id: "t8", status: "pending", virtualmachine: { id: "", conditions: [] } })
        : Promise.resolve({}),
    );
    renderCloud(<CloudTaskView task={{ id: "t8", status: "pending" }} />);
    const btn = await screen.findByRole("button", { name: "云端文件" });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("云端文件:结束态/详情无 VM 也可浏览(控制流按 taskId 寻址,不拿 vmId 当门槛)", async () => {
    stubShell((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t8b", status: "finished" }); // VM 已回收,详情不带 virtualmachine
        case "mc_task_rounds":
          return Promise.resolve({ frames: [], next_cursor: "", has_more: false });
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t8b", status: "finished" }} />);
    const btn = await screen.findByRole("button", { name: "云端文件" });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(btn);
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy(); // CloudFiles 面板已挂载(快照浏览)
  });

  it("运行中:审批答复经 stream WS 上行(帧形状 {type, data: b64(JSON)}),不走本地 IPC", async () => {
    const wsSends: { pipe?: unknown; text?: unknown }[] = [];
    const sessionSends: unknown[] = [];
    let wsPipe = "";
    const listeners = stubShellWs((cmd, args) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t4", status: "processing", title: "跑着的任务" });
        case "cloud_ws_open":
          wsPipe = String(args?.pipe ?? "");
          return Promise.resolve({});
        case "cloud_ws_send":
          wsSends.push(args ?? {});
          return Promise.resolve({});
        case "session_send":
          sessionSends.push(args);
          return Promise.resolve({});
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t4", status: "processing" }} />);
    await waitFor(() => expect(wsPipe).not.toBe("")); // attach 已拨通
    // 下行一张待答复审批卡(与本地 Frame 同构,喂同一条归约链)
    listeners.get(`ws-msg:${wsPipe}`)?.({
      payload: JSON.stringify({ type: "permission-req", seq: 1, data: { id: "p1", title: "npm test", tool: "Bash" } }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "允许" }));

    await waitFor(() => expect(wsSends).toHaveLength(1));
    const frame = JSON.parse(String(wsSends[0]?.text)) as { type: string; data: string; timestamp: number };
    expect(frame.type).toBe("permission-resp");
    expect(JSON.parse(b64decode(frame.data))).toEqual({ id: "p1", approved: true, remember: false, persist: false });
    expect(typeof frame.timestamp).toBe("number");
    expect(sessionSends).toEqual([]); // 云端任务 id 上绝不能落到 session_send
    expect(await screen.findByText("已允许")).toBeTruthy(); // 送达后乐观置态保持
  });

  it("运行中:WS 发送失败时审批卡回滚可重点(不乐观假装已决)", async () => {
    let wsPipe = "";
    const listeners = stubShellWs((cmd, args) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t5", status: "processing" });
        case "cloud_ws_open":
          wsPipe = String(args?.pipe ?? "");
          return Promise.resolve({});
        case "cloud_ws_send":
          return Promise.reject(new Error("pipe dead"));
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t5", status: "processing" }} />);
    await waitFor(() => expect(wsPipe).not.toBe(""));
    listeners.get(`ws-msg:${wsPipe}`)?.({
      payload: JSON.stringify({ type: "permission-req", seq: 1, data: { id: "p1", title: "npm test", tool: "Bash" } }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "允许" }));
    // 未送达:乐观徽标回滚,按钮恢复可点
    await waitFor(() => expect(screen.getByRole("button", { name: "允许" })).toBeTruthy());
    expect(screen.queryByText("已允许")).toBeNull();
  });

  it("布局契约(§7):头部非交互子节点全带拖拽属性,动作全是图标钮,无状态徽标", async () => {
    stubShell((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t9", status: "finished", title: "完结任务" });
        case "mc_task_rounds":
          return Promise.resolve({ frames: [], next_cursor: "", has_more: false });
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t9", title: "完结任务", status: "finished" }} />);
    await screen.findByText(/只读回放/);
    const header = document.querySelector("[data-view-header]") as HTMLElement;
    expect(header.hasAttribute("data-tauri-drag-region")).toBe(true);
    const h1 = header.querySelector("h1") as HTMLElement;
    expect(h1.hasAttribute("data-tauri-drag-region")).toBe(true); // 云端无双击改名,标题整体在拖拽区内
    const sub = header.querySelector("p") as HTMLElement;
    expect(sub.hasAttribute("data-tauri-drag-region")).toBe(true); // 副标题(回退「云端」身份词)
    for (const btn of header.querySelectorAll("button")) {
      expect(btn.hasAttribute("data-tauri-drag-region")).toBe(false);
      expect(btn.classList.contains("btn-square")).toBe(true); // 视图动作 = 图标钮(LAYOUT §3)
    }
    expect(header.querySelector(".badge")).toBeNull(); // 状态徽标不进头部
  });

  it("⋯ 菜单删除:二段确认 → mc_task_delete → onDeleted;被拒时原因外显(结束态错误条)", async () => {
    const calls: { cmd: string; args?: Record<string, unknown> }[] = [];
    let rejectDelete = false;
    stubShell((cmd, args) => {
      calls.push({ cmd, args });
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t10", status: "finished" });
        case "mc_task_rounds":
          return Promise.resolve({ frames: [], next_cursor: "", has_more: false });
        case "mc_task_delete":
          return rejectDelete ? Promise.reject(new Error("虚拟机仍在线")) : Promise.resolve({ ok: true });
        default:
          return Promise.resolve({});
      }
    });
    const onDeleted = vi.fn();
    const { unmount } = renderCloud(<CloudTaskView task={{ id: "t10", status: "finished" }} onDeleted={onDeleted} />);
    await screen.findByText(/只读回放/);
    await userEvent.click(screen.getByRole("button", { name: "任务操作" }));
    await userEvent.click(screen.getByText("删除任务"));
    expect(calls.some((c) => c.cmd === "mc_task_delete")).toBe(false); // 一次点击不执行
    await userEvent.click(screen.getByText("确认删除"));
    await waitFor(() => expect(calls.some((c) => c.cmd === "mc_task_delete" && c.args?.id === "t10")).toBe(true));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    unmount();

    // 被拒:结束态没有 composer,错误条独立渲染在 footer
    rejectDelete = true;
    renderCloud(<CloudTaskView task={{ id: "t10", status: "finished" }} />);
    await screen.findByText(/只读回放/);
    await userEvent.click(screen.getByRole("button", { name: "任务操作" }));
    await userEvent.click(screen.getByText("删除任务"));
    await userEvent.click(screen.getByText("确认删除"));
    await screen.findByText(/删除任务失败.*虚拟机仍在线/);
  });

  it("结束态无回放且无更早:空态 = logo + 主句 + 副句(与 ChatView 空态同构)", async () => {
    stubShell((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t11", status: "finished" });
        case "mc_task_rounds":
          return Promise.resolve({ frames: [], next_cursor: "", has_more: false });
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t11", status: "finished" }} />);
    await screen.findByText("没有可回放的对话记录");
    expect(screen.getByText(/需要继续这项工作/)).toBeTruthy();
    expect(document.querySelector('img[src="/logo.png"]')).toBeTruthy();
    expect(screen.queryByText("加载更早")).toBeNull(); // 无游标才整屏空态
  });

  it("结束态回放里的历史审批卡只读:不再渲染允许/拒绝按钮", async () => {
    stubShell((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t12", status: "finished" });
        case "mc_task_rounds":
          return Promise.resolve({
            frames: [{ type: "permission-req", seq: 1, data: { id: "p1", title: "npm test", tool: "Bash" } }],
            next_cursor: "",
            has_more: false,
          });
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t12", status: "finished" }} />);
    await screen.findByText(/npm test/);
    expect(screen.queryByRole("button", { name: "允许" })).toBeNull();
    expect(screen.queryByRole("button", { name: "拒绝" })).toBeNull();
  });

  // task-started 只翻 running、不动 items(reduce.ts),而运行条挂在 composer
  // 卡内:发出消息后 items 先贴过底,运行条随后才把 footer 撑高,视口被压矮
  // 同样多——不把 running 也算进贴底依赖,刚发的那条就正好被顶到 composer
  // 后面(用户报障 2026-08-06,截图里被切掉的正是运行条那一条的高度)。
  // 几何在 happy-dom 里全 0,桩住 scrollHeight 才能断言贴底动作发生。
  it("发出后运行条挂起时重新贴底(运行条撑高 footer 会压矮日志视口)", async () => {
    let wsPipe = "";
    const listeners = stubShellWs((cmd, args) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t13b", status: "processing" });
        case "cloud_ws_open":
          wsPipe = String(args?.pipe ?? "");
          return Promise.resolve({});
        default:
          return Promise.resolve({});
      }
    });
    const { container } = renderCloud(<CloudTaskView task={{ id: "t13b", status: "processing" }} />);
    await waitFor(() => expect(wsPipe).not.toBe(""));
    const push = (frame: Record<string, unknown>) =>
      listeners.get(`ws-msg:${wsPipe}`)?.({ payload: JSON.stringify(frame) });

    push({ type: "user-input", seq: 1, data: { content: b64encode("大概是这样的") } });
    await screen.findByText("大概是这样的");

    const log = container.querySelector("[data-chat-log]") as HTMLElement;
    Object.defineProperty(log, "scrollHeight", { value: 2048, configurable: true });
    log.scrollTop = 0; // items 那一档已跑过,这里把位置压回去只看 running 这一档

    push({ type: "task-started", seq: 2 }); // 只翻 running,items 不变
    await screen.findByText("云端执行中");
    expect(log.scrollTop).toBe(2048);
  });

  it("运行中:运行条入输入卡(云端执行中),plan 帧钉 TaskPanel,⏎ 键盘审批经 WS 上行", async () => {
    const wsSends: { text?: unknown }[] = [];
    let wsPipe = "";
    const listeners = stubShellWs((cmd, args) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t13", status: "processing" });
        case "cloud_ws_open":
          wsPipe = String(args?.pipe ?? "");
          return Promise.resolve({});
        case "cloud_ws_send":
          wsSends.push(args ?? {});
          return Promise.resolve({});
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t13", status: "processing" }} />);
    await waitFor(() => expect(wsPipe).not.toBe(""));
    const push = (frame: Record<string, unknown>) =>
      listeners.get(`ws-msg:${wsPipe}`)?.({ payload: JSON.stringify(frame) });

    push({ type: "task-started", seq: 1 });
    const runLabel = await screen.findByText("云端执行中");
    // 运行条在输入卡内(ComposerCard 外框),不是 footer 独立行
    expect(runLabel.closest(".rounded-box")).toBeTruthy();

    push({
      type: "task-running",
      kind: "acp_event",
      seq: 2,
      data: { update: { sessionUpdate: "plan", entries: [{ content: "步骤一", status: "in_progress" }] } },
    });
    await screen.findByText("任务 0/1"); // TaskPanel 钉在 composer 上方

    push({ type: "permission-req", seq: 3, data: { id: "p1", title: "npm test", tool: "Bash" } });
    await screen.findByRole("button", { name: "允许" });
    const box = screen.getByRole("textbox", { name: "消息输入" });
    await userEvent.click(box);
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect((box as HTMLTextAreaElement).value).toBe("\n");
    expect(wsSends).toHaveLength(0); // Ctrl+Enter 归 composer,不冒泡误允许

    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(wsSends.length).toBeGreaterThan(0));
    const frame = JSON.parse(String(wsSends[0]?.text)) as { type: string; data: string };
    expect(frame.type).toBe("permission-resp");
    expect(JSON.parse(b64decode(frame.data))).toMatchObject({ id: "p1", approved: true });

    // 上下文用量环:usage_update 帧(与本地同构)→ composer 集群出环
    expect(screen.queryByRole("progressbar", { name: "上下文用量" })).toBeNull();
    push({
      type: "task-running",
      kind: "acp_event",
      seq: 4,
      data: { update: { sessionUpdate: "usage_update", used: 32_000, size: 200_000 } },
    });
    const ring = await screen.findByRole("progressbar", { name: "上下文用量" });
    expect(ring.getAttribute("aria-valuenow")).toBe("16");
  });

  it("焦点云端会话用裸 Esc 复用 cancelRun", async () => {
    const wsSends: { text?: unknown }[] = [];
    let wsPipe = "";
    const listeners = stubShellWs((cmd, args) => {
      if (cmd === "mc_task_info") return Promise.resolve({ id: "t-esc", status: "processing" });
      if (cmd === "cloud_ws_open") {
        wsPipe = String(args?.pipe ?? "");
        return Promise.resolve({});
      }
      if (cmd === "cloud_ws_send") {
        wsSends.push(args ?? {});
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });
    renderCloud(<CloudTaskView task={{ id: "t-esc", status: "processing" }} />);
    await waitFor(() => expect(wsPipe).not.toBe(""));
    listeners.get(`ws-msg:${wsPipe}`)?.({ payload: JSON.stringify({ type: "task-started", seq: 1 }) });
    await screen.findByText("云端执行中");

    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(wsSends).toHaveLength(1));
    const frame = JSON.parse(String(wsSends[0]?.text)) as { type: string };
    expect(frame.type).toBe("user-cancel");
  });

  it("附件:每条提交绑定自己的持久化引用，队列不保存 preview", async () => {
    stubShellWs((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t15", status: "processing" });
        case "mc_task_options":
          return Promise.resolve({ models: [] });
        case "mc_upload":
          return Promise.resolve({ access_url: "https://oss/a.txt" });
        case "cloud_ws_open":
          return Promise.resolve({});
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t15", status: "processing" }} />);
    const attachBtn = await screen.findByRole("button", { name: "附件" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(attachBtn).toBeTruthy();
    fireEvent.change(fileInput, { target: { files: [new File(["hello"], "a.txt", { type: "text/plain" })] } });
    await screen.findByText("a.txt"); // 上传完成,待发 chip 出现

    fireEvent.change(screen.getByLabelText("消息输入"), { target: { value: "带附件的一句" } });
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    // 即使 runtime 尚在 attach 对表，本条也已经原子入持久化队列；草稿附件
    // 清空后引用仍与该队列项绑定，且不会把 data URL preview 写进 localStorage。
    await waitFor(() => {
      const lane = Object.keys(localStorage)
        .filter((key) => key.includes("mc.sendQueue.v1.cloud.") && !key.includes(".index."))
        .map((key) => JSON.parse(localStorage.getItem(key) ?? "null") as { pending?: Array<{ content: string; attachments: unknown[] }> })
        .find((value) => value.pending?.some((item) => item.content === "带附件的一句"));
      expect(lane?.pending?.[0]?.attachments).toEqual([
        { url: "https://oss/a.txt", filename: "a.txt", isImage: false },
      ]);
    });
    expect(screen.queryByText("a.txt")).toBeNull(); // composer 草稿附件已清
  });

  it("切换模型:成功提示可经重连保留,本地模型即时更新且后续详情仍权威", async () => {
    const controlSends: { pipe?: unknown; text?: unknown }[] = [];
    const pipeKinds = new Map<string, string>();
    const streamPipes: string[] = [];
    let infoCalls = 0;
    const listeners = stubShellWs((cmd, args) => {
      switch (cmd) {
        case "mc_task_info":
          infoCalls += 1;
          return Promise.resolve(infoCalls === 1
            ? { id: "t16", status: "processing", model: { id: "m1", model: "gpt-x", remark: "旧模型" } }
            : { id: "t16", status: "processing", model: { id: "m3", model: "gpt-z", remark: "外部模型" } });
        case "mc_task_options":
          return Promise.resolve({
            models: [
              { id: "m1", model: "gpt-x", remark: "旧模型", owner: { type: "public" } },
              { id: "m2", model: "claude-y", remark: "新模型", owner: { type: "public" } },
            ],
          });
        case "cloud_ws_open": {
          const pipe = String(args?.pipe ?? "");
          const kind = String(args?.kind ?? "");
          pipeKinds.set(pipe, kind);
          if (kind === "stream") streamPipes.push(pipe);
          return Promise.resolve({});
        }
        case "cloud_ws_send": {
          if (pipeKinds.get(String(args?.pipe ?? "")) !== "control") return Promise.resolve({});
          controlSends.push(args ?? {});
          // 即答成功:按 request_id 配对 call-response,并带回服务端确认的新模型
          const f = JSON.parse(String(args?.text)) as { data: string };
          const req = JSON.parse(b64decode(f.data)) as { request_id: string };
          listeners.get(`ws-msg:${String(args?.pipe)}`)?.({
            payload: JSON.stringify({
              type: "call-response",
              data: {
                request_id: req.request_id,
                success: true,
                model: { id: "m2", model: "claude-y", remark: "新模型" },
              },
            }),
          });
          return Promise.resolve({});
        }
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t16", status: "processing" }} />);
    // 触发器显当前模型(详情 remark)
    const trigger = await screen.findByRole("button", { name: "模型" });
    await waitFor(() => expect(trigger.textContent).toContain("旧模型"));
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByText("新模型"));
    await waitFor(() => expect(controlSends.length).toBe(1));
    const call = JSON.parse(String(controlSends[0]?.text)) as { type: string; kind: string; data: string };
    expect(call.type).toBe("call");
    expect(call.kind).toBe("switch_model");
    expect(JSON.parse(b64decode(call.data))).toMatchObject({ model_id: "m2", load_session: true });
    await waitFor(() => expect(trigger.textContent).toContain("新模型"));
    expect(await screen.findByText("模型已切换为 新模型")).toBeTruthy();

    // 异常断线前先收到业务帧，attach 才会进入真实重连而非空闲收束。
    await waitFor(() => expect(streamPipes.length).toBeGreaterThan(0));
    const firstStream = streamPipes[0]!;
    await act(async () => {
      listeners.get(`ws-msg:${firstStream}`)?.({
        payload: JSON.stringify({ type: "task-running", seq: 1, data: {} }),
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      listeners.get(`ws-closed:${firstStream}`)?.({ payload: null });
    });
    await waitFor(() => expect(streamPipes.length).toBeGreaterThan(1), { timeout: 3_000 });
    expect(screen.getByText("模型已切换为 新模型")).toBeTruthy();

    // 后续权威详情若由其他客户端更新，应覆盖本地成功响应的即时投影。
    const reconnectedStream = streamPipes.at(-1)!;
    await act(async () => {
      listeners.get(`ws-msg:${reconnectedStream}`)?.({
        payload: JSON.stringify({ type: "task-ended", seq: 2, data: {} }),
      });
    });
    await waitFor(() => expect(trigger.textContent).toContain("外部模型"));
  });

  // ==== 休眠唤醒(2026-08-08 用户报障:「vm 还在 resume,我却还能发新消息」)====
  // 机制:唤醒休眠 VM 的唯一触发点是**控制流建连**(后端 task_control.go),
  // 任务流连的是后端、机器睡着照样秒连。故此处三条各钉一段:①进任务即建控制
  // 流(唤醒被触发);②唤醒判据取详情的 vm 状态而非连接状态;③唤醒期发送押后。

  it("休眠机器:进任务即建控制流(这是唯一会唤醒 VM 的通道)", async () => {
    const kinds: string[] = [];
    stubShellWs((cmd, args) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({
            id: "t17",
            status: "processing",
            virtualmachine: { id: "vm1", status: "hibernated" },
          });
        case "cloud_ws_open":
          kinds.push(String(args?.kind ?? ""));
          return Promise.resolve({});
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t17", status: "processing" }} />);
    // 没有这条,休眠任务打开后根本没人去唤醒机器(旧实现只在切模型/端口/文件时临时连)
    await waitFor(() => expect(kinds).toContain("control"));
  });

  it("休眠机器:任务流已连上也照样显唤醒态(判据取 vm 状态,不看连接状态)", async () => {
    const listeners = stubShellWs((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({
            id: "t18",
            status: "processing",
            virtualmachine: { id: "vm1", status: "hibernated" },
          });
        // cloud_ws_open 立即 resolve = 任务流秒连(真实情形:它连的是后端,不是那台机器)
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t18", status: "processing" }} />);
    await waitFor(() => expect([...listeners.keys()].some((k) => k.startsWith("ws-msg:"))).toBe(true));
    // 连接健康(connected)但机器休眠:状态条/空态仍要讲「唤醒」,不能一片安静
    await waitFor(() => expect(screen.getAllByText(/正在唤醒云端机器/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/正在连接云端任务/)).toBeNull();
    // 输入框可用(唤醒期能打字,消息押后),占位文案说清会自动发出
    expect((screen.getByLabelText("消息输入") as HTMLTextAreaElement).disabled).toBe(false);
  });

  // offline 的另一半:服务端确实给了 Failed 条件——这时才配说"启动失败、
  // 不会自动恢复",而且原因要直接摆出来(原文案让用户"去浏览器控制台查看详情")
  it("机器 offline 且带 Failed 条件:才下失败定论,并把服务端给的原因摆出来", async () => {
    stubShellWs((cmd) =>
      cmd === "mc_task_info"
        ? Promise.resolve({
            id: "t22b",
            status: "processing",
            virtualmachine: {
              id: "vm1",
              status: "offline",
              conditions: [{ type: "Failed", status: 3, message: "镜像拉取超时" }],
            },
          })
        : Promise.resolve({}),
    );
    renderCloud(<CloudTaskView task={{ id: "t22b", status: "processing" }} />);
    await waitFor(() => expect(screen.getAllByText(/启动失败/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/镜像拉取超时/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/尚未上线/)).toBeNull();
  });

  it("模型清单拉取失败:原因外显(菜单永远空白且一句交代都没有是最坏的)", async () => {
    stubShellWs((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t26", status: "processing" });
        case "mc_task_options":
          return Promise.reject(new Error("401 未登录"));
        default:
          return Promise.resolve({});
      }
    });
    renderCloud(<CloudTaskView task={{ id: "t26", status: "processing" }} />);
    expect(await screen.findByText(/模型列表加载失败.*401 未登录/)).toBeTruthy();
  });

  // mc_status 会把网络故障抛成 Err(壳 baizhi/mod.rs);未捕获的 rejection
  // 被 index.html 画成盖住整个应用的红色遮罩
  it("mc_status 抛错:不产生未捕获 rejection,视图照常可用", async () => {
    const unhandled: unknown[] = [];
    const onRej = (e: PromiseRejectionEvent) => {
      unhandled.push(e.reason);
      e.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRej);
    try {
      stubShellWs((cmd) => {
        switch (cmd) {
          case "mc_task_info":
            return Promise.resolve({ id: "t27", status: "processing" });
          case "mc_status":
            return Promise.reject(new Error("network down"));
          default:
            return Promise.resolve({});
        }
      });
      renderCloud(<CloudTaskView task={{ id: "t27", status: "processing" }} />);
      await screen.findByLabelText("消息输入");
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
      // host 拿不到就不出「在浏览器打开」,不给死链
      await userEvent.click(screen.getByRole("button", { name: "任务操作" }));
      expect(screen.queryByRole("menuitem", { name: /在浏览器打开/ })).toBeNull();
    } finally {
      window.removeEventListener("unhandledrejection", onRej);
    }
  });

  it("背景表面单层:pane 根透明，独立形态提供工作台 100 表面", () => {
    stubShell(() => Promise.resolve({ id: "surface", status: "pending" }));
    const paneView = renderCloud(<CloudTaskView task={{ id: "surface" }} variant="pane" />);
    const pane = paneView.container.querySelector(".bg-transparent") as HTMLElement;
    expect(pane).toBeTruthy();
    expect(pane.className).not.toContain("mc-workbench-surface-100");
    paneView.unmount();
    const fullView = renderCloud(<CloudTaskView task={{ id: "surface" }} />);
    expect(fullView.container.querySelector(".mc-workbench-surface-100")).toBeTruthy();
  });
});
