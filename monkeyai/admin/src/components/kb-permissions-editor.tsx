import { useTranslation } from "react-i18next"
import { AuthorizationSelect } from "@/components/authorization-select"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  AuthorizationGroupNode,
  AuthorizationMember,
} from "@/lib/authorization-groups"
import { ROOT_GROUP_ID } from "@/lib/member-groups"
import { type Grant } from "@/lib/resources"

type Props = {
  id: string
  value: Grant[]
  onValueChange: (value: Grant[]) => void
  groups: AuthorizationGroupNode[]
  members: AuthorizationMember[]
  disabled?: boolean
}

export function KbPermissionsEditor({
  id,
  value,
  onValueChange,
  groups,
  members,
  disabled,
}: Props) {
  const { t } = useTranslation()
  const options = [
    { value: "none", label: t("kbPermissions.noAccess") },
    { value: "read_only", label: t("kbPermissions.readOnly") },
    { value: "read_write", label: t("kbPermissions.readWrite") },
  ]
  return (
    <AuthorizationSelect
      id={id}
      groups={groups}
      members={members}
      cascadeGroups={false}
      disabled={disabled}
      value={{
        groupIds: value.flatMap((g) =>
          g.all_users ? [ROOT_GROUP_ID] : g.group_id ? [g.group_id] : []
        ),
        memberIds: value.flatMap((g) => (g.user_id ? [g.user_id] : [])),
      }}
      onValueChange={() => {}}
      renderSelection={(kind, subjectID, name, inactive) => {
        const matches = (g: Grant) =>
          kind === "user"
            ? g.user_id === subjectID
            : (g.all_users ? ROOT_GROUP_ID : g.group_id) === subjectID
        const existing = value.find(matches)
        return (
          <Select
            items={options}
            value={existing ? (existing.access_level ?? "read_only") : "none"}
            disabled={inactive}
            onValueChange={(next) => {
              if (next === "none") {
                onValueChange(value.filter((g) => !matches(g)))
              } else if (next === "read_only" || next === "read_write") {
                const entry: Grant = {
                  ...(existing ??
                    (kind === "user"
                      ? { user_id: subjectID }
                      : subjectID === ROOT_GROUP_ID
                        ? { all_users: true }
                        : { group_id: subjectID })),
                  access_level: next,
                  usage_requirement: "optional",
                }
                onValueChange(
                  existing
                    ? value.map((g) => (matches(g) ? entry : g))
                    : [...value, entry]
                )
              }
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={t("kbPermissions.permissionFor", { name })}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} align="end">
              <SelectGroup>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )
      }}
    />
  )
}
