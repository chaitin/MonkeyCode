import { api } from "./api.ts"
const base = "/api/admin/v1/system-images"
export type SystemImage = {
  id: string
  display_name: string
  added_at: string
  status: "pending" | "importing" | "ready" | "failed"
  upstream: string | null
  is_default: boolean
  progress: {
    stage: string
    completed_bytes: number
    total_bytes: number | null
  }
  error: { code: string; message: string } | null
}
export const systemImages = {
  async list(signal?: AbortSignal) {
    return (await api<{ items: SystemImage[] }>(base, { signal })).items
  },
  pull(display_name: string, upstream: string, key: string) {
    return api<SystemImage>(base + "/pull", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({ display_name, upstream }),
    })
  },
  rename(id: string, display_name: string) {
    return api<SystemImage>(base + "/" + id, {
      method: "PATCH",
      body: JSON.stringify({ display_name }),
    })
  },
  remove(id: string) {
    return api<void>(base + "/" + id, { method: "DELETE" })
  },
  upload(
    displayName: string,
    file: File,
    key: string,
    progress: (value: number | null) => void
  ) {
    return new Promise<SystemImage>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open("POST", base + "/upload")
      xhr.withCredentials = true
      xhr.setRequestHeader("Idempotency-Key", key)
      xhr.responseType = "json"
      xhr.upload.onprogress = (e) =>
        progress(
          e.lengthComputable && e.total > 0
            ? Math.floor((100 * e.loaded) / e.total)
            : null
        )
      xhr.onerror = () => reject(new Error("Network error"))
      xhr.onload = () => {
        if (xhr.status === 202 && xhr.response?.id) resolve(xhr.response)
        else
          reject(new Error(xhr.response?.error?.message || String(xhr.status)))
      }
      const form = new FormData()
      form.append("display_name", displayName)
      form.append("file", file)
      xhr.send(form)
    })
  },
}
