import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react"
import {
  AlertCircleIcon,
  BookOpenTextIcon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  Edit02Icon,
  File01Icon,
  Loading03Icon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusSignIcon,
  TextIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { useTranslation } from "react-i18next"
import { useNavigate, useSearchParams } from "react-router-dom"

import { useAppToast } from "@/components/animated-toast-provider"
import { AuthorizationSelect } from "@/components/authorization-select"
import { ResourceCard } from "@/components/resource-card"
import { ResourceCardMenuButton } from "@/components/resource-card-menu-button"
import { ResourceList } from "@/components/resource-list"
import { ResourceTagSummary } from "@/components/resource-tag-summary"
import { SkillTagSelect } from "@/components/skill-tag-select"
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useResourceList } from "@/hooks/use-resource-list"
import { useSkillTags } from "@/hooks/use-skill-tags"
import { api } from "@/lib/api"
import { CONSOLE_ROUTES } from "@/lib/routes"
import {
  getAuthorizationNames,
  type AuthorizationSelection,
} from "@/lib/authorization-groups"
import {
  base,
  grants,
  localized,
  match,
  selection,
  useSubjects,
  type ResourceRow,
} from "@/lib/resources"
import { getCreatorInitial } from "@/lib/utils"

type KbDocumentStatus = "pending" | "learning" | "learned" | "failed"
type KbDocumentSource = "text" | "file"

type Kb = ResourceRow & {
  document_count: number
  learned_count: number
  embedding_model_id: string | null
  embedding_dimension: number | null
  capabilities?: {
    search_modes: string[]
    channels: string[]
    embedding_configured: boolean
  }
}

type KbDocument = {
  id: string
  kb_id: string
  title: string
  source_type: KbDocumentSource
  content: string
  file_name: string | null
  mime_type: string | null
  size_bytes: number
  status: KbDocumentStatus
  error_message: string | null
  chunk_count: number
  revision: number
  learned_at: string | null
  created_at: string
  updated_at: string
}

type KbChunk = {
  chunk_id: string
  kb_id: string
  document_id: string
  chunk_index: number
  content: string
  token_count: number | null
}

type DocumentInput = {
  title: string
  source_type: KbDocumentSource
  content: string
  file_name?: string
  mime_type?: string
  size_bytes?: number
}

function toKb(row: ResourceRow): Kb {
  return row as Kb
}

function toSearchableKb(kb: Kb, language: string) {
  const text = localized(kb, language)
  return {
    ...kb,
    name: text.name,
    description: text.description,
  }
}

export function KbPage() {
  const { i18n, t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnKbId = searchParams.get("kb")
  const { showToast } = useAppToast()
  const { tags: availableTags } = useSkillTags()
  const subjects = useSubjects()
  const remote = useResourceList<Kb>("/kb")
  const knowledgeBases = useMemo(
    () =>
      remote.items.map((item) => ({
        ...toKb(item),
        ...toSearchableKb(toKb(item), i18n.language),
      })),
    [i18n.language, remote.items]
  )

  const [selectedKbId, setSelectedKbId] = useState<string | null>(returnKbId)
  const [documents, setDocuments] = useState<KbDocument[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(Boolean(returnKbId))
  const documentLoad = useRef<{
    kbId: string
    request: AbortController | null
  } | null>(null)
  const [returnedKb, setReturnedKb] = useState<Kb | null>(null)
  const [kbDialogOpen, setKbDialogOpen] = useState(false)
  const [editingKbId, setEditingKbId] = useState<string | null>(null)
  const [kbPendingDeletion, setKbPendingDeletion] = useState<Kb | null>(null)
  const [documentDialogOpen, setDocumentDialogOpen] = useState(false)
  const [documentMode, setDocumentMode] = useState<KbDocumentSource>("text")
  const [documentSaving, setDocumentSaving] = useState(false)
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(
    null
  )
  const [documentPendingDeletion, setDocumentPendingDeletion] =
    useState<KbDocument | null>(null)
  const [chunksDocument, setChunksDocument] = useState<KbDocument | null>(null)
  const [chunks, setChunks] = useState<KbChunk[]>([])
  const [chunksLoading, setChunksLoading] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [authorization, setAuthorization] = useState<AuthorizationSelection>({
    groupIds: [],
    memberIds: [],
  })
  const selectedKb =
    knowledgeBases.find((item) => item.id === selectedKbId) ??
    (returnedKb?.id === selectedKbId ? returnedKb : null)
  const editingKb = knowledgeBases.find((item) => item.id === editingKbId)
  const editingDocument = documents.find(
    (item) => item.id === editingDocumentId
  )
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [i18n.language]
  )

  const reloadDocuments = useCallback(
    (kbId: string) => {
      const load = documentLoad.current
      if (!load || load.kbId !== kbId) return Promise.resolve()
      load.request?.abort()
      const controller = new AbortController()
      load.request = controller
      setDocumentsLoading(true)
      return api<{ items: KbDocument[] }>(`${base}/kb/${kbId}/documents`, {
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) setDocuments(data.items ?? [])
        })
        .catch((reason: unknown) => {
          if (controller.signal.aborted) return
          showToast({
            status: "error",
            title: reason instanceof Error ? reason.message : String(reason),
          })
        })
        .finally(() => {
          if (load.request === controller) load.request = null
          if (!controller.signal.aborted) setDocumentsLoading(false)
        })
    },
    [showToast]
  )

  const selectKb = useCallback((id: string) => {
    setDocuments([])
    setSelectedKbId(id)
  }, [])

  useEffect(() => {
    if (!selectedKbId) return
    const load = { kbId: selectedKbId, request: null as AbortController | null }
    documentLoad.current = load
    void reloadDocuments(selectedKbId)
    return () => {
      load.request?.abort()
      documentLoad.current = null
    }
  }, [selectedKbId, reloadDocuments])

  useEffect(() => {
    if (!selectedKbId) return
    const learning = documents.some(
      (item) => item.status === "pending" || item.status === "learning"
    )
    if (!learning) return
    const timer = window.setInterval(() => {
      if (!documentLoad.current?.request) void reloadDocuments(selectedKbId)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [documents, reloadDocuments, selectedKbId])

  useEffect(() => {
    if (!returnKbId) return
    const controller = new AbortController()
    api<Kb>(`${base}/kb/${returnKbId}`, { signal: controller.signal })
      .then((kb) => {
        if (!controller.signal.aborted) {
          setReturnedKb({ ...kb, ...toSearchableKb(kb, i18n.language) })
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          showToast({
            status: "error",
            title: reason instanceof Error ? reason.message : String(reason),
          })
      })
    return () => controller.abort()
  }, [returnKbId, showToast, i18n.language])

  const openDocument = (document: KbDocument) => {
    navigate(`${CONSOLE_ROUTES.kb}/${document.kb_id}/documents/${document.id}`)
  }

  const resetKbOptions = () => {
    setTagsOpen(false)
    setSelectedTagIds([])
    setAuthorization({ groupIds: [], memberIds: [] })
  }

  const handleKbDialogOpenChange = (open: boolean) => {
    setKbDialogOpen(open)
    if (!open) {
      setEditingKbId(null)
      resetKbOptions()
    }
  }

  const handleEditKb = (kb: Kb) => {
    if (kb.ownership_type !== "system") return
    setEditingKbId(kb.id)
    setSelectedTagIds((kb.tags ?? []).map((tag) => tag.id))
    setAuthorization(selection(kb.grants))
    setTagsOpen(false)
    setKbDialogOpen(true)
  }

  const handleSubmitKb = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const name = String(formData.get("name") ?? "").trim()
    const description = String(formData.get("description") ?? "").trim()
    const tagIds = selectedTagIds.filter((tagId) =>
      availableTags.some((tag) => tag.id === tagId)
    )
    if (!name) return

    await remote.run(async () => {
      const payload = {
        name,
        description,
        tag_ids: tagIds,
        grants: grants(authorization),
      }
      if (!editingKb) {
        await api<ResourceRow>(`${base}/kb`, {
          method: "POST",
          body: JSON.stringify(payload),
        })
      } else {
        await api<ResourceRow>(`${base}/kb/${editingKb.id}`, {
          method: "PUT",
          headers: match(editingKb.revision),
          body: JSON.stringify(payload),
        })
      }
      form.reset()
      handleKbDialogOpenChange(false)
    }, t("resources.operationCompleted"))
  }

  const handleDeleteKb = async () => {
    if (!kbPendingDeletion) return
    await remote.run(async () => {
      await api(`${base}/kb/${kbPendingDeletion.id}`, {
        method: "DELETE",
        headers: match(kbPendingDeletion.revision),
      })
      if (selectedKbId === kbPendingDeletion.id) setSelectedKbId(null)
      setKbPendingDeletion(null)
    }, t("resources.operationCompleted"))
  }

  const setKbEnabled = async (kb: Kb, enabled: boolean) => {
    await remote.run(async () => {
      await api(`${base}/kb/${kb.id}/enabled`, {
        method: "PATCH",
        headers: match(kb.revision),
        body: JSON.stringify({ enabled }),
      })
    }, t("resources.operationCompleted"))
  }

  const handleDocumentDialogOpenChange = (open: boolean) => {
    setDocumentDialogOpen(open)
    if (!open) {
      setDocumentMode("text")
      setEditingDocumentId(null)
    }
  }

  const saveDocument = async (
    input: DocumentInput,
    document?: KbDocument | null
  ) => {
    if (!selectedKb) return
    await api<KbDocument>(
      base +
        (document
          ? `/kb/${selectedKb.id}/documents/${document.id}`
          : `/kb/${selectedKb.id}/documents`),
      {
        method: document ? "PUT" : "POST",
        body: JSON.stringify(input),
      }
    )
    await Promise.all([remote.reload(), reloadDocuments(selectedKb.id)])
  }

  const handleSubmitDocument = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedKb) return
    const form = event.currentTarget
    const formData = new FormData(form)
    const title = String(formData.get("title") ?? "").trim()
    const body = String(formData.get("body") ?? "").trim()
    const files = formData
      .getAll("file")
      .filter((value): value is File => value instanceof File && value.size > 0)

    setDocumentSaving(true)
    try {
      if (editingDocument) {
        if (!title || !body) return
        await saveDocument(
          {
            title,
            source_type: "text",
            content: body,
            size_bytes: body.length,
          },
          editingDocument
        )
      } else if (documentMode === "text") {
        if (!title || !body) return
        await saveDocument({
          title,
          source_type: "text",
          content: body,
          size_bytes: body.length,
        })
      } else {
        if (files.length === 0) return
        for (const file of files) {
          const content = await extractFileContent(file, {
            unsupported: t("pages.knowledgeBases.fileUnsupported"),
            empty: t("pages.knowledgeBases.fileEmpty"),
          })
          await saveDocument({
            title: file.name,
            source_type: "file",
            file_name: file.name,
            mime_type: file.type || "application/octet-stream",
            size_bytes: file.size,
            content,
          })
        }
      }
      form.reset()
      handleDocumentDialogOpenChange(false)
    } catch (reason) {
      showToast({
        status: "error",
        title: reason instanceof Error ? reason.message : String(reason),
      })
    } finally {
      setDocumentSaving(false)
    }
  }

  const handleDeleteDocument = async () => {
    if (!selectedKb || !documentPendingDeletion) return
    await remote.run(async () => {
      await api(
        `${base}/kb/${selectedKb.id}/documents/${documentPendingDeletion.id}`,
        { method: "DELETE" }
      )
      setDocumentPendingDeletion(null)
      await reloadDocuments(selectedKb.id)
    }, t("resources.operationCompleted"))
  }

  const handleRetryDocument = async (document: KbDocument) => {
    if (!selectedKb) return
    await remote.run(async () => {
      await api(`${base}/kb/${selectedKb.id}/documents/${document.id}/retry`, {
        method: "POST",
      })
      await reloadDocuments(selectedKb.id)
    }, t("resources.operationCompleted"))
  }

  const showChunks = async (document: KbDocument) => {
    if (!selectedKb) return
    setChunksDocument(document)
    setChunksLoading(true)
    try {
      const data = await api<{ items: KbChunk[] }>(
        `${base}/kb/${selectedKb.id}/documents/${document.id}/chunks`
      )
      setChunks(data.items ?? [])
    } catch (reason) {
      showToast({
        status: "error",
        title: reason instanceof Error ? reason.message : String(reason),
      })
    } finally {
      setChunksLoading(false)
    }
  }

  const renderList = () => (
    <section className="flex h-[calc(100vh-4rem)] min-h-0 flex-none flex-col gap-4 p-4 pt-0 md:h-[calc(100vh-5rem)]">
      <ResourceList
        page={remote}
        typeLabel={t("pages.knowledgeBases.type")}
        systemLabel={t("pages.knowledgeBases.systemKnowledgeBase")}
        userLabel={t("pages.knowledgeBases.userKnowledgeBase")}
        actions={
          remote.type === "system" ? (
            <Dialog open={kbDialogOpen} onOpenChange={handleKbDialogOpenChange}>
              <DialogTrigger
                render={
                  <Button
                    className="ms-auto shrink-0"
                    onClick={() => {
                      setEditingKbId(null)
                      resetKbOptions()
                    }}
                  />
                }
              >
                <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                {t("pages.knowledgeBases.add")}
              </DialogTrigger>
              <DialogContent
                className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl"
                closeLabel={t("common.close")}
              >
                <form
                  key={editingKb?.id ?? "new-kb"}
                  className="flex min-w-0 flex-col gap-6"
                  onSubmit={handleSubmitKb}
                >
                  <DialogHeader>
                    <DialogTitle>
                      {editingKb
                        ? t("pages.knowledgeBases.editDialogTitle")
                        : t("pages.knowledgeBases.dialogTitle")}
                    </DialogTitle>
                    <DialogDescription>
                      {t("pages.knowledgeBases.dialogDescription")}
                    </DialogDescription>
                  </DialogHeader>
                  <FieldGroup className="gap-4">
                    <Field>
                      <FieldLabel htmlFor="kb-name">
                        {t("pages.knowledgeBases.name")}
                      </FieldLabel>
                      <Input
                        id="kb-name"
                        name="name"
                        defaultValue={editingKb?.name}
                        placeholder={t("pages.knowledgeBases.namePlaceholder")}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="kb-description">
                        {t("pages.knowledgeBases.knowledgeDescription")}
                      </FieldLabel>
                      <Textarea
                        className="max-h-48 min-h-28 min-w-0 resize-y overflow-y-auto [overflow-wrap:anywhere]"
                        id="kb-description"
                        name="description"
                        defaultValue={editingKb?.description}
                        placeholder={t(
                          "pages.knowledgeBases.descriptionPlaceholder"
                        )}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="kb-authorized-users">
                        {t("pages.models.authorizedScope")}
                      </FieldLabel>
                      <AuthorizationSelect
                        groups={subjects.groups}
                        members={subjects.members}
                        id="kb-authorized-users"
                        disabled={remote.pending}
                        value={authorization}
                        onValueChange={setAuthorization}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="kb-tags">
                        {t("pages.knowledgeBases.tags")}
                      </FieldLabel>
                      <SkillTagSelect
                        id="kb-tags"
                        open={tagsOpen}
                        options={availableTags}
                        placeholder={t("pages.knowledgeBases.tagsPlaceholder")}
                        value={selectedTagIds}
                        onOpenChange={setTagsOpen}
                        onValueChange={setSelectedTagIds}
                      />
                    </Field>
                  </FieldGroup>
                  <DialogFooter>
                    <DialogClose
                      render={<Button type="button" variant="outline" />}
                    >
                      {t("pages.knowledgeBases.cancel")}
                    </DialogClose>
                    <Button type="submit">
                      {editingKb
                        ? t("pages.knowledgeBases.save")
                        : t("pages.knowledgeBases.create")}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          ) : null
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {knowledgeBases.map((kb) => (
            <ResourceCard
              key={kb.id}
              disabled={!kb.enabled}
              selectable
              className="cursor-pointer"
              onClick={() => selectKb(kb.id)}
            >
              <CardHeader>
                <div className="flex min-w-0 items-start gap-3">
                  <Avatar size="lg">
                    <AvatarFallback
                      className={
                        kb.ownership_type === "user"
                          ? "text-lg font-normal"
                          : undefined
                      }
                    >
                      {kb.ownership_type === "system" ? (
                        <HugeiconsIcon
                          icon={BookOpenTextIcon}
                          strokeWidth={2}
                        />
                      ) : (
                        getCreatorInitial(kb.user?.name || kb.user?.email || "")
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{kb.name}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("pages.knowledgeBases.contentCount", {
                          count: kb.document_count ?? 0,
                        })}
                        {" · "}
                        {t("pages.knowledgeBases.learnedCount", {
                          learned: kb.learned_count ?? 0,
                          total: kb.document_count ?? 0,
                        })}
                      </p>
                    </div>
                    {kb.ownership_type === "system" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <ResourceCardMenuButton
                              aria-label={t("common.more")}
                              onClick={(event) => event.stopPropagation()}
                            />
                          }
                        >
                          <HugeiconsIcon icon={MoreHorizontalIcon} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <DropdownMenuGroup>
                            <DropdownMenuItem onClick={() => selectKb(kb.id)}>
                              <HugeiconsIcon icon={ViewIcon} strokeWidth={2} />
                              {t("pages.knowledgeBases.viewContents")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void setKbEnabled(kb, !kb.enabled)}
                            >
                              <HugeiconsIcon
                                icon={kb.enabled ? PauseIcon : PlayIcon}
                                strokeWidth={2}
                              />
                              {kb.enabled
                                ? t("pages.knowledgeBases.disable")
                                : t("pages.knowledgeBases.enable")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleEditKb(kb)}>
                              <HugeiconsIcon
                                icon={Edit02Icon}
                                strokeWidth={2}
                              />
                              {t("pages.knowledgeBases.editInfo")}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                          <DropdownMenuSeparator />
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setKbPendingDeletion(kb)}
                            >
                              <HugeiconsIcon
                                icon={Delete02Icon}
                                strokeWidth={2}
                              />
                              {t("pages.knowledgeBases.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p
                  className="line-clamp-2 min-h-10 text-muted-foreground"
                  title={kb.description}
                >
                  {kb.description?.trim() || t("resources.noDescription")}
                </p>
              </CardContent>
              <CardFooter className="min-w-0 border-t">
                <ResourceTagSummary
                  tagIds={(kb.tags ?? []).map((tag) => tag.id)}
                />
              </CardFooter>
            </ResourceCard>
          ))}
        </div>
      </ResourceList>
    </section>
  )

  return (
    <>
      {renderList()}

      <Dialog
        open={Boolean(selectedKb)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedKbId(null)
            setDocumentDialogOpen(false)
            setDocumentPendingDeletion(null)
          }
        }}
      >
        <DialogContent
          className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-5xl"
          closeLabel={t("common.close")}
        >
          {selectedKb && (
            <>
              <div className="flex min-w-0 items-start gap-3 pe-8">
                <Avatar size="lg">
                  <AvatarFallback
                    className={
                      selectedKb.ownership_type === "user"
                        ? "text-lg font-normal"
                        : undefined
                    }
                  >
                    {selectedKb.ownership_type === "system" ? (
                      <HugeiconsIcon icon={BookOpenTextIcon} strokeWidth={2} />
                    ) : (
                      getCreatorInitial(
                        selectedKb.user?.name || selectedKb.user?.email || ""
                      )
                    )}
                  </AvatarFallback>
                </Avatar>
                <DialogHeader className="min-w-0 gap-1 text-start">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle className="truncate text-lg">
                      {selectedKb.name}
                    </DialogTitle>
                    {selectedKb.ownership_type === "user" && (
                      <Badge variant="outline">
                        {t("pages.knowledgeBases.readOnly")}
                      </Badge>
                    )}
                    {!selectedKb.enabled && (
                      <Badge variant="outline">
                        {t("pages.knowledgeBases.disable")}
                      </Badge>
                    )}
                  </div>
                  <DialogDescription>
                    {selectedKb.description}
                  </DialogDescription>
                </DialogHeader>
              </div>

              <dl className="grid gap-4 rounded-xl border p-4 text-sm sm:grid-cols-2">
                {[
                  {
                    label: t("pages.knowledgeBases.authorizedUsers"),
                    value:
                      getAuthorizationNames(selection(selectedKb.grants), t) ||
                      t("pages.knowledgeBases.noAuthorizedUsers"),
                  },
                  {
                    label: t("pages.knowledgeBases.learnedCount", {
                      learned: selectedKb.learned_count ?? 0,
                      total: selectedKb.document_count ?? 0,
                    }),
                    value: selectedKb.capabilities?.channels.includes("vector")
                      ? t("pages.knowledgeBases.retrievalHybrid")
                      : t("pages.knowledgeBases.retrievalLexical"),
                  },
                ].map(({ label, value }) => (
                  <div key={label} className="min-w-0 space-y-1">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="truncate" title={value}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              <Card>
                <CardHeader>
                  <CardTitle>{t("pages.knowledgeBases.contents")}</CardTitle>
                  {selectedKb.ownership_type === "system" && (
                    <CardAction>
                      <Button
                        type="button"
                        onClick={() => {
                          setEditingDocumentId(null)
                          setDocumentMode("text")
                          setDocumentDialogOpen(true)
                        }}
                      >
                        <HugeiconsIcon
                          icon={PlusSignIcon}
                          data-icon="inline-start"
                        />
                        {t("pages.knowledgeBases.addContent")}
                      </Button>
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent className="px-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="ps-6">
                          {t("pages.knowledgeBases.columns.name")}
                        </TableHead>
                        <TableHead>
                          {t("pages.knowledgeBases.columns.type")}
                        </TableHead>
                        <TableHead>
                          {t("pages.knowledgeBases.columns.status")}
                        </TableHead>
                        <TableHead>
                          {t("pages.knowledgeBases.columns.updatedAt")}
                        </TableHead>
                        <TableHead className="pe-6 text-end">
                          {t("pages.knowledgeBases.columns.actions")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documentsLoading && documents.length === 0 ? (
                        <TableRow>
                          <TableCell
                            className="h-28 px-6 text-center text-muted-foreground"
                            colSpan={5}
                          >
                            {t("resources.loading")}
                          </TableCell>
                        </TableRow>
                      ) : documents.length === 0 ? (
                        <TableRow>
                          <TableCell
                            className="h-28 px-6 text-center text-muted-foreground"
                            colSpan={5}
                          >
                            {t("pages.knowledgeBases.emptyContents")}
                          </TableCell>
                        </TableRow>
                      ) : (
                        documents.map((document) => (
                          <TableRow key={document.id}>
                            <TableCell className="max-w-80 ps-6">
                              <div className="min-w-0">
                                <p className="truncate font-medium">
                                  {document.title}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {formatFileSize(document.size_bytes)}
                                  {document.chunk_count > 0
                                    ? ` · ${document.chunk_count} chunks`
                                    : ""}
                                </p>
                                {document.error_message && (
                                  <p
                                    className="line-clamp-2 text-xs text-destructive"
                                    title={document.error_message}
                                  >
                                    {document.error_message}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {t(
                                `pages.knowledgeBases.contentTypes.${document.source_type}`
                              )}
                            </TableCell>
                            <TableCell>
                              <LearningStatusBadge status={document.status} />
                            </TableCell>
                            <TableCell>
                              {dateFormatter.format(
                                new Date(document.updated_at)
                              )}
                            </TableCell>
                            <TableCell className="pe-6">
                              <div className="flex justify-end gap-1">
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={t("pages.knowledgeBases.preview")}
                                  onClick={() => openDocument(document)}
                                >
                                  <HugeiconsIcon icon={ViewIcon} />
                                </Button>
                                {selectedKb.ownership_type === "system" && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger
                                      render={
                                        <Button
                                          type="button"
                                          size="icon-sm"
                                          variant="ghost"
                                          aria-label={t(
                                            "pages.knowledgeBases.columns.actions"
                                          )}
                                        />
                                      }
                                    >
                                      <HugeiconsIcon
                                        icon={MoreHorizontalIcon}
                                      />
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuGroup>
                                        {document.source_type === "text" && (
                                          <DropdownMenuItem
                                            onClick={() => {
                                              openDocument(document)
                                            }}
                                          >
                                            <HugeiconsIcon
                                              icon={Edit02Icon}
                                              strokeWidth={2}
                                            />
                                            {t(
                                              "pages.knowledgeBases.editContent"
                                            )}
                                          </DropdownMenuItem>
                                        )}
                                        <DropdownMenuItem
                                          onClick={() =>
                                            void showChunks(document)
                                          }
                                        >
                                          <HugeiconsIcon
                                            icon={File01Icon}
                                            strokeWidth={2}
                                          />
                                          {t(
                                            "pages.knowledgeBases.manageContents"
                                          )}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onClick={() =>
                                            void handleRetryDocument(document)
                                          }
                                        >
                                          <HugeiconsIcon
                                            icon={Loading03Icon}
                                            strokeWidth={2}
                                          />
                                          {t(
                                            "pages.knowledgeBases.retryLearning"
                                          )}
                                        </DropdownMenuItem>
                                      </DropdownMenuGroup>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuGroup>
                                        <DropdownMenuItem
                                          variant="destructive"
                                          onClick={() =>
                                            setDocumentPendingDeletion(document)
                                          }
                                        >
                                          <HugeiconsIcon
                                            icon={Delete02Icon}
                                            strokeWidth={2}
                                          />
                                          {t(
                                            "pages.knowledgeBases.deleteContent"
                                          )}
                                        </DropdownMenuItem>
                                      </DropdownMenuGroup>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
                <CardFooter className="justify-between border-t text-sm text-muted-foreground">
                  <span>
                    {t("pages.knowledgeBases.learnedSummary", {
                      learned: documents.filter(
                        (item) => item.status === "learned"
                      ).length,
                      total: documents.length,
                    })}
                  </span>
                  {selectedKb.ownership_type === "user" && (
                    <span>{t("pages.knowledgeBases.userReadOnlyHint")}</span>
                  )}
                </CardFooter>
              </Card>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={documentDialogOpen}
        onOpenChange={(open) => {
          if (!documentSaving) handleDocumentDialogOpenChange(open)
        }}
      >
        <DialogContent
          className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl"
          closeLabel={t("common.close")}
        >
          <form
            key={editingDocument?.id ?? "new-document"}
            className="flex min-w-0 flex-col gap-6"
            onSubmit={handleSubmitDocument}
          >
            <DialogHeader>
              <DialogTitle>
                {editingDocument
                  ? t("pages.knowledgeBases.editContentTitle")
                  : t("pages.knowledgeBases.addContentTitle")}
              </DialogTitle>
              <DialogDescription>
                {editingDocument
                  ? t("pages.knowledgeBases.editContentDescription")
                  : t("pages.knowledgeBases.addContentDescription")}
              </DialogDescription>
            </DialogHeader>

            <Tabs
              className="gap-4"
              value={documentMode}
              onValueChange={(value) =>
                setDocumentMode(value as KbDocumentSource)
              }
            >
              {!editingDocument && (
                <FieldGroup className="gap-4">
                  <Field>
                    <FieldLabel>
                      {t("pages.knowledgeBases.contentSource")}
                    </FieldLabel>
                    <TabsList
                      aria-label={t("pages.knowledgeBases.contentSource")}
                      className="w-full"
                    >
                      <TabsTrigger value="text">
                        <HugeiconsIcon
                          icon={TextIcon}
                          data-icon="inline-start"
                        />
                        {t("pages.knowledgeBases.textContent")}
                      </TabsTrigger>
                      <TabsTrigger value="file">
                        <HugeiconsIcon
                          icon={File01Icon}
                          data-icon="inline-start"
                        />
                        {t("pages.knowledgeBases.fileContent")}
                      </TabsTrigger>
                    </TabsList>
                  </Field>
                </FieldGroup>
              )}

              <TabsContent value="text">
                <FieldGroup className="gap-4">
                  <Field>
                    <FieldLabel htmlFor="kb-document-title">
                      {t("pages.knowledgeBases.contentTitle")}
                    </FieldLabel>
                    <Input
                      id="kb-document-title"
                      name="title"
                      defaultValue={editingDocument?.title}
                      placeholder={t(
                        "pages.knowledgeBases.contentTitlePlaceholder"
                      )}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="kb-document-body">
                      {t("pages.knowledgeBases.textContent")}
                    </FieldLabel>
                    <Textarea
                      className="max-h-72 min-h-48 min-w-0 resize-y overflow-y-auto [overflow-wrap:anywhere]"
                      id="kb-document-body"
                      name="body"
                      defaultValue={editingDocument?.content}
                      placeholder={t("pages.knowledgeBases.textPlaceholder")}
                      required
                    />
                  </Field>
                </FieldGroup>
              </TabsContent>

              <TabsContent value="file">
                <FieldGroup className="gap-4">
                  <Field>
                    <FieldLabel htmlFor="kb-document-file">
                      {t("pages.knowledgeBases.selectFile")}
                    </FieldLabel>
                    <Input
                      accept=".txt,.md,.markdown"
                      id="kb-document-file"
                      multiple
                      name="file"
                      type="file"
                      required
                    />
                    <FieldDescription>
                      {t("pages.knowledgeBases.fileDescription")}
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <DialogClose
                disabled={documentSaving}
                render={<Button type="button" variant="outline" />}
              >
                {t("pages.knowledgeBases.cancel")}
              </DialogClose>
              <Button type="submit" loading={documentSaving}>
                {editingDocument
                  ? t("pages.knowledgeBases.saveAndRelearn")
                  : t("pages.knowledgeBases.addAndLearn")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={chunksDocument !== null}
        onOpenChange={(open) => {
          if (!open) {
            setChunksDocument(null)
            setChunks([])
          }
        }}
      >
        <DialogContent
          className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-3xl"
          closeLabel={t("common.close")}
        >
          <DialogHeader>
            <DialogTitle>{chunksDocument?.title}</DialogTitle>
            <DialogDescription>
              {t("pages.knowledgeBases.contents")} · {chunks.length}
            </DialogDescription>
          </DialogHeader>
          {chunksLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("resources.loading")}
            </p>
          ) : (
            <div className="space-y-3">
              {chunks.map((chunk) => (
                <div
                  key={chunk.chunk_id}
                  className="rounded-lg border bg-muted/20 p-3 text-sm"
                >
                  <div className="mb-2 text-xs text-muted-foreground">
                    #{chunk.chunk_index + 1} · {chunk.token_count ?? 0} tokens
                  </div>
                  <pre className="whitespace-pre-wrap font-mono leading-relaxed">
                    {chunk.content}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={kbPendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open) setKbPendingDeletion(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.knowledgeBases.deleteDialogTitle")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {t("pages.knowledgeBases.deleteDialogDescription", {
              knowledgeBase: kbPendingDeletion?.name ?? "",
            })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("pages.knowledgeBases.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleDeleteKb()}
            >
              {t("pages.knowledgeBases.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={documentPendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open) setDocumentPendingDeletion(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.knowledgeBases.deleteContentTitle")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {t("pages.knowledgeBases.deleteContentDescription", {
              content: documentPendingDeletion?.title ?? "",
            })}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("pages.knowledgeBases.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleDeleteDocument()}
            >
              {t("pages.knowledgeBases.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function LearningStatusBadge({ status }: { status: KbDocumentStatus }) {
  const { t } = useTranslation()
  const displayStatus = status === "pending" ? "learning" : status
  const icon =
    displayStatus === "learned"
      ? CheckmarkCircle02Icon
      : displayStatus === "learning"
        ? Loading03Icon
        : AlertCircleIcon

  return (
    <Badge
      variant={
        displayStatus === "learned"
          ? "default"
          : displayStatus === "learning"
            ? "secondary"
            : "destructive"
      }
    >
      <HugeiconsIcon
        className={displayStatus === "learning" ? "animate-spin" : undefined}
        icon={icon}
        data-icon="inline-start"
      />
      {t(`pages.knowledgeBases.statuses.${displayStatus}`)}
    </Badge>
  )
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function extractFileContent(
  file: File,
  messages: { unsupported: string; empty: string }
) {
  const extension = file.name.split(".").pop()?.toLowerCase()
  if (extension !== "txt" && extension !== "md" && extension !== "markdown") {
    throw new Error(messages.unsupported)
  }
  const text = (await file.text()).trim()
  if (!text) {
    throw new Error(messages.empty)
  }
  return text
}
