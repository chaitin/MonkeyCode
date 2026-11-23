import { useTranslation } from "react-i18next"
import { Copy01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { useAppToast } from "@/components/animated-toast-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type CreatedMemberCredentials = {
  id: string
  name: string
  email: string
  initial_password: string
}

function useCopyCredentials() {
  const { t } = useTranslation()
  const { showToast } = useAppToast()

  return async (
    members: CreatedMemberCredentials[],
    { passwordOnly = false }: { passwordOnly?: boolean } = {}
  ) => {
    if (members.some((member) => !member.initial_password)) return
    const labels = "pages.membersAndGroups.bulk"
    const text = passwordOnly
      ? members[0].initial_password
      : [
          [
            t(`${labels}.name`),
            t(`${labels}.email`),
            t(`${labels}.singlePassword`),
          ],
          ...members.map((member) => [
            member.name,
            member.email,
            member.initial_password,
          ]),
        ]
          .map((row) =>
            row.map((value) => value.replace(/[\t\r\n]/g, " ")).join("\t")
          )
          .join("\n")
    try {
      await navigator.clipboard.writeText(text)
      showToast({
        status: "success",
        title: t(
          passwordOnly
            ? "pages.membersAndGroups.passwordCopied"
            : "pages.membersAndGroups.creationResult.copied"
        ),
      })
    } catch {
      showToast({
        status: "error",
        title: t("pages.membersAndGroups.passwordCopyFailed"),
      })
    }
  }
}

export function CreatedMembersResult({
  members,
}: {
  members: CreatedMemberCredentials[]
}) {
  const { t } = useTranslation()
  const copy = useCopyCredentials()
  const key = "pages.membersAndGroups.creationResult"

  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      aria-label={t(`${key}.title`)}
    >
      {members.some((member) => !member.initial_password) && (
        <p className="text-sm text-destructive" role="alert">
          {t(`${key}.passwordMissing`)}
        </p>
      )}
      <div
        className="max-h-[min(24rem,45vh)] overflow-y-auto rounded-md border"
        role="list"
      >
        {members.map((member) => {
          const characters = Array.from(member.initial_password || "")
          const maskedPassword =
            characters.length > 8
              ? `${characters.slice(0, 4).join("")}${"•".repeat(characters.length - 8)}${characters.slice(-4).join("")}`
              : "•".repeat(characters.length)
          return (
            <div
              key={member.id}
              role="listitem"
              className="grid min-w-0 gap-3 border-b p-3 last:border-b-0 sm:grid-cols-2 sm:items-center"
            >
              <div className="min-w-0">
                <p className="break-all text-sm font-medium">{member.name}</p>
                <p className="break-all text-sm text-muted-foreground">
                  {member.email}
                </p>
              </div>
              <div className="relative min-w-0">
                <Input
                  type="text"
                  className="pe-10 font-mono"
                  value={maskedPassword}
                  placeholder="—"
                  readOnly
                  disabled={!member.initial_password}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t("pages.membersAndGroups.bulk.password", {
                    email: member.email,
                  })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="absolute inset-y-0 end-1.5 my-auto"
                  aria-label={`${t("pages.membersAndGroups.copyPassword")} (${member.email})`}
                  disabled={!member.initial_password}
                  onClick={() => void copy([member], { passwordOnly: true })}
                >
                  <HugeiconsIcon
                    icon={Copy01Icon}
                    strokeWidth={2}
                    className="size-4"
                    aria-hidden="true"
                  />
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function CopyCreatedMembersButton({
  members,
}: {
  members: CreatedMemberCredentials[]
}) {
  const { t } = useTranslation()
  const copy = useCopyCredentials()

  return (
    <Button
      type="button"
      variant="outline"
      className="sm:me-auto"
      disabled={members.some((member) => !member.initial_password)}
      onClick={() => void copy(members)}
    >
      {t("pages.membersAndGroups.creationResult.copyAll")}
    </Button>
  )
}
