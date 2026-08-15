// MonkeyCode 账号权益面板(分块对齐旧工程 McUsagePanel/移动端「我的」页):
// 会员行(档位皇冠章+有效期+签到主行动)→ 今日额度(小标+等宽数字+细进度
// 条,余量见底转警示)→ 积分余额(大号等宽数字)· 邀请(人数+每邀奖励+
// 复制链接)。数据在挂载时自取一次(mc_usage 四路并发在壳侧收口),不进
// 任何全局轮询——面板只在设置页可见,常驻轮询等于为看不见的面板空跑请求。
import { IconCheck, IconCopy, IconCrown } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { CHECKIN_REWARD, INVITE_REWARD, usageVM, type UsageAvatar } from "@/lib/account/usage";
import { useI18n } from "@/lib/i18n";
import { mcCheckin, mcUsage, type McUsage } from "@/lib/ipc/account";
import { copyText } from "@/lib/util/clipboard";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 邀请人头像堆(旧 UI InviteeStack):负 margin 叠放,后一个压前一个。
 *  头像加载失败(相对地址拼不出/资源没了)当场回落首字母底片——不给
 *  破图,也不留空位。纯装饰,人数由旁边的文字承担,故整体 aria-hidden。 */
function InviteeStack({ avatars }: { avatars: UsageAvatar[] }) {
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  if (avatars.length === 0) return null;
  return (
    <span aria-hidden className="flex shrink-0 items-center">
      {avatars.map((a) => (
        <span
          key={a.key}
          className="-ms-1.5 flex size-6 items-center justify-center overflow-hidden rounded-full border border-base-100 bg-base-300 text-[10px] font-semibold text-base-content/60 first:ms-0"
        >
          {a.url && !broken[a.key] ? (
            <img
              src={a.url}
              alt=""
              className="size-full object-cover"
              onError={() => setBroken((m) => ({ ...m, [a.key]: true }))}
            />
          ) : (
            a.initial
          )}
        </span>
      ))}
    </span>
  );
}

export function UsagePanel({ userId }: { userId?: string }) {
  const { t } = useI18n();
  const [usage, setUsage] = useState<McUsage | null>(null);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [checkinErr, setCheckinErr] = useState("");
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const load = useCallback(async () => {
    // 全失败(会话失效/私有化部署无权益端点)就当没有权益可展示,
    // 面板整块不出现——没有比「不显示」更有用的降级
    setUsage(await mcUsage().catch(() => null));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const vm = usageVM(usage, userId);
  if (!vm) return null;

  const checkin = async () => {
    setCheckinBusy(true);
    setCheckinErr("");
    try {
      await mcCheckin();
      // 成功后重拉权益:+积分 与「今日已签到」一次刷出
      await load();
    } catch (e) {
      // 重复签到等属业务提示,就地展示,不升级为连接错误
      setCheckinErr(errMsg(e));
    } finally {
      setCheckinBusy(false);
    }
  };

  // 签到三态钮:可签/签到中/已签;checkedIn 没取到时整个不出现
  const checkinBtn =
    vm.checkedIn !== null ? (
      <button
        type="button"
        className="btn btn-outline btn-xs"
        disabled={checkinBusy || vm.checkedIn}
        onClick={() => void checkin()}
      >
        {checkinBusy && <span className="loading loading-spinner loading-xs" aria-hidden />}
        {checkinBusy
          ? t("account.usage.checkinBusy")
          : vm.checkedIn
            ? t("account.usage.checkedIn")
            : t("account.usage.checkin", { reward: CHECKIN_REWARD })}
      </button>
    ) : null;

  const copyInvite = () => {
    if (!vm.invite?.link) return;
    copyText(vm.invite.link);
    setCopied(true);
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1800);
  };

  // 余额见底才转警示色:额度是每日重置的,平时用掉大半属正常
  const q = vm.quota;
  const low = !!q && q.total > 0 && q.remaining / q.total <= 0.1;

  return (
    <div className="flex flex-col gap-2.5" aria-label={t("account.usage.label")}>
      {/* 会员行:档位皇冠章 + 有效期 */}
      {vm.hasSubscription && (
        <div className="flex items-center gap-2">
          <span className={`badge badge-soft gap-1 font-bold ${vm.plan === "basic" ? "" : "badge-primary"}`}>
            <IconCrown size={12} stroke={2} aria-hidden />
            {t(`account.usage.plan.${vm.plan}`)}
          </span>
          <span className="text-xs text-base-content/50">
            {vm.expiresAt ? t("account.usage.expiry", { date: vm.expiresAt }) : t("account.usage.noExpiry")}
          </span>
        </div>
      )}

      {/* 今日额度:小标 + 等宽数字,细进度条 */}
      {q && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-base-content/70">{t("account.usage.quota")}</span>
            <span className="flex-1" />
            <span className={`font-mono text-xs ${low ? "text-warning" : "text-base-content/50"}`}>
              {q.total > 0
                ? t("account.usage.quotaText", { remaining: q.remainingText, total: q.totalText })
                : t("account.usage.quotaNone")}
            </span>
          </div>
          {q.total > 0 && (
            <progress
              className={`progress h-1.5 w-full ${low ? "progress-warning" : "progress-primary"}`}
              aria-label={t("account.usage.quota")}
              value={q.remaining}
              max={q.total}
            />
          )}
        </div>
      )}

      {/* 积分余额 · 签到 · 邀请归同一块:签到与邀请都是获取积分的路径。
          整行底对齐:大数字、签到钮、邀请簇共享一条基线,不再各浮各的 */}
      {(vm.credits !== null || vm.invite || checkinBtn) && (
        <div className="flex items-end gap-3 border-t border-base-300 pt-3">
          {vm.credits !== null && (
            <span className="flex shrink-0 flex-col gap-0.5">
              <span className="text-xs text-base-content/50">{t("account.usage.creditsTitle")}</span>
              {/* 大数字用正文色:积分是余额陈述不是行动号召,主色留给品牌/选中 */}
              <span className="font-mono text-lg font-extrabold leading-none tracking-tight tabular-nums">
                {vm.credits.toLocaleString()}
              </span>
            </span>
          )}
          {checkinBtn}
          <span className="flex-1" />
          {vm.invite && (
            <span className="flex min-w-0 items-end gap-2.5">
              <InviteeStack avatars={vm.invite.avatars} />
              <span className="flex min-w-0 flex-col gap-0.5 text-end">
                <span className="text-xs font-semibold text-base-content/70">
                  {t("account.usage.invite", { count: vm.invite.count })}
                </span>
                <span className="text-xs text-base-content/50">
                  {t("account.usage.inviteReward", { reward: INVITE_REWARD.toLocaleString() })}
                </span>
              </span>
              {/* 复制按钮定宽:文案在「复制邀请链接/已复制」间切换,不定宽
                  会让整个右对齐的邀请簇跟着抽动 */}
              {vm.invite.link && (
                <button type="button" className="btn btn-sm min-w-32 shrink-0" title={vm.invite.link} onClick={copyInvite}>
                  {copied ? (
                    <IconCheck size={12} stroke={2} aria-hidden className="text-success" />
                  ) : (
                    <IconCopy size={12} stroke={1.75} aria-hidden />
                  )}
                  {copied ? t("account.usage.copied") : t("account.usage.copyInvite")}
                </button>
              )}
            </span>
          )}
        </div>
      )}

      {checkinErr && (
        <span role="alert" className="text-xs text-error">
          {checkinErr}
        </span>
      )}
    </div>
  );
}
