// 百智云账号卡(登录走内核代理;交互对齐移动端手机验证码登录)。
// 登录态由宿主(SettingsShell)持有并受控传入——账号是产品主入口,
// 模型/MCP 页的未登录引导条也要消费同一份状态。
import { useEffect, useRef, useState } from "react";
import {
  baizhiLogin,
  baizhiLogout,
  baizhiSendCode,
  baizhiWechatPoll,
  baizhiWechatStart,
} from "./baizhiapi";
import type { BaizhiStatus } from "./types";
import { MONO } from "./components";
import { Field, input, whiteBtn } from "./settings-ui";
import baizhiLogoUrl from "./baizhi-logo.png";

/** 百智云品牌标(官方位图去白边紧裁;不随导航态染色,当徽标用)。
 * 签名对齐导航图标组件({size, color}),color 忽略。 */
export function BaizhiLogo({ size = 14 }: { size?: number; color?: string }) {
  return (
    <img
      src={baizhiLogoUrl}
      alt=""
      draggable={false}
      style={{ width: size, height: size, flex: "none", display: "block" }}
    />
  );
}

const phoneValid = (v: string) => /^1[3-9]\d{9}$/.test(v.trim());

/** profile 字段对内核不透明,展示名尽力提取常见字段。 */
export function profileName(p?: Record<string, unknown>): string {
  for (const k of ["name", "nickname", "username", "phone", "email"]) {
    const v = p?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "已登录";
}

type WxState = "loading" | "waiting" | "scanned" | "expired" | "canceled" | "error";

export function BaizhiCard({
  status,
  statusErr,
  refreshStatus,
  syncing,
  syncMsg,
  onSync,
  onLoggedIn,
}: {
  /** 登录态(宿主查询并持有;null=读取中) */
  status: BaizhiStatus | null;
  /** 登录态查询失败信息(空串=正常) */
  statusErr: string;
  /** 让宿主重新查询登录态(登录/登出/扫码成功后调用) */
  refreshStatus: () => Promise<void>;
  /** 同步的进行态与结果文案。同步流水线(拉取→并入表单→自动保存)整体在
   * SettingsView:登录会同时起百智云与 MonkeyCode 两路同步,任一路先落地都会
   * 把分区切到模型页(mergeSyncedModels),本卡随之卸载——挂在卡里的收尾会把
   * 这一路已经拉到的模型与 MCP 一起丢掉,只剩先到的那一组 */
  syncing: boolean;
  syncMsg: { text: string; color: string } | null;
  onSync: () => void;
  /** 真实登录事件(短信/扫码成功各一次)。宿主据此顺带连上 MonkeyCode
   * ——只报边沿,不报 status 快照:后者每次打开设置都会翻转 */
  onLoggedIn?: () => void;
}) {
  const [mode, setMode] = useState<"wechat" | "phone">("wechat");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [err, setErr] = useState("");
  const [qr, setQr] = useState("");
  const [wxState, setWxState] = useState<WxState>("loading");
  const mounted = useRef(true);
  const wxGen = useRef(0); // 代号:模式切换/重新获取/卸载时作废旧轮询循环

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      wxGen.current++;
    };
  }, []);

  const startWechat = async () => {
    const gen = ++wxGen.current;
    const live = () => mounted.current && gen === wxGen.current;
    setErr("");
    setQr("");
    setWxState("loading");
    try {
      const r = await baizhiWechatStart();
      if (!live()) return;
      setQr(r.qr);
      setWxState("waiting");
      // 顺序长轮询:内核侧一次最长挂 ~35s,拿到结果立即续
      for (;;) {
        const res = await baizhiWechatPoll();
        if (!live()) return;
        if (res.status === "waiting" || res.status === "scanned") {
          setWxState(res.status);
          continue;
        }
        if (res.status === "ok") {
          await refreshStatus();
          // 登录成功即自动同步(用户拍板,免手动点)。两个回调都在宿主
          // (SettingsView),这里不再补 mounted 判据:refreshStatus 期间另一路
          // 同步可能落地并切分区把本卡卸载,漏掉就等于登录了却什么都不同步。
          // 也不能用 live() 甄别——loggedIn 翻转会触发拉码 effect 的 cleanup
          // 使 gen 作废,而这里恰恰是登录成功之后
          onLoggedIn?.();
          onSync();
          return;
        }
        setWxState(res.status); // expired / canceled → 引导重新获取
        return;
      }
    } catch (e) {
      if (!live()) return;
      setWxState("error");
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  // 未登录 + 微信模式 → 自动拉码;切走或卸载即作废轮询
  const loggedIn = !!status?.logged_in;
  useEffect(() => {
    if (!status || loggedIn || mode !== "wechat") return;
    void startWechat();
    return () => {
      wxGen.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅按状态/模式触发
  }, [status, loggedIn, mode]);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((v) => Math.max(0, v - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const sendCode = async () => {
    setErr("");
    if (!phoneValid(phone)) {
      setErr("请输入有效的手机号");
      return;
    }
    setCodeBusy(true);
    try {
      await baizhiSendCode(phone.trim());
      setCountdown(60);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCodeBusy(false);
    }
  };

  const login = async () => {
    setErr("");
    if (!phoneValid(phone)) {
      setErr("请输入有效的手机号");
      return;
    }
    if (!/^\d{4,6}$/.test(code.trim())) {
      setErr("请输入短信验证码");
      return;
    }
    setBusy(true);
    try {
      await baizhiLogin(phone.trim(), code.trim());
      await refreshStatus();
      if (mounted.current) setCode("");
      // 同上:登录成功即自动同步,两个回调在宿主,卡是否还挂着都要走
      onLoggedIn?.();
      onSync();
    } catch (e) {
      if (mounted.current) setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const logout = async () => {
    setErr("");
    try {
      await baizhiLogout();
      await refreshStatus();
    } catch (e) {
      if (mounted.current) setErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (statusErr) {
    return (
      <div className="card card-lg" style={{ color: "var(--err)", fontSize: 12.5 }}>
        百智云状态读取失败: {statusErr}
      </div>
    );
  }
  if (!status) {
    return <div className="card card-lg" style={{ color: "var(--t5)", fontSize: 12.5 }}>读取登录状态中…</div>;
  }

  if (status.logged_in) {
    return (
      <div className="card card-lg" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BaizhiLogo size={30} />
          <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
            <span className="ellipsis" style={{ fontWeight: 700, fontSize: 13 }}>{profileName(status.profile)}</span>
            <span className="ellipsis" style={{ fontSize: 11.5, color: "var(--t5)", fontFamily: MONO }}>{status.host}</span>
          </div>
          <span style={{ flex: 1 }} />
          {err && <span style={{ fontSize: 12, color: "var(--err)", flex: "none" }}>{err}</span>}
          <button
            className="hv-acc"
            onClick={() => !syncing && onSync()}
            style={{ ...whiteBtn, flex: "none", gap: 6, background: "var(--acc)", borderColor: "var(--acc)", color: "var(--onAcc)", opacity: syncing ? 0.7 : 1, cursor: syncing ? "default" : "pointer" }}
          >
            {syncing && (
              <span style={{ width: 11, height: 11, border: "1.5px solid var(--onAcc)", borderTopColor: "transparent", borderRadius: "50%", animation: "mcspin .9s linear infinite", display: "inline-block" }} />
            )}
            {syncing ? "同步中…" : "同步模型与 MCP"}
          </button>
          <button className="hv" onClick={() => void logout()} style={{ ...whiteBtn, flex: "none" }}>
            退出登录
          </button>
        </div>
        {syncMsg && <span style={{ fontSize: 12, color: syncMsg.color, lineHeight: 1.6 }}>{syncMsg.text}</span>}
        <span style={{ fontSize: 11.5, color: "var(--t5)", lineHeight: 1.6 }}>
          同步从模型网关拉取模型清单并全部填入模型页;推理密钥优先复用现有条目,必要时自动新建并启用「MonkeyCode」密钥。
        </span>
      </div>
    );
  }

  if (mode === "wechat") {
    const hint: Record<WxState, string> = {
      loading: "二维码加载中…",
      waiting: "用微信扫一扫登录",
      scanned: "已扫码,请在手机上确认",
      expired: "二维码已过期",
      canceled: "已在手机上取消",
      error: "二维码获取失败",
    };
    const needRetry = wxState === "expired" || wxState === "canceled" || wxState === "error";
    return (
      <div className="card card-lg" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "18px 16px" }}>
        <BaizhiLogo size={36} />
        <span style={{ fontSize: 12.5, color: "var(--t3)" }}>登录百智云账号后,自动同步账号下的模型与 MCP 配置。</span>
        <div style={{ position: "relative", width: 168, height: 168, borderRadius: 10, border: "1px solid var(--inputBd)", background: "var(--qrBg)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {qr && <img src={qr} alt="微信扫码登录" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", filter: needRetry ? "blur(3px) opacity(.35)" : "none" }} />}
          {!qr && !needRetry && <span style={{ fontSize: 12, color: "var(--t5)" }}>加载中…</span>}
          {needRetry && (
            <button
              className="hv"
              onClick={() => void startWechat()}
              style={{ ...whiteBtn, position: "absolute", flex: "none" }}
            >
              重新获取二维码
            </button>
          )}
        </div>
        <span style={{ fontSize: 12, color: wxState === "scanned" ? "var(--ok)" : "var(--t4)", fontWeight: 600 }}>{hint[wxState]}</span>
        {err && <span style={{ fontSize: 12, color: "var(--err)" }}>{err}</span>}
        <span className="hv-t1" onClick={() => { setErr(""); setMode("phone"); }} style={{ fontSize: 12, color: "var(--t5)", cursor: "pointer", userSelect: "none" }}>
          使用手机验证码登录
        </span>
      </div>
    );
  }

  return (
    <div className="card card-lg" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={{ fontSize: 12.5, color: "var(--t3)", lineHeight: 1.6 }}>
        登录百智云账号后,自动同步账号下的模型与 MCP 配置。
      </span>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="手机号">
          <input
            style={input}
            value={phone}
            placeholder="13800000000"
            inputMode="numeric"
            maxLength={11}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
            className="hv-bd"
          />
        </Field>
        <Field label="短信验证码">
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...input, flex: 1 }}
              value={code}
              placeholder="6 位数字"
              inputMode="numeric"
              maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => e.key === "Enter" && !busy && void login()}
              className="hv-bd"
            />
            <button
              className="hv"
              onClick={() => !codeBusy && countdown <= 0 && void sendCode()}
              style={{
                ...whiteBtn,
                height: 30,
                flex: "none",
                opacity: codeBusy || countdown > 0 ? 0.6 : 1,
                cursor: codeBusy || countdown > 0 ? "default" : "pointer",
              }}
            >
              {codeBusy ? "发送中…" : countdown > 0 ? `${countdown}s` : "获取验证码"}
            </button>
          </div>
        </Field>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          className="hv-acc"
          onClick={() => !busy && void login()}
          style={{
            height: 30,
            border: "none",
            borderRadius: 8,
            background: "var(--acc)",
            color: "var(--onAcc)",
            fontWeight: 700,
            fontSize: 12.5,
            padding: "0 18px",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "登录中…" : "登录"}
        </button>
        {err && <span style={{ fontSize: 12, color: "var(--err)" }}>{err}</span>}
        <span style={{ flex: 1 }} />
        <span className="hv-t1" onClick={() => { setErr(""); setMode("wechat"); }} style={{ fontSize: 12, color: "var(--t5)", cursor: "pointer", userSelect: "none" }}>
          使用微信扫码登录
        </span>
      </div>
    </div>
  );
}
