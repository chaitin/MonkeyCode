import { useState } from "react"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import type { MemberActionUser } from "@/components/members/member-actions"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"

export function ResetMemberPasswordDialog({
  user,
  onClose,
}: {
  user: MemberActionUser
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const [password, setPassword] = useState("")
  const [saving, setSaving] = useState(false)

  const resetPassword = async () => {
    if (saving || password) return
    setSaving(true)
    try {
      const result = await api<{ password: string }>(
        `/api/admin/v1/users/${user.id}/reset-password`,
        { method: "POST" }
      )
      setPassword(result.password)
    } catch (reason) {
      showToast({ status: "error", title: (reason as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(password)
      showToast({
        status: "success",
        title: t("pages.membersAndGroups.passwordCopied"),
      })
    } catch {
      showToast({
        status: "error",
        title: t("pages.membersAndGroups.passwordCopyFailed"),
      })
    }
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("pages.membersAndGroups.resetPassword")}
          </AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogDescription>
          {password
            ? t("pages.membersAndGroups.resetPasswordResult", {
                member: user.name,
              })
            : t("pages.membersAndGroups.confirmResetPassword", {
                member: user.name,
                email: user.email,
              })}
        </AlertDialogDescription>
        {password && (
          <Field>
            <FieldLabel htmlFor="member-generated-password">
              {t("pages.membersAndGroups.generatedPassword")}
            </FieldLabel>
            <div className="flex min-w-0 gap-2">
              <Input
                id="member-generated-password"
                className="min-w-0 flex-1 font-mono"
                value={password}
                readOnly
                autoComplete="off"
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void copyPassword()}
              >
                {t("pages.membersAndGroups.copyPassword")}
              </Button>
            </div>
          </Field>
        )}
        <AlertDialogFooter>
          {password ? (
            <AlertDialogCancel type="button">
              {t("common.close")}
            </AlertDialogCancel>
          ) : (
            <>
              <AlertDialogCancel type="button" disabled={saving}>
                {t("pages.membersAndGroups.cancelAction")}
              </AlertDialogCancel>
              <AlertDialogAction
                type="button"
                disabled={saving}
                onClick={() => void resetPassword()}
              >
                {saving
                  ? t("common.saving")
                  : t("pages.membersAndGroups.resetPassword")}
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
