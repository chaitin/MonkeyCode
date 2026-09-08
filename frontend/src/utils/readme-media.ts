interface ResolveReadmeMediaOptions {
  src: string
  readmePath: string
  projectId: string
  ref?: string
}

const absoluteScheme = /^([a-z][a-z\d+.-]*):/i

export function resolveReadmeMediaUrl({
  src,
  readmePath,
  projectId,
  ref,
}: ResolveReadmeMediaOptions): string | undefined {
  const trimmedSrc = src.trim()
  if (!trimmedSrc || !projectId) return undefined

  const scheme = absoluteScheme.exec(trimmedSrc)?.[1]?.toLowerCase()
  if (scheme) {
    return scheme === "http" || scheme === "https" ? trimmedSrc : undefined
  }
  if (trimmedSrc.startsWith("//")) return trimmedSrc
  if (trimmedSrc.includes("\\")) return undefined

  const rawPath = trimmedSrc.split(/[?#]/, 1)[0]
  if (!rawPath) return undefined

  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(rawPath)
  } catch {
    return undefined
  }

  const repositoryPath = resolveRepositoryPath(decodedPath, readmePath)
  if (!repositoryPath) return undefined

  const params = new URLSearchParams({ path: repositoryPath })
  if (ref) params.set("ref", ref)

  return `/api/v1/users/projects/${encodeURIComponent(projectId)}/tree/media?${params.toString()}`
}

function resolveRepositoryPath(srcPath: string, readmePath: string): string | undefined {
  const segments = srcPath.startsWith("/")
    ? []
    : readmePath.split("/").slice(0, -1).filter(Boolean)

  for (const segment of srcPath.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (segments.length === 0) return undefined
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  return segments.length > 0 ? segments.join("/") : undefined
}
