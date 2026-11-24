import { Navigate } from "react-router-dom"

import { MCPNetworkSettings } from "@/components/mcp-network-settings"
import { useAuth } from "@/hooks/use-auth"
import { DEFAULT_CONSOLE_PATH } from "@/lib/routes"

export function SecurityPage() {
  const { user } = useAuth()
  if (user?.role !== "admin") return <Navigate to={DEFAULT_CONSOLE_PATH} replace />

  return (
    <section className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <MCPNetworkSettings />
    </section>
  )
}
