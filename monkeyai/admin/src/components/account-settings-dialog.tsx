import { useEffect, useRef, useState, type RefObject } from "react"
import { useTranslation } from "react-i18next"
import { HugeiconsIcon } from "@hugeicons/react"
import { ImageUploadIcon } from "@hugeicons/core-free-icons"

import { useAppToast } from "@/components/animated-toast-provider"
import { useAuth } from "@/hooks/use-auth"
import { getProfile, type AvatarUpdate, type Profile } from "@/lib/profile"
import { AvatarPickerDialog } from "@/components/avatar-picker-dialog"
import { ChangePasswordDialog } from "@/components/change-password-dialog"
import { UserAvatar } from "@/components/user-avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"

export type AccountSettingsUser = {
  name: string
  email: string
  avatar_url?: string | null
}

export function AccountSettingsDialog({
  user,
  onClose,
  returnFocusRef,
}: {
  user: AccountSettingsUser
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const { updateUser } = useAuth()
  const avatarButtonRef = useRef<HTMLButtonElement>(null)
  const passwordButtonRef = useRef<HTMLButtonElement>(null)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [profile, setProfile] = useState<Profile>()
  const [loadFailed, setLoadFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const currentUser = profile?.user ?? user
  const avatarPreview = currentUser.avatar_url?.trim() || ""

  useEffect(() => {
    const controller = new AbortController()
    getProfile(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setProfile(result)
        updateUser(result.user)
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true)
      })
    return () => controller.abort()
  }, [revision, updateUser])

  function avatarUpdated(result: AvatarUpdate) {
    updateUser(result.user)
    setProfile((current) => (current ? { ...current, ...result } : current))
    showToast({ status: "success", title: t("accountSettings.avatarSaved") })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-md"
        closeLabel={t("common.close")}
        finalFocus={returnFocusRef}
      >
        <DialogHeader className="shrink-0 pe-8">
          <DialogTitle>{t("navigation.accountSettings")}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="-me-3 flex min-h-0 flex-1 flex-col [&_[data-slot=scroll-area-viewport]]:min-h-0">
          <div className="space-y-6 pe-3">
            <section aria-label={t("accountSettings.avatar")}>
              <div className="flex min-w-0 items-center gap-4">
                <button
                  ref={avatarButtonRef}
                  type="button"
                  className="group relative size-16 shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!profile}
                  aria-label={t("accountSettings.changeAvatar")}
                  aria-haspopup="dialog"
                  aria-expanded={avatarOpen}
                  onClick={() => setAvatarOpen(true)}
                >
                  <UserAvatar
                    src={avatarPreview}
                    size="lg"
                    className="!size-16"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 flex items-center justify-center rounded-full bg-gray-500/60 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
                  >
                    <HugeiconsIcon
                      icon={ImageUploadIcon}
                      className="size-5"
                      strokeWidth={2}
                    />
                  </span>
                </button>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate font-medium" title={currentUser.name}>
                    {currentUser.name}
                  </p>
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={currentUser.email}
                  >
                    {currentUser.email}
                  </p>
                </div>
              </div>
            </section>
            {!profile && (
              <div className="text-sm text-muted-foreground" role="status">
                {loadFailed ? (
                  <div className="flex items-center justify-between gap-3">
                    <span>{t("accountSettings.profileLoadFailed")}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setLoadFailed(false)
                        setRevision((current) => current + 1)
                      }}
                    >
                      {t("accountSettings.retry")}
                    </Button>
                  </div>
                ) : (
                  t("accountSettings.loadingProfile")
                )}
              </div>
            )}
          </div>
        </ScrollArea>
        <DialogFooter className="shrink-0 flex-row items-center justify-between sm:justify-between">
          <Button
            ref={passwordButtonRef}
            type="button"
            variant="outline"
            disabled={!profile}
            onClick={() => setPasswordOpen(true)}
          >
            {t("accountSettings.changePassword")}
          </Button>
          <Button type="button" onClick={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
      {avatarOpen && profile && (
        <AvatarPickerDialog
          avatar={avatarPreview}
          csrfToken={profile.csrf_token}
          onSelect={avatarUpdated}
          onClose={() => setAvatarOpen(false)}
          returnFocusRef={avatarButtonRef}
        />
      )}
      {passwordOpen && profile && (
        <ChangePasswordDialog
          csrfToken={profile.csrf_token}
          hasPassword={profile.has_password}
          onSaved={(csrfToken) =>
            setProfile((current) =>
              current
                ? { ...current, csrf_token: csrfToken, has_password: true }
                : current
            )
          }
          onClose={() => setPasswordOpen(false)}
          returnFocusRef={passwordButtonRef}
        />
      )}
    </Dialog>
  )
}
