// 设置页「账号」分区:百智云账号(短信/微信扫码登录、模型与 MCP 同步)+
// MonkeyCode 云账号(桥接/账密登录、用量/签到/邀请、会员模型同步)。
//
// 状态语义:
// - 两路登录态挂载时并发自取(baizhi_status / mc_status),不进全局轮询;
// - 百智云登录成功顺带桥接 MonkeyCode(mc_login 走同一账号的 OAuth),
//   桥接失败不阻断——MonkeyCode 卡保留手动「连接」入口;
// - 断开 MonkeyCode 必须先吊销会员模型密钥再清会话(disconnectMc 收口,
//   顺序由 lib 与本组件测试双重钉住);
// - 同步(baizhi_sync / mc_models_sync)结果经 onSyncResult 交
//   SettingsView.applySync 并入草稿;干净表单+无任务在跑时那边自动保存,
//   否则回退保存条——结果行按 autoSaved/blocked 说明白落到哪一步了;
//   百智云同步把表单此刻持有的网关密钥(knownApiKeys)一并交给壳复用,
//   不传的话每同步一次就在用户网关账号里多建一把密钥。
import { IconCheck, IconCopy } from "@tabler/icons-react";
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
import { inDesktopShell } from "@/lib/ipc/ipc";
import { copyText } from "@/lib/util/clipboard";
import type { SettingsDraft } from "@/features/settings/settingsForm";
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
    <span role={msg.error ? "alert" : "status"} className={msg.error ? "text-xs text-error" : "text-xs text-base-content/60"}>
      {msg.text}
    </span>
  );
}

/** 账号卡壳(旧 UI 设置屏同款形态):logo + 标题/状态徽标 + 副行在左,
 *  动作钮靠右;扩展内容(用量面板/提示行)另起一行。 */
function AccountCard({
  logo,
  onLogoClick,
  title,
  badge,
  subtitle,
  actions,
  children,
}: {
  logo: string;
  /** 连点 logo 的彩蛋钩子(自建部署配置解锁;不传即普通装饰图) */
  onLogoClick?: () => void;
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
          {/* 彩蛋钩子挂在图上就够:它不是功能入口,不进 tab 序、不报可及名 */}
          <img
            src={logo}
            alt=""
            aria-hidden
            draggable={false}
            className="h-9 w-9 shrink-0 rounded-lg"
            onClick={onLogoClick}
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
  bridgeErr,
  onChanged,
  onLoggedIn,
  onMcDisconnected,
  onResult,
  autoSyncToken = 0,
  onLogoClick,
}: {
  status: McStatus | null;
  /** 百智云是否已登录:决定「连接」主钮出不出(桥接要拿百智云会话去换
   *  MonkeyCode 会话,未登录时点它必失败,不摆这个死钮) */
  baizhiLoggedIn: boolean;
  /** 百智云登录后自动桥接的失败信息(不阻断,卡内外显并留手动重试) */
  bridgeErr: string;
  onChanged: () => Promise<void>;
  /** 账密登录/点「连接」成功:宿主刷新状态并起一次会员模型同步(与桥接登录同待遇) */
  onLoggedIn: () => Promise<void>;
  /** 断开成功后清掉会员模型组(宿主 applyMcDisconnect) */
  onMcDisconnected?: () => SyncApplied | undefined | void;
  /** 同步结果交宿主并入设置草稿;回执带跳过名单与自动保存结论(卡内外显) */
  onResult?: (r: McModelsSyncResult) => SyncApplied | undefined | void;
  /** 连点卡图标的彩蛋钩子(自建部署配置解锁),由分区计数 */
  onLogoClick?: () => void;
  /** 登录/桥接真实事件的自动同步信号(语义同 BaizhiCard.autoSyncToken) */
  autoSyncToken?: number;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<"connect" | "disconnect" | "sync" | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [pwOpen, setPwOpen] = useState(false);

  const connect = async () => {
    setBusy("connect");
    setMsg(null);
    try {
      await mcLogin();
      // 走 onLoggedIn 而不是 onChanged:连上之后**必须起一次会员模型同步**
      // (旧 UI settings.tsx 三个「连上即自动同步」触发点之一,这处漏迁)。
      // 只刷状态的话:①从没同步过的用户点「连接」,卡片翻成已登录、用量面板
      // 也出来了,模型页「会员模型」组却仍然空着;②更硬的一种——断开时壳
      // 已删掉本机 monkeycode-ohmyagent-key.json,而**重建它的唯一路径**是
      // mc_models_sync → sync_member_models → ensure_ohmyagent_key,不起同步
      // 就是「断开→重连」之后 key 文件仍然缺失,模型还在、却怎么用都鉴权失败。
      await onLoggedIn();
    } catch (e) {
      setMsg({ text: errMsg(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    setMsg(null);
    try {
      const { warning } = await disconnectMc();
      await onChanged();
      // 第四步:把已同步的会员模型从配置里清掉(旧 UI disconnectMcWithCleanup)。
      // 壳侧只删网关 key 与本机 Key 文件,配置里的条目得 UI 自己收——不收的话
      // 那组模型原样留在列表里(会员行没有删除按钮)、还很可能正是默认模型,
      // 断开后新建对话直接发消息就鉴权失败,应用内无路可走。
      const applied = onMcDisconnected?.();
      const cleaned = applied ? t("account.mc.modelsCleared") + syncOutcome(t, applied) : "";
      if (warning) setMsg({ text: warning + cleaned, error: true });
      else if (cleaned) setMsg({ text: cleaned.trimStart() });
    } catch (e) {
      setMsg({ text: errMsg(e), error: true });
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    setMsg(null);
    try {
      const r: McModelsSyncResult = await mcModelsSync();
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
      setMsg({ text: errMsg(e), error: true });
    } finally {
      setBusy(null);
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
    return (
      <AccountCard
        logo="/logo.png"
        onLogoClick={onLogoClick}
        title={t("account.notConnected")}
        subtitle={
          <span className="truncate">
            {baizhiLoggedIn ? t("account.mc.notConnected") : t("account.mc.notConnectedIdle")}
          </span>
        }
        actions={
          baizhiLoggedIn && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy === "connect"}
              onClick={() => void connect()}
            >
              {busy === "connect" && <span className="loading loading-spinner loading-xs" aria-hidden />}
              {busy === "connect" ? t("account.mc.connecting") : t("account.mc.connect")}
            </button>
          )
        }
      >
        {bridgeErr && (
          <span role="alert" className="text-xs text-error">
            {t("account.mc.connectFailed", { message: bridgeErr })}
          </span>
        )}
        {/* 账密登录:不经百智云的手动路径(桥接失败/私有化/换账号)。入口与
            表单都在本卡内——它登的是 MonkeyCode 账号,挂在百智云登录卡下方
            是把两块账号串到一处(用户报障 2026-08-06) */}
        {pwOpen ? (
          <div className="flex max-w-sm flex-col gap-2 border-t border-base-300 pt-3">
            <p className="text-xs text-base-content/60">{t("account.pw.hint")}</p>
            <PasswordForm onLoggedIn={onLoggedIn} />
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
        <MsgLine msg={msg} />
      </AccountCard>
    );
  }
  return (
    <AccountCard
      logo="/logo.png"
      onLogoClick={onLogoClick}
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

const SERVER_CFG_KEY = "mc.serverConfigUnlocked";
const UNLOCK_CLICKS = 6;

/** 自建/私有化部署地址(账号分区末尾的高级块)。默认隐藏:连点 MonkeyCode
 *  卡图标 6 次解锁,解锁态持久;已配置过任一项的用户恒可见——否则升级后
 *  自己的配置凭空消失(旧 UI 同款门禁)。三项都进保存条,但壳在启动时才
 *  构造云端服务,故保存后还要**重启应用**才生效。 */
function ServerConfigBlock({
  draft,
  onDraft,
}: {
  draft: SettingsDraft;
  onDraft: (up: (d: SettingsDraft) => SettingsDraft) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="px-1 text-xs font-bold text-base-content/60">{t("account.server.title")}</h3>
      <div className="card card-border bg-base-100">
        <div className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">{t("account.server.baseUrl")}</span>
            <input
              className="input input-sm w-full font-mono"
              value={draft.mcBaseUrl}
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
        </div>
      </div>
    </div>
  );
}

export function AccountSection({
  onSyncResult,
  onMcDisconnected,
  draft,
  onDraft,
}: {
  /** 同步结果并入设置草稿(SettingsView.applySync);回执含跳过名单与自动保存结论 */
  onSyncResult?: (r: BaizhiSyncResult | McModelsSyncResult) => SyncApplied | undefined | void;
  /** 断开 MonkeyCode 成功后清掉会员模型组(SettingsView.applyMcDisconnect);
   *  回执同 onSyncResult。缺席(浏览器模式/独立渲染)则只断连不清模型。 */
  onMcDisconnected?: () => SyncApplied | undefined | void;
  /** 设置草稿:自建部署三项在本分区编辑(缺席则不渲染高级块) */
  draft?: SettingsDraft | null;
  onDraft?: (up: (d: SettingsDraft) => SettingsDraft) => void;
} = {}) {
  const { t } = useI18n();
  const inShell = inDesktopShell();
  // 自建部署块的解锁态:存量配置恒可见,否则连点 logo 6 次解锁并落盘
  const [unlocked, setUnlocked] = useState(() => {
    try {
      return localStorage.getItem(SERVER_CFG_KEY) === "1";
    } catch {
      return false;
    }
  });
  const logoClicks = useRef(0);
  const onLogoClick = () => {
    if (++logoClicks.current < UNLOCK_CLICKS) return;
    setUnlocked(true);
    try {
      localStorage.setItem(SERVER_CFG_KEY, "1");
    } catch {
      // 存储不可写:本次会话仍解锁,不值得外显
    }
  };
  const configured = !!(draft && (draft.mcBaseUrl.trim() || draft.mcBasicAuth.trim() || draft.mcLlmBaseUrl.trim()));
  const showServerCfg = !!draft && !!onDraft && (unlocked || configured);
  const [bz, setBz] = useState<BaizhiStatus | null>(null);
  const [mc, setMc] = useState<McStatus | null>(null);
  /** mc 的最新值(由 refresh 就地写):异步流程里紧接着 await refresh() 判连接
   *  态时,闭包里的 mc state 还没提交,只能读 ref。 */
  const mcRef = useRef<McStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [statusErr, setStatusErr] = useState("");
  const [bridgeErr, setBridgeErr] = useState("");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const [b, m] = await Promise.allSettled([baizhiStatus(), mcStatus()]);
    if (!alive.current) return;
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
    if (inShell) void refresh();
  }, [inShell, refresh]);

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
    setBridgeErr("");
    await refresh();
    setBzSyncToken((n) => n + 1);
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
      await refresh();
      setMcSyncToken((n) => n + 1);
    } catch (e) {
      if (alive.current) setBridgeErr(errMsg(e));
      await refresh();
    }
  }, [refresh]);

  const onMcLoggedIn = useCallback(async () => {
    await refresh();
    setMcSyncToken((n) => n + 1);
  }, [refresh]);

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
          {/* 百智云组(主路径):已登录成账号卡,未登录成登录卡 */}
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
              <BaizhiLoginCard>
                <LoginPanel onBaizhiLoggedIn={() => void onBaizhiLoggedIn()} />
              </BaizhiLoginCard>
            )}
          </div>
          {/* MonkeyCode 组恒在(2026-08-06 用户定案):两个账号 = 两块,
              MonkeyCode 的连接/账密登录入口都在本块内。未登录时卡里不摆
              「连接」死钮——桥接需要百智云会话,只留账密登录这条手动路径 */}
          <div className="flex flex-col gap-1.5">
            <h3 className="px-1 text-xs font-bold text-base-content/60">{t("account.mc.title")}</h3>
            <McCard
              status={mc}
              baizhiLoggedIn={!!bz?.logged_in}
              bridgeErr={bridgeErr}
              onChanged={refresh}
              onLoggedIn={onMcLoggedIn}
              onMcDisconnected={onMcDisconnected}
              onResult={onSyncResult}
              autoSyncToken={mcSyncToken}
              onLogoClick={onLogoClick}
            />
          </div>
          {showServerCfg && <ServerConfigBlock draft={draft!} onDraft={onDraft!} />}
        </>
      )}
    </section>
  );
}

/** 百智云未登录卡壳:纯卡片承载登录面板(组头已表明身份,卡内不再放头)。 */
function BaizhiLoginCard({ children }: { children: ReactNode }) {
  return (
    <div className="card card-border bg-base-100">
      {/* 登录面板居中:卡宽 > 面板宽,靠左会剩一大块死白 */}
      <div className="p-4">
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
