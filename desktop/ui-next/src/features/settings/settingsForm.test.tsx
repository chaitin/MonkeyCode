// settingsForm 纯逻辑测试。后缀 .tsx 是 vitest project 的约束:unit 工程只
// 收 src/{lib,gen,app} 下的 .test.ts,features 下的测试统一走 dom 工程
// (include: src/**/*.test.tsx)——纯函数在 jsdom 里跑同样成立。
import { describe, expect, it } from "vitest";

import type { BaizhiSyncedModel } from "@/lib/ipc/account";
import type { DesktopConfig } from "@/lib/ipc/config";
import {
  buildPayload,
  dedupeModelsByName,
  draftFromConfig,
  mcpsToServers,
  mergeSyncedMcps,
  mergeSyncedModels,
  parseKV,
  payloadEquals,
  serversToMcps,
  validateDraft,
  type McpEntry,
  type SettingsDraft,
} from "./settingsForm";

const model = (over: Partial<import("@/lib/ipc/config").HostModel> = {}) => ({
  name: "m1",
  provider: "anthropic",
  base_url: "https://a",
  api_key: "sk",
  model: "claude",
  ...over,
});

const mcp = (over: Partial<McpEntry> = {}): McpEntry => ({
  name: "fetch",
  type: "http",
  url: "https://mcp",
  command: "",
  args: "",
  kv: "",
  ...over,
});

const cfg = (over: Partial<DesktopConfig> = {}): DesktopConfig => ({
  models: [model({ default: true }), model({ name: "m2", model: "gpt" })],
  mcp_servers: { fetch: { url: "https://mcp" } },
  kernel_env: "",
  mc_base_url: "https://mc.example",
  ...over,
});

describe("MCP 表单 ⇄ mcpServers 序列化", () => {
  it("parseKV:跳过无 = 行与空键,值 trim;全空返回 undefined", () => {
    expect(parseKV("A=1\nB = 2 \n无效行\n=x\n")).toEqual({ A: "1", B: "2" });
    expect(parseKV("")).toBeUndefined();
  });

  it("http/stdio 往返:表单外字段(disabled 等)经 extra 原样透传", () => {
    const servers = {
      web: { url: "https://x", headers: { Authorization: "Bearer t" }, disabled: true, source: "baizhi" },
      files: { command: "npx", args: ["-y", "server"], env: { HOME: "/h" } },
    };
    const entries = serversToMcps(servers);
    expect(entries).toEqual([
      {
        name: "web",
        type: "http",
        url: "https://x",
        command: "",
        args: "",
        kv: "Authorization=Bearer t",
        source: "baizhi",
        extra: { disabled: true },
      },
      { name: "files", type: "stdio", url: "", command: "npx", args: "-y server", kv: "HOME=/h", source: undefined, extra: undefined },
    ]);
    expect(mcpsToServers(entries)).toEqual({
      web: { disabled: true, url: "https://x", headers: { Authorization: "Bearer t" }, source: "baizhi" },
      files: { command: "npx", args: ["-y", "server"], env: { HOME: "/h" } },
    });
  });

  it("序列化跳过:空名、http 缺 URL、stdio 缺命令", () => {
    expect(
      mcpsToServers([
        mcp({ name: "" }),
        mcp({ name: "nourl", url: "" }),
        mcp({ name: "nocmd", type: "stdio", url: "", command: "" }),
        mcp({ name: "ok" }),
      ]),
    ).toEqual({ ok: { url: "https://mcp", headers: undefined } });
  });
});

describe("草稿 ⇄ 载荷(全量写回)", () => {
  it("draftFromConfig:default 定位到行下标,无默认回落 0", () => {
    expect(draftFromConfig(cfg()).defaultIdx).toBe(0);
    expect(draftFromConfig(cfg({ models: [model(), model({ name: "m2", default: true })] })).defaultIdx).toBe(1);
    expect(draftFromConfig(cfg({ models: [model()] })).defaultIdx).toBe(0);
  });

  it("跳过证书验证开关:载入缺省为关,草稿值随载荷写回", () => {
    expect(draftFromConfig(cfg()).mcSkipTlsVerify).toBe(false);
    expect(draftFromConfig(cfg({ mc_skip_tls_verify: true })).mcSkipTlsVerify).toBe(true);
    const base = cfg();
    const d = { ...draftFromConfig(base), mcSkipTlsVerify: true };
    expect(buildPayload(base, d).mc_skip_tls_verify).toBe(true);
    expect(buildPayload(base, draftFromConfig(base)).mc_skip_tls_verify).toBe(false);
  });

  // 载入自愈:同名存量不在载入时收敛,validateDraft 会以 modelDup 把**整份
  // 配置**的保存永久拦死(save() 见错即 return,kernel_env/MCP/新模型一起存
  // 不下去);同名的会员条目在 UI 里连删除入口都没有,用户无路可走
  it("dedupeModelsByName:同名收敛为一条(后者内容胜出、留在首现位置),空名不动", () => {
    expect(
      dedupeModelsByName([
        { name: "Claude", tag: "老" },
        { name: "别的", tag: "x" },
        { name: " Claude ", tag: "新" },
        { name: "", tag: "空1" },
        { name: "", tag: "空2" },
      ]),
    ).toEqual([
      { name: " Claude ", tag: "新" }, // 首现位置 + 后者内容
      { name: "别的", tag: "x" },
      { name: "", tag: "空1" },
      { name: "", tag: "空2" },
    ]);
  });

  it("draftFromConfig 载入即收敛同名:校验放行(否则保存被 modelDup 永久拦死)", () => {
    const base = cfg({
      models: [
        model({ name: "Claude", model: "old", default: true }),
        model({ name: "Claude", model: "new", source: "monkeycode", locked: true }),
      ],
    });
    const draft = draftFromConfig(base);
    expect(draft.models).toHaveLength(1);
    expect(draft.models[0]).toMatchObject({ name: "Claude", model: "new", source: "monkeycode" });
    expect(validateDraft(draft)).toBeNull();
    // 默认位在归一后的数组上定位:被折叠掉的那条带着 default,不能指到界外
    expect(draft.defaultIdx).toBe(0);
    // 保存载荷落的是收敛后的一条(与引擎按名字建 Map 的物化行为一致)
    expect(buildPayload(base, draft).models.map((m) => m.name)).toEqual(["Claude"]);
    // 基线同样出自 draftFromConfig:载入自愈不把表单弄脏(不逼用户先点保存)
    expect(payloadEquals(buildPayload(base, draft), buildPayload(base, draftFromConfig(base)))).toBe(true);
  });

  it("buildPayload:白名单收敛(未知字段不透传)、default 重算、表单外顶层字段透传", () => {
    const base = cfg({ models: [{ ...model(), legacy_flag: true } as never] });
    const draft = draftFromConfig(base);
    draft.defaultIdx = 0;
    const payload = buildPayload(base, draft);
    expect(payload.models).toEqual([
      {
        name: "m1",
        provider: "anthropic",
        base_url: "https://a",
        api_key: "sk",
        model: "claude",
        default: true,
        context_window: undefined,
        max_output: undefined,
        think: undefined,
        vision: undefined,
        source: undefined,
        locked: undefined,
        owner: undefined,
      },
    ]);
    expect("legacy_flag" in (payload.models[0] as object)).toBe(false);
    expect(payload.mc_base_url).toBe("https://mc.example"); // 表单外字段原样透传
    expect(payload.kernel_env).toBe("");
  });

  it("锁定/同步标记(source/locked/owner)与高级字段随保存透传", () => {
    const base = cfg({
      models: [model({ source: "monkeycode", locked: true, owner: "team", context_window: 128000, think: "high" })],
    });
    const payload = buildPayload(base, draftFromConfig(base));
    expect(payload.models[0]).toMatchObject({
      source: "monkeycode",
      locked: true,
      owner: "team",
      context_window: 128000,
      think: "high",
    });
  });

  it("全空模型草稿行不进载荷(加了行没填 = 没加,不置脏)", () => {
    const base = cfg();
    const draft = draftFromConfig(base);
    draft.models.push({ name: "", provider: "anthropic", base_url: "", api_key: "", model: "" });
    expect(payloadEquals(buildPayload(base, draft), buildPayload(base, draftFromConfig(base)))).toBe(true);
  });

  it("脏判定:名称/kernel_env/MCP 任一改动即不等,还原后复等", () => {
    const base = cfg();
    const baseline = buildPayload(base, draftFromConfig(base));
    const d1 = draftFromConfig(base);
    d1.models = d1.models.map((m, i) => (i === 0 ? { ...m, name: "改名" } : m));
    expect(payloadEquals(buildPayload(base, d1), baseline)).toBe(false);

    const d2 = draftFromConfig(base);
    d2.kernelEnv = "wsl:Ubuntu";
    expect(payloadEquals(buildPayload(base, d2), baseline)).toBe(false);

    const d3 = draftFromConfig(base);
    d3.mcps = [...d3.mcps, mcp({ name: "extra" })];
    expect(payloadEquals(buildPayload(base, d3), baseline)).toBe(false);

    expect(payloadEquals(buildPayload(base, draftFromConfig(base)), baseline)).toBe(true);
  });
});

describe("validateDraft(保存前拦截,首错即返)", () => {
  const draftWith = (over: Partial<ReturnType<typeof draftFromConfig>>) => ({
    ...draftFromConfig(cfg()),
    ...over,
  });

  it("合法草稿通过;全空行不参与校验", () => {
    expect(validateDraft(draftFromConfig(cfg()))).toBeNull();
    expect(
      validateDraft(draftWith({ models: [model(), { name: "", provider: "anthropic", base_url: "", api_key: "", model: "" }] })),
    ).toBeNull();
  });

  it("模型:有内容无名 → modelName;重名 → modelDup", () => {
    expect(validateDraft(draftWith({ models: [model({ name: "" })] }))).toEqual({ kind: "modelName" });
    expect(validateDraft(draftWith({ models: [model(), model({ name: " m1 " })] }))).toEqual({
      kind: "modelDup",
      name: "m1",
    });
  });

  it("模型:最大输出与上下文窗口的比例不校验(用户定案:越界交服务端报)", () => {
    // 旧 UI 曾拦 max_output ≥ 窗口 10%;产品默认自己就越界(200k 配 32768),
    // 主流模型的真实输出上限同样越界,拦下的是整次保存 → 一律放行
    expect(validateDraft(draftWith({ models: [model({ context_window: 100000, max_output: 32768 })] }))).toBeNull();
    expect(validateDraft(draftWith({ models: [model({ max_output: 64000 })] }))).toBeNull();
  });

  it("MCP:非法字符 → mcpName;重名 → mcpDup;有名缺 URL/命令 → mcpIncomplete", () => {
    expect(validateDraft(draftWith({ mcps: [mcp({ name: "带 空格" })] }))).toEqual({ kind: "mcpName", name: "带 空格" });
    expect(validateDraft(draftWith({ mcps: [mcp(), mcp()] }))).toEqual({ kind: "mcpDup", name: "fetch" });
    expect(validateDraft(draftWith({ mcps: [mcp({ url: "" })] }))).toEqual({ kind: "mcpIncomplete", name: "fetch" });
    expect(validateDraft(draftWith({ mcps: [mcp({ type: "stdio", url: "", command: "" })] }))).toEqual({
      kind: "mcpIncomplete",
      name: "fetch",
    });
  });
});

describe("同步并入(mergeSyncedModels / mergeSyncedMcps)", () => {
  const synced = (over: Partial<BaizhiSyncedModel> = {}): BaizhiSyncedModel => ({
    name: "glm-5",
    provider: "openai",
    base_url: "https://gw",
    api_key: "k",
    model: "glm-5",
    source: "baizhi",
    ...over,
  });
  const draft = (models: ReturnType<typeof model>[], defaultIdx = 0): SettingsDraft => ({
    models,
    defaultIdx,
    mcps: [],
    kernelEnv: "",
    mcBaseUrl: "",
    mcBasicAuth: "",
    mcLlmBaseUrl: "",
    mcSkipTlsVerify: false,
  });

  it("落盘名加来源后缀(会员条目再缀配置 id);整组替换并按来源排序", () => {
    const d = draft([model({ name: "手工" })]);
    const r = mergeSyncedModels(
      d,
      [
        synced({ name: "glm-5" }),
        synced({ name: "旗舰", source: "monkeycode", id: "c1" }),
      ],
      "baizhi",
    );
    // 本次按 baizhi 组并入:monkeycode 条目也带后缀落名(以自身 source 计)
    expect(r!.draft.models.map((m) => m.name)).toContain("glm-5@baizhi");
    // 排序:同步组在前,手工条目恒尾
    expect(r!.draft.models.at(-1)?.name).toBe("手工");
    expect(r!.skipped).toEqual([]);
  });

  it("跨组撞名先到先得:后来者跳过并回报展示名", () => {
    const d = draft([model({ name: "glm-5@baizhi", source: "monkeycode" })]);
    const r = mergeSyncedModels(d, [synced()], "baizhi");
    expect(r!.skipped).toEqual(["glm-5"]);
    // 原（他组）条目保留,后来者未进列表(仍只有一条该名)
    expect(r!.draft.models.filter((m) => m.name === "glm-5@baizhi")).toHaveLength(1);
    expect(r!.draft.models[0]?.source).toBe("monkeycode");
  });

  it("默认模型按名字重定位;原默认被移除/变锁定则落首个未锁条目", () => {
    const d = draft(
      [
        model({ name: "old@baizhi", source: "baizhi" }),
        model({ name: "手工" }),
      ],
      0, // 默认 = old@baizhi(重同步后下架)
    );
    const r = mergeSyncedModels(d, [synced({ name: "new", locked: true }), synced({ name: "new2" })], "baizhi");
    const next = r!.draft;
    // old 下架,首个未锁条目接任默认(锁定条目不物化,不能当默认)
    expect(next.models[next.defaultIdx]?.name).toBe("new2@baizhi");
  });

  it("首次同步无默认模型:落会员可用最高档位的第一条(用户定案 2026-08-06)", () => {
    // 空表首登:同步回 基础×2 + 专业 + 旗舰(锁定,超出会员档)
    const r = mergeSyncedModels(
      draft([]),
      [
        synced({ name: "b1", source: "monkeycode", id: "1", model: "monkeycode-basic/m1" }),
        synced({ name: "b2", source: "monkeycode", id: "2", model: "monkeycode-basic/m2" }),
        synced({ name: "p1", source: "monkeycode", id: "3", model: "monkeycode-pro/m3" }),
        synced({ name: "u1", source: "monkeycode", id: "4", model: "monkeycode-ultra/m4", locked: true }),
      ],
      "monkeycode",
    );
    const next = r!.draft;
    // 锁定的 ultra 不可当默认;可用最高档 = pro,取其第一条(不是列表首条 basic)
    expect(next.models[next.defaultIdx]?.name).toBe("p1@monkeycode#3");
  });

  it("会员组同步接管默认:百智云先落地占的默认让位给会员最高档(扫码登录两路同步)", () => {
    // 扫码登录时序:百智云同步先并入并挑走默认,会员模型随后到
    const afterBaizhi = draft([model({ name: "glm-5@baizhi", source: "baizhi" }), model({ name: "手工" })], 0);
    const r = mergeSyncedModels(
      afterBaizhi,
      [
        synced({ name: "b1", source: "monkeycode", id: "1", model: "monkeycode-basic/m1" }),
        synced({ name: "p1", source: "monkeycode", id: "2", model: "monkeycode-pro/m3" }),
        synced({ name: "u1", source: "monkeycode", id: "3", model: "monkeycode-ultra/m4", locked: true }),
      ],
      "monkeycode",
    );
    const next = r!.draft;
    expect(next.models[next.defaultIdx]?.name).toBe("p1@monkeycode#2");
  });

  it("会员组同步不抢手工条目的默认(用户自己配的是明确选择);已是会员默认也不动", () => {
    const custom = draft([model({ name: "手工" }), model({ name: "old@baizhi", source: "baizhi" })], 0);
    const r1 = mergeSyncedModels(
      custom,
      [synced({ name: "u1", source: "monkeycode", id: "1", model: "monkeycode-ultra/m" })],
      "monkeycode",
    );
    expect(r1!.draft.models[r1!.draft.defaultIdx]?.name).toBe("手工");

    // 默认已是会员基础档:重同步不擅自跳到 ultra(用户可能就想用便宜的)
    const onMember = draft([model({ name: "b1@monkeycode#1", source: "monkeycode", model: "monkeycode-basic/m1" })], 0);
    const r2 = mergeSyncedModels(
      onMember,
      [
        synced({ name: "b1", source: "monkeycode", id: "1", model: "monkeycode-basic/m1" }),
        synced({ name: "u1", source: "monkeycode", id: "2", model: "monkeycode-ultra/m4" }),
      ],
      "monkeycode",
    );
    expect(r2!.draft.models[r2!.draft.defaultIdx]?.name).toBe("b1@monkeycode#1");
  });

  it("百智云组同步不接管默认(接管只在会员组落地时发生)", () => {
    const onMember = draft([model({ name: "u1@monkeycode#1", source: "monkeycode", model: "monkeycode-ultra/m" })], 0);
    const r = mergeSyncedModels(onMember, [synced({ name: "glm-5" })], "baizhi");
    expect(r!.draft.models[r!.draft.defaultIdx]?.name).toBe("u1@monkeycode#1");
  });

  it("空集合不清组;MCP 空集不触碰,非空整组替换(手工条目保留)", () => {
    const d0 = draft([model({ name: "a@baizhi", source: "baizhi" })]);
    expect(mergeSyncedModels(d0, [], "baizhi")).toBeNull();
    const withMcp: SettingsDraft = { ...d0, mcps: [mcp({ name: "mine" }), mcp({ name: "old", source: "baizhi" })] };
    expect(mergeSyncedMcps(withMcp, {}).mcps.map((m) => m.name)).toEqual(["mine", "old"]);
    const merged = mergeSyncedMcps(withMcp, { toolkit: { url: "https://x", source: "baizhi" } });
    expect(merged.mcps.map((m) => m.name).sort()).toEqual(["mine", "toolkit"]);
  });
});
