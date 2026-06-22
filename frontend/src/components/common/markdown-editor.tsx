import { useState, useRef } from "react"
import { Api } from "@/api/Api"
import { toast } from "sonner"
import { IconLoader, IconEdit, IconEye } from "@tabler/icons-react"
import AceEditor from "react-ace"
import type { IAceEditor } from "react-ace/lib/types"
import "@/utils/ace-theme"
import "ace-builds/src-noconflict/theme-github"
import "ace-builds/src-noconflict/theme-monokai"
import { Markdown } from "@/components/common/markdown"
import { useTheme } from "@/components/theme-context"
import { useTranslation } from "react-i18next"

interface MarkdownEditorProps {
  disabled?: boolean
  value: string
  onChange: (value: string) => void
  height?: string
  className?: string
  placeholder?: string
  onAddImage?: (imageUrl: string) => void
  defaultMode?: "edit" | "preview"
}

export default function MarkdownEditor({
  disabled = false,
  value,
  onChange,
  height = "100%",
  className = "",
  placeholder,
  onAddImage,
  defaultMode = "edit",
}: MarkdownEditorProps) {
  const [uploading, setUploading] = useState(false)
  const [mode, setMode] = useState<"edit" | "preview">(defaultMode)
  const editorRef = useRef<IAceEditor | null>(null)
  const { resolvedTheme } = useTheme()
  const { t } = useTranslation()

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue

        setUploading(true)
        try {
          const api = new Api()
          const response = await api.api.v1UploaderCreate({
            usage: 'spec',
            file: file,
          })

          if (response.data?.code === 0 && response.data?.data) {
            const imageUrl = response.data.data
            const markdownImage = `![image](${imageUrl})`
            
            // Insert the markdown image at the current cursor position.
            if (editorRef.current) {
              const editor = editorRef.current
              editor.session.insert(editor.getCursorPosition(), markdownImage)
              editor.focus()
            } else {
              // Fall back to appending when the editor ref is unavailable.
              onChange(value + markdownImage)
            }
            onAddImage?.(imageUrl)
            toast.success(t("common.markdownEditor.uploadSuccess"))
          } else {
            toast.error(t("common.markdownEditor.uploadFailedWithMessage", { message: response.data?.message || t("common.markdownEditor.unknownError") }))
          }
        } catch (error) {
          toast.error(t("common.markdownEditor.uploadFailedWithMessage", { message: (error as Error).message }))
        } finally {
          setUploading(false)
        }
        break
      }
    }
  }

  return (
    <div 
      className={`break-all overflow-hidden border rounded-md focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px] bg-background relative h-full flex flex-col ${className}`}
      onPaste={handlePaste}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
        <div className="text-xs text-muted-foreground">
          {mode === "edit" ? t("common.markdownEditor.editMode") : t("common.markdownEditor.previewMode")}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={`p-1.5 rounded-md transition-colors ${
              mode === "preview"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-muted-foreground"
            }`}
            title={t("common.markdownEditor.previewTitle")}
          >
            <IconEye className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={`p-1.5 rounded-md transition-colors ${
              mode === "edit"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-muted-foreground"
            }`}
            title={t("common.markdownEditor.editTitle")}
          >
            <IconEdit className="size-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto relative">
        {uploading && (
          <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconLoader className="size-4 animate-spin" />
              {t("common.markdownEditor.uploadingImage")}
            </div>
          </div>
        )}
        
        {mode === "edit" ? (
          <div className="w-full h-full p-1">
              <AceEditor
                mode="markdown"
                theme={resolvedTheme === "dark" ? "monokai" : "github"}
              width="100%"
              readOnly={disabled}
              height={height}
              onChange={onChange}
              value={value}
              showPrintMargin={false}
              wrapEnabled={true}
              placeholder={placeholder}
              onLoad={(editor) => {
                editorRef.current = editor
              }}
              showGutter={false}
              setOptions={{
                fontFamily: "var(--font-code)",
                fontSize: 12,
              }}
            />
          </div>
        ) : (
          <div className="p-2 prose prose-sm max-w-none h-0">
            {value ? (
              <Markdown allowHtml>{value}</Markdown>
            ) : (
              <p className="text-muted-foreground italic">{placeholder || t("common.markdownEditor.empty")}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
