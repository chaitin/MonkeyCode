export type MemberGroup = {
  id: string
  parent_id: string | null
  name: string
  member_ids: string[]
}

export const ROOT_GROUP_ID = "team"

export function descendantIDs(groups: MemberGroup[], id: string): Set<string> {
  const children = new Map<string, string[]>()
  for (const group of groups) {
    if (group.parent_id) {
      const siblings = children.get(group.parent_id) ?? []
      siblings.push(group.id)
      children.set(group.parent_id, siblings)
    }
  }
  const ids = new Set([id])
  for (const current of ids) {
    for (const child of children.get(current) ?? []) ids.add(child)
  }
  return ids
}

export function groupMemberIDs(
  groups: MemberGroup[],
  users: Array<{ id: string; role: "admin" | "user" }>,
  id: string
): Set<string> {
  if (id === ROOT_GROUP_ID) {
    return new Set(users.map((user) => user.id))
  }
  const ids = descendantIDs(groups, id)
  return new Set(
    groups
      .filter((group) => ids.has(group.id))
      .flatMap((group) => group.member_ids)
  )
}

export type GroupAction =
  "add-subgroup" | "rename" | "adjust-members" | "move" | "delete"
export type ActiveGroupAction = { action: GroupAction; group: MemberGroup }

export const groupActionKeys: Record<GroupAction, string> = {
  "add-subgroup": "addSubgroup",
  rename: "renameGroup",
  "adjust-members": "adjustMembers",
  move: "moveGroup",
  delete: "deleteGroup",
}
