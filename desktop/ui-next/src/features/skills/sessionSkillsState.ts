import type { SessionMeta } from "@/lib/ipc/sessions";

export interface SessionSkillsSelectionState {
  serverRevision: number;
  enabledSkills: string[] | null;
}

export function acceptHigherSessionSkills(
  current: SessionSkillsSelectionState,
  skills: string[] | null,
  revision: number,
): SessionSkillsSelectionState {
  return revision > current.serverRevision ? { serverRevision: revision, enabledSkills: skills } : current;
}

const skillsRevision = (meta: SessionMeta): number => meta.skills_revision ?? 0;

/** 全表轮询可以更新其余元数据，但不得用较旧 skills_revision 回退技能快照。 */
export function preserveNewerSessionSkills(current: SessionMeta[], incoming: SessionMeta[]): SessionMeta[] {
  const previous = new Map(current.map((meta) => [meta.id, meta]));
  return incoming.map((meta) => {
    const old = previous.get(meta.id);
    if (!old || skillsRevision(meta) >= skillsRevision(old)) return meta;
    return {
      ...meta,
      skills: old.skills,
      skills_revision: old.skills_revision,
    };
  });
}

export function sessionSkillsRevisionTargets(sessions: SessionMeta[]): Map<string, number> {
  return new Map(sessions.map((meta) => [meta.id, skillsRevision(meta)]));
}
