// 模型选择菜单的纯逻辑与偏好存取(与渲染解耦,便于单测):
// - mc.lastTaskModel:上次开任务用的模型(新建页预选,配置默认让位)。
// 约束:模块顶层不碰 localStorage,且只用 getItem/setItem——静态渲染
// 测试(navigation.test/modelPicker.test)的存储 stub 只有这两个方法。
//(旧的 mc.recentModels「最近使用」已整体移除;残留的存储键无害不清理。)
import { builtinTierLabel } from "./cloud";
import { modelSourceLabel, SOURCE_BAIZHI, SOURCE_MONKEYCODE, type ModelInfo } from "./types";

const LAST_TASK_MODEL_KEY = "mc.lastTaskModel";
/** 模型少时过滤框/来源 tab 都是噪音(几乎复述整个菜单),超过该数才显示。 */
const MODEL_MENU_EXTRAS_THRESHOLD = 6;

export function shouldShowModelExtras(count: number): boolean {
  return count > MODEL_MENU_EXTRAS_THRESHOLD;
}

/** 上次开任务用的模型(""=没记过)。是否仍可用由调用方对着当下的模型
 * 列表校验——models 是异步到达的 props,校验必须放在派生处而不是这里。 */
export function readLastTaskModel(): string {
  try {
    return localStorage.getItem(LAST_TASK_MODEL_KEY) || "";
  } catch {
    return "";
  }
}

export function rememberLastTaskModel(name: string): void {
  if (!name) return;
  try {
    localStorage.setItem(LAST_TASK_MODEL_KEY, name);
  } catch {
    // 同上,静默。
  }
}

/** 剥会员档位前缀(monkeycode-xxx/)得短名,剥空回落原名。Web
 * stripBuiltinPublicModelPackagePrefix 同款正则;remark 里写了前缀也一并剥。 */
export function stripTierPrefix(name: string): string {
  return name.replace(/^monkeycode-[^/]+\//i, "") || name;
}

/** 同步条目的落盘名带来源后缀(为什么加见 settingsConfig.syncedName),
 * 它只是引擎寻址键的一部分,**任何展示面都必须剥掉**。剥空回落原名。
 * 会员条目的后缀还带 `#<服务端配置 id>`(同来源内重名靠它区分)。 */
// `#` 之后放行任意字符:服务端配置 id 的字符集不归我们管(壳侧
// driver/session.rs strip_source_suffix 同款口径,两处必须一致)
const SOURCE_SUFFIX_RE = new RegExp(`@(?:${SOURCE_BAIZHI}|${SOURCE_MONKEYCODE})(?:#.*)?$`, "i");
export function stripSourceSuffix(name: string): string {
  return name.replace(SOURCE_SUFFIX_RE, "") || name;
}

/** 名字比较的宽松口径:带不带来源后缀都算同一条。存量引用(旧会话记的
 * 模型名、lastTaskModel、加后缀前落盘的 default)靠它平滑落到新条目上。 */
export function sameModelName(a: string, b: string): boolean {
  const norm = (s: string) => stripSourceSuffix(s.trim()).toLocaleLowerCase();
  return norm(a) === norm(b);
}

/** 模型条目的展示投影:短名 + 档位(基础/专业/旗舰)。**纯展示层**——
 * name 是引擎键/lastTaskModel 记忆键,onPick 仍必须用原始 name。
 * 只对会员来源生效(手工条目取名 monkeycode-pro-x 不该被误打会员档);
 * 档位与 Web 口径一致从底层 model 串判(name 可能是 remark 别名)。 */
export function modelDisplay(m: Pick<ModelInfo, "name" | "model" | "source">): {
  label: string;
  tier?: string;
} {
  const short = stripSourceSuffix(m.name);
  if (m.source !== SOURCE_MONKEYCODE) return { label: short };
  return { label: stripTierPrefix(short), tier: builtinTierLabel(m.model) };
}

/** 触发器用:按 name 回查条目做展示投影;查不到(下线模型兜底项)原样。
 * 精确没中再按宽松口径找一次——存量引用记的是加后缀之前的裸名。 */
export function modelDisplayByName(models: readonly ModelInfo[], name: string): {
  label: string;
  tier?: string;
} {
  const m = models.find((x) => x.name === name) ?? models.find((x) => sameModelName(x.name, name));
  return m ? modelDisplay(m) : { label: stripSourceSuffix(name) };
}

/** 来源固定优先级(tab 序与设置页分组排序的单一出处):会员 → 百智云 →
 * 未知来源(彼此按首现)→ 自定义恒尾。 */
export const modelSourceRank = (source?: string): number =>
  source === SOURCE_MONKEYCODE ? 0 : source === SOURCE_BAIZHI ? 1 : source ? 2 : 3;

export interface ModelMenuTab {
  key: string;
  label: string;
}

/** 来源 tab(无「全部」,tab 即全部导航;会员缩写为「会员」,未知来源
 * 沿用 modelSourceLabel 的透传)。key 用 source 原值(自定义是空串——
 * 消费方判活跃 tab 时注意别用 `??` 把空串吞了)。 */
export function modelMenuTabs(models: ModelInfo[]): ModelMenuTab[] {
  const tabs: (ModelMenuTab & { rank: number })[] = [];
  for (const m of models) {
    const key = m.source || "";
    if (tabs.some((t) => t.key === key)) continue;
    const label = m.source === SOURCE_MONKEYCODE ? "会员" : modelSourceLabel(m.source);
    tabs.push({ key, label, rank: modelSourceRank(m.source) });
  }
  tabs.sort((a, b) => a.rank - b.rank);
  return tabs.map(({ key, label }) => ({ key, label }));
}

/** tab 内过滤:name + 底层 model 串(remark 命名的会员条目可用 wire 名
 * 搜到),大小写不敏感。来源组名匹配随 tab 化作废——来源导航由 tab 承担。 */
export function filterModels(items: ModelInfo[], filter: string): ModelInfo[] {
  const q = filter.trim().toLowerCase();
  if (!q) return items;
  // 按展示名匹配:落盘名尾巴上的 @来源#id 是寻址用的,搜「monkeycode」
  // 不该把整组会员模型都捞出来
  return items.filter(
    (m) => stripSourceSuffix(m.name).toLowerCase().includes(q) || (m.model || "").toLowerCase().includes(q),
  );
}

export interface MemberSection {
  label: string;
  badge?: string;
  items: ModelInfo[];
}

/** 会员条目的分类词汇(与 Web/groupCloudModels 同一套,选择器分节与设置页
 * 药丸共用这一处口径):档位三档(基础/专业/旗舰)→ 付费(公共非档位;
 * owner 缺失的旧同步条目也归这里——旧同步只收 public,语义正确)→ 我的
 * (private)→ 团队(team)。 */
export function memberCategory(m: Pick<ModelInfo, "model" | "owner">): string {
  const tier = builtinTierLabel(m.model);
  if (tier) return tier;
  return m.owner === "private" ? "我的" : m.owner === "team" ? "团队" : "付费";
}

/** 会员 tab 分节:节序即上面的分类序。徽标是资格说明;超档条目在档位节内
 * 以 locked 灰态出现。 */
const MEMBER_SECTION_DEFS: { cat: string; badge?: string }[] = [
  { cat: "基础", badge: "免费使用" },
  { cat: "专业", badge: "专业会员免费" },
  { cat: "旗舰", badge: "旗舰会员免费" },
  { cat: "付费", badge: "消耗积分" },
  { cat: "我的" },
  { cat: "团队" },
];

export function groupMemberSections(items: ModelInfo[]): MemberSection[] {
  return MEMBER_SECTION_DEFS.map((d) => ({
    label: `${d.cat}模型`,
    badge: d.badge,
    items: items.filter((m) => memberCategory(m) === d.cat),
  })).filter((s) => s.items.length > 0);
}
