import type { Image, Model, Skill } from '@/api/types';

/** 默认技能 ID（与 Web 端 src/utils/config.tsx 一致），始终勾选、不可取消。 */
export const DEFAULT_SKILL_IDS = [
  'MonkeyCodeOfficialPlugins/main/skills/feature-design',
  'MonkeyCodeOfficialPlugins/main/skills/project-wiki',
  'MonkeyCodeOfficialPlugins/main/skills/feature-implementer',
  'MonkeyCodeOfficialPlugins/main/skills/implementation-planner',
];

const BUILTIN_META = new Set(['monkeycode-basic', 'monkeycode-pro', 'monkeycode-ultra']);

function builtinName(model?: string): 'monkeycode-basic' | 'monkeycode-pro' | 'monkeycode-ultra' | undefined {
  const n = (model || '').toLowerCase();
  if (n.startsWith('monkeycode-basic')) return 'monkeycode-basic';
  if (n.startsWith('monkeycode-pro')) return 'monkeycode-pro';
  if (n.startsWith('monkeycode-ultra')) return 'monkeycode-ultra';
  return undefined;
}

/**
 * 把字符串中出现的内置模型名替换为中文（基础/专业/旗舰模型），用于 remark 等任意文本。
 * 同时把斜杠规范为「 / 」（左右各一个半角空格），与「旗舰模型 / xxx」风格一致。
 */
export function translateBuiltinNames(text: string): string {
  return text
    .replace(/monkeycode-ultra/gi, '旗舰模型')
    .replace(/monkeycode-pro/gi, '专业模型')
    .replace(/monkeycode-basic/gi, '基础模型')
    .replace(/\s*\/\s*/g, ' / ');
}

/**
 * 模型展示名（对齐 Web getModelDisplayName）。
 * 内置名翻译为「基础/专业/旗舰模型」，嵌套子模型用「/」拼接。
 * 同时是 `modelDisplayName` 的底层实现，确保信息条与选择器展示一致。
 */
export function modelLabel(model?: { model?: string; remark?: string } | null): string {
  if (!model) return '';
  // 优先展示备注名（remark）；其中若含内置模型名也一并翻译
  const remark = model.remark?.trim();
  if (remark) return translateBuiltinNames(remark);
  // 无备注则按内置名翻译为「基础/专业/旗舰模型」
  const name = (model.model || '').toLowerCase();
  if (name.startsWith('monkeycode-basic')) {
    const nested = (model.model || '').slice('monkeycode-basic'.length).replace(/^\/+/, '');
    return nested ? `基础模型 / ${nested}` : '基础模型';
  }
  if (name.startsWith('monkeycode-pro')) {
    const nested = (model.model || '').slice('monkeycode-pro'.length).replace(/^\/+/, '');
    return nested ? `专业模型 / ${nested}` : '专业模型';
  }
  if (name.startsWith('monkeycode-ultra')) {
    const nested = (model.model || '').slice('monkeycode-ultra'.length).replace(/^\/+/, '');
    return nested ? `旗舰模型 / ${nested}` : '旗舰模型';
  }
  return translateBuiltinNames(model.model || '');
}

/** 可选模型：有 id、非裸内置占位项、且未隐藏(is_hidden)。 */
export function usableModels(models: Model[]): Model[] {
  return models.filter((m) => m.id && m.model && !m.is_hidden && !BUILTIN_META.has(m.model));
}

/** 会员等级能否使用该内置档模型（对齐 Web canUseModelBySubscription）。 */
function planAllowsModel(model: Model, plan?: string): boolean {
  const builtin = builtinName(model.model);
  if (builtin === 'monkeycode-pro') return plan === 'pro' || plan === 'flagship' || plan === 'ultra';
  if (builtin === 'monkeycode-ultra') return plan === 'flagship' || plan === 'ultra';
  return true;
}

// 先按 weight 降序，权重相同再按模型名稳定排序（对齐 Web）。
const byWeightThenName = (a: Model, b: Model) => {
  const w = (b.weight || 0) - (a.weight || 0);
  return w !== 0 ? w : (a.model || '').localeCompare(b.model || '');
};

/**
 * 默认模型（对齐 Web selectPreferredTaskModel）：
 * 1. 取与会员等级匹配的内置档（基础/专业/旗舰）中、当前可用且 weight 最高的；
 * 2. 否则取可用的公共模型中 weight 最高的；
 * 3. 仍无则回退到任意可用模型。
 */
export function pickDefaultModel(models: Model[], plan?: string): string {
  const planBuiltin = plan === 'pro'
    ? 'monkeycode-pro'
    : plan === 'flagship' || plan === 'ultra'
      ? 'monkeycode-ultra'
      : 'monkeycode-basic';

  const planModel = models
    .filter((m) => m.id && builtinName(m.model) === planBuiltin && planAllowsModel(m, plan))
    .sort(byWeightThenName)[0];
  if (planModel?.id) return planModel.id;

  const publicModel = models
    .filter((m) => m.id && m.owner?.type === 'public' && planAllowsModel(m, plan))
    .sort(byWeightThenName)[0];
  if (publicModel?.id) return publicModel.id;

  const usable = usableModels(models);
  const pool = usable.slice().sort(byWeightThenName);
  return pool.find((m) => m.is_default)?.id || pool[0]?.id || usable[0]?.id || '';
}

/** 默认镜像：优先公共 devbox，其次 is_default，再次第一个。 */
export function pickDefaultImage(images: Image[]): string {
  return (
    images.find((i) => i.owner?.type === 'public' && i.remark === 'devbox')?.id ||
    images.find((i) => i.is_default)?.id ||
    images[0]?.id ||
    ''
  );
}

export interface ModelGroup {
  key: string;
  label: string;
  badge?: string;
  models: Model[];
}

/** 模型分组（对齐 Web ModelSelect）：基础/专业/旗舰内置 + 付费 + 我的 + 团队。 */
export function groupModels(models: Model[]): ModelGroup[] {
  const supported = models.filter((m) => m.id && m.model && !m.is_hidden);
  const builtin: ModelGroup[] = [
    { key: 'monkeycode-basic', label: '基础模型', badge: '免费使用' },
    { key: 'monkeycode-pro', label: '专业模型', badge: '专业会员免费' },
    { key: 'monkeycode-ultra', label: '旗舰模型', badge: '旗舰会员免费' },
  ].map((o) => ({ ...o, models: supported.filter((m) => builtinName(m.model) === o.key) }));

  const paid = supported.filter((m) => m.owner?.type === 'public' && !builtinName(m.model));
  const priv = supported.filter((m) => m.owner?.type === 'private' && !builtinName(m.model));

  const teamMap = new Map<string, ModelGroup>();
  supported
    .filter((m) => m.owner?.type === 'team' && !builtinName(m.model))
    .forEach((m) => {
      const name = m.owner?.name || '团队模型';
      const k = `${m.owner?.id || name}:${name}`;
      if (!teamMap.has(k)) teamMap.set(k, { key: k, label: name, models: [] });
      teamMap.get(k)!.models.push(m);
    });

  return [
    ...builtin,
    { key: 'paid', label: '付费模型', badge: '消耗积分', models: paid },
    { key: 'private', label: '我的模型', models: priv },
    ...Array.from(teamMap.values()),
  ].filter((g) => g.models.length > 0);
}

/** 技能标签（对齐 Web）：按关联技能数量降序，前置「全部」。 */
export function skillTags(skills: Skill[]): string[] {
  const counts = new Map<string, number>();
  skills.forEach((s) => (s.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  const sorted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
  return ['全部', ...sorted];
}

/** 运行参数（与 Web TaskInput 一致）。 */
export const TASK_DEFAULTS = {
  cliName: 'opencode',
  hostId: 'public_host',
  resource: { core: 2, memory: 8 * 1024 * 1024 * 1024, life: 3 * 60 * 60 },
} as const;
