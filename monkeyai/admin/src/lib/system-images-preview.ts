// 前端预览数据源；接入后端时替换此模块，不直接访问 Registry。
export type SystemImage = {
  id: string
  reference: string
  source: "pull" | "upload"
  upstream?: string
  archive?: string
  size: number | null
  updatedAt: string
}

export type RepullPhase = "pulling" | "importing"

let images: SystemImage[] = [
  {
    id: "preview-ubuntu",
    reference: "library/ubuntu:24.04",
    source: "pull",
    upstream: "ubuntu:24.04",
    size: 81264640,
    updatedAt: "2026-11-19T02:30:00Z",
  },
  {
    id: "preview-node",
    reference: "development/node:22",
    source: "pull",
    upstream: "node:22-bookworm",
    size: 394264576,
    updatedAt: "2026-11-18T08:15:00Z",
  },
  {
    id: "preview-workspace",
    reference: "team/workspace:v1",
    source: "upload",
    archive: "workspace-v1.tar.gz",
    size: 1258291200,
    updatedAt: "2026-11-17T06:00:00Z",
  },
]

const pause = () =>
  new Promise<void>((resolve) => window.setTimeout(resolve, 700))
const snapshot = () => images.map((image) => ({ ...image }))

export const systemImagesPreview = {
  async list() {
    await pause()
    return snapshot()
  },
  async add(input: {
    reference: string
    source: "pull" | "upload"
    upstream?: string
    file?: File
  }) {
    await pause()
    const image: SystemImage = {
      id: crypto.randomUUID(),
      reference: input.reference,
      source: input.source,
      upstream: input.upstream,
      archive: input.file?.name,
      size: null,
      updatedAt: new Date().toISOString(),
    }
    images = [image, ...images]
    return snapshot()
  },
  async remove(id: string) {
    await pause()
    images = images.filter((image) => image.id !== id)
    return snapshot()
  },
  async repull(id: string, onPhase?: (phase: RepullPhase) => void) {
    onPhase?.("pulling")
    await pause()
    onPhase?.("importing")
    await pause()
    images = images.map((image) =>
      image.id === id
        ? {
            ...image,
            size: null,
            updatedAt: new Date().toISOString(),
          }
        : image
    )
    return snapshot()
  },
}
