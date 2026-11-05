import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Grant } from "@/lib/resources"
import type { AuthorizationSelection } from "@/lib/authorization-groups"
import { cn } from "@/lib/utils"

export function ResourceAuthorizationBadge({
  grants,
  authorization,
  groupNames,
  memberNames,
  fallback,
}: {
  grants?: Grant[]
  authorization?: AuthorizationSelection
  groupNames: ReadonlyMap<string, string>
  memberNames: ReadonlyMap<string, string>
  fallback?: string
}) {
  const { t } = useTranslation()
  const entries: Partial<Grant>[] = grants ?? [
    ...(authorization?.groupIds ?? []).map((group_id) => ({ group_id })),
    ...(authorization?.memberIds ?? []).map((user_id) => ({ user_id })),
  ]
  const groups = entries
    .filter((grant) => grant.group_id)
    .map(
      (grant) =>
        grant.group?.name || groupNames.get(grant.group_id!) || grant.group_id
    )
  const users = entries
    .filter((grant) => grant.user_id)
    .map(
      (grant) =>
        grant.user?.name ||
        grant.user?.email ||
        memberNames.get(grant.user_id!) ||
        grant.user_id
    )
  const names = [...groups, ...users].join(",") || fallback
  const scope = names || t("resources.authorizationEmpty")
  const description = names
    ? t("resources.authorizationTooltip", { scope: names })
    : t("resources.authorizationEmpty")
  const characters = Array.from(scope)
  const text =
    characters.length > 32 ? characters.slice(0, 29).join("") + "..." : scope

  return (
    <Tooltip>
      <Badge
        variant="outline"
        className={cn(
          "max-w-48 cursor-default",
          names
            ? "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-200"
            : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"
        )}
        render={<TooltipTrigger render={<span />} tabIndex={0} />}
        aria-label={description}
      >
        <span className="min-w-0 truncate">{text}</span>
      </Badge>
      <TooltipContent className="max-w-[min(20rem,calc(100vw-2rem))] break-words">
        {description}
      </TooltipContent>
    </Tooltip>
  )
}
