type SortableMember = {
  id: string
  role: "admin" | "user"
  joined_at: string
}

export function compareMembers(a: SortableMember, b: SortableMember): number {
  if (a.role !== b.role) return a.role === "admin" ? -1 : 1
  return (
    Date.parse(a.joined_at) - Date.parse(b.joined_at) ||
    a.id.localeCompare(b.id)
  )
}
