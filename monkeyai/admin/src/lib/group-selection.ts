export type GroupSelectionMode = "groups" | "users" | "both"

export type GroupSelectionValue = {
  groupIds: readonly string[]
  userIds: readonly string[]
}

export type GroupSelectionHierarchy = {
  groups: readonly { id: string; parentId?: string | null }[]
  users: readonly { id: string; groupIds: readonly string[] }[]
}

/** Build once per data change, independently of the current selection. */
export function indexGroupSelection(hierarchy: GroupSelectionHierarchy) {
  const parents = new Map<string, string | null>()
  const children = new Map<string, string[]>()
  const userGroups = new Map<string, Set<string>>()
  for (const group of hierarchy.groups) {
    parents.set(group.id, group.parentId ?? null)
    if (group.parentId) {
      const siblings = children.get(group.parentId) ?? []
      siblings.push(group.id)
      children.set(group.parentId, siblings)
    }
  }
  for (const user of hierarchy.users) {
    const memberships = userGroups.get(user.id) ?? new Set<string>()
    for (const groupID of user.groupIds) memberships.add(groupID)
    userGroups.set(user.id, memberships)
  }
  return { ...hierarchy, parents, children, userGroups }
}

type SelectionIndex = ReturnType<typeof indexGroupSelection>
type Hierarchy = GroupSelectionHierarchy | SelectionIndex
const getIndex = (hierarchy: Hierarchy) =>
  "children" in hierarchy ? hierarchy : indexGroupSelection(hierarchy)

function subtreeIDs(index: SelectionIndex, id: string) {
  const ids = new Set([id])
  for (const parent of ids) {
    for (const child of index.children.get(parent) ?? []) ids.add(child)
  }
  return ids
}

export function inheritedGroupSelection(
  value: GroupSelectionValue,
  hierarchy: Hierarchy
) {
  const index = getIndex(hierarchy)
  const selectedGroups = new Set(value.groupIds)
  const coveredGroups = new Set<string>()
  const inheritedGroupIds = new Set<string>()
  const inheritedUserIds = new Set<string>()
  const partialGroupIds = new Set<string>()
  for (const id of selectedGroups) {
    for (const child of subtreeIDs(index, id)) {
      coveredGroups.add(child)
      if (child !== id) inheritedGroupIds.add(child)
    }
  }
  if (coveredGroups.size > 0) {
    for (const [userID, memberships] of index.userGroups) {
      for (const groupID of memberships) {
        if (coveredGroups.has(groupID)) {
          inheritedUserIds.add(userID)
          break
        }
      }
    }
  }
  // Visit each ancestor at most once, rather than scanning all users per group.
  const visited = new Set<string>()
  const markAncestors = (id: string) => {
    let current: string | null | undefined = id
    while (current && !visited.has(current)) {
      visited.add(current)
      if (
        index.parents.has(current) &&
        !selectedGroups.has(current) &&
        !inheritedGroupIds.has(current)
      )
        partialGroupIds.add(current)
      current = index.parents.get(current)
    }
  }
  for (const id of selectedGroups) markAncestors(id)
  for (const userID of value.userIds) {
    for (const groupID of index.userGroups.get(userID) ?? [])
      markAncestors(groupID)
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
  hierarchy?: Hierarchy
): GroupSelectionValue {
  if (
    (mode === "groups" && kind === "user") ||
    (mode === "users" && kind === "group")
  ) {
    return value
  }
  if (hierarchy && multiple) {
    const index = getIndex(hierarchy)
    const inherited = inheritedGroupSelection(value, index)
    if (
      kind === "group"
        ? inherited.inheritedGroupIds.has(id)
        : inherited.inheritedUserIds.has(id)
    )
      return value
    if (kind === "group" && checked) {
      const subtree = subtreeIDs(index, id)
      return {
        groupIds: [
          ...value.groupIds.filter((groupID) => !subtree.has(groupID)),
          id,
        ],
        userIds: value.userIds.filter(
          (userID) =>
            ![...(index.userGroups.get(userID) ?? [])].some((groupID) =>
              subtree.has(groupID)
            )
        ),
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
