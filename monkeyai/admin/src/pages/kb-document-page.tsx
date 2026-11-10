import { useEffect, useRef, useState } from "react"
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
  const blocker = useBlocker(dirty || saving)

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
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])

  useEffect(() => {
    if (!loaded?.writable || !dirty || saving) return
    const timer = window.setTimeout(() => void save(), 10_000)
    return () => window.clearTimeout(timer)
  }, [content, dirty, loaded, saving, title])

  async function save() {
    const current = loadedRef.current
    const currentTitle = titleRef.current
    const currentContent = contentRef.current
    if (
      !current?.writable ||
      savingRef.current ||
      (currentTitle === current.document.title &&
        currentContent === current.document.content) ||
      !currentTitle.trim() ||
      !currentContent.trim()
    )
      return
    savingRef.current = true
    setSaving(true)
    const submitted = { title: currentTitle.trim(), content: currentContent }
    try {
      const document = await api<Document>(path, {
        method: "PUT",
        body: JSON.stringify({
          ...submitted,
          source_type: current.document.source_type,
          file_name: current.document.file_name,
          mime_type: current.document.mime_type,
          size_bytes: new TextEncoder().encode(currentContent).length,
        }),
      })
      setLoaded({ ...current, document })
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
    navigate(`${CONSOLE_ROUTES.kb}?kb=${encodeURIComponent(kbId ?? "")}`)
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
                : saving
                  ? "pages.knowledgeBases.editorSaving"
                  : dirty
                    ? "pages.knowledgeBases.editorUnsaved"
                    : "pages.knowledgeBases.editorClean"
            )}
          </span>
        )}
        {loaded?.writable && (
          <Button
            loading={saving}
            disabled={loading || !dirty || !title.trim() || !content.trim()}
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
          loaded && (
            <MarkdownEditor
              key={path}
              value={content}
              readOnly={readOnly || saving}
              onChange={setContent}
              onSave={() => void save()}
            />
          )
        )}
      </div>
    </section>
  )
}
