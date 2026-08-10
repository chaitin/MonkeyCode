// MCP 服务器编辑:与模型列表同一套行内展开交互与脏状态(同一份草稿)。
// 条目形态 = settingsForm.McpEntry(与内核 mcp.json 的 mcpServers 同构),
// 表单外字段进 extra 随保存透传。
import { IconChevronDown, IconPlus } from "@tabler/icons-react";
import { useState } from "react";

import { useI18n } from "@/lib/i18n";
import { emptyMcp, type McpEntry, type SettingsDraft } from "./settingsForm";

/** 停用态真值在 extra.disabled(表单外字段,随保存原样透传回 mcp_servers)。 */
const isDisabled = (m: McpEntry): boolean => m.extra?.disabled === true;

export function McpSection({
  draft,
  onDraft,
}: {
  draft: SettingsDraft;
  onDraft: (up: (d: SettingsDraft) => SettingsDraft) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<number | null>(null);

  const patch = (i: number, p: Partial<McpEntry>) =>
    onDraft((d) => ({ ...d, mcps: d.mcps.map((m, j) => (j === i ? { ...m, ...p } : m)) }));

  const remove = (i: number) => {
    onDraft((d) => ({ ...d, mcps: d.mcps.filter((_, j) => j !== i) }));
    setExpanded(null);
  };

  const add = () => {
    setExpanded(draft.mcps.length);
    onDraft((d) => ({ ...d, mcps: [...d.mcps, emptyMcp()] }));
  };

  /** 停用/启用:翻的是 extra.disabled(表单外字段,serversToMcps ⇄ mcpsToServers
   *  原样往返)。壳按它过滤派生 mcp.json(desktop/src/config.rs 物化处),所以
   *  停用 = 该 server 的工具整组不装载。ui-next 首版漏了这个开关:早先版本
   *  停用过的 server 在列表里与正常条目一模一样,工具却永远不出现,只能去手
   *  改 config.json——故连同「已停用」徽标一起补上。全空 extra 收回 undefined,
   *  免得往 mcp.json 里写一个空对象。 */
  const toggleDisabled = (i: number, m: McpEntry) => {
    const { disabled: _was, ...rest } = m.extra ?? {};
    const extra = isDisabled(m) ? rest : { ...rest, disabled: true };
    patch(i, { extra: Object.keys(extra).length ? extra : undefined });
  };

  return (
    <section aria-label={t("settings.nav.mcp")} className="flex flex-col gap-2">
      {draft.mcps.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-box border border-dashed border-base-300 px-6 py-10">
          <p className="text-center text-xs text-base-content/50">{t("settings.mcp.empty")}</p>
          <button type="button" className="btn btn-sm" onClick={add}>
            <IconPlus size={14} stroke={2} aria-hidden />
            {t("settings.mcp.add")}
          </button>
        </div>
      )}
      {/* 行形态与模型列表同款:一个 list 容器 + list-row(行级 hover,
          左段整体是展开钮,动作与旋转箭头靠右)。
          overflow-hidden 不可省:行是 rounded-none 的方角,daisyUI .list 自身
          不裁剪,首/末行的 hover 底色会盖出圆角轮廓(大圆角主题下尤其明显) */}
      {draft.mcps.length > 0 && (
      <ul className="list divide-y divide-base-300 overflow-hidden rounded-box border border-base-300 bg-base-100">
      {draft.mcps.map((m, i) => {
        const open = expanded === i;
        const disabled = isDisabled(m);
        return (
          <li key={i} className="flex flex-col">
            {/* 整行是展开热区;删除截断冒泡,箭头恒在行尾(同模型行) */}
            <div
              className="group list-row cursor-pointer items-center gap-2 rounded-none px-4 py-2 transition-colors hover:bg-base-200/40"
              onClick={() => setExpanded(open ? null : i)}
            >
              <button
                type="button"
                aria-expanded={open}
                className="list-col-grow flex min-w-0 cursor-pointer items-center gap-2 text-start"
              >
                {/* 停用条目降色 + 徽标外显:它在引擎侧是整组工具不装载,
                    看着和正常条目一样是查不出来的(见 toggleDisabled) */}
                <span className={`truncate ${disabled ? "text-base-content/50" : ""}`}>
                  {m.name.trim() || t("settings.models.unnamed")}
                </span>
                <span className="badge badge-ghost badge-sm shrink-0">{m.type}</span>
                {disabled && (
                  <span className="badge badge-warning badge-soft badge-sm shrink-0">{t("settings.mcp.disabledBadge")}</span>
                )}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs shrink-0 text-base-content/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleDisabled(i, m);
                }}
              >
                {t(disabled ? "settings.mcp.enable" : "settings.mcp.disable")}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs shrink-0 text-base-content/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-error"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(i);
                }}
              >
                {t("settings.mcp.delete")}
              </button>
              <IconChevronDown
                size={14}
                stroke={1.75}
                aria-hidden
                className={`shrink-0 text-base-content/40 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
              />
            </div>
            {open && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-base-300 px-4 pt-2 pb-4">
                <fieldset className="fieldset gap-1.5">
                  <legend className="fieldset-legend">{t("settings.mcp.name")}</legend>
                  <input
                    className="input input-sm w-full font-mono text-xs"
                    aria-label={t("settings.mcp.name")}
                    value={m.name}
                    onChange={(e) => patch(i, { name: e.target.value })}
                  />
                </fieldset>
                <fieldset className="fieldset gap-1.5">
                  <legend className="fieldset-legend">{t("settings.mcp.type")}</legend>
                  <select
                    className="select select-sm w-full"
                    aria-label={t("settings.mcp.type")}
                    value={m.type}
                    onChange={(e) => patch(i, { type: e.target.value === "stdio" ? "stdio" : "http" })}
                  >
                    <option value="http">HTTP</option>
                    <option value="stdio">stdio</option>
                  </select>
                </fieldset>
                {m.type === "http" ? (
                  <fieldset className="fieldset col-span-2">
                    <legend className="fieldset-legend">{t("settings.mcp.url")}</legend>
                    <input
                      className="input input-sm w-full font-mono text-xs"
                      aria-label={t("settings.mcp.url")}
                      placeholder="https://example.com/mcp"
                      value={m.url}
                      onChange={(e) => patch(i, { url: e.target.value })}
                    />
                  </fieldset>
                ) : (
                  <>
                    <fieldset className="fieldset gap-1.5">
                      <legend className="fieldset-legend">{t("settings.mcp.command")}</legend>
                      <input
                        className="input input-sm w-full font-mono text-xs"
                        aria-label={t("settings.mcp.command")}
                        placeholder="npx"
                        value={m.command}
                        onChange={(e) => patch(i, { command: e.target.value })}
                      />
                    </fieldset>
                    <fieldset className="fieldset gap-1.5">
                      <legend className="fieldset-legend">{t("settings.mcp.args")}</legend>
                      <input
                        className="input input-sm w-full font-mono text-xs"
                        aria-label={t("settings.mcp.args")}
                        value={m.args}
                        onChange={(e) => patch(i, { args: e.target.value })}
                      />
                    </fieldset>
                  </>
                )}
                <fieldset className="fieldset col-span-2">
                  <legend className="fieldset-legend">
                    {m.type === "http" ? t("settings.mcp.headers") : t("settings.mcp.env")}
                  </legend>
                  <textarea
                    className="textarea textarea-sm w-full font-mono text-xs"
                    rows={3}
                    aria-label={m.type === "http" ? t("settings.mcp.headers") : t("settings.mcp.env")}
                    value={m.kv}
                    onChange={(e) => patch(i, { kv: e.target.value })}
                  />
                </fieldset>
              </div>
            )}
          </li>
        );
      })}
      </ul>
      )}
      {draft.mcps.length > 0 && (
        <button type="button" className="btn btn-sm btn-outline w-fit" onClick={add}>
          <IconPlus size={14} stroke={2} aria-hidden />
          {t("settings.mcp.add")}
        </button>
      )}
    </section>
  );
}
