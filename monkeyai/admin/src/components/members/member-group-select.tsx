import { useState } from "react"
import { FolderIcon, UnfoldMoreIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ROOT_GROUP_ID, type MemberGroup } from "@/lib/member-groups"
import { cn } from "@/lib/utils"

export function MemberGroupSelect({
  id,
  groups,
  value,
  onValueChange,
  disabled = false,
}: {
  id: string
  groups: MemberGroup[]
  value: string[]
  onValueChange: (value: string[]) => void
  disabled?: boolean
}) {
  const { i18n, t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const key = "pages.membersAndGroups.groupSelection"
  const byID = new Map(groups.map((group) => [group.id, group]))
  const collator = new Intl.Collator(i18n.resolvedLanguage ?? i18n.language, {
    numeric: true,
    sensitivity: "base",
  })
  const options = groups
    .filter((group) => group.id !== ROOT_GROUP_ID)
    .map((group) => {
      const names = [group.name]
      const seen = new Set([group.id])
      let parentID = group.parent_id
      while (parentID && parentID !== ROOT_GROUP_ID && !seen.has(parentID)) {
        seen.add(parentID)
        const parent = byID.get(parentID)
        if (!parent) break
        names.unshift(parent.name)
        parentID = parent.parent_id
      }
      return { id: group.id, path: names.join(" / ") }
    })
    .sort((a, b) => collator.compare(a.path, b.path))
  const summary = options
    .filter((group) => value.includes(group.id))
    .map((group) => group.path)
    .join(", ")
  const filtered = options.filter((group) =>
    group.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  )

  return (
    <Field>
      <FieldLabel htmlFor={id}>{t(`${key}.label`)}</FieldLabel>
      <Popover
        open={open && !disabled}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) setQuery("")
        }}
      >
        <PopoverTrigger
          render={
            <Button
              id={id}
              type="button"
              variant="outline"
              disabled={disabled}
              className="w-full min-w-0 justify-between font-normal"
            />
          }
        >
          <span
            className={cn("truncate", !summary && "text-muted-foreground")}
            title={summary}
          >
            {summary || t(`${key}.placeholder`)}
          </span>
          <HugeiconsIcon icon={UnfoldMoreIcon} data-icon="inline-end" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--anchor-width) gap-2 p-2">
          <PopoverTitle className="sr-only">{t(`${key}.label`)}</PopoverTitle>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t(`${key}.search`)}
            aria-label={t(`${key}.search`)}
          />
          <ScrollArea className="max-h-56">
            <div className="flex flex-col gap-1">
              {filtered.map((group) => (
                <label
                  key={group.id}
                  htmlFor={`${id}-${group.id}`}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-foreground/5"
                >
                  <Checkbox
                    id={`${id}-${group.id}`}
                    checked={value.includes(group.id)}
                    disabled={disabled}
                    onCheckedChange={(checked) =>
                      onValueChange(
                        checked
                          ? [...new Set([...value, group.id])]
                          : value.filter((groupID) => groupID !== group.id)
                      )
                    }
                  />
                  <HugeiconsIcon
                    icon={FolderIcon}
                    className="size-4 shrink-0 text-yellow-600 dark:text-yellow-400"
                  />
                  <span className="min-w-0 truncate" title={group.path}>
                    {group.path}
                  </span>
                </label>
              ))}
              {filtered.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t(options.length ? `${key}.noMatches` : `${key}.empty`)}
                </p>
              )}
            </div>
          </ScrollArea>
          {value.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => onValueChange([])}
            >
              {t(`${key}.clear`)}
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </Field>
  )
}
