import { useCallback, useEffect, useState, type InputHTMLAttributes } from "react"

import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const base = "/api/admin/v1/resource-imports"
const maxPackage = 100 * 1024 * 1024

type Change = {
  type: string
  slug: string
  name: string
  action: "create" | "update" | "skip" | "retire" | "restore"
  warnings?: string[]
  source_sha256?: string
  storage_sha256?: string
}

type Preview = {
  publisher: string
  release_id: string
  version: number
  package_sha256: string
  plan_digest: string
  changes: Change[]
  ignored_static: string[]
  requires_confirmation: boolean
  already_imported: boolean
}

type Batch = {
  id: string
  publisher: string
  version: number
  status: string
  result_counts: Record<string, number>
  created_at: string
}

async function archiveDirectory(list: FileList) {
  if (list.length === 0 || list.length > 5000) {
    throw new Error("目录文件数量超限")
  }
  const files = Array.from(list)
  if (files.reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024) {
    throw new Error("目录文件总大小超限")
  }
  const byPath = new Map<string, File>()
  for (const file of files) {
    const parts = file.webkitRelativePath.split("/")
    const relativePath = parts.slice(1).join("/")
    if (!relativePath || relativePath.split("/").some((part) => part === ".." || !part)) {
      throw new Error("目录内存在无效路径")
    }
    byPath.set(relativePath, file)
  }
  const checksum = byPath.get("CHECKSUMS.sha256")
  if (!checksum) throw new Error("目录缺少 CHECKSUMS.sha256")
  const declared = (await checksum.text()).trim().split("\n").map((line) => line.trimEnd().slice(66))
  const { default: JSZip } = await import("jszip")
  const zip = new JSZip()
  for (const path of new Set(["release.json", "manifest.json", "CHECKSUMS.sha256", ...declared])) {
    const file = byPath.get(path)
    if (!file || path.split("/").some((part) => part === ".." || !part)) {
      throw new Error(`目录缺少发布包声明的文件：${path}`)
    }
    zip.file(path, file)
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" })
  if (blob.size > maxPackage) {
    throw new Error("资源包超过 100 MiB")
  }
  return new File([blob], "release.zip", { type: "application/zip" })
}

export function ResourceImportsPage() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [history, setHistory] = useState<Batch[]>([])
  const [modes, setModes] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [normalization, setNormalization] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const reload = useCallback(() => {
    void api<{ items: Batch[] }>(base)
      .then((response) => setHistory(response.items))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "读取记录失败"))
  }, [])

  useEffect(() => { reload() }, [reload])

  const options = (confirmFinal: boolean) => ({
    authorization_modes: modes,
    accept_normalization: normalization,
    confirm_final: confirmFinal,
  })

  const upload = async (apply: boolean) => {
    if (!file || busy) return
    setBusy(true)
    setError("")
    try {
      const form = new FormData()
      form.set("package", file)
      form.set("options", JSON.stringify(options(apply)))
      if (apply && preview) {
        form.set("package_sha256", preview.package_sha256)
        form.set("plan_digest", preview.plan_digest)
      }
      const result = await api<Preview>(apply ? base : `${base}/preview`, { method: "POST", body: form })
      if (apply) {
        setFile(null)
        setPreview(null)
        setConfirmed(false)
        setNormalization(false)
        reload()
      } else {
        setPreview(result)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导入失败")
      if (apply) setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const needsNormalization = preview?.changes.some((item) => item.type === "skill" && (item.warnings?.length ?? 0) > 0)
  const changed = preview?.changes.filter((item) => item.action !== "skip") ?? []

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <Card>
        <CardHeader><CardTitle>导入资源包</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">上传的资源包将作为该 publisher 的最终 Agent 资源集合。旧资源若不在包内，将在预览确认后停用；独立静态资源仅校验、不导入。</p>
          <div className="flex flex-wrap items-center gap-4">
            <label className="space-y-1 text-sm">选择 ZIP
              <input accept=".zip,application/zip" type="file" onChange={(event) => {
                setFile(event.target.files?.[0] ?? null); setPreview(null); setConfirmed(false)
              }} />
            </label>
            <label className="space-y-1 text-sm">或选择解压目录
              <input type="file" {...({ webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>)} onChange={async (event) => {
                if (!event.target.files) return
                try {
                  const packed = await archiveDirectory(event.target.files)
                  setFile(packed); setPreview(null); setConfirmed(false); setError("")
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : "目录打包失败")
                }
              }} />
            </label>
          </div>
          {file && <p className="text-sm">已选择：{file.name}（{(file.size / 1024 / 1024).toFixed(2)} MiB）</p>}
          <Button type="button" disabled={!file || busy} onClick={() => { void upload(false) }}>校验并预览</Button>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
      {preview && <Card>
        <CardHeader><CardTitle>预览 · {preview.publisher} / v{preview.version}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {preview.already_imported && <p>此发布版本已经导入。</p>}
          {preview.ignored_static.length > 0 && <div className="text-sm">已校验但忽略 {preview.ignored_static.length} 个静态资源：{preview.ignored_static.join("、")}</div>}
          <div className="space-y-2">
            {preview.changes.map((item) => <div key={`${item.type}:${item.slug}`} className="rounded border p-2 text-sm">
              <span className="font-medium">{item.action.toUpperCase()}</span> · {item.type} · {item.name}（{item.slug}）
              {item.warnings?.map((warning) => <p key={warning} className="text-amber-700">{warning}</p>)}
              {(item.warnings?.length ?? 0) > 0 && item.storage_sha256 && <p className="break-all text-xs text-muted-foreground">原产物：{item.source_sha256} → 存储包：{item.storage_sha256}</p>}
              {item.type === "connector" && item.action !== "retire" && <label className="ml-4">认证归属：
                <select value={modes[item.slug] ?? "independent"} onChange={(event) => {
                  setModes((old) => ({ ...old, [item.slug]: event.target.value }))
                  setPreview(null); setConfirmed(false)
                }}>
                  <option value="independent">独立凭证</option><option value="centralized">集中凭证</option>
                </select>
              </label>}
            </div>)}
          </div>
          {changed.some((item) => item.action === "retire") && <p className="font-medium text-amber-700">此操作将停用上表中的移除项；恢复项的旧授权或凭证可能重新生效。</p>}
          {needsNormalization && <label className="block text-sm"><input checked={normalization} type="checkbox" onChange={(event) => setNormalization(event.target.checked)} /> 我已确认上述技能 frontmatter 规范化（名称或描述引号）</label>}
          <label className="block text-sm"><input checked={confirmed} type="checkbox" onChange={(event) => setConfirmed(event.target.checked)} /> 我确认此包是该 publisher 的最终 Agent 资源清单，缺失项将被停用</label>
          <Button type="button" disabled={busy || !confirmed || (needsNormalization && !normalization)} onClick={() => { void upload(true) }}>确认导入</Button>
        </CardContent>
      </Card>}
      <Card>
        <CardHeader><CardTitle>导入记录</CardTitle></CardHeader>
        <CardContent className="space-y-2">{history.map((batch) => <div key={batch.id} className="rounded border p-2 text-sm">
          {batch.publisher} · v{batch.version} · {batch.status} · {new Date(batch.created_at).toLocaleString()} · {JSON.stringify(batch.result_counts)}
        </div>)}</CardContent>
      </Card>
    </main>
  )
}
