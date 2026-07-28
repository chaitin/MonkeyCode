// 设置视图:左侧分类导航(百智云账号 / 模型 / MCP / 浏览器 / 通用与更新)+ 右侧单分类内容
// + 底部脏状态保存条。账号优先:MonkeyCode 是百智云旗下产品,"登录 → 同步"
// 是主路径,手工配置是高级路径。
// 配置所有权在壳(写盘 0600/env 注入/重启内核),本视图只负责渲染与编辑,
// 经 Tauri IPC get_config/save_config 读写;保存成功后壳会重启内核并把
// 整个页面导航到新内核 URL(本组件随之卸载)。
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BaizhiCard } from "./baizhi";
import { baizhiStatus } from "./baizhiapi";
import {
  getBrowserExtStatus,
  getHostConfig,
  inDesktopShell,
  isMacShell,
  isWindowsShell,
  listWslDistros,
  openExtensionDir,
  repairBrowserExt,
  saveHostConfig,
  updateCheck,
  updateInstall,
} from "./host";
import { engineCaps } from "./session";
import { MONO } from "./components";
import { IconBack, IconCloud, IconGear, IconGlobe, IconMonitor, IconPlus, IconSpark } from "./icons";
import { BaizhiLogo } from "./baizhi";
import logoUrl from "./logo.png";
import { Field, Section, input, select, whiteBtn } from "./settings-ui";
import {
  emptyMcp,
  emptyModel,
  payloadOf,
  replaceBaizhiGroup,
  serversToMcps,
  validateMcpNames,
  type McpEntry,
} from "./settingsConfig";
import { readAccent, readTheme, setAccent, setTheme, type AccentKey, type Theme } from "./theme";
import { ACCENTS } from "./gen/accents";
import { updateGate } from "./updateGate";
import { MacWindowControls } from "./titlebar";
import {
  SOURCE_BAIZHI,
  modelSourceLabel,
  type BaizhiStatus,
  type BaizhiSyncResult,
  type BrowserExtStatus,
  type EngineCaps,
  type HostModel,
  type McConnectionState,
  type UpdateStatus,
} from "./types";

// ---- 关于卡(版本 + 检查更新;仅桌面壳) ----

function AboutCard({
  version,
  engineVersion,
  update,
  onUpdateStatus,
}: {
  version: string;
  engineVersion: string;
  update: UpdateStatus | null;
  onUpdateStatus: (s: UpdateStatus) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "checking" | "installing">("idle");
  const [msg, setMsg] = useState<{ text: string; color: string } | null>(null);
  const found = !!update?.available;

  // 手动检查不过闸门(用户明确要查就得查),但记一笔账:紧接着切个窗口回来
  // 不该再查一遍。
  const check = async () => {
    setPhase("checking");
    setMsg(null);
    try {
      updateGate.record();
      const s = await updateCheck();
      onUpdateStatus(s);
      if (!s.available) setMsg({ text: "已是最新版本", color: "var(--ok)" });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), color: "var(--err)" });
    } finally {
      setPhase("idle");
    }
  };

  const install = async () => {
    setPhase("installing");
    setMsg(null);
    try {
      await updateInstall(); // 成功即安装并重启,不会返回
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), color: "var(--err)" });
      setPhase("idle");
    }
  };

  const busy = phase !== "idle";
  const label = phase === "checking" ? "检查中" : phase === "installing" ? "更新中" : found ? "下载更新" : "检查更新";
  const green = found && phase !== "checking";

  return (
    <div className="card card-lg" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--accBg)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <img src={logoUrl} alt="" draggable={false} style={{ width: 22, height: 22, borderRadius: 5 }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>MonkeyCode</span>
        <span className="ellipsis" style={{ fontSize: 11.5, color: "var(--t5)", fontFamily: MONO }}>
          应用 {found ? `${update?.current ?? version} → ${update?.latest} 可用` : version}
        </span>
        <span className="ellipsis" style={{ fontSize: 11.5, color: "var(--t5)", fontFamily: MONO }} title={engineVersion}>
          内核 {engineVersion}
        </span>
      </div>
      <span style={{ flex: 1 }} />
      {msg && <span style={{ fontSize: 12, color: msg.color, flex: "none" }}>{msg.text}</span>}
      <button
        className={green ? "hv-acc" : "hv"}
        onClick={() => !busy && void (green ? install() : check())}
        style={{
          ...whiteBtn,
          gap: 6,
          flex: "none",
          ...(green ? { background: "var(--acc)", borderColor: "var(--acc)", color: "var(--onAcc)" } : {}),
          opacity: busy ? 0.7 : 1,
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy && (
          <span
            style={{
              width: 11,
              height: 11,
              border: `1.5px solid ${green ? "var(--onAcc)" : "var(--t1)"}`,
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "mcspin .9s linear infinite",
              display: "inline-block",
            }}
          />
        )}
        {label}
      </button>
    </div>
  );
}

// ---- 浏览器扩展卡(扩展桥状态/配对;内核 HTTP 状态端点,桌面与浏览器模式通用) ----

function BrowserExtCard() {
  const [st, setSt] = useState<BrowserExtStatus | null>(null);
  const [fetchErr, setFetchErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [extDirMsg, setExtDirMsg] = useState("");

  const refresh = async () => {
    try {
      setSt(await getBrowserExtStatus());
      setFetchErr("");
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : String(e));
    }
  };
  // 挂载即拉取 + 5s 轮询(仅本分类页挂载期间;配对/连接状态变化靠它反映)
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, []);

  const repair = async () => {
    setBusy(true);
    try {
      setSt(await repairBrowserExt());
      setFetchErr("");
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const code = st?.pairing_code ?? "";
  const codeShown = code ? `${code.slice(0, 4)}-${code.slice(4)}` : "";
  const copyCode = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const dot = (color: string) => (
    <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flex: "none", display: "inline-block" }} />
  );

  let statusLine: JSX.Element;
  if (fetchErr) {
    statusLine = <>{dot("var(--err)")}<span>状态读取失败: {fetchErr}</span></>;
  } else if (!st) {
    statusLine = <>{dot("var(--t5)")}<span>读取状态中…</span></>;
  } else if (!st.enabled) {
    statusLine = <>{dot("var(--err)")}<span>浏览器功能未启用{st.error ? `：${st.error}` : ""}</span></>;
  } else if (st.connected) {
    statusLine = (
      <>
        {dot("var(--ok)")}
        <span>
          已连接 · {st.browser_name || "浏览器"}
          {st.browser_version ? ` ${st.browser_version}` : ""}
        </span>
      </>
    );
  } else if (st.paired) {
    statusLine = <>{dot("var(--warn)")}<span>等待扩展连接，请确认 Chrome/Edge 已打开且扩展已启用</span></>;
  } else {
    statusLine = <>{dot("var(--warn)")}<span>尚未配对</span></>;
  }

  return (
    <>
      <div className="card card-lg" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--t2)", fontWeight: 600 }}>
          {statusLine}
          <span style={{ flex: 1 }} />
          {st?.enabled && st.paired && (
            <button className="hv" onClick={() => !busy && void repair()} style={{ ...whiteBtn, flex: "none", opacity: busy ? 0.7 : 1 }}>
              重新配对
            </button>
          )}
        </div>
        {st?.enabled && !st.paired && code && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: "var(--t4)", flex: "none" }}>一次性配对码</span>
            <span className="selectable" style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, letterSpacing: 2, color: "var(--t1)" }}>{codeShown}</span>
            <button className="hv" onClick={copyCode} style={{ ...whiteBtn, height: 24, padding: "0 9px", fontSize: 11.5, flex: "none" }}>
              {copied ? "已复制" : "复制"}
            </button>
          </div>
        )}
        {st?.enabled && st.addr && (
          <span className="selectable" style={{ fontSize: 11.5, color: "var(--t5)", fontFamily: MONO }}>本地连接地址：{st.addr}</span>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--t4)", lineHeight: 1.8 }}>
        <div style={{ color: "var(--t2)", fontWeight: 650 }}>首次使用，请按下面 3 步连接浏览器</div>
        <div style={{ marginTop: 2 }}>
          连接后，MonkeyCode 可以打开网页、点击、输入和截图，并使用 Chrome/Edge 中已有的登录状态。
        </div>
        <ol style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          <li>
            <strong style={{ color: "var(--t2)" }}>安装扩展。</strong>
            {inDesktopShell() ? (
              <>
                点击
                <button
                  className="hv"
                  onClick={() => {
                    void openExtensionDir()
                      .then((p) => setExtDirMsg(p ? `已在文件管理器中定位: ${p}` : ""))
                      .catch((e) => setExtDirMsg(e instanceof Error ? e.message : String(e)));
                  }}
                  style={{ ...whiteBtn, height: 22, padding: "0 8px", fontSize: 11.5, margin: "0 4px", verticalAlign: "middle" }}
                >
                  打开扩展目录
                </button>
                。在 Chrome 地址栏输入 chrome://extensions（Edge 请输入 edge://extensions），开启「开发者模式」，点击「加载已解压的扩展程序」，选择刚打开的文件夹。
              </>
            ) : (
              <>先按照 browser-extension/README.md 构建扩展。然后打开 Chrome 的 chrome://extensions（Edge 为 edge://extensions），开启「开发者模式」，点击「加载已解压的扩展程序」，选择仓库中的 browser-extension/dist 文件夹。</>
            )}
          </li>
          <li>
            <strong style={{ color: "var(--t2)" }}>连接 MonkeyCode。</strong>
            点击浏览器工具栏中的「MonkeyCode 浏览器助手」，选择「去设置页配对」。输入上方的一次性配对码，端口保持为空，再点击「连接并配对」。
          </li>
          <li>
            <strong style={{ color: "var(--t2)" }}>授权要操作的页面。</strong>
            上方状态显示「已连接」后，打开目标网页，再次点击扩展图标，选择「把此标签页交给 agent 操作」，即可授权 MonkeyCode 操作当前页面。
          </li>
        </ol>
        {extDirMsg && <div style={{ fontSize: 11.5, color: "var(--t5)", fontFamily: MONO, marginTop: 4 }}>{extDirMsg}</div>}
        <div style={{ marginTop: 6 }}>需要停止时，可在扩展中点击「收回」，也可以点击浏览器顶部提示条中的「取消」。</div>
      </div>
    </>
  );
}

// ---- 分类导航 ----

type SectionKey = "account" | "models" | "mcp" | "browser" | "general";

const NAV: { key: SectionKey; label: string; icon: (p: { size?: number; color?: string }) => JSX.Element }[] = [
  { key: "account", label: "账号与云端", icon: BaizhiLogo },
  { key: "models", label: "模型", icon: IconSpark },
  { key: "mcp", label: "MCP 服务器", icon: IconMonitor },
  { key: "browser", label: "浏览器", icon: IconGlobe },
  { key: "general", label: "通用与更新", icon: IconGear },
];

// 高级选项折叠态摘要:配置过的项都露出来,免得"改过但收起就不可见"
const THINK_LABEL: Record<string, string> = { low: "低", medium: "中", high: "高" };
const advSummary = (m: HostModel): string => {
  const parts = [
    m.context_window ? `上下文窗口 ${m.context_window.toLocaleString()}` : "",
    m.max_output ? `最大输出 ${m.max_output.toLocaleString()}` : "",
    m.think && THINK_LABEL[m.think] ? `思考${THINK_LABEL[m.think]}` : "",
  ].filter(Boolean);
  return parts.length ? `(${parts.join(",")})` : "";
};

// 徽标小药丸(provider/类型/来源)
const pill: CSSProperties = {
  flex: "none",
  fontSize: 10.5,
  fontWeight: 600,
  padding: "1px 7px",
  borderRadius: 5,
  background: "var(--hov)",
  color: "var(--t4)",
  whiteSpace: "nowrap",
};

// 空态虚线卡
const emptyCard: CSSProperties = {
  color: "var(--t5)",
  fontSize: 12.5,
  border: "1px dashed var(--dashBd)",
  borderRadius: 10,
  padding: 16,
  lineHeight: 1.7,
};

function mcIdentity(s: McConnectionState): string {
  const u = s.user;
  return u?.name || u?.username || u?.email || u?.id || "MonkeyCode 用户";
}

/** MonkeyCode 云端任务关联卡。百智云只是显式连接时的授权前提,
 * 两者状态和退出操作互不代替。 */
function MonkeyCodeAccountCard({
  connection,
  baizhiLoggedIn,
  onConnect,
  onRetry,
  onDisconnect,
}: {
  connection: McConnectionState;
  baizhiLoggedIn: boolean;
  onConnect: () => void;
  onRetry: () => void;
  onDisconnect: () => void;
}) {
  const busy = connection.phase === "checking" || connection.phase === "connecting" || connection.phase === "disconnecting";
  const connected = connection.phase === "connected";
  const status =
    connection.phase === "checking"
      ? "检查中"
      : connection.phase === "connecting"
        ? "连接中"
        : connection.phase === "disconnecting"
          ? "断开中"
          : connected
            ? "已关联"
            : connection.phase === "error"
              ? "状态异常"
              : "未关联";
  const message = (() => {
    if (connection.error) return connection.error;
    if (connection.phase === "checking") return "正在读取 MonkeyCode 关联状态…";
    if (connection.phase === "connecting") return "正在使用百智云账号完成授权…";
    if (connection.phase === "disconnecting") return "正在清除本机 MonkeyCode 会话…";
    if (connected) return `已关联为 ${mcIdentity(connection)}，远端任务会显示在主界面侧栏。`;
    if (!baizhiLoggedIn) return "请先登录上方百智云账号，再连接 MonkeyCode。";
    return "连接后可查看、创建并实时跟看 MonkeyCode 远端任务。";
  })();
  const canConnect = baizhiLoggedIn && !busy;

  return (
    <div className="card card-lg" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--accBg)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <IconCloud size={16} color="var(--accTx)" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>MonkeyCode 云端任务</span>
          <span className="ellipsis" style={{ fontSize: 11.5, color: "var(--t5)", fontFamily: MONO }}>{connection.host}</span>
        </div>
        <span style={{ flex: 1 }} />
        <span
          style={{
            flex: "none",
            padding: "2px 7px",
            borderRadius: 6,
            fontSize: 10.5,
            fontWeight: 700,
            color: connected ? "var(--ok)" : connection.phase === "error" ? "var(--err)" : "var(--t4)",
            background: connected ? "var(--accBg)" : "var(--hov)",
          }}
        >
          {status}
        </span>
        {connected || connection.phase === "disconnecting" ? (
          <button className="hv" disabled={busy} onClick={onDisconnect} style={{ ...whiteBtn, flex: "none", opacity: busy ? 0.6 : 1 }}>
            {connection.phase === "disconnecting" ? "断开中…" : "断开关联"}
          </button>
        ) : connection.phase === "error" ? (
          <button className="hv" disabled={busy} onClick={onRetry} style={{ ...whiteBtn, flex: "none", opacity: busy ? 0.6 : 1 }}>
            重试状态
          </button>
        ) : (
          <button
            className="hv-acc"
            disabled={!canConnect}
            onClick={onConnect}
            style={{
              ...whiteBtn,
              flex: "none",
              background: "var(--acc)",
              borderColor: "var(--acc)",
              color: "var(--onAcc)",
              opacity: canConnect ? 1 : 0.55,
              cursor: canConnect ? "pointer" : "default",
            }}
          >
            {connection.phase === "connecting" ? "连接中…" : "连接 MonkeyCode"}
          </button>
        )}
      </div>
      <span style={{ fontSize: 11.5, color: connection.error ? "var(--err)" : "var(--t5)", lineHeight: 1.6 }}>{message}</span>
    </div>
  );
}

// ---- 设置视图 ----

export function SettingsView({
  onClose,
  hostVersion,
  engineVersion,
  update,
  onUpdateStatus,
  onDirtyChange,
  mcConnection,
  onConnectMc,
  onRetryMc,
  onDisconnectMc,
}: {
  onClose: () => void;
  hostVersion: string | null;
  engineVersion: string | null;
  update: UpdateStatus | null;
  onUpdateStatus: (s: UpdateStatus) => void;
  /** 脏状态上报(宿主据此在关闭前确认);卸载时自动报 false */
  onDirtyChange?: (dirty: boolean) => void;
  mcConnection: McConnectionState;
  onConnectMc: () => void;
  onRetryMc: () => void;
  onDisconnectMc: () => void;
}) {
  const desktop = inDesktopShell();
  const [active, setActive] = useState<SectionKey>("account");
  const [models, setModels] = useState<HostModel[]>([]);
  const [defaultIdx, setDefaultIdx] = useState(0);
  const [advOpen, setAdvOpen] = useState<Record<number, boolean>>({});
  const [expanded, setExpanded] = useState<number | null>(null); // 展开编辑的模型(真实索引)
  const [baizhiOpen, setBaizhiOpen] = useState(true); // 百智云组(账号优先,默认展开)
  const [mcps, setMcps] = useState<McpEntry[]>([]);
  const [mcpExpanded, setMcpExpanded] = useState<number | null>(null);
  const [baizhiMcpOpen, setBaizhiMcpOpen] = useState(true); // 百智云 MCP 组(默认展开)
  const [kernelEnv, setKernelEnv] = useState(""); // 内核运行环境:"" 本机 / "wsl:<发行版>"
  const [wslDistros, setWslDistros] = useState<string[] | null>(null); // WSL 发行版列表(null=未加载)
  const [caps, setCaps] = useState<EngineCaps | null>(null); // 当前引擎能力(浏览器 tab 按此隐藏)
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const mcpNameErrors = useMemo(() => validateMcpNames(mcps), [mcps]);
  const hasMcpNameErrors = mcpNameErrors.some(Boolean);
  // 主题是本机显示偏好,不进保存条:点一下即写 localStorage 并立即换根节点令牌
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const pickTheme = (next: Theme) => {
    setTheme(next);
    setThemeState(next);
  };
  // 主题色同理,与深浅两维正交(见 theme.ts)
  const [accent, setAccentState] = useState<AccentKey>(readAccent);
  const pickAccent = (next: AccentKey) => {
    setAccent(next);
    setAccentState(next);
  };

  // 登录态由 Shell 持有:账号页 BaizhiCard 与模型/MCP 页的引导条共用
  const [bzStatus, setBzStatus] = useState<BaizhiStatus | null>(null);
  const [bzErr, setBzErr] = useState("");
  const refreshBz = async () => {
    try {
      const s = await baizhiStatus();
      setBzStatus(s);
      setBzErr("");
    } catch (e) {
      setBzErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void refreshBz();
  }, []);
  const loggedIn = !!bzStatus?.logged_in;

  // 加载快照:baseline 供 dirty 比较,snapshot 供「放弃更改」复原
  const baseline = useRef("");
  const snapshot = useRef<{ models: HostModel[]; defaultIdx: number; mcps: McpEntry[]; kernelEnv: string } | null>(null);

  useEffect(() => {
    if (!desktop) {
      setLoaded(true);
      return;
    }
    getHostConfig()
      .then((cfg) => {
        const ms = cfg?.models ?? [];
        const di = Math.max(0, ms.findIndex((m) => m.default));
        const mc = serversToMcps(cfg?.mcp_servers ?? {});
        const ke = cfg?.kernel_env ?? "";
        setModels(ms);
        setDefaultIdx(di);
        setMcps(mc);
        setKernelEnv(ke);
        snapshot.current = { models: ms, defaultIdx: di, mcps: mc, kernelEnv: ke };
        baseline.current = JSON.stringify(payloadOf(ms, di, mc, ke));
        setLoaded(true);
      })
      .catch((e) => setErr("读取配置失败: " + (e instanceof Error ? e.message : String(e))));
    void engineCaps().then(setCaps).catch(() => {});
    // 运行环境下拉的发行版列表(读注册表,失败/非 Windows 返回空)
    if (isWindowsShell()) void listWslDistros().then(setWslDistros);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);

  const dirty = useMemo(
    () => desktop && loaded && JSON.stringify(payloadOf(models, defaultIdx, mcps, kernelEnv)) !== baseline.current,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [desktop, loaded, models, defaultIdx, mcps, kernelEnv],
  );
  useEffect(() => {
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);
  useEffect(
    () => () => onDirtyChange?.(false), // 卸载即不再脏(宿主复位关闭守卫)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const discard = () => {
    const s = snapshot.current;
    if (!s) return;
    setModels(s.models);
    setDefaultIdx(s.defaultIdx);
    setMcps(s.mcps);
    setKernelEnv(s.kernelEnv);
    setExpanded(null);
    setMcpExpanded(null);
    setAdvOpen({});
    setErr("");
  };

  const patchModel = (i: number, patch: Partial<HostModel>) =>
    setModels((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const patchMcp = (i: number, patch: Partial<McpEntry>) =>
    setMcps((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  // 同步导入:整组替换语义见 replaceBaizhiGroup。导入即进脏态,保存条浮现;
  // 自动切到模型页供核对。
  const applySynced = (r: BaizhiSyncResult) => {
    // 只导入 MCP(勾选 0 个模型)时不触碰模型组:空选集不视为"清空百智云组"
    if (r.models.length) {
      const defaultName = models[defaultIdx]?.name?.trim() ?? "";
      const synced = r.models.map((sm) => ({
        name: sm.name,
        provider: sm.provider,
        base_url: sm.base_url,
        api_key: sm.api_key,
        model: sm.model,
        context_window: sm.context_window,
        vision: sm.vision,
        source: sm.source,
      }));
      const next = replaceBaizhiGroup(models, synced, false);
      setModels(next);
      // 索引大位移:默认模型按名字重新定位(被移除则回退第一项),折叠态复位
      const di = next.findIndex((m) => m.name.trim() === defaultName);
      setDefaultIdx(di >= 0 ? di : 0);
      setAdvOpen({});
      setExpanded(null);
      setBaizhiOpen(true);
    }
    // MCP:本次无条目(如网关未开通)则不触碰(空集不清组,对齐模型语义);
    // 同步条目已带 source=baizhi
    const syncedMcps = serversToMcps(r.mcp_servers);
    if (syncedMcps.length) {
      setMcps((cur) => replaceBaizhiGroup(cur, syncedMcps, true));
      setMcpExpanded(null);
    }
    setActive("models"); // 导入后直接看结果
  };

  const save = async () => {
    // UX 前置校验;权威校验在内核 LoadModels(重复名/provider 白名单等)
    for (const m of models) {
      if (!m.name.trim() || !m.base_url.trim() || !m.api_key.trim() || !m.model.trim()) {
        setErr(`模型「${m.name.trim() || "未命名"}」信息不完整(需名称/接口地址/API Key/模型标识)`);
        setActive("models");
        return;
      }
    }
    const names = new Set<string>();
    for (const m of models) {
      if (names.has(m.name.trim())) {
        setErr(`模型名称重复: ${m.name.trim()}`);
        setActive("models");
        return;
      }
      names.add(m.name.trim());
    }
    // 内核在上下文占用达 90% 时自动压缩,要求 max_output < context_window
    // 的 10%,否则接近阈值的请求会因输入+输出超模型上限被服务端拒绝
    for (const m of models) {
      const cw = m.context_window ?? 200000;
      if (m.max_output && m.max_output >= cw * 0.1) {
        setErr(
          `模型「${m.name.trim()}」的最大输出(${m.max_output.toLocaleString()})需小于上下文窗口(${cw.toLocaleString()})的 10%,建议不超过 8%(${Math.floor(cw * 0.08).toLocaleString()})`,
        );
        setActive("models");
        return;
      }
    }
    const invalidMcp = mcpNameErrors.findIndex(Boolean);
    if (invalidMcp >= 0) {
      setErr(mcpNameErrors[invalidMcp] ?? "MCP 名称无效");
      setActive("mcp");
      setMcpExpanded(invalidMcp);
      return;
    }
    setErr("");
    setSaving(true);
    try {
      await saveHostConfig(payloadOf(models, defaultIdx, mcps, kernelEnv));
      // 壳已重启引擎:整页刷新复位所有状态并重连(保持"保存中"直到卸载)
      location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const addBtn = (label: string, onClick: () => void) => (
    <button className="hv" onClick={onClick} style={{ ...whiteBtn, height: 24, padding: "0 9px", fontSize: 11.5, gap: 4 }}>
      <IconPlus />
      {label}
    </button>
  );

  // ---- 模型:紧凑行 + 手风琴编辑(i 恒为 models 真实索引) ----

  const modelRow = (m: HostModel, i: number) => {
    const isOpen = expanded === i;
    return (
      <>
        <div
          className="hrow hv2"
          onClick={() => setExpanded(isOpen ? null : i)}
          style={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 14px", cursor: "pointer", userSelect: "none" }}
        >
          <span className="ellipsis" style={{ fontSize: 12.5, fontFamily: MONO, color: m.name.trim() ? "var(--t1)" : "var(--t5)", minWidth: 0 }}>
            {m.name.trim() || "未命名模型"}
          </span>
          <span style={pill}>{m.provider || "anthropic"}</span>
          {m.vision && <span style={{ ...pill, background: "var(--accBg)", color: "var(--accTx)" }}>视觉</span>}
          {i === defaultIdx && (
            <span style={{ flex: "none", fontSize: 11, fontWeight: 700, color: "var(--accTx)", whiteSpace: "nowrap" }}>✓ 默认</span>
          )}
          <span style={{ flex: 1 }} />
          <span className="row-acts" style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, flex: "none" }}>
            {i !== defaultIdx && (
              <span
                className="hv-t1"
                style={{ color: "var(--t4)", fontWeight: 600 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setDefaultIdx(i);
                }}
              >
                设为默认
              </span>
            )}
            <span
              className="hv-err"
              style={{ color: "var(--t5)" }}
              onClick={(e) => {
                e.stopPropagation();
                setModels((ms) => ms.filter((_, j) => j !== i));
                setDefaultIdx((d) => (i < d ? d - 1 : i === d ? 0 : d));
                setAdvOpen({}); // 按索引记忆,删除后索引移位,全部复位
                setExpanded(null);
              }}
            >
              删除
            </span>
          </span>
          <span
            style={{ flex: "none", display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s ease", fontSize: 9, color: "var(--t5)" }}
          >
            ▸
          </span>
        </div>
        {isOpen && modelForm(m, i)}
      </>
    );
  };

  const modelForm = (m: HostModel, i: number) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 14px 14px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 12 }}>
        <Field label="名称">
          <input style={input} value={m.name} placeholder="如: 主力模型" onChange={(e) => patchModel(i, { name: e.target.value })} className="hv-bd" />
        </Field>
        <Field label="协议">
          <select style={select} value={m.provider || "anthropic"} onChange={(e) => patchModel(i, { provider: e.target.value })}>
            <option value="anthropic">anthropic</option>
            <option value="openai">openai(Chat Completions)</option>
            <option value="openai_responses">openai_responses(Responses)</option>
          </select>
        </Field>
      </div>
      <Field label="接口地址">
        <input style={input} value={m.base_url} placeholder="https://api.example.com" onChange={(e) => patchModel(i, { base_url: e.target.value })} className="hv-bd" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="API Key">
          <input style={input} type="password" value={m.api_key} placeholder="sk-..." onChange={(e) => patchModel(i, { api_key: e.target.value })} className="hv-bd" />
        </Field>
        <Field label="模型标识">
          <input style={input} value={m.model} placeholder="请求中的 model 字段" onChange={(e) => patchModel(i, { model: e.target.value })} className="hv-bd" />
        </Field>
      </div>
      {advOpen[i] && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="上下文窗口(token)">
              <input
                style={input}
                type="number"
                min={1}
                value={m.context_window ?? ""}
                placeholder="200000(默认)"
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  patchModel(i, { context_window: Number.isFinite(n) && n > 0 ? n : undefined });
                }}
                className="hv-bd"
              />
            </Field>
            <Field label="最大输出(token)">
              <input
                style={input}
                type="number"
                min={1}
                value={m.max_output ?? ""}
                placeholder="16384(默认)"
                title="单次回复的输出 token 上限。回复经常被截断(finish_reason=length)时调大它;须小于上下文窗口的 10%(建议 ≤8%),否则接近压缩阈值的请求会被服务端拒绝"
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  patchModel(i, { max_output: Number.isFinite(n) && n > 0 ? n : undefined });
                }}
                className="hv-bd"
              />
            </Field>
          </div>
          <Field label="思考深度">
            <select
              style={select}
              value={m.think ?? ""}
              title="推理深度(effort),内核按协议转译:openai 系发 reasoning_effort,anthropic 走 adaptive 思考。仅支持思考的模型有效,网关拒绝该参数时改回关闭。此为新会话默认档,composer 里可随会话调整"
              onChange={(e) => patchModel(i, { think: e.target.value || undefined })}
            >
              <option value="">关闭(默认)</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </Field>
        </>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 14, paddingTop: 2, fontSize: 12 }}>
        <span
          className="hv-t1"
          onClick={() => setAdvOpen((o) => ({ ...o, [i]: !o[i] }))}
          style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--t5)", cursor: "pointer", userSelect: "none" }}
        >
          <span style={{ display: "inline-block", transform: advOpen[i] ? "rotate(90deg)" : "none", transition: "transform .15s ease", fontSize: 9 }}>▸</span>
          高级选项
          {!advOpen[i] ? advSummary(m) : ""}
        </span>
        <label
          title="模型支持图片输入(视觉)。未勾选时对话里的图片以文件路径提供,模型不会收到图片内容"
          style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--t3)", cursor: "pointer", fontWeight: 600, userSelect: "none" }}
        >
          <input
            type="checkbox"
            checked={!!m.vision}
            onChange={(e) => patchModel(i, { vision: e.target.checked })}
            style={{ accentColor: "var(--acc)", margin: 0 }}
          />
          支持图片
        </label>
      </div>
    </div>
  );

  /** 一组条目行装进一张卡(行间分隔线;j 为组内序,i 用真实索引);模型/MCP 共用 */
  const groupCard = <T,>(entries: { m: T; i: number }[], row: (m: T, i: number) => JSX.Element) => (
    <div className="card" style={{ overflow: "hidden" }}>
      {entries.map(({ m, i }, j) => (
        <div key={i} style={{ borderTop: j > 0 ? "1px solid var(--line2)" : "none" }}>
          {row(m, i)}
        </div>
      ))}
    </div>
  );

  /** 分组头右侧的收起/展开开关(百智云模型组与 MCP 组共用) */
  const collapseToggle = (open: boolean, toggle: () => void) => (
    <span
      className="hv-t1"
      onClick={toggle}
      style={{ fontSize: 11.5, color: "var(--t5)", cursor: "pointer", userSelect: "none" }}
    >
      {open ? "收起" : "展开"}
    </span>
  );

  // 未登录引导条(模型/MCP 页顶部;账号是主路径)
  const loginHint = bzStatus && !loggedIn && (
    <div className="card card-lg" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
      <BaizhiLogo size={16} />
      <span style={{ fontSize: 12.5, color: "var(--t3)", flex: 1 }}>登录百智云后可自动同步账号下的模型与 MCP,无需手工配置。</span>
      <button
        className="hv-acc"
        onClick={() => setActive("account")}
        style={{ ...whiteBtn, flex: "none", background: "var(--acc)", borderColor: "var(--acc)", color: "var(--onAcc)" }}
      >
        去登录
      </button>
    </div>
  );

  const modelsSection = () => {
    if (!desktop) {
      return (
        <div className="card card-lg" style={{ color: "var(--t4)", fontSize: 12.5, lineHeight: 1.7 }}>
          浏览器模式下配置只读:模型与 MCP 由桌面应用宿主管理。
        </div>
      );
    }
    if (!loaded) return <div style={{ fontSize: 12.5, color: "var(--t5)" }}>读取配置中…</div>;
    const entries = models.map((m, i) => ({ m, i }));
    const baizhi = entries.filter((e) => e.m.source === SOURCE_BAIZHI);
    const custom = entries.filter((e) => e.m.source !== SOURCE_BAIZHI);
    return (
      <>
        {loginHint}
        {/* 百智云组在前(主路径) */}
        <Section
          label={`${modelSourceLabel(SOURCE_BAIZHI)}${baizhi.length ? `(${baizhi.length})` : ""}`}
          action={baizhi.length > 0 ? collapseToggle(baizhiOpen, () => setBaizhiOpen((v) => !v)) : undefined}
        >
          {baizhi.length === 0 ? (
            <div style={emptyCard}>
              {loggedIn ? (
                <>
                  还没有同步的模型。到
                  <span className="hv-t1" onClick={() => setActive("account")} style={{ color: "var(--accTx)", cursor: "pointer", fontWeight: 600 }}>
                    「百智云账号」
                  </span>
                  页点「同步模型与 MCP」即可拉取。
                </>
              ) : (
                "登录百智云并同步后,账号下的模型会出现在这里(重新同步时整组更新)。"
              )}
            </div>
          ) : (
            baizhiOpen && groupCard(baizhi, modelRow)
          )}
        </Section>
        {/* 自定义组(高级路径) */}
        <Section label="自定义模型" action={addBtn("添加模型", () => {
          setModels((ms) => [...ms, emptyModel()]);
          setExpanded(models.length); // 新行(追加在末尾)直接展开编辑
        })}>
          {custom.length === 0 ? (
            <div style={emptyCard}>手工接入其他服务商的模型(高级)。需要名称、接口地址、API Key 与模型标识。</div>
          ) : (
            groupCard(custom, modelRow)
          )}
        </Section>
      </>
    );
  };

  // ---- MCP:紧凑行 + 手风琴编辑 ----

  const mcpSummary = (m: McpEntry) => (m.type === "http" ? m.url.trim() : `${m.command} ${m.args}`.trim()) || "未配置";

  // MCP 紧凑行(i 恒 mcps 真实索引);fragment 返回,由 mcpGroupCard 包分隔线
  const mcpRow = (m: McpEntry, i: number) => {
    const isOpen = mcpExpanded === i;
    const disabled = !!m.extra?.disabled;
    const nameError = mcpNameErrors[i];
    return (
      <>
        <div
          className="hrow hv2"
          onClick={() => setMcpExpanded(isOpen ? null : i)}
          style={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 14px", cursor: "pointer", userSelect: "none", opacity: disabled ? 0.5 : 1 }}
        >
          {m.source === SOURCE_BAIZHI && <BaizhiLogo size={14} />}
          <span className="ellipsis" style={{ fontSize: 12.5, fontFamily: MONO, color: nameError ? "var(--err)" : m.name.trim() ? "var(--t1)" : "var(--t5)", flex: "none", maxWidth: 180 }}>
            {m.name.trim() || "未命名"}
          </span>
          <span style={pill}>{m.type}</span>
          <span className="ellipsis" style={{ fontSize: 11.5, color: "var(--t5)", fontFamily: MONO, minWidth: 0 }}>
            {mcpSummary(m)}
          </span>
          <span style={{ flex: 1 }} />
          <span className="row-acts" style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12, flex: "none" }}>
            <span
              className="hv-t1"
              style={{ color: disabled ? "var(--t5)" : "var(--accTx)", fontWeight: 600 }}
              onClick={(e) => {
                e.stopPropagation();
                const { disabled: _d, ...rest } = m.extra ?? {};
                const extra = disabled ? rest : { ...rest, disabled: true };
                patchMcp(i, { extra: Object.keys(extra).length ? extra : undefined });
              }}
            >
              {disabled ? "启用" : "停用"}
            </span>
            <span
              className="hv-err"
              style={{ color: "var(--t5)" }}
              onClick={(e) => {
                e.stopPropagation();
                setMcps((ms) => ms.filter((_, j) => j !== i));
                setMcpExpanded(null);
              }}
            >
              删除
            </span>
          </span>
          <span
            style={{ flex: "none", display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s ease", fontSize: 9, color: "var(--t5)" }}
          >
            ▸
          </span>
        </div>
        {isOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 14px 14px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 12 }}>
              <Field label="名称">
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <input
                    style={{ ...input, borderColor: nameError ? "var(--err)" : undefined }}
                    value={m.name}
                    placeholder="如: context7"
                    onChange={(e) => patchMcp(i, { name: e.target.value })}
                    className="hv-bd"
                    aria-invalid={!!nameError}
                  />
                  {nameError && <span style={{ color: "var(--err)", fontSize: 11 }}>{nameError}</span>}
                </div>
              </Field>
              <Field label="类型">
                <select style={select} value={m.type} onChange={(e) => patchMcp(i, { type: e.target.value as McpEntry["type"] })}>
                  <option value="http">HTTP(URL)</option>
                  <option value="stdio">stdio(本地命令)</option>
                </select>
              </Field>
            </div>
            {m.type === "http" ? (
              <Field label="URL">
                <input style={input} value={m.url} placeholder="https://mcp.example.com/mcp" onChange={(e) => patchMcp(i, { url: e.target.value })} className="hv-bd" />
              </Field>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="命令">
                  <input style={input} value={m.command} placeholder="npx" onChange={(e) => patchMcp(i, { command: e.target.value })} className="hv-bd" />
                </Field>
                <Field label="参数(空格分隔)">
                  <input style={input} value={m.args} placeholder="@playwright/mcp" onChange={(e) => patchMcp(i, { args: e.target.value })} className="hv-bd" />
                </Field>
              </div>
            )}
            <Field label={m.type === "http" ? "Headers(每行 KEY=VALUE)" : "环境变量(每行 KEY=VALUE)"}>
              <textarea
                style={{ ...input, height: "auto", padding: "7px 10px", resize: "vertical", lineHeight: 1.6 }}
                rows={2}
                value={m.kv}
                onChange={(e) => patchMcp(i, { kv: e.target.value })}
                className="hv-bd"
              />
            </Field>
          </div>
        )}
      </>
    );
  };

  const mcpSection = () => {
    if (!desktop) {
      return (
        <div className="card card-lg" style={{ color: "var(--t4)", fontSize: 12.5, lineHeight: 1.7 }}>
          浏览器模式下配置只读:模型与 MCP 由桌面应用宿主管理。
        </div>
      );
    }
    if (!loaded) return <div style={{ fontSize: 12.5, color: "var(--t5)" }}>读取配置中…</div>;
    const entries = mcps.map((m, i) => ({ m, i }));
    const baizhi = entries.filter((e) => e.m.source === SOURCE_BAIZHI);
    const custom = entries.filter((e) => e.m.source !== SOURCE_BAIZHI);
    return (
      <>
        {loginHint}
        {/* 百智云 MCP 组在前(账号优先);当前网关未开通,同步暂不产出,组常为空 */}
        {baizhi.length > 0 && (
          <Section
            label={`${modelSourceLabel(SOURCE_BAIZHI)} MCP(${baizhi.length})`}
            action={collapseToggle(baizhiMcpOpen, () => setBaizhiMcpOpen((v) => !v))}
          >
            {baizhiMcpOpen && groupCard(baizhi, mcpRow)}
          </Section>
        )}
        {/* 自定义 MCP 组 */}
        <Section label="自定义 MCP" action={addBtn("添加 MCP", () => {
          setMcps((ms) => [...ms, emptyMcp()]);
          setMcpExpanded(mcps.length); // 新行追加末尾,直接展开
        })}>
          {custom.length === 0 ? (
            <div style={emptyCard}>未配置自定义 MCP 服务器(可选)。</div>
          ) : (
            groupCard(custom, mcpRow)
          )}
        </Section>
      </>
    );
  };

  // ---- 通用 ----

  /** 主题分段控件的一格(选中格用卡面+投影浮起,未选中格只留弱文字) */
  const themeBtn = (value: Theme, label: string) => {
    const on = theme === value;
    return (
      <button
        onClick={() => pickTheme(value)}
        style={{
          border: "none",
          borderRadius: 6,
          height: 26,
          padding: "0 15px",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          background: on ? "var(--card)" : "transparent",
          color: on ? "var(--t1)" : "var(--t4)",
          boxShadow: on ? "var(--segSh)" : "none",
        }}
      >
        {label}
      </button>
    );
  };

  /** 主题色色板一枚。圆点用该色**自己**的 --acc(gen/accents.ts 里生成的
   *  swatch),不能写 var(--acc)——那是"当前选中的色",四枚会长得一模一样。 */
  const accentBtn = (key: AccentKey, label: string, swatch: string) => {
    const on = accent === key;
    return (
      <button
        key={key}
        type="button"
        aria-pressed={on}
        onClick={() => pickAccent(key)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 26,
          padding: "0 11px 0 8px",
          borderRadius: 13,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 600,
          border: `1.5px solid ${on ? swatch : "var(--btnBd)"}`,
          background: on ? "var(--card)" : "transparent",
          color: on ? "var(--t1)" : "var(--t4)",
          boxShadow: on ? "var(--cardSh)" : "none",
        }}
      >
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: swatch, flex: "none" }} />
        {label}
      </button>
    );
  };

  const generalSection = () => (
    <>
      <Section label="外观">
        <div className="card card-lg" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", background: "var(--segBg)", borderRadius: 8, padding: 3, gap: 2 }}>
              {themeBtn("light", "浅色")}
              {themeBtn("dark", "深色")}
            </div>
            <span style={{ fontSize: 12, color: "var(--t5)" }}>切换立即生效并记在本机,不影响内核配置。</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--t4)", flex: "none", marginRight: 2 }}>主题色</span>
            {ACCENTS.map((a) => accentBtn(a.key, a.label, a.swatch))}
          </div>
        </div>
      </Section>
      {/* 内核运行环境:Windows 本机 / WSL 发行版(仅 Windows 壳显示)。
          发行版列表读注册表(list_wsl_distros),未装 WSL 即空列表只留本机;
          当前值不在列表(发行版被删)时保留一个标注项,用户能看到现状并切走。 */}
      {desktop && isWindowsShell() && (
        <Section label="运行环境">
          <div className="card card-lg" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label="内核运行环境">
              <select style={select} value={kernelEnv} onChange={(e) => setKernelEnv(e.target.value)}>
                <option value="">Windows 本机</option>
                {(wslDistros ?? []).map((d) => (
                  <option key={d} value={`wsl:${d}`}>WSL · {d}</option>
                ))}
                {kernelEnv.startsWith("wsl:") && !(wslDistros ?? []).includes(kernelEnv.slice(4)) && (
                  <option value={kernelEnv}>WSL · {kernelEnv.slice(4)}(未检测到)</option>
                )}
              </select>
            </Field>
            {kernelEnv.startsWith("wsl:") && !(wslDistros ?? []).includes(kernelEnv.slice(4)) && (
              <span style={{ fontSize: 12.5, color: "var(--warn)", fontWeight: 600 }}>
                未检测到发行版 {kernelEnv.slice(4)},引擎将无法启动;可切回 Windows 本机或先安装该发行版。
              </span>
            )}
            <span style={{ fontSize: 12, color: "var(--t5)", lineHeight: 1.7 }}>
              选择 WSL 后,任务在发行版内运行,项目需位于发行版文件系统(如 /home/…)。
              切换后点右上角「保存」生效(会重启内核);浏览器工具在 WSL 的 NAT 网络下暂不可用
              (mirrored 网络不受影响)。
            </span>
          </div>
        </Section>
      )}
      {desktop && (
        <Section label="关于">
          <AboutCard version={hostVersion ?? "—"} engineVersion={engineVersion ?? "—"} update={update} onUpdateStatus={onUpdateStatus} />
        </Section>
      )}
    </>
  );

  const accountSection = () => (
    <>
      <Section label="百智云账号">
        <BaizhiCard
          status={bzStatus}
          statusErr={bzErr}
          refreshStatus={refreshBz}
          onSynced={applySynced}
          knownKeys={() => models.map((m) => m.api_key.trim()).filter((k) => k.startsWith("sk-"))}
          preselectNames={() => models.filter((m) => m.source === SOURCE_BAIZHI || !m.source).map((m) => m.name.trim())}
        />
      </Section>
      <Section label="MonkeyCode">
        <MonkeyCodeAccountCard
          connection={mcConnection}
          baizhiLoggedIn={loggedIn}
          onConnect={onConnectMc}
          onRetry={onRetryMc}
          onDisconnect={onDisconnectMc}
        />
      </Section>
    </>
  );

  const activeLabel = NAV.find((n) => n.key === active)?.label ?? "设置";

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, animation: "mcin .25s ease" }}>
      {/* 左侧分类导航(设置态占满主窗口,此为最左栏) */}
      <div style={{ width: 168, flex: "none", background: "var(--side)", borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 2, padding: "0 10px 12px" }}>
        {/* macOS 壳:自绘红绿灯落在最左栏顶部(与主侧栏同一组件,切换不跳动) */}
        <MacWindowControls />
        <div
          className="hv"
          onClick={onClose}
          style={{ display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 9px", borderRadius: 6, cursor: "pointer", userSelect: "none", fontSize: 12.5, color: "var(--t3)", fontWeight: 600 }}
        >
          <IconBack size={10} color="var(--t3)" />
          返回
        </div>
        <div style={{ height: 6 }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--t4)", padding: "2px 9px 6px" }}>设置</span>
        {NAV.filter((n) => n.key !== "browser" || caps?.browser_ext === true).map((n) => {
          const activeNow = active === n.key;
          const Icon = n.icon;
          return (
            <div
              key={n.key}
              className={activeNow ? undefined : "hv"}
              onClick={() => setActive(n.key)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                height: 30,
                padding: "0 9px",
                borderRadius: 6,
                cursor: "pointer",
                userSelect: "none",
                fontSize: 12.5,
                background: activeNow ? "var(--accSel)" : "transparent",
                color: activeNow ? "var(--accSelT)" : "var(--t2)",
                fontWeight: activeNow ? 600 : 400,
              }}
            >
              <Icon size={13} color={activeNow ? "var(--accSelT)" : "var(--t4)"} />
              {n.label}
            </div>
          );
        })}
      </div>

      {/* 内容区 + 保存条 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        {/* macOS 壳:内容列顶部的拖拽带。主视图有 ViewHeader、新任务页有专属
            热区,设置页此前只剩左导航顶部一条 ~95px 的空隙可拖,形同不可拖 */}
        {isMacShell() && <div data-tauri-drag-region="" style={{ height: 50, flex: "none" }} />}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div key={active} style={{ maxWidth: 640, margin: "0 auto", padding: "24px 32px 40px", display: "flex", flexDirection: "column", gap: 18, animation: "mcin .18s ease" }}>
            <span style={{ fontSize: 17, fontWeight: 800 }}>{activeLabel}</span>
            {active === "account" && accountSection()}
            {active === "models" && modelsSection()}
            {active === "mcp" && mcpSection()}
            {active === "browser" && <BrowserExtCard />}
            {active === "general" && generalSection()}
            {err && !dirty && <div style={{ fontSize: 12.5, color: "var(--err)" }}>{err}</div>}
          </div>
        </div>
        {dirty && (
          <div style={{ flex: "none", borderTop: "1px solid var(--line)", background: "var(--card)", padding: "10px 20px", display: "flex", alignItems: "center", gap: 12, animation: "mcin .15s ease" }}>
            <span style={{ fontSize: 12.5, color: "var(--t3)" }}>有未保存的更改,保存后内核将重启(会话在磁盘不丢失)。</span>
            {err && <span className="ellipsis selectable" style={{ fontSize: 12, color: "var(--err)" }}>{err}</span>}
            <span style={{ flex: 1 }} />
            <button className="hv" onClick={discard} style={{ ...whiteBtn, flex: "none" }} disabled={saving}>
              放弃更改
            </button>
            <button
              className="hv-acc"
              onClick={() => !saving && !hasMcpNameErrors && void save()}
              disabled={saving || hasMcpNameErrors}
              title={hasMcpNameErrors ? "请先修正 MCP 名称" : undefined}
              style={{
                height: 28,
                border: "none",
                borderRadius: 8,
                background: "var(--acc)",
                color: "var(--onAcc)",
                fontWeight: 700,
                fontSize: 12.5,
                padding: "0 18px",
                cursor: saving || hasMcpNameErrors ? "not-allowed" : "pointer",
                opacity: saving || hasMcpNameErrors ? 0.6 : 1,
                boxShadow: "var(--accSh)",
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: "none",
              }}
            >
              {saving && (
                <span style={{ width: 11, height: 11, border: "1.5px solid var(--onAcc)", borderTopColor: "transparent", borderRadius: "50%", animation: "mcspin .9s linear infinite", display: "inline-block" }} />
              )}
              {saving ? "保存并重启内核中…" : "保存"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
