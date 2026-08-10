// 模型列表编辑:行内受控展开(一次一行),增删改与"设为默认"。
// 表单呈现全部可改字段(名称/协议/接口地址/API Key/模型标识/上下文窗口/
// 最大输出/思考深度/图片输入)——可展开的是百智云与自定义条目,它们的窗口
// 与输出上限本就该由用户改(旧 UI 的「高级选项」折叠区,这里平铺不再二级
// 折叠);同步标记(source/locked/owner)留在草稿对象里随保存透传。
// 上下文窗口/最大输出留空 = 落壳的产品默认(200000/32768),不写死进草稿;
// 两者的比例不做校验(用户定案 2026-08-06,理由见 settingsForm.validateDraft)。
// 展示口径:行标题经 modelDisplay 剥来源后缀/会员档位前缀(落盘名是引擎
// 寻址键,任何展示面都必须剥;编辑表单里的「名称」字段仍是原始键);
// 列表按来源分组(会员→百智云→自定义,modelSourceRank 单一出处)。百智云组
// 与自定义组恒在(空了也出组头 + 引导卡):组是"模型从哪来"的说明位,按现有
// 条目派生的话,一个模型都没有的新装用户恰恰看不到该去哪里同步。会员组仍
// 只在有条目时出现(引导在账号页卡片,不在这里堆空态)。
import { IconChevronDown, IconPlus } from "@tabler/icons-react";
import { useState } from "react";

import { useI18n } from "@/lib/i18n";
import type { HostModel } from "@/lib/ipc/config";
import type { ModelInfo } from "@/lib/ipc/sessions";
import { groupMemberSections, modelDisplay, modelSourceRank, SOURCE_BAIZHI, SOURCE_MONKEYCODE } from "@/lib/models/modelMenu";
import { emptyModel, type SettingsDraft } from "./settingsForm";

/** 数字输入 → 草稿值:空/非法/非正一律回 undefined(= 用产品默认,不落盘)。 */
const posInt = (v: string): number | undefined => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** 折叠行的高级项摘要:只列**显式配置过**的项(缺省值不占位置——
 *  「跟默认一样」不值得占一行的横向预算)。
 *
 *  **会员条目(source=monkeycode)整句不出**(用户定案 2026-08-09):窗口/
 *  输出/图片/思考档都是随同步整组下来的,用户一项也改不了(会员行不可展开,
 *  表单里本来就没有它们)。advSummary 的存在理由是「配置过的值收起来就看不见,
 *  改完一合上认不出这行跟别行有何不同」——在会员行上这个前提根本不成立:
 *  没人在这儿配过任何东西,于是它退化成一串把每行都撑长的噪音。 */
function advSummary(m: HostModel, t: ReturnType<typeof useI18n>["t"]): string {
  if (m.source === SOURCE_MONKEYCODE) return "";
  const parts = [
    m.context_window ? t("settings.models.sum.ctx", { n: m.context_window.toLocaleString() }) : "",
    m.max_output ? t("settings.models.sum.out", { n: m.max_output.toLocaleString() }) : "",
    m.think ? t("settings.models.sum.think", { level: t(THINK_LABEL_KEY[m.think] ?? "settings.models.think.default") }) : "",
    m.vision ? t("settings.models.sum.vision") : "",
  ].filter(Boolean);
  return parts.length ? `(${parts.join(t("common.metaSep"))})` : "";
}

/** 思考档值 → 词条键(与下方选择器同一张表) */
const THINK_LABEL_KEY: Record<string, "settings.models.think.off" | "settings.models.think.low" | "settings.models.think.medium" | "settings.models.think.high"> = {
  off: "settings.models.think.off",
  low: "settings.models.think.low",
  medium: "settings.models.think.medium",
  high: "settings.models.think.high",
};

export function ModelsSection({
  draft,
  onDraft,
  baizhiLoggedIn = false,
}: {
  draft: SettingsDraft;
  onDraft: (up: (d: SettingsDraft) => SettingsDraft) => void;
  /** 百智云登录态:只影响空组引导的措辞(去同步 / 先登录),旧 UI 同款 */
  baizhiLoggedIn?: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<number | null>(null);
  // 组折叠(旧工程 Section 折叠开关的等价物):默认全展开,点组头收起
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const patch = (i: number, p: Partial<HostModel>) =>
    onDraft((d) => ({ ...d, models: d.models.map((m, j) => (j === i ? { ...m, ...p } : m)) }));

  const remove = (i: number) => {
    onDraft((d) => ({
      ...d,
      models: d.models.filter((_, j) => j !== i),
      defaultIdx: i < d.defaultIdx ? d.defaultIdx - 1 : i === d.defaultIdx ? 0 : d.defaultIdx,
    }));
    setExpanded(null);
  };

  const add = () => {
    setExpanded(draft.models.length);
    onDraft((d) => ({ ...d, models: [...d.models, emptyModel()] }));
  };

  // 来源分组(保留原始下标:展开/删改/设默认全部按扁平数组下标寻址)
  const groupMap = new Map<string, { key: string; label: string; rank: number; items: Array<{ m: HostModel; i: number }> }>();
  const groupOf = (key: string, source?: string) => {
    let g = groupMap.get(key);
    if (!g) {
      const label =
        key === SOURCE_MONKEYCODE
          ? t("model.source.member")
          : key === SOURCE_BAIZHI
            ? t("model.source.baizhi")
            : key || t("model.source.custom");
      g = { key, label, rank: modelSourceRank(source), items: [] };
      groupMap.set(key, g);
    }
    return g;
  };
  // 百智云组与自定义组**恒在**(旧 UI 同款,ui-next 首版按现有条目派生分组
  // 时丢了这条):组空时不是"少一块",而是唯一能告诉用户「模型从哪来」的
  // 那句话没了——新装用户只看到一句通用空态,查不到该去账号页点同步。
  // 代价是全手工条目时也会出组头(此前的「全手工不出组头」随之作废)
  groupOf(SOURCE_BAIZHI, SOURCE_BAIZHI);
  groupOf("", undefined);
  draft.models.forEach((m, i) => groupOf(m.source || "", m.source).items.push({ m, i }));
  const groups = [...groupMap.values()].sort((a, b) => a.rank - b.rank);
  /** 空组引导:百智云分「已登录去同步」「未登录先登录」两句,自定义组说明
   *  手工接入要填什么(旧 UI settings.tsx 三句原样随迁)。 */
  const emptyHint = (key: string): string =>
    key === SOURCE_BAIZHI
      ? t(baizhiLoggedIn ? "settings.models.baizhiEmpty" : "settings.models.baizhiEmptyLoggedOut")
      : t("settings.models.customEmpty");

  // 行 = daisyUI list-row。契约(用户定案 2026-08-06):
  // - 会员条目(source=monkeycode)只读不可展开——配置随同步整组更新,表单
  //   里没有可改的东西;百智云/手工条目可展开编辑;
  // - 同步条目(会员/百智云)只有「设为默认」,删除只给自定义条目(同步组
  //   的成员由云端管理,本地删了重同步也会回来,徒增困惑);
  // - 动作 hover 才显现(每行常驻是视觉噪音);锁定条目不物化进引擎,
  //   不给「设为默认」;
  // - 同步条目不露 wire 串(与名称/档位节头重复);手工条目保留 model 标识
  //   (名称是用户起的别名,标识才是身份)。noTier:会员组按档位分节后节头
  //   已表达档位,行内不再重复贴徽标
  const row = (m: HostModel, i: number, noTier = false) => {
    const managed = m.source === SOURCE_MONKEYCODE;
    const open = expanded === i && !managed;
    const d = modelDisplay({ name: m.name, model: m.model, source: m.source });
    const nameBody = (
      <>
        {/* 行主文本 = 应用基准 14px 常规(与侧栏/菜单行同级),不加粗:
            名称的主导地位靠 wire 串的灰色等宽小字衬出,不靠字重 */}
        <span className={`truncate ${m.locked ? "text-base-content/50" : ""}`}>
          {d.label.trim() || t("settings.models.unnamed")}
        </span>
        {!noTier && d.tier && <span className="badge badge-ghost badge-sm shrink-0">{d.tier}</span>}
        {m.locked && <span className="badge badge-warning badge-soft badge-sm shrink-0">{t("settings.models.lockedBadge")}</span>}
        {!m.source && m.model && <span className="min-w-0 truncate font-mono text-xs text-base-content/50">{m.model}</span>}
        {/* 折叠态补一句高级项摘要(旧 UI advSummary):配置过的值收起来就
            完全不可见,用户改完一合上根本认不出这行跟别行有什么不同。
            展开时不出——下面的表单里逐项都在,重复一遍是噪音 */}
        {!open && advSummary(m, t) && (
          <span className="min-w-0 shrink truncate text-xs text-base-content/45">{advSummary(m, t)}</span>
        )}
      </>
    );
    return (
          <li key={i} className="flex flex-col">
            {/* 整行是展开热区(旧工程口径);动作钮截断冒泡。箭头恒在行尾,
                hover 动作在名称与箭头之间滑入,不推挤箭头 */}
            <div
              className={`group list-row items-center gap-2 rounded-none px-4 py-2 transition-colors hover:bg-base-200/40 ${managed ? "" : "cursor-pointer"}`}
              onClick={managed ? undefined : () => setExpanded(open ? null : i)}
            >
              {managed ? (
                <span className="list-col-grow flex min-w-0 items-center gap-2" title={m.name.trim() || undefined}>
                  {nameBody}
                </span>
              ) : (
                // 无独立 onClick:点击冒泡到行级热区,一次翻转(role/aria 仍在)
                <button
                  type="button"
                  aria-expanded={open}
                  title={m.name.trim() || undefined}
                  className="list-col-grow flex min-w-0 cursor-pointer items-center gap-2 text-start"
                >
                  {nameBody}
                </button>
              )}
              {i === draft.defaultIdx ? (
                <span className="badge badge-primary badge-sm shrink-0">{t("settings.models.default")}</span>
              ) : (
                !m.locked && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs shrink-0 text-base-content/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDraft((d) => ({ ...d, defaultIdx: i }));
                    }}
                  >
                    {t("settings.models.setDefault")}
                  </button>
                )
              )}
              {!m.source && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs shrink-0 text-base-content/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-error"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(i);
                  }}
                >
                  {t("settings.models.delete")}
                </button>
              )}
              {!managed && (
                <IconChevronDown
                  size={14}
                  stroke={1.75}
                  aria-hidden
                  className={`shrink-0 text-base-content/40 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                />
              )}
            </div>
            {open && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-base-300 px-4 pt-2 pb-4">
                <fieldset className="fieldset gap-1.5">
                  <legend className="fieldset-legend">{t("settings.models.name")}</legend>
                  <input
                    className="input input-sm w-full"
                    aria-label={t("settings.models.name")}
                    value={m.name}
                    onChange={(e) => patch(i, { name: e.target.value })}
                  />
                </fieldset>
                <fieldset className="fieldset gap-1.5">
                  <legend className="fieldset-legend">{t("settings.models.provider")}</legend>
                  <select
                    className="select select-sm w-full"
                    aria-label={t("settings.models.provider")}
                    value={m.provider || "anthropic"}
                    onChange={(e) => patch(i, { provider: e.target.value })}
                  >
                    <option value="anthropic">anthropic</option>
                    <option value="openai">openai(Chat Completions)</option>
                    <option value="openai_responses">openai_responses(Responses)</option>
                  </select>
                </fieldset>
                <fieldset className="fieldset col-span-2">
                  <legend className="fieldset-legend">{t("settings.models.baseUrl")}</legend>
                  <input
                    className="input input-sm w-full font-mono text-xs"
                    aria-label={t("settings.models.baseUrl")}
                    placeholder="https://api.example.com"
                    value={m.base_url}
                    onChange={(e) => patch(i, { base_url: e.target.value })}
                  />
                </fieldset>
                <fieldset className="fieldset gap-1.5">
                  <legend className="fieldset-legend">{t("settings.models.apiKey")}</legend>
                  <input
                    className="input input-sm w-full font-mono text-xs"
                    type="password"
                    aria-label={t("settings.models.apiKey")}
                    placeholder="sk-..."
                    value={m.api_key}
                    onChange={(e) => patch(i, { api_key: e.target.value })}
                  />
                </fieldset>
                <fieldset className="fieldset gap-1.5">
                  <legend className="fieldset-legend">{t("settings.models.model")}</legend>
                  <input
                    className="input input-sm w-full font-mono text-xs"
                    aria-label={t("settings.models.model")}
                    value={m.model}
                    onChange={(e) => patch(i, { model: e.target.value })}
                  />
                </fieldset>
                <fieldset className="fieldset gap-1.5">
                  <legend className="fieldset-legend">{t("settings.models.contextWindow")}</legend>
                  {/* 留空 = 产品默认;非正整数按留空处理(不把 0/负数写进草稿) */}
                  <input
                    className="input input-sm w-full font-mono text-xs"
                    type="number"
                    min={1}
                    aria-label={t("settings.models.contextWindow")}
                    placeholder={t("settings.models.contextWindow.placeholder")}
                    value={m.context_window ?? ""}
                    onChange={(e) => patch(i, { context_window: posInt(e.target.value) })}
                  />
                </fieldset>
                <fieldset className="fieldset gap-1.5">
                  <legend className="fieldset-legend">{t("settings.models.maxOutput")}</legend>
                  <input
                    className="input input-sm w-full font-mono text-xs"
                    type="number"
                    min={1}
                    aria-label={t("settings.models.maxOutput")}
                    placeholder={t("settings.models.maxOutput.placeholder")}
                    title={t("settings.models.maxOutput.hint")}
                    value={m.max_output ?? ""}
                    onChange={(e) => patch(i, { max_output: posInt(e.target.value) })}
                  />
                </fieldset>
                <fieldset className="fieldset gap-1.5">
                  <legend className="fieldset-legend">{t("settings.models.think")}</legend>
                  {/* 缺省("")= 产品默认「低」;off 才是关闭——契约同壳/内核 */}
                  <select
                    className="select select-sm w-full"
                    aria-label={t("settings.models.think")}
                    value={m.think ?? ""}
                    onChange={(e) => patch(i, { think: e.target.value || undefined })}
                  >
                    <option value="">{t("settings.models.think.default")}</option>
                    <option value="off">{t("settings.models.think.off")}</option>
                    <option value="low">{t("settings.models.think.low")}</option>
                    <option value="medium">{t("settings.models.think.medium")}</option>
                    <option value="high">{t("settings.models.think.high")}</option>
                  </select>
                </fieldset>
                <fieldset className="fieldset gap-1.5">
                  <legend className="fieldset-legend">{t("settings.models.vision")}</legend>
                  {/* 勾选 = 显式支持;不勾选时壳写 supports_images:false,
                      图片以路径文本进对话(不发图片块) */}
                  <label className="label h-8 cursor-pointer justify-start gap-2" title={t("settings.models.vision.hint")}>
                    <input
                      type="checkbox"
                      className="toggle toggle-sm"
                      checked={!!m.vision}
                      onChange={(e) => patch(i, { vision: e.target.checked || undefined })}
                    />
                    <span className="text-xs">{t("settings.models.vision.on")}</span>
                  </label>
                </fieldset>
              </div>
            )}
          </li>
        );
  };

  return (
    <section aria-label={t("settings.nav.models")} className="flex flex-col gap-2">
      {groups.map((g) => {
        // 会员组按档位/来源分节(基础/专业/旗舰/付费/我的/团队,与模型菜单
        // 同一 groupMemberSections 口径):节头表达档位,行内免重复贴徽标。
        // 结构性转型(HostModel ⊂ ModelInfo 形状,default 可缺省),节内条目
        // 经对象同一性映回扁平数组下标
        const memberSections =
          g.key === SOURCE_MONKEYCODE
            ? groupMemberSections(g.items.map(({ m }) => m) as unknown as ModelInfo[])
            : null;
        const indexOf = new Map(g.items.map(({ m, i }) => [m as unknown as ModelInfo, i]));
        const groupOpen = !collapsedGroups.has(g.key);
        const empty = g.items.length === 0;
        return (
          <div key={g.key || "custom"} className="flex flex-col gap-1.5">
            {/* 组头即折叠开关(旧工程 Section 同款交互):箭头 + 组名 + 计数。
                空组没有可折叠的东西,退成纯标签(不给一个点了什么都不发生的钮) */}
            {empty ? (
              <span className="mt-1 w-fit px-1 text-xs font-bold text-base-content/60">{g.label}</span>
            ) : (
              <button
                type="button"
                aria-expanded={groupOpen}
                className="mt-1 flex w-fit cursor-pointer items-center gap-1.5 px-1 text-xs font-bold text-base-content/60 transition-colors hover:text-base-content"
                onClick={() => toggleGroup(g.key)}
              >
                <IconChevronDown
                  size={13}
                  stroke={2}
                  aria-hidden
                  className={`shrink-0 transition-transform duration-150 ${groupOpen ? "" : "-rotate-90"}`}
                />
                {g.label}
                <span className="font-normal text-base-content/40">{g.items.length}</span>
              </button>
            )}
            {/* 空组 = 引导卡(模型从哪来的唯一说明,见上方分组构造处) */}
            {empty && (
              <div className="rounded-box border border-dashed border-base-300 px-4 py-6">
                <p className="text-center text-xs leading-relaxed text-base-content/50">{emptyHint(g.key)}</p>
              </div>
            )}
            {/* 组 = 一个 list 容器,行间分隔线;不再每行一个独立小盒子。
                overflow-hidden 同 McpSection:行 rounded-none 方角,daisyUI .list
                不裁剪,首/末行 hover 底色否则盖出圆角轮廓 */}
            {!empty && groupOpen && (
              <ul className="list divide-y divide-base-300 overflow-hidden rounded-box border border-base-300 bg-base-100">
                {memberSections
                  ? memberSections.map((s) => [
                      <li
                        key={`${s.label}-title`}
                        className="flex items-baseline gap-2 px-4 pt-2.5 pb-1 text-xs font-bold tracking-wide text-base-content/40"
                      >
                        {s.label}
                        {s.badge && <span className="font-normal">{s.badge}</span>}
                      </li>,
                      ...s.items.map((m) => row(m as unknown as HostModel, indexOf.get(m)!, true)),
                    ])
                  : g.items.map(({ m, i }) => row(m, i))}
              </ul>
            )}
          </div>
        );
      })}
      {/* 「添加模型」恒在(自定义组恒在,空态也要有落点),不再随条目数显隐 */}
      <button type="button" className="btn btn-sm btn-outline w-fit" onClick={add}>
        <IconPlus size={14} stroke={2} aria-hidden />
        {t("settings.models.add")}
      </button>
    </section>
  );
}
