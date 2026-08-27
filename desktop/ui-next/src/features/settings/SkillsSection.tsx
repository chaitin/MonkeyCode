// 技能库管理:内置技能(随包分发,只读)与用户自定义技能(增改删)。
// 与模型/MCP 分区的关键差异:技能不进 config.json 草稿/保存事务——库本身
// 就是一目录一文件的权威(壳 src/skills.rs),skills_save/skills_delete
// 即时落盘,也**不重启引擎**(技能按会话物化,新建/重选启用集时生效)。
// 行形态照 McpSection(list-row + 行内展开编辑)。
import { IconChevronDown, IconFileZip, IconFolder, IconPlus } from "@tabler/icons-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { SkillsCatalogProvider, useOptionalSkillsCatalog, useSkillsCatalog } from "@/features/skills/SkillsCatalogProvider";

import { useI18n } from "@/lib/i18n";
import { inDesktopShell } from "@/lib/ipc/ipc";
import {
  isSkillCommandError,
  skillsDelete,
  skillsSave,
  skillsSetDefault,
  type SkillImportSourceKind,
} from "@/lib/ipc/skills";
import { useDismiss } from "@/lib/util/useDismiss";
import { BatchSkillImportDialog } from "./BatchSkillImportDialog";
import { RecoveryPanel } from "./RecoveryPanel";
import { useSkillImportController } from "./useSkillImportController";

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (typeof e === "object" && e !== null) {
    try {
      const message = (e as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) return message;
    } catch {
      // Proxy/getter 等异常对象不得让错误展示路径再次抛错。
    }
    return "未知错误";
  }
  return String(e);
}

/** 新建技能的 SKILL.md 起稿(frontmatter 缺省口径与壳/引擎一致:
 * description 单行;name 不写,跟随目录名,避免两处名字打架)。 */
function draftContent(t: (k: "settings.skills.tplDesc" | "settings.skills.tplBody") => string): string {
  return `---\ndescription: ${t("settings.skills.tplDesc")}\n---\n\n${t("settings.skills.tplBody")}\n`;
}

interface EditState {
  /** 编辑中的技能名(仅新建可改;编辑/覆盖内置都锁名——覆盖的意义就是
   * 同名用户技能压过内置,名字一变就成了另一个技能) */
  name: string;
  content: string;
  /** null = 新建(表单在列表下方);否则为行内表单锚定的条目名 */
  editing: string | null;
}

/** 入口只负责选择来源并交给 task 17 controller；批量预览主体由 task 19 承载。 */
function ImportSkillMenu({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (kind: SkillImportSourceKind) => void;
}) {
  const { t } = useI18n();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, boxRef, () => setOpen(false));

  const pick = (kind: SkillImportSourceKind) => {
    setOpen(false);
    onPick(kind);
  };

  return (
    <div ref={boxRef} className={`dropdown dropdown-end ${open ? "dropdown-open" : ""}`}>
      <button
        type="button"
        className="btn btn-sm btn-outline"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {t("settings.skills.import")}
        <IconChevronDown size={14} stroke={1.75} aria-hidden />
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          aria-label={t("settings.skills.import")}
          className="dropdown-content menu z-[var(--z-popover)] mt-1 w-72 flex-nowrap [&_li]:flex-nowrap rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
        >
          <li>
            <button type="button" role="menuitem" className="items-start gap-2" onClick={() => pick("folders")}>
              <IconFolder size={16} stroke={1.75} aria-hidden className="mt-0.5 shrink-0" />
              <span className="flex min-w-0 flex-col text-start">
                <span className="text-xs">{t("settings.skills.importFolders")}</span>
                <span className="text-2xs text-base-content/50">{t("settings.skills.importFoldersHint")}</span>
              </span>
            </button>
          </li>
          <li>
            <button type="button" role="menuitem" className="items-start gap-2" onClick={() => pick("zips")}>
              <IconFileZip size={16} stroke={1.75} aria-hidden className="mt-0.5 shrink-0" />
              <span className="flex min-w-0 flex-col text-start">
                <span className="text-xs">{t("settings.skills.importZips")}</span>
                <span className="text-2xs text-base-content/50">{t("settings.skills.importZipsHint")}</span>
              </span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export function SkillsSection() {
  const catalog = useOptionalSkillsCatalog();
  return catalog ? (
    <SkillsSectionContent />
  ) : (
    <SkillsCatalogProvider>
      <SkillsSectionContent />
    </SkillsCatalogProvider>
  );
}

function SkillsSectionContent() {
  const { skills, error: catalogError, calibrateSkillsCatalog, refreshSkillsCatalog } = useSkillsCatalog();
  const { t } = useI18n();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [busy, setBusy] = useState(false);
  const [highlightedImports, setHighlightedImports] = useState<Set<string>>(new Set());
  const skillImport = useSkillImportController();
  const importDisabled = busy || skillImport.operation !== null || !skillImport.operations.canPick;
  const startNew = () => {
    setExpanded(null);
    setEdit({ name: "", content: draftContent(t), editing: null });
  };
  const pickImportSource = (kind: SkillImportSourceKind) => {
    // controller 会保存结构化错误；入口层不额外抛出未处理 rejection。
    void skillImport.pick(kind).catch(() => {});
  };
  // 组折叠(ModelsSection 同款):默认全展开,点组头收起
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const revealImportedSkills = useCallback((names: string[]) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      next.delete("user");
      return next;
    });
    setHighlightedImports(new Set(names));
  }, []);

  useEffect(() => calibrateSkillsCatalog(), [calibrateSkillsCatalog]);
  const catalogRecoveryPending = isSkillCommandError(catalogError) && catalogError.code === "recovery-pending";
  const visibleLoadError = loadError ?? (catalogError && !catalogRecoveryPending ? errText(catalogError) : null);
  const importError = skillImport.error ? errText(skillImport.error) : null;

  const save = () => {
    if (!edit) return;
    setBusy(true);
    setError(null);
    skillsSave(edit.name.trim(), edit.content)
      .then(async (result) => {
        await refreshSkillsCatalog(result.catalog_revision);
        setLoadError(null);
        setEdit(null);
        setExpanded(null);
      })
      .catch((e) => setError(t("settings.skills.saveFailed", { reason: errText(e) })))
      .finally(() => setBusy(false));
  };

  const remove = (name: string) => {
    setBusy(true);
    setError(null);
    skillsDelete(name)
      .then(async (result) => {
        await refreshSkillsCatalog(result.catalog_revision);
        setLoadError(null);
        setExpanded(null);
      })
      .catch((e) => setError(t("settings.skills.deleteFailed", { reason: errText(e) })))
      .finally(() => setBusy(false));
  };

  /** 写操作必须等 Provider 至少观察到命令返回的目标 revision 后才完成。 */
  const setDefault = (name: string, enabled: boolean) => {
    setBusy(true);
    setError(null);
    skillsSetDefault(name, enabled)
      .then((result) => refreshSkillsCatalog(result.catalog_revision))
      .then(() => setLoadError(null))
      .catch((e) => setError(t("settings.skills.saveFailed", { reason: errText(e) })))
      .finally(() => setBusy(false));
  };

  if (!inDesktopShell()) {
    return (
      <div role="alert" className="alert alert-warning alert-soft max-w-md text-xs">
        {t("settings.browserReadonly")}
      </div>
    );
  }

  /** 编辑表单(新建与改用户技能共用;内置技能经「编辑副本」预填同名进来,
   * 保存即建同名用户技能覆盖内置——壳的同名去重规则用户优先)。 */
  const editForm = edit && (
    <div className="flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-4">
      <fieldset className="fieldset gap-1.5">
        <legend className="fieldset-legend">{t("settings.skills.name")}</legend>
        <input
          className="input input-sm w-full font-mono text-xs"
          aria-label={t("settings.skills.name")}
          placeholder="my-skill"
          value={edit.name}
          disabled={edit.editing !== null}
          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
        />
        {edit.editing === null && (
          <p className="text-2xs text-base-content/50">{t("settings.skills.nameHint")}</p>
        )}
      </fieldset>
      <fieldset className="fieldset gap-1.5">
        <legend className="fieldset-legend">{t("settings.skills.content")}</legend>
        <textarea
          className="textarea textarea-sm min-h-48 w-full font-mono text-xs"
          aria-label={t("settings.skills.content")}
          value={edit.content}
          onChange={(e) => setEdit({ ...edit, content: e.target.value })}
        />
      </fieldset>
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !edit.name.trim()} onClick={save}>
          {t("settings.skills.save")}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setEdit(null)}>
          {t("settings.skills.cancel")}
        </button>
      </div>
    </div>
  );

  return (
    <section aria-label={t("settings.nav.skills")} className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-4">
        <p className="min-w-0 flex-1 text-xs text-base-content/50">{t("settings.skills.hint")}</p>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={startNew}>
            <IconPlus size={14} stroke={2} aria-hidden />
            {t("settings.skills.add")}
          </button>
          <ImportSkillMenu disabled={importDisabled} onPick={pickImportSource} />
        </div>
      </div>
      {visibleLoadError && (
        <div role="alert" className="alert alert-error alert-soft max-w-md text-xs">
          {t("settings.skills.loadFailed", { reason: visibleLoadError })}
        </div>
      )}
      {error && (
        <div role="alert" className="alert alert-error alert-soft max-w-md text-xs">
          {error}
        </div>
      )}
      {importError && (
        <div role="alert" className="alert alert-error alert-soft max-w-md text-xs">
          {t("settings.skills.importFailed", { reason: importError })}
        </div>
      )}
      {!skillImport.batch && (
        <RecoveryPanel
          refreshSkillsCatalog={refreshSkillsCatalog}
          initialIssues={catalogRecoveryPending ? catalogError.issues : undefined}
        />
      )}

      {/* 来源双分组(内置在前,与 ModelsSection「同步组在前、自定义在后」
          同序):两组**恒在**——空组不是"少一块",组头 + 引导卡是「技能从
          哪来/怎么建」的唯一说明位。组头即折叠开关(空组退成纯标签)。 */}
      {(["builtin", "user"] as const).map((groupKey) => {
        const items = skills.filter((s) => (s.source === "user") === (groupKey === "user"));
        const groupOpen = !collapsedGroups.has(groupKey);
        const empty = items.length === 0;
        const label = t(groupKey === "user" ? "skill.source.custom" : "skill.source.builtin");
        return (
          <div key={groupKey} className="flex flex-col gap-1.5">
            {empty ? (
              <span className="mt-1 w-fit px-1 text-xs font-bold text-base-content/60">{label}</span>
            ) : (
              <button
                type="button"
                aria-expanded={groupOpen}
                className="mt-1 flex w-fit cursor-pointer items-center gap-1.5 px-1 text-xs font-bold text-base-content/60 transition-colors hover:text-base-content"
                onClick={() => toggleGroup(groupKey)}
              >
                <IconChevronDown
                  size={13}
                  stroke={2}
                  aria-hidden
                  className={`shrink-0 transition-transform duration-150 ${groupOpen ? "" : "-rotate-90"}`}
                />
                {label}
                <span className="font-normal text-base-content/40">{items.length}</span>
              </button>
            )}
            {empty && (
              <div className="flex flex-col items-center gap-3 rounded-box border border-dashed border-base-300 px-4 py-6">
                <p className="text-center text-xs leading-relaxed text-base-content/50">
                  {t(groupKey === "user" ? "settings.skills.userEmpty" : "settings.skills.builtinEmpty")}
                </p>
                {groupKey === "user" && (
                  <div className="flex items-center justify-center gap-2">
                    <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={startNew}>
                      <IconPlus size={14} stroke={2} aria-hidden />
                      {t("settings.skills.add")}
                    </button>
                    <ImportSkillMenu disabled={importDisabled} onPick={pickImportSource} />
                  </div>
                )}
              </div>
            )}
            {!empty && groupOpen && (
        <ul className="list divide-y divide-base-300 overflow-hidden rounded-box border border-base-300 bg-base-100">
          {items.map((s) => {
            const open = expanded === s.name;
            const isUser = s.source === "user";
            return (
              <li key={s.name} className={`flex flex-col transition-colors ${highlightedImports.has(s.name) ? "bg-success/10 ring-1 ring-inset ring-success/30" : ""}`}>
                <div
                  className="group list-row cursor-pointer items-center gap-2 rounded-none px-4 py-2 transition-colors hover:bg-base-200/40"
                  onClick={() => {
                    setExpanded(open ? null : s.name);
                    setEdit(null);
                  }}
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    className="list-col-grow flex min-w-0 cursor-pointer items-center gap-2 text-start"
                  >
                    <span className="shrink-0 truncate font-mono text-xs">{s.name}</span>
                    {/* 覆盖关系必须外显:被覆盖的内置技能不进列表,不标的话
                        用户会以为内置的丢了,也不知道官方更新不会跟进这份副本 */}
                    {s.overrides && (
                      <span className="badge badge-warning badge-soft badge-sm shrink-0">
                        {t("settings.skills.overridesBadge")}
                      </span>
                    )}
                    {/* 默认启用态 = 常驻徽标(状态要一眼可扫);动作在 hover
                        (MCP 停用/启用同款行惯例,不在每行摆一个开关控件) */}
                    {s.default_enabled && (
                      <span className="badge badge-ghost badge-sm shrink-0">
                        {t("settings.skills.defaultBadge")}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs text-base-content/50">{s.description}</span>
                  </button>
                  <button
                    type="button"
                    title={t("settings.skills.defaultTip")}
                    className="btn btn-ghost btn-xs shrink-0 text-base-content/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDefault(s.name, !s.default_enabled);
                    }}
                  >
                    {t(s.default_enabled ? "settings.skills.defaultOff" : "settings.skills.defaultOn")}
                  </button>
                  {isUser ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs shrink-0 text-base-content/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded(s.name);
                          setEdit({ name: s.name, content: s.content, editing: s.name });
                        }}
                      >
                        {t("settings.skills.edit")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs shrink-0 text-base-content/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-error"
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(s.name);
                        }}
                      >
                        {t("settings.skills.delete")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs shrink-0 text-base-content/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpanded(s.name);
                        setEdit({ name: s.name, content: s.content, editing: s.name });
                      }}
                    >
                      {t("settings.skills.override")}
                    </button>
                  )}
                  <IconChevronDown
                    size={14}
                    stroke={1.75}
                    aria-hidden
                    className={`shrink-0 text-base-content/40 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                  />
                </div>
                {open && (
                  <div className="border-t border-base-300 px-4 pt-2 pb-4">
                    {edit && edit.editing === s.name ? (
                      editForm
                    ) : (
                      <>
                        {!isUser && (
                          <p className="mb-2 text-2xs text-base-content/50">{t("settings.skills.readonlyHint")}</p>
                        )}
                        <pre className="max-h-64 overflow-auto rounded-box bg-base-200/60 p-3 font-mono text-xs whitespace-pre-wrap">
                          {s.content}
                        </pre>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
            )}
          </div>
        );
      })}

      {/* 新建表单在列表下方;编辑/覆盖既有条目时表单在行内,不重复渲染 */}
      {edit && edit.editing === null ? editForm : null}
      <BatchSkillImportDialog
        controller={skillImport}
        refreshSkillsCatalog={refreshSkillsCatalog}
        onImported={revealImportedSkills}
        recoverySlot={(
          <RecoveryPanel
            refreshSkillsCatalog={refreshSkillsCatalog}
            initialIssues={catalogRecoveryPending ? catalogError.issues : undefined}
          />
        )}
      />
    </section>
  );
}
