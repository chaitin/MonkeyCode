// 技能库与批量导入 IPC。字段名严格对应 Rust serde 的 snake_case 线上形状。
import { inDesktopShell, invoke } from "./ipc";

export interface SkillInfo {
  name: string;
  description: string;
  source: "builtin" | "user";
  content: string;
  overrides: boolean;
  default_enabled: boolean;
  /** Rust catalog 的权威能力；旧壳缺字段时按可用处理以保持滚动升级兼容。 */
  can_set_default?: boolean;
  /** user=可编辑、builtin=可编辑副本；legacy 兼容名称为 false。 */
  can_edit?: boolean;
}

export interface SkillsCatalogSnapshot {
  revision: number;
  store_id: string;
  skills: SkillInfo[];
}

export interface SkillMutationResult {
  catalog_revision: number;
}

export type SkillImportBatchPhase =
  | "collecting"
  | "validating"
  | "submitting"
  | "completed"
  | "retry-validating"
  | "retrying";
export type SkillImportSourceKind = "folders" | "zips";
export type SkillImportSourceStatus = "pending" | "ready" | "empty" | "failed";
export type SkillImportFileKind = "file" | "directory";
export type SkillImportRiskKind = "executable-content" | "tools" | "scripts" | "hooks" | "mcp" | "network";
export type SkillImportItemState = "pending" | "succeeded" | "failed" | "skipped";
export type SkillImportAction = "install" | "replace" | "skip";
export type SkillRecoveryAction = "restore-backup" | "keep-installed" | "preserve-files";

export interface SkillImportCurrentSnapshot {
  snapshot_revision: number;
  batch: SkillImportBatchPreview | null;
}

export interface SkillImportSnapshotEvent {
  snapshot_revision: number;
  batch_id: string;
  deleted: boolean;
}

export interface SkillImportBatchPreview {
  batch_id: string;
  phase: SkillImportBatchPhase;
  snapshot_revision: number;
  in_flight_source_picks: number;
  catalog_revision: number | null;
  sources: SkillImportSource[];
  items: SkillImportItem[];
  totals: SkillImportTotals;
}

export interface SkillImportSource {
  source_id: string;
  order: number;
  kind: SkillImportSourceKind;
  display_name: string;
  status: SkillImportSourceStatus;
  skill_count: number;
  error: string | null;
}

export interface SkillImportItem {
  item_id: string;
  source_id: string;
  order: number;
  source_display_name: string;
  relative_root: string;
  name: string | null;
  portable_name_key: string | null;
  description: string;
  files: SkillImportFile[];
  total_size: number;
  risks: SkillImportRisk[];
  validity: SkillImportValidity;
  conflict: SkillImportConflict;
  duplicate_group: string | null;
  state: SkillImportItemState;
  last_error: string | null;
}

export interface SkillImportFile {
  relative_path: string;
  name: string;
  kind: SkillImportFileKind;
  size: number;
  executable: boolean;
  children: SkillImportFile[];
}

export interface SkillImportRisk {
  kind: SkillImportRiskKind;
  paths: string[];
}

export type SkillImportValidity = { status: "valid" } | { status: "invalid"; reasons: string[] };
export type SkillImportCatalogConflict =
  | { kind: "none" }
  | { kind: "user-skill"; existing_name: string }
  | { kind: "builtin-skill"; existing_name: string }
  | { kind: "user-name-case"; existing_name: string }
  | { kind: "builtin-name-case"; existing_name: string };
export type SkillImportConflict =
  | SkillImportCatalogConflict
  | { kind: "batch-duplicate"; catalog_conflict: SkillImportCatalogConflict };

export interface SkillImportDecision {
  item_id: string;
  action: SkillImportAction;
}

export interface SkillImportTotals {
  source_count: number;
  item_count: number;
  importable_count: number;
  conflict_count: number;
  risk_count: number;
  invalid_count: number;
}

export interface SkillImportBatchResult {
  batch_id: string;
  catalog_revision: number | null;
  items: SkillImportItemResult[];
  success_count: number;
  failure_count: number;
  skipped_count: number;
}

export interface SkillImportItemResult {
  item_id: string;
  name: string | null;
  state: SkillImportItemState;
  error: string | null;
}

export interface SkillImportTextChunk {
  relative_path: string;
  offset: number;
  text: string;
  next_offset: number;
  eof: boolean;
}

export interface SkillRecoveryIssue {
  transaction_id: string;
  entry_path: string | null;
  skill_name: string;
  portable_name_key: string;
  backup_available: boolean;
  installed_available: boolean;
  isolated_available: boolean;
  authoritative_target_missing: boolean;
  actions: SkillRecoveryAction[];
  error: string;
}

export interface SkillRecoveryResolveResult {
  preserved_path: string | null;
  catalog_revision: number;
}

export type SkillCommandError =
  | { code: "recovery-pending"; issues: SkillRecoveryIssue[] }
  | { code: "skill-import-unavailable"; message: string; action: string }
  | { code: "busy" }
  | { code: "invalid-request"; message: string }
  | { code: "candidate-changed"; entry_path: string }
  | { code: "file-changed"; relative_path: string }
  | { code: "cleanup-failed"; target: string; message: string }
  | { code: "io"; message: string };

export function isSkillCommandError(value: unknown): value is SkillCommandError {
  return !!value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string";
}

/** 浏览器模式是静态无技能库；壳内错误必须抛出。 */
export async function skillsList(): Promise<SkillsCatalogSnapshot> {
  if (!inDesktopShell()) return { revision: 0, store_id: "browser", skills: [] };
  const response = await invoke<SkillsCatalogSnapshot | SkillInfo[]>("skills_list");
  // 升级中的旧壳及既有 UI 测试夹具仍返回数组；对外始终归一为新契约。
  return Array.isArray(response) ? { revision: 0, store_id: "legacy", skills: response } : response;
}

export function defaultEnabledSkills(skills: SkillInfo[]): string[] {
  return skills.filter((skill) => skill.default_enabled).map((skill) => skill.name);
}

export function skillsSetDefault(name: string, enabled: boolean): Promise<SkillMutationResult> {
  return invoke<SkillMutationResult>("skills_set_default", { name, enabled });
}

export function skillsSave(name: string, content: string): Promise<SkillMutationResult> {
  return invoke<SkillMutationResult>("skills_save", { name, content });
}

export function skillsDelete(name: string): Promise<SkillMutationResult> {
  return invoke<SkillMutationResult>("skills_delete", { name });
}

export function skillsImportCurrent(): Promise<SkillImportCurrentSnapshot> {
  return invoke<SkillImportCurrentSnapshot>("skills_import_current");
}

export function skillsImportPick(
  sourceKind: SkillImportSourceKind,
  batchId: string | null,
): Promise<SkillImportBatchPreview | null> {
  return invoke<SkillImportBatchPreview | null>("skills_import_pick", { sourceKind, batchId });
}

export function skillsImportReadText(args: {
  batchId: string;
  itemId: string;
  relativePath: string;
  offset: number;
  limit: number;
}): Promise<SkillImportTextChunk> {
  return invoke<SkillImportTextChunk>("skills_import_read_text", args);
}

export function skillsImportCommit(
  batchId: string,
  decisions: SkillImportDecision[],
  executableContentReviewed: boolean,
): Promise<SkillImportBatchResult> {
  return invoke<SkillImportBatchResult>("skills_import_commit", {
    batchId,
    decisions,
    executableContentReviewed,
  });
}

export function skillsImportCancel(batchId: string): Promise<void> {
  return invoke<void>("skills_import_cancel", { batchId });
}

export function skillsRecoveryList(): Promise<SkillRecoveryIssue[]> {
  return invoke<SkillRecoveryIssue[]>("skills_recovery_list");
}

export function skillsRecoveryResolve(
  transactionId: string,
  action: SkillRecoveryAction,
): Promise<SkillRecoveryResolveResult> {
  return invoke<SkillRecoveryResolveResult>("skills_recovery_resolve", { transactionId, action });
}
