type DeviceInfo = {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
  architecture?: string
  bitness?: string
}

export function detectDevicePlatform(info: DeviceInfo): { name: string; label?: string } | undefined {
  const ua = info.userAgent
  const platform = info.platform ?? ""
  const arm64 = /^(arm64|aarch64)$/i.test(info.architecture ?? "") || (info.architecture === "arm" && info.bitness === "64")
  const x64 = /^(x86_64|amd64|x64)$/i.test(info.architecture ?? "") || (info.architecture === "x86" && info.bitness === "64")
  if (/HarmonyOS|OpenHarmony/i.test(ua)) return { name: "鸿蒙", label: /Mobile|Phone/i.test(ua) ? "鸿蒙手机" : undefined }
  if (/Android/i.test(ua)) return { name: "Android", label: "Android" }
  if (/iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(platform) && (info.maxTouchPoints ?? 0) > 1)) return { name: "iOS / iPadOS", label: "iOS" }
  if (/Windows NT 6\.1/i.test(ua)) return { name: "Windows 7", label: "Win7 兼容版" }
  if (/Windows/i.test(ua) || /Windows/i.test(platform)) return { name: "Windows", label: "Windows" }
  if (/Macintosh|Mac OS X/i.test(ua) || /macOS|MacIntel/i.test(platform)) {
    // Apple Silicon 浏览器也可能报告 Intel，只有明确的架构提示才用于匹配。
    const label = arm64 ? "macOS ARM" : x64 ? "macOS Intel" : undefined
    return { name: label ?? "macOS（请选择 ARM 或 Intel）", label }
  }
  if (/UOS|UnionTech/i.test(ua)) return { name: "统信 UOS", label: "统信 UOS" }
  if (/Kylin/i.test(ua)) return { name: "银河麒麟", label: "银河麒麟" }
  if (/Linux/i.test(ua) || /Linux/i.test(platform)) {
    const label = arm64 || /aarch64|arm64/i.test(ua + " " + platform) ? "Linux ARM" : x64 || /x86_64|amd64/i.test(ua + " " + platform) ? "Linux x64" : undefined
    return { name: label ?? "Linux（请选择对应架构）", label }
  }
  return undefined
}
