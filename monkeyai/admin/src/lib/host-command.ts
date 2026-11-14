export type HostCommand = {
  host_id: string
  command: string
  expires_at: string
  version: string
}
const prefix = "engine-enrollment:"

export function rememberCommand(user: string, command: HostCommand) {
  try {
    sessionStorage.setItem(
      `${prefix}${user}:${command.host_id}`,
      JSON.stringify(command)
    )
  } catch {
    // 存储不可用时，本次弹窗仍可展示和复制命令。
  }
}

export function readCommand(user: string, host: string): HostCommand | null {
  try {
    const raw = sessionStorage.getItem(`${prefix}${user}:${host}`)
    if (!raw) return null
    const value = JSON.parse(raw) as HostCommand
    return value.host_id === host &&
      typeof value.command === "string" &&
      Number.isFinite(Date.parse(value.expires_at))
      ? value
      : null
  } catch {
    return null
  }
}

export function clearHostCommands() {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(prefix)) sessionStorage.removeItem(key)
    }
  } catch {
    // 浏览器可能禁用会话存储。
  }
}
