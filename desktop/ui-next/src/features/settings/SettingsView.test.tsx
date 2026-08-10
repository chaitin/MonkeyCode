import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopConfig } from "@/lib/ipc/config";
import { resetEscLayersForTest } from "@/lib/util/escLayer";
import { SettingsView } from "./SettingsView";

/** Esc = 走 escLayer 的 window capture 单一监听(层栈按后进先出派发)。 */
const pressEsc = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });

afterEach(() => {
  resetEscLayersForTest(); // 模块级层栈跨用例会串
  localStorage.clear();
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  // UA 覆写(WSL 条件渲染用)按实例属性打的,删掉即回落 jsdom 原型 getter
  Reflect.deleteProperty(window.navigator, "userAgent");
  vi.unstubAllGlobals();
});

const baseConfig: DesktopConfig = {
  models: [
    { name: "主力", provider: "anthropic", base_url: "https://a", api_key: "k1", model: "claude", default: true },
    { name: "备用", provider: "openai", base_url: "https://b", api_key: "k2", model: "gpt", default: false },
  ],
  mcp_servers: { fetch: { url: "https://mcp" } },
  kernel_env: "",
  mc_base_url: "https://mc.example",
};

function stubShell(opts?: {
  config?: DesktopConfig;
  sound?: boolean;
  distros?: string[];
  save?: () => Promise<unknown>;
  /** 额外命令(账号分区的 baizhi/mc 系列等),优先于内置分支 */
  extra?: Record<string, () => unknown>;
}) {
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = [];
  const listeners: Record<string, (e: { payload: unknown }) => void> = {};
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        calls.push({ cmd, args });
        if (opts?.extra && cmd in opts.extra) return Promise.resolve(opts.extra[cmd]!());
        switch (cmd) {
          case "get_config":
            return Promise.resolve(structuredClone(opts?.config ?? baseConfig));
          case "sound_enabled":
            return Promise.resolve(opts?.sound ?? true);
          case "list_wsl_distros":
            return Promise.resolve(opts?.distros ?? []);
          case "host_info":
            return Promise.resolve({ version: "26080101", engine_version: "0.9.0" });
          case "save_config":
            return (opts?.save ?? (() => Promise.resolve(null)))();
          default:
            return Promise.resolve(null);
        }
      },
    },
    event: {
      listen: (name: string, cb: (e: { payload: unknown }) => void) => {
        listeners[name] = cb;
        return Promise.resolve(() => {});
      },
    },
  };
  return { calls, listeners };
}

const windowsUA = () =>
  Object.defineProperty(window.navigator, "userAgent", {
    value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    configurable: true,
  });

const openModels = async () => {
  await userEvent.click(screen.getByRole("button", { name: "模型" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /主力/ })).toBeDefined());
};

describe("设置视图:导航与载入", () => {
  it("非 Windows:导航为 通用/模型/MCP/关于,无「运行环境」;模型列表载入", async () => {
    stubShell();
    render(<SettingsView onClose={() => {}} />);
    for (const label of ["通用", "模型", "MCP", "关于"]) {
      expect(screen.getByRole("button", { name: label })).toBeDefined();
    }
    expect(screen.queryByRole("button", { name: "运行环境" })).toBeNull();
    await openModels();
    expect(screen.getByRole("button", { name: /备用/ })).toBeDefined();
    expect(screen.getByText("默认")).toBeDefined(); // 主力行的默认徽标
  });

  it("导航含「账号」,点击挂载账号分区(登录 tab 可见)", async () => {
    stubShell(); // 未知命令(baizhi_status 等)回 null,分区按未登录形态渲染
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "账号" }));
    expect(await screen.findByRole("tab", { name: "微信扫码" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "短信验证码" })).toBeDefined();
    // 拉码命令回 null → 状态机按失败收束,给出重试入口(不留悬空 loading)
    expect(await screen.findByRole("button", { name: "重新获取二维码" })).toBeDefined();
  });

  it("返回按钮回调 onClose", async () => {
    stubShell();
    const onClose = vi.fn();
    render(<SettingsView onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("浏览器模式:模型分区降级为只读提示,不渲染保存条", async () => {
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "模型" }));
    expect(screen.getByRole("alert").textContent).toContain("浏览器模式下配置只读");
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
  });
});

describe("Esc 分层与离开守卫", () => {
  it("开着主题下拉按 Esc:只关下拉,设置页不退(层栈后进先出,不再是注册时序说了算)", async () => {
    stubShell();
    const onClose = vi.fn();
    render(<SettingsView onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    await userEvent.click(screen.getByRole("button", { name: "外观主题" }));
    expect(screen.getByRole("listbox", { name: "外观主题" })).toBeDefined();

    pressEsc();
    expect(screen.queryByRole("listbox", { name: "外观主题" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled(); // 此前视图层先注册,一按就把整页关了

    pressEsc(); // 下拉已收,这下才轮到视图层(表单干净 → 直接退出)
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("在输入框里按 Esc:只收敛焦点,不退出、不丢弃未保存的编辑", async () => {
    stubShell();
    const onClose = vi.fn();
    render(<SettingsView onClose={onClose} />);
    await openModels();
    await userEvent.click(screen.getByRole("button", { name: /主力/ }));
    const name = screen.getByRole("textbox", { name: "名称" });
    await userEvent.clear(name);
    await userEvent.type(name, "主力2");
    expect(document.activeElement).toBe(name);

    pressEsc();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(name); // 焦点收敛
    expect((screen.getByRole("textbox", { name: "名称" }) as HTMLInputElement).value).toBe("主力2");
  });

  it("脏表单上 Esc/返回:先问一句;「留在设置」不退,「放弃并离开」才退", async () => {
    stubShell();
    const onClose = vi.fn();
    render(<SettingsView onClose={onClose} />);
    await openModels();
    await userEvent.click(screen.getByRole("button", { name: /主力/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "名称" }), "x");

    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(await screen.findByRole("dialog", { name: "有未保存的更改" })).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();

    // 弹层里的 Esc = 取消离开:它自占一层,不会穿回视图层再把设置页关掉
    pressEsc();
    expect(screen.queryByRole("dialog", { name: "有未保存的更改" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    pressEsc(); // 焦点已不在输入框(上一步点了「返回」),这下走视图层
    await userEvent.click(await screen.findByRole("button", { name: "留在设置" }));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    await userEvent.click(await screen.findByRole("button", { name: "放弃并离开" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("表单干净时 Esc/返回直接退出,不拿弹层烦人", async () => {
    stubShell();
    const onClose = vi.fn();
    render(<SettingsView onClose={onClose} />);
    await openModels();
    pressEsc();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("脏状态机与保存条", () => {
  it("载入即收敛同名模型:重名不再把整份配置的保存永久拦死", async () => {
    // 历史版本/手工编辑落盘的同名存量(这里两条都叫「主力」)。载入不收敛的话
    // validateDraft 恒报 modelDup,save() 见错即 return —— 改 kernel_env、加
    // MCP、加模型……什么都存不下去,而重名的那条在引擎侧本来就是静默失效的
    const { calls } = stubShell({
      config: {
        ...baseConfig,
        models: [
          { name: "主力", provider: "anthropic", base_url: "https://a", api_key: "k1", model: "old", default: true },
          { name: "主力", provider: "anthropic", base_url: "https://a", api_key: "k1", model: "new" },
        ],
      },
    });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "MCP" }));
    await userEvent.click(await screen.findByRole("button", { name: "添加 MCP" }));
    await userEvent.type(screen.getByRole("textbox", { name: "名称" }), "files");
    await userEvent.type(screen.getByRole("textbox", { name: "URL" }), "https://x");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    expect(screen.queryByText(/模型名称重复/)).toBeNull();
    const saved = calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig;
    // 收敛为一条:后者内容胜出(与引擎按名字建 Map 的物化行为一致)
    expect(saved.models.map((m) => [m.name, m.model])).toEqual([["主力", "new"]]);
    expect(saved.mcp_servers).toMatchObject({ files: { url: "https://x" } });
  });

  it("改动 → 保存条现身;放弃 → 草稿还原、保存条收起", async () => {
    stubShell();
    render(<SettingsView onClose={() => {}} />);
    await openModels();
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /主力/ }));
    const name = screen.getByRole("textbox", { name: "名称" });
    await userEvent.clear(name);
    await userEvent.type(name, "主力2");
    expect(screen.getByRole("button", { name: "保存" })).toBeDefined();
    expect(screen.getByText(/有未保存的修改/).textContent).toContain("重启引擎");

    await userEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect((screen.getByRole("textbox", { name: "名称" }) as HTMLInputElement).value).toBe("主力");
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
  });

  it("保存:save_config 全量写回(default 重算、MCP 序列化、表单外字段透传),成功后保存条收起", async () => {
    const { calls } = stubShell();
    render(<SettingsView onClose={() => {}} />);
    await openModels();
    await userEvent.click(screen.getByRole("button", { name: /主力/ }));
    const name = screen.getByRole("textbox", { name: "名称" });
    await userEvent.clear(name);
    await userEvent.type(name, "主力2");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    const payload = calls.find((c) => c.cmd === "save_config")?.args?.config;
    expect(payload).toEqual({
      models: [
        { name: "主力2", provider: "anthropic", base_url: "https://a", api_key: "k1", model: "claude", default: true },
        { name: "备用", provider: "openai", base_url: "https://b", api_key: "k2", model: "gpt", default: false },
      ],
      mcp_servers: { fetch: { url: "https://mcp" } },
      kernel_env: "",
      // 自建部署三项由草稿写回(未编辑即载入原值;未配置的写空串 = 官方云)
      mc_base_url: "https://mc.example",
      mc_basic_auth: "",
      mc_llm_base_url: "",
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "保存" })).toBeNull());
  });

  it("保存失败:壳的中文 Err 外显在保存条,条不收起", async () => {
    stubShell({ save: () => Promise.reject(new Error("引擎启动失败: 模型配置无效")) });
    render(<SettingsView onClose={() => {}} />);
    await openModels();
    await userEvent.click(screen.getByRole("button", { name: /主力/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "名称" }), "x");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("引擎启动失败: 模型配置无效"));
    expect(screen.getByRole("button", { name: "保存" })).toBeDefined();
  });

  it("校验拦截:清空模型名点保存,不发 save_config 且外显错误", async () => {
    const { calls } = stubShell();
    render(<SettingsView onClose={() => {}} />);
    await openModels();
    await userEvent.click(screen.getByRole("button", { name: /主力/ }));
    await userEvent.clear(screen.getByRole("textbox", { name: "名称" }));
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert").textContent).toContain("模型名称不能为空");
    expect(calls.some((c) => c.cmd === "save_config")).toBe(false);
  });
});

describe("模型增删改与设默认", () => {
  it("会员模型行不出高级项摘要(窗口/输出/图片/思考档一概不列)", async () => {
    // 用户定案 2026-08-09:这几项都是随同步整组下来的,会员行不可展开、
    // 表单里也没有它们,用户一项都改不了。advSummary 的前提(「我配过的值
    // 收起来看不见」)在会员行上不成立,剩下只是把每行撑长的噪音
    stubShell({
      config: {
        ...baseConfig,
        models: [
          ...baseConfig.models,
          {
            name: "会员-高级",
            provider: "anthropic",
            base_url: "https://mc",
            api_key: "mk",
            model: "claude-x",
            default: false,
            source: "monkeycode",
            context_window: 200000,
            max_output: 64000,
            vision: true,
            think: "high",
          },
          {
            name: "自定义-同参数",
            provider: "anthropic",
            base_url: "https://c",
            api_key: "ck",
            model: "claude-y",
            default: false,
            context_window: 200000,
            max_output: 64000,
            vision: true,
            think: "high",
          },
        ],
      },
    });
    render(<SettingsView onClose={() => {}} />);
    await openModels();

    // 会员行是只读 span(不可展开),自定义行是 button——都带 title=原始名
    const member = await screen.findByTitle("会员-高级");
    expect(member.textContent).not.toMatch(/窗口|输出|支持图片|思考/);

    // 反向锚:同样几项配在自定义条目上照旧展示(证明是按 source 分流,
    // 不是把整个摘要删了)
    const custom = await screen.findByTitle("自定义-同参数");
    expect(custom.textContent).toMatch(/窗口/);
    expect(custom.textContent).toMatch(/输出/);
    expect(custom.textContent).toMatch(/支持图片/);
    expect(custom.textContent).toMatch(/思考/);
  });

  it("添加模型:新行展开编辑,保存载荷含新条目", async () => {
    const { calls } = stubShell();
    render(<SettingsView onClose={() => {}} />);
    await openModels();
    await userEvent.click(screen.getByRole("button", { name: "添加模型" }));
    await userEvent.type(screen.getByRole("textbox", { name: "名称" }), "新模型");
    // 四项必填(见下一条用例):只填名称的半成品现在拦在保存之前
    await userEvent.type(screen.getByRole("textbox", { name: "接口地址" }), "https://api.example.com");
    await userEvent.type(screen.getByLabelText("API Key"), "sk-test"); // type=password 无 textbox role
    await userEvent.type(screen.getByRole("textbox", { name: "模型标识" }), "gpt-5");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    const models = (calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig).models;
    expect(models.map((m) => m.name)).toEqual(["主力", "备用", "新模型"]);
    expect(models.map((m) => m.default)).toEqual([true, false, false]);
  });

  // 旧 UI validateBeforeSave 第一段,ui-next 漏迁:isBlankModel 要求四项全空
  // 才当"没加",所以半成品会一路落盘 —— 界面说保存成功、引擎白重启一次,
  // 之后这条模型出现在 composer 选择器里,选中发消息必然失败
  it("模型缺 API Key / 模型标识:拦在保存之前并说明,不写盘、不重启引擎", async () => {
    const { calls } = stubShell();
    render(<SettingsView onClose={() => {}} />);
    await openModels();
    await userEvent.click(screen.getByRole("button", { name: "添加模型" }));
    await userEvent.type(screen.getByRole("textbox", { name: "名称" }), "半成品");
    await userEvent.type(screen.getByRole("textbox", { name: "接口地址" }), "https://api.example.com");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect((await screen.findByRole("alert")).textContent).toContain("半成品");
    expect(calls.some((c) => c.cmd === "save_config")).toBe(false);
  });

  it("删除默认行:默认位回落到首行,保存载荷同步", async () => {
    const { calls } = stubShell();
    render(<SettingsView onClose={() => {}} />);
    await openModels();
    await userEvent.click(screen.getAllByRole("button", { name: "删除" })[0]!);
    expect(screen.queryByRole("button", { name: /主力/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    const models = (calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig).models;
    expect(models).toEqual([
      { name: "备用", provider: "openai", base_url: "https://b", api_key: "k2", model: "gpt", default: true },
    ]);
  });

  it("高级字段:上下文窗口/最大输出/图片输入可改并进载荷", async () => {
    const { calls } = stubShell();
    render(<SettingsView onClose={() => {}} />);
    await openModels();
    await userEvent.click(screen.getByRole("button", { name: /主力/ }));
    await userEvent.type(screen.getByRole("spinbutton", { name: "上下文窗口(token)" }), "128000");
    await userEvent.type(screen.getByRole("spinbutton", { name: "最大输出(token)" }), "8000");
    await userEvent.click(screen.getByRole("checkbox", { name: "支持图片" }));
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    const models = (calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig).models;
    expect(models[0]).toMatchObject({ name: "主力", context_window: 128000, max_output: 8000, vision: true });
  });

  it("最大输出填大值(旧 UI 会拦的 10% 越界量):照常保存,不拦", async () => {
    const { calls } = stubShell();
    render(<SettingsView onClose={() => {}} />);
    await openModels();
    await userEvent.click(screen.getByRole("button", { name: /主力/ }));
    await userEvent.type(screen.getByRole("spinbutton", { name: "最大输出(token)" }), "64000");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    const models = (calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig).models;
    expect(models[0]).toMatchObject({ max_output: 64000 });
  });

  it("设为默认:default 标记随行重算", async () => {
    const { calls } = stubShell();
    render(<SettingsView onClose={() => {}} />);
    await openModels();
    await userEvent.click(screen.getByRole("button", { name: "设为默认" })); // 唯一非默认行(备用)
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    const models = (calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig).models;
    expect(models.map((m) => [m.name, m.default])).toEqual([
      ["主力", false],
      ["备用", true],
    ]);
  });
});

describe("MCP 编辑(与模型同一份脏状态)", () => {
  it("添加 stdio 条目:命令/参数/环境变量序列化进 mcp_servers", async () => {
    const { calls } = stubShell();
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "MCP" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /fetch/ })).toBeDefined());
    await userEvent.click(screen.getByRole("button", { name: "添加 MCP" }));
    await userEvent.type(screen.getByRole("textbox", { name: "名称" }), "files");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "类型" }), "stdio");
    await userEvent.type(screen.getByRole("textbox", { name: "命令" }), "npx");
    await userEvent.type(screen.getByRole("textbox", { name: "参数(空格分隔)" }), "-y srv");
    await userEvent.type(screen.getByRole("textbox", { name: /环境变量/ }), "HOME=/h");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    const servers = (calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig).mcp_servers;
    expect(servers).toEqual({
      fetch: { url: "https://mcp" },
      files: { command: "npx", args: ["-y", "srv"], env: { HOME: "/h" } },
    });
  });

  // 停用真值 = extra.disabled,壳按它过滤派生 mcp.json(config.rs 物化处):
  // 没有开关也没有徽标时,被早先版本停用过的 server 看着和正常条目一模一样,
  // 工具却永远不装载,只能手改 config.json
  it("停用:行上出「已停用」徽标,extra.disabled 进载荷", async () => {
    const { calls } = stubShell();
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "MCP" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /fetch/ })).toBeDefined());
    expect(screen.queryByText("已停用")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "停用" }));
    expect(screen.getByText("已停用")).toBeDefined();
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    expect((calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig).mcp_servers).toEqual({
      fetch: { disabled: true, url: "https://mcp", headers: undefined },
    });
  });

  it("既有停用条目:载入即外显,可就地启用(disabled 键随之消失)", async () => {
    const { calls } = stubShell({
      config: { ...baseConfig, mcp_servers: { fetch: { url: "https://mcp", disabled: true } } },
    });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "MCP" }));
    expect(await screen.findByText("已停用")).toBeDefined();

    await userEvent.click(screen.getByRole("button", { name: "启用" }));
    expect(screen.queryByText("已停用")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    expect((calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig).mcp_servers).toEqual({
      fetch: { url: "https://mcp", headers: undefined },
    });
  });
});

describe("模型分区的空组引导(旧 UI 随迁)", () => {
  it("一个模型都没有:百智云组与自定义组仍在,各自给出「模型从哪来」", async () => {
    stubShell({ config: { ...baseConfig, models: [] } });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "模型" }));
    // 未登录变体(baizhi_status 桩回 null)
    expect(await screen.findByText(/登录百智云并同步后/)).toBeDefined();
    expect(screen.getByText(/手工接入其他服务商的模型/)).toBeDefined();
    expect(screen.getByRole("button", { name: "添加模型" })).toBeDefined();
  });

  it("已登录百智云但该组为空:引导改成「去账号页点同步」", async () => {
    stubShell({
      config: { ...baseConfig, models: [] },
      extra: { baizhi_status: () => ({ logged_in: true, host: "baizhi.cloud" }) },
    });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "模型" }));
    expect(await screen.findByText(/点「同步模型与 MCP」/)).toBeDefined();
  });
});

describe("同步自动保存(旧 UI autoSaveDecision 随迁)", () => {
  // 账号分区已登录 + 会员同步返回一条模型
  const syncExtra = () => ({
    mc_status: () => ({ logged_in: true, user: { name: "李四" } }),
    baizhi_status: () => ({ logged_in: false, host: "baizhi.cloud" }),
    mc_models_sync: () => ({
      models: [{ name: "member-m", base_url: "https://m", api_key: "k", model: "mm", source: "monkeycode" }],
    }),
  });
  const syncMemberModels = async () => {
    await userEvent.click(screen.getByRole("button", { name: "账号" }));
    await userEvent.click(await screen.findByRole("button", { name: "同步会员模型" }));
  };

  it("干净表单+无任务在跑:同步后直接 save_config,提示「已自动保存」", async () => {
    const { calls } = stubShell({ extra: syncExtra() });
    render(<SettingsView onClose={() => {}} />);
    await openModels(); // 等配置载入(基线就绪)再去账号页
    await syncMemberModels();
    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    expect((await screen.findByText(/已获取 1 个会员模型/)).textContent).toContain("已自动保存");
    // 载荷含同步条目(落盘名带 @monkeycode 来源后缀)
    const saved = calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig;
    expect(saved.models.some((m) => m.name.startsWith("member-m@"))).toBe(true);
  });

  it("保存在途时第二路同步落地:补存一轮把它写进去,不留给用户手点", async () => {
    // 扫码登录的真实时序:百智云同步先落地起了保存(写盘+重启引擎数秒),
    // 会员模型同步随后落在保存在途期。旧 UI 的补存循环漏迁时,第二路条目
    // 就停在未保存态(2026-08-06 用户报障「扫码之后还要手动保存」)
    const pending: Array<() => void> = [];
    const model = (name: string) => ({ name, base_url: "https://m", api_key: "k", model: name, source: "monkeycode" });
    let round = 0;
    const { calls } = stubShell({
      extra: {
        mc_status: () => ({ logged_in: true, user: { name: "李四" } }),
        baizhi_status: () => ({ logged_in: false, host: "baizhi.cloud" }),
        // 第二次同步多回一条:草稿在保存在途期发生变化
        mc_models_sync: () => ({ models: round++ === 0 ? [model("mem-a")] : [model("mem-a"), model("mem-b")] }),
      },
      save: () => new Promise<null>((res) => pending.push(() => res(null))),
    });
    render(<SettingsView onClose={() => {}} />);
    await openModels();
    await userEvent.click(screen.getByRole("button", { name: "账号" }));
    const syncBtn = await screen.findByRole("button", { name: "同步会员模型" });
    await userEvent.click(syncBtn);
    await waitFor(() => expect(pending).toHaveLength(1)); // 第一路保存在途

    await userEvent.click(await screen.findByRole("button", { name: "同步会员模型" }));
    expect((await screen.findByText(/已获取 2 个会员模型/)).textContent).toContain("已自动保存");
    expect(pending).toHaveLength(1); // 在途期不另起保存

    await act(async () => pending[0]!()); // 第一路存完 → 补存循环发现草稿变了
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1]!());

    const saves = calls.filter((c) => c.cmd === "save_config");
    expect(saves).toHaveLength(2);
    const names = (saves[1]!.args?.config as DesktopConfig).models.map((m) => m.name);
    expect(names.some((n) => n.startsWith("mem-b@"))).toBe(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: "保存" })).toBeNull()); // 保存条自行收起
  });

  it("有任务在跑:不自动保存(重启引擎会踹掉任务),提示原因并留保存条", async () => {
    const { calls } = stubShell({ extra: syncExtra() });
    render(<SettingsView onClose={() => {}} hasRunningTask />);
    await openModels();
    await syncMemberModels();
    expect((await screen.findByText(/已获取 1 个会员模型/)).textContent).toContain("有任务正在运行");
    expect(calls.some((c) => c.cmd === "save_config")).toBe(false);
    expect(screen.getByRole("button", { name: "保存" })).toBeDefined(); // 合并已入草稿,保存条兜底
  });

  it("脏表单:不自动保存(不捎带未确认的修改),提示原因", async () => {
    const { calls } = stubShell({ extra: syncExtra() });
    render(<SettingsView onClose={() => {}} />);
    await openModels();
    // 先弄脏表单
    await userEvent.click(screen.getByRole("button", { name: /主力/ }));
    const name = screen.getByRole("textbox", { name: "名称" });
    await userEvent.clear(name);
    await userEvent.type(name, "主力2");
    await syncMemberModels();
    expect((await screen.findByText(/已获取 1 个会员模型/)).textContent).toContain("未保存的修改");
    expect(calls.some((c) => c.cmd === "save_config")).toBe(false);
  });
});

describe("提示音双向同步", () => {
  it("初值来自 sound_enabled;切换发 set_sound_enabled;壳广播回来盖一次", async () => {
    const { calls, listeners } = stubShell({ sound: false });
    render(<SettingsView onClose={() => {}} />);
    // 初始分区是「账号」,先切到通用
    await userEvent.click(screen.getByRole("button", { name: "通用" }));
    const toggle = () => screen.getByRole("checkbox", { name: "事件提示音" }) as HTMLInputElement;
    await waitFor(() => expect(toggle().checked).toBe(false));

    await userEvent.click(toggle());
    expect(toggle().checked).toBe(true); // 乐观置位
    expect(calls.some((c) => c.cmd === "set_sound_enabled" && c.args?.enabled === true)).toBe(true);

    // 托盘那头把它关了:sound-enabled 广播驱动设置页跟上
    act(() => listeners["sound-enabled"]?.({ payload: false }));
    expect(toggle().checked).toBe(false);
  });
});

describe("运行环境(仅 Windows 壳)", () => {
  it("Windows:导航含「运行环境」,WSL 发行版进下拉,选择后走保存条", async () => {
    windowsUA();
    const { calls } = stubShell({ distros: ["Ubuntu"] });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "运行环境" }));
    const select = await screen.findByRole("combobox", { name: "内核运行环境" });
    expect(screen.getByRole("option", { name: "本机(Windows)" })).toBeDefined();
    await waitFor(() => expect(screen.getByRole("option", { name: "WSL · Ubuntu" })).toBeDefined());

    await userEvent.selectOptions(select, "wsl:Ubuntu");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(calls.some((c) => c.cmd === "save_config")).toBe(true));
    const payload = calls.find((c) => c.cmd === "save_config")?.args?.config as DesktopConfig;
    expect(payload.kernel_env).toBe("wsl:Ubuntu");
  });

  it("记忆的发行版已卸载:保留为「未检测到」选项,不静默改值", async () => {
    windowsUA();
    stubShell({ config: { ...baseConfig, kernel_env: "wsl:Gone" }, distros: ["Ubuntu"] });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "运行环境" }));
    const select = await screen.findByRole("combobox", { name: "内核运行环境" });
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("wsl:Gone"));
    expect(screen.getByRole("option", { name: /Gone.*未检测到/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: "保存" })).toBeNull(); // 载入不置脏
  });

  it("记忆的发行版已卸载:页面上出告警(引擎起不来,不能只在收起的下拉里缀一句)", async () => {
    windowsUA();
    stubShell({ config: { ...baseConfig, kernel_env: "wsl:Gone" }, distros: ["Ubuntu"] });
    render(<SettingsView onClose={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "运行环境" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("未检测到发行版 Gone");
    expect(alert.textContent).toContain("引擎将无法启动");

    // 切回本机后告警消失
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "内核运行环境" }), "");
    expect(screen.queryByText(/未检测到发行版/)).toBeNull();
  });
});

describe("布局契约", () => {
  it("左侧导航 menu 解除 daisyUI 的 column wrap(LAYOUT §6.2 截断铁律)", () => {
    stubShell();
    render(<SettingsView onClose={() => {}} />);
    // .menu 与 .menu li 都默认 flex-flow: column wrap,不解除的话行宽跟内容
    // 走,行内 truncate 链永不触发
    const menu = screen.getByRole("navigation", { name: "设置" }).querySelector("ul.menu")!;
    expect(menu.className).toContain("flex-nowrap");
    expect(menu.className).toContain("[&_li]:flex-nowrap");
  });
});
