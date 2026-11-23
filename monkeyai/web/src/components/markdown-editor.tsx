import { EditorMarkdown, getExtensions, useTiptap } from "@ctzhian/tiptap"
import { createTheme, ThemeProvider } from "@mui/material/styles"
import { useEffect, useMemo, useRef, useState } from "react"
import type { ClipboardEvent } from "react"
import { useTranslation } from "react-i18next"

import "@ctzhian/tiptap/dist/index.css"

type MarkdownEditorProps = {
  value: string
  readOnly: boolean
  onChange: (value: string) => void
  onSave: () => void
  onImageUpload: (file: File, signal: AbortSignal) => Promise<string>
}

type Position = { row: number; column: number }
type AceContainer = HTMLElement & {
  env?: {
    editor: {
      getCursorPosition: () => Position
      session: {
        doc: {
          createAnchor: (position: Position) => {
            $insertRight: boolean
            getPosition: () => Position
            setPosition: (row: number, column: number) => void
            detach: () => void
          }
        }
        insert: (position: Position, text: string) => Position
        getValue: () => string
      }
    }
  }
}

export function MarkdownEditor({
  value,
  readOnly,
  onChange,
  onSave,
  onImageUpload,
}: MarkdownEditorProps) {
  const { t } = useTranslation()
  const saveRef = useRef(onSave)
  const uploadsRef = useRef(new Set<AbortController>())
  useEffect(() => {
    const uploads = uploadsRef.current
    return () => {
      for (const upload of uploads) upload.abort()
      uploads.clear()
    }
  }, [])

  function pasteImage(event: ClipboardEvent<HTMLDivElement>) {
    if (readOnly) return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    // EditorMarkdown does not expose its Ace ref. Use the editor attached to
    // Ace's container so insertion follows edits made while uploading.
    const ace = (target.closest(".ace_editor") as AceContainer | null)?.env
      ?.editor
    if (!ace) return
    const images = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (!images.length) return
    event.preventDefault()
    event.stopPropagation()
    // The library defers onAceChange; flush the live draft before upload state
    // causes a render with an older controlled value.
    onChange(ace.session.getValue())
    const controller = new AbortController()
    const anchor = ace.session.doc.createAnchor(ace.getCursorPosition())
    anchor.$insertRight = true
    const insert = (text: string) => {
      const end = ace.session.insert(anchor.getPosition(), text)
      anchor.setPosition(end.row, end.column)
      onChange(ace.session.getValue())
    }
    const text = event.clipboardData.getData("text/plain")
    if (text) insert(text)
    uploadsRef.current.add(controller)
    void (async () => {
      try {
        for (const image of images) {
          const url = await onImageUpload(image, controller.signal)
          if (controller.signal.aborted) return
          insert(`\n![](${url})\n`)
        }
      } catch {
        // The upload callback reports errors without changing the draft.
      } finally {
        anchor.detach()
        uploadsRef.current.delete(controller)
      }
    })()
  }
  useEffect(() => {
    saveRef.current = onSave
  }, [onSave])
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  )
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("dark"))
    )
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => observer.disconnect()
  }, [])
  const theme = useMemo(
    () => createTheme({ palette: { mode: dark ? "dark" : "light" } }),
    [dark]
  )
  const previewExtensions = useMemo(
    () =>
      getExtensions({
        editable: false,
        exclude: ["invisibleCharacters", "youtube", "mention"],
      }).filter(
        // This Markdown preview has no TOC. The bundled TOC extension dispatches
        // a stale transaction when image content changes during initialization.
        (extension: { name: string }) => extension.name !== "tableOfContents"
      ),
    []
  )
  const { editor } = useTiptap({
    // Tiptap renders the preview; Ace owns editing.
    editable: false,
    extensions: previewExtensions,
    contentType: "markdown",
    content: value,
    immediatelyRender: true,
    exclude: ["invisibleCharacters", "youtube", "mention"],
    onSave: () => saveRef.current(),
  })

  if (!editor) return <p role="status">{t("resources.loading")}</p>

  return (
    <ThemeProvider theme={theme}>
      <div
        data-markdown-editor
        onPasteCapture={pasteImage}
        onKeyDownCapture={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "s") {
            event.preventDefault()
            if (!readOnly) saveRef.current()
          }
        }}
        className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-background [&>div>div:last-child]:min-h-0 [&>div>div:last-child]:flex-1 [&>div]:flex [&>div]:h-full [&>div]:min-h-0 [&>div]:min-w-0 [&>div]:flex-1 [&>div]:flex-col"
      >
        <EditorMarkdown
          editor={editor}
          value={value}
          readOnly={readOnly ? "true" : undefined}
          height="100%"
          defaultDisplayMode={readOnly ? "preview" : "split"}
          splitMode
          showToolbar={!readOnly}
          showLineNumbers
          placeholder={t("pages.knowledgeBases.textPlaceholder")}
          onAceChange={onChange}
        />
      </div>
    </ThemeProvider>
  )
}
