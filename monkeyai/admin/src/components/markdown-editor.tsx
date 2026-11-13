import { EditorMarkdown, useTiptap } from "@ctzhian/tiptap"
import { createTheme, ThemeProvider } from "@mui/material/styles"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import "@ctzhian/tiptap/dist/index.css"

type MarkdownEditorProps = {
  value: string
  readOnly: boolean
  onChange: (value: string) => void
  onSave: () => void
}

export function MarkdownEditor({
  value,
  readOnly,
  onChange,
  onSave,
}: MarkdownEditorProps) {
  const { t } = useTranslation()
  const saveRef = useRef(onSave)
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
  const { editor } = useTiptap({
    editable: !readOnly,
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
