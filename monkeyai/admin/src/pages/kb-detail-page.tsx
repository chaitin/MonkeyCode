import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  CheckmarkSquare02Icon,
  Delete02Icon,
  DragDropVerticalIcon,
  Edit02Icon,
  File01Icon,
  Folder01Icon,
  Loading03Icon,
  MoreHorizontalIcon,
  PlusSignIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { useNavigate, useParams } from "react-router-dom"

import { useAppToast } from "@/components/animated-toast-provider"
import { AuthorizationSelect } from "@/components/authorization-select"
import { ResourceTagSummary } from "@/components/resource-tag-summary"
import { SkillTagSelect } from "@/components/skill-tag-select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { SortableTree, TreeItemWrapper, type TreeItemComponentProps, type TreeItems } from "@/components/tree-drag-sortable"
import "@/components/tree-drag-sortable/index.css"
import { useSkillTags } from "@/hooks/use-skill-tags"
import { api } from "@/lib/api"
import { toggleKbSelection } from "@/lib/kb-selection"
import { CONSOLE_ROUTES } from "@/lib/routes"
import { getAuthorizationNames, type AuthorizationSelection } from "@/lib/authorization-groups"
import { base, grants, match, selection, useSubjects, type ResourceRow } from "@/lib/resources"

type KbDocumentStatus = "pending" | "learning" | "learned" | "failed"
type KbDocumentSource = "text" | "file" | "url"
type Kb = ResourceRow & {
  document_count: number
  learned_count: number
  capabilities?: { channels: string[] }
}
type KbDocument = {
  id: string
  kb_id: string
  parent_id?: string | null
  node_type?: "folder" | "document"
  children?: KbDocument[]
  title: string
  source_type: KbDocumentSource
  content: string
  file_name: string | null
  mime_type: string | null
  size_bytes: number
  status: KbDocumentStatus
  error_message: string | null
  chunk_count: number
  updated_at: string
}
type DocumentInput = {
  title: string
  parent_id?: string | null
  node_type?: "folder" | "document"
  source_type: KbDocumentSource
  content: string
  file_name?: string
  mime_type?: string
  size_bytes?: number
}
type DocumentTreeItem = KbDocument & {
  parentId: string | null
  canHaveChildren: boolean
  collapsed?: boolean
}

export default function KbDetailPage() {
  const { kbId = "" } = useParams()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { showToast } = useAppToast()
  const { tags: availableTags } = useSkillTags()
  const subjects = useSubjects()
  const [kb, setKb] = useState<Kb | null>(null)
  const [documents, setDocuments] = useState<KbDocument[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(true)
  const [documentParentId, setDocumentParentId] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [documentDialogOpen, setDocumentDialogOpen] = useState(false)
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [folderSaving, setFolderSaving] = useState(false)
  const [documentMode, setDocumentMode] = useState<KbDocumentSource>("text")
  const [documentSaving, setDocumentSaving] = useState(false)
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null)
  const [documentPendingDeletion, setDocumentPendingDeletion] = useState<KbDocument | null>(null)
  const [batchSelecting, setBatchSelecting] = useState(false)
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([])
  const [batchPending, setBatchPending] = useState(false)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [batchMoveOpen, setBatchMoveOpen] = useState(false)
  const [batchMoveParentId, setBatchMoveParentId] = useState("")
  const [infoDialogOpen, setInfoDialogOpen] = useState(false)
  const [infoSaving, setInfoSaving] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [authorization, setAuthorization] = useState<AuthorizationSelection>({ groupIds: [], memberIds: [] })
  const [documentQuery, setDocumentQuery] = useState("")
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null)
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null)
  const selectedKb = kb
  const editingDocument = documents.find((item) => item.id === editingDocumentId) ?? findDocument(documents, editingDocumentId)
  const visibleDocuments = useMemo(() => filterDocumentTree(documents, documentQuery), [documents, documentQuery])
  const searchingDocuments = documentQuery.trim().length > 0
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }), [i18n.language])

  const reload = useCallback(() => {
    const controller = new AbortController()
    setDocumentsLoading(true)
    Promise.all([
      api<Kb>(`${base}/kb/${kbId}`, { signal: controller.signal }),
      api<{ items: KbDocument[] }>(`${base}/kb/${kbId}/documents`, { signal: controller.signal }),
    ]).then(([item, docs]) => {
      if (controller.signal.aborted) return
      setKb(item)
      setDocuments(docs.items ?? [])
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) showToast({ status: "error", title: reason instanceof Error ? reason.message : String(reason) })
    }).finally(() => { if (!controller.signal.aborted) setDocumentsLoading(false) })
    return () => controller.abort()
  }, [kbId, showToast])

  useEffect(() => reload(), [reload])

  const openDocument = (document: KbDocument) => {
    if (document.node_type === "folder") return
    navigate(`${CONSOLE_ROUTES.kb}/${document.kb_id}/documents/${document.id}`)
  }
  const handleRenameDocument = async (document: KbDocument, title: string) => {
    const nextTitle = title.trim()
    if (!nextTitle) {
      showToast({ status: "error", title: t("pages.knowledgeBases.renameEmpty") })
      return
    }
    if (nextTitle === document.title) {
      setRenamingDocumentId(null)
      return
    }
    try {
      await api(`${base}/kb/${kbId}/documents/${document.id}`, {
        method: "PUT",
        body: JSON.stringify({ title: nextTitle, source_type: document.source_type }),
      })
    } catch (reason) {
      showToast({ status: "error", title: reason instanceof Error ? reason.message : String(reason) })
      throw reason
    }
    setRenamingDocumentId(null)
    showToast({ status: "success", title: t("pages.knowledgeBases.renamed") })
    reload()
  }
  const handleDocumentDialogOpenChange = (open: boolean) => {
    setDocumentDialogOpen(open)
    if (!open) {
      setDocumentMode("text")
      setEditingDocumentId(null)
      setDocumentParentId(null)
    }
  }
  const handleSubmitFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const title = String(new FormData(event.currentTarget).get("title") ?? "").trim()
    if (!title) return
    setFolderSaving(true)
    try {
      await api(`${base}/kb/${kbId}/documents`, {
        method: "POST",
        body: JSON.stringify({ title, node_type: "folder", source_type: "text", content: "" }),
      })
      setFolderDialogOpen(false)
      reload()
    } catch (reason) {
      showToast({ status: "error", title: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setFolderSaving(false)
    }
  }
  const saveDocument = async (input: DocumentInput, document?: KbDocument | null) => {
    await api(`${base}/kb/${kbId}/documents${document ? `/${document.id}` : ""}`, { method: document ? "PUT" : "POST", body: JSON.stringify(input) })
    reload()
  }
  const handleSubmitDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const title = String(formData.get("title") ?? "").trim()
    const content = String(formData.get("body") ?? "").trim()
    const files = formData.getAll("file").filter((value): value is File => value instanceof File && value.size > 0)
    setDocumentSaving(true)
    try {
      if (editingDocument) {
        if (!title || !content) return
        await saveDocument({ title, source_type: "text", content, size_bytes: content.length }, editingDocument)
      } else if (documentMode === "text") {
        if (!title || !content) return
        await saveDocument({ title, parent_id: documentParentId, source_type: "text", content, size_bytes: content.length })
      } else {
        for (const file of files) {
          const text = await file.text()
          await saveDocument({ title: file.name, parent_id: documentParentId, source_type: "file", file_name: file.name, mime_type: file.type || "application/octet-stream", size_bytes: file.size, content: text })
        }
      }
      handleDocumentDialogOpenChange(false)
    } catch (reason) {
      showToast({ status: "error", title: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setDocumentSaving(false)
    }
  }
  const exitBatch = () => {
    setBatchSelecting(false)
    setBatchSelectedIds([])
    setBatchDeleteOpen(false)
    setBatchMoveOpen(false)
  }
  const visibleDocumentIds = useMemo(() => {
    const ids: string[] = []
    const visit = (items: KbDocument[]) => {
      items.forEach((item) => {
        ids.push(item.id)
        if (item.children?.length) visit(item.children)
      })
    }
    visit(visibleDocuments)
    return ids
  }, [visibleDocuments])
  const toggleBatchDocument = (id: string) => {
    setBatchSelectedIds((current) => toggleKbSelection(documents, current, id))
  }
  const submitBatch = async (action: "delete" | "move" | "restudy", parentId = "") => {
    if (!batchSelectedIds.length || batchPending) return
    setBatchPending(true)
    try {
      const result = await api<{ succeeded?: string[]; failed?: { id: string; reason: string }[] }>(`${base}/kb/${kbId}/documents/${action === "restudy" ? "restudy" : "batch"}`, {
        method: "POST",
        body: JSON.stringify({ action: action === "restudy" ? undefined : action, ids: batchSelectedIds, parent_id: action === "move" ? parentId || null : undefined }),
      })
      const failed = result.failed ?? []
      showToast({
        status: failed.length ? "error" : "success",
        title: failed.length
          ? t("pages.knowledgeBases.batchPartial", { reason: failed[0]?.reason ?? "" })
          : t("pages.knowledgeBases.renamed"),
      })
      setBatchSelectedIds(failed.map((item) => item.id))
      if (!failed.length) exitBatch()
      setBatchDeleteOpen(false)
      setBatchMoveOpen(false)
      reload()
    } catch (reason) {
      showToast({ status: "error", title: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setBatchPending(false)
    }
  }
  const handleDeleteDocument = async () => {
    if (!documentPendingDeletion) return
    try {
      await api(`${base}/kb/${kbId}/documents/${documentPendingDeletion.id}`, { method: "DELETE" })
      setDocumentPendingDeletion(null)
      reload()
    } catch (reason) {
      showToast({ status: "error", title: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  const handleRestudyDocument = async (document: KbDocument) => {
    try {
      const result = await api<{ failed: { id: string; reason: string }[] }>(`${base}/kb/${kbId}/documents/restudy`, {
        method: "POST",
        body: JSON.stringify({ ids: [document.id] }),
      })
      if (result.failed.length) throw new Error(result.failed[0].reason)
      reload()
    } catch (reason) {
      showToast({ status: "error", title: reason instanceof Error ? reason.message : String(reason) })
    }
  }
  const treeItems = useMemo(
    () => toTreeItems(visibleDocuments, expandedFolders, searchingDocuments),
    [expandedFolders, searchingDocuments, visibleDocuments],
  )
  const handleTreeItemsChanged = async (
    nextItems: TreeItems<DocumentTreeItem>,
    reason: { type: string; item?: DocumentTreeItem; draggedItem?: DocumentTreeItem },
  ) => {
    if (reason.type === "collapsed" || reason.type === "expanded") {
      if (!reason.item) return
      setExpandedFolders((current) => ({ ...current, [reason.item!.id]: reason.type === "expanded" }))
      return
    }
    if (reason.type !== "dropped" || !reason.draggedItem || searchingDocuments) return
    const { prevItemId, nextItemId } = getSiblingItemIds(nextItems, String(reason.draggedItem.id))
    const parentId = reason.draggedItem.parentId
    setDocuments(stripTreeItems(nextItems))
    try {
      await api(`${base}/kb/${kbId}/documents/move`, {
        method: "POST",
        body: JSON.stringify({
          id: reason.draggedItem.id,
          parent_id: parentId,
          prev_id: prevItemId ?? "",
          next_id: nextItemId ?? "",
        }),
      })
      reload()
    } catch (reasonError) {
      showToast({ status: "error", title: reasonError instanceof Error ? reasonError.message : String(reasonError) })
      reload()
    }
  }
  const openInfoDialog = () => {
    if (!selectedKb || selectedKb.ownership_type !== "system") return
    setSelectedTagIds((selectedKb.tags ?? []).map((tag) => tag.id))
    setAuthorization(selection(selectedKb.grants))
    setTagsOpen(false)
    setInfoDialogOpen(true)
  }
  const handleSubmitKbInfo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedKb) return
    const formData = new FormData(event.currentTarget)
    const name = String(formData.get("name") ?? "").trim()
    const description = String(formData.get("description") ?? "").trim()
    if (!name || !description) return
    setInfoSaving(true)
    try {
      await api(`${base}/kb/${selectedKb.id}`, {
        method: "PUT",
        headers: match(selectedKb.revision),
        body: JSON.stringify({
          name,
          description,
          tag_ids: selectedTagIds.filter((tagId) => availableTags.some((tag) => tag.id === tagId)),
          grants: grants(authorization),
        }),
      })
      setInfoDialogOpen(false)
      reload()
    } catch (reason) {
      showToast({ status: "error", title: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setInfoSaving(false)
    }
  }
  if (!selectedKb && documentsLoading) return <p className="p-6 text-sm text-muted-foreground">{t("resources.loading")}</p>
  if (!selectedKb) return null
  return (
    <section className="flex h-[calc(100vh-4rem)] min-h-0 flex-none flex-col gap-4 p-4 pt-0 md:h-[calc(100vh-5rem)]">
      <div className="flex shrink-0 items-start gap-4 rounded-xl border p-4">
        <dl className="grid min-w-0 flex-1 grid-cols-4 gap-4 text-sm">
          <div className="min-w-0 space-y-1">
            <dt className="truncate text-muted-foreground">{t("pages.knowledgeBases.knowledgeDescription")}</dt>
            <dd className="truncate" title={selectedKb.description?.trim() || t("pages.knowledgeBases.noDescription")}>
              {selectedKb.description?.trim() || t("pages.knowledgeBases.noDescription")}
            </dd>
          </div>
          <div className="min-w-0 space-y-1">
            <dt className="truncate text-muted-foreground">{t("pages.knowledgeBases.authorizedUsers")}</dt>
            <dd className="truncate" title={getAuthorizationNames(selection(selectedKb.grants), t) || t("pages.knowledgeBases.noAuthorizedUsers")}>
              {getAuthorizationNames(selection(selectedKb.grants), t) || t("pages.knowledgeBases.noAuthorizedUsers")}
            </dd>
          </div>
          <div className="min-w-0 space-y-1">
            <dt className="truncate text-muted-foreground">{t("pages.knowledgeBases.tags")}</dt>
            <dd>
              <ResourceTagSummary tagIds={(selectedKb.tags ?? []).map((tag) => tag.id)} />
            </dd>
          </div>
          <div className="min-w-0 space-y-1">
            <dt className="truncate text-muted-foreground">{t("pages.knowledgeBases.learningStatus")}</dt>
            <dd className="truncate" title={t("pages.knowledgeBases.learnedCount", { learned: selectedKb.learned_count ?? 0, total: selectedKb.document_count ?? 0 })}>
              {t("pages.knowledgeBases.learnedCount", { learned: selectedKb.learned_count ?? 0, total: selectedKb.document_count ?? 0 })}
            </dd>
          </div>
        </dl>
        {selectedKb.ownership_type === "system" && (
          <Button type="button" variant="outline" className="shrink-0" onClick={openInfoDialog}>
            <HugeiconsIcon icon={Edit02Icon} data-icon="inline-start" />
            {t("pages.knowledgeBases.editInfo")}
          </Button>
        )}
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="flex shrink-0 flex-row items-center justify-between gap-3 space-y-0">
          <Input
            className="w-full max-w-xl"
            type="search"
            value={documentQuery}
            placeholder={t("pages.knowledgeBases.searchDocuments")}
            aria-label={t("pages.knowledgeBases.searchDocuments")}
            onChange={(event) => setDocumentQuery(event.target.value)}
          />
          {selectedKb.ownership_type === "system" && (
            <div className="flex shrink-0 gap-2">
              <Button type="button" variant="outline" onClick={() => batchSelecting ? exitBatch() : setBatchSelecting(true)}>
                <HugeiconsIcon icon={CheckmarkSquare02Icon} data-icon="inline-start" />
                {batchSelecting ? t("pages.knowledgeBases.batchExit") : t("pages.knowledgeBases.batch")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setFolderDialogOpen(true)}>
                <HugeiconsIcon icon={Folder01Icon} data-icon="inline-start" />
                {t("pages.knowledgeBases.addFolder")}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setEditingDocumentId(null)
                  setDocumentMode("text")
                  setDocumentDialogOpen(true)
                }}
              >
                <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                {t("pages.knowledgeBases.createDocument")}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="min-h-0 flex-1 px-0">
          <ScrollArea className="h-full">
            <div className="kb-document-tree min-w-[760px]">
              <div className="grid grid-cols-[minmax(16rem,1.8fr)_8rem_11rem_8rem] border-b px-6 py-2 text-sm text-muted-foreground">
                <span>{t("pages.knowledgeBases.columns.name")}</span>
                <span>{t("pages.knowledgeBases.columns.status")}</span>
                <span>{t("pages.knowledgeBases.columns.updatedAt")}</span>
                <span className="text-end">{t("pages.knowledgeBases.columns.actions")}</span>
              </div>
              {documentsLoading && documents.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">{t("resources.loading")}</p>
              ) : visibleDocuments.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">{t("pages.knowledgeBases.emptyContents")}</p>
              ) : (
                <DocumentTreeContext.Provider value={{
                  selectedDocumentId,
                  renamingDocumentId,
                  onSelectDocument: setSelectedDocumentId,
                  dateFormatter,
                  canManage: selectedKb.ownership_type === "system",
                  batchSelecting,
                  batchSelectedIds,
                  onToggleBatchDocument: toggleBatchDocument,
                  onOpenDocument: openDocument,
                  onRenameDocument: (document) => setRenamingDocumentId(document.id),
                  onSaveRename: handleRenameDocument,
                  onCancelRename: () => setRenamingDocumentId(null),
                  onRestudyDocument: (document) => void handleRestudyDocument(document),
                  onDeleteDocument: setDocumentPendingDeletion,
                }}>
                <SortableTree
                  items={treeItems}
                  indentationWidth={24}
                  disableSorting={selectedKb.ownership_type !== "system" || searchingDocuments}
                  onItemsChanged={handleTreeItemsChanged}
                  TreeItemComponent={DocumentTreeRow}
                />
                </DocumentTreeContext.Provider>
              )}
            </div>
          </ScrollArea>
        </CardContent>
        {batchSelecting && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t px-6 py-3">
            <span className="text-sm text-muted-foreground">{t("pages.knowledgeBases.batchSelected", { count: batchSelectedIds.length })}</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={!visibleDocumentIds.length || batchPending} onClick={() => setBatchSelectedIds(visibleDocumentIds)}>{t("pages.knowledgeBases.batchSelectAll")}</Button>
              <Button type="button" variant="outline" size="sm" disabled={!batchSelectedIds.length || batchPending} onClick={() => setBatchSelectedIds([])}>{t("pages.knowledgeBases.batchClear")}</Button>
              <Button type="button" variant="outline" size="sm" disabled={!batchSelectedIds.length || batchPending} onClick={() => { setBatchMoveParentId(""); setBatchMoveOpen(true) }}>{t("pages.knowledgeBases.batchMove")}</Button>
              <Button type="button" variant="outline" size="sm" disabled={!batchSelectedIds.length || batchPending} onClick={() => void submitBatch("restudy")}>{t("pages.knowledgeBases.retryLearning")}</Button>
              <Button type="button" variant="destructive" size="sm" disabled={!batchSelectedIds.length || batchPending} onClick={() => setBatchDeleteOpen(true)}>{t("pages.knowledgeBases.delete")}</Button>
            </div>
          </div>
        )}
        {selectedKb.ownership_type === "user" && (
          <CardFooter className="shrink-0 border-t text-sm text-muted-foreground">
            <span>{t("pages.knowledgeBases.userReadOnlyHint")}</span>
          </CardFooter>
        )}
      </Card>

      <Dialog open={infoDialogOpen} onOpenChange={(open) => { if (!infoSaving) setInfoDialogOpen(open) }}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl" closeLabel={t("common.close")}>
          <form key={selectedKb.revision} className="flex min-w-0 flex-col gap-6" onSubmit={handleSubmitKbInfo}>
            <DialogHeader>
              <DialogTitle>{t("pages.knowledgeBases.editDialogTitle")}</DialogTitle>
              <DialogDescription>{t("pages.knowledgeBases.dialogDescription")}</DialogDescription>
            </DialogHeader>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="kb-detail-name">{t("pages.knowledgeBases.name")}</FieldLabel>
                <Input id="kb-detail-name" name="name" defaultValue={selectedKb.name} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="kb-detail-description">{t("pages.knowledgeBases.knowledgeDescription")}</FieldLabel>
                <Textarea id="kb-detail-description" name="description" defaultValue={selectedKb.description} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="kb-detail-authorized-users">{t("pages.models.authorizedScope")}</FieldLabel>
                <AuthorizationSelect groups={subjects.groups} members={subjects.members} id="kb-detail-authorized-users" disabled={infoSaving} value={authorization} onValueChange={setAuthorization} />
              </Field>
              <Field>
                <FieldLabel htmlFor="kb-detail-tags">{t("pages.knowledgeBases.tags")}</FieldLabel>
                <SkillTagSelect id="kb-detail-tags" open={tagsOpen} options={availableTags} placeholder={t("pages.knowledgeBases.tagsPlaceholder")} value={selectedTagIds} onOpenChange={setTagsOpen} onValueChange={setSelectedTagIds} />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>{t("pages.knowledgeBases.cancel")}</DialogClose>
              <Button type="submit" loading={infoSaving}>{t("pages.knowledgeBases.save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={folderDialogOpen} onOpenChange={(open) => { if (!folderSaving) setFolderDialogOpen(open) }}>
        <DialogContent closeLabel={t("common.close")}>
          <form className="flex min-w-0 flex-col gap-6" onSubmit={handleSubmitFolder}>
            <DialogHeader>
              <DialogTitle>{t("pages.knowledgeBases.addFolder")}</DialogTitle>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="kb-folder-name">{t("pages.knowledgeBases.folderName")}</FieldLabel>
              <Input id="kb-folder-name" name="title" required autoFocus />
            </Field>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>{t("pages.knowledgeBases.cancel")}</DialogClose>
              <Button type="submit" loading={folderSaving}>{t("pages.knowledgeBases.addFolder")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={documentDialogOpen} onOpenChange={(open) => { if (!documentSaving) handleDocumentDialogOpenChange(open) }}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl" closeLabel={t("common.close")}>
          <form className="flex min-w-0 flex-col gap-6" onSubmit={handleSubmitDocument}>
            <DialogHeader>
              <DialogTitle>{editingDocument ? t("pages.knowledgeBases.editContentTitle") : t("pages.knowledgeBases.addContentTitle")}</DialogTitle>
              <DialogDescription>{editingDocument ? t("pages.knowledgeBases.editContentDescription") : t("pages.knowledgeBases.addContentDescription")}</DialogDescription>
            </DialogHeader>
            <Tabs value={documentMode} onValueChange={(value) => setDocumentMode(value as KbDocumentSource)}>
              {!editingDocument && <TabsList className="w-full"><TabsTrigger value="text">{t("pages.knowledgeBases.textContent")}</TabsTrigger><TabsTrigger value="file">{t("pages.knowledgeBases.fileContent")}</TabsTrigger></TabsList>}
              <TabsContent value="text">
                <FieldGroup className="gap-4">
                  <Field><FieldLabel htmlFor="kb-document-title">{t("pages.knowledgeBases.contentTitle")}</FieldLabel><Input id="kb-document-title" name="title" defaultValue={editingDocument?.title} required /></Field>
                  <Field><FieldLabel htmlFor="kb-document-body">{t("pages.knowledgeBases.textContent")}</FieldLabel><Textarea id="kb-document-body" name="body" defaultValue={editingDocument?.content} required /></Field>
                </FieldGroup>
              </TabsContent>
              <TabsContent value="file"><Field><FieldLabel htmlFor="kb-document-file">{t("pages.knowledgeBases.selectFile")}</FieldLabel><Input id="kb-document-file" name="file" type="file" multiple accept=".txt,.md,.markdown" required /><FieldDescription>{t("pages.knowledgeBases.fileDescription")}</FieldDescription></Field></TabsContent>
            </Tabs>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>{t("pages.knowledgeBases.cancel")}</DialogClose>
              <Button type="submit" loading={documentSaving}>{editingDocument ? t("pages.knowledgeBases.saveAndRelearn") : t("pages.knowledgeBases.addAndLearn")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={batchDeleteOpen} onOpenChange={(open) => { if (!batchPending) setBatchDeleteOpen(open) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pages.knowledgeBases.batchDeleteTitle")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>{t("pages.knowledgeBases.batchDeleteDescription", { count: batchSelectedIds.length })}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={batchPending}>{t("pages.knowledgeBases.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={batchPending} onClick={() => void submitBatch("delete")}>{t("pages.knowledgeBases.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={batchMoveOpen} onOpenChange={(open) => { if (!batchPending) setBatchMoveOpen(open) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("pages.knowledgeBases.batchMoveTitle")}</DialogTitle>
            <DialogDescription>{t("pages.knowledgeBases.batchMoveDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            <Button type="button" variant={batchMoveParentId === "" ? "secondary" : "ghost"} className="justify-start" onClick={() => setBatchMoveParentId("")}>{t("pages.knowledgeBases.batchMoveRoot")}</Button>
            <FolderDestinationOptions documents={documents} selectedIds={batchSelectedIds} value={batchMoveParentId} onChange={setBatchMoveParentId} />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={batchPending} />}>{t("pages.knowledgeBases.cancel")}</DialogClose>
            <Button type="button" loading={batchPending} disabled={!batchSelectedIds.length} onClick={() => void submitBatch("move", batchMoveParentId)}>{t("pages.knowledgeBases.batchMove")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(documentPendingDeletion)} onOpenChange={(open) => { if (!open) setDocumentPendingDeletion(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{t("pages.knowledgeBases.deleteContentTitle")}</AlertDialogTitle></AlertDialogHeader><AlertDialogDescription>{t("pages.knowledgeBases.deleteContentDescription", { content: documentPendingDeletion?.title })}</AlertDialogDescription>
          <AlertDialogFooter><AlertDialogCancel>{t("pages.knowledgeBases.cancel")}</AlertDialogCancel><AlertDialogAction onClick={() => void handleDeleteDocument()}>{t("pages.knowledgeBases.delete")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function findDocument(items: KbDocument[], id: string | null): KbDocument | undefined {
  if (!id) return undefined
  for (const item of items) {
    if (item.id === id) return item
    const child = findDocument(item.children ?? [], id)
    if (child) return child
  }
}

function filterDocumentTree(items: KbDocument[], query: string): KbDocument[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return items
  return items.flatMap((document) => {
    const children = filterDocumentTree(document.children ?? [], keyword)
    const matched = [document.title, document.file_name, document.content]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword))
    if (!matched && children.length === 0) return []
    return [{ ...document, children }]
  })
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function LearningStatusBadge({ status }: { status: KbDocumentStatus }) {
  const { t } = useTranslation()
  const displayStatus = status === "pending" ? "learning" : status
  const icon = displayStatus === "learned" ? CheckmarkCircle02Icon : displayStatus === "learning" ? Loading03Icon : AlertCircleIcon
  return (
    <Badge variant={displayStatus === "learned" ? "default" : displayStatus === "learning" ? "secondary" : "destructive"}>
      <HugeiconsIcon className={displayStatus === "learning" ? "animate-spin" : undefined} icon={icon} data-icon="inline-start" />
      {t(`pages.knowledgeBases.statuses.${displayStatus}`)}
    </Badge>
  )
}

function toTreeItems(items: KbDocument[], expanded: Record<string, boolean>, forceOpen: boolean, parentId: string | null = null): TreeItems<DocumentTreeItem> {
  return items.map((document) => ({
    ...document,
    parentId,
    canHaveChildren: document.node_type === "folder",
    collapsed: document.node_type === "folder" ? !(forceOpen || expanded[document.id] !== false) : undefined,
    children: toTreeItems(document.children ?? [], expanded, forceOpen, document.id),
  }))
}

function stripTreeItems(items: TreeItems<DocumentTreeItem>): KbDocument[] {
  return items.map(({ parentId: _parentId, canHaveChildren: _canHaveChildren, collapsed: _collapsed, children, ...document }) => ({
    ...document,
    children: stripTreeItems(children ?? []),
  }))
}

function getSiblingItemIds(items: TreeItems<DocumentTreeItem>, draggedId: string) {
  const parentMap = new Map<string, { parent: TreeItems<DocumentTreeItem>; index: number }>()
  const visit = (nodes: TreeItems<DocumentTreeItem>) => {
    nodes.forEach((item, index) => {
      parentMap.set(String(item.id), { parent: nodes, index })
      if (item.children?.length) visit(item.children)
    })
  }
  visit(items)
  const dragged = parentMap.get(draggedId)
  return {
    prevItemId: dragged && dragged.index > 0 ? String(dragged.parent[dragged.index - 1].id) : null,
    nextItemId: dragged && dragged.index < dragged.parent.length - 1 ? String(dragged.parent[dragged.index + 1].id) : null,
  }
}

function FolderDestinationOptions({ documents, selectedIds, value, onChange, depth = 0 }: { documents: KbDocument[]; selectedIds: string[]; value: string; onChange: (id: string) => void; depth?: number }) {
  const selected = new Set(selectedIds)
  const blocked = (item: KbDocument): boolean => selected.has(item.id) || (item.children ?? []).some(blocked)
  return (
    <>
      {documents.filter((item) => item.node_type === "folder" && !blocked(item)).map((item) => (
        <div key={item.id}>
          <Button type="button" variant={value === item.id ? "secondary" : "ghost"} className="w-full justify-start" style={{ paddingInlineStart: 12 + depth * 16 }} onClick={() => onChange(item.id)}>
            <HugeiconsIcon icon={Folder01Icon} data-icon="inline-start" />
            <span className="truncate">{item.title}</span>
          </Button>
          {item.children?.length ? <FolderDestinationOptions documents={item.children} selectedIds={selectedIds} value={value} onChange={onChange} depth={depth + 1} /> : null}
        </div>
      ))}
    </>
  )
}

type DocumentTreeActions = {
  selectedDocumentId: string | null
  renamingDocumentId: string | null
  onSelectDocument: (id: string) => void
  dateFormatter: Intl.DateTimeFormat
  canManage: boolean
  batchSelecting: boolean
  batchSelectedIds: string[]
  onToggleBatchDocument: (id: string) => void
  onOpenDocument: (document: KbDocument) => void
  onRenameDocument: (document: KbDocument) => void
  onSaveRename: (document: KbDocument, title: string) => Promise<void>
  onCancelRename: () => void
  onRestudyDocument: (document: KbDocument) => void
  onDeleteDocument: (document: KbDocument) => void
}
const DocumentTreeContext = createContext<DocumentTreeActions | null>(null)

const DocumentTreeRow = ({
  item,
  collapsed,
  handleProps,
  ...props
}: TreeItemComponentProps<DocumentTreeItem>) => {
  const actions = useContext(DocumentTreeContext)
  if (!actions) throw new Error("DocumentTreeRow must be used inside DocumentTreeContext")
  const {
    selectedDocumentId,
    renamingDocumentId,
    onSelectDocument,
    dateFormatter,
    canManage,
    batchSelecting,
    batchSelectedIds,
    onToggleBatchDocument,
    onOpenDocument,
    onRenameDocument,
    onSaveRename,
    onCancelRename,
    onRestudyDocument,
    onDeleteDocument,
  } = actions
  const { t } = useTranslation()
  const selected = selectedDocumentId === item.id
  const renaming = renamingDocumentId === item.id
  const [renameValue, setRenameValue] = useState(item.title)
  const [renameSaving, setRenameSaving] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!renaming) return
    setRenameValue(item.title)
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [item.title, renaming])
  const saveRename = async () => {
    if (renameSaving) return
    setRenameSaving(true)
    try {
      await onSaveRename(item, renameValue)
    } finally {
      setRenameSaving(false)
    }
  }
  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      void saveRename()
    }
    if (event.key === "Escape") {
      event.preventDefault()
      onCancelRename()
    }
  }
  return (
    <TreeItemWrapper
      {...props}
      item={item}
      collapsed={collapsed}
      handleProps={handleProps}
      showDragHandle={false}
      hideCollapseButton
      disableCollapseOnItemClick
      className="group/tree-row !ps-0"
      contentClassName="!border-0 !p-0"
    >
      <div
        className={`grid min-h-12 w-full cursor-grab grid-cols-[minmax(16rem,1.8fr)_8rem_11rem_8rem] items-center pe-6 text-sm active:cursor-grabbing ${selected ? "bg-muted/70" : "hover:bg-muted/40"}`}
        onClick={() => {
          onSelectDocument(item.id)
          if (item.node_type !== "folder") onOpenDocument(item)
        }}
      >
        <div className="flex min-w-0 items-center">
          <button
            type="button"
            className={`flex size-5 shrink-0 items-center justify-center text-muted-foreground ${canManage && !props.disableSorting ? `cursor-grab ${selected ? "opacity-100" : "opacity-0 group-hover/tree-row:opacity-100"}` : "invisible"}`}
            aria-label={t("pages.knowledgeBases.dragDocument")}
            {...(canManage && !props.disableSorting ? handleProps : {})}
          >
            <HugeiconsIcon icon={DragDropVerticalIcon} />
          </button>
          <div className="flex min-w-0 items-center gap-2" style={{ paddingInlineStart: props.depth * 24 }}>
          {batchSelecting && (
            <Checkbox
              checked={batchSelectedIds.includes(item.id)}
              aria-label={item.title}
              onClick={(event) => event.stopPropagation()}
              onCheckedChange={() => onToggleBatchDocument(item.id)}
            />
          )}
          {item.node_type === "folder" ? (
            <>
              {(item.children?.length ?? 0) > 0 ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("pages.knowledgeBases.toggleFolder")}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onCollapse?.()
                  }}
                >
                  <HugeiconsIcon icon={collapsed ? ArrowRight01Icon : ArrowDown01Icon} />
                </Button>
              ) : (
                <span className="size-7 shrink-0" />
              )}
              <HugeiconsIcon className="shrink-0 text-muted-foreground" icon={Folder01Icon} />
            </>
          ) : (
            <>
              <span className="size-7 shrink-0" />
              <HugeiconsIcon className="shrink-0 text-muted-foreground" icon={File01Icon} />
            </>
          )}
          <div className="min-w-0 flex-1">
            {renaming ? (
              <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <Input
                  ref={renameInputRef}
                  className="h-8 bg-background"
                  value={renameValue}
                  disabled={renameSaving}
                  aria-label={t("pages.knowledgeBases.rename")}
                  placeholder={t("pages.knowledgeBases.renamePlaceholder")}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onPointerDown={(event) => event.stopPropagation()}
                />
                <Button type="button" size="sm" disabled={renameSaving} onClick={() => void saveRename()}>
                  {t("pages.knowledgeBases.save")}
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={renameSaving} onClick={onCancelRename}>
                  {t("pages.knowledgeBases.cancel")}
                </Button>
              </div>
            ) : (
              <>
                <p className="truncate font-medium">{item.title}</p>
                {item.node_type !== "folder" && (
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(item.size_bytes)}
                    {item.chunk_count > 0 ? ` · ${item.chunk_count} chunks` : ""}
                  </p>
                )}
                {item.node_type !== "folder" && item.error_message && <p className="line-clamp-2 text-xs text-destructive" title={item.error_message}>{item.error_message}</p>}
              </>
            )}
          </div>
          </div>
        </div>
        {item.node_type === "folder" ? <span className="text-muted-foreground">-</span> : <LearningStatusBadge status={item.status} />}
        <span>{dateFormatter.format(new Date(item.updated_at))}</span>
        <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
          {canManage && !renaming && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" size="icon-sm" variant="ghost" aria-label={t("pages.knowledgeBases.columns.actions")} />}>
                <HugeiconsIcon icon={MoreHorizontalIcon} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  {item.node_type !== "folder" && (
                    <DropdownMenuItem onClick={() => onOpenDocument(item)}>
                      <HugeiconsIcon icon={ViewIcon} strokeWidth={2} />
                      {t("pages.knowledgeBases.view")}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => onRenameDocument(item)}>
                    <HugeiconsIcon icon={Edit02Icon} strokeWidth={2} />
                    {t("pages.knowledgeBases.rename")}
                  </DropdownMenuItem>
                  {item.node_type !== "folder" && (
                    <DropdownMenuItem onClick={() => onRestudyDocument(item)}>
                      <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} />
                      {t("pages.knowledgeBases.retryLearning")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem variant="destructive" onClick={() => onDeleteDocument(item)}>
                    <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                    {t("pages.knowledgeBases.delete")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </TreeItemWrapper>
  )
}

