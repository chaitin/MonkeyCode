export interface ParsedSkillMarkdown {
  name: string
  description: string
  tags: string[]
  content: string
  body: string
}

export function normalizeSkillTags(value: unknown): string[] {
  const rawTags = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，;\n]/)
      : []

  const seen = new Set<string>()
  const tags: string[] = []

  rawTags.forEach((rawTag) => {
    const tag = String(rawTag).trim()
    if (!tag || seen.has(tag)) return
    seen.add(tag)
    tags.push(tag)
  })

  return tags
}

export function parseSkillMarkdown(content: string): ParsedSkillMarkdown {
  if (!content.trim()) {
    throw new Error("SKILL.md 内容为空")
  }

  const parsed = parseFrontmatter(content)
  const name = toTrimmedString(parsed.data.name)
  const description = toTrimmedString(parsed.data.description)

  return {
    name,
    description,
    tags: normalizeSkillTags(parsed.data.tags),
    content,
    body: parsed.body,
  }
}

export function findSkillMarkdownPath(paths: string[]): string | null {
  const candidates = paths
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => path.split("/").at(-1) === "SKILL.md")
    .sort((a, b) => {
      const depthDelta = a.split("/").length - b.split("/").length
      if (depthDelta !== 0) return depthDelta
      return a.length - b.length
    })

  return candidates[0] ?? null
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const normalized = content.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")

  if (lines[0]?.trim() !== "---") {
    return { data: {}, body: content }
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (endIndex < 0) {
    return { data: {}, body: content }
  }

  return {
    data: parseYamlSubset(lines.slice(1, endIndex)),
    body: lines.slice(endIndex + 1).join("\n"),
  }
}

function parseYamlSubset(lines: string[]): Record<string, unknown> {
  const data: Record<string, unknown> = {}

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/)
    if (!match) continue

    const key = match[1]
    const inlineValue = match[2] ?? ""
    if (inlineValue.trim()) {
      data[key] = parseYamlScalar(inlineValue)
      continue
    }

    const listItems: string[] = []
    let nextIndex = index + 1
    while (nextIndex < lines.length) {
      const listMatch = lines[nextIndex].match(/^\s*-\s+(.+)$/)
      if (!listMatch) break
      listItems.push(stripQuotes(listMatch[1].trim()))
      nextIndex += 1
    }

    if (listItems.length > 0) {
      data[key] = listItems
      index = nextIndex - 1
    }
  }

  return data
}

function parseYamlScalar(value: string): string | string[] {
  const trimmed = value.trim()
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => stripQuotes(item.trim()))
      .filter(Boolean)
  }

  return stripQuotes(trimmed)
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}
