export type MemberAppearance = {
  role: "admin" | "user"
  status: "active" | "disabled"
}

export function memberIconColor(member: MemberAppearance): string {
  if (member.status === "disabled") return "text-muted-foreground"
  return member.role === "admin"
    ? "text-green-700 dark:text-green-400"
    : "text-blue-600 dark:text-blue-400"
}
