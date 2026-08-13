// 技能库 API(壳侧 src/skills.rs):内置技能随包分发、用户技能存
// <app_config_dir>/skills/,同名用户覆盖内置。这里只有"库"的增删查;
// 会话级"启用哪些"走 controls.ts 的 sessionSetSkills(session_call)。
import { inDesktopShell, invoke } from "./ipc";

export interface SkillInfo {
  name: string;
  description: string;
  /** "builtin"(随包分发,只读)| "user"(用户自建,可改删) */
  source: "builtin" | "user";
  /** SKILL.md 原文(技能都很小,列表直接携带) */
  content: string;
  /** 用户技能与某内置同名(压过内置;官方更新不跟进,删副本还原) */
  overrides?: boolean;
  /** 新会话是否默认启用(壳侧解析结果:出厂规则 ⊕ skills-defaults.json
   * 显式开关;缺省集推导只认这个字段,UI 不复刻规则) */
  default_enabled: boolean;
}

/** 技能库全量。浏览器模式回空(静态事实);壳内失败抛给调用方
 * (口径同 sessionsList:空数组只能表达"真没有",不能表达"没拉到")。 */
export function skillsList(): Promise<SkillInfo[]> {
  if (!inDesktopShell()) return Promise.resolve([]);
  return invoke<SkillInfo[]>("skills_list");
}

/** 会话未记录启用集(meta.skills 为 null/缺省)时的缺省集。直接读壳侧
 * 解析好的 default_enabled(出厂规则 ⊕ 设置页「默认启用」开关)——规则
 * 单一事实源在壳(skills.rs::is_default_enabled),UI 不复刻,否则开关
 * 一变两侧就说两套话。 */
export function defaultEnabledSkills(skills: SkillInfo[]): string[] {
  return skills.filter((s) => s.default_enabled).map((s) => s.name);
}

/** 「默认启用」开关:只影响新会话(与未记录启用集的旧会话)的缺省集,
 * 已有会话跟随各自 sidecar 快照。 */
export function skillsSetDefault(name: string, enabled: boolean): Promise<void> {
  return invoke<void>("skills_set_default", { name, enabled });
}

/** 新建/覆盖用户技能(name 即目录名,ASCII 单段;content 为 SKILL.md 原文,
 * frontmatter 里的 name 与之不一致会被壳拒绝)。 */
export function skillsSave(name: string, content: string): Promise<SkillInfo> {
  return invoke<SkillInfo>("skills_save", { name, content });
}

/** 删除用户技能(内置技能只读,不可删;同名覆盖的用户技能删掉即还原内置)。 */
export function skillsDelete(name: string): Promise<void> {
  return invoke<void>("skills_delete", { name });
}
