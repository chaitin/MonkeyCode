import {
  BookOpenIcon,
  CalendarDays,
  ExternalLink
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { useTranslation } from "react-i18next"

export default function IDEIDE() {
  const { t } = useTranslation()

  return (
    <Empty className="bg-muted">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarDays />
        </EmptyMedia>
        <EmptyTitle>{t("consoleIde.comingSoonTitle")}</EmptyTitle>
        <EmptyDescription>
          {t("consoleIde.comingSoonDescription")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <a href="https://github.com/chaitin/MonkeyCode" target="_blank">
              <ExternalLink />
              {t("consoleIde.openSourceRepository")}
            </a>
          </Button>
          <Button>
            <BookOpenIcon />
            <a href="https://monkeycode.docs.baizhi.cloud/node/019a6cdd-28c5-74ce-a39b-859e15a06c95" target="_blank">{t("consoleIde.readDocs")}</a>
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  )
}
