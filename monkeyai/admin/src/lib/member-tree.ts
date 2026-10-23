import { compareByName, type MemberGroup } from "./member-groups.ts"

type Member = { id: string; name: string }

export type MemberTree<T extends Member> = {
  roots: MemberGroup[]
  children: Map<string, MemberGroup[]>
  members: Map<string, T[]>
  counts: Map<string, number>
}

export type MemberTreeRow<T extends Member> = {
  key: string
  level: number
} & (
  | { kind: "group"; group: MemberGroup; count: number; expanded: boolean }
  | { kind: "member"; member: T; groupID: string }
)

// Index memberships once; a row never scans the complete user/group arrays.
export function buildMemberTree<T extends Member>(
  groups: MemberGroup[],
  users: T[],
  collator: Intl.Collator
): MemberTree<T> {
  const usersByID = new Map(users.map((user) => [user.id, user]))
  const groupsByID = new Map(groups.map((group) => [group.id, group]))
  const children = new Map<string, MemberGroup[]>()
  const members = new Map<string, T[]>()
  const memberSets = new Map<string, Set<string>>()
  const counts = new Map<string, number>()
  const remainingChildren = new Map<string, number>()

  for (const group of groups) {
    if (group.parent_id !== null) {
      const siblings = children.get(group.parent_id) ?? []
      siblings.push(group)
      children.set(group.parent_id, siblings)
    }
    const ids = new Set(group.member_ids)
    memberSets.set(group.id, ids)
    const directMembers: T[] = []
    for (const id of ids) {
      const user = usersByID.get(id)
      if (user) directMembers.push(user)
    }
    members.set(
      group.id,
      directMembers.sort((a, b) => compareByName(a, b, collator))
    )
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => compareByName(a, b, collator))
  }

  // Merge smaller sets into larger ones, preserving cross-group deduplication.
  // Store counts before reusing a child's set, and avoid recursive stack limits.
  const ready: MemberGroup[] = []
  for (const group of groups) {
    const size = children.get(group.id)?.length ?? 0
    remainingChildren.set(group.id, size)
    if (!size) ready.push(group)
  }
  for (let index = 0; index < ready.length; index++) {
    const group = ready[index]
    const ids = memberSets.get(group.id)!
    counts.set(group.id, ids.size)
    const parent =
      group.parent_id === null ? undefined : groupsByID.get(group.parent_id)
    if (!parent) continue
    let larger = memberSets.get(parent.id)!
    let smaller = ids
    if (larger.size < smaller.size) [larger, smaller] = [smaller, larger]
    for (const id of smaller) larger.add(id)
    memberSets.set(parent.id, larger)
    memberSets.delete(group.id)
    const remaining = remainingChildren.get(parent.id)! - 1
    remainingChildren.set(parent.id, remaining)
    if (!remaining) ready.push(parent)
  }
  return {
    roots: groups.filter((group) => group.parent_id === null),
    children,
    members,
    counts,
  }
}

export function flattenMemberTree<T extends Member>(
  tree: MemberTree<T>,
  expansion: ReadonlyMap<string, boolean>
): MemberTreeRow<T>[] {
  const rows: MemberTreeRow<T>[] = []
  const visited = new Set<string>()
  const stack: Array<
    | { group: MemberGroup; level: number }
    | { members: T[]; groupID: string; level: number }
  > = tree.roots.map((group) => ({ group, level: 0 })).reverse()
  while (stack.length) {
    const entry = stack.pop()!
    if ("members" in entry) {
      for (const member of entry.members) {
        rows.push({
          kind: "member",
          key: `member:${entry.groupID}:${member.id}`,
          member,
          groupID: entry.groupID,
          level: entry.level,
        })
      }
      continue
    }
    const { group, level } = entry
    if (visited.has(group.id)) continue
    visited.add(group.id)
    const expanded = expansion.get(group.id) ?? group.parent_id === null
    rows.push({
      kind: "group",
      key: `group:${group.id}`,
      group,
      level,
      expanded,
      count: tree.counts.get(group.id) ?? 0,
    })
    if (!expanded) continue
    stack.push({
      members: tree.members.get(group.id) ?? [],
      groupID: group.id,
      level: level + 1,
    })
    const children = tree.children.get(group.id) ?? []
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push({ group: children[index], level: level + 1 })
    }
  }
  return rows
}
