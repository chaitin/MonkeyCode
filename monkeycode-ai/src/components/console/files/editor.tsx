import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { apiRequest } from "@/utils/requestUtils"
import { toast } from "sonner"
import AceEditor from "react-ace"
import "ace-builds/src-noconflict/mode-text"
import "ace-builds/src-noconflict/mode-javascript"
import "ace-builds/src-noconflict/mode-typescript"
import "ace-builds/src-noconflict/mode-python"
import "ace-builds/src-noconflict/mode-json"
import "ace-builds/src-noconflict/mode-yaml"
import "ace-builds/src-noconflict/mode-markdown"
import "ace-builds/src-noconflict/mode-html"
import "ace-builds/src-noconflict/mode-css"
import "ace-builds/src-noconflict/mode-sql"
import "ace-builds/src-noconflict/mode-sh"
import "ace-builds/src-noconflict/mode-dockerfile"
import "ace-builds/src-noconflict/theme-github"
import "ace-builds/src-noconflict/theme-monokai"
import "ace-builds/src-noconflict/ext-language_tools"
import { useTheme } from "@/components/theme-provider"
import { Spinner } from "@/components/ui/spinner"
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty"

interface FileEditorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  path: string | null
  envid: string
}

const getLanguageMode = (fileName: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const modeMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'sh': 'sh',
    'bash': 'sh',
    'zsh': 'sh',
    'fish': 'sh',
    'sql': 'sql',
    'html': 'html',
    'htm': 'html',
    'css': 'css',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'markdown': 'markdown',
    'dockerfile': 'dockerfile',
  }
  return modeMap[ext || ''] || 'text'
}

export default function FileEditor({
  open,
  onOpenChange,
  path,
  envid,
}: FileEditorProps) {
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const { theme } = useTheme()
  const [languageMode, setLanguageMode] = useState("text")

  useEffect(() => {
    if (open && path) {
      setLanguageMode(getLanguageMode(path || ""))
      fetchFileContent()
    } else {
      setContent("")
    }
  }, [open, path])

  const fetchFileContent = async () => {
    if (!path || !envid) return

    setLoading(true)    
    fetch(`/api/v1/users/files/download?id=${envid}&path=${encodeURIComponent(path)}`).then(resp => {
      if (!resp.ok) {
        throw new Error(`${resp.status}`);
      }
      return resp.text()
    }).then(text => {
      setContent(text)
    }).catch(err => {
      toast.error(`文件读取失败：${err.message}`)
    }).finally(() => {
      setLoading(false)
    })
  }

  const handleSave = async () => {
    if (!path || !envid) return

    setSaving(true)
    await apiRequest('v1UsersFilesSaveUpdate', {
      id: envid,
      path: path,
      content: content,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success('文件保存成功')
        onOpenChange(false)
      } else {
        toast.error("文件保存失败: " + resp.message);
      }
    })
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] flex flex-col sm:max-w-[60vw]">
        <DialogHeader>
          <DialogTitle>{path}</DialogTitle>
        </DialogHeader>
          {loading ? (
            <Empty className="bg-muted">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Spinner className="size-6" />
              </EmptyMedia>
            </EmptyHeader>
            </Empty>
          ) : (
            <div className="border h-[60vh]">
              <AceEditor
                mode={languageMode}
                theme={theme === 'dark' ? 'monokai' : 'github'}
                value={content}
                onChange={setContent}
                width="100%"
                height="100%"
                fontSize={14}
                showPrintMargin={false}
                highlightActiveLine={false}
                setOptions={{
                  enableBasicAutocompletion: true,
                  enableLiveAutocompletion: true,
                  enableSnippets: true,
                  showLineNumbers: true,
                  tabSize: 2,
                  useWorker: false,
                }}
              />
            </div>
          )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={loading || saving}>
            {saving && <Spinner className="size-4 mr-2" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

