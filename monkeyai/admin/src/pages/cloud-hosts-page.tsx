import { EngineHostsPage } from "@/pages/engine-hosts-page"
import { EnvironmentsPage } from "@/pages/environments-page"

export function CloudHostsPage() {
  return (
    <div className="space-y-4 p-4 pt-px">
      <EngineHostsPage />
      <EnvironmentsPage />
    </div>
  )
}
