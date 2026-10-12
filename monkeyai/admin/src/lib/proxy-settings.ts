import { api } from "@/lib/api"

export type SystemProxy = {
  id: string
  name: string
  url: string
  username?: string
  password?: string
}

type Setting = { value: { proxies: SystemProxy[] } }

export async function loadProxies(): Promise<SystemProxy[]> {
  const result = await api<{ settings: (Setting & { key: string })[] }>(
    "/api/admin/v1/settings"
  )
  return (
    result.settings.find((item) => item.key === "proxies")?.value.proxies ?? []
  )
}
