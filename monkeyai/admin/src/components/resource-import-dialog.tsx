import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes } from "react"
import { api } from "@/lib/api"
import { archiveDirectory, createUpload, matchArchives, sortArchives, uploadArchives, uploadBase, uploadedFileBytes, validateArchives, type ResourceUpload, type StagedArchive, type UploadProgress } from "@/lib/resource-upload"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const base = "/api/admin/v1/resource-imports"
const actions = { create: "新增", update: "更新", skip: "跳过", retire: "停用", restore: "恢复" } as const
const types = { skill: "技能", rule: "规则", connector: "连接器", expert: "专家" } as const

type Change = {
  type: string
  slug: string
  name: string
  action: keyof typeof actions
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
  already_imported: boolean
}
type Phase = "idle" | "packing" | "uploading" | "checking" | "previewing" | "applying"

function sizeLabel(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / 1024 / 1024).toFixed(2)} MiB`
}
function message(reason: unknown) { return reason instanceof Error ? reason.message : "导入失败，请重试" }

export function ResourceImportDialog({ initialUpload, onClose, onChanged, onImported }: {
  initialUpload: ResourceUpload | null
  onClose: () => void
  onChanged: () => void
  onImported: () => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [upload, setUpload] = useState(initialUpload)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [stale, setStale] = useState(false)
  const [phase, setPhase] = useState<Phase>(initialUpload?.status === "ready" ? "previewing" : "idle")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState(initialUpload?.status === "uploading" ? "请重新选择原来的 ZIP 或全部分卷，已上传的部分会自动跳过。" : "")
  const [progress, setProgress] = useState<UploadProgress>({ chunks: initialUpload?.chunks ?? [], index: -1, loaded: 0 })
  const [modes, setModes] = useState<Record<string, string>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [normalization, setNormalization] = useState(false)
  const [typeFilter, setTypeFilter] = useState("all")
  const [actionFilter, setActionFilter] = useState("changed")
  const archiveInputRef = useRef<HTMLInputElement>(null)
  const directoryInputRef = useRef<HTMLInputElement>(null)
  const cleanupRef = useRef<StagedArchive["cleanup"]>(undefined)
  const controllerRef = useRef<AbortController | null>(null)
  const busy = phase !== "idle"

  useEffect(() => () => {
    controllerRef.current?.abort()
    if (cleanupRef.current) void cleanupRef.current().catch(() => {})
  }, [])

  useEffect(() => {
    if (initialUpload?.status !== "ready") return
    const controller = new AbortController()
    controllerRef.current = controller
    void api<Preview>(`${base}/preview`, { method: "POST", signal: controller.signal, body: JSON.stringify({ upload_id: initialUpload.id, options: {} }) })
      .then(setPreview)
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(message(reason)) })
      .finally(() => { if (!controller.signal.aborted) setPhase("idle") })
    return () => controller.abort()
  }, [initialUpload])

  const selectionError = useMemo(() => {
    if (!files.length) return ""
    try {
      validateArchives(files)
      if (upload && !matchArchives(files, upload.files)) return "文件与当前上传任务不一致，请重新选择原来的 ZIP 或全部分卷"
      return ""
    } catch (reason) { return message(reason) }
  }, [files, upload])
  const listedFiles = upload?.files ?? files
  const total = upload?.total_size ?? files.reduce((sum, file) => sum + file.size, 0)
  const fileBytes = uploadedFileBytes(listedFiles, upload?.chunk_size ?? 64 * 1024 * 1024, progress)
  const uploaded = fileBytes.reduce((sum, size) => sum + size, 0)
  const percent = total ? Math.min(100, Math.floor(uploaded / total * 100)) : 0
  const step = preview ? 2 : upload || busy ? 1 : 0
  const needsNormalization = preview?.changes.some((item) => item.type === "skill" && (item.warnings?.length ?? 0) > 0)
  const filteredChanges = preview?.changes.filter((item) => (typeFilter === "all" || item.type === typeFilter) && (actionFilter === "all" || (actionFilter === "changed" ? item.action !== "skip" : item.action === actionFilter))) ?? []
  const retired = preview?.changes.filter((item) => item.action === "retire").length ?? 0

  const cleanupStaged = () => {
    const cleanup = cleanupRef.current
    cleanupRef.current = undefined
    if (cleanup) void cleanup().catch(() => {})
  }
  const close = () => {
    if (phase === "applying" || phase === "packing") return
    controllerRef.current?.abort()
    onChanged()
    onClose()
  }
  const selectFiles = (selected: File[], append = false) => {
    if (busy || (upload && upload.status !== "uploading")) return
    cleanupStaged()
    const next = append ? [...new Map([...files, ...selected].map((file) => [file.name, file])).values()] : selected
    setFiles(sortArchives(next))
    setError("")
    setNotice("")
  }
  const selectDirectory = async (list: FileList) => {
    setPhase("packing")
    setError("")
    setNotice("")
    cleanupStaged()
    try {
      const staged = await archiveDirectory(list)
      cleanupRef.current = staged.cleanup
      setFiles([staged.file])
    } catch (reason) { setError(message(reason)) }
    finally { setPhase("idle") }
  }
  const options = (confirm = false) => ({ authorization_modes: modes, accept_normalization: normalization, confirm_final: confirm })

  const run = async (apply: boolean) => {
    if (busy) return
    const controller = new AbortController()
    controllerRef.current = controller
    setError("")
    setNotice("")
    try {
      let current = upload
      if (apply) {
        if (!current || !preview || stale) return
        setPhase("applying")
        await api<Preview>(base, { method: "POST", signal: controller.signal, body: JSON.stringify({ upload_id: current.id, options: options(true), package_sha256: preview.package_sha256, plan_digest: preview.plan_digest }) })
        onImported()
        return
      }
      if (!current || current.status === "uploading") {
        setPhase("uploading")
        if (!current) {
          current = await createUpload(files, controller.signal)
          setUpload(current)
          onChanged()
        } else {
          current = await api<ResourceUpload>(`${uploadBase}/${current.id}`, { signal: controller.signal })
          if (current.status === "imported") { onImported(); return }
          setUpload(current)
        }
        setProgress({ chunks: current.chunks, index: -1, loaded: 0 })
        if (current.status === "uploading") {
          current = await uploadArchives(current, files, controller.signal, setProgress)
          setUpload(current)
          setPhase("checking")
          current = await api<ResourceUpload>(`${uploadBase}/${current.id}/complete`, { method: "POST", signal: controller.signal })
          setUpload(current)
          onChanged()
        }
      }
      setPhase("previewing")
      const result = await api<Preview>(`${base}/preview`, { method: "POST", signal: controller.signal, body: JSON.stringify({ upload_id: current.id, options: options() }) })
      setPreview(result)
      setStale(false)
      setConfirmed(false)
    } catch (reason) {
      if (controller.signal.aborted) setNotice("上传已暂停，已上传的部分会保留，可稍后继续。")
      else setError(message(reason))
      if (apply) { setStale(true); setConfirmed(false) }
      onChanged()
    } finally {
      setProgress((value) => ({ ...value, index: -1, loaded: 0 }))
      setPhase("idle")
    }
  }

  const restart = async () => {
    if (busy) return
    setError("")
    try {
      if (upload) await api(`${uploadBase}/${upload.id}`, { method: "DELETE" })
      cleanupStaged()
      setUpload(null)
      setFiles([])
      setPreview(null)
      setStale(false)
      setProgress({ chunks: [], index: -1, loaded: 0 })
      setConfirmed(false)
      setNormalization(false)
      setModes({})
      setNotice("")
      onChanged()
    } catch (reason) { setError(message(reason)) }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className={`max-h-[90vh] overflow-y-auto ${preview ? "sm:max-w-3xl" : "sm:max-w-xl"}`} closeLabel="关闭">
        <DialogHeader>
          <DialogTitle>导入资源包</DialogTitle>
          <p className="text-sm text-muted-foreground">支持普通 ZIP、按字节拆分的 .zip.001 等全部分卷，或包含 manifest.json 的解压目录。总大小不超过 2 GiB。</p>
        </DialogHeader>
        <ol aria-label="导入步骤" className="flex items-center gap-3 text-sm">
          {["选择文件", "上传解析", "确认导入"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={`flex items-center gap-2 ${step === index ? "font-medium text-foreground" : "text-muted-foreground"}`}><span className={`flex size-6 items-center justify-center rounded-full border ${step === index ? "border-primary bg-primary text-primary-foreground" : ""}`}>{index + 1}</span>{label}</li>)}
        </ol>
        {!preview && <>
          <Input ref={archiveInputRef} type="file" multiple className="hidden" aria-label="选择 ZIP 或全部分卷" disabled={busy} onChange={(event) => {
            const selected = Array.from(event.currentTarget.files ?? [])
            if (selected.length) selectFiles(selected, !upload)
            event.currentTarget.value = ""
          }} />
          <Input ref={directoryInputRef} type="file" className="hidden" aria-label="选择解压目录" disabled={busy} {...({ webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>)} onChange={(event) => {
            const list = event.currentTarget.files
            if (list?.length) void selectDirectory(list)
            event.currentTarget.value = ""
          }} />
          {(!upload || upload.status === "uploading") && <div className="space-y-3 rounded-lg border border-dashed p-5" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
            event.preventDefault()
            if (event.dataTransfer.files.length) selectFiles(Array.from(event.dataTransfer.files), !upload)
          }}>
            <p className="text-sm">{upload ? "重新选择原来的 ZIP 或全部分卷，继续上传" : "拖入 ZIP 或全部分卷，自动按编号排序"}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => archiveInputRef.current?.click()}>{files.length && !upload ? "补充文件" : "选择 ZIP / 全部分卷"}</Button>
              <Button type="button" variant="outline" disabled={busy || files.length > 0} onClick={() => directoryInputRef.current?.click()}>选择解压目录</Button>
            </div>
          </div>}
          {listedFiles.length > 0 && <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border p-3">
            {listedFiles.map((file, index) => <div key={`${file.name}:${index}`} className="flex min-w-0 items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
              <span className="whitespace-nowrap text-muted-foreground">{sizeLabel(file.size)}</span>
              {upload ? <span className="w-20 shrink-0 text-end text-xs">{fileBytes[index] >= file.size ? "已上传" : fileBytes[index] > 0 ? `${Math.floor(fileBytes[index] / file.size * 100)}%` : "等待上传"}</span> : <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={`移除 ${file.name}`} onClick={() => setFiles((value) => value.filter((_, at) => at !== index))}>移除</Button>}
            </div>)}
          </div>}
          {listedFiles.length > 0 && <p className="text-sm text-muted-foreground">共 {listedFiles.length} 个文件 · {sizeLabel(total)}</p>}
          {upload && <div className="space-y-2" role="status" aria-live="polite">
            <div className="flex justify-between text-sm"><span>{phase === "checking" ? "正在检查资源包完整性…" : phase === "previewing" ? "正在解析资源并计算变更…" : phase === "uploading" ? "正在上传并核对文件…" : upload.status === "ready" ? "上传完成，可继续预览" : "已保留上传进度"}</span><span>{percent}%</span></div>
            <progress className="h-2 w-full accent-primary" aria-label="资源包上传进度" max={100} value={percent} />
            <p className="text-xs text-muted-foreground">{sizeLabel(uploaded)} / {sizeLabel(total)} · 未完成任务保留 24 小时</p>
          </div>}
          {phase === "packing" && <p role="status" className="text-sm">正在打包目录…</p>}
        </>}
        {(error || selectionError) && <p role="alert" className="break-words text-sm text-destructive">{error || selectionError}</p>}
        {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
        {!preview && <DialogFooter className="flex-wrap">
          {upload && <Button type="button" variant="outline" disabled={busy} onClick={() => { void restart() }}>放弃任务并重新选择</Button>}
          {!upload && files.length > 0 && <Button type="button" variant="outline" disabled={busy} onClick={() => { cleanupStaged(); setFiles([]); setError("") }}>清空选择</Button>}
          <Button type="button" variant="outline" disabled={phase === "packing" || phase === "applying"} onClick={close}>{upload ? "稍后继续" : "取消"}</Button>
          {phase === "uploading" ? <Button type="button" variant="outline" onClick={() => controllerRef.current?.abort()}>暂停上传</Button> : <Button type="button" disabled={busy || Boolean(selectionError) || (!files.length && upload?.status !== "ready")} onClick={() => { void run(false) }}>{busy ? "解析中…" : upload?.status === "ready" ? "解析并预览" : upload ? "继续上传并预览" : "上传并预览"}</Button>}
        </DialogFooter>}
        {preview && <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">{preview.publisher} / v{preview.version}</h2><span className="text-sm text-muted-foreground">共 {preview.changes.length} 项资源</span></div>
          <div className="flex flex-wrap gap-2">{Object.entries(actions).map(([action, label]) => <Badge key={action} variant={action === "retire" ? "destructiveOutline" : "outline"}>{label} {preview.changes.filter((item) => item.action === action).length}</Badge>)}</div>
          {preview.already_imported && <p role="status" className="text-sm">此发布版本已经导入。</p>}
          {preview.ignored_static.length > 0 && <p className="text-sm text-muted-foreground">已忽略 {preview.ignored_static.length} 个静态资源</p>}
          <div className="flex flex-wrap gap-2">
            <Select value={typeFilter} onValueChange={(value) => { if (value) setTypeFilter(value) }}><SelectTrigger className="w-36" aria-label="筛选资源类型"><SelectValue>{typeFilter === "all" ? "全部类型" : types[typeFilter as keyof typeof types]}</SelectValue></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">全部类型</SelectItem>{Object.entries(types).map(([type, label]) => <SelectItem key={type} value={type}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select>
            <Select value={actionFilter} onValueChange={(value) => { if (value) setActionFilter(value) }}><SelectTrigger className="w-36" aria-label="筛选变更动作"><SelectValue>{actionFilter === "all" ? "全部动作" : actionFilter === "changed" ? "仅显示变更" : actions[actionFilter as keyof typeof actions]}</SelectValue></SelectTrigger><SelectContent><SelectGroup><SelectItem value="changed">仅显示变更</SelectItem><SelectItem value="all">全部动作</SelectItem>{Object.entries(actions).map(([action, label]) => <SelectItem key={action} value={action}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select>
          </div>
          <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border p-2">
            {!filteredChanges.length && <p className="p-3 text-sm text-muted-foreground">当前筛选下没有资源变更</p>}
            {filteredChanges.map((item) => <div key={`${item.type}:${item.slug}`} className="rounded-md bg-muted/50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-all font-medium">{item.name} <span className="font-normal text-muted-foreground">· {types[item.type as keyof typeof types] ?? item.type} / {item.slug}</span></span><Badge variant={item.action === "retire" ? "destructiveOutline" : item.action === "restore" ? "successOutline" : "outline"}>{actions[item.action]}</Badge></div>
              {item.warnings?.map((warning) => <p key={warning} className="mt-1 text-warning">{warning}</p>)}
              {(item.warnings?.length ?? 0) > 0 && item.storage_sha256 && <p className="mt-1 break-all text-xs text-muted-foreground">原产物：{item.source_sha256} → 存储包：{item.storage_sha256}</p>}
              {item.type === "connector" && item.action !== "retire" && <div className="mt-2 flex items-center gap-2"><span>认证归属：</span><Select disabled={busy} value={modes[item.slug] ?? "independent"} onValueChange={(value) => {
                if (!value) return
                setModes((old) => ({ ...old, [item.slug]: value }))
                setStale(true)
                setConfirmed(false)
              }}><SelectTrigger size="sm" aria-label={`${item.name}认证归属`}><SelectValue>{modes[item.slug] === "centralized" ? "集中凭证" : "独立凭证"}</SelectValue></SelectTrigger><SelectContent><SelectGroup><SelectItem value="independent">独立凭证</SelectItem><SelectItem value="centralized">集中凭证</SelectItem></SelectGroup></SelectContent></Select></div>}
            </div>)}
          </div>
          {stale && <p role="status" className="text-sm text-warning">选项或资源状态已变化，请重新预览后确认。</p>}
          {retired > 0 && <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">本次将停用 {retired} 项资源，请核对上方停用明细。恢复资源时，仍有效的旧授权或凭证可能重新生效。</p>}
          {!preview.already_imported && <>
            {needsNormalization && <div className="flex items-start gap-2 text-sm"><Checkbox id="import-normalization" disabled={busy} checked={normalization} onCheckedChange={setNormalization} /><label htmlFor="import-normalization">我已确认上述技能 frontmatter 规范化</label></div>}
            <div className="flex items-start gap-2 text-sm"><Checkbox id="import-final" disabled={busy || stale} checked={confirmed} onCheckedChange={setConfirmed} /><label htmlFor="import-final">我确认这是该发布者的完整资源集合，缺失项将被停用</label></div>
          </>}
          <DialogFooter className="flex-wrap">
            <Button type="button" variant="outline" disabled={busy} onClick={() => { void restart() }}>重新选择</Button>
            <Button type="button" variant="outline" disabled={phase === "applying"} onClick={close}>稍后继续</Button>
            {preview.already_imported ? <Button type="button" onClick={onImported}>完成</Button> : <><Button type="button" variant="outline" disabled={busy} onClick={() => { void run(false) }}>{phase === "previewing" ? "预览中…" : "重新预览"}</Button><Button type="button" disabled={busy || stale || !confirmed || (needsNormalization && !normalization)} onClick={() => { void run(true) }}>{phase === "applying" ? "导入中…" : "确认导入"}</Button></>}
          </DialogFooter>
        </div>}
      </DialogContent>
    </Dialog>
  )
}
