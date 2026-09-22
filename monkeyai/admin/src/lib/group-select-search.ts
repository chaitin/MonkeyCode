import { pinyin } from "pinyin-pro"

type SearchGroup = { id: string; parentId?: string | null; name: string }
type SearchUser = {
  id: string
  name: string
  email?: string
  groupIds: readonly string[]
}
type GroupSearchIndex = {
  groups: Map<string, string[]>
  users: Map<string, string[]>
}

function normalizeSearch(value: string, locale?: string) {
  return value
    .toLocaleLowerCase(locale)
    .replace(/[üǖǘǚǜ]/gu, "v")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[\s'’-]+/gu, "")
}

/** Cache name transliteration separately from query and selection changes. */
export function createGroupSearchIndex(
  groups: readonly SearchGroup[],
  users: readonly SearchUser[],
  locale?: string
): GroupSearchIndex {
  const nameKeys = (name: string) => {
    const keys = [name]
    if (/\p{Script=Han}/u.test(name)) {
      keys.push(
        pinyin(name, {
          toneType: "none",
          type: "array",
          nonZh: "consecutive",
        }).join(""),
        pinyin(name, {
          pattern: "first",
          type: "array",
          nonZh: "consecutive",
        }).join("")
      )
    }
    return keys.map((key) => normalizeSearch(key, locale)).filter(Boolean)
  }
  return {
    groups: new Map(groups.map((group) => [group.id, nameKeys(group.name)])),
    users: new Map(
      users.map((user) => [
        user.id,
        [
          ...nameKeys(user.name),
          ...(user.email ? [normalizeSearch(user.email, locale)] : []),
        ],
      ])
    ),
  }
}

/** Keep matching groups' subtrees and matching users, with their ancestor paths. */
export function searchGroupTree(
  groups: readonly SearchGroup[],
  users: readonly SearchUser[],
  query: string,
  locale?: string,
  searchIndex?: GroupSearchIndex
) {
  const normalized = normalizeSearch(query, locale)
  if (!normalized) {
    return {
      groupIds: new Set(groups.map((group) => group.id)),
      userIds: new Set(users.map((user) => user.id)),
    }
  }
  const byID = new Map(groups.map((group) => [group.id, group]))
  const children = new Map<string, string[]>()
  for (const group of groups) {
    if (!group.parentId) continue
    const siblings = children.get(group.parentId) ?? []
    siblings.push(group.id)
    children.set(group.parentId, siblings)
  }
  const index = searchIndex ?? createGroupSearchIndex(groups, users, locale)
  const matches = (keys: string[] | undefined) =>
    keys?.some((key) => key.includes(normalized)) ?? false
  const matchedSubtree = new Set(
    groups
      .filter((group) => matches(index.groups.get(group.id)))
      .map((group) => group.id)
  )
  for (const id of matchedSubtree) {
    for (const child of children.get(id) ?? []) matchedSubtree.add(child)
  }
  const groupIds = new Set(matchedSubtree)
  const userIds = new Set<string>()
  for (const user of users) {
    const userMatches = matches(index.users.get(user.id))
    if (userMatches || user.groupIds.some((id) => matchedSubtree.has(id))) {
      userIds.add(user.id)
      if (userMatches) {
        for (const id of user.groupIds) {
          if (byID.has(id)) groupIds.add(id)
        }
      }
    }
  }
  for (const id of groupIds) {
    const parentID = byID.get(id)?.parentId
    if (parentID && byID.has(parentID)) groupIds.add(parentID)
  }
  return { groupIds, userIds }
}
