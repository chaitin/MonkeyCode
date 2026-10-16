import defaultUserAvatar from "@/assets/default-user-avatar.webp"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export function UserAvatar({
  src,
  size = "sm",
  className,
}: {
  src?: string | null
  size?: "sm" | "lg"
  className?: string
}) {
  return (
    <Avatar size={size} className={className}>
      <AvatarImage src={src?.trim() || undefined} alt="" />
      <AvatarFallback>
        <img
          src={defaultUserAvatar}
          alt=""
          className="size-full rounded-full object-cover"
        />
      </AvatarFallback>
    </Avatar>
  )
}
