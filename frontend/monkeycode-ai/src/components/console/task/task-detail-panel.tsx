import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { IconCaretRightFilled, IconDeviceImac, IconFileText, IconLoader, IconReload, IconX } from "@tabler/icons-react"
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
import "ace-builds/src-noconflict/mode-c_cpp"
import "ace-builds/src-noconflict/mode-csharp"
import "ace-builds/src-noconflict/mode-golang"
import "ace-builds/src-noconflict/mode-ruby"
import "ace-builds/src-noconflict/mode-rust"
import "ace-builds/src-noconflict/mode-perl"
import "ace-builds/src-noconflict/mode-swift"
import "ace-builds/src-noconflict/mode-lua"
import "ace-builds/src-noconflict/mode-php"
import "ace-builds/src-noconflict/mode-java"
import "@/utils/ace-theme"
import React from "react"
import { toast } from "sonner"
import { apiRequest } from "@/utils/requestUtils"
import { FileText } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Markdown } from "@/components/common/markdown"
import JsonView from "@uiw/react-json-view"
import { githubLightTheme } from "@uiw/react-json-view/githubLight"
import { uint8ArrayToBase64 } from "@/utils/common"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { TaskWebSocketManager } from "./ws-manager"

const getLanguageMode = (fileName: string): string => {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const modeMap: Record<string, string> = {
    'bash': 'sh',
    'c': 'c_cpp',
    'cpp': 'c_cpp',
    'cs': 'csharp',
    'fish': 'sh',
    'go': 'golang',
    'h': 'c_cpp',
    'htm': 'html',
    'html': 'html',
    'hpp': 'c_cpp',
    'java': 'java',
    'js': 'javascript',
    'jsx': 'javascript',
    'lua': 'lua',
    'markdown': 'markdown',
    'md': 'markdown',
    'php': 'php',
    'pl': 'perl',
    'py': 'python',
    'rb': 'ruby',
    'rs': 'rust',
    'sh': 'sh',
    'swift': 'swift',
    'sql': 'sql',
    'ts': 'typescript',
    'tsx': 'typescript',
    'yml': 'yaml',
    'yaml': 'yaml',
    'zsh': 'sh',
  }
  return modeMap[ext || ''] || 'text'
}

const languageMode = (path: string) => {
  return path ? getLanguageMode(path) : 'text'
}

interface TaskDetailPanelProps {
  envid?: string
  taskManager: TaskWebSocketManager | null
}

export interface TaskDetailPanelRef {
  openFile: (path: string) => Promise<FileItem | null>
}

enum TaskDetailMode {
  Preview = "preview",
  Text = "text",
}

interface FileItem {
  name: string
  path: string
  bytes: Uint8Array | null
  showMode: TaskDetailMode
  content: string | null
  changed: boolean
  disableEdit: boolean
}

const pictureExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']
const videoExtensions = ['.mp4', '.webm', '.ogv', '.mov', '.avi', '.mkv']
const audioExtensions = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a', '.wma']
const pdfExtensions = ['.pdf']
const htmlExtensions = ['.html', '.htm']
const jsonExtensions = ['.json']
const markdownExtensions = ['.md', '.markdown']


const disableEditExtensions = [
  ...pictureExtensions,
  ...videoExtensions,
  ...audioExtensions,
  ...pdfExtensions
]

export const TaskDetailPanel = React.forwardRef<TaskDetailPanelRef, TaskDetailPanelProps>(
  ({ envid, taskManager }, ref) => {
  const [fileLoading, setFileLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [showFilesDropdownMenu, setShowFilesDropdownMenu] = React.useState(false)
  const [fileList, setFileList] = React.useState<FileItem[]>([])
  const [currentFilePath, setCurrentFilePath] = React.useState<string | null>(null)

  const currentFile = React.useMemo(() => 
    fileList.find((file) => file.path === currentFilePath) || null
  , [fileList, currentFilePath])

  const fetchFile = async (path: string) => {
    let bytes: Uint8Array | null = null
    let content: string | null = null

    setFileLoading(true)

    if (taskManager) {
      bytes = await taskManager.getFileContent(path)
      if (bytes) {
        content = new TextDecoder().decode(bytes)
      } else {
        toast.error(`文件读取失败`)
      }
    }

    setFileLoading(false)

    return {
      bytes: bytes,
      content: content,
    }
  }

  const openFile = React.useCallback(async (path: string): Promise<FileItem | null> => {
    if (!envid || !path) {
      return null
    }

    // 检查文件是否已打开
    const existingFile = fileList.find((file) => file.path === path)
    if (existingFile) {
      setCurrentFilePath(path)
      return existingFile
    }
    
    const result = await fetchFile(path)

    if (!result || result.bytes === null || result.content === null) {
      return null
    }

    const ext = path.substring(path.lastIndexOf('.')).toLowerCase()

    const file: FileItem = {
      name: path.split('/').pop() || path,
      path: path,
      bytes: result.bytes,
      showMode: TaskDetailMode.Preview,
      content: result.content,
      changed: false,
      disableEdit: disableEditExtensions.includes(ext),
    }

    setFileList((prevList) => [...prevList, file])
    setCurrentFilePath(path)

    return file

  }, [envid, fileList, taskManager])

  React.useImperativeHandle(ref, () => ({
    openFile,
  }), [openFile])

  const changeMode = (value: TaskDetailMode) => {
    if (!value || !currentFilePath || currentFile?.disableEdit) {
      return
    }
    setFileList((prevList) =>
      prevList.map((file) => file.path === currentFilePath ? { ...file, showMode: value } : file)
    )
  }

  const reloadFile = async () => {
    if (!currentFile || !currentFilePath) {
      return
    }
    const result = await fetchFile(currentFilePath)
    if (!result || !result.bytes || !result.content) {
      return
    }

    setFileList((prevList) =>
      prevList.map((file) => file.path === currentFilePath ? {
        ...file,
        bytes: result.bytes,
        content: result.content,
        changed: false,
      } : file)
    )
    toast.success(`文件 ${currentFilePath} 已重新加载`)
  }

  const closeFile = () => {
    const newList = fileList.filter((file) => file.path !== currentFilePath)
    setFileList(newList)
    setCurrentFilePath(newList.length > 0 ? newList[0].path : null)
  }

  const saveFile = async () => {
    if (!currentFile || !currentFilePath || !envid) return

    setSaving(true)
    await apiRequest('v1UsersFilesSaveUpdate', {
      id: envid,
      path: currentFilePath,
      content: currentFile.content,
    }, [], (resp) => {
      if (resp.code === 0) {
        toast.success('文件保存成功')
        setFileList((prevList) =>
          prevList.map((file) => file.path === currentFilePath ? { ...file, changed: false } : file)
        )
      } else {
        toast.error("文件保存失败: " + resp.message)
      }
    })
    setSaving(false)
  }

  const renderHeader = () => {
    return (
      <div className="flex items-center px-3 py-2 border-b bg-muted/50 gap-1">
        <DropdownMenu open={showFilesDropdownMenu} onOpenChange={setShowFilesDropdownMenu}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="size-6 shrink-0" onClick={() => setShowFilesDropdownMenu(!showFilesDropdownMenu)}>
              <IconCaretRightFilled className={cn(`transition-transform duration-200`, showFilesDropdownMenu ? "rotate-90" : "")} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {fileList.map((file) => (
              <DropdownMenuItem key={file.path} onClick={() => setCurrentFilePath(file.path)} className={cn(currentFilePath === file.path ? "text-primary" : "")}>
                <IconFileText />
                {file.path}
                {file.changed && <span className="text-muted-foreground text-xs">(未保存)</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Label className="flex-1 text-sm truncate h-6">{currentFile?.name}</Label>

        {currentFile?.changed && (
          <Button size="sm" className="h-6 text-xs" onClick={saveFile} disabled={saving}>
            {saving ? <IconLoader className="animate-spin" /> : null}
            保存
          </Button>
        )}
        <ToggleGroup type="single" variant="outline" size="sm" value={currentFile?.showMode} onValueChange={changeMode} className="hidden sm:flex">
          <ToggleGroupItem value={TaskDetailMode.Text} className="size-6 data-[state=off]:text-muted-foreground/50 data-[state=on]:text-foreground data-[state=on]:bg-transparent data-[state=off]:bg-transparent data-[state=off]:hover:bg-muted data-[state=on]:bg-muted">
            <FileText className="size-3" />
          </ToggleGroupItem>
          <ToggleGroupItem value={TaskDetailMode.Preview} className="size-6 data-[state=off]:text-muted-foreground/50 data-[state=on]:text-foreground data-[state=on]:bg-transparent data-[state=off]:bg-transparent data-[state=off]:hover:bg-muted data-[state=on]:hover:bg-muted">
            <IconDeviceImac className="size-3" />
          </ToggleGroupItem>
        </ToggleGroup>

        <Button variant="ghost" size="icon" className="size-6 shrink-0" onClick={reloadFile} disabled={fileLoading} >
          <IconReload className={fileLoading ? "animate-spin" : ""} />
        </Button>
        <Button variant="ghost" size="icon" className="size-6 shrink-0"onClick={closeFile} >
          <IconX />
        </Button>
      </div>
    )
  }

  const renderContent = () => {
    if (!currentFile) {
      return (
        <Empty className="opacity-50">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFileText />
            </EmptyMedia>
            <EmptyDescription>暂无内容</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }

    if (fileLoading) {
      return (
        <Empty className="opacity-50">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconLoader className="animate-spin" />
            </EmptyMedia>
          </EmptyHeader>
        </Empty>
      )
    }

    if (currentFile?.showMode === TaskDetailMode.Preview) {
      const ext = currentFile.path.substring(currentFile.path.lastIndexOf('.')).toLowerCase()

      if (markdownExtensions.includes(ext)) {
        return (
          <div className="p-3 h-full overflow-y-auto">
            <Markdown allowInternalLink={false}>{currentFile.content || ''}</Markdown>
          </div>
        )
      }
  
      if (pictureExtensions.includes(ext)) {
        const dataUrl = `data:image/png;base64,${uint8ArrayToBase64(currentFile.bytes || new Uint8Array())}`
        return (
          <div className="p-2 h-full overflow-y-auto flex items-center justify-center">
            <img src={dataUrl} alt="图片" className="max-w-full max-h-full object-contain" />
          </div>
        )
      }

      if (audioExtensions.includes(ext)) {
        const dataUrl = `data:audio/mp3;base64,${uint8ArrayToBase64(currentFile.bytes || new Uint8Array())}`
        return (
          <div className="p-4 h-full flex items-center justify-center">
            <audio controls className="w-full max-w-md">
              <source src={dataUrl} />
              您的浏览器不支持音频播放
            </audio>
          </div>
        )
      }

      if (videoExtensions.includes(ext)) {
        const dataUrl = `data:video/mp4;base64,${uint8ArrayToBase64(currentFile.bytes || new Uint8Array())}`
        return (
          <div className="p-2 h-full flex items-center justify-center">
            <video controls className="max-w-full max-h-full">
              <source src={dataUrl} />
              您的浏览器不支持视频播放
            </video>
          </div>
        )
      }

      if (pdfExtensions.includes(ext)) {
        const dataUrl = `data:application/pdf;base64,${uint8ArrayToBase64(currentFile.bytes || new Uint8Array())}`
        return (
          <div className="h-full w-full">
            <iframe
              src={dataUrl}
              className="w-full h-full border-0"
              title="PDF 预览"
            />
          </div>
        )
      }

      if (htmlExtensions.includes(ext)) {
        return (
          <div className="p-2 h-full overflow-auto text-sm">
            <iframe
              srcDoc={currentFile.content || ''}
              className="w-full h-full border-0"
              sandbox="allow-scripts"
              title="HTML 预览"
            />
          </div>
        )
      }

      if (jsonExtensions.includes(ext)) {
        try {
          const jsonData = JSON.parse(currentFile.content || '')
          return (
            <div className="p-2 h-full overflow-auto text-sm">
              <JsonView
                value={jsonData}
                style={{...githubLightTheme, '--w-rjv-background-color': 'transparent'} as any}
                displayDataTypes={false}
                enableClipboard={false}
              />
            </div>
          )
        } catch {
          // JSON 解析失败，回退到文本模式
        }
      }
    }


    return (
      <AceEditor
        mode={languageMode(currentFile.path)}
        onChange={(value) => {
          setFileList((prevList) =>
            prevList.map((file) => file.path === currentFilePath ? { ...file, content: value, changed: true } : file)
          )
        }}
        theme="monkeycode"
        width="100%"
        height={"100%"}
        value={currentFile.content || ''}
        showPrintMargin={false}
        showGutter={true}
        setOptions={{
          fontFamily: "var(--font-google-sans-code)",
          fontSize: 12,
        }}
      />
    )
  }

  return (
    <div className="flex flex-col w-full h-full border rounded-md overflow-hidden">
      {currentFile && renderHeader()}
      {renderContent()}
    </div>
  )
})

TaskDetailPanel.displayName = 'TaskDetailPanel'
