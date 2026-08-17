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
          className="-ms-1.5 flex size-6 items-center justify-center overflow-hidden rounded-full border border-base-100 bg-base-300 text-2xs font-semibold text-base-content/60 first:ms-0"
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

  // 签到三态钮:可签/签到中/已签;checkedIn 没取到时整个不出现。
  // 链接样式:瓷片内的次级行动,不与主数字抢重量
  const checkinBtn =
    vm.checkedIn !== null ? (
      <button
        type="button"
        className="btn btn-link btn-xs h-auto min-h-0 justify-start p-0 no-underline"
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

  const tile = "flex flex-col gap-1.5 rounded-box border border-base-300 bg-base-100 p-3";

  return (
    <div className="flex flex-col gap-3" aria-label={t("account.usage.label")}>
      {/* 会员行:档位皇冠章 + 有效期(归权益面板首行,不挤在行头身份行) */}
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

      {/* 额度 / 积分 / 邀请三瓷片(2026-08-16 用户定案的布局):签到与复制
          邀请是各自瓷片内的次级行动;瓷片底色 base-100,在选中行的淡色底上
          自然浮起 */}
      {(q || vm.credits !== null || vm.invite) && (
        <div className="grid gap-2.5 sm:grid-cols-3">
          {q && (
            <div className={tile}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-base-content/50">{t("account.usage.quota")}</span>
                <span className={`font-mono text-xs ${low ? "text-warning" : "text-base-content/70"}`}>
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
          {vm.credits !== null && (
            <div className={tile}>
              <span className="text-xs text-base-content/50">{t("account.usage.creditsTitle")}</span>
              {/* 大数字用正文色:积分是余额陈述不是行动号召,主色留给品牌/选中 */}
              <span className="font-mono text-lg font-extrabold leading-none tracking-tight tabular-nums">
                {vm.credits.toLocaleString()}
              </span>
              {checkinBtn}
            </div>
          )}
          {vm.invite && (
            <div className={tile} title={t("account.usage.inviteReward", { reward: INVITE_REWARD.toLocaleString() })}>
              <span className="text-xs text-base-content/50">{t("account.usage.inviteTitle")}</span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-lg font-extrabold leading-none tracking-tight tabular-nums">
                  {t("account.usage.inviteCount", { count: vm.invite.count })}
                </span>
                <InviteeStack avatars={vm.invite.avatars} />
              </span>
              {vm.invite.link && (
                <button
                  type="button"
                  className="btn btn-link btn-xs h-auto min-h-0 justify-start gap-1 p-0 no-underline"
                  title={vm.invite.link}
                  onClick={copyInvite}
                >
                  {copied ? (
                    <IconCheck size={12} stroke={2} aria-hidden className="text-success" />
                  ) : (
                    <IconCopy size={12} stroke={1.75} aria-hidden />
                  )}
                  {copied ? t("account.usage.copied") : t("account.usage.copyInvite")}
                </button>
              )}
            </div>
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
