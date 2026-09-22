import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"

import { GroupSelect } from "@/components/group-select"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { canMoveTo, type MoveMember, type MovePayload } from "@/lib/group-move"
import type { MemberGroup } from "@/lib/member-groups"

export function MoveMembersDialog({
  groups,
  members,
  saving,
  onClose,
  onMove,
}: {
  groups: MemberGroup[]
  members: MoveMember[]
  saving: boolean
  onClose: () => void
  onMove: (target: MemberGroup) => Promise<void>
}) {
  const { i18n, t } = useTranslation()
  const [targetID, setTargetID] = useState("")
  const payload: MovePayload = { kind: "member", members }
  const target = groups.find((group) => group.id === targetID)
  const validTarget = target && canMoveTo(groups, payload, target)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!saving && target && validTarget) void onMove(target)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        closeLabel={t("common.close")}
        showCloseButton={!saving}
      >
        <form
          className="flex flex-col gap-6"
          onSubmit={submit}
          aria-busy={saving}
        >
          <DialogHeader>
            <DialogTitle>
              {t("pages.membersAndGroups.treeSelection.moveTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("pages.membersAndGroups.treeSelection.moveDescription", {
                count: new Set(members.map((member) => member.id)).size,
              })}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="move-members-target">
              {t("pages.membersAndGroups.targetParentGroup")}
            </FieldLabel>
            <GroupSelect
              id="move-members-target"
              options={groups.map((group) => ({
                id: group.id,
                parentId: group.parent_id,
                name: group.name,
                disabled: !canMoveTo(groups, payload, group),
              }))}
              value={{ groupIds: targetID ? [targetID] : [], userIds: [] }}
              onValueChange={(value) => setTargetID(value.groupIds[0] ?? "")}
              label={t("pages.membersAndGroups.targetParentGroup")}
              placeholder={t("pages.membersAndGroups.targetParentGroup")}
              emptyText={t("pages.membersAndGroups.groupSelection.empty")}
              searchPlaceholder={t(
                "pages.membersAndGroups.groupSelection.search"
              )}
              noResultsText={t(
                "pages.membersAndGroups.groupSelection.noMatches"
              )}
              locale={i18n.resolvedLanguage ?? i18n.language}
              disabled={saving}
              multiple={false}
              selectionMode="groups"
              defaultExpanded
              searchable
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              {t("pages.membersAndGroups.cancelAction")}
            </Button>
            <Button type="submit" disabled={saving || !validTarget}>
              {t("pages.membersAndGroups.moveAction")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
