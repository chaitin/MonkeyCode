import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Iconfont } from "@/components/iconfont"

const distributions: [RegExp, string][] = [
  [/suse/i, "icon-suse"],
  [/centos/i, "icon-centos"],
  [/fedora/i, "icon-fedora"],
  [/gentoo/i, "icon-gentoo"],
  [/\barch(?:\s*linux)?\b/i, "icon-arch"],
  [/ubuntu/i, "icon-ubuntu"],
  [/debian/i, "icon-debian"],
]

export function OSIcon({
  name,
  avatar = false,
  size = "lg",
}: {
  name?: string
  avatar?: boolean
  size?: "default" | "sm" | "lg"
}) {
  const icon =
    distributions.find(([pattern]) => pattern.test(name ?? ""))?.[1] ??
    "icon-linux"
  if (avatar) {
    return (
      <Avatar size={size} aria-hidden="true">
        <AvatarFallback>
          <Iconfont
            name={icon}
            className={
              size === "sm"
                ? "size-5"
                : size === "default"
                  ? "size-6"
                  : "size-8"
            }
          />
        </AvatarFallback>
      </Avatar>
    )
  }
  return (
    <span
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-white ring-1 ring-inset ring-black/5"
      aria-hidden="true"
    >
      <Iconfont name={icon} className="size-4" />
    </span>
  )
}
