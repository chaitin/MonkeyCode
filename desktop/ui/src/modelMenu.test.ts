import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterModels,
  sameModelName,
  stripSourceSuffix,
  groupMemberSections,
  memberCategory,
  modelDisplay,
  modelDisplayByName,
  modelMenuTabs,
  readLastTaskModel,
  rememberLastTaskModel,
  shouldShowModelExtras,
  stripTierPrefix,
} from "./modelMenu";
import { SOURCE_BAIZHI, SOURCE_MONKEYCODE, type ModelInfo } from "./types";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});

afterEach(() => vi.unstubAllGlobals());

const m = (name: string, source?: string, def = false): ModelInfo => ({ name, default: def, source });

describe("上次开任务模型的存取", () => {
  it("缺省为空串,可往返,空名不覆盖", () => {
    expect(readLastTaskModel()).toBe("");
    rememberLastTaskModel("会员模型");
    expect(readLastTaskModel()).toBe("会员模型");
    rememberLastTaskModel(""); // 空名不覆盖
    expect(readLastTaskModel()).toBe("会员模型");
  });
});

describe("会员长名的展示投影(对齐 Web 前缀口径,纯展示层)", () => {
  it("stripTierPrefix 只剥斜杠形前缀,剥空回落原名", () => {
    expect(stripTierPrefix("monkeycode-pro/deepseek-pro")).toBe("deepseek-pro");
    expect(stripTierPrefix("Monkeycode-Ultra/Claude-X")).toBe("Claude-X");
    // 连字符形整串可能就是真实模型 id,不剥
    expect(stripTierPrefix("monkeycode-pro-claude")).toBe("monkeycode-pro-claude");
    expect(stripTierPrefix("monkeycode-pro/")).toBe("monkeycode-pro/");
    expect(stripTierPrefix("some-other-model")).toBe("some-other-model");
  });

  it("modelDisplay:会员条目短名 + 档位(档位从底层 model 判);其余来源原样", () => {
    expect(
      modelDisplay({ name: "monkeycode-pro/deepseek-pro", model: "monkeycode-pro/deepseek-pro", source: SOURCE_MONKEYCODE }),
    ).toEqual({ label: "deepseek-pro", tier: "专业" });
    // remark 别名:短名 = remark,档位仍能从 model 判出
    expect(
      modelDisplay({ name: "深度求索", model: "monkeycode-ultra/ds", source: SOURCE_MONKEYCODE }),
    ).toEqual({ label: "深度求索", tier: "旗舰" });
    // 会员组里的服务端自定义模型:无前缀 → 原样、无档位
    expect(
      modelDisplay({ name: "some-other-model", model: "some-other-model", source: SOURCE_MONKEYCODE }),
    ).toEqual({ label: "some-other-model", tier: undefined });
    // 手工条目取了会员形状的名字:不投影(name 是引擎键,别误打会员档)
    expect(modelDisplay({ name: "monkeycode-pro/x" })).toEqual({ label: "monkeycode-pro/x" });
    // 下线模型兜底项没有 model 字段:容缺
    expect(modelDisplay({ name: "x", source: SOURCE_MONKEYCODE })).toEqual({ label: "x", tier: undefined });
  });

  it("modelDisplayByName:回查条目投影,查不到原样", () => {
    const models = [
      { name: "monkeycode-basic/glm", model: "monkeycode-basic/glm", source: SOURCE_MONKEYCODE, default: false },
    ];
    expect(modelDisplayByName(models, "monkeycode-basic/glm")).toEqual({ label: "glm", tier: "基础" });
    expect(modelDisplayByName(models, "已下线")).toEqual({ label: "已下线" });
  });
});

describe("modelMenuTabs(无「全部」,tab 即来源导航)", () => {
  it("来源序:会员 → 百智云 → 未知透传 → 自定义恒尾,会员缩写", () => {
    const tabs = modelMenuTabs([
      m("a"),
      m("b", "mystery"),
      m("c", SOURCE_BAIZHI),
      m("d", SOURCE_MONKEYCODE),
    ]);
    expect(tabs).toEqual([
      { key: "monkeycode", label: "会员" },
      { key: "baizhi", label: "百智云" },
      { key: "mystery", label: "mystery" }, // 未知来源透传,不硬编码三来源
      { key: "", label: "自定义" },
    ]);
  });

  it("单来源只剩一个 tab(渲染层按 length>=2 隐藏 tab 行)", () => {
    expect(modelMenuTabs([m("a"), m("b")])).toEqual([{ key: "", label: "自定义" }]);
  });
});

describe("filterModels(tab 内过滤)", () => {
  const items = [
    m("手工模型"),
    { ...m("深度求索", SOURCE_MONKEYCODE), model: "monkeycode-pro/deepseek-pro" },
  ];

  it("匹配 name 与底层 model 串(大小写不敏感);来源组名匹配随 tab 化作废", () => {
    expect(filterModels(items, "")).toBe(items); // 空过滤原样返回
    expect(filterModels(items, "手工")).toEqual([items[0]]);
    // remark 命名的会员条目可用 wire 名搜到
    expect(filterModels(items, "DEEPSEEK")).toEqual([items[1]]);
    // 行为变化:旧版按来源组名(如「百智」)能命中整组,tab 化后来源
    // 导航由 tab 承担,组名不再是匹配面
    expect(filterModels(items, "会员")).toEqual([]);
    expect(filterModels(items, "不存在")).toEqual([]);
  });
});

describe("同步条目落盘名的来源后缀(寻址用,展示一律剥掉)", () => {
  it("stripSourceSuffix 剥来源后缀与会员条目的 #配置 id;剥空回落原名", () => {
    expect(stripSourceSuffix("deepseek-v3@baizhi")).toBe("deepseek-v3");
    expect(stripSourceSuffix("深度求索@monkeycode#cfg-9")).toBe("深度求索");
    expect(stripSourceSuffix("深度求索@monkeycode")).toBe("深度求索");
    // 手工条目原样;名字里本来就有 @ 的、形似后缀的都不误伤
    expect(stripSourceSuffix("my@model")).toBe("my@model");
    expect(stripSourceSuffix("@baizhi")).toBe("@baizhi");
    expect(stripSourceSuffix("x@monkeycode-plus")).toBe("x@monkeycode-plus");
    // id 的字符集不归我们管,# 之后放行(与壳侧 strip_source_suffix 同口径)
    expect(stripSourceSuffix("深度求索@monkeycode#a@b")).toBe("深度求索");
  });

  it("sameModelName:带不带后缀算同一条(存量引用靠它落到新条目上)", () => {
    expect(sameModelName("深度求索", "深度求索@monkeycode#cfg-9")).toBe(true);
    expect(sameModelName("deepseek-v3@baizhi", "deepseek-v3")).toBe(true);
    expect(sameModelName("深度求索", "别的模型")).toBe(false);
  });

  it("modelDisplay 剥后缀后再剥档位前缀;filterModels 按展示名匹配", () => {
    expect(
      modelDisplay({ name: "monkeycode-pro/deepseek@monkeycode#c1", model: "monkeycode-pro/deepseek", source: SOURCE_MONKEYCODE }),
    ).toEqual({ label: "deepseek", tier: "专业" });
    const items = [{ ...m("深度求索@monkeycode#c1", SOURCE_MONKEYCODE), model: "mc-ds" }];
    expect(filterModels(items, "深度")).toEqual(items);
    expect(filterModels(items, "monkeycode")).toEqual([]); // 后缀不参与匹配
  });
});

describe("memberCategory(设置页药丸与分节共用的分类词汇)", () => {
  it("档位优先于 owner;公共非档位与旧同步条目都归付费", () => {
    expect(memberCategory({ model: "monkeycode-basic/b", owner: "public" })).toBe("基础");
    expect(memberCategory({ model: "monkeycode-pro/p", owner: "public" })).toBe("专业");
    expect(memberCategory({ model: "monkeycode-ultra/u", owner: "private" })).toBe("旗舰");
    expect(memberCategory({ model: "some-model", owner: "public" })).toBe("付费");
    expect(memberCategory({ model: "another-model" })).toBe("付费"); // 改造前同步的条目无 owner
    expect(memberCategory({ model: "my-model", owner: "private" })).toBe("我的");
    expect(memberCategory({ model: "team-model", owner: "team" })).toBe("团队");
  });
});

describe("groupMemberSections(会员 tab 分节,对齐 Web 分类)", () => {
  const ultra = { ...m("旗舰甲", SOURCE_MONKEYCODE), model: "monkeycode-ultra/a", owner: "public", locked: true };
  const basic = { ...m("基础乙", SOURCE_MONKEYCODE), model: "monkeycode-basic/b", owner: "public" };
  const paid = { ...m("付费丙", SOURCE_MONKEYCODE), model: "some-model", owner: "public" };
  const legacy = { ...m("旧同步丁", SOURCE_MONKEYCODE), model: "another-model" }; // 改造前同步的条目无 owner
  const mine = { ...m("私有戊", SOURCE_MONKEYCODE), model: "my-model", owner: "private" };
  const team = { ...m("团队己", SOURCE_MONKEYCODE), model: "team-model", owner: "team" };

  it("档位三节 → 付费 → 我的 → 团队;owner 缺失的旧条目归付费;空节剔除;items 保原引用", () => {
    const sections = groupMemberSections([team, legacy, ultra, mine, paid, basic]);
    expect(sections.map((s) => s.label)).toEqual(["基础模型", "旗舰模型", "付费模型", "我的模型", "团队模型"]);
    expect(sections.map((s) => s.badge)).toEqual(["免费使用", "旗舰会员免费", "消耗积分", undefined, undefined]);
    expect(sections[1].items[0]).toBe(ultra); // locked 条目原样保留在档位节内(渲染层做灰态)
    expect(sections[2].items.map((x) => x.name)).toEqual(["旧同步丁", "付费丙"]);
    expect(sections[3].items[0]).toBe(mine);
    expect(sections[4].items[0]).toBe(team);
  });

  it("只有档位模型时无付费/我的/团队节", () => {
    expect(groupMemberSections([basic]).map((s) => s.label)).toEqual(["基础模型"]);
  });
});

describe("shouldShowModelExtras", () => {
  it("超过 6 个模型才显示过滤框(tab 行不受它门控)", () => {
    expect(shouldShowModelExtras(6)).toBe(false);
    expect(shouldShowModelExtras(7)).toBe(true);
  });
});
