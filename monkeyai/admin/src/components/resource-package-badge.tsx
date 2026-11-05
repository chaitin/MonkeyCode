import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CONSOLE_ROUTES } from "@/lib/routes"

export function ResourcePackageBadge({
  kind,
}: {
  kind: "skill" | "rule" | "connector" | "expert"
}) {
  const { t } = useTranslation()
  const description = t(`resources.packageImportedTooltips.${kind}`)

  return (
    <Tooltip>
      <Badge
        variant="amber"
        className="hover:opacity-80"
        render={
          <TooltipTrigger
            render={
              <Link
                to={CONSOLE_ROUTES.resourceImports}
                onClick={(event) => event.stopPropagation()}
              />
            }
          />
        }
      >
        {t("resources.resourcePackage")}
      </Badge>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  )
}
