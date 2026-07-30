import { describe, expect, it } from "vitest";

import {
  dedupeModelsByName,
  mcpNameValidationError,
  modelsToConfig,
  replaceSourceGroup,
  sortModelsBySource,
  validateMcpNames,
} from "./settingsConfig";
import { SOURCE_BAIZHI, SOURCE_MONKEYCODE, type HostModel } from "./types";

describe("modelsToConfig", () => {
  it("persists only fields supported by the engine schema", () => {
    const legacy = {
      name: "  local  ",
      provider: "anthropic",
      base_url: "https://gateway.test",
      api_key: "secret",
      model: "model-1",
      context_window: 42,
      max_output: 32768,
      think: "high",
      vision: true,
      source: "baizhi",
      skip_tls_verify: true,
    } as HostModel & { skip_tls_verify: boolean };

    const [saved] = modelsToConfig([legacy], 0);

    expect(saved).toEqual({
      name: "local",
      provider: "anthropic",
      base_url: "https://gateway.test",
      api_key: "secret",
      model: "model-1",
      default: true,
      context_window: 42,
      max_output: 32768,
      think: "high",
      vision: true,
      source: "baizhi",
    });
    expect(saved).not.toHaveProperty("skip_tls_verify");
  });

  it("keeps member locked/owner marks across saves", () => {
    // 白名单漏掉这两个字段的话,任意一次保存都会把锁定条目静默变可选,
    // 物化时被注入凭据(展示专用条目失守)
    const lockedMember: HostModel = {
      name: "旗舰模型",
      provider: "anthropic",
      base_url: "",
      api_key: "",
      model: "monkeycode-ultra/x",
      source: SOURCE_MONKEYCODE,
      locked: true,
      owner: "public",
    };
    const [saved] = modelsToConfig([lockedMember], 0);
    expect(saved.locked).toBe(true);
    expect(saved.owner).toBe("public");
  });
});

describe("replaceSourceGroup", () => {
  const entry = (name: string, source?: string) => ({ name, source });

  it("replaces only the target source group and keeps other groups intact", () => {
    const cur = [entry("手工"), entry("bz-old", SOURCE_BAIZHI), entry("mc-old", SOURCE_MONKEYCODE)];
    // 同步 baizhi:mc 组与手工条目不动,旧 baizhi 条目被本次集合整组替换
    const afterBz = replaceSourceGroup(cur, [entry("bz-new", SOURCE_BAIZHI)], SOURCE_BAIZHI);
    expect(afterBz.map((m) => m.name)).toEqual(["手工", "mc-old", "bz-new"]);
    // 同步 monkeycode:baizhi 组与手工条目不动
    const afterMc = replaceSourceGroup(cur, [entry("mc-new", SOURCE_MONKEYCODE)], SOURCE_MONKEYCODE);
    expect(afterMc.map((m) => m.name)).toEqual(["手工", "bz-old", "mc-new"]);
  });

  it("跨组撞名先到先得:同名非本组条目保留,同步条目跳过(不静默换通道)", () => {
    const cur = [entry("撞名"), entry("百智撞名", SOURCE_BAIZHI)];
    // 会员同步:手工条目与百智条目对 monkeycode 组都算"非本组",同名让位
    const kept = replaceSourceGroup(
      cur,
      [entry("撞名", SOURCE_MONKEYCODE), entry("百智撞名", SOURCE_MONKEYCODE), entry("新条目", SOURCE_MONKEYCODE)],
      SOURCE_MONKEYCODE,
    );
    expect(kept.map((m) => [m.name, m.source])).toEqual([
      ["撞名", undefined],
      ["百智撞名", SOURCE_BAIZHI],
      ["新条目", SOURCE_MONKEYCODE],
    ]);
    // 百智云同步同规则:同名会员条目不被吸收归组——此前 keep=false 的吸收
    // 语义依据是"经逐条勾选确认",挑选面板删除、登录即自动同步后,吸收
    // 等于静默把会员代理通道换成网关直连(计费主体都变了),必须让位
    const bz = replaceSourceGroup(
      [entry("deepseek", SOURCE_MONKEYCODE)],
      [entry("deepseek", SOURCE_BAIZHI), entry("claude", SOURCE_BAIZHI)],
      SOURCE_BAIZHI,
    );
    expect(bz.map((m) => [m.name, m.source])).toEqual([
      ["deepseek", SOURCE_MONKEYCODE],
      ["claude", SOURCE_BAIZHI],
    ]);
  });

  it("removes stale synced entries when the new batch omits them", () => {
    const cur = [entry("a", SOURCE_MONKEYCODE), entry("b", SOURCE_MONKEYCODE)];
    const next = replaceSourceGroup(cur, [entry("a", SOURCE_MONKEYCODE)], SOURCE_MONKEYCODE);
    expect(next.map((m) => m.name)).toEqual(["a"]);
  });
});

describe("dedupeModelsByName(载入自愈)", () => {
  const entry = (name: string, source?: string) => ({ name, source });

  it("同名条目收敛为一条:内容后者覆盖前者,落在首现位置(与引擎物化 Map 一致)", () => {
    const out = dedupeModelsByName([
      entry("deepseek-v4-flash", SOURCE_MONKEYCODE),
      entry("其他"),
      entry("deepseek-v4-flash", SOURCE_BAIZHI),
    ]);
    expect(out.map((m) => [m.name, m.source])).toEqual([
      ["deepseek-v4-flash", SOURCE_BAIZHI], // 后者内容,首现位置
      ["其他", undefined],
    ]);
  });

  it("名称按 trim 归一;空名草稿全部保留不参与去重", () => {
    const out = dedupeModelsByName([entry(" a "), entry("a", SOURCE_BAIZHI), entry(""), entry("  ")]);
    expect(out.map((m) => [m.name, m.source])).toEqual([
      ["a", SOURCE_BAIZHI],
      ["", undefined],
      ["  ", undefined],
    ]);
  });

  it("无重复时原样返回(顺序与内容不动)", () => {
    const cur = [entry("a"), entry("b", SOURCE_BAIZHI)];
    expect(dedupeModelsByName(cur)).toEqual(cur);
  });
});

describe("sortModelsBySource(载入/同步后的分组排序)", () => {
  const entry = (name: string, source?: string) => ({ name, source });

  it("组间按 会员→百智云→未知→自定义,组内保持原相对顺序(稳定)", () => {
    const out = sortModelsBySource([
      entry("手工乙"),
      entry("bz-2", SOURCE_BAIZHI),
      entry("mc-2", SOURCE_MONKEYCODE),
      entry("神秘", "mystery"),
      entry("手工甲"),
      entry("bz-1", SOURCE_BAIZHI),
      entry("mc-1", SOURCE_MONKEYCODE),
    ]);
    expect(out.map((m) => m.name)).toEqual(["mc-2", "mc-1", "bz-2", "bz-1", "神秘", "手工乙", "手工甲"]);
  });

  it("空名草稿 source 缺省 → 随自定义组留在尾部,不丢", () => {
    const out = sortModelsBySource([entry(""), entry("mc", SOURCE_MONKEYCODE)]);
    expect(out.map((m) => m.name)).toEqual(["mc", ""]);
  });
});

describe("MCP name validation", () => {
  it("accepts only identifiers supported by OpenAI tool names", () => {
    expect(mcpNameValidationError("context7")).toBeNull();
    expect(mcpNameValidationError("mc-browser_2")).toBeNull();
    expect(mcpNameValidationError("  github  ")).toBeNull();
    expect(mcpNameValidationError("")).toBe("请输入 MCP 名称");
    expect(mcpNameValidationError("我的知识库")).toBe("仅支持英文字母、数字、_ 和 -");
    expect(mcpNameValidationError("my.server")).toBe("仅支持英文字母、数字、_ 和 -");
    expect(mcpNameValidationError("my server")).toBe("仅支持英文字母、数字、_ 和 -");
  });

  it("marks every duplicate after trimming", () => {
    expect(validateMcpNames([{ name: "github" }, { name: " github " }, { name: "context7" }])).toEqual([
      "MCP 名称重复: github",
      "MCP 名称重复: github",
      null,
    ]);
  });
});
