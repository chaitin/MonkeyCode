import type { ComponentProps } from "react"
import { ArrowLeft, ArrowUpRight, Download, Server, MonitorPlay, Code, BookOpen } from "lucide-react"
import { ButtonLink } from "@/components/ui/button"

const icons = {
  "arrow-left": ArrowLeft,
  "arrow-up-right": ArrowUpRight,
  download: Download,
  server: Server,
  "monitor-play": MonitorPlay,
  code: Code,
  "book-open": BookOpen,
}

type Props = {
  href: string
  label: string
  icon?: keyof typeof icons
  trailingIcon?: keyof typeof icons
  external?: boolean
  platform?: string
  variant?: ComponentProps<typeof ButtonLink>["variant"]
  size?: ComponentProps<typeof ButtonLink>["size"]
  className?: string
}

export function ActionButton({ href, label, icon, trailingIcon, external, platform, variant = "primary", size = "md", className }: Props) {
  const LeadingIcon = icon ? icons[icon] : null
  const TrailingIcon = trailingIcon ? icons[trailingIcon] : null
  return (
    <ButtonLink variant={variant} size={size} className={className}
      href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined} data-release-platform={platform}>
      {LeadingIcon && <LeadingIcon aria-hidden="true" />}
      <span>{label}</span>
      {TrailingIcon && <TrailingIcon aria-hidden="true" />}
    </ButtonLink>
  )
}
