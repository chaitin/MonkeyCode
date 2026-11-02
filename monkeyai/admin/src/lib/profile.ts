import { api } from "@/lib/api"
import type { AuthUser } from "@/lib/auth-context"

export type Profile = {
  user: AuthUser
  custom_avatar_url: string
  synced_avatar_url: string
  has_password: boolean
  csrf_token: string
}

export type AvatarUpdate = Pick<Profile, "user" | "custom_avatar_url">

export function getProfile(signal?: AbortSignal) {
  return api<Profile>("/api/auth/v1/profile", { signal, cache: "no-store" })
}

export function uploadAvatar(file: File, csrfToken: string) {
  return api<AvatarUpdate>("/api/auth/v1/profile/avatar", {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type, "X-CSRF-Token": csrfToken },
  })
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
  csrfToken: string
) {
  return api<{ csrf_token: string }>("/api/auth/v1/profile/password", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  })
}
