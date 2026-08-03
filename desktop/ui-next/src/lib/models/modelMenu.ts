// 模型选择菜单的纯逻辑与偏好存取(与渲染解耦,便于单测;移植旧 UI
// modelMenu.ts,类型适配 lib/ipc/sessions 的 ModelInfo):
// - mc.lastTaskModel:上次开任务用的模型(新建页预选,配置默认让位)。
// 展示词经 i18n 的模块级 t 在调用时求值(lib/cloud/options.ts 同款手法),
// locale 切换后重算即得新词。
// 约束:模块顶层不碰 localStorage,且只用 getItem/setItem(测试存储 stub
// 只有这两个方法)。
import { t } from "@/lib/i18n";
import type { ModelInfo } from "@/lib/ipc/sessions";

/** 同步条目来源标记(壳侧 baizhi/monkeycode.rs 的 SOURCE_* 同值)。 */
export const SOURCE_BAIZHI = "baizhi";
export const SOURCE_MONKEYCODE = "monkeycode";

const LAST_TASK_MODEL_KEY = "mc.lastTaskModel";
/** 模型少时过滤框是噪音(几乎复述整个菜单),超过该数才显示。 */
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

/** 底层模型串 → 会员档位短词(基础/专业/旗舰),判不出返回 undefined。
 * 与 Web getBuiltinModelName / lib/cloud/options.ts builtinName 同款前缀
 * 口径(那边面向云端建任务,词形是「基础模型」整词,不共用)。 */
export function builtinTierLabel(model?: string): string | undefined {
  const n = (model || "").toLowerCase();
  if (n.startsWith("monkeycode-basic")) return t("model.tier.basic");
  if (n.startsWith("monkeycode-pro")) return t("model.tier.pro");
  if (n.startsWith("monkeycode-ultra")) return t("model.tier.ultra");
  return undefined;
}

/** 会员档位序(ultra > pro > basic > 无档;与 builtinTierLabel 同一前缀
 * 口径):首次同步无默认模型时按它挑最高档,见 mergeSyncedModels。 */
export function memberTierRank(model?: string): number {
  const n = (model || "").toLowerCase();
  if (n.startsWith("monkeycode-ultra")) return 3;
  if (n.startsWith("monkeycode-pro")) return 2;
  if (n.startsWith("monkeycode-basic")) return 1;
  return 0;
}

/** 剥会员档位前缀(monkeycode-xxx/)得短名,剥空回落原名。Web
 * stripBuiltinPublicModelPackagePrefix 同款正则;remark 里写了前缀也一并剥。 */
export function stripTierPrefix(name: string): string {
  return name.replace(/^monkeycode-[^/]+\//i, "") || name;
}

/** 同步条目的落盘名带来源后缀(它只是引擎寻址键的一部分,**任何展示面
 * 都必须剥掉**)。剥空回落原名。会员条目的后缀还带 `#<服务端配置 id>`
 * (同来源内重名靠它区分)。 */
// `#` 之后放行任意字符:服务端配置 id 的字符集不归我们管(壳侧
// driver/session.rs strip_source_suffix 与 protocol/reduce.ts 的系统行
// 展示同款口径,几处必须一致)
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

/** 存量模型名 → 清单里的**实际条目名**。精确优先,没中再按宽松口径找一次
 * (剥来源后缀),都没中原样返回。
 *
 * 为什么必须有这一步:`@monkeycode#<配置 id>` 后缀是后加的,升级后第一次同步
 * 会重命名所有同步条目。于是三处存量引用记的都是**加后缀之前的裸名**——升级前
 * 建的会话(meta.model)、mc.lastTaskModel、加后缀前落盘的 default。壳侧
 * driver/session.rs 有同款宽松兜底所以会话照常打开,只有 UI 对不上:严格
 * `m.name === current` 的话下拉里一项都选不中、来源 tab 也算成空串默认停在
 * 「自定义」,用户在会员 tab 里翻半天找不到自己正在用的那条;同一原因下
 * `modelThink` 查不到,思考档触发器回落「低」——那是个直接给错的读数。 */
export function resolveModelName(models: readonly ModelInfo[], name: string): string {
  if (!name) return name;
  if (models.some((m) => m.name === name)) return name;
  return models.find((m) => sameModelName(m.name, name))?.name ?? name;
}

/** 模型菜单清单:当前模型已从配置里下线(改名/删除)时补一条兜底项,
 * 否则下拉里一项都选不中(旧 UI appView.ts::modelMenuList 原注:
 * 「否则下拉里选不中当前模型」)。兜底项无 source,归「自定义」组。 */
export function modelMenuList(models: readonly ModelInfo[], current: string): ModelInfo[] {
  const known = current && models.some((m) => m.name === current || sameModelName(m.name, current));
  return known || !current ? [...models] : [...models, { name: current, default: false }];
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
 * 原词透传)。key 用 source 原值(自定义是空串——消费方判活跃 tab 时
 * 注意别用 `??` 把空串吞了)。 */
export function modelMenuTabs(models: ModelInfo[]): ModelMenuTab[] {
  const tabs: (ModelMenuTab & { rank: number })[] = [];
  for (const m of models) {
    const key = m.source || "";
    if (tabs.some((tab) => tab.key === key)) continue;
    const label =
      m.source === SOURCE_MONKEYCODE
        ? t("model.source.member")
        : m.source === SOURCE_BAIZHI
          ? t("model.source.baizhi")
          : m.source || t("model.source.custom");
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
  return m.owner === "private" ? t("model.cat.mine") : m.owner === "team" ? t("model.cat.team") : t("model.cat.paid");
}

/** 会员 tab 分节:节序即 memberCategory 的分类序。徽标是资格说明;超档
 * 条目在档位节内以 locked 灰态出现。节定义在调用时求值(词随 locale)。 */
export function groupMemberSections(items: ModelInfo[]): MemberSection[] {
  const defs: { cat: string; badge?: string }[] = [
    { cat: t("model.tier.basic"), badge: t("model.badge.basic") },
    { cat: t("model.tier.pro"), badge: t("model.badge.pro") },
    { cat: t("model.tier.ultra"), badge: t("model.badge.ultra") },
    { cat: t("model.cat.paid"), badge: t("model.badge.paid") },
    { cat: t("model.cat.mine") },
    { cat: t("model.cat.team") },
  ];
  return defs
    .map((d) => ({
      label: t("model.section.title", { cat: d.cat }),
      badge: d.badge,
      items: items.filter((m) => memberCategory(m) === d.cat),
    }))
    .filter((s) => s.items.length > 0);
}
