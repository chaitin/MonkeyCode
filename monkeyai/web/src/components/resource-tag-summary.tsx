import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { useSkillTags } from "@/hooks/use-skill-tags"

export function ResourceTagSummary({
  tagIds,
  leading,
}: {
  tagIds: string[]
  leading?: ReactNode
}) {
  const { t } = useTranslation()
  const { tags } = useSkillTags()
  const selectedTags = tags.filter((tag) => tagIds.includes(tag.id))

  if (!selectedTags.length && !leading) {
    return (
      <span className="text-muted-foreground">{t("pages.skills.noTags")}</span>
    )
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {leading}
      {selectedTags.map((tag) => (
        <Badge
          key={tag.id}
          variant="outline"
          className="max-w-full truncate"
          title={tag.name}
        >
          {tag.name}
        </Badge>
      ))}
    </div>
  )
}
