// 设置视图:全屏接管主区。左侧窄导航(通用/模型/MCP/运行环境/关于),
// 右侧内容列 + 底部脏状态保存条。
//
// 两类偏好、两条通路:
// - 主题/语言/提示音是"点即生效"偏好,不进保存条(提示音真值在壳,经
//   sound-enabled 事件与托盘/桌宠双向同步);
// - models/mcp/kernel_env 走保存条:save_config 全量写回(表单外字段从载入
//   配置透传),壳保存后重启引擎——重启过程由全局引擎横幅外显,这里不管。
import { IconAdjustmentsHorizontal, IconAlertTriangle, IconDice5, IconRotate, IconWand, IconBrain, IconCheck, IconChevronDown, IconInfoCircle, IconServer, IconSparkles, IconTerminal2, IconUser, IconWorld, type TablerIcon } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { resolveShortcut } from "@/app/shortcuts";
import { LOCALES, setLocale, useI18n } from "@/lib/i18n";
import {
  getConfig,
  getSoundEnabled,
  listWslDistros,
  onSoundEnabled,
  saveConfig,
  setSoundEnabled,
  type DesktopConfig,
} from "@/lib/ipc/config";
import { isWindowsShell } from "@/lib/ipc/host";
import { inDesktopShell } from "@/lib/ipc/ipc";
import { readCustomTheme, readTheme, setCustomTheme, setTheme, THEMES, CUSTOM_THEME, type CustomTheme, type Theme } from "@/lib/theme";
import { customThemeVars, randomTheme, roleHex, COLOR_ROLES, DEFAULT_CUSTOM, BORDER_RANGE, RADIUS_RANGE, SIZE_RANGE, type ColorRole } from "@/lib/customTheme";
import { useDismiss } from "@/lib/util/useDismiss";
import { useEscLayer } from "@/lib/util/escLayer";
import { baizhiStatus } from "@/lib/ipc/account";
import { AccountSection, type SyncApplied } from "@/features/account/AccountSection";
import { engineCaps } from "@/lib/ipc/approvals";
import { AboutSection } from "./AboutSection";
import { BrowserSection } from "./BrowserSection";
import { McpSection } from "./McpSection";
import { SkillsSection } from "./SkillsSection";
import { ModelsSection } from "./ModelsSection";
import type { BaizhiSyncResult, McModelsSyncResult } from "@/lib/ipc/account";
import { SOURCE_BAIZHI, SOURCE_MONKEYCODE } from "@/lib/models/modelMenu";
import {
  buildPayload,
  draftFromConfig,
  mergeSyncedMcps,
  mergeSyncedModels,
  payloadEquals,
  removeSyncedSource,
  validateDraft,
  type DraftError,
  type SettingsDraft,
} from "./settingsForm";

type Section = "general" | "account" | "models" | "mcp" | "skills" | "browser" | "env" | "about";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Esc 落在输入态时只收敛焦点、不退出视图(判据复用 app/shortcuts 的同一张
 * TYPING_TAGS 表,别在这里另发明一份)。此前视图级 Esc 不看事件目标:在
 * 模型名 / API Key 里按一下 Esc 就退出设置,连同满屏未保存的编辑一起丢掉。
 * escLayer 的 handler 不带事件,故读 activeElement——键盘事件的 target 与
 * 焦点元素在这里恒等。返回 true = 这一下已被消费。 */
function blurIfTyping(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (resolveShortcut({ key: "Escape", targetTag: el.tagName, openPermId: null }).kind !== "blur") return false;
  el.blur();
  return true;
}

/** 设置行:左侧名称+说明、右侧控件,行间分隔线成组——桌面设置页惯例。 */
function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs leading-relaxed text-base-content/50">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** 主题条目色板(daisyUI 官方 theme picker 同款手法):data-theme 让子树
 * 取该主题的变量,4 个色点(正文/主/次/强调)在该主题的 base-100 底上
 * ——每个主题的性格一眼可辨,不用逐个切换试。 */
/** 色板的内联覆盖:只取自定义属性(`--*`)。React 的 style 对象对标准属性要
 * 驼峰键,"color-scheme" 这种连字符键会被丢掉——而 4 个圆点的预览也用不上它。 */
function previewVars(c: CustomTheme): CSSProperties {
  return Object.fromEntries(Object.entries(customThemeVars(c)).filter(([k]) => k.startsWith("--"))) as CSSProperties;
}

/** 一组设置的小节头:编辑器里有颜色/形状/质感三组,不分组就是一堆控件糊在一起。 */
function EditorGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-base-content/45">{label}</span>
      {children}
    </div>
  );
}

/** 色块磁贴:整块是拾色器命中区(原生 input 铺满并透明,只借它的取色面板),
 * 被覆盖过的角落点一记 —— 用户要能看出"哪些是我改过的、哪些还是生成的"。 */
function ColorTile({ role, hex, overridden, resetLabel, seed, seedHint, onPick, onReset }: {
  role: ColorRole;
  hex: string;
  overridden: boolean;
  resetLabel: string;
  /** 这一格是整套配色的种子(primary):标记出来,否则用户以为它和其余 8 格一样只管自己 */
  seed?: boolean;
  seedHint?: string;
  onPick: (v: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="group/tile relative flex items-center gap-2 rounded-field border border-base-300 bg-base-100 py-1.5 pe-2 ps-1.5">
      <span aria-hidden className="size-5 shrink-0 rounded-field border border-base-content/10" style={{ background: hex }} />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-base-content/70">{role}</span>
      {seed && (
        <span title={seedHint} className="shrink-0 text-base-content/35">
          <IconWand size={13} stroke={1.75} aria-hidden />
        </span>
      )}
      {overridden && (
        <button
          type="button"
          title={resetLabel}
          aria-label={`${role} reset`}
          className="btn btn-ghost btn-xs shrink-0 px-1 opacity-0 group-hover/tile:opacity-100 focus-visible:opacity-100"
          onClick={onReset}
        >
          <IconRotate size={12} stroke={1.75} aria-hidden />
        </button>
      )}
      {/* 覆盖整块的透明拾色器:磁贴任意处点击都开取色面板 */}
      <input
        type="color"
        aria-label={role}
        className="absolute inset-0 cursor-pointer opacity-0"
        value={hex}
        onChange={(e) => onPick(e.target.value)}
      />
    </div>
  );
}

/** 自定义主题编辑器。分三组(颜色/形状与尺寸/质感)+ 顶部种子行 + 实时预览,
 * 对齐官方 theme-generator 的可调面(9 个角色色、圆角三档、尺寸两档、
 * depth/noise、边框),差别在起点是生成而非全手调。
 * 无「保存」钮:外观设置是「切换立即生效并记在本机」口径,与主题下拉一致。 */
function CustomThemeEditor({ value, onChange }: { value: CustomTheme; onChange: (v: CustomTheme) => void }) {
  const { t } = useI18n();
  const set = (patch: Partial<CustomTheme>) => onChange({ ...value, ...patch });
  // 种子色即 primary:换它要连带清掉可能存在的 primary 覆盖(旧配置遗留),
  // 否则覆盖压在种子生成的 primary 上,看起来像"改了不生效"
  const pickSeed = (hex: string) => {
    const next = { ...value.overrides };
    delete next.primary;
    onChange({ ...value, seed: hex, overrides: next });
  };
  const setOverride = (role: ColorRole, hex: string | null) => {
    const next = { ...value.overrides };
    if (hex) next[role] = hex;
    else delete next[role];
    set({ overrides: next });
  };

  const slider = (
    label: string,
    hint: string,
    key: "radiusBox" | "radiusField" | "radiusSelector" | "sizeField" | "sizeSelector" | "border",
    range: { min: number; max: number; step: number },
    unit: string,
  ) => (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline gap-1.5 text-xs">
        <span className="text-base-content/70">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-base-content/35">{hint}</span>
        <span className="shrink-0 font-mono text-[10px] text-base-content/50 tabular-nums">{`${value[key]}${unit}`}</span>
      </span>
      <input
        type="range"
        aria-label={label}
        className="range range-xs"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value[key]}
        onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<CustomTheme>)}
      />
    </label>
  );

  const toggle = (label: string, hint: string, key: "depth" | "noise") => (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        className="toggle toggle-xs shrink-0"
        aria-label={label}
        checked={value[key]}
        onChange={(e) => set({ [key]: e.target.checked } as Partial<CustomTheme>)}
      />
      <span className="text-base-content/70">{label}</span>
      <span className="min-w-0 truncate text-[10px] text-base-content/35">{hint}</span>
    </label>
  );

  const dirty = Object.keys(value.overrides).length > 0;
  return (
    <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
      {/* 种子行:整套配色的入口 */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label={t("settings.appearance.customMode")} className="join shrink-0">
          {(["light", "dark"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={value.mode === m}
              className={`btn btn-xs join-item ${value.mode === m ? "btn-active" : "text-base-content/60"}`}
              onClick={() => set({ mode: m })}
            >
              {t(m === "light" ? "settings.appearance.customLight" : "settings.appearance.customDark")}
            </button>
          ))}
        </div>
        {/* 种子色不在这里出第二个入口:它就是下面色板里的 primary(用户定案
            2026-08-07「主色不用放在这里,下面不是可以选择么」)。两个同色的
            「主色」控件摆在一起,还各管各的事,是纯粹的困惑源 */}
        {/* 随机换的是**整套**:配色 + 几何(圆角三档/边框/质感)一起。色相随机
            但亮度彩度锁窗口、几何从内置主题的真实组合里整组抽——见 randomTheme */}
        <button type="button" className="btn btn-xs gap-1" onClick={() => onChange(randomTheme(value))}>
          <IconDice5 size={14} stroke={1.75} aria-hidden />
          {t("settings.appearance.customRandom")}
        </button>
        <span className="min-w-0 flex-1" />
        {dirty && (
          <button type="button" className="btn btn-ghost btn-xs text-base-content/60" onClick={() => set({ overrides: {} })}>
            {t("settings.appearance.customResetColors")}
          </button>
        )}
      </div>

      {/* 实时预览(官方生成器同款):圆角/边框/尺寸/depth 的效果都要在这里看得见,
          所以按钮、徽标、输入框、开关各摆一件,而不是只放几个色点 */}
      <div
        data-theme={value.mode}
        style={previewVars(value)}
        className="flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-3"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="btn btn-primary btn-xs">Primary</span>
          <span className="btn btn-secondary btn-xs">Secondary</span>
          <span className="btn btn-accent btn-xs">Accent</span>
          <span className="btn btn-xs">Neutral</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="badge badge-info badge-sm">Info</span>
          <span className="badge badge-success badge-sm">Success</span>
          <span className="badge badge-warning badge-sm">Warning</span>
          <span className="badge badge-error badge-sm">Error</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className="input input-xs w-28" defaultValue="input" aria-hidden tabIndex={-1} readOnly />
          <input type="checkbox" className="toggle toggle-xs" defaultChecked aria-hidden tabIndex={-1} readOnly />
          <input type="checkbox" className="checkbox checkbox-xs" defaultChecked aria-hidden tabIndex={-1} readOnly />
          <span className="rounded-box bg-base-200 px-2 py-1 text-[10px] text-base-content/60">base-200</span>
          <span className="rounded-box bg-base-300 px-2 py-1 text-[10px] text-base-content/60">base-300</span>
        </div>
      </div>

      <EditorGroup label={t("settings.appearance.customGroupColor")}>
        <div className="grid grid-cols-3 gap-1.5">
          {COLOR_ROLES.map((role) =>
            // primary 这一格**就是种子色**:改它整套配色跟着重算(次要色/强调色
            // 按色相旋转、中性色掺同色相),而不是只换掉 --color-primary 一个变量
            // ——只换单项的话次要色和中性色还留在旧色相上,又回到「不搭」的老问题。
            // 因此它没有「恢复生成值」:它本身就是生成的源头。
            role === "primary" ? (
              <ColorTile
                key={role}
                role={role}
                hex={roleHex(value, role)}
                seed
                seedHint={t("settings.appearance.customSeedHint")}
                overridden={false}
                resetLabel=""
                onPick={(v) => pickSeed(v)}
                onReset={() => undefined}
              />
            ) : (
              <ColorTile
                key={role}
                role={role}
                hex={roleHex(value, role)}
                overridden={value.overrides[role] !== undefined}
                resetLabel={t("settings.appearance.customResetOne")}
                onPick={(v) => setOverride(role, v)}
                onReset={() => setOverride(role, null)}
              />
            ),
          )}
        </div>
      </EditorGroup>

      <EditorGroup label={t("settings.appearance.customGroupShape")}>
        <div className="grid grid-cols-2 gap-x-5 gap-y-3">
          {slider(t("settings.appearance.customRadiusBox"), t("settings.appearance.customRadiusBoxHint"), "radiusBox", RADIUS_RANGE, "rem")}
          {slider(t("settings.appearance.customRadiusField"), t("settings.appearance.customRadiusFieldHint"), "radiusField", RADIUS_RANGE, "rem")}
          {slider(t("settings.appearance.customRadiusSelector"), t("settings.appearance.customRadiusSelectorHint"), "radiusSelector", RADIUS_RANGE, "rem")}
          {slider(t("settings.appearance.customBorder"), t("settings.appearance.customBorderHint"), "border", BORDER_RANGE, "px")}
          {slider(t("settings.appearance.customSizeField"), t("settings.appearance.customSizeFieldHint"), "sizeField", SIZE_RANGE, "rem")}
          {slider(t("settings.appearance.customSizeSelector"), t("settings.appearance.customSizeSelectorHint"), "sizeSelector", SIZE_RANGE, "rem")}
        </div>
      </EditorGroup>

      <EditorGroup label={t("settings.appearance.customGroupEffect")}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {toggle(t("settings.appearance.customDepth"), t("settings.appearance.customDepthHint"), "depth")}
          {toggle(t("settings.appearance.customNoise"), t("settings.appearance.customNoiseHint"), "noise")}
        </div>
      </EditorGroup>

      <p className="text-xs leading-relaxed text-base-content/50">{t("settings.appearance.customHint")}</p>
    </div>
  );
}

/** 色板预览。daisyUI 的主题选择器是 [data-theme="X"] 而非 :root 限定,所以
 * 挂在 span 上就能就地预览一整套主题;自定义那档同理——落基础主题名 + 覆盖
 * 属性,再把覆盖块内联到本元素上(全局注入的那份只在选中自定义时存在,
 * 菜单里没选中时也要能预览)。 */
function ThemeSwatch({ theme, custom }: { theme: string; custom?: CustomTheme | null }) {
  if (custom) {
    return (
      <span
        data-theme={custom.mode}
        aria-hidden
        style={previewVars(custom)}
        className="grid shrink-0 grid-cols-2 gap-0.5 rounded-md bg-base-100 p-1 shadow-sm"
      >
        <span className="size-1.5 rounded-full bg-base-content" />
        <span className="size-1.5 rounded-full bg-primary" />
        <span className="size-1.5 rounded-full bg-secondary" />
        <span className="size-1.5 rounded-full bg-accent" />
      </span>
    );
  }
  return (
    <span data-theme={theme} aria-hidden className="grid shrink-0 grid-cols-2 gap-0.5 rounded-md bg-base-100 p-1 shadow-sm">
      <span className="size-1.5 rounded-full bg-base-content" />
      <span className="size-1.5 rounded-full bg-primary" />
      <span className="size-1.5 rounded-full bg-secondary" />
      <span className="size-1.5 rounded-full bg-accent" />
    </span>
  );
}

/** 主题选择(用户定案 2026-08-06 参照 daisyUI 文档站形态):触发器 = 当前
 * 主题色板 + 名称,菜单 = 全量主题列表(色板 + 名称 + 当前项对勾)。原生
 * select 的 option 塞不进色板,只能一排裸名——「丑」的根源,故自绘。
 * 点选即时换肤**不关**菜单(试玩几个再走,官方同款);外点/Esc/再点触发器关。
 * 品牌主题(monkeycode/monkeycode-dark)恒居列表头两位(THEMES 序)。 */
function ThemePicker({ theme, custom, onPick }: { theme: Theme; custom: CustomTheme; onPick: (v: Theme) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, boxRef, () => setOpen(false));
  // 名称一律用主题原名(含品牌两项 monkeycode/monkeycode-dark,用户定案
  // 2026-08-06):主题名是 data-theme 的取值,译名反而对不上号
  return (
    <div ref={boxRef} className={`dropdown dropdown-end shrink-0 ${open ? "dropdown-open" : ""}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("settings.appearance.theme")}
        className="btn btn-sm w-52 justify-start font-normal"
        onClick={() => setOpen(!open)}
      >
        <ThemeSwatch theme={theme} custom={theme === CUSTOM_THEME ? custom : null} />
        <span className="min-w-0 flex-1 truncate text-start">
          {theme === CUSTOM_THEME ? t("settings.appearance.custom") : theme}
        </span>
        <IconChevronDown size={14} stroke={1.75} aria-hidden className={`shrink-0 text-base-content/50 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t("settings.appearance.theme")}
          className="dropdown-content menu z-30 mt-1 max-h-80 w-52 flex-nowrap [&_li]:flex-nowrap overflow-x-hidden overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
        >
          {/* 自定义置顶且与内置清单以分隔线隔开:它不是第 36 套主题,是「基于
              某套主题改几项」,混在字母序里会被当成一个叫 mc-custom 的主题 */}
          <li>
            <button
              type="button"
              role="option"
              aria-selected={theme === CUSTOM_THEME}
              className={`flex items-center gap-2 ${theme === CUSTOM_THEME ? "menu-active" : ""}`}
              onClick={() => onPick(CUSTOM_THEME)}
            >
              <ThemeSwatch theme={CUSTOM_THEME} custom={custom} />
              <span className="min-w-0 flex-1 truncate text-xs">{t("settings.appearance.custom")}</span>
              {theme === CUSTOM_THEME && <IconCheck size={14} stroke={2} aria-hidden className="shrink-0" />}
            </button>
          </li>
          <li className="menu-disabled border-t border-base-300 pt-1" aria-hidden />
          {THEMES.map((v) => (
            <li key={v}>
              <button
                type="button"
                role="option"
                aria-selected={v === theme}
                className={`flex items-center gap-2 ${v === theme ? "menu-active" : ""}`}
                onClick={() => onPick(v)}
              >
                <ThemeSwatch theme={v} />
                <span className="min-w-0 flex-1 truncate text-xs">{v}</span>
                {v === theme && <IconCheck size={14} stroke={2} aria-hidden className="shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 通用:外观主题 / 语言 / 提示音(仅桌面壳)。 */
function GeneralSection() {
  const { t, locale } = useI18n();
  const [theme, setThemeState] = useState<Theme>(readTheme);
  // 没配过就给一份默认草稿:编辑器要有初值,选中「自定义」当场就该看到效果
  const [custom, setCustom] = useState<CustomTheme>(() => readCustomTheme() ?? DEFAULT_CUSTOM);
  const [soundOn, setSoundOn] = useState(true);

  useEffect(() => {
    if (!inDesktopShell()) return;
    let alive = true;
    void getSoundEnabled().then((on) => {
      if (alive) setSoundOn(on);
    });
    // 托盘勾选项是同一开关的另一入口,订阅广播让两处显示不打架
    const off = onSoundEnabled(setSoundOn);
    return () => {
      alive = false;
      off();
    };
  }, []);

  const pickSound = (next: boolean) => {
    setSoundOn(next); // 乐观置位:壳广播会回来盖一次,失败则回滚
    void setSoundEnabled(next).catch(() => setSoundOn(!next));
  };

  const pickTheme = (next: Theme) => {
    // 切到自定义走 setCustomTheme:它同时落配置 + 渲染好的 CSS(首帧防闪要用),
    // 而 setTheme 只写主题名——选了自定义却没落 CSS 的话,下次启动首帧会是
    // 基础主题的模样
    if (next === CUSTOM_THEME) setCustomTheme(custom);
    else setTheme(next);
    setThemeState(next);
  };
  // 编辑即生效:与主题下拉「点选即时换肤」同口径,不设保存钮
  const editCustom = (next: CustomTheme) => {
    setCustom(next);
    setCustomTheme(next);
    setThemeState(CUSTOM_THEME);
  };
  const seg = (label: string, on: boolean, onClick: () => void) => (
    <button key={label} type="button" className={`btn btn-sm join-item ${on ? "btn-active" : "text-base-content/60"}`} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <section aria-label={t("settings.nav.general")} className="flex flex-col gap-2">
      <div className="divide-y divide-base-300 rounded-box border border-base-300">
        {/* 自定义编辑器与主题行同格(不另起 SettingRow):它是这一行的展开态,
            分成两行会读成两个并列设置 */}
        <div>
          <SettingRow label={t("settings.appearance.theme")}>
            <ThemePicker theme={theme} custom={custom} onPick={pickTheme} />
          </SettingRow>
          {theme === CUSTOM_THEME && <CustomThemeEditor value={custom} onChange={editCustom} />}
        </div>
        <SettingRow label={t("settings.appearance.language")}>
          <div role="radiogroup" aria-label={t("settings.appearance.language")} className="join shrink-0">
            {LOCALES.map((l) => seg(l.label, locale === l.value, () => setLocale(l.value)))}
          </div>
        </SettingRow>
        {inDesktopShell() && (
          <SettingRow label={t("settings.general.sound")} hint={t("settings.general.soundHint")}>
            <input
              type="checkbox"
              className="toggle toggle-sm shrink-0"
              aria-label={t("settings.general.sound")}
              checked={soundOn}
              onChange={(e) => pickSound(e.target.checked)}
            />
          </SettingRow>
        )}
      </div>
      <p className="text-xs text-base-content/50">{t("settings.appearance.hint")}</p>
    </section>
  );
}

/** 运行环境(仅 Windows 壳):内核在本机还是 WSL 发行版内跑。 */
function EnvSection({
  draft,
  distros,
  onDraft,
}: {
  draft: SettingsDraft;
  distros: string[];
  onDraft: (up: (d: SettingsDraft) => SettingsDraft) => void;
}) {
  const { t } = useI18n();
  // 记忆的发行版可能已被卸载:保留为可见项而不是静默改值
  const missing = draft.kernelEnv.startsWith("wsl:") && !distros.includes(draft.kernelEnv.slice(4));
  return (
    <section aria-label={t("settings.nav.env")} className="flex flex-col gap-2">
      {/* 缺发行版 = 引擎起不来的硬故障,必须在页面上外显(旧 UI 同款告警):
          只在收起的 <select> 里缀一句「(未检测到)」,用户看到的是引擎一直
          启动失败而界面上没有任何解释 */}
      {missing && (
        <div role="alert" className="alert alert-warning alert-soft text-xs">
          <IconAlertTriangle size={16} stroke={1.75} aria-hidden className="shrink-0" />
          <span>{t("settings.env.missingWarn", { name: draft.kernelEnv.slice(4) })}</span>
        </div>
      )}
      <div className="rounded-box border border-base-300">
        <SettingRow label={t("settings.env.kernel")} hint={t("settings.env.hint")}>
          <select
            className="select select-sm w-48 shrink-0"
            aria-label={t("settings.env.kernel")}
            value={draft.kernelEnv}
            onChange={(e) => onDraft((d) => ({ ...d, kernelEnv: e.target.value }))}
          >
            <option value="">{t("settings.env.local")}</option>
            {distros.map((d) => (
              <option key={d} value={`wsl:${d}`}>
                WSL · {d}
              </option>
            ))}
            {missing && (
              <option value={draft.kernelEnv}>
                WSL · {draft.kernelEnv.slice(4)}
                {t("settings.env.missing")}
              </option>
            )}
          </select>
        </SettingRow>
      </div>
    </section>
  );
}

export function SettingsView({
  onClose,
  hasRunningTask = false,
}: {
  onClose: () => void;
  /** 有本地会话在跑(status==="running"):同步后不自动保存重启引擎,
   * 隐式踹掉运行中的轮次不可接受;回退保存条由用户择机保存(旧 UI 同款口径) */
  hasRunningTask?: boolean;
}) {
  const { t } = useI18n();
  // 离开确认(旧 UI App.tsx settingsDirty + window.confirm 的 daisyUI 版):
  // 脏表单直接退出 = 静默丢弃全部未保存编辑,必须先问一句
  const [leaveAsk, setLeaveAsk] = useState(false);
  // 初始落账号分区(旧 UI 同款,ui-next 首版漏迁 2026-08-06 用户报障):
  // 「登录 → 同步」是主路径,新用户进设置第一眼要看到扫码登录
  const [section, setSection] = useState<Section>("account");
  const [cfg, setCfg] = useState<DesktopConfig | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [distros, setDistros] = useState<string[]>([]);
  const [browserExt, setBrowserExt] = useState(false);
  // 模型页百智云空组的引导文案分两种(去同步 / 先登录),口径同旧 UI
  const [bzLoggedIn, setBzLoggedIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    let alive = true;
    getConfig()
      .then((loaded) => {
        if (!alive || !loaded) return; // null = 浏览器模式,分区各自降级提示
        setCfg(loaded);
        setDraft(draftFromConfig(loaded));
      })
      .catch((e) => {
        if (alive) setLoadError(errMsg(e));
      });
    if (isWindowsShell()) void listWslDistros().then((list) => alive && setDistros(list));
    // 浏览器分区按引擎能力显隐:引擎不带扩展桥时整项不出现(旧 UI 同款门禁)。
    // caps 拿不到(浏览器模式/引擎未起)按不支持算,不给一个点进去必然报错的入口
    void engineCaps().then((caps) => alive && setBrowserExt(caps?.browser_ext === true));
    // 登录态只为模型页空组的引导措辞,拿不到就按未登录说(读不到状态时那句
    // 「先登录百智云」总是成立的),失败不外显
    void baizhiStatus()
      .then((s) => alive && setBzLoggedIn(!!s?.logged_in))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // 基线 = 载入配置的归一化载荷(与草稿载荷同构同键序,JSON 串比较即脏判定)
  const baseline = useMemo(() => (cfg ? buildPayload(cfg, draftFromConfig(cfg)) : null), [cfg]);
  const payload = cfg && draft ? buildPayload(cfg, draft) : null;
  const dirty = !!(payload && baseline && !payloadEquals(payload, baseline));

  // 关闭主路径(Esc 与「返回」共用):脏表单先问一句再走(旧 UI App.tsx
  // closeSettings 同款守卫)
  const requestClose = () => {
    if (dirty) setLeaveAsk(true);
    else onClose();
  };

  // 视图级 Esc:走 escLayer 层栈而非自挂 window capture。同 target 同阶段的
  // 监听按**注册先后**触发,视图挂载即注册、浮层(useDismiss)开时才注册,
  // 于是永远是视图先吃掉这一下——开着主题下拉按 Esc 关掉的是整个设置页
  // (2026-08-09 报障)。层栈按后进先出派发,后开的浮层天然压在视图之上。
  // handler 必须**引用稳定**:身份一变 useEscLayer 就会重挂 effect,
  // 视图层会被重新 push 到栈顶,浮层优先又白搭了——故用 ref 读最新闭包。
  const escRef = useRef<() => boolean>(() => false);
  escRef.current = () => {
    if (blurIfTyping()) return true; // 输入态只收敛焦点,绝不连带丢弃编辑
    if (leaveAsk) return true; // 确认弹层在场(它自己那层会先消费,这里兜底)
    requestClose();
    return true;
  };
  useEscLayer(true, useCallback(() => escRef.current(), []));
  // 确认弹层自己占一层(后 push 即在视图层之上):弹层里的 Esc = 取消离开,
  // 不会穿回视图层再问一遍,也不会把设置页关掉
  useEscLayer(
    leaveAsk,
    useCallback(() => {
      setLeaveAsk(false);
      return true;
    }, []),
  );

  const updateDraft = (up: (d: SettingsDraft) => SettingsDraft) => {
    setDraft((d) => (d ? up(d) : d));
    setSaveError("");
  };

  const discard = () => {
    if (cfg) setDraft(draftFromConfig(cfg));
    setSaveError("");
  };

  // 账号页同步结果并入草稿(整组替换,纯逻辑在 settingsForm);跳过名单
  // (跨组撞名先到先得)返回给账号卡就地外显。
  // 自动保存决策(旧 UI settings.tsx autoSaveDecision 随迁,2026-08-06
  // 用户报障"同步不自动保存了"即此回归):同步前表单干净且无任务在跑 →
  // 直接走保存主路径,免手动点保存;脏表单(不能捎带用户没确认的修改)/
  // 有任务在跑(保存重启引擎会踹掉运行轮次)→ 回退保存条,原因给卡片外显。
  // 基准取 ref 而非闭包:同步是"发请求→等数秒→回来再合并",登录顺带的
  // 双路同步(百智云+会员)先后到达,拿闭包里的旧草稿会把先到的一路抹掉
  const draftRef = useRef<SettingsDraft | null>(null);
  draftRef.current = draft;
  const cfgRef = useRef<DesktopConfig | null>(null);
  cfgRef.current = cfg;
  const savingRef = useRef(false);
  savingRef.current = saving;
  const applySync = (r: BaizhiSyncResult | McModelsSyncResult): SyncApplied | undefined => {
    let next = draftRef.current;
    const conf = cfgRef.current;
    if (!next || !conf) return undefined;
    // 脏判定必须在合并前(合并后恒脏);与保存条同一口径(载荷比较)
    const wasDirty = !payloadEquals(buildPayload(conf, next), buildPayload(conf, draftFromConfig(conf)));
    const fromBaizhi = "mcp_servers" in r;
    const source = r.models[0]?.source || (fromBaizhi ? SOURCE_BAIZHI : SOURCE_MONKEYCODE);
    let skipped: string[] = [];
    const merged = mergeSyncedModels(next, r.models, source);
    if (merged) {
      next = merged.draft;
      skipped = merged.skipped;
    }
    if (fromBaizhi) next = mergeSyncedMcps(next, r.mcp_servers);
    draftRef.current = next;
    setDraft(next);
    setSaveError("");
    // 保存在途(双路同步第一路刚落地):不再起一次——在途那次的补存循环
    // 收尾时会发现草稿又变了,自己再存一轮(见 save()),所以对用户仍是
    // 「已自动保存」,不必回退保存条
    if (savingRef.current) return { skipped, autoSaved: true };
    if (wasDirty) return { skipped, autoSaved: false, blocked: "dirty" };
    if (hasRunningTask) return { skipped, autoSaved: false, blocked: "busy" };
    void save(next);
    return { skipped, autoSaved: true };
  };

  /** 断开 MonkeyCode 后清掉会员模型组(旧 UI disconnectMcWithCleanup 第四步)。
   *  自动保存决策与 applySync 同一套口径:干净表单且无任务在跑就直接落盘,
   *  否则退回保存条并说明原因。返回 undefined = 本来就没有会员条目,无事可做。 */
  const applyMcDisconnect = (): SyncApplied | undefined => {
    const cur = draftRef.current;
    const conf = cfgRef.current;
    if (!cur || !conf) return undefined;
    const wasDirty = !payloadEquals(buildPayload(conf, cur), buildPayload(conf, draftFromConfig(conf)));
    const next = removeSyncedSource(cur, SOURCE_MONKEYCODE);
    if (!next) return undefined;
    draftRef.current = next;
    setDraft(next);
    setSaveError("");
    if (savingRef.current) return { skipped: [], autoSaved: true };
    if (wasDirty) return { skipped: [], autoSaved: false, blocked: "dirty" };
    if (hasRunningTask) return { skipped: [], autoSaved: false, blocked: "busy" };
    void save(next);
    return { skipped: [], autoSaved: true };
  };

  const draftErrText = (e: DraftError): string => {
    switch (e.kind) {
      case "modelName":
        return t("settings.error.modelName");
      case "modelDup":
        return t("settings.error.modelDup", { name: e.name });
      case "modelIncomplete":
        return t("settings.error.modelIncomplete", { name: e.name });
      case "mcpName":
        return t("settings.error.mcpName");
      case "mcpDup":
        return t("settings.error.mcpDup", { name: e.name });
      case "mcpIncomplete":
        return t("settings.error.mcpIncomplete", { name: e.name });
    }
  };

  /** target:同步自动保存传入合并后的草稿(state 提交尚未落地,闭包里的
   * draft 是旧值);保存条点击不传,存当前草稿。
   *
   * 补存循环(旧 UI performSave 随迁,ui-next 首版漏迁 → 2026-08-06 用户报障
   * 「扫码之后还要手动保存」):一次保存要写盘 + 重启内核(数秒),期间表单
   * 可能又被并入新的同步结果——扫码登录顺带桥接 MonkeyCode,百智云与会员
   * 模型两路同步先后落地,第二路正好撞在第一路的保存在途期(applySync 见
   * savingRef 就只合并不保存,把收尾交给这里)。存到表单不再变化为止,轮数
   * 设上限兜底:不收敛就停手交给保存条,不无休止地重启内核。 */
  const save = async (target?: SettingsDraft) => {
    const conf = cfgRef.current;
    let d = target ?? draft;
    if (!conf || !d) return;
    const invalid = validateDraft(d);
    if (invalid) {
      setSaveError(draftErrText(invalid));
      return;
    }
    setSaving(true);
    savingRef.current = true;
    setSaveError("");
    try {
      for (let round = 0; ; round++) {
        const p = buildPayload(conf, d);
        await saveConfig(p);
        // 保存即真值:壳按载荷写盘(壳自有偏好以磁盘合并,不在本类型内)
        setCfg(p);
        // 在途期间草稿没再变:表单态重建为已保存形态,保存条随之收起;
        // 引擎重启由横幅外显
        const cur = draftRef.current;
        if (!cur || payloadEquals(buildPayload(conf, cur), p)) {
          setDraft((c) => (c === d || c === cur ? draftFromConfig(p) : c));
          break;
        }
        // 变过了:再存一轮。轮数用尽或新草稿校验不过就保留草稿(dirty →
        // 保存条兜底),绝不回读已保存形态覆盖——那会把后到的同步条目抹掉
        if (round >= 2 || validateDraft(cur)) break;
        d = cur;
      }
    } catch (e) {
      setSaveError(errMsg(e)); // 壳的 Err 是中文,直接外显
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  const items: Array<{ id: Section; label: string; desc: string; icon: TablerIcon }> = [
    { id: "general", label: t("settings.nav.general"), desc: t("settings.desc.general"), icon: IconAdjustmentsHorizontal },
    { id: "account", label: t("settings.nav.account"), desc: t("settings.desc.account"), icon: IconUser },
    { id: "models", label: t("settings.nav.models"), desc: t("settings.desc.models"), icon: IconBrain },
    { id: "mcp", label: t("settings.nav.mcp"), desc: t("settings.desc.mcp"), icon: IconServer },
    { id: "skills", label: t("settings.nav.skills"), desc: t("settings.desc.skills"), icon: IconSparkles },
    ...(browserExt
      ? [{ id: "browser" as const, label: t("settings.nav.browser"), desc: t("settings.desc.browser"), icon: IconWorld }]
      : []),
    ...(isWindowsShell()
      ? [{ id: "env" as const, label: t("settings.nav.env"), desc: t("settings.desc.env"), icon: IconTerminal2 }]
      : []),
    { id: "about", label: t("settings.nav.about"), desc: t("settings.desc.about"), icon: IconInfoCircle },
  ];
  const active = items.find((it) => it.id === section);

  // 需要壳配置的分区在拿不到配置时的降级提示(浏览器只读 / 载入失败)
  const configGate = !inDesktopShell() ? (
    <div role="alert" className="alert alert-warning alert-soft max-w-md text-xs">
      {t("settings.browserReadonly")}
    </div>
  ) : loadError ? (
    <div role="alert" className="alert alert-error alert-soft max-w-md text-xs">
      {t("settings.loadFailed", { message: loadError })}
    </div>
  ) : null;

  const body = () => {
    switch (section) {
      case "general":
        return <GeneralSection />;
      case "account":
        // 账号分区不吃壳配置(登录态自查、浏览器降级自带),不走 configGate;
        // 同步结果经 applySync 并入模型/MCP 草稿。草稿另供自建部署高级块编辑
        //(拿不到配置时该块自行隐去,不影响登录主路径)
        return (
          <AccountSection
            onSyncResult={applySync}
            onMcDisconnected={applyMcDisconnect}
            draft={draft}
            onDraft={updateDraft}
          />
        );
      case "models":
        return draft ? <ModelsSection draft={draft} onDraft={updateDraft} baizhiLoggedIn={bzLoggedIn} /> : configGate;
      case "mcp":
        return draft ? <McpSection draft={draft} onDraft={updateDraft} /> : configGate;
      case "skills":
        // 技能库是壳侧即时读写(skills_* 命令),不进 config 草稿,不走 configGate
        return <SkillsSection />;
      case "browser":
        // 配对是壳侧即时动作,不吃 config 草稿,故不走 configGate
        return <BrowserSection />;
      case "env":
        return draft ? <EnvSection draft={draft} distros={distros} onDraft={updateDraft} /> : configGate;
      case "about":
        return <AboutSection />;
    }
  };

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-base-100">
      <header data-tauri-drag-region="" data-view-header="" className="flex h-13 shrink-0 items-center gap-2 border-b border-base-300 px-4">
        <h1 data-tauri-drag-region="" className="text-sm font-semibold">{t("settings.title")}</h1>
        <span data-tauri-drag-region="" className="flex-1" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={requestClose}>
          {t("settings.back")}
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t("settings.title")} className="w-44 shrink-0 border-r border-base-300 p-2">
          {/* flex-nowrap + [&_li]:flex-nowrap:daisyUI 给 .menu 与 .menu li
              双双设了 column wrap,不解除的话行宽跟内容走,行内 truncate 链
              永远不触发(LAYOUT §6.2 menu 截断铁律) */}
          <ul className="menu w-full flex-nowrap [&_li]:flex-nowrap gap-0.5 p-0">
            {items.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  className={`gap-2.5 transition-colors duration-150 ${section === it.id ? "menu-active" : ""}`}
                  aria-current={section === it.id ? "page" : undefined}
                  onClick={() => setSection(it.id)}
                >
                  <it.icon size={15} stroke={1.75} aria-hidden className="text-base-content/60" />
                  {it.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 内容列居中收窄:阅读宽度稳定,分区排版不随窗宽漂移。
              [scrollbar-gutter:stable] 见 LAYOUT §5:各分区长短不一,不留滚条
              槽位的话在长短分区间切换时居中内容列左右晃约 5px */}
          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] px-6 py-5">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
              {/* 分区头:大标题+一句话说明(对齐旧工程设置屏的标题层级) */}
              <header className="flex flex-col gap-1">
                {/* text-lg:应用最大字号档(欢迎页/新建任务同档),不再独一档 text-xl */}
                <h2 className="text-lg font-bold">{active?.label}</h2>
                <p className="text-xs text-base-content/60">{active?.desc}</p>
              </header>
              {body()}
            </div>
          </div>
          {/* 保存条:结构线贴底 */}
          {dirty && (
            <div className="flex shrink-0 items-center gap-2 border-t border-base-300 bg-base-100 px-4 py-2">
              <span className="text-xs text-base-content/70">{t("settings.save.dirty")}</span>
              {saveError && (
                <span role="alert" className="min-w-0 truncate text-xs text-error" title={saveError}>
                  {saveError}
                </span>
              )}
              <span className="flex-1" />
              <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={discard}>
                {t("settings.save.discard")}
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void save()}>
                {saving && <span className="loading loading-spinner loading-xs" aria-hidden />}
                {t("settings.save.confirm")}
              </button>
            </div>
          )}
        </div>
      </div>
      {/* 离开确认(旧 UI「有未保存的更改,确定离开设置?」的 daisyUI 版):
          Esc / 返回 在脏表单上不再直接丢弃编辑。弹层自占一层 Esc,
          里面按 Esc = 取消离开,不会递归回视图层 */}
      {leaveAsk && (
        <div className="modal modal-open" role="dialog" aria-label={t("settings.leave.title")}>
          <div className="modal-box max-w-sm">
            <h3 className="text-sm font-semibold">{t("settings.leave.title")}</h3>
            <p className="py-3 text-xs leading-relaxed text-base-content/70">{t("settings.leave.body")}</p>
            <div className="modal-action">
              <button type="button" className="btn btn-sm" onClick={() => setLeaveAsk(false)}>
                {t("settings.leave.stay")}
              </button>
              <button
                type="button"
                className="btn btn-error btn-sm"
                onClick={() => {
                  setLeaveAsk(false);
                  onClose();
                }}
              >
                {t("settings.leave.discard")}
              </button>
            </div>
          </div>
          <div className="modal-backdrop cursor-pointer" onClick={() => setLeaveAsk(false)} aria-hidden />
        </div>
      )}
    </main>
  );
}
