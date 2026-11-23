import { useContext } from "react"

import { SkillTagsContext } from "@/lib/skill-tags"

export function useSkillTags() {
  const context = useContext(SkillTagsContext)

  if (!context) {
    throw new Error("useSkillTags must be used within SkillTagsProvider")
  }

  return context
}
