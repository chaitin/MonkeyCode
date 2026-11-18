import { EngineHostsPage } from "@/pages/engine-hosts-page"
import { EnvironmentsPage } from "@/pages/environments-page"

export function CloudHostsPage() {
  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col gap-4 p-4 pt-px">
      <EngineHostsPage />
      <EnvironmentsPage />
    </div>
  )
}
