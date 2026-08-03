// 账号权益的展示口径(与移动端 app/(tabs)/profile.tsx 对齐):等级文案、
// token 缩写、今日额度、签到与邀请。纯函数,渲染在 settings.tsx 的
// MonkeyCode 账号卡。
import type { McUsage } from "./types";

/** 奖励数额与移动端文案同源(服务端不下发,两端各自硬编码;改版要一起改)。 */
export const CHECKIN_REWARD = 100;
export const INVITE_REWARD = 5000;

/** 头像堆叠最多展示几个(与移动端一致)。 */
const AVATAR_LIMIT = 4;

/** 会员等级文案。flagship 是 ultra 的服务端别名(移动端同款归一)。 */
export function planLabel(plan?: string): string {
  if (plan === "ultra" || plan === "flagship") return "旗舰会员";
  if (plan === "pro") return "专业会员";
  return "基础会员";
}

/** token 数缩写:百万以上取一位小数的 M,否则千分位。 */
export function fmtTokens(v: number): string {
  if (v >= 1_000_000) return `${(Math.floor(v / 100_000) / 10).toFixed(1)}M`;
  return v.toLocaleString("zh-CN");
}

/** 相对资源地址按云端基址补全(移动端 resolveAssetUrl 的等价物)。 */
export function resolveAssetUrl(base: string, url?: string): string {
  const u = (url || "").trim();
  if (!u) return "";
  if (/^(https?:)?\/\//i.test(u) || u.startsWith("data:")) return u;
  if (!base) return "";
  return u.startsWith("/") ? `${base}${u}` : `${base}/${u}`;
}

export interface UsageAvatar {
  key: string;
  /** 补全后的头像地址;空串 = 用首字母兜底 */
  url: string;
  /** 首字母(头像缺失或加载失败时展示) */
  initial: string;
}

/** 卡片要渲染的一切;null = 无可展示内容(整块不占位)。 */
export interface UsageView {
  planText: string;
  /** "有效期至 2026-01-01" / "长期有效";订阅缺席时为空串(不猜) */
  expiryText: string;
  /** 积分余额(已 /1000 并千分位);钱包缺席时 null */
  credits: string | null;
  /** 今日免费模型额度;钱包缺席时 null */
  quota: { total: number; remaining: number; text: string; ratio: number } | null;
  /** 当天是否已签到;null = 没取到,签到入口整个不出现(不催、也不误报已签) */
  checkedIn: boolean | null;
  /** 邀请概况;邀请端点缺席时 null */
  invite: { count: number; avatars: UsageAvatar[]; link: string } | null;
}

const clamp = (v: number, total: number) => Math.min(Math.max(v, 0), total);

/** userId 来自 mc_status 的云端账号,用于拼邀请链接;缺失时 link 为空串。 */
export function usageView(usage: McUsage | null | undefined, userId?: string): UsageView | null {
  if (!usage) return null;
  const { wallet, subscription, invitations } = usage;
  const checkedIn = usage.checked_in ?? null;
  if (!wallet && !subscription && !invitations && checkedIn === null) return null;

  const plan = subscription?.plan;
  // 到期日只对付费档有意义:基础档服务端不给 expires_at,给了也不代表会降级
  const paid = plan === "pro" || plan === "ultra" || plan === "flagship";
  const expiry = paid && subscription?.expires_at ? subscription.expires_at.slice(0, 10) : "";

  let credits: string | null = null;
  let quota: UsageView["quota"] = null;
  if (wallet) {
    credits = Math.floor((wallet.balance ?? 0) / 1000).toLocaleString("zh-CN");
    const total = Math.max(wallet.daily_token_limit ?? 0, 0);
    // 上限为 0 = 该账号没有免费额度档位,此时余额字段不具备"剩余/总量"语义
    const remaining = total > 0 ? clamp(wallet.daily_token_balance ?? 0, total) : Math.max(wallet.daily_token_balance ?? 0, 0);
    quota = {
      total,
      remaining,
      text: total > 0 ? `剩余 ${fmtTokens(remaining)} / ${fmtTokens(total)}` : "无额度",
      ratio: total > 0 ? remaining / total : 0,
    };
  }

  const base = (usage.base_url || "").replace(/\/+$/, "");
  const items = invitations?.items ?? [];
  const invite = invitations
    ? {
        count: invitations.count ?? items.length,
        avatars: items.slice(0, AVATAR_LIMIT).map((it, i) => ({
          key: it.id || `invitee-${i}`,
          url: resolveAssetUrl(base, it.avatar_url),
          initial: (it.name || "?").trim().charAt(0).toUpperCase() || "?",
        })),
        // 与移动端同款邀请链接;基址或账号 id 缺一不可,拼不出就不给入口
        link: base && userId ? `${base}/?ic=${userId}` : "",
      }
    : null;

  return {
    planText: planLabel(plan),
    expiryText: subscription ? (expiry ? `有效期至 ${expiry}` : "长期有效") : "",
    credits,
    quota,
    checkedIn,
    invite,
  };
}
