import { useEffect, useState } from "react"
import { detectDevicePlatform } from "@/lib/device-platform"
import { DropdownMenu } from "radix-ui"
import { Button, ButtonLink, buttonClasses } from "@/components/ui/button"

type Props = {
  href: string
  label: string
  description: string
  hoverLabel?: string
  downloadOptions?: readonly { label: string; href: string }[]
  iconBody: string
}

export function ClientPlatformButton({ href, label, description, hoverLabel, iconBody, downloadOptions }: Props) {
  const content = <>
    <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconBody }} />
    <span className="studio-client-labels" aria-hidden="true">
      <span className="studio-client-name">{label}</span>
      <span className="studio-client-hover-label">{hoverLabel ?? (!href ? "敬请期待" : label === "Web" ? "打开" : "下载")}</span>
    </span>
  </>

  if (downloadOptions?.length) {
    return (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant="outline" className="studio-client-platform-button" aria-label={`${label} · 选择下载格式`}>
            {content}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="studio-client-download-menu" sideOffset={8} collisionPadding={16}>
            <DropdownMenu.Label className="studio-client-download-heading">选择下载格式</DropdownMenu.Label>
            {downloadOptions.map(option => (
              <DropdownMenu.Item key={option.href} asChild>
                <a className="studio-client-download-option" href={option.href} target="_blank" rel="noopener noreferrer">{option.label}</a>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    )
  }

  if (!href) {
    return <span className={buttonClasses("outline", "md", "studio-client-platform-button")} data-slot="button" data-variant="outline" aria-disabled="true" aria-label={`${label} · ${hoverLabel ?? "敬请期待"}`}>
      {content}
    </span>
  }

  return (
    <ButtonLink variant="outline" className="studio-client-platform-button"
      href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} · ${description}`}>
      {content}
    </ButtonLink>
  )
}

export function ClientPlatforms({ clients }: { clients: Props[] }) {
  const [device, setDevice] = useState<ReturnType<typeof detectDevicePlatform>>()
  useEffect(() => {
    let active = true
    const info = { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }
    setDevice(detectDevicePlatform(info))
    const hints = (navigator as Navigator & { userAgentData?: {
      getHighEntropyValues: (keys: string[]) => Promise<{ platform?: string; architecture?: string; bitness?: string }>
    } }).userAgentData
    if (hints) {
      hints.getHighEntropyValues(["platform", "architecture", "bitness"]).then(values => {
        if (active) setDevice(detectDevicePlatform({ ...info, ...values }))
      }).catch(() => { /* 浏览器拒绝提供架构时保留基础识别结果。 */ })
    }
    return () => { active = false }
  }, [])
  return (
    <ul className="studio-client-platforms" aria-label="选择百智办公客户端">
      {clients.map(client => <li key={client.label} data-current-device={device?.label === client.label ? "true" : undefined}>
        <ClientPlatformButton {...client} />
      </li>)}
    </ul>
  )
}
