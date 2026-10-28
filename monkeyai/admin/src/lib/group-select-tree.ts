/** A disabled group can still be expanded to select its children. */
export type GroupSelectOption = {
  id: string
  parentId?: string | null
  name: string
  disabled?: boolean
}

/** Selection is shared by user ID across all of a user's group rows. */
export type GroupSelectUser = {
  id: string
  name: string
  /** Search-only metadata; not displayed in the row. */
  email?: string
  avatarUrl?: string | null
  groupIds: readonly string[]
  disabled?: boolean
}

export function buildGroupSelectTree(
  options: readonly GroupSelectOption[],
  users: readonly GroupSelectUser[],
  locale?: string
) {
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  })
  const compare = (
    a: { id: string; name: string },
    b: { id: string; name: string }
  ) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id)
  const groups = [...options].sort(compare)
  const sortedUsers = [...users].sort(compare)
  const byID = new Map(groups.map((group) => [group.id, group]))
  const usersByID = new Map(sortedUsers.map((user) => [user.id, user]))
  const children = new Map<string | null, GroupSelectOption[]>()
  for (const group of groups) {
    const parentID =
      group.parentId && byID.has(group.parentId) ? group.parentId : null
    const siblings = children.get(parentID) ?? []
    siblings.push(group)
    children.set(parentID, siblings)
  }
  const members = new Map<string | null, GroupSelectUser[]>()
  for (const user of sortedUsers) {
    const groupIDs = [...new Set(user.groupIds)].filter((id) => byID.has(id))
    for (const id of groupIDs.length ? groupIDs : [null]) {
      const siblings = members.get(id) ?? []
      siblings.push(user)
      members.set(id, siblings)
    }
  }
  const paths = new Map<string, string>()
  const groupPath = (group: GroupSelectOption) => {
    const cached = paths.get(group.id)
    if (cached !== undefined) return cached
    const names = [group.name]
    const seen = new Set([group.id])
    let parentID = group.parentId
    while (parentID && !seen.has(parentID)) {
      seen.add(parentID)
      const parent = byID.get(parentID)
      if (!parent) break
      names.unshift(parent.name)
      parentID = parent.parentId
    }
    const path = names.join(" / ")
    paths.set(group.id, path)
    return path
  }
  return {
    groups,
    users: sortedUsers,
    byID,
    usersByID,
    children,
    members,
    compare,
    groupPath,
  }
}

export type GroupSelectRow =
  | {
      kind: "group"
      key: string
      group: GroupSelectOption
      level: number
      expanded: boolean
      hasChildren: boolean
    }
  | {
      kind: "user"
      key: string
      user: GroupSelectUser
      parentID: string | null
      level: number
    }

export function flattenGroupSelectTree(
  tree: ReturnType<typeof buildGroupSelectTree>,
  expansion: ReadonlyMap<string, boolean>,
  defaultExpanded: boolean,
  visible?: { groupIds: ReadonlySet<string>; userIds: ReadonlySet<string> }
): GroupSelectRow[] {
  type Pending =
    | { kind: "group"; group: GroupSelectOption; level: number }
    | {
        kind: "user"
        user: GroupSelectUser
        level: number
        parentID: string | null
      }
  const stack: Pending[] = []
  const pushChildren = (parentID: string | null, level: number) => {
    const users = tree.members.get(parentID) ?? []
    const groups = tree.children.get(parentID) ?? []
    for (let i = users.length - 1; i >= 0; i--)
      stack.push({ kind: "user", user: users[i], level, parentID })
    for (let i = groups.length - 1; i >= 0; i--)
      stack.push({ kind: "group", group: groups[i], level })
  }
  pushChildren(null, 0)
  const rows: GroupSelectRow[] = []
  const visited = new Set<string>()
  while (stack.length > 0) {
    const row = stack.pop()!
    if (row.kind === "user") {
      if (visible && !visible.userIds.has(row.user.id)) continue
      rows.push({
        ...row,
        key: JSON.stringify(["user", row.parentID, row.user.id]),
      })
      continue
    }
    const group = row.group
    if (visited.has(group.id) || (visible && !visible.groupIds.has(group.id)))
      continue
    visited.add(group.id)
    const expanded = !!visible || (expansion.get(group.id) ?? defaultExpanded)
    const hasChildren =
      !!tree.children.get(group.id)?.length ||
      !!tree.members.get(group.id)?.length
    rows.push({
      ...row,
      key: JSON.stringify(["group", group.id]),
      expanded,
      hasChildren,
    })
    if (expanded) pushChildren(group.id, row.level + 1)
  }
  return rows
}
