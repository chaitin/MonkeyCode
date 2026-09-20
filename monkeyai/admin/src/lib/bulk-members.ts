export const MAX_BULK_MEMBERS = 50

export type BulkMemberRole = "user" | "admin"
export type BulkMemberRow = {
  id: number
  email: string
  name: string
  password: string
  error?: string
}
export type BulkMemberInput = {
  name: string
  email: string
  role: BulkMemberRole
  password?: string
}
export type BulkMemberIssue =
  | "invalidEmail"
  | "duplicateEmail"
  | "existingEmail"
  | "missingName"
  | "passwordTooShort"
  | "duplicatePassword"

export function parseBulkEmails(input: string): BulkMemberRow[] {
  return input
    .split(/\r?\n/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
    .map((email, index) => ({ id: index, email, name: email, password: "" }))
}

export function validateBulkMembers(
  rows: BulkMemberRow[],
  existingEmails: ReadonlySet<string>,
  role: BulkMemberRole
): Map<number, BulkMemberIssue> {
  const knownEmails = new Set(
    [...existingEmails].map((email) => email.trim().toLowerCase())
  )
  const counts = new Map<string, number>()
  const passwords = new Map<string, number>()
  for (const row of rows) {
    const email = row.email.trim().toLowerCase()
    counts.set(email, (counts.get(email) ?? 0) + 1)
    if (role === "admin" && row.password.length >= 12) {
      passwords.set(row.password, (passwords.get(row.password) ?? 0) + 1)
    }
  }

  const issues = new Map<number, BulkMemberIssue>()
  for (const row of rows) {
    const email = row.email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      issues.set(row.id, "invalidEmail")
    } else if ((counts.get(email) ?? 0) > 1) {
      issues.set(row.id, "duplicateEmail")
    } else if (knownEmails.has(email)) {
      issues.set(row.id, "existingEmail")
    } else if (!row.name.trim()) {
      issues.set(row.id, "missingName")
    } else if (role === "admin" && row.password.length < 12) {
      issues.set(row.id, "passwordTooShort")
    } else if (role === "admin" && (passwords.get(row.password) ?? 0) > 1) {
      issues.set(row.id, "duplicatePassword")
    }
  }
  return issues
}

export async function createBulkMembers<T>(
  rows: BulkMemberRow[],
  role: BulkMemberRole,
  create: (input: BulkMemberInput) => Promise<T>,
  onProgress: (completed: number, total: number) => void
): Promise<{ created: T[]; failures: Map<number, string> }> {
  const created: T[] = []
  const failures = new Map<number, string>()
  for (const [index, row] of rows.entries()) {
    try {
      created.push(
        await create({
          name: row.name.trim(),
          email: row.email.trim().toLowerCase(),
          role,
          ...(role === "admin" ? { password: row.password } : {}),
        })
      )
    } catch (reason) {
      failures.set(
        row.id,
        reason instanceof Error ? reason.message : String(reason)
      )
    }
    onProgress(index + 1, rows.length)
  }
  return { created, failures }
}
