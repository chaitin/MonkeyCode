import { api, ApiError } from "./api.ts"
import { stageDirectoryZip } from "./stream-zip.ts"

export const maxPackage = 2 * 1024 * 1024 * 1024
export const uploadBase = "/api/admin/v1/resource-import-uploads"

export type UploadFile = { name: string; size: number }
export type UploadChunk = { index: number; size: number; sha256: string }
export type ResourceUpload = {
  id: string
  files: UploadFile[]
  total_size: number
  status: "uploading" | "ready" | "imported"
  package_sha256: string
  created_at: string
  expires_at: string
  chunk_size: number
  chunks: UploadChunk[]
}
export type UploadProgress = { chunks: UploadChunk[]; index: number; loaded: number }
export type StagedArchive = { file: File; cleanup?: () => Promise<void> }

const volumeName = /^(.+\.zip)\.([0-9]{3,6})$/i

export function sortArchives(files: File[]): File[] {
  return [...files].sort((a, b) => {
    const left = volumeName.exec(a.name)
    const right = volumeName.exec(b.name)
    if (left && right && left[1].toLowerCase() === right[1].toLowerCase()) return Number(left[2]) - Number(right[2])
    return a.name.localeCompare(b.name)
  })
}

export function validateArchives(files: UploadFile[]): void {
  if (!files.length) throw new Error("请选择 ZIP 或全部分卷")
  if (files.length > 256) throw new Error("最多选择 256 个分卷")
  if (files.some((file) => !file.size)) throw new Error("存在空文件，请重新选择")
  if (files.reduce((sum, file) => sum + file.size, 0) > maxPackage) throw new Error("资源包总大小超过 2 GiB")
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) return
  let base = ""
  files.forEach((file, index) => {
    const match = volumeName.exec(file.name)
    if (!match) throw new Error("请选择普通 ZIP 或 .zip.001、.002 等全部分卷；不支持 .z01 或 7z 分卷")
    if (base && base !== match[1].toLowerCase()) throw new Error("所选分卷来自不同资源包，请重新选择")
    if (Number(match[2]) !== index + 1) throw new Error(`分卷缺失或编号重复：需要 ${match[1]}.${String(index + 1).padStart(3, "0")}`)
    base = match[1].toLowerCase()
  })
}

export function matchArchives(files: UploadFile[], expected: UploadFile[]): boolean {
  return files.length === expected.length && files.every((file, index) => file.name === expected[index].name && file.size === expected[index].size)
}

export function archiveChunk(files: Blob[], index: number, chunkSize: number): Blob {
  let offset = index * chunkSize
  let remaining = chunkSize
  const parts: Blob[] = []
  for (const file of files) {
    if (offset >= file.size) {
      offset -= file.size
      continue
    }
    const size = Math.min(file.size - offset, remaining)
    parts.push(file.slice(offset, offset + size))
    remaining -= size
    if (remaining === 0) break
    offset = 0
  }
  return new Blob(parts, { type: "application/octet-stream" })
}

export function uploadedFileBytes(files: UploadFile[], chunkSize: number, progress: UploadProgress): number[] {
  const ranges = progress.chunks.map((chunk) => [chunk.index * chunkSize, chunk.index * chunkSize + chunk.size])
  if (progress.loaded > 0) ranges.push([progress.index * chunkSize, progress.index * chunkSize + progress.loaded])
  let offset = 0
  return files.map((file) => {
    const size = Math.min(file.size, ranges.reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, offset + file.size) - Math.max(start, offset)), 0))
    offset += file.size
    return size
  })
}

async function chunkSHA(blob: Blob): Promise<string> {
  const data = await blob.arrayBuffer()
  const subtle = globalThis.crypto?.subtle
  const hash = subtle
    ? new Uint8Array(await subtle.digest("SHA-256", data))
    : (await import("@noble/hashes/sha2.js")).sha256(new Uint8Array(data))
  return "sha256:" + Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function putChunk(path: string, blob: Blob, sha: string, signal: AbortSignal, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", abort)
      if (error) reject(error)
      else resolve()
    }
    xhr.open("PUT", path)
    xhr.withCredentials = true
    xhr.setRequestHeader("Content-Type", "application/octet-stream")
    xhr.setRequestHeader("X-Content-SHA256", sha)
    xhr.upload.onprogress = (event) => onProgress(event.loaded)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return finish()
      let message = "上传失败，请重试"
      try { message = JSON.parse(xhr.responseText)?.error?.message ?? message } catch { /* 保留网络错误提示。 */ }
      finish(new ApiError(xhr.status, message))
    }
    xhr.onerror = () => finish(new Error("网络中断，已保留上传进度，请重试"))
    xhr.onabort = () => finish(new DOMException("上传已暂停", "AbortError"))
    signal.addEventListener("abort", abort, { once: true })
    xhr.send(blob)
  })
}

export async function uploadArchives(
  upload: ResourceUpload,
  files: File[],
  signal: AbortSignal,
  onProgress: (progress: UploadProgress) => void,
): Promise<ResourceUpload> {
  validateArchives(files)
  if (!matchArchives(files, upload.files)) throw new Error("文件与当前上传任务不一致，请重新选择原来的全部分卷")
  const chunks = [...upload.chunks]
  const count = Math.ceil(upload.total_size / upload.chunk_size)
  for (let index = 0; index < count; index++) {
    signal.throwIfAborted()
    const blob = archiveChunk(files, index, upload.chunk_size)
    const sha = await chunkSHA(blob)
    signal.throwIfAborted()
    const existing = chunks.find((chunk) => chunk.index === index)
    if (existing) {
      if (existing.sha256 !== sha) throw new Error("本地文件内容与已上传部分不同，请选择原来的资源包，或放弃任务后重新上传")
      continue
    }
    onProgress({ chunks: [...chunks], index, loaded: 0 })
    await putChunk(`${uploadBase}/${upload.id}/chunks/${index}`, blob, sha, signal, (loaded) => onProgress({ chunks: [...chunks], index, loaded }))
    chunks.push({ index, size: blob.size, sha256: sha })
    onProgress({ chunks: [...chunks], index: -1, loaded: 0 })
  }
  return { ...upload, chunks }
}

export async function createUpload(files: File[], signal: AbortSignal): Promise<ResourceUpload> {
  validateArchives(files)
  return api<ResourceUpload>(uploadBase, { method: "POST", signal, body: JSON.stringify({ files: files.map(({ name, size }) => ({ name, size })) }) })
}

export async function archiveDirectory(list: FileList): Promise<StagedArchive> {
  if (list.length === 0) throw new Error("目录没有文件")
  const entries: [string, File][] = []
  for (const file of Array.from(list)) {
    const relativePath = file.webkitRelativePath.split("/").slice(1).join("/")
    if (!relativePath || relativePath.split("/").some((part) => part === ".." || !part)) throw new Error("目录内存在无效路径")
    entries.push([relativePath, file])
  }
  const byPath = new Map(entries.sort(([a], [b]) => a.localeCompare(b)))
  if (byPath.size > 5000) throw new Error("目录文件数量超限")
  const size = [...byPath.values()].reduce((sum, file) => sum + file.size, 0)
  if (size > maxPackage) throw new Error("目录文件总大小超过 2 GiB，请选择现成 ZIP")
  if (!navigator.storage?.getDirectory) {
    if (size > 200 * 1024 * 1024) throw new Error("当前浏览器不支持大目录磁盘暂存，请选择现成 ZIP")
    const { default: JSZip } = await import("jszip")
    const zip = new JSZip()
    for (const [path, file] of byPath) zip.file(path, file, { date: new Date("1980-01-01T00:00:00Z") })
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" })
    if (blob.size > maxPackage) throw new Error("资源包超过 2 GiB")
    return { file: new File([blob], "release.zip", { type: "application/zip" }) }
  }
  const staged = await stageDirectoryZip(byPath, maxPackage)
  return { ...staged, file: new File([staged.file], "release.zip", { type: "application/zip" }) }
}
