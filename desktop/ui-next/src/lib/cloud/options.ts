// 云端建任务的选项模型与默认值挑选(纯函数):移植旧 UI cloud.ts,与
// Web selectPreferredTaskModel / pickDefaultImage 同一套规则。展示名经
// i18n(会员档位词);网络层在 lib/ipc/cloudtasks.ts。
import { t } from "@/lib/i18n";
import type { McCloudHost, McCloudImage, McCloudModel } from "@/lib/ipc/cloudtasks";

export const PUBLIC_CLOUD_HOST_ID = "public_host";

/** 裸档位占位条目(服务端会员档位的占位项,非可调用模型)。 */
const BUILTIN_META = new Set(["monkeycode-basic", "monkeycode-pro", "monkeycode-ultra"]);

function builtinName(model?: string): string | undefined {
  const n = (model || "").toLowerCase();
  if (n.startsWith("monkeycode-basic")) return "monkeycode-basic";
  if (n.startsWith("monkeycode-pro")) return "monkeycode-pro";
  if (n.startsWith("monkeycode-ultra")) return "monkeycode-ultra";
  return undefined;
}

/** 内置模型名翻译为档位词(基础/专业/旗舰模型)。 */
function translateBuiltinNames(text: string): string {
  return text
    .replace(/monkeycode-ultra/gi, t("cloud.model.tier.ultra"))
    .replace(/monkeycode-pro/gi, t("cloud.model.tier.pro"))
    .replace(/monkeycode-basic/gi, t("cloud.model.tier.basic"))
    .replace(/\s*\/\s*/g, " / ");
}

/** 云端模型展示名:优先 remark,再翻译内置档位。 */
export function cloudModelLabel(model?: { model?: string; remark?: string } | null): string {
  if (!model) return "";
  const remark = model.remark?.trim();
  if (remark) return translateBuiltinNames(remark);
  return translateBuiltinNames(model.model || "");
}

/** 镜像展示名与 Web 一致:优先备注,否则只展示镜像 tag 的最后一段。 */
export function cloudImageLabel(image?: McCloudImage | null): string {
  if (!image) return "";
  const remark = image.remark?.trim();
  if (remark) return remark;
  const name = image.name?.trim() || "";
  return name.slice(name.lastIndexOf("/") + 1) || t("cloud.new.imageFallback");
}

/** 宿主机展示名:公共档使用稳定产品名,私有宿主优先使用备注。 */
export function cloudHostLabel(host?: McCloudHost | null): string {
  if (!host) return "";
  if (host.id === PUBLIC_CLOUD_HOST_ID) return t("cloud.new.publicHost");
  if (host.remark?.trim()) return host.remark.trim();
  return [host.name, host.external_ip].filter(Boolean).join(" · ") || t("cloud.new.hostFallback");
}

/** Git 地址粗校验(与旧 UI 同一条正则):只拦明显不是 Git 地址的输入,
 * 真伪由服务端克隆时判定——本地不该替服务端猜哪些 host 合法。 */
export function validCloudRepoUrl(value: string): boolean {
  return /^(https?:\/\/|ssh:\/\/|git@)\S+$/i.test(value.trim());
}

/** 仓库地址 → 展示名(末段去 .git);三种形态同一条路径:
 * https://host/owner/repo.git、ssh://host/owner/repo、git@host:owner/repo.git。 */
export function cloudRepoLabel(value: string): string {
  const path = value
    .trim()
    .replace(/^git@[^:]+:/i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
  const tail = path.split("/").pop()?.replace(/\.git$/i, "");
  return tail || t("cloud.new.repoFallback");
}

/** 会员档位是否覆盖该模型(前缀配档,与壳侧 plan_allows_model 同规则)。 */
function planAllowsModel(model: McCloudModel, plan?: string): boolean {
  const b = builtinName(model.model);
  if (b === "monkeycode-pro") return plan === "pro" || plan === "flagship" || plan === "ultra";
  if (b === "monkeycode-ultra") return plan === "flagship" || plan === "ultra";
  return true;
}

const byWeightThenName = (a: McCloudModel, b: McCloudModel) => {
  const w = (b.weight || 0) - (a.weight || 0);
  return w !== 0 ? w : (a.model || "").localeCompare(b.model || "");
};

/** 可选模型:有 id、非裸内置占位项、未隐藏;超会员档不剔除,打 locked
 * 灰态展示(对齐 Web canUseModelBySubscription 的做法)。 */
export function usableCloudModels(models: McCloudModel[], plan?: string): McCloudModel[] {
  return models
    .filter((m) => m.id && m.model && !m.is_hidden && !BUILTIN_META.has(m.model.toLowerCase()))
    .map((m) => (planAllowsModel(m, plan) ? m : { ...m, locked: true }))
    .sort(byWeightThenName);
}

/** 组内展示名:剥掉与组头重复的档位前缀(「基础模型 / xxx」→「xxx」);
 * 剥空则回退整名。移植旧 UI groupedCloudModelLabel,前缀按当前语言比对。 */
export function groupedCloudModelLabel(model: McCloudModel): string {
  const label = cloudModelLabel(model);
  for (const key of ["cloud.model.tier.basic", "cloud.model.tier.pro", "cloud.model.tier.ultra"] as const) {
    const prefix = t(key);
    if (!label.startsWith(prefix)) continue;
    const nested = label.slice(prefix.length).match(/^\s*\/\s*(.+)$/)?.[1]?.trim();
    return nested || label;
  }
  return label;
}

export interface McCloudModelGroup {
  key: string;
  label: string;
  badge?: string;
  models: McCloudModel[];
}

/** 模型分组(移植旧 UI groupCloudModels):内置三档(基础/专业/旗舰)→
 * 付费 → 我的 → 各团队;空组不出。locked 条目留在组内灰态展示。 */
export function groupCloudModels(models: McCloudModel[], plan?: string): McCloudModelGroup[] {
  const supported = usableCloudModels(models, plan);
  const builtin: McCloudModelGroup[] = (
    [
      { key: "monkeycode-basic", label: t("cloud.model.tier.basic"), badge: t("cloud.badge.free") },
      { key: "monkeycode-pro", label: t("cloud.model.tier.pro"), badge: t("cloud.badge.proFree") },
      { key: "monkeycode-ultra", label: t("cloud.model.tier.ultra"), badge: t("cloud.badge.ultraFree") },
    ] as const
  ).map((group) => ({
    ...group,
    models: supported.filter((model) => builtinName(model.model) === group.key),
  }));

  const paid = supported.filter((model) => model.owner?.type === "public" && !builtinName(model.model));
  const personal = supported.filter((model) => model.owner?.type === "private" && !builtinName(model.model));
  const teams = new Map<string, McCloudModelGroup>();
  for (const model of supported.filter((item) => item.owner?.type === "team" && !builtinName(item.model))) {
    const name = model.owner?.name || t("cloud.group.team");
    const key = `${model.owner?.id || name}:${name}`;
    const group = teams.get(key) || { key, label: name, models: [] };
    group.models.push(model);
    teams.set(key, group);
  }

  return [
    ...builtin,
    { key: "paid", label: t("cloud.group.paid"), badge: t("cloud.badge.credits"), models: paid },
    { key: "private", label: t("cloud.group.mine"), models: personal },
    ...teams.values(),
  ].filter((group) => group.models.length > 0);
}

/** 默认模型:会员档匹配的内置档 weight 最高 → 公共模型 → 任意可用。
 * locked 条目只展示不参与默认值(宁空不默认选禁用项)。 */
export function pickDefaultCloudModel(models: McCloudModel[], plan?: string): string {
  const pool = usableCloudModels(models, plan).filter((m) => !m.locked);
  const planBuiltin =
    plan === "pro" ? "monkeycode-pro" : plan === "flagship" || plan === "ultra" ? "monkeycode-ultra" : "monkeycode-basic";
  const planModel = pool.filter((m) => builtinName(m.model) === planBuiltin).sort(byWeightThenName)[0];
  if (planModel?.id) return planModel.id;
  const publicModel = pool.filter((m) => m.owner?.type === "public").sort(byWeightThenName)[0];
  if (publicModel?.id) return publicModel.id;
  return pool.find((m) => m.is_default)?.id || pool[0]?.id || "";
}

/** 可选宿主机:公共宿主始终存在;离线与重复的私有宿主不进入创建列表。
 * 公共模型受云端约束,只能运行在公共宿主机。 */
export function usableCloudHosts(hosts: McCloudHost[], publicModel = false): McCloudHost[] {
  const remotePublic = hosts.find((host) => host.id === PUBLIC_CLOUD_HOST_ID);
  const publicHost: McCloudHost = {
    ...remotePublic,
    id: PUBLIC_CLOUD_HOST_ID,
    name: remotePublic?.name || "MonkeyCode",
    status: "online",
    owner: remotePublic?.owner || { type: "public" },
  };
  if (publicModel) return [publicHost];

  const seen = new Set([PUBLIC_CLOUD_HOST_ID]);
  return [
    publicHost,
    ...hosts.filter((host) => {
      const id = host.id || "";
      if (!id || id.startsWith(PUBLIC_CLOUD_HOST_ID) || host.status !== "online" || seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  ];
}

/** 服务端默认宿主有效时采用,否则回退公共宿主;公共模型始终强制公共宿主。 */
export function pickDefaultCloudHost(hosts: McCloudHost[], preferredId = "", publicModel = false): string {
  const available = usableCloudHosts(hosts, publicModel);
  return available.some((host) => host.id === preferredId) ? preferredId : PUBLIC_CLOUD_HOST_ID;
}

/** 默认镜像:公共 devbox → is_default → 第一个。 */
export function pickDefaultCloudImage(images: McCloudImage[]): string {
  return (
    images.find((i) => i.owner?.type === "public" && i.remark === "devbox")?.id ||
    images.find((i) => i.is_default)?.id ||
    images[0]?.id ||
    ""
  );
}

/** 模型是否公共归属(公共模型只能跑公共宿主机)。 */
export function isPublicModel(models: McCloudModel[], modelId: string): boolean {
  return models.some((m) => m.id === modelId && m.owner?.type === "public");
}
