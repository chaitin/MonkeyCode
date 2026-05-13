import { useState, useEffect } from "react"
import { FileText, Save, RotateCcw, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { toast } from "sonner"

const DEFAULT_TEMPLATE = `# 用户指令记忆

本文件记录了用户的指令、偏好和教导，用于在未来的交互中提供参考。

## 格式

### 用户指令条目
用户指令条目应遵循以下格式：

[用户指令摘要]
- Date: {{date}}
- Context: [提及的场景或时间]
- Instructions:
  - [用户教导或指示的内容，逐行描述]

### 项目知识条目
Agent 在任务执行过程中发现的条目应遵循以下格式：

[项目知识摘要]
- Date: {{date}}
- Context: Agent 在执行 [具体任务描述] 时发现
- Category: [代码结构|代码模式|代码生成|构建方法|测试方法|依赖关系|环境配置]
- Instructions:
  - [具体的知识点，逐行描述]

## 去重策略
- 添加新条目前，检查是否存在相似或相同的指令
- 若发现重复，跳过新条目或与已有条目合并
- 合并时，更新上下文或日期信息
- 这有助于避免冗余条目，保持记忆文件整洁

## 条目

[按上述格式记录的记忆条目]
`

const VARIABLES = [
  { name: "date", desc: "当前日期" },
  { name: "datetime", desc: "当前日期时间" },
  { name: "project_name", desc: "项目名称" },
  { name: "user_name", desc: "用户名" },
  { name: "workspace_path", desc: "工作空间路径" },
]

export default function MemoryTemplate() {
  const [template, setTemplate] = useState("")
  const [originalTemplate, setOriginalTemplate] = useState("")
  const [loading, setLoading] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [hasCustomTemplate, setHasCustomTemplate] = useState(false)

  useEffect(() => {
    fetchTemplate()
  }, [])

  const fetchTemplate = async () => {
    try {
      const response = await fetch("/api/v1/users/settings/memory-template", {
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      })
      
      if (response.ok) {
        const data = await response.json()
        if (data.data) {
          setTemplate(data.data)
          setOriginalTemplate(data.data)
          setHasCustomTemplate(true)
        } else {
          setTemplate(DEFAULT_TEMPLATE)
          setOriginalTemplate(DEFAULT_TEMPLATE)
          setHasCustomTemplate(false)
        }
      } else {
        setTemplate(DEFAULT_TEMPLATE)
        setOriginalTemplate(DEFAULT_TEMPLATE)
      }
    } catch (error) {
      console.error("Error fetching template:", error)
      setTemplate(DEFAULT_TEMPLATE)
      setOriginalTemplate(DEFAULT_TEMPLATE)
    }
  }

  const handleSave = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/v1/users/settings/memory-template", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ memory_template: template }),
      })

      if (response.ok) {
        setOriginalTemplate(template)
        setHasCustomTemplate(true)
        toast.success("模板保存成功")
      } else {
        const error = await response.json()
        toast.error(error.message || "保存失败")
      }
    } catch (error) {
      console.error("Error saving template:", error)
      toast.error("保存失败，请重试")
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/v1/users/settings/memory-template", {
        method: "DELETE",
        credentials: "include",
      })

      if (response.ok) {
        setTemplate(DEFAULT_TEMPLATE)
        setOriginalTemplate(DEFAULT_TEMPLATE)
        setHasCustomTemplate(false)
        toast.success("已恢复为默认模板")
      } else {
        toast.error("恢复失败")
      }
    } catch (error) {
      console.error("Error resetting template:", error)
      toast.error("恢复失败")
    } finally {
      setLoading(false)
      setShowResetConfirm(false)
    }
  }

  const hasChanges = template !== originalTemplate

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 mb-4">
        <h2 className="text-lg font-semibold">Memory 模板</h2>
        <p className="text-sm text-muted-foreground">
          自定义 MEMORY.md 初始化模板，新项目创建时将使用此模板
        </p>
      </div>

      <div className="flex-1 flex flex-col min-h-0 rounded-lg border p-4">
        <div className="flex-shrink-0 flex items-center justify-between mb-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">模板内容</label>
            <p className="text-xs text-muted-foreground">
              支持以下变量：
              {VARIABLES.map((v) => (
                <code key={v.name} className="mx-1 px-1 py-0.5 bg-muted rounded text-xs">
                  {`{{${v.name}}}`}
                </code>
              ))}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {hasCustomTemplate && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="size-3" />
                已自定义
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 mb-4">
          <Textarea
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="w-full h-full min-h-[200px] font-mono text-sm resize-none"
            placeholder="输入自定义模板..."
            disabled={loading}
          />
        </div>

        <div className="flex-shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSave}
              disabled={loading || !hasChanges}
              size="sm"
            >
              <Save className="size-4 mr-1" />
              {loading ? "保存中..." : "保存模板"}
            </Button>
            
            <Button
              variant="outline"
              onClick={() => setShowResetConfirm(true)}
              disabled={loading || !hasCustomTemplate}
              size="sm"
            >
              <RotateCcw className="size-4 mr-1" />
              恢复默认
            </Button>
          </div>

          {hasChanges && (
            <span className="text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle className="size-3" />
              有未保存的更改
            </span>
          )}
        </div>
      </div>

      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>恢复默认模板</AlertDialogTitle>
            <AlertDialogDescription>
              确定要恢复为默认模板吗？这将删除您自定义的模板，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowResetConfirm(false)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} className="bg-destructive">
              恢复默认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
