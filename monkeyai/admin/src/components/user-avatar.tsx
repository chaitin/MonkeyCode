import defaultUserAvatar from "@/assets/default-user-avatar.webp"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

export function UserAvatar({ src }: { src?: string | null }) {
  return (
    <Avatar size="sm">
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
