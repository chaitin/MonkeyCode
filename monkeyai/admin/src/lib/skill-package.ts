import type JSZipType from "jszip"
import type { JSZipObject } from "jszip"

type ParseDocument = (typeof import("yaml"))["parseDocument"]

const MAX_PACKAGE_SIZE = 20 * 1024 * 1024
const MAX_UNPACKED_SIZE = 50 * 1024 * 1024
const MAX_FILE_COUNT = 500
const MAX_MANIFEST_SIZE = 512 * 1024

export type SkillPackageErrorCode =
  | "fileTooLarge"
  | "invalidZip"
  | "unsafePath"
  | "symlink"
  | "tooManyFiles"
  | "unpackedTooLarge"
  | "missingManifest"
  | "multipleManifests"
  | "mixedRoot"
  | "manifestTooLarge"
  | "invalidFrontmatter"
  | "missingName"
  | "invalidName"
  | "missingDescription"

export class SkillPackageError extends Error {
  code: SkillPackageErrorCode

  constructor(code: SkillPackageErrorCode) {
    super(code)
    this.name = "SkillPackageError"
    this.code = code
  }
}

export type SkillPackageAnalysis = {
  name: string
  description: string
  content: string
  tags: string[]
  entryPath: string
  rootPath: string
  fileCount: number
  unpackedSize: number
}

type SizedZipObject = JSZipObject & {
  _data?: {
    uncompressedSize?: number
  }
}

type SkillSourceEntry = {
  path: string
  size: number
  text: () => Promise<string>
}

function getUnixPermissions(entry: JSZipObject) {
  if (typeof entry.unixPermissions === "number") {
    return entry.unixPermissions
  }

  if (typeof entry.unixPermissions === "string") {
    return Number.parseInt(entry.unixPermissions, 8)
  }

  return 0
}

function isUnsafePath(path: string) {
  const normalizedPath = path.replaceAll("\\", "/")
  const pathSegments = normalizedPath.split("/")

  return (
    normalizedPath.includes("\0") ||
    normalizedPath.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalizedPath) ||
    pathSegments.includes("..")
  )
}

function normalizeTags(tags: unknown) {
  const values = Array.isArray(tags)
    ? tags
    : typeof tags === "string"
      ? tags.split(/[,，]/)
      : []

  return Array.from(
    new Set(
      values
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  )
}

function parseSkillManifest(content: string, parseDocument: ParseDocument) {
  const normalizedContent = content.replaceAll("\r\n", "\n")

  if (!normalizedContent.startsWith("---\n")) {
    throw new SkillPackageError("invalidFrontmatter")
  }

  const closingMarkerIndex = normalizedContent.indexOf("\n---\n", 4)
  if (closingMarkerIndex === -1) {
    throw new SkillPackageError("invalidFrontmatter")
  }

  const document = parseDocument(normalizedContent.slice(4, closingMarkerIndex))
  if (document.errors.length > 0) {
    throw new SkillPackageError("invalidFrontmatter")
  }

  const metadata = document.toJS() as Record<string, unknown> | null
  const name = typeof metadata?.name === "string" ? metadata.name.trim() : ""
  const description =
    typeof metadata?.description === "string" ? metadata.description.trim() : ""

  if (!name) {
    throw new SkillPackageError("missingName")
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new SkillPackageError("invalidName")
  }

  if (!description) {
    throw new SkillPackageError("missingDescription")
  }

  return {
    name,
    description,
    tags: normalizeTags(metadata?.tags),
  }
}

function isMeaningfulPath(path: string) {
  return (
    !path.startsWith("__MACOSX/") &&
    !path.endsWith("/.DS_Store") &&
    path !== ".DS_Store"
  )
}

function getRootPath(entryPath: string) {
  return entryPath.slice(0, -"SKILL.md".length).replace(/\/$/, "")
}

function isInsideRoot(path: string, rootPath: string) {
  return rootPath ? path.startsWith(`${rootPath}/`) : true
}

async function analyzeSkillEntries(
  entries: SkillSourceEntry[],
  manifestEntries: SkillSourceEntry[],
  parseDocument: ParseDocument
) {
  const rootPaths = manifestEntries.map((entry) => getRootPath(entry.path))

  return Promise.all(
    manifestEntries.map(async (manifestEntry, manifestIndex) => {
      const rootPath = rootPaths[manifestIndex]
      const nestedRootPaths = rootPaths.filter(
        (candidateRoot) =>
          candidateRoot !== rootPath &&
          isInsideRoot(candidateRoot, rootPath) &&
          candidateRoot.length > rootPath.length
      )
      const skillEntries = entries.filter(
        (entry) =>
          isInsideRoot(entry.path, rootPath) &&
          !nestedRootPaths.some((nestedRoot) =>
            isInsideRoot(entry.path, nestedRoot)
          )
      )

      if (skillEntries.length > MAX_FILE_COUNT) {
        throw new SkillPackageError("tooManyFiles")
      }

      const unpackedSize = skillEntries.reduce(
        (total, entry) => total + entry.size,
        0
      )
      if (unpackedSize > MAX_UNPACKED_SIZE) {
        throw new SkillPackageError("unpackedTooLarge")
      }

      if (manifestEntry.size > MAX_MANIFEST_SIZE) {
        throw new SkillPackageError("manifestTooLarge")
      }

      const content = await manifestEntry.text()
      if (new TextEncoder().encode(content).byteLength > MAX_MANIFEST_SIZE) {
        throw new SkillPackageError("manifestTooLarge")
      }

      const metadata = parseSkillManifest(content, parseDocument)

      return {
        ...metadata,
        content,
        entryPath: manifestEntry.path,
        rootPath,
        fileCount: skillEntries.length,
        unpackedSize,
      } satisfies SkillPackageAnalysis
    })
  )
}

async function readArchiveEntries(file: File) {
  if (file.size > MAX_PACKAGE_SIZE) {
    throw new SkillPackageError("fileTooLarge")
  }

  const { default: JSZip } = await import("jszip")

  let archive: JSZipType
  try {
    archive = await JSZip.loadAsync(await file.arrayBuffer(), {
      createFolders: true,
    })
  } catch {
    throw new SkillPackageError("invalidZip")
  }

  const zipEntries = Object.values(archive.files)
  for (const entry of zipEntries) {
    if (isUnsafePath(entry.unsafeOriginalName ?? entry.name)) {
      throw new SkillPackageError("unsafePath")
    }

    if ((getUnixPermissions(entry) & 0o170000) === 0o120000) {
      throw new SkillPackageError("symlink")
    }
  }

  return zipEntries
    .filter((entry) => !entry.dir && isMeaningfulPath(entry.name))
    .map((entry): SkillSourceEntry => ({
      path: entry.name,
      size: (entry as SizedZipObject)._data?.uncompressedSize ?? 0,
      text: () => entry.async("string"),
    }))
}

export async function inspectSkillArchive(file: File) {
  const [entries, { parseDocument }] = await Promise.all([
    readArchiveEntries(file),
    import("yaml"),
  ])
  const manifestEntries = entries.filter(
    (entry) => entry.path.split("/").at(-1) === "SKILL.md"
  )

  if (manifestEntries.length === 0) {
    throw new SkillPackageError("missingManifest")
  }

  return analyzeSkillEntries(entries, manifestEntries, parseDocument)
}

export async function inspectSkillDirectory(files: File[]) {
  const entries = files
    .map((file): SkillSourceEntry => ({
      path: (file.webkitRelativePath || file.name).replaceAll("\\", "/"),
      size: file.size,
      text: () => file.text(),
    }))
    .filter((entry) => isMeaningfulPath(entry.path))

  for (const entry of entries) {
    if (isUnsafePath(entry.path)) {
      throw new SkillPackageError("unsafePath")
    }
  }

  const manifestEntries = entries.filter(
    (entry) => entry.path.split("/").at(-1) === "SKILL.md"
  )
  if (manifestEntries.length === 0) {
    throw new SkillPackageError("missingManifest")
  }

  const { parseDocument } = await import("yaml")
  return analyzeSkillEntries(entries, manifestEntries, parseDocument)
}

export async function inspectSkillPackage(file: File) {
  const entries = await readArchiveEntries(file)
  const manifestEntries = entries.filter(
    (entry) => entry.path.split("/").at(-1) === "SKILL.md"
  )
  if (manifestEntries.length === 0) {
    throw new SkillPackageError("missingManifest")
  }
  if (manifestEntries.length > 1) {
    throw new SkillPackageError("multipleManifests")
  }

  const manifestEntry = manifestEntries[0]
  const rootPath = getRootPath(manifestEntry.path)
  if (
    rootPath &&
    entries.some((entry) => !isInsideRoot(entry.path, rootPath))
  ) {
    throw new SkillPackageError("mixedRoot")
  }

  const { parseDocument } = await import("yaml")
  const [analysis] = await analyzeSkillEntries(
    entries,
    manifestEntries,
    parseDocument
  )
  return analysis
}
