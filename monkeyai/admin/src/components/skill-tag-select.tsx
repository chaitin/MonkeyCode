import { useState } from "react"
import { UnfoldMoreIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { SkillTag } from "@/lib/skill-tags"
import { cn } from "@/lib/utils"

export function SkillTagSelect({
  id,
  open,
  options,
  placeholder,
  value,
  onOpenChange,
  onValueChange,
}: {
  id: string
  open: boolean
  options: SkillTag[]
  placeholder: string
  value: string[]
  onOpenChange: (open: boolean) => void
  onValueChange: (value: string[]) => void
}) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState("")
  const summary = options
    .filter((tag) => value.includes(tag.id))
    .map((tag) => tag.name)
    .join(", ")
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
  const filteredOptions = normalizedQuery
    ? options.filter((tag) =>
        tag.name.toLocaleLowerCase().includes(normalizedQuery)
      )
    : options

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSearchQuery("")
    }
    onOpenChange(nextOpen)
  }

  const setChecked = (tagId: string, checked: boolean) => {
    onValueChange(
      checked
        ? [...value, tagId]
        : value.filter((selectedId) => selectedId !== tagId)
    )
  }

  return (
    <Popover modal={false} open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            className="w-full min-w-0 justify-between font-normal"
            id={id}
            type="button"
            variant="outline"
          />
        }
      >
        <span
          className={cn("truncate", !summary && "text-muted-foreground")}
          title={summary || placeholder}
        >
          {summary || placeholder}
        </span>
        <HugeiconsIcon icon={UnfoldMoreIcon} data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-72 w-(--anchor-width) gap-1 p-1"
      >
        <PopoverHeader className="sr-only">
          <PopoverTitle>{t("pages.skills.tags")}</PopoverTitle>
        </PopoverHeader>
        {options.length > 0 && (
          <Input
            aria-label={t("pages.skills.searchTagsPlaceholder")}
            autoFocus
            placeholder={t("pages.skills.searchTagsPlaceholder")}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        )}
        {filteredOptions.length > 0 ? (
          <div className="flex max-h-56 flex-col overflow-y-auto">
            {filteredOptions.map((tag) => {
              const checkboxId = `${id}-${tag.id}`
              return (
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
                  htmlFor={checkboxId}
                  key={tag.id}
                >
                  <Checkbox
                    checked={value.includes(tag.id)}
                    id={checkboxId}
                    onCheckedChange={(checked) => {
                      setChecked(tag.id, checked)
                    }}
                  />
                  <span className="truncate">{tag.name}</span>
                </label>
              )
            })}
          </div>
        ) : (
          <p className="px-2 py-6 text-center text-muted-foreground">
            {t(
              options.length > 0
                ? "pages.skills.noMatchingTags"
                : "pages.skills.noAvailableTags"
            )}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
