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

/** 模型条目的展示投影:短名 + 档位(基础/专业/旗舰)。**纯展示层**——
 * name 是引擎键/lastTaskModel 记忆键,onPick 仍必须用原始 name。
 * 只对会员来源生效(手工条目取名 monkeycode-pro-x 不该被误打会员档);
 * 档位与 Web 口径一致从底层 model 串判(name 可能是 remark 别名)。 */
export function modelDisplay(m: Pick<ModelInfo, "name" | "model" | "source">): {
  label: string;
  tier?: string;
} {
  if (m.source !== SOURCE_MONKEYCODE) return { label: m.name };
  return { label: stripTierPrefix(m.name), tier: builtinTierLabel(m.model) };
}

/** 触发器用:按 name 回查条目做展示投影;查不到(下线模型兜底项)原样。 */
export function modelDisplayByName(models: readonly ModelInfo[], name: string): {
  label: string;
  tier?: string;
} {
  const m = models.find((x) => x.name === name);
  return m ? modelDisplay(m) : { label: name };
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
  return items.filter(
    (m) => m.name.toLowerCase().includes(q) || (m.model || "").toLowerCase().includes(q),
  );
}

export interface MemberSection {
  label: string;
  badge?: string;
  items: ModelInfo[];
}

/** 会员 tab 分节(与 Web/groupCloudModels 同一分类词汇):档位三节 →
 * 付费(公共非档位;owner 缺失的旧同步条目也归这里——旧同步只收 public,
 * 语义正确)→ 我的(private)→ 团队(team,扁平单节)。徽标是资格说明;
 * 超档条目在档位节内以 locked 灰态出现。 */
const MEMBER_SECTION_DEFS: {
  label: string;
  badge?: string;
  match: (tier: string | undefined, owner: string | undefined) => boolean;
}[] = [
  { label: "基础模型", badge: "免费使用", match: (t) => t === "基础" },
  { label: "专业模型", badge: "专业会员免费", match: (t) => t === "专业" },
  { label: "旗舰模型", badge: "旗舰会员免费", match: (t) => t === "旗舰" },
  { label: "付费模型", badge: "消耗积分", match: (t, o) => !t && o !== "private" && o !== "team" },
  { label: "我的模型", match: (t, o) => !t && o === "private" },
  { label: "团队模型", match: (t, o) => !t && o === "team" },
];

export function groupMemberSections(items: ModelInfo[]): MemberSection[] {
  return MEMBER_SECTION_DEFS.map((d) => ({
    label: d.label,
    badge: d.badge,
    items: items.filter((m) => d.match(builtinTierLabel(m.model), m.owner)),
  })).filter((s) => s.items.length > 0);
}
