import { Navigate } from "react-router-dom"

import { NetworkSettingsCard } from "@/components/network-settings-card"
import { useAuth } from "@/hooks/use-auth"
import { DEFAULT_CONSOLE_PATH } from "@/lib/routes"

export function SecurityPage() {
  const { user } = useAuth()
  if (user?.role !== "admin") return <Navigate to={DEFAULT_CONSOLE_PATH} replace />

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <NetworkSettingsCard settingKey="model_network" />
      <NetworkSettingsCard settingKey="mcp" />
    </section>
  )
}
