import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelInfo } from "@/lib/ipc/sessions";
import { pathBackedFile } from "@/lib/ipc/uploads";
import { b64encode } from "@/lib/protocol/codec";
import { resetEscLayersForTest } from "@/lib/util/escLayer";
import { NewTaskModal } from "./NewTaskModal";

/** Esc = 走 escLayer 的 window capture 单一监听(层栈按后进先出派发)。 */
const pressEsc = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });

afterEach(() => {
  resetEscLayersForTest(); // 模块级层栈跨用例会串
  localStorage.clear();
  vi.restoreAllMocks();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
});

const DEFAULT_MODELS: ModelInfo[] = [
  { name: "gpt-5", default: true },
  { name: "locked-pro", default: false, locked: true },
];
const DEFAULT_SKILLS = [
  { name: "feature-design", description: "设计功能", source: "builtin", content: "", default_enabled: true },
  { name: "code-review", description: "审查代码", source: "builtin", content: "", default_enabled: false },
];

/** 壳桩:按命令名分发,overrides 可逐命令改写(如注入失败)。 */
function stubShell(
  overrides: Record<string, (args?: Record<string, unknown>) => Promise<unknown>> = {},
  models: ModelInfo[] = DEFAULT_MODELS,
) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        const over = overrides[cmd];
        if (over) return over(args);
        if (cmd === "models_list") return Promise.resolve(models);
        if (cmd === "skills_list") return Promise.resolve(DEFAULT_SKILLS);
        if (cmd === "session_create")
          return Promise.resolve({ id: "s-new", title: "t", workdir: "/w", model: "gpt-5", turns: 0, status: "created", kind: (args?.kind as string) ?? "local" });
        return Promise.resolve(null);
      },
    },
  };
  return calls;
}

/** 目录输入框收进「选择项目」下拉(卡头句式触发器)后,取值/改值前先展开。 */
async function openDirMenu() {
  await userEvent.click(screen.getByRole("button", { name: "选择项目" }));
  return screen.getByRole("textbox", { name: "项目文件夹" }) as HTMLInputElement;
}

describe("新建任务", () => {
  it("类型页签只剩本地/云端(2026-08-18 定案:会话并入本地任务,差异在目录选择器)", async () => {
    stubShell();
    render(<NewTaskModal open onClose={() => {}} onCreated={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "模型" }).textContent).toContain("gpt-5"));
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.trim())).toEqual(["本地任务", "云端任务"]);
  });

  it("默认本地模式:目录预填 ~/MonkeyCode,模型取默认且锁定项禁选", async () => {
    stubShell();
    render(<NewTaskModal open onClose={() => {}} onCreated={() => {}} />);
    // 模型/思考档是 composer 同款菜单触发器(pickers.ModelMenu):文本即当前模型
    await waitFor(() => expect(screen.getByRole("button", { name: "模型" }).textContent).toContain("gpt-5"));
    expect(screen.getByRole("button", { name: "选择项目" }).textContent).toContain("项目：MonkeyCode");
    const input = await openDirMenu();
    expect(input.value).toBe("~/MonkeyCode");
    expect(input.placeholder).toBe("输入项目文件夹路径");
    const projectMenu = screen.getByRole("list", { name: "选择项目" });
    expect(projectMenu.textContent).toContain("临时会话（不关联项目）");
    expect(projectMenu.textContent).toContain("选择项目文件夹…");
    await userEvent.click(screen.getByRole("button", { name: "模型" }));
    const menu = screen.getByRole("list", { name: "切换模型" });
    expect((within(menu).getByRole("button", { name: /locked-pro/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("本地 + 默认目录:createDir=true、think 默认低;创建成功回调并记忆模型", async () => {
    const calls = stubShell();
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "模型" }).textContent).toContain("gpt-5"));
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const create = calls.find((c) => c.cmd === "session_create");
    expect(create?.args).toEqual({ workdir: "~/MonkeyCode", model: "gpt-5", createDir: true, kind: "local", think: "low" });
    expect(localStorage.getItem("mc.lastTaskModel")).toBe("gpt-5");
  });

  it("模型明确关闭思考时，新建任务显示并显式下发 off", async () => {
    const calls = stubShell({}, [{ name: "no-reasoning", default: true, think: "off" }]);
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    await waitFor(() => {
      const trigger = screen.getByRole("button", { name: "模型" });
      expect(trigger.textContent).toContain("no-reasoning");
      expect(trigger.textContent).toContain("· 关闭");
    });

    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls.find((c) => c.cmd === "session_create")?.args).toMatchObject({
      model: "no-reasoning",
      think: "off",
    });
  });

  it("临时会话档:目录下拉选「不关联项目」→ workdir 空串、createDir=false、kind=chat", async () => {
    const calls = stubShell();
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    await openDirMenu();
    await userEvent.click(screen.getByRole("button", { name: /临时会话/ }));
    // 触发器切到临时会话档显示
    expect(screen.getByRole("button", { name: "选择项目" }).textContent).toContain("临时会话");
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const create = calls.find((c) => c.cmd === "session_create");
    expect(create?.args).toEqual({ workdir: "", model: "gpt-5", createDir: false, kind: "chat", think: "low" });
  });

  it("清空目录 = 临时会话档(会话=不关联项目的任务,「必填」拦截退役):照建 kind=chat", async () => {
    const calls = stubShell();
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    await userEvent.clear(await openDirMenu());
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls.find((c) => c.cmd === "session_create")?.args).toMatchObject({ workdir: "", kind: "chat" });
  });

  it("创建失败(非目录缺失):错误文案外显,无确认钮", async () => {
    stubShell({ session_create: () => Promise.reject(new Error("模型不可用")) });
    render(<NewTaskModal open onClose={() => {}} onCreated={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("模型不可用"));
    expect(screen.queryByRole("button", { name: "创建并继续" })).toBeNull();
  });

  it("目录不存在:错误条换成确认钮,确认后带 createDir=true 重试", async () => {
    let attempts = 0;
    const calls = stubShell({
      session_create: (args) => {
        attempts++;
        if (attempts === 1) return Promise.reject(new Error("工作区目录不存在: /x/y"));
        return Promise.resolve({ id: "s-new", title: "", workdir: "/x/y", model: "gpt-5", turns: 0, status: "created", kind: (args?.kind as string) ?? "local" });
      },
    });
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    const input = await openDirMenu();
    await userEvent.clear(input);
    await userEvent.type(input, "/x/y");
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("项目文件夹不存在，创建并继续？"));
    await userEvent.click(screen.getByRole("button", { name: "创建并继续" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const creates = calls.filter((c) => c.cmd === "session_create");
    expect(creates).toHaveLength(2);
    expect(creates[0]?.args).toMatchObject({ workdir: "/x/y", createDir: false });
    expect(creates[1]?.args).toMatchObject({ workdir: "/x/y", createDir: true });
  });

  it("首条消息支持 Ctrl+Enter 换行,普通 Enter 才创建并发送", async () => {
    const calls = stubShell();
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    const box = screen.getByRole("textbox", { name: "首条消息" });

    await userEvent.type(box, "第一行");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect((box as HTMLTextAreaElement).value).toBe("第一行\n");
    expect(calls.some((call) => call.cmd === "session_create")).toBe(false);

    await userEvent.type(box, "第二行{Enter}");
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const send = calls.find((call) => call.cmd === "session_send");
    expect(send?.args).toEqual({ id: "s-new", ftype: "user-input", payload: { content: b64encode("第一行\n第二行") } });
  });

  it("Ctrl+Alt+Enter 不冒充 Ctrl+Enter,按原普通 Enter 路径创建", async () => {
    const calls = stubShell();
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    const box = screen.getByRole("textbox", { name: "首条消息" });
    await userEvent.type(box, "AltGr 输入");

    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true, altKey: true });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls.some((call) => call.cmd === "session_create")).toBe(true);
  });

  it("首条消息随建随发:session_create 成功后经 session_send 发 user-input(b64)", async () => {
    const calls = stubShell();
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    await userEvent.type(screen.getByRole("textbox", { name: "首条消息" }), "修个 bug");
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const send = calls.find((c) => c.cmd === "session_send");
    expect(send?.args).toEqual({ id: "s-new", ftype: "user-input", payload: { content: b64encode("修个 bug") } });
    // 顺序:先建后发
    expect(calls.findIndex((c) => c.cmd === "session_send")).toBeGreaterThan(calls.findIndex((c) => c.cmd === "session_create"));
  });

  it("首条消息留空:不发 session_send", async () => {
    const calls = stubShell();
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls.some((c) => c.cmd === "session_send")).toBe(false);
  });

  it("首条消息发送失败:仅 console.warn,不阻断进入会话", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubShell({ session_send: () => Promise.reject(new Error("引擎未就绪")) });
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<NewTaskModal open onClose={onClose} onCreated={onCreated} />);
    await userEvent.type(screen.getByRole("textbox", { name: "首条消息" }), "hi");
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("模型组合菜单调整 think 后随 session_create 下发", async () => {
    const calls = stubShell();
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "模型" }).textContent).toContain("gpt-5"));
    await userEvent.click(screen.getByRole("button", { name: "模型" }));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "思考深度" })).getByRole("radio", { name: "高" }));
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls.find((c) => c.cmd === "session_create")?.args).toMatchObject({ think: "high" });
  });

  it("skills:加载期间不显示误导性的 0 个技能", async () => {
    let resolveSkills: ((value: unknown) => void) | undefined;
    stubShell({
      skills_list: () =>
        new Promise((resolve) => {
          resolveSkills = resolve;
        }),
    });
    render(<NewTaskModal open onClose={() => {}} onCreated={() => {}} />);

    const trigger = screen.getByRole("button", { name: "会话技能" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.textContent).toContain("会话技能");
    expect(trigger.textContent).not.toContain("·0");

    await act(async () => resolveSkills?.(DEFAULT_SKILLS));
    await waitFor(() => expect(screen.getByRole("button", { name: "会话技能" }).textContent).toContain("技能·1"));
  });

  it("skills:可在创建前多选,显式名单随 session_create 原子下发", async () => {
    const calls = stubShell();
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "会话技能" }).textContent).toContain("技能·1"));
    await userEvent.click(screen.getByRole("button", { name: "会话技能" }));
    await userEvent.click(within(screen.getByRole("list", { name: "会话技能" })).getByRole("checkbox", { name: "code-review" }));
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls.find((c) => c.cmd === "session_create")?.args).toMatchObject({
      skills: ["feature-design", "code-review"],
    });
  });

  it("skills:全部取消时显式下发空数组,不回退默认集", async () => {
    const calls = stubShell();
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "会话技能" }).textContent).toContain("技能·1"));
    await userEvent.click(screen.getByRole("button", { name: "会话技能" }));
    await userEvent.click(within(screen.getByRole("list", { name: "会话技能" })).getByRole("checkbox", { name: "feature-design" }));
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls.find((c) => c.cmd === "session_create")?.args).toMatchObject({ skills: [] });
  });

  it("skills:创建进行中禁用选择器,不会接受无法下发的后续修改", async () => {
    let resolveCreate: ((value: unknown) => void) | undefined;
    const calls = stubShell({
      session_create: () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    });
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "会话技能" }).textContent).toContain("技能·1"));
    await userEvent.click(screen.getByRole("button", { name: "会话技能" }));
    await userEvent.click(within(screen.getByRole("list", { name: "会话技能" })).getByRole("checkbox", { name: "code-review" }));
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "session_create")).toBe(true));

    const trigger = screen.getByRole("button", { name: "会话技能" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    await userEvent.click(trigger);
    expect(screen.queryByRole("list", { name: "会话技能" })).toBeNull();

    await act(async () =>
      resolveCreate?.({ id: "s-new", title: "t", workdir: "/w", model: "gpt-5", turns: 0, status: "created", kind: "local" }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls.find((c) => c.cmd === "session_create")?.args).toMatchObject({
      skills: ["feature-design", "code-review"],
    });
  });

  it("最近项目:预填首项、下拉可选,WSL 遗留 UNC 目录在本机模式被过滤", async () => {
    stubShell();
    render(
      <NewTaskModal
        open
        onClose={() => {}}
        onCreated={() => {}}
        recentDirs={["/a/proj", "/b/proj", "\\\\wsl$\\Ubuntu\\home\\u\\proj"]}
      />,
    );
    const input = await openDirMenu();
    await waitFor(() => expect(input.value).toBe("/a/proj"));
    const menu = screen.getByRole("list", { name: "选择项目" });
    expect(menu.textContent).toContain("最近项目");
    expect(menu.textContent).toContain("/a/proj");
    expect(menu.textContent).toContain("/b/proj");
    expect(menu.textContent).not.toContain("wsl$");
    await userEvent.click(screen.getByRole("button", { name: "/b/proj" }));
    expect(screen.queryByRole("list", { name: "选择项目" })).toBeNull();
    expect((await openDirMenu()).value).toBe("/b/proj");
  });

  it("选择项目文件夹…:走系统目录选择并回填", async () => {
    const calls = stubShell({ "plugin:dialog|open": () => Promise.resolve("/picked/dir") });
    render(<NewTaskModal open onClose={() => {}} onCreated={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "选择项目" }));
    await userEvent.click(screen.getByRole("button", { name: "选择项目文件夹…" }));
    // 回填后卡头句式触发器展示所选目录(title 露全路径)
    await waitFor(() => expect(screen.getByTitle("/picked/dir")).toBeDefined());
    expect((await openDirMenu()).value).toBe("/picked/dir");
    expect(calls.some((c) => c.cmd === "plugin:dialog|open")).toBe(true);
  });

  // 2026-08-09 撤回「按 wsl_workdir_base 拼默认目录」:默认目录恒为
  // ~/MonkeyCode,`~` 交给壳按内核环境展开(WSL → guest 家目录)。前端拼 UNC
  // 落点完全一样,却要等引擎起来才拿得到基座、拿不到时又退回 ~/MonkeyCode,
  // 同一个"默认目录"两种形态;旧 UI 从头到尾就是 ~/MonkeyCode。
  it("WSL 运行环境:默认目录仍是 ~/MonkeyCode(不拼 UNC),且享受静默创建", async () => {
    const calls = stubShell({
      get_config: () => Promise.resolve({ models: [], mcp_servers: {}, kernel_env: "wsl:Ubuntu" }),
      wsl_workdir_base: () => Promise.resolve("\\\\wsl$\\Ubuntu\\home\\u"),
    });
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    const input = await openDirMenu();
    await waitFor(() => expect(input.value).toBe("~/MonkeyCode"));
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(calls.find((c) => c.cmd === "session_create")?.args).toMatchObject({
      workdir: "~/MonkeyCode",
      createDir: true,
    });
    // 基座只用于**目录对话框**的起始位置,不参与默认目录推导
    expect(calls.some((c) => c.cmd === "wsl_workdir_base")).toBe(false);
  });

  it("WSL 运行环境:选择项目按环境过滤(posix/盘符留、无关形态不进列表)", async () => {
    stubShell({
      get_config: () => Promise.resolve({ models: [], mcp_servers: {}, kernel_env: "wsl:Ubuntu" }),
      wsl_workdir_base: () => Promise.resolve("/home/u"),
    });
    render(
      <NewTaskModal open onClose={() => {}} onCreated={() => {}} recentDirs={["/home/u/proj", "C:\\dev\\proj", "relative\\x"]} />,
    );
    const input = await openDirMenu();
    await waitFor(() => expect(input.value).toBe("/home/u/proj"));
    const menu = screen.getByRole("list", { name: "选择项目" });
    expect(menu.textContent).toContain("/home/u/proj");
    expect(menu.textContent).toContain("C:\\dev\\proj");
    expect(menu.textContent).not.toContain("relative");
  });
});

describe("Esc 分层(草稿不能被一下 Esc 顺手清掉)", () => {
  it("开着模型菜单按 Esc:只关菜单,新建页不退、首条消息还在", async () => {
    stubShell();
    const onClose = vi.fn();
    render(<NewTaskModal open onClose={onClose} onCreated={() => {}} />);
    await userEvent.type(screen.getByRole("textbox", { name: "首条消息" }), "修个 bug");
    await userEvent.click(screen.getByRole("button", { name: "模型" }));
    expect(screen.getByRole("list", { name: "切换模型" })).toBeDefined();

    pressEsc();
    // 此前视图级 Esc 挂载即注册、浮层开时才注册,同阶段按注册先后触发 ——
    // 视图必先吃掉这一下,整页连同草稿一起没
    expect(screen.queryByRole("list", { name: "切换模型" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "首条消息" }) as HTMLTextAreaElement).value).toBe("修个 bug");
  });

  it("焦点在正文里按 Esc:只收敛焦点;再按一下才关页", async () => {
    stubShell();
    const onClose = vi.fn();
    render(<NewTaskModal open onClose={onClose} onCreated={() => {}} />);
    const box = screen.getByRole("textbox", { name: "首条消息" });
    await userEvent.type(box, "草稿");
    expect(document.activeElement).toBe(box);

    pressEsc();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(box);
    expect((screen.getByRole("textbox", { name: "首条消息" }) as HTMLTextAreaElement).value).toBe("草稿");

    pressEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // b6bda87b 收口 Esc 分层时只覆盖了走 useDismiss 的模型/思考档菜单,
  // 「选择项目」这两处**手写下拉**用的是容器 onBlur、从不入层栈,于是按 Esc
  // 时栈顶只有视图层自己,它对非输入焦点一律 onClose() —— 想收起下拉,结果
  // 整个新建页退掉、首条消息与暂存附件全销毁,还不带确认
  it("开着「选择项目」下拉按 Esc:只关下拉,新建页不退、首条消息还在", async () => {
    stubShell();
    const onClose = vi.fn();
    render(<NewTaskModal open onClose={onClose} onCreated={() => {}} />);
    await userEvent.type(screen.getByRole("textbox", { name: "首条消息" }), "改一下登录页");
    await openDirMenu();
    expect(screen.queryByRole("textbox", { name: "项目文件夹" })).not.toBeNull();

    pressEsc();
    expect(screen.queryByRole("textbox", { name: "项目文件夹" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "首条消息" }) as HTMLTextAreaElement).value).toBe("改一下登录页");

    // 下拉收起后这一层就该让出来:再按一下才轮到视图层关页
    pressEsc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("关闭后不再占层(open=false 即出栈)", async () => {
    stubShell();
    const onClose = vi.fn();
    const { rerender } = render(<NewTaskModal open onClose={onClose} onCreated={() => {}} />);
    await screen.findByRole("textbox", { name: "首条消息" });
    rerender(<NewTaskModal open={false} onClose={onClose} onCreated={() => {}} />);
    pressEsc();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("首条消息附件", () => {
  it("粘贴文件进暂存 chips;创建后先上传再把附件行并进首条消息", async () => {
    // 上传走分块通道:begin/chunk/finish,壳最终返回工作区相对路径
    const calls = stubShell({
      upload_begin: () => Promise.resolve({ id: "u1" }),
      upload_chunk: () => Promise.resolve(null),
      upload_finish: () => Promise.resolve({ path: ".monkeycode/uploads/shot.png" }),
    });
    render(<NewTaskModal open onClose={() => {}} onCreated={() => {}} />);
    const box = await screen.findByRole("textbox", { name: "首条消息" });
    await userEvent.type(box, "看这张图");

    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    await userEvent.paste(
      { getData: () => "", items: [{ kind: "file", type: "image/png", getAsFile: () => file }] } as never,
    );
    expect(await screen.findByAltText("shot.png")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "session_send")).toBe(true));
    // 上传发生在建会话之后(upload_begin 按 sessionId 寻址)
    const order = calls.map((c) => c.cmd);
    expect(order.indexOf("upload_begin")).toBeGreaterThan(order.indexOf("session_create"));
    const sent = calls.find((c) => c.cmd === "session_send");
    expect((sent?.args?.payload as { content: string }).content).toBe(
      b64encode("看这张图\n[图片] .monkeycode/uploads/shot.png"),
    );
  });

  it("移除 chip 后不再上传;附件上传失败不阻断建会话与发送", async () => {
    const calls = stubShell({ upload_begin: () => Promise.reject(new Error("磁盘满")) });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onCreated = vi.fn();
    render(<NewTaskModal open onClose={() => {}} onCreated={onCreated} />);
    const box = await screen.findByRole("textbox", { name: "首条消息" });
    await userEvent.type(box, "带个附件");

    const doc = new File([new Uint8Array([1])], "a.txt", { type: "text/plain" });
    const gone = new File([new Uint8Array([1])], "b.txt", { type: "text/plain" });
    await userEvent.paste(
      {
        getData: () => "",
        items: [
          { kind: "file", type: "text/plain", getAsFile: () => doc },
          { kind: "file", type: "text/plain", getAsFile: () => gone },
        ],
      } as never,
    );
    await userEvent.click(await screen.findByRole("button", { name: "移除附件 b.txt" }));
    expect(screen.queryByTitle("b.txt")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    // 失败的附件被跳过,正文照发(会话已建,不把用户卡在弹窗里)
    const sent = calls.find((c) => c.cmd === "session_send");
    expect((sent?.args?.payload as { content: string }).content).toBe(b64encode("带个附件"));
    expect(calls.filter((c) => c.cmd === "upload_begin").length).toBe(1); // 只剩一个附件
  });

  it("initialFiles 预填附件区(待办派发带图):建会话后按路径直拷并入附件行", async () => {
    const calls = stubShell({
      upload_file_path: () => Promise.resolve({ path: ".monkeycode/uploads/shot.png" }),
    });
    // 待办图片是 path-backed 占位 File(0 字节):chip 出名字条,不建 objectURL
    const staged = pathBackedFile("/cfg/todo-uploads/shot.png", "shot.png", "image/*");
    render(
      <NewTaskModal open onClose={() => {}} onCreated={() => {}} initialText="看这张图" initialFiles={[staged]} />,
    );
    expect(await screen.findByTitle("shot.png")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "session_send")).toBe(true));
    // 路径直拷通道:src = 待办附件的绝对路径;附件行并进首条消息
    const copied = calls.find((c) => c.cmd === "upload_file_path");
    expect(copied?.args?.src).toBe("/cfg/todo-uploads/shot.png");
    const sent = calls.find((c) => c.cmd === "session_send");
    expect((sent?.args?.payload as { content: string }).content).toBe(
      b64encode("看这张图\n[图片] .monkeycode/uploads/shot.png"),
    );
  });
});
