import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { environmentState, type Environment } from "@/lib/environments"

const success = "border-success/20 bg-success/10 text-success"
const error = "border-destructive/20 bg-destructive/10 text-destructive"
const pending = "border-warning/20 bg-warning/10 text-warning"
const neutral = "border-border bg-muted text-muted-foreground"
const statusStyles = {
  online: success,
  offline: error,
  pending,
  expired: pending,
  revoked: neutral,
}

export function HostStatus({ status }: { status: keyof typeof statusStyles }) {
  const { t } = useTranslation()
  return (
    <Badge variant="outline" className={statusStyles[status]}>
      {t(`pages.engineHosts.${status}`)}
    </Badge>
  )
}

export function EnvironmentStatus({
  environment,
}: {
  environment: Environment
}) {
  const { t } = useTranslation()
  const state = environmentState(environment)
  const style =
    state === "running"
      ? success
      : state === "failed"
        ? error
        : state === "stopped" || state === "deleted"
          ? neutral
          : pending
  return (
    <Badge variant="outline" className={style}>
      {t(`environmentAdmin.states.${state}`)}
    </Badge>
  )
}
