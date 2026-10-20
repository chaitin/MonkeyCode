import { ButtonLink, buttonClasses } from "@/components/ui/button"

type Props = {
  href: string
  label: string
  description: string
  iconBody: string
}

export function ClientPlatformButton({ href, label, description, iconBody }: Props) {
  const content = <>
    <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconBody }} />
    <span className="studio-client-labels" aria-hidden="true">
      <span className="studio-client-name">{label}</span>
      <span className="studio-client-hover-label">{!href ? "敬请期待" : label === "Web" ? "打开" : "下载"}</span>
    </span>
  </>

  if (!href) {
    return <span className={buttonClasses("outline", "md", "studio-client-platform-button")} data-slot="button" data-variant="outline" aria-disabled="true" aria-label={`${label} · 敬请期待`}>
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
  return (
    <ul className="studio-client-platforms" aria-label="选择百智办公客户端">
      {clients.map(client => <li key={client.label}>
        <ClientPlatformButton {...client} />
      </li>)}
    </ul>
  )
}
