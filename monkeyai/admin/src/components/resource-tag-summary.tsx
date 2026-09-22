import { useTranslation } from "react-i18next"

import { useSkillTags } from "@/hooks/use-skill-tags"

export function ResourceTagSummary({ tagIds }: { tagIds: string[] }) {
  const { t } = useTranslation()
  const { tags } = useSkillTags()
  const tagNames = tags
    .filter((tag) => tagIds.includes(tag.id))
    .map((tag) => tag.name)
    .join(", ")

  return (
    <div className="flex min-w-0 items-center gap-4">
      <span className="w-2/5 truncate text-muted-foreground">
        {t("pages.skills.tags")}
      </span>
      <span
        className="w-3/5 truncate text-end font-medium"
        title={tagNames || t("pages.skills.noTags")}
      >
        {tagNames || t("pages.skills.noTags")}
      </span>
    </div>
  )
}
