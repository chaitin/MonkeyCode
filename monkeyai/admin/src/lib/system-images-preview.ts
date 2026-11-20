// 前端预览数据源；接入后端时替换此模块，不直接访问 Registry。
export type SystemImage = {
  id: string
  displayName: string
  reference: string
  source: "pull" | "upload"
  upstream?: string
  archive?: string
  size: number | null
  addedAt: string
}

let images: SystemImage[] = [
  {
    id: "preview-ubuntu",
    displayName: "Ubuntu 24.04",
    reference: "library/ubuntu:24.04",
    source: "pull",
    upstream: "ubuntu:24.04",
    size: 81264640,
    addedAt: "2026-11-19T02:30:00Z",
  },
  {
    id: "preview-node",
    displayName: "Node.js 22",
    reference: "development/node:22",
    source: "pull",
    upstream: "node:22-bookworm",
    size: 394264576,
    addedAt: "2026-11-18T08:15:00Z",
  },
  {
    id: "preview-workspace",
    displayName: "Workspace v1",
    reference: "team/workspace:v1",
    source: "upload",
    archive: "workspace-v1.tar.gz",
    size: 1258291200,
    addedAt: "2026-11-17T06:00:00Z",
  },
]

const pause = () =>
  new Promise<void>((resolve) => window.setTimeout(resolve, 700))
const snapshot = () => images.map((image) => ({ ...image }))

function normalizeDisplayName(value: string) {
  const name = value.trim()
  if (!name) throw new Error("Display name is required")
  return name
}

export const systemImagesPreview = {
  async list() {
    await pause()
    return snapshot()
  },
  async add(input: {
    displayName: string
    reference: string
    source: "pull" | "upload"
    upstream?: string
    file?: File
  }) {
    await pause()
    const image: SystemImage = {
      id: crypto.randomUUID(),
      reference: input.reference,
      displayName: normalizeDisplayName(input.displayName),
      source: input.source,
      upstream: input.upstream,
      archive: input.file?.name,
      size: null,
      addedAt: new Date().toISOString(),
    }
    images = [image, ...images]
    return snapshot()
  },
  async rename(id: string, displayName: string) {
    await pause()
    const image = images.find((item) => item.id === id)
    if (!image) throw new Error("Image not found")
    image.displayName = normalizeDisplayName(displayName)
    return snapshot()
  },
  async remove(id: string) {
    await pause()
    images = images.filter((image) => image.id !== id)
    return snapshot()
  },
}
