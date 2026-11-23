import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { UserSearch } from "@/components/user-search"

type Member = { id: string; name: string; email: string }

export function SupervisorListEditor({
  members,
  ids,
  onChange,
}: {
  members: Member[]
  ids: string[]
  onChange: (ids: string[]) => void
}) {
  const { t } = useTranslation()
  const [pendingID, setPendingID] = useState("")
  const selected = new Set(ids)
  const byID = new Map(members.map((member) => [member.id, member]))
  const candidates = members
    .filter((member) => !selected.has(member.id))
    .map((member) => ({ ...member, deleted: false }))
  const canAdd = byID.has(pendingID) && !selected.has(pendingID)
  return (
    <div className="flex flex-col gap-5">
      <section
        aria-labelledby="supervisor-list-title"
        className="flex flex-col gap-2"
      >
        <h3 id="supervisor-list-title" className="text-sm font-medium">
          {t("pages.membersAndGroups.supervisorCount", { count: ids.length })}
        </h3>
        {ids.length ? (
          <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
            {ids.map((id) => {
              const member = byID.get(id)
              if (!member) return null
              return (
                <li key={id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {member.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {member.email}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t(
                      "pages.membersAndGroups.removeSupervisorNamed",
                      { name: member.name }
                    )}
                    onClick={() =>
                      onChange(ids.filter((current) => current !== id))
                    }
                  >
                    {t("pages.membersAndGroups.removeSupervisor")}
                  </Button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
            {t("pages.membersAndGroups.emptySupervisorList")}
          </p>
        )}
      </section>
      <Field>
        {candidates.length ? (
          <div className="flex items-center gap-2">
            <UserSearch
              id="supervisor-search"
              className="ms-0 min-w-0 flex-1"
              users={candidates}
              userID={pendingID}
              query=""
              onChange={({ userID }) => setPendingID(userID)}
              placeholder={t("pages.membersAndGroups.searchMembersPlaceholder")}
              searchInPopup
            />
            <Button
              type="button"
              variant="outline"
              disabled={!canAdd}
              onClick={() => {
                if (!canAdd) return
                onChange([...ids, pendingID])
                setPendingID("")
              }}
            >
              {t("pages.membersAndGroups.addSupervisor")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(
              members.length
                ? "pages.membersAndGroups.allSupervisorsAdded"
                : "pages.membersAndGroups.noSupervisorCandidates"
            )}
          </p>
        )}
      </Field>
    </div>
  )
}
