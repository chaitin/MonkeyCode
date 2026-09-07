import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { api } from "@/lib/api"
import {
  ROOT_GROUP_ID,
  descendantIDs,
  type MemberGroup,
} from "@/lib/member-groups"
import { groupActionKeys, type ActiveGroupAction } from "@/lib/member-groups"

const submitKeys = {
  "add-subgroup": "createGroup",
  rename: "saveChanges",
  "adjust-members": "applyChanges",
  move: "moveAction",
  delete: "deleteAction",
}

export function GroupActionDialog({
  action,
  group,
  groups,
  users,
  onClose,
  onSaved,
}: ActiveGroupAction & {
  groups: MemberGroup[]
  users: Array<{ id: string; name: string; email: string }>
  onClose: () => void
  onSaved: (group: MemberGroup | null) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(action === "rename" ? group.name : "")
  const [memberIDs, setMemberIDs] = useState(group.member_ids)
  const [query, setQuery] = useState("")
  const [parentID, setParentID] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const excluded = descendantIDs(groups, group.id)
  const targets = groups.filter(
    (candidate) =>
      !excluded.has(candidate.id) && candidate.id !== group.parent_id
  )
  const normalized = query.trim().toLocaleLowerCase()
  const visible = users.filter((user) =>
    `${user.name} ${user.email}`.toLocaleLowerCase().includes(normalized)
  )
  const titleKey = groupActionKeys[action]
  const hasChildren = groups.some(
    (candidate) => candidate.parent_id === group.id
  )

  const targetPath = (candidate: MemberGroup) => {
    const names = [candidate.name]
    const visited = new Set([candidate.id])
    let parent = groups.find((item) => item.id === candidate.parent_id)
    while (parent && !visited.has(parent.id)) {
      names.unshift(parent.name)
      visited.add(parent.id)
      parent = groups.find((item) => item.id === parent?.parent_id)
    }
    return names.join(" / ")
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError("")
    try {
      const path = `/api/admin/v1/groups/${group.id}`
      let updated: MemberGroup | null = null
      if (action === "delete") {
        await api<void>(path, { method: "DELETE" })
      } else if (action === "add-subgroup") {
        updated = await api<MemberGroup>("/api/admin/v1/groups", {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            parent_id: group.id === ROOT_GROUP_ID ? null : group.id,
          }),
        })
      } else if (action === "adjust-members") {
        updated = await api<MemberGroup>(`${path}/members`, {
          method: "PUT",
          body: JSON.stringify({ member_ids: memberIDs }),
        })
      } else {
        updated = await api<MemberGroup>(path, {
          method: "PATCH",
          body: JSON.stringify(
            action === "rename"
              ? { name: name.trim() }
              : { parent_id: parentID === ROOT_GROUP_ID ? null : parentID }
          ),
        })
      }
      onSaved(updated)
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSaving(false)
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
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        closeLabel={t("common.close")}
        showCloseButton={!saving}
      >
        <form
          className="flex flex-col gap-6"
          onSubmit={submit}
          aria-busy={saving}
        >
          <DialogHeader>
            <DialogTitle>{t(`pages.membersAndGroups.${titleKey}`)}</DialogTitle>
            <DialogDescription>
              {t(`pages.membersAndGroups.${titleKey}DialogDescription`, {
                group: group.name,
              })}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {(action === "add-subgroup" || action === "rename") && (
            <Field>
              <FieldLabel htmlFor="group-name">
                {t("pages.membersAndGroups.groupName")}
              </FieldLabel>
              <Input
                id="group-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={100}
                autoFocus
                disabled={saving}
                placeholder={t("pages.membersAndGroups.groupNamePlaceholder")}
              />
            </Field>
          )}
          {action === "adjust-members" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {t("pages.membersAndGroups.directMembersHint")}
              </p>
              <Field>
                <FieldLabel htmlFor="group-member-search" className="sr-only">
                  {t("pages.membersAndGroups.searchMembers")}
                </FieldLabel>
                <Input
                  id="group-member-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t(
                    "pages.membersAndGroups.searchMembersPlaceholder"
                  )}
                  type="search"
                  autoFocus
                />
              </Field>
              <div
                className="flex max-h-80 flex-col gap-2 overflow-y-auto"
                role="group"
                aria-label={t("pages.membersAndGroups.selectMembers")}
              >
                {visible.map((user) => (
                  <Field
                    key={user.id}
                    orientation="horizontal"
                    className="min-w-0 rounded-md p-2 hover:bg-muted"
                  >
                    <Checkbox
                      id={`group-member-${user.id}`}
                      checked={memberIDs.includes(user.id)}
                      disabled={saving}
                      onCheckedChange={(checked) =>
                        setMemberIDs((current) =>
                          checked
                            ? [...current, user.id]
                            : current.filter((id) => id !== user.id)
                        )
                      }
                    />
                    <FieldLabel
                      htmlFor={`group-member-${user.id}`}
                      className="min-w-0 flex-1 cursor-pointer flex-col items-start gap-0"
                    >
                      <span className="max-w-full truncate">{user.name}</span>
                      <span className="max-w-full truncate text-xs text-muted-foreground">
                        {user.email}
                      </span>
                    </FieldLabel>
                  </Field>
                ))}
                {!visible.length && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {t("pages.membersAndGroups.noMembersFound")}
                  </p>
                )}
              </div>
            </div>
          )}
          {action === "move" && (
            <Field>
              <FieldLabel>
                {t("pages.membersAndGroups.targetParentGroup")}
              </FieldLabel>
              {targets.length ? (
                <RadioGroup
                  value={parentID}
                  onValueChange={setParentID}
                  disabled={saving}
                  className="max-h-72 overflow-y-auto"
                  aria-label={t("pages.membersAndGroups.targetParentGroup")}
                >
                  {targets.map((candidate) => (
                    <Field
                      key={candidate.id}
                      orientation="horizontal"
                      className="min-w-0 rounded-md p-2 hover:bg-muted"
                    >
                      <RadioGroupItem
                        id={`group-parent-${candidate.id}`}
                        value={candidate.id}
                      />
                      <FieldLabel
                        htmlFor={`group-parent-${candidate.id}`}
                        className="min-w-0 flex-1 cursor-pointer break-words"
                      >
                        {targetPath(candidate)}
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("pages.membersAndGroups.noMoveTargets")}
                </p>
              )}
            </Field>
          )}
          {action === "delete" && (
            <p className="text-sm text-muted-foreground">
              {t(
                `pages.membersAndGroups.${hasChildren ? "deleteChildrenHint" : "deleteMembersHint"}`
              )}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              {t("pages.membersAndGroups.cancelAction")}
            </Button>
            <Button
              type="submit"
              variant={action === "delete" ? "destructive" : "default"}
              disabled={
                saving ||
                ((action === "rename" || action === "add-subgroup") &&
                  !name.trim()) ||
                (action === "move" && !parentID) ||
                (action === "delete" && hasChildren)
              }
            >
              {saving
                ? t("common.saving")
                : t(`pages.membersAndGroups.${submitKeys[action]}`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
