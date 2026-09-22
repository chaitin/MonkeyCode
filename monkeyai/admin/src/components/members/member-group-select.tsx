import { useTranslation } from "react-i18next"

import { GroupSelect } from "@/components/group-select"
import { Field, FieldLabel } from "@/components/ui/field"
import { ROOT_GROUP_ID, type MemberGroup } from "@/lib/member-groups"

export function MemberGroupSelect({
  id,
  groups,
  value,
  onValueChange,
  disabled = false,
}: {
  id: string
  groups: MemberGroup[]
  value: string[]
  onValueChange: (value: string[]) => void
  disabled?: boolean
}) {
  const { i18n, t } = useTranslation()
  const key = "pages.membersAndGroups.groupSelection"

  return (
    <Field>
      <FieldLabel htmlFor={id}>{t(`${key}.label`)}</FieldLabel>
      <GroupSelect
        id={id}
        options={groups.map((group) => ({
          id: group.id,
          parentId: group.parent_id,
          name: group.name,
          disabled: !group.allow_add_members,
        }))}
        value={{ groupIds: value, userIds: [] }}
        onValueChange={(next) => onValueChange([...next.groupIds])}
        label={t(`${key}.label`)}
        placeholder={
          groups.find((group) => group.id === ROOT_GROUP_ID)?.name ?? ""
        }
        emptyText={t(`${key}.empty`)}
        locale={i18n.resolvedLanguage ?? i18n.language}
        disabled={disabled}
        defaultExpanded
        collapsible={false}
        multiple
        selectionMode="groups"
      />
    </Field>
  )
}
