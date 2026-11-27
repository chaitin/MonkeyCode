export const knowledgeFileAccept = ".txt,.md,.markdown,.html,.htm,.svg,.csv,.docx,.xls,.xlsx,.pptx,.pdf,.jpg,.jpeg,.png"
export type ImportStage = "uploading" | "converting" | "saving" | "completed" | "failed" | "canceled"
type ImportReply = {
  status: "pending" | "completed" | "failed"
  import_context?: string
  file_type?: string
  task_context?: string
  document_id?: string
  poll_after_seconds?: number
  error?: string
  retryable?: boolean
  restart_required?: boolean
}
export type FileImport = {
  file: File
  parentID: string | null
  stage: ImportStage
  error?: string
  upload?: { import_context: string; file_type: string }
  task?: string
  uploadKey?: string
  startedAt?: number
  modelID?: string
  documentID?: string
}
type Request = <T>(path: string, options: RequestInit) => Promise<T>
export function validateKnowledgeFile(file: Pick<File, "name" | "size">) {
  if (!knowledgeFileAccept.split(",").includes(`.${file.name.split(".").pop()?.toLowerCase()}`)) throw new Error("importUnsupported")
  if (!file.size || file.size > 32 * 1024 * 1024) throw new Error("importSize")
}
function delay(signal: AbortSignal, milliseconds: number) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve() }, milliseconds)
    signal.addEventListener("abort", abort, { once: true })
  })
}
// No file contents or derived body pass through client JSON. Pending work lives
// only in this page's memory; aborting stops subsequent polling and saving.
export async function importKnowledgeFile(item: FileImport, path: string, request: Request, signal: AbortSignal, changed: () => void, interval = 3000) {
  const image = /\.(jpe?g|png)$/i.test(item.file.name)
  const uploadTimeout = image ? 180_000 : 120_000
  const post = <T>(action: string, body: unknown) => request<T>(`${path}/${action}`, { method: "POST", body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(action === "upload" ? uploadTimeout : 120_000)]) })
  const stage = (value: ImportStage) => { item.stage = value; item.error = undefined; changed() }
  signal.throwIfAborted()
  validateKnowledgeFile(item.file)
  if (item.documentID) return
  if (image && !item.modelID) throw new Error("imageModelRequired")
  item.startedAt ??= Date.now()
  const budget = () => {
    signal.throwIfAborted()
    if (Date.now() - item.startedAt! >= 30 * 60 * 1000) {
      item.task = undefined; item.startedAt = undefined
      throw new Error("importTimeout")
    }
  }
  // An earlier upload or query may have committed before its reply was lost.
  if (item.upload) {
    budget()
    const existing = await post<{ exists: boolean; document_id?: string }>("result", { import_context: item.upload.import_context })
    signal.throwIfAborted()
    if (existing.exists && existing.document_id) { item.documentID = existing.document_id; stage("completed"); return }
  }
  let busyRetries = 0
  while (!item.documentID) {
    budget()
    let reply: ImportReply
    if (item.task) {
      stage("converting")
      reply = await post<ImportReply>("query", { task_context: item.task })
    } else if (item.upload) {
      stage("converting")
      reply = await post<ImportReply>("upload", { import_context: item.upload.import_context, title: item.file.name, parent_id: item.parentID, model_id: item.modelID })
    } else {
      stage("uploading")
      const form = new FormData()
      item.uploadKey ??= Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("")
      form.append("upload_key", item.uploadKey)
      form.append("file", item.file)
      form.append("title", item.file.name)
      if (item.parentID) form.append("parent_id", item.parentID)
      if (item.modelID) form.append("model_id", item.modelID)
      reply = await request<ImportReply>(`${path}/upload`, { method: "POST", body: form, signal: AbortSignal.any([signal, AbortSignal.timeout(uploadTimeout)]) })
    }
    signal.throwIfAborted()
    if (reply.import_context && reply.file_type) item.upload = { import_context: reply.import_context, file_type: reply.file_type }
    if (reply.status === "completed") {
      if (!reply.document_id) throw new Error("importInvalidResult")
      item.documentID = reply.document_id
      stage("completed")
      return
    }
    if (reply.status === "failed") {
      // Capacity and uncertain submissions retry with the same original/ID.
      // In particular, paid image parsing is never replayed automatically.
      if (!image && reply.retryable && item.upload && busyRetries++ < 5) {
        await delay(signal, Math.min(30_000, interval * 2 ** busyRetries) + Math.random() * interval)
        continue
      }
      if (!image && reply.restart_required === true) {
        // A terminal AnyDoc task cannot be restarted with the same task_id.
        // A user-initiated retry uploads a new attempt with a new document_id.
        item.uploadKey = undefined
        item.task = undefined; item.upload = undefined; item.startedAt = undefined
      }
      throw new Error(reply.error || "importFailed")
    }
    if (reply.status !== "pending") throw new Error("importInvalidResult")
    item.task = reply.task_context || item.task
    if (!item.task) throw new Error("importInvalidResult")
    stage("converting")
    await delay(signal, interval)
  }
}
