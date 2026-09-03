import { useMemo, useState, type ReactNode } from "react"

import {
  INITIAL_SKILL_TAGS,
  SkillTagsContext,
  type SkillTagsContextValue,
} from "@/lib/skill-tags"

function normalizeTagName(name: string) {
  return name.trim().replace(/\s+/g, " ")
}

export function SkillTagsProvider({ children }: { children: ReactNode }) {
  const [tags, setTags] = useState(INITIAL_SKILL_TAGS)

  const value = useMemo<SkillTagsContextValue>(
    () => ({
      tags,
      addTag(name) {
        const normalizedName = normalizeTagName(name)
        if (
          !normalizedName ||
          tags.some(
            (tag) =>
              tag.name.toLocaleLowerCase() ===
              normalizedName.toLocaleLowerCase()
          )
        ) {
          return false
        }

        setTags((currentTags) => [
          ...currentTags,
          {
            id: `skill-tag-${Date.now()}`,
            name: normalizedName,
          },
        ])
        return true
      },
      renameTag(id, name) {
        const normalizedName = normalizeTagName(name)
        if (
          !normalizedName ||
          tags.some(
            (tag) =>
              tag.id !== id &&
              tag.name.toLocaleLowerCase() ===
                normalizedName.toLocaleLowerCase()
          )
        ) {
          return false
        }

        setTags((currentTags) =>
          currentTags.map((tag) =>
            tag.id === id ? { ...tag, name: normalizedName } : tag
          )
        )
        return true
      },
      deleteTag(id) {
        setTags((currentTags) => currentTags.filter((tag) => tag.id !== id))
      },
    }),
    [tags]
  )

  return (
    <SkillTagsContext.Provider value={value}>
      {children}
    </SkillTagsContext.Provider>
  )
}
