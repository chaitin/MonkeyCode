import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react"
import { useTranslation } from "react-i18next"
import { HugeiconsIcon } from "@hugeicons/react"
import { EyeOffIcon, ViewIcon } from "@hugeicons/core-free-icons"

import { changePassword as changeProfilePassword } from "@/lib/profile"
import { useAppToast } from "@/components/animated-toast-provider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

type PasswordKey = "current" | "next" | "confirm"

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  error,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  error?: string
}) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  return (
    <Field className="gap-2" data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          className="pe-10"
          autoComplete={autoComplete}
          maxLength={1024}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <div className="absolute inset-y-0 end-0.5 flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t(
              visible ? "login.hidePassword" : "login.showPassword"
            )}
            aria-pressed={visible}
            onClick={() => setVisible((current) => !current)}
          >
            <HugeiconsIcon
              icon={visible ? EyeOffIcon : ViewIcon}
              strokeWidth={2}
            />
          </Button>
        </div>
      </div>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  )
}

export function ChangePasswordDialog({
  csrfToken,
  hasPassword,
  onSaved,
  onClose,
  returnFocusRef,
}: {
  csrfToken: string
  hasPassword: boolean
  onSaved: (csrfToken: string) => void
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const id = useId()
  const [passwords, setPasswords] = useState({
    current: "",
    next: "",
    confirm: "",
  })
  const [errors, setErrors] = useState<Partial<Record<PasswordKey, string>>>({})
  const [saving, setSaving] = useState(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const hasChanges = Object.values(passwords).some(Boolean)

  function changePassword(key: PasswordKey, value: string) {
    setPasswords((current) => ({ ...current, [key]: value }))
    setErrors({})
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!hasChanges || saving || !hasPassword) return
    const nextErrors: Partial<Record<PasswordKey, string>> = {}
    if (!passwords.current)
      nextErrors.current = t("accountSettings.currentPasswordRequired")
    if (Array.from(passwords.next).length < 12)
      nextErrors.next = t("accountSettings.passwordHint")
    if (!passwords.confirm || passwords.next !== passwords.confirm) {
      nextErrors.confirm = t("accountSettings.passwordMismatch")
    }
    setErrors(nextErrors)
    const firstError = (["current", "next", "confirm"] as const).find(
      (key) => nextErrors[key]
    )
    if (firstError) {
      document.getElementById(`${id}-${firstError}`)?.focus()
      return
    }
    setSaving(true)
    try {
      const result = await changeProfilePassword(
        passwords.current,
        passwords.next,
        csrfToken
      )
      if (!mounted.current) return
      onSaved(result.csrf_token)
      showToast({
        status: "success",
        title: t("accountSettings.passwordSaved"),
      })
      onClose()
    } catch (reason) {
      if (!mounted.current) return
      showToast({
        status: "error",
        title:
          reason instanceof Error
            ? reason.message
            : t("accountSettings.profileLoadFailed"),
      })
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-md"
        closeLabel={t("common.close")}
        showCloseButton={!saving}
        finalFocus={returnFocusRef}
      >
        <DialogHeader className="shrink-0 pe-8">
          <DialogTitle>{t("accountSettings.changePassword")}</DialogTitle>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col gap-6"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          <ScrollArea className="-me-3 -ms-1 flex min-h-0 flex-1 flex-col [&_[data-slot=scroll-area-viewport]]:min-h-0">
            <fieldset
              disabled={saving || !hasPassword}
              className="min-w-0 space-y-4 py-1 pe-3 ps-1"
            >
              {!hasPassword && (
                <p className="text-sm text-muted-foreground" role="status">
                  {t("accountSettings.passwordNotSet")}
                </p>
              )}
              {(["current", "next", "confirm"] as const).map((key) => (
                <PasswordField
                  key={key}
                  id={`${id}-${key}`}
                  label={t(`accountSettings.${key}Password`)}
                  value={passwords[key]}
                  onChange={(value) => changePassword(key, value)}
                  autoComplete={
                    key === "current" ? "current-password" : "new-password"
                  }
                  error={errors[key]}
                />
              ))}
            </fieldset>
          </ScrollArea>
          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              {t("accountSettings.cancel")}
            </Button>
            <Button
              type="submit"
              loading={saving}
              disabled={!hasChanges || saving || !hasPassword}
            >
              {t("accountSettings.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
