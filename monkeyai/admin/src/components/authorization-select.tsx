import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
  GroupSelect,
  type GroupSelectProps,
  type GroupSelectOption,
} from "@/components/group-select"
import {
  AUTHORIZATION_GROUP_TREE,
  AUTHORIZATION_MEMBERS,
  type AuthorizationGroupNode,
  type AuthorizationMember,
  type AuthorizationSelection,
} from "@/lib/authorization-groups"

type Props = {
  id: string
  title?: string
  placeholder?: string
  disabled?: boolean
  renderSelection?: GroupSelectProps["renderSelection"]
  cascadeGroups?: boolean
  value: AuthorizationSelection
  onValueChange: (value: AuthorizationSelection) => void
  groups?: AuthorizationGroupNode[]
  members?: AuthorizationMember[]
}

function groupOptions(
  groups: AuthorizationGroupNode[],
  parentId: string | null = null
): GroupSelectOption[] {
  return groups.flatMap((group) => [
    { id: group.value, name: group.labelKey, parentId },
    ...groupOptions(group.children ?? [], group.value),
  ])
}

export function AuthorizationSelect({
  id,
  title,
  placeholder,
  disabled = false,
  cascadeGroups = true,
  renderSelection,
  value,
  onValueChange,
  groups = AUTHORIZATION_GROUP_TREE,
  members = AUTHORIZATION_MEMBERS,
}: Props) {
  const { t, i18n } = useTranslation()
  const options = useMemo(
    () =>
      groupOptions(groups).map((group) => ({ ...group, name: t(group.name) })),
    [groups, t]
  )
  const users = useMemo(
    () =>
      members.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email ?? "",
        groupIds: member.groupId ? [member.groupId] : [],
      })),
    [members]
  )

  return (
    <GroupSelect
      id={id}
      options={options}
      users={users}
      value={{ groupIds: value.groupIds, userIds: value.memberIds }}
      onValueChange={(next) =>
        onValueChange({
          groupIds: [...next.groupIds],
          memberIds: [...next.userIds],
        })
      }
      disabled={disabled}
      label={title ?? t("pages.models.authorizedScope")}
      placeholder={placeholder ?? t("pages.models.authorizationPlaceholder")}
      emptyText={t("pages.models.noMatchingAuthorization")}
      locale={i18n.resolvedLanguage ?? i18n.language}
      multiple
      selectionMode="both"
      cascadeGroups={cascadeGroups}
      renderSelection={renderSelection}
      searchable
      searchPlaceholder={t("pages.models.searchAuthorization")}
      noResultsText={t("pages.models.noMatchingAuthorization")}
    />
  )
}
