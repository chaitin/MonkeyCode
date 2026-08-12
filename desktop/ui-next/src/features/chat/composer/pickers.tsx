// 轻量下拉选择器:会话 composer 与新建任务页共用同一形态
// (btn-ghost 文字触发器 + rounded-box 菜单),模型选择的过滤框/来源 tab/
// 会员分节逻辑收口在此,两处不再各写一份。
// - ModelMenu:模型切换(过滤/来源 tab/会员分节/锁定灰态,纯逻辑在
//   lib/models/modelMenu);
// - ThinkMenu:思考深度(档位 + hint 副文案;levels 可配,新建任务页多一档
//   ""=跟随模型默认);
// - OptionMenu:通用平铺单选(云端任务的宿主机/镜像等);
// - SkillsMenu:会话技能启用集(唯一的多选:勾选不关菜单,整单全量提交)。
// 关闭胶水统一 useDismiss(外点 pointerdown + Esc;不用 onBlur,WebKitGTK
// 点按钮不移焦点会误关)。
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { useRef, useState } from "react";

import { useI18n, type MessageKey } from "@/lib/i18n";
import { useUpwardMenuHeight } from "@/lib/util/menuHeight";
import type { ModelInfo } from "@/lib/ipc/sessions";
import { defaultEnabledSkills, type SkillInfo } from "@/lib/ipc/skills";
import {
  filterModels,
  groupMemberSections,
  modelDisplay,
  modelDisplayByName,
  modelMenuTabs,
  shouldShowModelExtras,
  stripSourceSuffix,
  SOURCE_MONKEYCODE,
} from "@/lib/models/modelMenu";
import { THINK_KEY } from "@/lib/protocol/reduce";
import { useDismiss } from "@/lib/util/useDismiss";

// 档位 → 键的映射收口在 lib/protocol/reduce(think_update 系统行同用一份):
// 两处各写一份的话,加档位时改一处漏一处,系统行与选择器就会各说各话
export { THINK_KEY };
/** 档位副文案(一句话讲清速度/深度取舍);""=跟随默认无副文案。 */
export const THINK_HINT_KEY: Partial<Record<string, MessageKey>> = {
  off: "chat.think.hint.off",
  low: "chat.think.hint.low",
  medium: "chat.think.hint.medium",
  high: "chat.think.hint.high",
};
export const THINK_LEVELS = ["off", "low", "medium", "high"] as const;

/** 触发器公共形态:幽灵小按钮 + 旋转箭头。 */
function Trigger({
  open,
  disabled,
  title,
  ariaLabel,
  className,
  anchorRef,
  onToggle,
  children,
}: {
  open: boolean;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  className?: string;
  /** 量「向上还能长多高」的锚点(useUpwardMenuHeight) */
  anchorRef?: React.Ref<HTMLButtonElement>;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      ref={anchorRef}
      type="button"
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-expanded={open}
      className={`btn btn-ghost btn-xs font-normal text-base-content/60 disabled:opacity-40 ${className ?? ""}`}
      onClick={onToggle}
    >
      {children}
      <IconChevronDown size={12} stroke={1.75} aria-hidden className="shrink-0 opacity-60" />
    </button>
  );
}

export function ModelMenu({
  models,
  current,
  onPick,
  disabled = false,
  title,
  ariaLabel,
  align = "end",
}: {
  models: ModelInfo[];
  current: string;
  /** 选中回调(菜单已自关);同名/空名的去重守卫由调用方决定 */
  onPick: (name: string) => void;
  disabled?: boolean;
  title?: string;
  /** 触发器 aria-label;不传则可及名 = 当前模型展示名(composer 契约) */
  ariaLabel?: string;
  align?: "start" | "end";
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, boxRef, () => setOpen(false));
  // 向上弹:高度按锚点到最近上边界(标题栏/视图头)的真实距离算,
  // 写死上限在矮窗口下会把菜单顶出视口(lib/util/menuHeight)
  const { anchorRef, maxHeight: menuMax } = useUpwardMenuHeight<HTMLButtonElement>(open);

  // 模型菜单派生(纯逻辑在 lib/models/modelMenu):过滤框在模型多时才有
  // 意义;tab 行只要 ≥2 来源就恒显(它是来源间唯一导航);过滤在 tab 内;
  // 会员 tab 按档位/付费/我的/团队分节,其余来源平铺
  const showExtras = shouldShowModelExtras(models.length);
  const tabs = modelMenuTabs(models);
  const showTabs = tabs.length >= 2;
  // 当前来源归一必须 `|| ""`:自定义的 tab key 是空串,`??` 会把它吞成会员
  const currentSource = models.find((m) => m.name === current)?.source || "";
  const wantTab = tab ?? currentSource;
  const activeTab = tabs.some((it) => it.key === wantTab) ? wantTab : (tabs[0]?.key ?? "");
  const tabItems = filterModels(
    models.filter((m) => (m.source || "") === activeTab),
    filter,
  );
  const memberSections = activeTab === SOURCE_MONKEYCODE ? groupMemberSections(tabItems) : null;

  const openMenu = () => {
    setFilter("");
    setTab(null); // 打开时回到「跟随当前模型来源」
    setOpen(true);
  };
  const pick = (name: string) => {
    setOpen(false);
    onPick(name);
  };
  // 模型条目渲染收口:会员分节内省略档位徽标(节头已表达);locked 条目
  // 灰态禁选 + 行尾「未解锁」徽标(设置页同形态)——解锁路径的详情 title
  // 必须挂 li:disabled 按钮在多数 webview 不弹 tooltip(2026-08-06 用户
  // 报障「提示没了」的根因);onPick 必须用原始 name(引擎寻址键)
  const itemOf = (m: ModelInfo, noTier = false) => {
    const d = modelDisplay(m);
    return (
      <li
        key={m.name}
        className={m.locked ? "menu-disabled" : ""}
        title={m.locked ? `${stripSourceSuffix(m.name)} · ${t("chat.model.locked")}` : undefined}
      >
        <button
          type="button"
          disabled={m.locked}
          title={m.locked ? undefined : stripSourceSuffix(m.name)}
          aria-current={m.name === current ? "true" : undefined}
          className={`flex items-center gap-2 ${m.name === current ? "menu-active" : ""}`}
          onClick={() => pick(m.name)}
        >
          <span className="min-w-0 flex-1 truncate text-xs">{d.label}</span>
          {!noTier && d.tier && <span className="badge badge-ghost badge-xs shrink-0">{d.tier}</span>}
          {m.locked && <span className="badge badge-warning badge-soft badge-xs shrink-0">{t("settings.models.lockedBadge")}</span>}
          {m.default && <span className="shrink-0 text-[10px] opacity-50">{t("chat.model.default")}</span>}
        </button>
      </li>
    );
  };

  return (
    <div
      ref={boxRef}
      className={`dropdown dropdown-top min-w-0 shrink ${align === "end" ? "dropdown-end" : ""} ${open ? "dropdown-open" : ""}`}
    >
      <Trigger
        open={open}
        disabled={disabled}
        title={title}
        ariaLabel={ariaLabel}
        className="max-w-52"
        anchorRef={anchorRef}
        onToggle={() => (open ? setOpen(false) : openMenu())}
      >
        <span className="min-w-0 truncate">{modelDisplayByName(models, current).label || t("chat.model.label")}</span>
      </Trigger>
      {open && (
        // dropdown-content 换 div 外壳:过滤框/来源 tab 固定在顶,
        // 条目列表单独内滚(菜单长了不能把导航滚出视野)
        <div
          style={{ maxHeight: menuMax }}
          className="dropdown-content flex w-64 flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
        >
          {/* 不 autoFocus:打开菜单是「点选」意图,焦点跳进过滤框
              反而抢走键盘上下文(用户定案) */}
          {showExtras && (
            <input
              aria-label={t("chat.model.filter")}
              placeholder={t("chat.model.filter")}
              className="input input-xs mb-1 w-full shrink-0"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
          {showTabs && (
            <div role="tablist" aria-label={t("chat.model.sourceTabs")} className="tabs tabs-border tabs-xs shrink-0">
              {tabs.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  role="tab"
                  aria-selected={it.key === activeTab}
                  className={`tab ${it.key === activeTab ? "tab-active" : ""}`}
                  onClick={() => setTab(it.key)}
                >
                  {it.label}
                </button>
              ))}
            </div>
          )}
          <ul
            aria-label={t("chat.model.label")}
            className="menu w-full flex-nowrap [&_li]:flex-nowrap overflow-x-hidden overflow-y-auto p-0"
          >
            {tabItems.length === 0 && (
              <li className="menu-disabled">
                <span className="text-xs">{models.length === 0 ? t("chat.model.empty") : t("chat.model.noMatch")}</span>
              </li>
            )}
            {/* 会员 tab:档位/付费/我的/团队分节,节头恒显(每节都承载
                语义,条目内省略档位徽标);其余来源平铺 */}
            {/* 节头 text-xs:menu-title 默认 .875rem 比条目(text-xs)还大,
                比例倒挂(2026-08-06 用户报障「基础模型四个字太大」) */}
            {memberSections !== null
              ? memberSections.map((s) => [
                  <li key={`${s.label}-title`} className="menu-title flex flex-row items-baseline gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                    {s.badge && <span className="shrink-0 text-[10px] font-normal">{s.badge}</span>}
                  </li>,
                  ...s.items.map((m) => itemOf(m, true)),
                ])
              : tabItems.map((m) => itemOf(m))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ThinkMenu({
  current,
  display,
  onPick,
  levels = [...THINK_LEVELS],
  disabled = false,
  title,
  ariaLabel,
  align = "end",
}: {
  /** 菜单选中态(新建任务页可为 ""=跟随模型默认) */
  current: string;
  /** 触发器展示档(生效档;缺省同 current) */
  display?: string;
  onPick: (level: string) => void;
  levels?: string[];
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  align?: "start" | "end";
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, boxRef, () => setOpen(false));
  const shown = display ?? current;
  return (
    <div
      ref={boxRef}
      className={`dropdown dropdown-top shrink-0 ${align === "end" ? "dropdown-end" : ""} ${open ? "dropdown-open" : ""}`}
    >
      <Trigger open={open} disabled={disabled} title={title} ariaLabel={ariaLabel} onToggle={() => setOpen(!open)}>
        {t("chat.think.trigger", { label: t(THINK_KEY[shown] ?? "chat.think.low") })}
      </Trigger>
      {open && (
        <ul
          aria-label={t("chat.think.label")}
          className="dropdown-content menu w-52 flex-nowrap [&_li]:flex-nowrap rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
        >
          {levels.map((level) => {
            const hintKey = THINK_HINT_KEY[level];
            return (
              <li key={level}>
                <button
                  type="button"
                  aria-current={level === current ? "true" : undefined}
                  className={`flex flex-col items-start gap-0 ${level === current ? "menu-active" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    onPick(level);
                  }}
                >
                  <span className="text-xs">{t(THINK_KEY[level] ?? "chat.think.low")}</span>
                  {/* 档位副文案:一句话讲清速度/深度取舍(旧 UI hint 随迁) */}
                  {hintKey && <span className="text-[10px] opacity-60">{t(hintKey)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 会话技能启用集(多选)。与单选菜单的两点差异:勾选**不关**菜单
 * (一次会话常要调多个),条目用 checkbox 语义(aria-checked);每次勾选
 * 都全量提交(壳侧 session_set_skills 是全量声明,不是增量 patch)。
 * enabled=null 表示"缺省集"(官方四件套 + 用户技能,defaultEnabledSkills;
 * 与壳侧物化规则一致),首次勾选变更时展开成显式名单提交。 */
export function SkillsMenu({
  skills,
  enabled,
  onChange,
  disabled = false,
  title,
  align = "end",
}: {
  skills: SkillInfo[];
  /** 启用名单;null = 全部启用 */
  enabled: string[] | null;
  /** 勾选变更(已展开为显式全量名单) */
  onChange: (next: string[]) => void;
  disabled?: boolean;
  title?: string;
  align?: "start" | "end";
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, boxRef, () => setOpen(false));
  const { anchorRef, maxHeight: menuMax } = useUpwardMenuHeight<HTMLButtonElement>(open);
  const enabledSet = new Set(enabled ?? defaultEnabledSkills(skills));
  const toggle = (name: string) => {
    const next = new Set(enabledSet);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    // 按库序输出稳定名单(Set 的插入序会随点击历史漂移,sidecar 里存的
    // 快照与展示序一致才好对账)
    onChange(skills.map((s) => s.name).filter((n) => next.has(n)));
  };
  // 来源 tab + 过滤(与 ModelMenu 同构,用户定案 2026-08-12:分节改 tab)。
  // tab 只在两种来源都有条目时出现(单来源没有导航意义);过滤在 tab 内,
  // 名字/描述子串匹配(官方库几十个,没有过滤框全靠滚)
  const isUserSkill = (s: SkillInfo) => s.source === "user";
  const tabs = [
    { key: "builtin", label: t("skill.source.builtin") },
    { key: "user", label: t("skill.source.custom") },
  ].filter((it) => skills.some((s) => isUserSkill(s) === (it.key === "user")));
  const showTabs = tabs.length >= 2;
  const wantTab = tab ?? "builtin";
  const activeTab = tabs.some((it) => it.key === wantTab) ? wantTab : (tabs[0]?.key ?? "builtin");
  const q = filter.trim().toLowerCase();
  const items = skills.filter(
    (s) =>
      isUserSkill(s) === (activeTab === "user") &&
      (!q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)),
  );
  const showFilter = shouldShowModelExtras(skills.length);
  const openMenu = () => {
    setFilter("");
    setTab(null); // 打开时回到内置 tab(条目主体)
    setOpen(true);
  };
  // 单行条目:只放名字,描述走 li 的 title 悬停(行内塞副文案两行太高太吵,
  // 2026-08-12 用户定案)。启用态 = 行尾对勾(用户定案行尾;不用 checkbox
  // 控件:主题大圆角下它渲染成粗边圆圈,一列全勾像一排单选钮)。未启用留
  // invisible 占位保持名字截断宽度一致,文字降色作第二信号
  const itemOf = (s: SkillInfo) => {
    const on = enabledSet.has(s.name);
    return (
      <li key={s.name} title={s.description || undefined}>
        <button
          type="button"
          role="checkbox"
          aria-checked={on}
          className="flex items-center gap-2"
          onClick={() => toggle(s.name)}
        >
          <span className={`min-w-0 flex-1 truncate text-xs ${on ? "" : "text-base-content/60"}`}>
            {s.name}
          </span>
          <IconCheck
            size={14}
            stroke={2.25}
            aria-hidden
            className={`shrink-0 text-primary ${on ? "" : "invisible"}`}
          />
        </button>
      </li>
    );
  };
  return (
    <div
      ref={boxRef}
      className={`dropdown dropdown-top shrink-0 ${align === "end" ? "dropdown-end" : ""} ${open ? "dropdown-open" : ""}`}
    >
      <Trigger
        open={open}
        disabled={disabled}
        title={title}
        ariaLabel={t("chat.skills.label")}
        anchorRef={anchorRef}
        onToggle={() => (open ? setOpen(false) : openMenu())}
      >
        {/* 交集计数:启用集快照可能带着已从库移除的技能名(仓库删技能 +
            应用更新的场景),直接取 size 会虚报 */}
        {t("chat.skills.trigger", { n: skills.filter((s) => enabledSet.has(s.name)).length })}
      </Trigger>
      {open && (
        // 结构同 ModelMenu:过滤框固定在顶,条目列表单独内滚
        <div
          style={{ maxHeight: menuMax }}
          className="dropdown-content flex w-64 flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
        >
          {showFilter && (
            <input
              aria-label={t("chat.skills.filter")}
              placeholder={t("chat.skills.filter")}
              className="input input-xs mb-1 w-full shrink-0"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
          {showTabs && (
            <div role="tablist" aria-label={t("chat.skills.sourceTabs")} className="tabs tabs-border tabs-xs shrink-0">
              {tabs.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  role="tab"
                  aria-selected={it.key === activeTab}
                  className={`tab ${it.key === activeTab ? "tab-active" : ""}`}
                  onClick={() => setTab(it.key)}
                >
                  {it.label}
                </button>
              ))}
            </div>
          )}
          <ul
            aria-label={t("chat.skills.label")}
            className="menu w-full flex-nowrap [&_li]:flex-nowrap overflow-x-hidden overflow-y-auto p-0"
          >
            {items.length === 0 && (
              <li className="menu-disabled">
                <span className="text-xs whitespace-normal">
                  {skills.length === 0 ? t("chat.skills.empty") : t("chat.skills.noMatch")}
                </span>
              </li>
            )}
            {items.map(itemOf)}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface OptionItem {
  value: string;
  label: string;
  disabled?: boolean;
  /** 行尾徽标(如锁定项的「未解锁」资格说明) */
  note?: string;
  /** 悬停详情;挂 li 而非按钮——disabled 按钮在多数 webview 不弹 tooltip */
  hint?: string;
}

/** 通用单选菜单(云端任务的模型/宿主机/镜像等):形态同上;平铺给 options,
 * 分组给 sections(节头 = menu-title,同 ModelMenu 会员分节)。 */
export function OptionMenu({
  options,
  sections,
  value,
  onPick,
  ariaLabel,
  triggerLabel,
  disabled = false,
  title,
  notice,
  align = "start",
}: {
  options?: OptionItem[];
  sections?: Array<{ key: string; label: string; badge?: string; options: OptionItem[] }>;
  value: string;
  onPick: (value: string) => void;
  /** 触发器与菜单列表共用的可及名(role 区分,查询不歧义) */
  ariaLabel: string;
  /** 触发器展示文案;缺省 = 选中项 label(分组场景可传「组名 / 条目名」) */
  triggerLabel?: string;
  disabled?: boolean;
  title?: string;
  /** 选项受限的**可见**说明,渲染成菜单首行。
   *  为什么不能用 `disabled` + `title` 表达:daisyUI 的
   *  `.btn:is(:disabled,[disabled],[aria-disabled=true])` 带
   *  `pointer-events:none`,命中不到元素,任何内核都不会弹这条 tooltip
   *  ——用户看到的只是一个灰掉、点不动、也没有任何说明的控件。
   *  (同目录 ModelMenu 的 locked 条目为同一件事踩过坑并留了注释。) */
  notice?: string;
  align?: "start" | "end";
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, boxRef, () => setOpen(false));
  // 向上弹:高度按锚点到最近上边界(标题栏/视图头)的真实距离算,
  // 写死上限在矮窗口下会把菜单顶出视口(lib/util/menuHeight)
  const { anchorRef, maxHeight: menuMax } = useUpwardMenuHeight<HTMLButtonElement>(open);
  const flat = options ?? sections?.flatMap((s) => s.options) ?? [];
  const currentLabel = triggerLabel ?? flat.find((o) => o.value === value)?.label ?? ariaLabel;
  const itemOf = (o: OptionItem) => (
    <li key={o.value} className={o.disabled ? "menu-disabled" : ""} title={o.hint}>
      <button
        type="button"
        disabled={o.disabled}
        aria-current={o.value === value ? "true" : undefined}
        className={`flex items-center gap-2 ${o.value === value ? "menu-active" : ""}`}
        onClick={() => {
          setOpen(false);
          onPick(o.value);
        }}
      >
        <span className="min-w-0 flex-1 truncate text-xs">{o.label}</span>
        {o.note && <span className="badge badge-warning badge-soft badge-xs shrink-0">{o.note}</span>}
      </button>
    </li>
  );
  return (
    <div
      ref={boxRef}
      className={`dropdown dropdown-top min-w-0 shrink ${align === "end" ? "dropdown-end" : ""} ${open ? "dropdown-open" : ""}`}
    >
      <Trigger
        open={open}
        disabled={disabled}
        title={title ?? currentLabel}
        ariaLabel={ariaLabel}
        className="max-w-48"
        anchorRef={anchorRef}
        onToggle={() => setOpen(!open)}
      >
        <span className="min-w-0 truncate">{currentLabel}</span>
      </Trigger>
      {open && (
        <ul
          aria-label={ariaLabel}
          style={{ maxHeight: menuMax }}
          className="dropdown-content menu w-64 flex-nowrap [&_li]:flex-nowrap overflow-x-hidden overflow-y-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
        >
          {/* 空清单也要说话(与 ModelMenu 同形态):调用方在拉取失败/尚未拉到
              时给的就是空数组(云端 models===null → sections=[]),没有这一档
              菜单展开是一个**没有任何内容的空盒子**——看着像点坏了 */}
          {flat.length === 0 && (
            <li className="menu-disabled">
              <span className="text-xs">{t("chat.option.empty")}</span>
            </li>
          )}
          {/* 受限说明:菜单里一行可见文字,不走 disabled 按钮的 title */}
          {notice && (
            <li className="menu-disabled">
              <span className="text-xs whitespace-normal">{notice}</span>
            </li>
          )}
          {/* 节头 text-xs:与 ModelMenu 同理(menu-title 默认比条目大,倒挂) */}
          {sections
            ? sections.map((s) => [
                <li key={`${s.key}-title`} className="menu-title flex flex-row items-baseline gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  {s.badge && <span className="shrink-0 text-[10px] font-normal">{s.badge}</span>}
                </li>,
                ...s.options.map(itemOf),
              ])
            : flat.map(itemOf)}
        </ul>
      )}
    </div>
  );
}
