// 云端任务详情冒烟:结束态 rounds 回放、启动态时间线、提问大纲(REST 索引
// 合并 + 跳转补页)、云端文件面板、审批答复经 WS 上行(假壳 invoke;协议
// 状态机的行为契约在 lib/cloud/stream.test.ts,这里只验编排与渲染)。
// 形态与 ChatView 同构(LAYOUT §3/§4/§7):头部图标钮 + ⋯ 菜单(终止/删除
// 二段确认)、状态徽标不进头部、拖拽属性逐节点、运行条入输入卡、结束态
// LogList 只读。
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { b64decode, b64encode } from "@/lib/protocol/codec";
import { CloudTaskView } from "./CloudTaskView";

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
});

describe("CloudTaskView", () => {
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
    render(<CloudTaskView task={{ id: "t1", title: "完结任务", status: "finished" }} />);
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
    render(<CloudTaskView task={{ id: "t2", title: "新任务", status: "pending" }} />);
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
    render(<CloudTaskView task={{ id: "t3", title: "跑着的任务", status: "processing" }} />);
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
    render(<CloudTaskView task={{ id: "t2b", status: "pending" }} />);
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
    render(<CloudTaskView task={{ id: "t3", status: "finished" }} />);
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
    const { container } = render(<CloudTaskView task={{ id: "t3b", status: "finished" }} />);
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
          return Promise.resolve({ logged_in: true, host: "mc.example.com" });
        case "cloud_ws_open":
          return Promise.resolve(null);
        case "plugin:opener|open_url":
          opened.push(String(args?.url));
          return Promise.resolve(null);
        default:
          return Promise.resolve({});
      }
    });
    render(<CloudTaskView task={{ id: "t9", status: "processing" }} />);
    await userEvent.click(await screen.findByRole("button", { name: "任务操作" }));

    // 控制台入口:host 取自 mc_status,拿不到就不该出这一项(见下一用例)
    await userEvent.click(await screen.findByRole("menuitem", { name: /在浏览器打开/ }));
    expect(opened).toEqual(["https://mc.example.com/console/task/t9"]);
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
    render(<CloudTaskView task={{ id: "t10", status: "processing" }} />);
    await userEvent.click(await screen.findByRole("button", { name: "任务操作" }));
    expect(screen.queryByRole("menuitem", { name: /在浏览器打开/ })).toBeNull();
    // 端口检测走控制流(假壳不应答 call),菜单停在「检测中」而非空白
    expect(screen.getByText("在线预览")).toBeTruthy();
    expect(screen.getByText("检测开放端口…")).toBeTruthy();
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
    render(<CloudTaskView task={{ id: "t11", status: "processing" }} />);
    const box = await screen.findByRole("textbox", { name: "消息输入" });
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
    render(<CloudTaskView task={{ id: "t6", status: "finished" }} />);
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
    render(<CloudTaskView task={{ id: "t7", status: "finished" }} />);
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
    render(<CloudTaskView task={{ id: "t8", status: "pending" }} />);
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
    render(<CloudTaskView task={{ id: "t8b", status: "finished" }} />);
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
    render(<CloudTaskView task={{ id: "t4", status: "processing" }} />);
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
    render(<CloudTaskView task={{ id: "t5", status: "processing" }} />);
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
    render(<CloudTaskView task={{ id: "t9", title: "完结任务", status: "finished" }} />);
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
    const { unmount } = render(<CloudTaskView task={{ id: "t10", status: "finished" }} onDeleted={onDeleted} />);
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
    render(<CloudTaskView task={{ id: "t10", status: "finished" }} />);
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
    render(<CloudTaskView task={{ id: "t11", status: "finished" }} />);
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
    render(<CloudTaskView task={{ id: "t12", status: "finished" }} />);
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
    const { container } = render(<CloudTaskView task={{ id: "t13b", status: "processing" }} />);
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
    render(<CloudTaskView task={{ id: "t13", status: "processing" }} />);
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

  it("附件:选文件经 mc_upload 出待发 chip,发送时随 user-input 出线({url,filename})", async () => {
    const wsSends: { text?: unknown }[] = [];
    stubShellWs((cmd, args) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t15", status: "processing" });
        case "mc_task_options":
          return Promise.resolve({ models: [] });
        case "mc_upload":
          return Promise.resolve({ access_url: "https://oss/a.txt" });
        case "cloud_ws_open":
          return Promise.resolve({});
        case "cloud_ws_send":
          wsSends.push(args ?? {});
          return Promise.resolve({});
        default:
          return Promise.resolve({});
      }
    });
    render(<CloudTaskView task={{ id: "t15", status: "processing" }} />);
    const attachBtn = await screen.findByRole("button", { name: "附件" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(attachBtn).toBeTruthy();
    fireEvent.change(fileInput, { target: { files: [new File(["hello"], "a.txt", { type: "text/plain" })] } });
    await screen.findByText("a.txt"); // 上传完成,待发 chip 出现

    fireEvent.change(screen.getByLabelText("消息输入"), { target: { value: "带附件的一句" } });
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    // mode=new 连上即上行首条输入:content 内层 b64,附件只带 {url, filename}
    await waitFor(() => {
      const sent = wsSends
        .map((s) => JSON.parse(String(s.text)) as { type: string; data: string })
        .find((f) => f.type === "user-input");
      expect(sent).toBeTruthy();
      const payload = JSON.parse(b64decode(sent!.data)) as { content: string; attachments: unknown };
      expect(b64decode(payload.content)).toBe("带附件的一句");
      expect(payload.attachments).toEqual([{ url: "https://oss/a.txt", filename: "a.txt" }]);
    });
    expect(screen.queryByText("a.txt")).toBeNull(); // 发送后待发条清空
  });

  it("切换模型:菜单显当前模型,选项来自 mc_task_options,选中经控制流 switch_model(load_session)", async () => {
    const controlSends: { pipe?: unknown; text?: unknown }[] = [];
    const pipeKinds = new Map<string, string>();
    const listeners = stubShellWs((cmd, args) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t16", status: "processing", model: { id: "m1", model: "gpt-x", remark: "旧模型" } });
        case "mc_task_options":
          return Promise.resolve({
            models: [
              { id: "m1", model: "gpt-x", remark: "旧模型", owner: { type: "public" } },
              { id: "m2", model: "claude-y", remark: "新模型", owner: { type: "public" } },
            ],
          });
        case "cloud_ws_open":
          pipeKinds.set(String(args?.pipe ?? ""), String(args?.kind ?? ""));
          return Promise.resolve({});
        case "cloud_ws_send": {
          if (pipeKinds.get(String(args?.pipe ?? "")) !== "control") return Promise.resolve({});
          controlSends.push(args ?? {});
          // 即答成功:按 request_id 配对 call-response,switching 归位
          const f = JSON.parse(String(args?.text)) as { data: string };
          const req = JSON.parse(b64decode(f.data)) as { request_id: string };
          listeners.get(`ws-msg:${String(args?.pipe)}`)?.({
            payload: JSON.stringify({ type: "call-response", data: { request_id: req.request_id, success: true } }),
          });
          return Promise.resolve({});
        }
        default:
          return Promise.resolve({});
      }
    });
    render(<CloudTaskView task={{ id: "t16", status: "processing" }} />);
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
    render(<CloudTaskView task={{ id: "t17", status: "processing" }} />);
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
    render(<CloudTaskView task={{ id: "t18", status: "processing" }} />);
    await waitFor(() => expect([...listeners.keys()].some((k) => k.startsWith("ws-msg:"))).toBe(true));
    // 连接健康(connected)但机器休眠:状态条/空态仍要讲「唤醒」,不能一片安静
    await waitFor(() => expect(screen.getAllByText(/正在唤醒云端机器/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/正在连接云端任务/)).toBeNull();
    // 输入框可用(唤醒期能打字,消息押后),占位文案说清会自动发出
    expect((screen.getByLabelText("消息输入") as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("休眠机器:发送押后不上行,vm 转 online 后自动送出并让位给真气泡", async () => {
    let vmStatus = "hibernated";
    const streamModes: string[] = [];
    const wsSends: { pipe?: unknown; text?: unknown }[] = [];
    const listeners = stubShellWs((cmd, args) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({
            id: "t19",
            status: "processing",
            virtualmachine: { id: "vm1", status: vmStatus },
          });
        case "mc_task_options":
          return Promise.resolve({ models: [] });
        case "cloud_ws_open":
          if (args?.kind === "stream") streamModes.push(String((args?.params as { mode?: string })?.mode ?? ""));
          return Promise.resolve({});
        case "cloud_ws_send":
          wsSends.push(args ?? {});
          return Promise.resolve({});
        default:
          return Promise.resolve({});
      }
    });
    render(<CloudTaskView task={{ id: "t19", status: "processing" }} />);
    await waitFor(() => expect(streamModes).toContain("attach"));

    fireEvent.change(screen.getByLabelText("消息输入"), { target: { value: "醒了就跑这条" } });
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    // 占位气泡立刻上屏(否则输入框一清、日志无变化,用户以为消息丢了),
    // 文案是「唤醒中,连上后自动发出」而不是「等待云端回应」
    const ghost = await screen.findByText("醒了就跑这条");
    expect(ghost.closest("[data-pending-send]")).toBeTruthy();
    expect(screen.getByText("云端机器唤醒中,连上后自动发出…")).toBeTruthy();
    // 押后期间不许再发(按钮禁用),更关键的是**没有** mode=new 上行:
    // 机器睡着时上行只会被后端回显一下就石沉大海
    await waitFor(() => expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true));
    expect(streamModes).not.toContain("new");
    expect(wsSends.map((s) => JSON.parse(String(s.text)) as { type: string }).some((f) => f.type === "user-input")).toBe(false);

    // 机器醒了:轮询(唤醒期 3s)看到 online → 这才建 mode=new 并上行
    vmStatus = "online";
    await vi.waitFor(() => expect(streamModes).toContain("new"), { timeout: 5000, interval: 50 });
    await waitFor(() => {
      const sent = wsSends
        .map((s) => JSON.parse(String(s.text)) as { type: string; data: string })
        .find((f) => f.type === "user-input");
      expect(sent).toBeTruthy();
      expect(b64decode((JSON.parse(b64decode(sent!.data)) as { content: string }).content)).toBe("醒了就跑这条");
    });

    // 云端回显这条 → 占位让位给真气泡
    const msgKey = [...listeners.keys()].filter((k) => k.startsWith("ws-msg:")).pop()!;
    listeners.get(msgKey)?.({
      payload: JSON.stringify({ type: "user-input", seq: 1, timestamp: 1000, data: { content: b64encode("醒了就跑这条") } }),
    });
    await waitFor(() => expect(document.querySelector("[data-pending-send]")).toBeNull());
    expect(screen.getByText("醒了就跑这条")).toBeTruthy();
  });

  it("机器迟迟不就绪:押后到上限即交还草稿,不把消息永远压在本地转圈", async () => {
    // 假时钟直接推进到上限(真等 5 分钟没意义);全程 fireEvent + advanceTimersByTimeAsync,
    // 不用 waitFor/userEvent——它们各自挂着真实计时器,与假时钟互相卡死
    vi.useFakeTimers();
    try {
      const streamModes: string[] = [];
      stubShellWs((cmd, args) => {
        switch (cmd) {
          case "mc_task_info":
            // 唤醒失败/虚拟机回收:状态一直不翻到 online
            return Promise.resolve({ id: "t21", status: "processing", virtualmachine: { id: "vm1", status: "hibernated" } });
          case "cloud_ws_open":
            if (args?.kind === "stream") streamModes.push(String((args?.params as { mode?: string })?.mode ?? ""));
            return Promise.resolve({});
          default:
            return Promise.resolve({});
        }
      });
      render(<CloudTaskView task={{ id: "t21", status: "processing" }} />);
      await vi.advanceTimersByTimeAsync(50); // 详情落地 + attach 建连

      fireEvent.change(screen.getByLabelText("消息输入"), { target: { value: "等不到就还我" } });
      fireEvent.click(screen.getByRole("button", { name: "发送" }));
      await vi.advanceTimersByTimeAsync(50);
      expect(document.querySelector("[data-pending-send]")).toBeTruthy();

      await vi.advanceTimersByTimeAsync(300_000); // 押后上限
      // 草稿回到输入框(不是"到点照发":此刻上行只会被后端回显一下就丢,
      // 看起来像发成功了,比转圈更坏),占位撤下,原因外显
      expect((screen.getByLabelText("消息输入") as HTMLTextAreaElement).value).toBe("等不到就还我");
      expect(document.querySelector("[data-pending-send]")).toBeNull();
      expect(screen.getByText("云端机器迟迟没就绪,消息未发出,已放回输入框")).toBeTruthy();
      expect(streamModes).not.toContain("new");
    } finally {
      vi.useRealTimers();
    }
  });

  // 后端只对 hibernated 调 Resume(task_control.go:160),而 vmstatus.Resolve
  // 对已回收 / 带 Failed 条件 / 建成超 3 分钟仍探不到在线的机器一律给 offline
  // ——把 offline 也算成"正在唤醒",就是对着一台没人会去救的机器显唤醒动画、
  // 再把消息押住干等 5 分钟(2026-08-09)
  // 控制流是**唯一**会唤醒休眠 VM 的通道,而它连败到上限会永久放弃自动重连
  // (懒重连只挂在 call() 入口,而 call 只在开 ⋯ 菜单/切模型时才发)。于是
  // 「网络抖 30 秒 → 通道悄悄退场 → 15 分钟后机器休眠 → 界面显示正在唤醒、
  // 实际没人去唤醒」成了死结(2026-08-09)
  it("控制流放弃后机器休眠:进入休眠的那一下复活通道(否则永远没人去唤醒它)", async () => {
    vi.useFakeTimers();
    try {
      let vmStatus = "online";
      const controlOpens: string[] = [];
      stubShellWs((cmd, args) => {
        switch (cmd) {
          case "mc_task_info":
            return Promise.resolve({ id: "t28", status: "processing", virtualmachine: { id: "vm1", status: vmStatus } });
          case "cloud_ws_open":
            if (args?.kind !== "control") return Promise.resolve({});
            controlOpens.push(String(args?.pipe ?? ""));
            return Promise.reject(new Error("unreachable")); // 网络不可达
          default:
            return Promise.resolve({});
        }
      });
      render(<CloudTaskView task={{ id: "t28", status: "processing" }} />);
      // 5 次拨号失败(退避 2/4/8/16s)后放弃自动重连
      await vi.advanceTimersByTimeAsync(120_000);
      const gaveUpAt = controlOpens.length;
      expect(gaveUpAt).toBeGreaterThanOrEqual(5);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(controlOpens).toHaveLength(gaveUpAt); // 确认真的不再自动重拨
      // 控制通道死了要外显:它一断,保活与唤醒就都没了
      expect(screen.getByText(/云端控制通道已断开/)).toBeTruthy();

      vmStatus = "hibernated"; // 空闲久了,后端把机器睡了
      await act(async () => void (await vi.advanceTimersByTimeAsync(11_000))); // 等下一拍轮询看到
      expect(controlOpens.length).toBeGreaterThan(gaveUpAt); // 有人去唤醒了
    } finally {
      vi.useRealTimers();
    }
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
    render(<CloudTaskView task={{ id: "t22b", status: "processing" }} />);
    await waitFor(() => expect(screen.getAllByText(/启动失败/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/镜像拉取超时/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/尚未上线/)).toBeNull();
  });

  it("机器 offline(非休眠):不谎称唤醒中,发送照常出门不押后", async () => {
    const streamModes: string[] = [];
    stubShellWs((cmd, args) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t22", status: "processing", virtualmachine: { id: "vm1", status: "offline" } });
        case "cloud_ws_open":
          if (args?.kind === "stream") streamModes.push(String((args?.params as { mode?: string })?.mode ?? ""));
          return Promise.resolve({});
        default:
          return Promise.resolve({});
      }
    });
    render(<CloudTaskView task={{ id: "t22", status: "processing" }} />);
    await waitFor(() => expect(streamModes).toContain("attach"));
    // 连接条讲实话:不是"正在唤醒";但也**不许断言已回收/启动失败**——
    // 服务端的 offline 把"真回收""真失败""建成超 3 分钟还没上线"三件事挤在
    // 一个枚举里(backend/pkg/vmstatus/status.go::Resolve),这个桩没给 Failed
    // 条件,所以只能说"尚未上线"(2026-08-09 用户报障「明显是错的」)
    await waitFor(() => expect(screen.getAllByText(/尚未上线/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/正在唤醒云端机器/)).toBeNull();
    expect(screen.queryByText(/不会自动恢复/)).toBeNull();
    expect(screen.queryByText(/启动失败/)).toBeNull();

    fireEvent.change(screen.getByLabelText("消息输入"), { target: { value: "还是发出去试试" } });
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    // 不押后:直发(服务端才是权威,拒了会经 onSendFailed 交还草稿)
    await waitFor(() => expect(streamModes).toContain("new"));
  });

  // 启动期押后(旧 UI cloudStartup「环境就绪即送达」):pending 时 VM 还没有,
  // 直发只会掉进黑洞;环境就绪(task → processing)那一刻自动出门
  it("启动期发送:押进出件箱 + 待发 chip,任务转 processing 即自动送出", async () => {
    let taskStatus = "pending";
    const streamModes: string[] = [];
    const wsSends: { text?: unknown }[] = [];
    stubShellWs((cmd, args) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t23", status: taskStatus, virtualmachine: { id: "vm1", status: "online" } });
        case "cloud_ws_open":
          if (args?.kind === "stream") streamModes.push(String((args?.params as { mode?: string })?.mode ?? ""));
          return Promise.resolve({});
        case "cloud_ws_send":
          wsSends.push(args ?? {});
          return Promise.resolve({});
        default:
          return Promise.resolve({});
      }
    });
    render(<CloudTaskView task={{ id: "t23", status: "pending" }} />);
    const box = await screen.findByLabelText("消息输入");
    fireEvent.change(box, { target: { value: "先把活派下去" } });
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    // 启动页整屏是时间线,占位气泡没有落脚处:输入卡内给待发 chip
    expect(await screen.findByText("环境就绪后自动发送")).toBeTruthy();
    expect(screen.getByText("先把活派下去")).toBeTruthy();
    expect(streamModes).not.toContain("new"); // 还没出门

    taskStatus = "processing"; // 环境就绪
    await vi.waitFor(() => expect(streamModes).toContain("new"), { timeout: 5000, interval: 50 });
    await waitFor(() => {
      const sent = wsSends
        .map((s) => JSON.parse(String(s.text)) as { type: string; data: string })
        .find((f) => f.type === "user-input");
      expect(sent).toBeTruthy();
      expect(b64decode((JSON.parse(b64decode(sent!.data)) as { content: string }).content)).toBe("先把活派下去");
    });
  });

  // 唤醒完成要做的不止"把押后那条发出去":唤醒期间 attach 大概率已经连败收束,
  // 不重新武装的话 attach effect 的守卫永远挡着,实时输出就此死掉
  // (旧 UI useCloudTask.ts:337-348 的四件事)
  it("唤醒完成:即便出件箱是空的,也要重新武装 attach(否则实时输出永久死掉)", async () => {
    let vmStatus = "hibernated";
    const streamOpens: string[] = [];
    const listeners = stubShellWs((cmd, args) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({ id: "t24", status: "processing", virtualmachine: { id: "vm1", status: vmStatus } });
        case "cloud_ws_open":
          if (args?.kind === "stream") streamOpens.push(String(args?.pipe ?? ""));
          return Promise.resolve({});
        default:
          return Promise.resolve({});
      }
    });
    render(<CloudTaskView task={{ id: "t24", status: "processing" }} />);
    await waitFor(() => expect(streamOpens).toHaveLength(1));
    // 唤醒期任务流被云端正常收束(零帧 Close 1000)→ 转"就绪",不再自动重建
    listeners.get(`ws-closed:${streamOpens[0]}`)?.({ payload: { code: 1000 } });
    await waitFor(() => expect(streamOpens).toHaveLength(1)); // 确认没有自动重连

    vmStatus = "online"; // 机器醒了
    await vi.waitFor(() => expect(streamOpens.length).toBeGreaterThan(1), { timeout: 5000, interval: 50 });
  });

  // 连上后一帧不回(socket 静静挂着):onFrames/onIdle/onSendFailed 一个都不会
  // 来,发送态就永远悬着——按钮转圈到天荒地老,字已经离开输入框,再按发送还
  // 被「上一条还在拨号」挡回来。旧 UI useCloudTask.ts:229 同位置有一道 15s 闸
  it("已出门却零回执:15s 到点解除发送态并外显,不让按钮永远转圈", async () => {
    vi.useFakeTimers();
    try {
      stubShellWs((cmd) =>
        cmd === "mc_task_info"
          ? Promise.resolve({ id: "t25", status: "processing", virtualmachine: { id: "vm1", status: "online" } })
          : Promise.resolve({}),
      );
      render(<CloudTaskView task={{ id: "t25", status: "processing" }} />);
      await vi.advanceTimersByTimeAsync(50);
      fireEvent.change(screen.getByLabelText("消息输入"), { target: { value: "石沉大海的一句" } });
      fireEvent.click(screen.getByRole("button", { name: "发送" }));
      await vi.advanceTimersByTimeAsync(50);
      expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);

      await vi.advanceTimersByTimeAsync(15_000);
      // 发送态解除(可以再发),内容不静默丢:原文进错误条由用户决定要不要重发
      expect(document.querySelector("[data-pending-send]")).toBeNull();
      expect(screen.getByText(/云端迟迟没有回应.*石沉大海的一句/)).toBeTruthy();
      fireEvent.change(screen.getByLabelText("消息输入"), { target: { value: "再来一次" } });
      expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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
    render(<CloudTaskView task={{ id: "t26", status: "processing" }} />);
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
      render(<CloudTaskView task={{ id: "t27", status: "processing" }} />);
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

  it("押后期间任务结束:占位撤下,未发出的内容外显不静默丢", async () => {
    let taskStatus = "processing";
    stubShellWs((cmd) => {
      switch (cmd) {
        case "mc_task_info":
          return Promise.resolve({
            id: "t20",
            status: taskStatus,
            virtualmachine: { id: "vm1", status: "hibernated" },
          });
        case "mc_task_rounds":
          return Promise.resolve({ frames: [], next_cursor: "", has_more: false });
        default:
          return Promise.resolve({});
      }
    });
    render(<CloudTaskView task={{ id: "t20", status: "processing" }} />);
    fireEvent.change(await screen.findByLabelText("消息输入"), { target: { value: "还没来得及发" } });
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("云端机器唤醒中,连上后自动发出…");

    taskStatus = "finished"; // 云端跑完 / 被别处终止
    await vi.waitFor(() => expect(screen.getByText(/任务已结束,这条还没来得及发出/)).toBeTruthy(), {
      timeout: 5000,
      interval: 50,
    });
    expect(document.querySelector("[data-pending-send]")).toBeNull();
  });
});
