import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import communityQRCode from "@/assets/wecom-community-qr.png"
import { api } from "@/lib/api"
import { TABLE_DATE_TIME_OPTIONS } from "@/lib/date-time"
import type { ImportResult } from "@/lib/design-import"
import { uploadBase, type ResourceUpload } from "@/lib/resource-upload"
import { ResourceImportDialog } from "@/components/resource-import-dialog"
import { TablePagination } from "@/components/table-pagination"
import { TableLoading } from "@/components/table-loading"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

const base = "/api/admin/v1/resource-imports"
const counts = [["create", "新增"], ["update", "更新"], ["skip", "跳过"], ["retain", "保留"], ["retire", "停用"], ["restore", "恢复"], ["ignored_static", "忽略静态资源"]] as const

type Batch = { id: string; publisher: string; release_id: string; version: number; status: string; result_counts: Record<string, number>; section_results?: ImportResult["sections"]; created_at: string }
type HistoryPage = { items: Batch[]; next_cursor: string | null }
type HistoryRequest = { key: string; page?: HistoryPage; error?: string }

export function ResourceImportsPage() {
  const { i18n } = useTranslation()
  const [dialog, setDialog] = useState<{ upload: ResourceUpload | null } | null>(null)
  const [request, setRequest] = useState<HistoryRequest | null>(null)
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [active, setActive] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [refresh, setRefresh] = useState(0)
  const [pending, setPending] = useState<ResourceUpload[]>([])
  const [pendingError, setPendingError] = useState("")
  const [discarding, setDiscarding] = useState("")
  const cursor = cursors[active]
  const historyKey = `${refresh}:${pageSize}:${cursor ?? ""}`
  const current = request?.key === historyKey ? request : null
  const history = current?.page ?? null
  const historyError = current?.error ?? ""
  const historyLoading = current === null
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, TABLE_DATE_TIME_OPTIONS)

  useEffect(() => {
    let activeRequest = true
    const controller = new AbortController()
    const key = `${refresh}:${pageSize}:${cursor ?? ""}`
    const query = new URLSearchParams({ limit: String(pageSize) })
    if (cursor) query.set("cursor", cursor)
    void api<HistoryPage>(`${base}?${query}`, { signal: controller.signal })
      .then((page) => { if (activeRequest) setRequest({ key, page }) })
      .catch((reason: unknown) => { if (activeRequest) setRequest({ key, error: reason instanceof Error ? reason.message : "读取记录失败" }) })
    return () => { activeRequest = false; controller.abort() }
  }, [cursor, refresh, pageSize])

  useEffect(() => {
    const controller = new AbortController()
    void api<{ items: ResourceUpload[] }>(uploadBase, { signal: controller.signal })
      .then(({ items }) => { if (!controller.signal.aborted) { setPending(items); setPendingError("") } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setPendingError(reason instanceof Error ? reason.message : "读取未完成任务失败") })
    return () => controller.abort()
  }, [refresh])

  const discard = async (upload: ResourceUpload) => {
    setDiscarding(upload.id)
    setPendingError("")
    try {
      await api(`${uploadBase}/${upload.id}`, { method: "DELETE" })
      setRefresh((value) => value + 1)
    } catch (reason) { setPendingError(reason instanceof Error ? reason.message : "放弃任务失败") }
    finally { setDiscarding("") }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 p-4 pt-px md:h-[calc(100vh-5rem)] md:flex-none md:overflow-hidden">
      {pendingError && <p role="alert" className="text-sm text-destructive">未完成任务：{pendingError}</p>}
      {pending.length > 0 && <div className="max-h-56 shrink-0 space-y-2 overflow-y-auto rounded-lg border p-3">
        <h2 className="text-sm font-medium">未完成任务 <span className="font-normal text-muted-foreground">· 上传后保留 24 小时</span></h2>
        {pending.map((upload) => {
          const uploaded = upload.chunks.reduce((sum, chunk) => sum + chunk.size, 0)
          return <div key={upload.id} className="flex flex-wrap items-center gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1"><p className="truncate" title={upload.files[0]?.name}>{upload.files[0]?.name}{upload.files.length > 1 ? ` 等 ${upload.files.length} 卷` : ""}</p><p className="text-xs text-muted-foreground">{upload.status === "ready" ? "待确认导入" : `已上传 ${Math.floor(uploaded / upload.total_size * 100)}%`} · 有效期至 {dateFormat.format(new Date(upload.expires_at))}</p></div>
            <Button size="sm" variant="outline" disabled={Boolean(discarding)} onClick={() => setDialog({ upload })}>{upload.status === "ready" ? "继续确认" : "继续上传"}</Button>
            <Button size="sm" variant="ghost" disabled={Boolean(discarding)} onClick={() => { void discard(upload) }}>{discarding === upload.id ? "处理中…" : "放弃"}</Button>
          </div>
        })}
      </div>}
      <Card className="min-h-0 flex-1">
        <CardContent className="min-h-0 flex-1 gap-4 px-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-[var(--card-spacing)]">
            <Dialog>
              <DialogTrigger render={<Button type="button" />}>
                获取资源包
              </DialogTrigger>
              <DialogContent closeLabel="关闭" className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-sm">
                <DialogHeader className="pe-8">
                  <DialogTitle>获取资源包</DialogTitle>
                  <DialogDescription>扫描下方二维码，加入微信交流群获取 AI 资源包。</DialogDescription>
                </DialogHeader>
                <img
                  src={communityQRCode}
                  width={396}
                  height={396}
                  alt="微信交流群二维码"
                  className="mx-auto block h-auto w-56 max-w-full rounded-md bg-white p-2"
                />
              </DialogContent>
            </Dialog>
            <div className="ms-auto flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={historyLoading} onClick={() => setRefresh((value) => value + 1)}>刷新</Button>
              <Button type="button" onClick={() => setDialog({ upload: null })}>导入资源包</Button>
            </div>
          </div>
          {historyError && <div role="alert" className="mx-[var(--card-spacing)] flex items-center justify-between gap-4 rounded-lg border border-destructive/30 p-4 text-sm text-destructive"><span>{historyError}</span><Button size="sm" variant="outline" onClick={() => setRefresh((value) => value + 1)}>重试</Button></div>}
          <ScrollArea horizontal className="min-h-0 min-w-0 flex-1 [&_[data-slot=table-container]]:h-full [&_[data-slot=table-container]]:overflow-visible">
            <Table aria-busy={historyLoading} className={`${!history?.items.length ? "h-full " : ""}[&_th:first-child]:ps-[var(--card-spacing)] [&_td:first-child]:ps-[var(--card-spacing)] [&_th:last-child]:pe-[var(--card-spacing)] [&_td:last-child]:pe-[var(--card-spacing)]`}>
              <TableHeader className="sticky top-0 z-10"><TableRow>{["导入时间", "版本", "状态", "资源内容"].map((column) => <TableHead key={column}>{column}</TableHead>)}</TableRow></TableHeader>
              <TableBody className={!history?.items.length ? "h-full" : undefined}>{history?.items.map((batch) => <TableRow key={batch.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{dateFormat.format(new Date(batch.created_at))}</TableCell>
                <TableCell>{batch.version > 0 ? batch.version : "设计快照"}</TableCell>
                <TableCell><Badge variant={batch.status === "succeeded" ? "successOutline" : "destructiveOutline"}>{batch.status === "succeeded" ? "成功" : batch.status === "partial" ? "部分成功" : "失败"}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{counts
                  .filter(([key]) => (batch.result_counts[key] ?? 0) !== 0)
                  .map(([key, label]) => `${label} ${batch.result_counts[key]}`)
                  .join(" · ") || "无变更"}</TableCell>
              </TableRow>)}
                {!history?.items.length && !historyError && <TableRow className="h-full">
                  <TableCell colSpan={4} className="h-full text-center text-muted-foreground">
                    {historyLoading ? <TableLoading /> : "暂无导入记录"}
                  </TableCell>
                </TableRow>}
              </TableBody>
            </Table>
          </ScrollArea>
          <TablePagination page={active + 1} pageSize={pageSize} itemCount={history?.items.length ?? 0} loading={historyLoading} error={Boolean(historyError)} hasNext={Boolean(history?.next_cursor)}
            onPageSizeChange={(size) => { setPageSize(size); setCursors([undefined]); setActive(0) }}
            onPrevious={() => setActive((value) => Math.max(0, value - 1))}
            onNext={() => { if (history?.next_cursor) { setCursors((current) => [...current.slice(0, active + 1), history.next_cursor!]); setActive((value) => value + 1) } }} />
        </CardContent>
      </Card>
      {dialog && <ResourceImportDialog key={dialog.upload?.id ?? "new"} initialUpload={dialog.upload} onClose={() => setDialog(null)} onChanged={() => setRefresh((value) => value + 1)} onImported={() => {
        setDialog(null)
        setCursors([undefined])
        setActive(0)
        setRefresh((value) => value + 1)
      }} />}
    </section>
  )
}
