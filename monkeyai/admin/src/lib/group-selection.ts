export type GroupSelectionMode = "groups" | "users" | "both"

export type GroupSelectionValue = {
  groupIds: readonly string[]
  userIds: readonly string[]
}

export type GroupSelectionHierarchy = {
  groups: readonly { id: string; parentId?: string | null }[]
  users: readonly { id: string; groupIds: readonly string[] }[]
}

function subtreeIDs(hierarchy: GroupSelectionHierarchy, id: string) {
  const ids = new Set([id])
  for (const parent of ids) {
    for (const group of hierarchy.groups) {
      if (group.parentId === parent) ids.add(group.id)
    }
  }
  return ids
}

export function inheritedGroupSelection(
  value: GroupSelectionValue,
  hierarchy: GroupSelectionHierarchy
) {
  const inheritedGroupIds = new Set<string>()
  const inheritedUserIds = new Set<string>()
  const partialGroupIds = new Set<string>()
  for (const id of value.groupIds) {
    const subtree = subtreeIDs(hierarchy, id)
    for (const child of subtree) {
      if (child !== id) inheritedGroupIds.add(child)
    }
    for (const user of hierarchy.users) {
      if (user.groupIds.some((groupID) => subtree.has(groupID))) {
        inheritedUserIds.add(user.id)
      }
    }
  }
  for (const group of hierarchy.groups) {
    if (value.groupIds.includes(group.id) || inheritedGroupIds.has(group.id))
      continue
    const subtree = subtreeIDs(hierarchy, group.id)
    if (
      value.groupIds.some((id) => subtree.has(id)) ||
      hierarchy.users.some(
        (user) =>
          value.userIds.includes(user.id) &&
          user.groupIds.some((id) => subtree.has(id))
      )
    )
      partialGroupIds.add(group.id)
  }
  return { inheritedGroupIds, inheritedUserIds, partialGroupIds }
}

export function changeGroupSelection(
  value: GroupSelectionValue,
  kind: "group" | "user",
  id: string,
  checked: boolean,
  multiple: boolean,
  mode: GroupSelectionMode,
  hierarchy?: GroupSelectionHierarchy
): GroupSelectionValue {
  if (
    (mode === "groups" && kind === "user") ||
    (mode === "users" && kind === "group")
  ) {
    return value
  }
  if (hierarchy && multiple) {
    const inherited = inheritedGroupSelection(value, hierarchy)
    if (
      kind === "group"
        ? inherited.inheritedGroupIds.has(id)
        : inherited.inheritedUserIds.has(id)
    )
      return value
    if (kind === "group" && checked) {
      const subtree = subtreeIDs(hierarchy, id)
      const inheritedUsers = new Set(
        hierarchy.users
          .filter((user) =>
            user.groupIds.some((groupID) => subtree.has(groupID))
          )
          .map((user) => user.id)
      )
      return {
        groupIds: [
          ...value.groupIds.filter((groupID) => !subtree.has(groupID)),
          id,
        ],
        userIds: value.userIds.filter((userID) => !inheritedUsers.has(userID)),
      }
    }
  }
  const key = kind === "group" ? "groupIds" : "userIds"
  if (checked && !multiple) {
    return { groupIds: [], userIds: [], [key]: [id] }
  }
  return {
    ...value,
    [key]: checked
      ? [...new Set([...value[key], id])]
      : value[key].filter((selected) => selected !== id),
  }
}
