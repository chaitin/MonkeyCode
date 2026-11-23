import { descendantIDs, type MemberGroup } from "./member-groups.ts"

export type MoveMember = { id: string; source_group_id?: string }
export type MovePayload =
  { kind: "group"; ids: string[] } | { kind: "member"; members: MoveMember[] }

export function movableGroupIDs(
  groups: MemberGroup[],
  ids: string[]
): string[] {
  return [...new Set(ids)].filter(
    (id) =>
      !ids.some(
        (parent) => parent !== id && descendantIDs(groups, parent).has(id)
      )
  )
}

export function memberMoveKey(member: MoveMember): string {
  return `${member.source_group_id ?? "list"}:${member.id}`
}

export function updateGroupSelection(
  current: string[],
  id: string,
  select: boolean
): string[] {
  return select
    ? current.includes(id)
      ? current
      : [...current, id]
    : current.filter((selected) => selected !== id)
}

export function updateMemberSelection(
  current: MoveMember[],
  member: MoveMember,
  select: boolean
): MoveMember[] {
  const key = memberMoveKey(member)
  return select
    ? current.some((selected) => memberMoveKey(selected) === key)
      ? current
      : [...current, member]
    : current.filter((selected) => memberMoveKey(selected) !== key)
}

export function canMoveTo(
  groups: MemberGroup[],
  payload: MovePayload,
  target: MemberGroup
): boolean {
  if (payload.kind === "group") {
    return (
      payload.ids.length > 0 &&
      payload.ids.every((id) => {
        const group = groups.find((entry) => entry.id === id)
        return (
          group?.actions.includes("move") &&
          group.parent_id !== target.id &&
          !descendantIDs(groups, id).has(target.id)
        )
      })
    )
  }
  return (
    payload.members.length > 0 &&
    payload.members.every((member) =>
      member.source_group_id
        ? member.source_group_id !== target.id
        : target.allow_add_members
    )
  )
}
