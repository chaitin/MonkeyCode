import { useMemo, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"

import { useAppToast } from "@/components/animated-toast-provider"
import { MemberGroupSelect } from "@/components/members/member-group-select"
import type { MemberGroup } from "@/lib/member-groups"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import {
  MAX_BULK_MEMBERS,
  createBulkMembers,
  parseBulkEmails,
  validateBulkMembers,
  type BulkMemberRole,
  type BulkMemberRow,
} from "@/lib/bulk-members"
import type { MemberActionUser } from "@/components/members/member-actions"

type CreatedMember = MemberActionUser & {
  joined_at: string
  last_login_at?: string
}

export function BulkAddMembersForm({
  groups,
  existingEmails,
  saving,
  onSavingChange,
  onCreated,
  onClose,
}: {
  groups: MemberGroup[]
  existingEmails: string[]
  saving: boolean
  onSavingChange: (saving: boolean) => void
  onCreated: (members: CreatedMember[]) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { showToast } = useAppToast()
  const [input, setInput] = useState("")
  const [role, setRole] = useState<BulkMemberRole>("user")
  const [groupIDs, setGroupIDs] = useState<string[]>([])
  const [rows, setRows] = useState<BulkMemberRow[] | null>(null)
  const [inputError, setInputError] = useState("")
  const [progress, setProgress] = useState<{
    completed: number
    total: number
  } | null>(null)
  const knownEmails = useMemo(
    () => new Set(existingEmails.map((email) => email.trim().toLowerCase())),
    [existingEmails]
  )
  const issues = rows ? validateBulkMembers(rows, knownEmails, role) : new Map()
  const key = "pages.membersAndGroups.bulk"

  const preview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = parseBulkEmails(input)
    if (!parsed.length) {
      setInputError(t(`${key}.empty`))
      return
    }
    if (parsed.length > MAX_BULK_MEMBERS) {
      setInputError(t(`${key}.tooMany`, { count: MAX_BULK_MEMBERS }))
      return
    }
    setRows(parsed)
    setInputError("")
  }

  const updateRow = (id: number, patch: Partial<BulkMemberRow>) => {
    setRows(
      (current) =>
        current?.map((row) => {
          if (row.id !== id) return row
          return {
            ...row,
            ...patch,
            name:
              patch.email !== undefined && row.name === row.email
                ? patch.email
                : (patch.name ?? row.name),
            error: undefined,
          }
        }) ?? null
    )
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!rows?.length || issues.size || saving) return
    onSavingChange(true)
    setProgress({ completed: 0, total: rows.length })
    const { created, failures } = await createBulkMembers(
      rows,
      role,
      (input) =>
        api<CreatedMember>("/api/admin/v1/users", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      (completed, total) => setProgress({ completed, total }),
      groupIDs
    )
    if (created.length) onCreated(created)
    onSavingChange(false)
    if (failures.size === 0) {
      showToast({
        status: "success",
        title: t(`${key}.successResult`, { count: created.length }),
      })
      onClose()
      return
    }
    setRows(
      (current) =>
        current
          ?.filter((row) => failures.has(row.id))
          .map((row) => ({
            ...row,
            error: failures.get(row.id),
          })) ?? null
    )
    showToast({
      status: "error",
      title: t(`${key}.result`, {
        succeeded: created.length,
        failed: failures.size,
      }),
    })
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={rows === null ? preview : submit}
    >
      <Field>
        <FieldLabel htmlFor="bulk-member-role">{t(`${key}.role`)}</FieldLabel>
        <Select
          items={{
            user: t(`${key}.member`),
            admin: t(`${key}.administrator`),
          }}
          value={role}
          onValueChange={(value) => {
            if (value === null) return
            setRole(value as BulkMemberRole)
            setRows(
              (current) =>
                current?.map((row) => ({ ...row, error: undefined })) ?? null
            )
          }}
          disabled={saving}
        >
          <SelectTrigger id="bulk-member-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectItem value="user">{t(`${key}.member`)}</SelectItem>
            <SelectItem value="admin">{t(`${key}.administrator`)}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <MemberGroupSelect
        id="bulk-member-groups"
        groups={groups}
        value={groupIDs}
        onValueChange={setGroupIDs}
        disabled={saving}
      />
      {rows === null && (
        <Field>
          <FieldLabel htmlFor="bulk-member-emails">
            {t(`${key}.emails`)}
          </FieldLabel>
          <Textarea
            id="bulk-member-emails"
            value={input}
            onChange={(event) => {
              setInput(event.target.value)
              setInputError("")
            }}
            placeholder={t(`${key}.placeholder`)}
            rows={6}
            className="max-h-72 min-h-32 resize-y"
          />
          {inputError && (
            <p className="text-sm text-destructive" role="alert">
              {inputError}
            </p>
          )}
        </Field>
      )}
      {rows !== null && rows.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">{t(`${key}.memberList`)}</p>
          {role === "admin" && (
            <p className="text-xs text-muted-foreground">
              {t(`${key}.adminPasswordHint`)}
            </p>
          )}
          <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border p-3">
            {rows.map((row) => {
              const issue = issues.get(row.id)
              return (
                <div
                  key={row.id}
                  className="space-y-1.5 border-b pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor={`bulk-email-${row.id}`}>
                        {t(`${key}.email`)}
                      </FieldLabel>
                      <Input
                        id={`bulk-email-${row.id}`}
                        type="email"
                        aria-invalid={
                          issue === "invalidEmail" ||
                          issue === "duplicateEmail" ||
                          issue === "existingEmail"
                        }
                        value={row.email}
                        disabled={saving}
                        onChange={(event) =>
                          updateRow(row.id, { email: event.target.value })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`bulk-name-${row.id}`}>
                        {t(`${key}.name`)}
                      </FieldLabel>
                      <Input
                        id={`bulk-name-${row.id}`}
                        aria-invalid={issue === "missingName"}
                        value={row.name}
                        disabled={saving}
                        onChange={(event) =>
                          updateRow(row.id, { name: event.target.value })
                        }
                      />
                    </Field>
                  </div>
                  {role === "admin" && (
                    <Input
                      type="password"
                      autoComplete="new-password"
                      aria-label={t(`${key}.password`, {
                        email: row.email,
                      })}
                      placeholder={t(`${key}.passwordPlaceholder`)}
                      value={row.password}
                      aria-invalid={
                        issue === "passwordTooShort" ||
                        issue === "duplicatePassword"
                      }
                      disabled={saving}
                      onChange={(event) =>
                        updateRow(row.id, { password: event.target.value })
                      }
                    />
                  )}
                  {(issue || row.error) && (
                    <p className="text-xs text-destructive">
                      {issue ? t(`${key}.errors.${issue}`) : row.error}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
      {saving && progress && (
        <p role="status" className="text-sm text-muted-foreground">
          {t(`${key}.progress`, progress)}
        </p>
      )}
      <DialogFooter className="mt-2">
        {rows !== null && rows.length > 0 && (
          <Button
            type="button"
            variant="outline"
            className="sm:me-auto"
            disabled={saving}
            onClick={() => {
              setInput(rows.map((row) => row.email).join("\n"))
              setRows(null)
              setProgress(null)
            }}
          >
            {t(`${key}.previous`)}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onClose}
        >
          {t("common.close")}
        </Button>
        <Button
          type="submit"
          disabled={
            saving || (rows !== null && (!rows.length || issues.size > 0))
          }
        >
          {rows === null
            ? t(`${key}.next`)
            : t(`${key}.create`, { count: rows.length })}
        </Button>
      </DialogFooter>
    </form>
  )
}
