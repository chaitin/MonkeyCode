// 登录面板:微信扫码 / 短信验证码(百智云 OAuth 路径),可选第三 tab
// 「账号密码」(MonkeyCode 直连)。
//
// - 微信扫码:状态机在 lib/account/wechatFlow(可注入 poll/时钟),本层只
//   消费快照;expired/error 在二维码上覆「重新获取」,canceled 由状态机
//   自行回待扫。
// - 短信:手机号弱校验(1[3-9] 开头 11 位)+ 60s 倒计时发码按钮。
// - 登录成功只报边沿(onBaizhiLoggedIn / passwordTab.onLoggedIn),状态刷新
//   与 MonkeyCode 桥接由宿主 AccountSection 统一处理。
// - 账密 tab 只在国内版登录卡出现(passwordTab 传入);百智云增值登录
//   (仅为同步模型/MCP)不带它——那不是 MonkeyCode 的登录入口。
// - 引导语不在本面板:宿主卡的副行负责说明可用方式,面板不再重复。
//
// 字段一律用本文件的紧凑排布(标签 12px + gap-1),不用 daisyUI .fieldset:
// 后者 legend 上下各 8px + 栅格 6px + 容器 4px,两三个字段的登录表单会被摊
// 成几段空白(用户报障:「账号密码登录真的丑」)。
import { useEffect, useRef, useState, type ReactNode } from "react";

import { createWechatFlow, WECHAT_IDLE, type WechatFlow, type WechatSnapshot } from "@/lib/account/wechatFlow";
import { useI18n } from "@/lib/i18n";
import { baizhiLogin, baizhiSendCode, baizhiWechatPoll, baizhiWechatStart, mcPasswordLogin } from "@/lib/ipc/account";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const phoneValid = (v: string) => /^1[3-9]\d{9}$/.test(v);
const codeValid = (v: string) => /^\d{4,6}$/.test(v);

/** 单控件字段:整块是 label,可访问名取自标签文本(不再逐个 aria-label)。 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-base-content/70">{label}</span>
      {children}
    </label>
  );
}

/** 微信扫码卡:二维码 + 状态遮罩。导出给服务行的登录窗格直用。 */
export function WechatTab({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useI18n();
  const [snap, setSnap] = useState<WechatSnapshot>(WECHAT_IDLE);
  const flowRef = useRef<WechatFlow | null>(null);
  // 登录回调走 ref:ok 只触发一次,且不因宿主重建回调而重跑 effect
  const loggedInRef = useRef(onLoggedIn);
  loggedInRef.current = onLoggedIn;

  useEffect(() => {
    const flow = createWechatFlow({ start: baizhiWechatStart, poll: baizhiWechatPoll, onChange: setSnap });
    flowRef.current = flow;
    void flow.begin(); // 进 tab 即自动拉码
    return () => flow.dispose(); // 切走/卸载作废轮询
  }, []);

  useEffect(() => {
    if (snap.phase === "ok") loggedInRef.current();
  }, [snap.phase]);

  const hintKey = {
    idle: "account.wechat.loading",
    loading: "account.wechat.loading",
    waiting: "account.wechat.waiting",
    scanned: "account.wechat.scanned",
    ok: "account.wechat.scanned",
    expired: "account.wechat.expired",
    error: "account.wechat.error",
  } as const;
  const needRetry = snap.phase === "expired" || snap.phase === "error";

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="card card-border relative size-42 items-center justify-center overflow-hidden">
        {snap.qr && (
          <img
            src={snap.qr}
            alt={t("account.wechat.qrAlt")}
            draggable={false}
            className={needRetry ? "size-full object-contain opacity-30 blur-sm" : "size-full object-contain"}
          />
        )}
        {!snap.qr && !needRetry && <span className="loading loading-spinner loading-sm" aria-hidden />}
        {needRetry && (
          <button
            type="button"
            className="btn btn-sm absolute"
            onClick={() => void flowRef.current?.begin()}
          >
            {t("account.wechat.refresh")}
          </button>
        )}
      </div>
      <span className={snap.phase === "scanned" ? "text-xs font-semibold text-success" : "text-xs text-base-content/60"}>
        {t(hintKey[snap.phase])}
      </span>
      {snap.error && (
        <span role="alert" className="text-xs text-error">
          {snap.error}
        </span>
      )}
    </div>
  );
}

/** 短信验证码卡:手机号 + 验证码 + 60s 倒计时发码按钮。导出同 WechatTab。 */
export function SmsTab({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useI18n();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((v) => Math.max(0, v - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const send = async () => {
    setErr("");
    if (!phoneValid(phone)) {
      setErr(t("account.error.phone"));
      return;
    }
    setSending(true);
    try {
      await baizhiSendCode(phone);
      setCountdown(60);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSending(false);
    }
  };

  const login = async () => {
    setErr("");
    if (!phoneValid(phone)) {
      setErr(t("account.error.phone"));
      return;
    }
    if (!codeValid(code)) {
      setErr(t("account.error.code"));
      return;
    }
    setBusy(true);
    try {
      await baizhiLogin(phone, code);
      onLoggedIn(); // 之后本卡随宿主刷新卸载,不再碰本地 state
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };

  return (
    // 表单元素:两个字段里回车都能提交(发码钮 type=button 不触发提交)
    <form
      className="flex flex-col gap-2.5 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void login();
      }}
    >
      <Field label={t("account.sms.phone")}>
        <input
          className="input input-sm w-full"
          value={phone}
          placeholder={t("account.sms.phonePlaceholder")}
          inputMode="numeric"
          autoComplete="tel"
          maxLength={11}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
        />
      </Field>
      {/* 验证码字段是「输入框 + 发码钮」两个控件,不能整块套 label
          (点发码钮会连带激活 label 把焦点甩回输入框):标签走独立 span,
          可访问名回落 aria-label */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-base-content/70">{t("account.sms.code")}</span>
        <div className="flex gap-2">
          <input
            className="input input-sm flex-1"
            aria-label={t("account.sms.code")}
            value={code}
            placeholder={t("account.sms.codePlaceholder")}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <button type="button" className="btn btn-sm" disabled={sending || countdown > 0} onClick={() => void send()}>
            {sending
              ? t("account.sms.sending")
              : countdown > 0
                ? t("account.sms.countdown", { seconds: countdown })
                : t("account.sms.send")}
          </button>
        </div>
      </div>
      {err && (
        <span role="alert" className="text-xs text-error">
          {err}
        </span>
      )}
      {/* 主行动占满面板宽:面板只有这一件事可做,小钮缩在左下角反而像附注 */}
      <button type="submit" className="btn btn-primary btn-sm mt-0.5 w-full" disabled={busy}>
        {busy && <span className="loading loading-spinner loading-xs" aria-hidden />}
        {busy ? t("account.sms.loggingIn") : t("account.sms.login")}
      </button>
    </form>
  );
}

/** MonkeyCode 账号密码登录(不经百智云;壳内自动 PoW)。导出给账号卡的
 *  「未连接」态复用(百智云已登录但桥接不可用/不同账号的手动路径)。 */
export function PasswordForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const login = async () => {
    setErr("");
    // 弱校验对齐壳侧:仅非空;password 不 trim(首尾空格是密码的一部分)
    if (!email.trim() || !password) {
      setErr(t("account.pw.error"));
      return;
    }
    setBusy(true);
    try {
      await mcPasswordLogin(email.trim(), password);
      onLoggedIn();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void login();
      }}
    >
      <Field label={t("account.pw.email")}>
        <input
          className="input input-sm w-full"
          type="email"
          autoComplete="username"
          placeholder={t("account.pw.emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label={t("account.pw.password")}>
        <input
          className="input input-sm w-full"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {err && (
        <span role="alert" className="text-xs text-error">
          {err}
        </span>
      )}
      <button type="submit" className="btn btn-primary btn-sm mt-0.5 w-full" disabled={busy}>
        {busy && <span className="loading loading-spinner loading-xs" aria-hidden />}
        {t("account.pw.login")}
      </button>
    </form>
  );
}

export function LoginPanel({
  onBaizhiLoggedIn,
}: {
  /** 百智云真实登录事件(短信/扫码成功各一次);宿主刷新状态并顺带桥接。
   *  仅百智云增值登录用(微信/短信两 tab);MonkeyCode 服务行的登录 tabs
   *  由 ServiceCard 自排(tab 在行头,窗格直用 WechatTab/SmsTab)。 */
  onBaizhiLoggedIn: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"wechat" | "sms">("wechat");
  const tab = (key: "wechat" | "sms", label: string) => (
    <button
      type="button"
      role="tab"
      className={mode === key ? "tab tab-active" : "tab"}
      aria-selected={mode === key}
      onClick={() => setMode(key)}
    >
      {label}
    </button>
  );

  return (
    <div className="flex max-w-sm flex-col gap-1">
      <div role="tablist" className="tabs tabs-border">
        {tab("wechat", t("account.tab.wechat"))}
        {tab("sms", t("account.tab.sms"))}
      </div>
      {mode === "wechat" ? <WechatTab onLoggedIn={onBaizhiLoggedIn} /> : <SmsTab onLoggedIn={onBaizhiLoggedIn} />}
    </div>
  );
}
