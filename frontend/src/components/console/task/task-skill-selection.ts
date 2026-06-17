type SkillWithId = {
  id?: string
}

export function filterSelectableSkillIds<T extends SkillWithId>(
  skillIds: string[],
  skills: T[],
): string[] {
  const availableSkillIds = new Set(
    skills.map((skill) => skill.id).filter((id): id is string => !!id),
  )

  return skillIds.filter((skillId) => availableSkillIds.has(skillId))
}
