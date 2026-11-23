import { useState } from "react"
import { EngineHostsPage } from "./engine-hosts-page"
import { EnvironmentsPage } from "./environments-page"

export function CloudHostsPage() {
  const [revision, setRevision] = useState(0)
  return (
    <div className="flex min-h-[calc(100dvh-5rem)] flex-col gap-4 p-4 pt-px">
      <EngineHostsPage onHostSaved={() => setRevision((v) => v + 1)} />
      <EnvironmentsPage hostRevision={revision} />
    </div>
  )
}
