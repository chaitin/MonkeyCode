// 设置页「账号」分区。层级(2026-08-15 用户定案):**MonkeyCode 是唯一的
// 账号概念**,页面自上而下 = 服务版本 → MonkeyCode 账号 → 百智云服务:
//
// - 服务版本(EditionBlock,置顶):国内版 / 国际版 / 私有化三选一,新用户
//   先选版本再登录。登录卡的**形态**跟所选版本即时走(选国际版微信码当场
//   撤下,不许「选了国际版还挂着二维码」);登录**动作**只在选择 = 已保存
//   生效时可用——表单登的是生效中的服务,未保存时以「保存并切换」代替表单;
// - MonkeyCode 账号:未登录时按版本给登录方式——国内版 = 微信扫码/短信
//   验证码(两者都是**经百智云 OAuth** 登录 MonkeyCode 的方式,登录成功自动
//   桥接)+ 账号密码直连;国际版/私有化 = 仅账号密码(国际版未接百智
//   OAuth,私有化不桥接)。已登录 = 身份卡 + 用量/签到/邀请 + 会员模型同步;
// - 百智云服务(增值,非账号并列项;国际版整组隐藏):百智云会话在则给
//   模型与 MCP 同步;MonkeyCode 已连而百智云未登录时给可选登录入口。
//
// 状态语义:
// - 两路登录态挂载时并发自取(baizhi_status / mc_status),不进全局轮询;
// - 百智云登录成功顺带桥接 MonkeyCode(mc_login 走同一账号的 OAuth),
//   桥接失败不阻断——MonkeyCode 卡保留手动「连接」入口(仅国内版);
// - 断开 MonkeyCode 必须先吊销会员模型密钥再清会话(disconnectMc 收口,
//   顺序由 lib 与本组件测试双重钉住);
// - 同步(baizhi_sync / mc_models_sync)结果经 onSyncResult 交
//   SettingsView.applySync 并入草稿;干净表单+无任务在跑时那边自动保存,
//   否则回退保存条——结果行按 autoSaved/blocked 说明白落到哪一步了;
//   百智云同步把表单此刻持有的网关密钥(knownApiKeys)一并交给壳复用,
//   不传的话每同步一次就在用户网关账号里多建一把密钥。
import { IconCheck, IconCopy, IconExternalLink } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n";
import {
  baizhiLogout,
  baizhiStatus,
  baizhiSync,
  disconnectMc,
  mcLogin,
  mcStatus,
  type BaizhiStatus,
  type BaizhiSyncResult,
  type McModelsSyncResult,
  type McStatus,
  mcModelsSync,
} from "@/lib/ipc/account";
import { openExternal } from "@/lib/ipc/host";
import { inDesktopShell } from "@/lib/ipc/ipc";
import { copyText } from "@/lib/util/clipboard";
import { MC_CN_URL, MC_INTL_URL, mcEditionOf, type McEdition, type SettingsDraft } from "@/features/settings/settingsForm";
import { LoginPanel, PasswordForm } from "./LoginPanel";
import { UsagePanel } from "./UsagePanel";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 用户 ID 掩码:短串原样,长串取头 8 + 尾 6(与移动端「我的」页同口径,
 *  mobile/app/(tabs)/profile.tsx maskUserId)——只为不撑爆行宽,复制的、
 *  title 里的都是完整原值。 */
export function maskUserId(id: string): string {
  const v = id.trim();
  return v.length <= 16 ? v : `${v.slice(0, 8)}...${v.slice(-6)}`;
}

/** 用户 ID 一键复制(移动端是整行可点 + toast,桌面无 toast:图标就地
 *  翻成对勾 1.8 秒,与用量面板的「复制邀请链接」同一反馈语汇)。 */
function UserIdChip({ id }: { id: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  const copy = () => {
    copyText(id);
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      type="button"
      title={t("account.mc.userIdTitle", { id })}
      aria-label={copied ? t("account.mc.userIdCopied") : t("account.mc.copyUserId")}
      className="flex min-w-0 cursor-pointer items-center gap-1 font-mono text-xs text-base-content/50 transition-colors hover:text-base-content"
      onClick={copy}
    >
      {copied ? (
        <IconCheck size={11} stroke={2} aria-hidden className="shrink-0 text-success" />
      ) : (
        <IconCopy size={11} stroke={1.75} aria-hidden className="shrink-0" />
      )}
      <span className="truncate">{maskUserId(id)}</span>
    </button>
  );
}

/** profile 字段对壳不透明,展示名尽力提取常见字段;提不出返回空串。 */
export function profileName(p?: Record<string, unknown>): string {
  for (const k of ["name", "nickname", "username", "phone", "email"]) {
    const v = p?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** 交给壳复用的「已持有明文推理密钥」。契约见 desktop/src/baizhi/sync.rs
 *  ensure_api_key:壳先在网关的密钥列表里找与 knownKeys 完全相同的一把
 *  (停用的顺带重新启用)复用之,找不到才**新建**一把。传空数组 = 每次同步
 *  都在用户的网关账号里凭空多出一把新密钥,而表单里明明就有可用的那把。
 *  只有 sk- 开头的才是网关明文密钥(壳侧同样这么筛);同一把 key 会被多个
 *  模型行共用,去重后再传。 */
export function knownApiKeys(draft?: SettingsDraft | null): string[] {
  const keys = (draft?.models ?? []).map((m) => m.api_key.trim()).filter((k) => k.startsWith("sk-"));
  return [...new Set(keys)];
}

type Msg = { text: string; error?: boolean } | null;

/** applySync 的回执:跳过名单 + 自动保存结论(blocked = 为何回退保存条)。 */
export interface SyncApplied {
  skipped: string[];
  autoSaved: boolean;
  blocked?: "dirty" | "busy";
}

type T = ReturnType<typeof useI18n>["t"];

/** 同步结果行尾注:自动保存已生效 / 因何需要手动保存。applied 缺席
 * (浏览器模式等没接宿主)退回中性的「保存后生效」。 */
function syncOutcome(t: T, applied: SyncApplied | undefined | void): string {
  if (!applied) return t("account.sync.manualSave");
  if (applied.autoSaved) return t("account.sync.autoSaved");
  if (applied.blocked === "dirty") return t("account.sync.blockedDirty");
  if (applied.blocked === "busy") return t("account.sync.blockedBusy");
  return t("account.sync.manualSave");
}

function MsgLine({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    // 长结果(如百智云同步的 MCP 服务清单)钳两行,悬停看全文——操作留言
    // 不该在卡里铺成一面墙
    <span
      role={msg.error ? "alert" : "status"}
      title={msg.text}
      className={`line-clamp-2 text-xs ${msg.error ? "text-error" : "text-base-content/60"}`}
    >
      {msg.text}
    </span>
  );
}

/** 账号卡壳(旧 UI 设置屏同款形态):logo + 标题/状态徽标 + 副行在左,
 *  动作钮靠右;扩展内容(用量面板/提示行)另起一行。 */
function AccountCard({
  logo,
  title,
  badge,
  subtitle,
  actions,
  children,
}: {
  logo: string;
  title: string;
  badge?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="card card-border bg-base-100">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <img
            src={logo}
            alt=""
            aria-hidden
            draggable={false}
            className="h-9 w-9 shrink-0 rounded-lg"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">{title}</span>
              {badge}
            </div>
            {subtitle && (
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-base-content/60">{subtitle}</div>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** 百智云账号卡(已登录形态)。 */
function BaizhiCard({
  status,
  knownKeys,
  onChanged,
  onResult,
  autoSyncToken = 0,
}: {
  status: BaizhiStatus;
  /** 表单此刻持有的网关明文密钥(见 knownApiKeys):交壳复用,免重复建 key */
  knownKeys: string[];
  onChanged: () => Promise<void>;
  /** 同步结果交宿主并入设置草稿;回执带跳过名单与自动保存结论(卡内外显) */
  onResult?: (r: BaizhiSyncResult) => SyncApplied | undefined | void;
  /** 登录真实事件的自动同步信号(宿主 bump;0 = 无,打开设置读到既有登录态
   * 不触发)。卡在登录后才挂载,同步逻辑又在卡内,登录瞬间够不着——经
   * token 延迟触发(旧 UI「登录成功即自动同步」用户拍板行为的 ui-next 版) */
  autoSyncToken?: number;
}) {
  const { t } = useI18n();
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  // 基准取"此刻"的表单:同步是发请求→等数秒,自动同步那一路更是从 effect
  // 里发出的,拿闭包里的旧值会把刚并入的密钥漏掉
  const keysRef = useRef(knownKeys);
  keysRef.current = knownKeys;

  const sync = async () => {
    setSyncing(true);
    setMsg(null);
    try {
      const r = await baizhiSync(keysRef.current);
      const mcpCount = Object.keys(r.mcp_servers ?? {}).length;
      const notes = r.notes?.length ? ` ${r.notes.join(t("common.semiSep"))}` : "";
      // 一条都没拉到 = 失败语义(旧 UI 同款):账号没开通/没配模型时,
      // 「已获取 0 个模型…保存后生效」读起来像成功了,用户等着模型出现。
      // 也不能往下走 onResult:空集合并入本就是 no-op,却会触发一次
      // 自动保存(写盘 + 重启引擎),白踹一次引擎
      if (!r.models.length && !mcpCount) {
        setMsg({ text: t("account.baizhi.syncEmpty") + notes, error: true });
        return;
      }
      const applied = onResult?.(r);
      const skipped = applied && applied.skipped.length ? ` ${t("account.sync.skipped", { names: applied.skipped.join(t("common.listSep")) })}` : "";
      // 首次同步会在**用户自己的网关账号**里新建并启用一把推理密钥。这件事
      // 必须说(旧 UI settings.tsx:1176 有这句,ui-next 只解析不渲染):不说的话
      // 用户日后在网关后台看到这把来路不明的 key,很可能当成多余项删掉,本地
      // 百智云模型随即集体鉴权失败,而现场与那次同步之间没有任何线索可连
      const keyLine = r.key_created ? ` ${t("account.baizhi.keyCreated", { name: r.key_name || "MonkeyCode" })}` : "";
      setMsg({
        text:
          t("account.baizhi.syncDone", { models: r.models.length, mcp: mcpCount }) +
          syncOutcome(t, applied) +
          keyLine +
          notes +
          skipped,
      });
    } catch (e) {
      setMsg({ text: errMsg(e), error: true });
    } finally {
      setSyncing(false);
    }
  };

  const logout = async () => {
    setMsg(null);
    try {
      await baizhiLogout();
      await onChanged();
    } catch (e) {
      setMsg({ text: errMsg(e), error: true });
    }
  };

  // 登录即自动同步:token 变化(含挂载时已非 0——refresh 与 bump 同批提交
  // 时卡首挂载就带着新值)触发一次;sync 自带 syncing 态,不需再防抖
  useEffect(() => {
    if (autoSyncToken > 0) void sync();
    // sync 每渲染新引用但行为稳定,只认 token 边沿
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSyncToken]);

  return (
    <AccountCard
      logo="/baizhi-logo.png"
      // 组头已表明「百智云账号」,卡头显登录身份,不再重复产品名
      title={profileName(status.profile) || t("account.loggedIn")}
      badge={<span className="badge badge-success badge-soft badge-xs shrink-0">{t("account.loggedIn")}</span>}
      subtitle={<span className="truncate font-mono text-xs text-base-content/50">{status.host}</span>}
      actions={
        <>
          <button type="button" className="btn btn-sm" disabled={syncing} onClick={() => void sync()}>
            {syncing && <span className="loading loading-spinner loading-xs" aria-hidden />}
            {syncing ? t("account.syncing") : t("account.baizhi.sync")}
          </button>
          <button type="button" className="btn btn-ghost btn-sm text-base-content/60" onClick={() => void logout()}>
            {t("account.baizhi.logout")}
          </button>
        </>
      }
    >
      <MsgLine msg={msg} />
    </AccountCard>
  );
}

/** MonkeyCode 云账号卡:未连=连接入口;已连=账号信息 + 用量面板 +
 *  会员模型同步 + 断开(先 revoke 再 logout)。 */
function McCard({
  status,
  baizhiLoggedIn,
  edition,
  editionReady,
  onRetryApply,
  saveBusy = false,
  editionSelector,
  bridgeErr,
  onChanged,
  onLoggedIn,
  onBaizhiLoggedIn,
  onMcDisconnected,
  onResult,
  autoSyncToken = 0,
  serviceGeneration,
  isServiceGenerationCurrent,
}: {
  status: McStatus | null;
  /** 百智云是否已登录:国内版据此在「未连接」态二选一——已登录给「连接」
   *  重试钮(桥接要拿百智云会话去换 MonkeyCode 会话),未登录给完整登录 tabs */
  baizhiLoggedIn: boolean;
  /** **所选**服务版本(与版本块同一份选择,立即跟手),决定登录方式:
   *  cn = 微信/短信(百智云 OAuth)+ 账密;intl/private = 仅账密
   *  (国际版未接百智 OAuth,私有化不桥接) */
  edition: McEdition;
  /** 所选版本已保存生效(选择 = 生效)。false 时**不给登录表单**——表单
   *  登的是已保存的旧服务,跟着选择走会登错服务器;以「保存并切换」代之 */
  editionReady: boolean;
  /** 罕见路径:官方版自动落盘失败后重试(重新提交当前草稿) */
  onRetryApply?: () => void;
  saveBusy?: boolean;
  /** 未登录形态置于登录卡顶部的版本选择器(宿主注入;登录页 = 版本切换 +
   *  登录方式一张卡)。已登录形态不用——版本块由宿主独立成组。 */
  editionSelector?: ReactNode;
  /** 百智云登录后自动桥接的失败信息(不阻断,卡内外显并留手动重试) */
  bridgeErr: string;
  onChanged: () => Promise<void>;
  /** 账密登录/点「连接」成功:宿主刷新状态并起一次会员模型同步(与桥接登录同待遇) */
  onLoggedIn: (generation: number) => Promise<void>;
  /** 微信/短信(百智云 OAuth)登录成功:宿主刷新并自动桥接(仅国内版 tabs 用) */
  onBaizhiLoggedIn: () => void;
  /** 断开成功后清掉会员模型组(宿主 applyMcDisconnect) */
  onMcDisconnected?: () => SyncApplied | undefined | void;
  /** 同步结果交宿主并入设置草稿;回执带跳过名单与自动保存结论(卡内外显) */
  onResult?: (r: McModelsSyncResult) => SyncApplied | undefined | void;
  /** 登录/桥接真实事件的自动同步信号(语义同 BaizhiCard.autoSyncToken) */
  autoSyncToken?: number;
  /** MonkeyCode 服务代次；旧代次请求完成后不得再修改新服务状态或配置。 */
  serviceGeneration: number;
  isServiceGenerationCurrent: (generation: number) => boolean;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<"connect" | "disconnect" | "sync" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  // 仅国内版「百智云已登录、MC 未连」的桥接重试态用(账密作折叠的后备入口)
  const [pwOpen, setPwOpen] = useState(false);
  const isCurrentService = () => isServiceGenerationCurrent(serviceGeneration);

  useEffect(() => {
    setBusy(null);
    setMsg(null);
    setPwOpen(false);
  }, [serviceGeneration]);

  // 换版本选择即清操作留言:断开/同步的结果行属于上一个语境,挂在新版本的
  // 登录卡上读起来像无主噪音(2026-08-15 用户报障:切版本后旧提示一直赖着)
  useEffect(() => {
    setMsg(null);
  }, [edition]);

  /** 版本切换未生效期间的占位(未登录时代替登录表单,已连接时附注卡尾)。
   *  正常路径:点官方版即自动落盘,这里只闪一下「切换中」;私有化未生效
   *  一律提示填地址保存(地址已填也一样——「保存生效」钮就在上方字段区,
   *  不许掉进「未生效/重试」误伤,2026-08-15 用户报障);仅官方版自动落盘
   *  失败(校验不过/写盘失败)才给「重试」兜底——表单跟着选择走、动作却
   *  打旧服务是登错服务器,宁可让位。 */
  const editionPending = saveBusy ? (
    <p className="flex items-center gap-2 text-xs text-base-content/60">
      <span className="loading loading-spinner loading-xs" aria-hidden />
      {t("account.edition.switching")}
    </p>
  ) : edition === "private" ? (
    <p className="text-xs text-base-content/60">{t("account.edition.needServerUrl")}</p>
  ) : (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-base-content/60">{t("account.edition.notApplied")}</p>
      {onRetryApply && (
        <button type="button" className="btn btn-sm self-start" onClick={onRetryApply}>
          {t("account.edition.retry")}
        </button>
      )}
    </div>
  );

  const connect = async () => {
    setBusy("connect");
    setMsg(null);
    try {
      await mcLogin();
      if (!isCurrentService()) return;
      // 走 onLoggedIn 而不是 onChanged:连上之后**必须起一次会员模型同步**
      // (旧 UI settings.tsx 三个「连上即自动同步」触发点之一,这处漏迁)。
      // 只刷状态的话:①从没同步过的用户点「连接」,卡片翻成已登录、用量面板
      // 也出来了,模型页「会员模型」组却仍然空着;②更硬的一种——断开时壳
      // 已删掉本机 monkeycode-ohmyagent-key.json,而**重建它的唯一路径**是
      // mc_models_sync → sync_member_models → ensure_ohmyagent_key,不起同步
      // 就是「断开→重连」之后 key 文件仍然缺失,模型还在、却怎么用都鉴权失败。
      await onLoggedIn(serviceGeneration);
    } catch (e) {
      if (isCurrentService()) setMsg({ text: errMsg(e), error: true });
    } finally {
      if (isCurrentService()) setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    setMsg(null);
    try {
      const { warning, cancelled } = await disconnectMc(isCurrentService);
      if (cancelled || !isCurrentService()) return;
      await onChanged();
      if (!isCurrentService()) return;
      // 第四步:把已同步的会员模型从配置里清掉(旧 UI disconnectMcWithCleanup)。
      // 壳侧只删网关 key 与本机 Key 文件,配置里的条目得 UI 自己收——不收的话
      // 那组模型原样留在列表里(会员行没有删除按钮)、还很可能正是默认模型,
      // 断开后新建对话直接发消息就鉴权失败,应用内无路可走。
      const applied = onMcDisconnected?.();
      const cleaned = applied ? t("account.mc.modelsCleared") + syncOutcome(t, applied) : "";
      if (warning) setMsg({ text: warning + cleaned, error: true });
      else if (cleaned) setMsg({ text: cleaned.trimStart() });
    } catch (e) {
      if (isCurrentService()) setMsg({ text: errMsg(e), error: true });
    } finally {
      if (isCurrentService()) setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    setMsg(null);
    try {
      const r: McModelsSyncResult = await mcModelsSync();
      if (!isCurrentService()) return;
      const notes = r.notes?.length ? ` ${r.notes.join(t("common.semiSep"))}` : "";
      // 空结果按失败说(旧 UI 同款,理由同 BaizhiCard.sync):没有会员权益时
      // 「已获取 0 个会员模型…保存后生效」看着像成功;且不往下并入,免得
      // 一次 no-op 合并白白触发自动保存重启引擎
      if (!r.models.length) {
        setMsg({ text: t("account.mc.syncEmpty") + notes, error: true });
        return;
      }
      const applied = onResult?.(r);
      const skipped = applied && applied.skipped.length ? ` ${t("account.sync.skipped", { names: applied.skipped.join(t("common.listSep")) })}` : "";
      setMsg({ text: t("account.mc.syncDone", { models: r.models.length }) + syncOutcome(t, applied) + notes + skipped });
    } catch (e) {
      if (isCurrentService()) setMsg({ text: errMsg(e), error: true });
    } finally {
      if (isCurrentService()) setBusy(null);
    }
  };

  const connected = !!status?.logged_in;
  const user = status?.user;
  const userName = user?.name || user?.username || user?.email || t("account.loggedIn");

  // 登录/桥接即自动同步(语义同 BaizhiCard)。依赖必须与守卫一致:守卫读
  // connected 却只依赖 token,靠的是 onBaizhiLoggedIn 里 refresh 与 bump 被
  // React 批到同一次提交——一旦 connected 晚一次提交才翻真(状态刷新与
  // bump 分批、mc_status 慢一步),effect 早跑完了,这一路同步就永远不发生。
  // 补依赖后要防重复:同一个 token 只认一次边沿,connected 反复翻转不重发
  const syncedToken = useRef(0);
  useEffect(() => {
    if (autoSyncToken > 0 && connected && syncedToken.current !== autoSyncToken) {
      syncedToken.current = autoSyncToken;
      void sync();
    }
    // sync 每渲染新引用但行为稳定,只认 token/连接态边沿
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSyncToken, connected]);

  if (!connected) {
    // 未登录 = 登录页,一张卡收口:顶部版本选择(宿主注入)+ 按版本给的
    // 登录方式。不摆「未连接」账号卡壳——登录前没有账号可陈列(2026-08-15
    // 用户定案)。国内版无百智云会话 = 完整登录 tabs(微信/短信 = 百智云
    // OAuth,账密 = 直连);有百智云会话 = 「连接」+ 账密后备;国际版/
    // 私有化 = 仅账密,表单直接展开(唯一路径不必多点一下)
    const guardedPasswordLogin = async () => {
      if (isCurrentService()) await onLoggedIn(serviceGeneration);
    };
    const cnBridgeRetry = editionReady && edition === "cn" && baizhiLoggedIn;
    return (
      <div className="card card-border bg-base-100">
        <div className="px-4 py-5">
          {/* 单列居中(登录页形态):版本选择、私有化字段、登录方式同列同宽,
              不再一左一中两套对齐打架(2026-08-15 用户报障「好丑」) */}
          <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
            {editionSelector}
            <div className="flex flex-col gap-2">
              {bridgeErr && (
                <span role="alert" className="text-xs text-error">
                  {t("account.mc.connectFailed", { message: bridgeErr })}
                </span>
              )}
              {!editionReady ? (
                editionPending
              ) : edition === "cn" && !baizhiLoggedIn ? (
                <LoginPanel
                  onBaizhiLoggedIn={onBaizhiLoggedIn}
                  passwordTab={{ onLoggedIn: guardedPasswordLogin }}
                />
              ) : cnBridgeRetry ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm w-full"
                    disabled={busy === "connect"}
                    onClick={() => void connect()}
                  >
                    {busy === "connect" && <span className="loading loading-spinner loading-xs" aria-hidden />}
                    {busy === "connect" ? t("account.mc.connecting") : t("account.mc.connect")}
                  </button>
                  {/* 账密登录:不经百智云的手动路径(桥接失败/换账号) */}
                  {pwOpen ? (
                    <div className="flex flex-col gap-2 border-t border-base-300 pt-3">
                      <PasswordForm onLoggedIn={guardedPasswordLogin} />
                      <button
                        type="button"
                        className="btn btn-link btn-xs self-start px-0 font-normal text-base-content/50 no-underline hover:text-base-content"
                        onClick={() => setPwOpen(false)}
                      >
                        {t("account.pw.collapse")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-link btn-xs self-start px-0 font-normal text-base-content/50 no-underline hover:text-base-content"
                      onClick={() => setPwOpen(true)}
                    >
                      {t("account.pw.entry")}
                    </button>
                  )}
                </>
              ) : (
                <PasswordForm onLoggedIn={guardedPasswordLogin} />
              )}
              <MsgLine msg={msg} />
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <AccountCard
      logo="/logo.png"
      // 组头已表明「MonkeyCode 云端」,卡头显登录身份
      title={userName}
      badge={<span className="badge badge-success badge-soft badge-xs shrink-0">{t("account.loggedIn")}</span>}
      subtitle={
        // 副行 = 身份的次级事实:主机名 + 用户 ID(移动端把 ID 摆在邮箱行
        // 下方同一身份块,桌面卡是横向的,并入同一行)
        <>
          <span className="truncate font-mono text-xs text-base-content/50">{status?.host}</span>
          {user?.id && (
            <>
              <span aria-hidden className="shrink-0 text-base-content/30">
                ·
              </span>
              <UserIdChip id={user.id} />
            </>
          )}
        </>
      }
      actions={
        <>
          <button type="button" className="btn btn-sm" disabled={busy === "sync"} onClick={() => void sync()}>
            {busy === "sync" && <span className="loading loading-spinner loading-xs" aria-hidden />}
            {busy === "sync" ? t("account.syncing") : t("account.mc.sync")}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm text-base-content/60"
            disabled={busy === "disconnect"}
            onClick={() => void disconnect()}
          >
            {busy === "disconnect" ? t("account.mc.disconnecting") : t("account.mc.disconnect")}
          </button>
        </>
      }
    >
      {/* 权益面板归卡内次级区块,分隔线切开身份行与权益块 */}
      <div className="border-t border-base-300 pt-3">
        <UsagePanel userId={user?.id} />
      </div>
      <MsgLine msg={msg} />
    </AccountCard>
  );
}

/** MonkeyCode 服务版本选择器:国内/国际官方云 + 私有化三选一。版本纯粹是
 *  mcBaseUrl 三类取值的 UI 表达(mcEditionOf),不另设配置字段;选官方版会
 *  顺带清空私有化的 Basic Auth 与模型地址——它们是私有部署的随行配置,
 *  留着会把 Authorization 头/模型流量继续打向旧的私有主机。
 *  点官方版**当即落盘生效**(onApplyDraft,2026-08-15 用户定案:选版本不该
 *  再多一步保存);私有化要先填地址,字段下给「保存」按钮提交。选择态由
 *  宿主持有,登录卡跟随选择即时切换形态。未登录时本选择器并入登录卡
 *  (整页 = 带版本切换的登录页),已登录时由 EditionBlock 独立成组。 */
function EditionSelector({
  draft,
  onDraft,
  edition,
  onPick,
  onApplyDraft,
  saveBusy = false,
}: {
  draft: SettingsDraft;
  onDraft: (up: (d: SettingsDraft) => SettingsDraft) => void;
  /** 当前所选版本(宿主状态,登录卡与本块共用同一份选择) */
  edition: McEdition;
  onPick: (next: McEdition) => void;
  /** 立即保存合并后的草稿(SettingsView.save(target));缺席退化为只写草稿 */
  onApplyDraft?: (d: SettingsDraft) => void;
  saveBusy?: boolean;
}) {
  const { t } = useI18n();
  const pick = (next: McEdition) => {
    onPick(next);
    // 私有化:不碰草稿——地址由展示层屏蔽官方预填(见字段 value),用户
    // 填好后经「保存生效」提交。不写草稿就不会弄脏表单弹出保存条
    if (next === "private") return;
    const apply = (d: SettingsDraft): SettingsDraft => ({
      ...d,
      mcBaseUrl: next === "intl" ? MC_INTL_URL : "",
      mcBasicAuth: "",
      mcLlmBaseUrl: "",
    });
    onDraft(apply);
    // 一律交给宿主落盘:「与已保存配置无差异就跳过」由 SettingsView 按
    // 载荷对比判定(草稿对比在这里会误判——草稿可能带着未保存的旧编辑)
    onApplyDraft?.(apply(draft));
  };
  const editions: Array<{ value: McEdition; label: string }> = [
    { value: "cn", label: t("account.edition.cn") },
    { value: "intl", label: t("account.edition.intl") },
    { value: "private", label: t("account.edition.private") },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="join" role="radiogroup" aria-label={t("account.edition.title")}>
        {editions.map((e) => (
          <input
            key={e.value}
            type="radio"
            name="mc-edition"
            className="btn btn-sm join-item"
            aria-label={e.label}
            checked={edition === e.value}
            disabled={saveBusy}
            onChange={() => pick(e.value)}
          />
        ))}
      </div>
      {edition === "private" ? (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium">{t("account.server.baseUrl")}</span>
                <input
                  className="input input-sm w-full font-mono"
                  // 官方地址不回显:它不是私有地址,预填只会误导;真私有配置照常
                  value={mcEditionOf(draft.mcBaseUrl) === "private" ? draft.mcBaseUrl : ""}
                  placeholder={t("account.server.baseUrlPlaceholder")}
                  onChange={(e) => onDraft((d) => ({ ...d, mcBaseUrl: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium">{t("account.server.basicAuth")}</span>
                <input
                  type="password"
                  className="input input-sm w-full font-mono"
                  value={draft.mcBasicAuth}
                  placeholder="user:pass"
                  title={t("account.server.basicAuthHint")}
                  onChange={(e) => onDraft((d) => ({ ...d, mcBasicAuth: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium">{t("account.server.llmBaseUrl")}</span>
                <input
                  className="input input-sm w-full font-mono"
                  value={draft.mcLlmBaseUrl}
                  placeholder={t("account.server.llmBaseUrlPlaceholder")}
                  title={t("account.server.llmBaseUrlHint")}
                  onChange={(e) => onDraft((d) => ({ ...d, mcLlmBaseUrl: e.target.value }))}
                />
              </label>
              <p className="text-xs leading-relaxed text-base-content/60">{t("account.server.hint")}</p>
              {onApplyDraft && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm self-start"
                  disabled={saveBusy}
                  onClick={() => onApplyDraft(draft)}
                >
                  {saveBusy && <span className="loading loading-spinner loading-xs" aria-hidden />}
                  {t("account.edition.apply")}
                </button>
              )}
            </>
          ) : (
            /* 官方档:一条官网链接就够——既标明当前指向的服务,也是入口 */
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1 self-start font-mono text-xs text-base-content/50 transition-colors hover:text-base-content"
              onClick={() => openExternal(edition === "intl" ? MC_INTL_URL : MC_CN_URL)}
            >
              {(edition === "intl" ? MC_INTL_URL : MC_CN_URL).replace("https://", "")}
              <IconExternalLink size={12} stroke={1.75} aria-hidden />
            </button>
          )}
    </div>
  );
}


export function AccountSection({
  onSyncResult,
  onMcDisconnected,
  draft,
  onDraft,
  refreshKey = 0,
  savedMcBaseUrl = "",
  onApplyDraft,
  saveBusy = false,
}: {
  /** 同步结果并入设置草稿(SettingsView.applySync);回执含跳过名单与自动保存结论 */
  onSyncResult?: (r: BaizhiSyncResult | McModelsSyncResult) => SyncApplied | undefined | void;
  /** 断开 MonkeyCode 成功后清掉会员模型组(SettingsView.applyMcDisconnect);
   *  回执同 onSyncResult。缺席(浏览器模式/独立渲染)则只断连不清模型。 */
  onMcDisconnected?: () => SyncApplied | undefined | void;
  /** 设置草稿:服务版本与私有化三项在本分区编辑(缺席则不渲染版本块) */
  draft?: SettingsDraft | null;
  onDraft?: (up: (d: SettingsDraft) => SettingsDraft) => void;
  /** 已保存的 MonkeyCode 传输配置变化后递增,触发状态重查。 */
  refreshKey?: number;
  /** 已保存生效的 MonkeyCode 服务地址(SettingsView 传 cfg.mc_base_url)。
   *  登录卡的**形态**跟所选版本即时走,登录**动作**只在选择 = 生效时可用
   *  ——登录打的是当前生效的服务,选择未保存时以「保存并切换」代替表单。 */
  savedMcBaseUrl?: string;
  /** 立即保存指定草稿(SettingsView.save(target)):版本点选/私有化「保存」
   *  钮直接落盘生效。缺席则退化为只写草稿,由保存条兜底。 */
  onApplyDraft?: (d: SettingsDraft) => void;
  saveBusy?: boolean;
} = {}) {
  const { t } = useI18n();
  const inShell = inDesktopShell();
  const showEdition = !!draft && !!onDraft;
  const savedEdition = mcEditionOf(savedMcBaseUrl);
  // 版本选择提升到本层:版本块与登录卡共用同一份,选择一变登录卡立即换
  // 形态(微信码当场撤下),而不是等保存。「刚选私有化、地址还没填」从
  // 草稿推不出来,所以选择态不能只靠 mcBaseUrl 推导
  const [editionChoice, setEditionChoice] = useState<McEdition | null>(null);
  const draftEdition = draft ? mcEditionOf(draft.mcBaseUrl) : savedEdition;
  const selectedEdition = editionChoice ?? draftEdition;
  const editionReady = selectedEdition === savedEdition;
  /** onBaizhiLoggedIn 是稳定回调,经 ref 读最新版本结论,免整链换引用。 */
  const savedEditionRef = useRef(savedEdition);
  savedEditionRef.current = savedEdition;
  const [bz, setBz] = useState<BaizhiStatus | null>(null);
  const [mc, setMc] = useState<McStatus | null>(null);
  /** mc 的最新值(由 refresh 就地写):异步流程里紧接着 await refresh() 判连接
   *  态时,闭包里的 mc state 还没提交,只能读 ref。 */
  const mcRef = useRef<McStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [statusErr, setStatusErr] = useState("");
  const [bridgeErr, setBridgeErr] = useState("");
  const alive = useRef(true);
  const refreshGeneration = useRef(0);
  const appliedRefreshKey = useRef(refreshKey);
  const serviceGenerationRef = useRef(refreshKey);
  serviceGenerationRef.current = refreshKey;
  const isServiceGenerationCurrent = useCallback(
    (generation: number) => serviceGenerationRef.current === generation,
    [],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const [b, m] = await Promise.allSettled([baizhiStatus(), mcStatus()]);
    if (!alive.current || generation !== refreshGeneration.current) return;
    // 单路失败不拖垮另一路:失败信息合并外显,成功的一路照常渲染
    const errs: string[] = [];
    if (b.status === "fulfilled") setBz(b.value);
    else errs.push(errMsg(b.reason));
    if (m.status === "fulfilled") {
      setMc(m.value);
      // 就地镜像给 onBaizhiLoggedIn 的「已连不打扰」守卫:它 await 完 refresh
      // 紧接着就要判,而那一刻闭包里的 mc state 还是上一次渲染的旧值
      mcRef.current = m.value;
    } else errs.push(errMsg(m.reason));
    setStatusErr(errs.join(t("common.semiSep")));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!inShell) return;
    if (appliedRefreshKey.current !== refreshKey) {
      appliedRefreshKey.current = refreshKey;
      mcRef.current = null;
      setMc(null);
      setStatusErr("");
    }
    void refresh();
  }, [inShell, refresh, refreshKey]);

  // 登录真实事件的自动同步信号(0 = 无;只在下面两个登录回调里 bump,
  // 打开设置读到既有登录态不触发)——「登录成功即自动同步」是旧 UI 用户
  // 拍板行为,ui-next 首版漏迁(2026-08-06 用户报障:登录后模型/MCP 没
  // 同步上,实为压根没触发)
  const [bzSyncToken, setBzSyncToken] = useState(0);
  const [mcSyncToken, setMcSyncToken] = useState(0);

  /** 百智云真实登录事件:先刷出已登录形态并起百智云同步,再尝试桥接
   *  MonkeyCode(同一账号的 OAuth,登录一次两边都通),桥接成功顺带起
   *  会员模型同步。 */
  const onBaizhiLoggedIn = useCallback(async () => {
    const serviceGeneration = serviceGenerationRef.current;
    setBridgeErr("");
    await refresh();
    setBzSyncToken((n) => n + 1);
    if (!isServiceGenerationCurrent(serviceGeneration)) return;
    // 仅国内版自动桥接:国际版未接百智云 OAuth,私有化不桥接——非国内版
    // 的百智云登录只为模型/MCP 同步(UI 上也只从增值入口可达,这里兜底)
    if (savedEditionRef.current !== "cn") return;
    // **已连就不打扰**(旧 UI settings.tsx:1288「已连/连接中/读取中一律不打扰」,
    // ui-next 漏迁)。「MC 已连 + 百智云未登录」是本仓测试自己钉住的可达状态:
    // 用户先用账密连了 A 账号(私有化/公司账号常见),之后在同一页登录百智云
    // (B 账号)只是想拿模型与 MCP —— 无条件桥接会拿 B 的会话对 MonkeyCode
    // 重走一遍 OAuth(壳侧 login_monkeycode 会带着现有 cookie 罐走完整条链),
    // 服务端据此改发 B 的会话的话,侧栏云端任务列表与会员模型组会整个换人;
    // 即便仍是同账号,这也是一次没被要求的重登 + 重同步(干净表单时还会顺带
    // 写盘重启引擎)。mcRef 由 refresh 就地写,不读闭包里的旧 state。
    if (mcRef.current?.logged_in) return;
    try {
      await mcLogin();
      if (!isServiceGenerationCurrent(serviceGeneration)) return;
      await refresh();
      if (!isServiceGenerationCurrent(serviceGeneration)) return;
      setMcSyncToken((n) => n + 1);
    } catch (e) {
      if (!isServiceGenerationCurrent(serviceGeneration)) return;
      if (alive.current) setBridgeErr(errMsg(e));
      await refresh();
    }
  }, [isServiceGenerationCurrent, refresh]);

  const onMcLoggedIn = useCallback(async (generation: number) => {
    await refresh();
    if (!isServiceGenerationCurrent(generation)) return;
    setMcSyncToken((n) => n + 1);
  }, [isServiceGenerationCurrent, refresh]);

  const mcConnected = !!mc?.logged_in;

  if (!inShell) {
    return (
      <section aria-label={t("settings.nav.account")} className="flex max-w-xl flex-col gap-3">
        <div role="alert" className="alert alert-warning alert-soft max-w-md text-xs">
          {t("account.browserOnly")}
        </div>
      </section>
    );
  }

  return (
    <section aria-label={t("settings.nav.account")} className="flex max-w-xl flex-col gap-3">
      {statusErr && (
        <div role="alert" className="alert alert-error alert-soft max-w-md text-xs">
          <span>{t("account.statusFailed", { message: statusErr })}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => void refresh()}>
            {t("account.retry")}
          </button>
        </div>
      )}
      {!loaded && !statusErr && <span className="text-xs text-base-content/50">{t("account.loading")}</span>}
      {loaded && (
        <>
          {/* 版本选择只在登录页出现(并入登录卡):登录后切版本 = 换账号,
              正路是「断开连接」回登录页再选,已登录视图不摆切换器
              (2026-08-15 用户定案) */}
          {/* MonkeyCode 账号(唯一的账号概念):微信/短信只是国内版经百智云
              OAuth 登录 MonkeyCode 的方式 */}
          <div className="flex flex-col gap-1.5">
            {mcConnected && (
              <h3 className="px-1 text-xs font-bold text-base-content/60">{t("account.mc.title")}</h3>
            )}
            <McCard
              status={mc}
              baizhiLoggedIn={!!bz?.logged_in}
              edition={selectedEdition}
              editionReady={editionReady}
              onRetryApply={onApplyDraft && draft ? () => onApplyDraft(draft) : undefined}
              saveBusy={saveBusy}
              editionSelector={
                !mcConnected && showEdition ? (
                  <EditionSelector
                    draft={draft!}
                    onDraft={onDraft!}
                    edition={selectedEdition}
                    onPick={setEditionChoice}
                    onApplyDraft={onApplyDraft}
                    saveBusy={saveBusy}
                  />
                ) : undefined
              }
              bridgeErr={bridgeErr}
              onChanged={refresh}
              onLoggedIn={onMcLoggedIn}
              onBaizhiLoggedIn={() => void onBaizhiLoggedIn()}
              onMcDisconnected={onMcDisconnected}
              onResult={onSyncResult}
              autoSyncToken={mcSyncToken}
              serviceGeneration={refreshKey}
              isServiceGenerationCurrent={isServiceGenerationCurrent}
            />
          </div>
          {/* 百智云服务(增值,不与账号并列;国际版整组隐藏):会话在给
              模型/MCP 同步;MC 已连而百智云未登录给可选登录入口——两头都
              没登录时不出现,登录职责在上面的 MonkeyCode 卡内 */}
          {savedEdition !== "intl" && (bz?.logged_in || mc?.logged_in) && (
            <div className="flex flex-col gap-1.5">
              <h3 className="px-1 text-xs font-bold text-base-content/60">{t("account.baizhi.title")}</h3>
              {bz?.logged_in ? (
                <BaizhiCard
                  status={bz}
                  knownKeys={knownApiKeys(draft)}
                  onChanged={refresh}
                  onResult={onSyncResult}
                  autoSyncToken={bzSyncToken}
                />
              ) : (
                <BaizhiOptInCard onBaizhiLoggedIn={() => void onBaizhiLoggedIn()} />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** 百智云可选登录卡(MC 已连、百智云未登录):默认折叠——微信 tab 挂载
 *  即拉码,不该在没人要登录时就去拉二维码。不带账密 tab:这里登的是
 *  百智云(为模型/MCP 同步),账密是 MonkeyCode 的登录方式。已连不打扰
 *  守卫(onBaizhiLoggedIn 里 mcRef 判断)保证这条路不会重桥接换掉账号。 */
function BaizhiOptInCard({ onBaizhiLoggedIn }: { onBaizhiLoggedIn: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="card card-border bg-base-100">
      <div className="flex flex-col gap-2 p-4">
        <p className="text-xs text-base-content/60">{t("account.baizhi.optInHint")}</p>
        {open ? (
          <div className="mx-auto w-full max-w-sm">
            <LoginPanel onBaizhiLoggedIn={onBaizhiLoggedIn} />
          </div>
        ) : (
          <button type="button" className="btn btn-sm self-start" onClick={() => setOpen(true)}>
            {t("account.baizhi.optIn")}
          </button>
        )}
      </div>
    </div>
  );
}
