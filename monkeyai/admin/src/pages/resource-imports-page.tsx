import { useEffect, useState, type InputHTMLAttributes } from "react"
import { useTranslation } from "react-i18next"

import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const base = "/api/admin/v1/resource-imports"
const maxPackage = 100 * 1024 * 1024

const counts = [
  ["create", "新增"],
  ["update", "更新"],
  ["skip", "跳过"],
  ["retire", "退役"],
  ["restore", "恢复"],
  ["ignored_static", "忽略静态资源"],
] as const

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
  release_id: string
  version: number
  status: string
  result_counts: Record<string, number>
  created_at: string
}

type HistoryPage = {
  items: Batch[]
  next_cursor: string | null
}

type HistoryRequest = {
  key: string
  page?: HistoryPage
  error?: string
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
  const { i18n } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [request, setRequest] = useState<HistoryRequest | null>(null)
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [active, setActive] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [modes, setModes] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [normalization, setNormalization] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const cursor = cursors[active]
  const historyKey = `${refresh}:${cursor ?? ""}`
  const current = request?.key === historyKey ? request : null
  const history = current?.page ?? null
  const historyError = current?.error ?? ""
  const historyLoading = current === null

  useEffect(() => {
    let activeRequest = true
    const key = `${refresh}:${cursor ?? ""}`
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
    void api<HistoryPage>(`${base}${query}`)
      .then((page) => { if (activeRequest) setRequest({ key, page }) })
      .catch((reason: unknown) => {
        if (activeRequest) setRequest({ key, error: reason instanceof Error ? reason.message : "读取记录失败" })
      })
    return () => { activeRequest = false }
  }, [cursor, refresh])

  const closeDialog = (open: boolean) => {
    if (busy && !open) return
    setDialogOpen(open)
    if (!open) {
      setFile(null)
      setPreview(null)
      setModes({})
      setConfirmed(false)
      setNormalization(false)
      setError("")
    }
  }

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
        setDialogOpen(false)
        setFile(null)
        setPreview(null)
        setModes({})
        setConfirmed(false)
        setNormalization(false)
        setCursors([undefined])
        setActive(0)
        setRefresh((value) => value + 1)
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
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { dateStyle: "short", timeStyle: "short" })

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 p-4 pt-px md:h-[calc(100svh-5rem)] md:flex-none md:overflow-hidden">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">资源包导入记录</h1>
        <Button type="button" onClick={() => setDialogOpen(true)}>导入资源包</Button>
      </div>
      <Card className="min-h-0 flex-1">
        <CardContent className="min-h-0 flex-1 gap-4 px-0">
          {historyError && (
            <div role="alert" className="mx-(--card-spacing) flex items-center justify-between gap-4 rounded-lg border border-destructive/30 p-4 text-sm text-destructive">
              <span>{historyError}</span>
              <Button size="sm" variant="outline" onClick={() => setRefresh((value) => value + 1)}>重试</Button>
            </div>
          )}
          {historyLoading && !history && <p role="status" className="px-(--card-spacing) text-sm text-muted-foreground">加载中…</p>}
          {history && history.items.length === 0 && !historyLoading && <p className="px-(--card-spacing) text-sm text-muted-foreground">暂无导入记录</p>}
          {history && history.items.length > 0 && (
            <ScrollArea horizontal className="min-h-0 min-w-0 flex-1 [&_[data-slot=table-container]]:h-full [&_[data-slot=table-container]]:overflow-visible">
              <Table className="[&_th:first-child]:ps-(--card-spacing) [&_td:first-child]:ps-(--card-spacing) [&_th:last-child]:pe-(--card-spacing) [&_td:last-child]:pe-(--card-spacing)">
                <TableHeader className="sticky top-0 z-10 bg-card [&_th]:shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-b-0">
                  <TableRow>
                    {["导入时间", "发布者", "版本", "发布 ID", "状态", "资源变更"].map((column) => <TableHead key={column}>{column}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.items.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell className="whitespace-nowrap">{dateFormat.format(new Date(batch.created_at))}</TableCell>
                      <TableCell className="font-medium">{batch.publisher}</TableCell>
                      <TableCell>v{batch.version}</TableCell>
                      <TableCell className="font-mono" title={batch.release_id}>{batch.release_id.slice(0, 8)}…</TableCell>
                      <TableCell><Badge variant={batch.status === "succeeded" ? "successOutline" : "destructiveOutline"}>{batch.status === "succeeded" ? "成功" : "失败"}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {counts.map(([key, label]) => `${label} ${batch.result_counts[key] ?? 0}`).join(" · ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
          {history && (
            <div className="flex justify-end gap-2 px-(--card-spacing)">
              <Button size="sm" variant="outline" disabled={active === 0 || historyLoading} onClick={() => setActive(active - 1)}>上一页</Button>
              <Button size="sm" variant="outline" disabled={!history.next_cursor || historyLoading || !!historyError} onClick={() => {
                const next = history.next_cursor
                if (next) {
                  setCursors((current) => [...current.slice(0, active + 1), next])
                  setActive(active + 1)
                }
              }}>下一页</Button>
              <Button size="sm" variant="outline" disabled={historyLoading} onClick={() => setRefresh((value) => value + 1)}>刷新</Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog open={dialogOpen} onOpenChange={closeDialog}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl" closeLabel="关闭">
          <DialogHeader><DialogTitle>导入资源包</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">上传的资源包将作为该 publisher 的最终 Agent 资源集合。旧资源若不在包内，将在预览确认后停用；独立静态资源仅校验、不导入。</p>
          <div className="flex flex-wrap items-center gap-4">
            <label className="space-y-1 text-sm">选择 ZIP
              <input accept=".zip,application/zip" type="file" onChange={(event) => {
                setFile(event.target.files?.[0] ?? null); setPreview(null); setConfirmed(false); setModes({}); setNormalization(false)
              }} />
            </label>
            <label className="space-y-1 text-sm">或选择解压目录
              <input type="file" {...({ webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>)} onChange={async (event) => {
                if (!event.target.files) return
                try {
                  const packed = await archiveDirectory(event.target.files)
                  setFile(packed); setPreview(null); setConfirmed(false); setModes({}); setNormalization(false); setError("")
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : "目录打包失败")
                }
              }} />
            </label>
          </div>
          {file && <p className="text-sm">已选择：{file.name}（{(file.size / 1024 / 1024).toFixed(2)} MiB）</p>}
          <Button type="button" className="w-fit" disabled={!file || busy} onClick={() => { void upload(false) }}>校验并预览</Button>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {preview && <div className="space-y-4 border-t pt-4">
            <h2 className="font-medium">预览 · {preview.publisher} / v{preview.version}</h2>
            {preview.already_imported && <p>此发布版本已经导入。</p>}
            {preview.ignored_static.length > 0 && <p className="text-sm">已校验但忽略 {preview.ignored_static.length} 个静态资源：{preview.ignored_static.join("、")}</p>}
            <div className="max-h-80 space-y-2 overflow-y-auto">
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
          </div>}
        </DialogContent>
      </Dialog>
    </section>
  )
}
