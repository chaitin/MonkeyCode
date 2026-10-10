import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { useSkillTags } from "@/hooks/use-skill-tags"

export function ResourceTagSummary({ tagIds }: { tagIds: string[] }) {
  const { t } = useTranslation()
  const { tags } = useSkillTags()
  const selectedTags = tags.filter((tag) => tagIds.includes(tag.id))

  if (!selectedTags.length) {
    return (
      <span className="text-muted-foreground">{t("pages.skills.noTags")}</span>
    )
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-2">
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
