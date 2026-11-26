import { knowledgeSourcePreview } from "@/lib/kb-source-preview"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useBlocker, useNavigate, useParams } from "react-router-dom"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

import { useAppToast } from "@/components/animated-toast-provider"
import { MarkdownEditor } from "@/components/markdown-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import { base, type ResourceRow } from "@/lib/resources"
import { CONSOLE_ROUTES } from "@/lib/routes"

type Document = {
  id: string
  kb_id: string
  title: string
  content: string
  file_type?: string | null
  content_editable?: boolean
  has_original?: boolean
  revision?: number
  source_type: "text" | "file"
  file_name: string | null
  mime_type: string | null
}

export default function KbDocumentPage() {
  const { kbId = "", documentId = "" } = useParams()
  return (
    <DocumentEditorPage
      key={`${kbId}/${documentId}`}
      kbId={kbId}
      documentId={documentId}
    />
  )
}

function DocumentEditorPage({
  kbId,
  documentId,
}: {
  kbId: string
  documentId: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showToast } = useAppToast()
  const [loaded, setLoaded] = useState<{
    document: Document
    writable: boolean
  } | null>(null)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(0)
  const uploadingRef = useRef(0)
  const savingRef = useRef(false)
  const loadedRef = useRef(loaded)
  const titleRef = useRef(title)
  const contentRef = useRef(content)
  loadedRef.current = loaded
  titleRef.current = title
  contentRef.current = content
  const path = `${base}/kb/${kbId}/documents/${documentId}`
  const dirty = Boolean(
    loaded &&
    (title.trim() !== loaded.document.title ||
      content !== loaded.document.content)
  )
  const readOnly = !loaded?.writable
  const contentReadOnly = readOnly || loaded?.document.content_editable !== true
  const sourceEditor = ["txt", "html", "svg", "csv"].includes(loaded?.document.file_type ?? "")
  const imageDocument = Boolean(loaded?.document.has_original && ["jpg", "png"].includes(loaded.document.file_type ?? ""))
  const previewable = ["html", "svg"].includes(loaded?.document.file_type ?? "")
  const preview = useMemo(() => {
    if (!previewable) return ""
    try { return knowledgeSourcePreview(content, loaded?.document.file_type ?? "") } catch { return "" }
  }, [content, loaded?.document.file_type, previewable])
  const blocker = useBlocker(dirty || saving || uploading > 0)

  useEffect(() => {
    if (blocker.state !== "blocked") return
    if (!saving && window.confirm(t("pages.knowledgeBases.editorDiscard"))) {
      blocker.proceed()
    } else {
      blocker.reset()
    }
  }, [blocker, saving, t])

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      api<Document>(path, { signal: controller.signal }),
      api<ResourceRow>(`${base}/kb/${kbId}`, { signal: controller.signal }),
    ])
      .then(([document, kb]) => {
        if (controller.signal.aborted) return
        setLoaded({ document, writable: kb.ownership_type === "system" })
        setTitle(document.title)
        setContent(document.content)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [kbId, path])

  useEffect(() => {
    if (!dirty && !uploading) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty, uploading])

  useEffect(() => {
    if (!loaded?.writable || !dirty || saving || uploading) return
    const timer = window.setTimeout(() => void save(), 10_000)
    return () => window.clearTimeout(timer)
  }, [content, dirty, loaded, saving, title, uploading])

  async function uploadImage(file: File, signal: AbortSignal): Promise<string> {
    uploadingRef.current++
    setUploading(uploadingRef.current)
    try {
      if (
        !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
          file.type
        )
      )
        throw new Error(t("pages.knowledgeBases.imageUploadInvalid"))
      if (!file.size || file.size > 32 * 1024 * 1024)
        throw new Error(t("pages.knowledgeBases.imageUploadTooLarge"))
      const form = new FormData()
      form.append("file", file)
      const result = await api<{ url: string }>(
        `${base}/kb/${kbId}/images/upload`,
        {
          method: "POST",
          body: form,
          signal,
        }
      )
      return result.url
    } catch (reason) {
      if (!signal.aborted)
        showToast({
          status: "error",
          title: reason instanceof Error ? reason.message : String(reason),
        })
      throw reason
    } finally {
      uploadingRef.current--
      if (!signal.aborted) setUploading(uploadingRef.current)
    }
  }

  async function save() {
    const current = loadedRef.current
    const currentTitle = titleRef.current
    const currentContent = contentRef.current
    if (
      !current?.writable ||
      savingRef.current ||
      uploadingRef.current > 0 ||
      (currentTitle === current.document.title &&
        currentContent === current.document.content) ||
      !currentTitle.trim()
    )
      return
    savingRef.current = true
    setSaving(true)
    const submitted = { title: currentTitle.trim(), content: current.document.content_editable === true ? currentContent : current.document.content }
    try {
      const document = await api<Document>(path, {
        method: "PUT",
        body: JSON.stringify({
          ...submitted,
          expected_revision: current.document.revision,
          clear_content: current.document.content_editable === true && currentContent === "",
          source_type: current.document.source_type,
          file_name: current.document.file_name,
          mime_type: current.document.mime_type,
          size_bytes: new TextEncoder().encode(currentContent).length,
        }),
      })
      setLoaded({ ...current, document })
      if (contentRef.current === currentContent) setContent(document.content)
      if (titleRef.current.trim() === submitted.title) setTitle(submitted.title)
      showToast({
        status: "success",
        title: t("pages.knowledgeBases.editorSaved"),
      })
    } catch (reason) {
      showToast({
        status: "error",
        title: reason instanceof Error ? reason.message : String(reason),
      })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function back() {
    if (saving) return
    navigate(`${CONSOLE_ROUTES.kb}/${kbId}`)
  }

  return (
    <section
      className="flex h-[calc(100dvh-4rem)] min-h-0 min-w-0 flex-col px-4 pb-4"
      aria-label={t("pages.knowledgeBases.preview")}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("pages.knowledgeBases.back")}
          onClick={back}
          disabled={saving}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} />
        </Button>
        <Input
          className="min-w-0 flex-1"
          aria-label={t("pages.knowledgeBases.contentTitle")}
          value={title}
          readOnly={readOnly}
          disabled={loading || saving || Boolean(error)}
          onChange={(event) => setTitle(event.target.value)}
        />
        {loaded && (
          <span className="text-xs text-muted-foreground">
            {t(
              readOnly
                ? "pages.knowledgeBases.readOnly"
                : uploading > 0
                  ? "pages.knowledgeBases.imageUploading"
                  : saving
                    ? "pages.knowledgeBases.editorSaving"
                    : dirty
                      ? "pages.knowledgeBases.editorUnsaved"
                      : "pages.knowledgeBases.editorClean"
            )}
          </span>
        )}
        {loaded?.document.has_original && <Button variant="outline" render={<a href={`${path}/file/detail`} download />}>{t("pages.knowledgeBases.downloadOriginal")}</Button>}
        {loaded?.document.has_original && ["pdf", "jpg", "png"].includes(loaded.document.file_type ?? "") && <Button variant="outline" render={<a href={`${path}/file/detail?preview=true`} target="_blank" rel="noopener noreferrer" />}>{t("pages.knowledgeBases.previewOriginal")}</Button>}
        {loaded?.writable && (
          <Button
            loading={saving}
            disabled={
              loading ||
              uploading > 0 ||
              !dirty ||
              !title.trim()
            }
            onClick={() => void save()}
          >
            {t("pages.knowledgeBases.saveAndRelearn")}
          </Button>
        )}
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden py-3">
        {loading ? (
          <p role="status">{t("resources.loading")}</p>
        ) : error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : (
          loaded && (imageDocument ? (
            <div data-kb-image-detail className="grid h-full min-h-0 min-w-0 grid-cols-1 grid-rows-[minmax(0,2fr)_minmax(0,3fr)] gap-4 md:grid-cols-2 md:grid-rows-1">
              <div data-kb-image-preview className="flex min-h-0 min-w-0 items-center justify-center overflow-auto rounded-md border p-4">
                <img src={`${path}/file/detail?preview=true`} alt={loaded.document.title} className="h-full w-full object-contain" />
              </div>
              <div data-kb-image-description className="min-h-0 min-w-0 overflow-hidden">
                <MarkdownEditor key={path} value={content} readOnly={contentReadOnly || saving} onChange={setContent} onSave={() => void save()} onImageUpload={uploadImage} />
              </div>
            </div>
          ) : sourceEditor ? (
            <Tabs defaultValue="source" className="flex h-full min-h-0 flex-col">
              {previewable && <TabsList>
                <TabsTrigger value="source">{t("pages.knowledgeBases.sourceCode")}</TabsTrigger>
                <TabsTrigger value="preview">{t("pages.knowledgeBases.preview")}</TabsTrigger>
              </TabsList>}
              <TabsContent value="source" className="min-h-0 flex-1">
                <Textarea className="h-full resize-none [field-sizing:fixed]" aria-label={t("pages.knowledgeBases.textContent")} value={content} readOnly={contentReadOnly || saving} spellCheck={false} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "s") { event.preventDefault(); void save() }
                }} />
              </TabsContent>
              {previewable && <TabsContent value="preview" className="flex min-h-0 flex-1 flex-col gap-2">
                <p className="text-sm text-muted-foreground">{t("pages.knowledgeBases.sourcePreviewNotice")}</p>
                {preview ? <iframe title={t("pages.knowledgeBases.preview")} sandbox="" referrerPolicy="no-referrer" srcDoc={preview} className="min-h-0 w-full flex-1 border" /> : <p role="status">{t("pages.knowledgeBases.sourcePreviewUnavailable")}</p>}
              </TabsContent>}
            </Tabs>
          ) : (
            <MarkdownEditor key={path} value={content} readOnly={contentReadOnly || saving} onChange={setContent} onSave={() => void save()} onImageUpload={uploadImage} />
          ))
        )}
      </div>
    </section>
  )
}
