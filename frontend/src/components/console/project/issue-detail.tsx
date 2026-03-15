import { ConstsProjectIssuePriority, ConstsProjectIssueStatus, type DomainProjectIssue, type DomainProject } from "@/api/Api"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { apiRequest } from "@/utils/requestUtils"
import { IconCancel, IconCircleCheck, IconCircleChevronDown, IconCircleChevronsUp, IconCircleChevronUp, IconCircleDot, IconLoader } from "@tabler/icons-react"
import dayjs from "dayjs"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import MarkdownEditor from "@/components/common/markdown-editor"
import { Input } from "@/components/ui/input"
import IssueMenu from "./issue-menu"
import { getStatusName } from "@/utils/common"
import { Markdown } from "@/components/common/markdown"

interface ViewIssueDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  issue?: DomainProjectIssue
  projectId: string
  project?: DomainProject
  onSuccess?: () => void
  onTaskCreated?: () => void
}

export default function ViewIssueDialog({
  open,
  onOpenChange,
  issue,
  projectId,
  project,
  onSuccess,
  onTaskCreated,
}: ViewIssueDialogProps) {
  const [loading, setLoading] = useState(false)
  const [issueData, setIssueData] = useState<DomainProjectIssue | undefined>(issue)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editingTitle, setEditingTitle] = useState("")
  const [isEditingRequirementDocument, setIsEditingRequirementDocument] = useState(false)
  const [editingRequirementDocument, setEditingRequirementDocument] = useState("")
  const [isEditingDesignDocument, setIsEditingDesignDocument] = useState(false)
  const [editingDesignDocument, setEditingDesignDocument] = useState("")


  useEffect(() => {
    if (!open) {
      setIsEditingTitle(false)
      setEditingTitle("")
      setIsEditingRequirementDocument(false)
      setEditingRequirementDocument("")
      setIsEditingDesignDocument(false)
      setEditingDesignDocument("")
    }
  }, [open])

  useEffect(() => {
    if (issue) {
      setIssueData(issue)
      setIsEditingTitle(false)
    }
  }, [issue])

  const handleTitleClick = () => {
    setEditingTitle(issueData?.title || "")
    setIsEditingTitle(true)
  }

  const handleTitleSave = async () => {
    if (!issueData?.id || loading) return
    
    const newTitle = editingTitle.trim()
    if (!newTitle || newTitle === issueData.title) {
      setIsEditingTitle(false)
      return
    }

    setLoading(true)
    await apiRequest('v1UsersProjectsIssuesUpdate', { title: newTitle }, [projectId, issueData.id], (resp) => {
      if (resp.code === 0) {
        toast.success("标题更新成功")
        setIssueData({ ...issueData, title: newTitle })
        onSuccess?.()
      } else {
        toast.error(resp.message || "更新失败")
      }
    })
    setLoading(false)
    setIsEditingTitle(false)
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTitleSave()
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false)
    }
  }


  const saveIssueData = async () => {
    if (!issueData?.id || loading) return

    if (editingRequirementDocument) {
      issueData.requirement_document = editingRequirementDocument
    }
    if (editingDesignDocument) {
      issueData.design_document = editingDesignDocument
    }
    
    setLoading(true)
    await apiRequest('v1UsersProjectsIssuesUpdate', issueData, [projectId, issueData?.id], (resp) => {
      if (resp.code === 0) {
        setIsEditingRequirementDocument(false)
        setEditingRequirementDocument("")
        setIsEditingDesignDocument(false)
        setEditingDesignDocument("")
        toast.success("保存成功")
        onSuccess?.()
      } else {
        toast.error(resp.message || "保存失败")
      }
    })
    setLoading(false)
  }

  const handleStatusChange = async (status: ConstsProjectIssueStatus) => {
    if (!issueData?.id || loading) return
    
    setLoading(true)
    await apiRequest('v1UsersProjectsIssuesUpdate', { status }, [projectId, issueData?.id], (resp) => {
      if (resp.code === 0) {
        toast.success("状态更新成功")
        onSuccess?.()
      } else {
        toast.error(resp.message || "更新失败")
      }
    })
    setLoading(false)
  }

  const handlePriorityChange = async (priority: ConstsProjectIssuePriority) => {
    if (!issueData?.id || loading) return
    
    setLoading(true)
    await apiRequest('v1UsersProjectsIssuesUpdate', { priority }, [projectId, issueData?.id], (resp) => {
      if (resp.code === 0) {
        toast.success("优先级更新成功")
        onSuccess?.()
      } else {
        toast.error(resp.message || "更新失败")
      }
    })
    setLoading(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] sm:max-w-[80vw] max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-xl break-all pr-6">
            {isEditingTitle ? (
              <Input
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={handleTitleKeyDown}
                autoFocus
                className="text-xl"
                disabled={loading}
              />
            ) : (
              <span
                onClick={handleTitleClick}
                className="cursor-pointer hover:bg-muted py-1 -my-1 rounded transition-colors"
              >
                {issueData?.title || "无标题"}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-row gap-6 max-h-[calc(90vh-120px)]">
          <div className="flex flex-col gap-6 flex-4 overflow-x-auto p-1 -m-1">
            <div className="flex flex-col gap-2">
              <div className="flex flex-row gap-2 items-center">
                <Label className="flex-1">原始需求</Label>
                {isEditingRequirementDocument ? (
                  <>
                    <Button variant="outline" className="text-xs h-6" size="sm" onClick={() => { 
                      setIsEditingRequirementDocument(false) 
                      setEditingRequirementDocument("")
                    }}>取消</Button>
                    <Button variant="default" className="text-xs h-6" size="sm" onClick={() => { saveIssueData() }}>保存</Button>
                  </>
                ) : (
                  <Button variant="outline" className="text-xs h-6" size="sm" onClick={() => { 
                    setEditingRequirementDocument(issueData?.requirement_document || ""); 
                    setIsEditingRequirementDocument(true) 
                  }}>编辑</Button>
                )}
              </div>
              {isEditingRequirementDocument ? (
                <div className="min-h-100">
                  <MarkdownEditor 
                    value={editingRequirementDocument} 
                    onChange={(value) => { 
                      setEditingRequirementDocument(value)
                    }} />
                </div>
              ) : (
                <div className="border rounded-md p-2 min-h-10 bg-neutral-50">
                  <Markdown>{issueData?.requirement_document || "暂无内容"}</Markdown>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-row gap-2 items-center">
                <Label className="flex-1">技术方案</Label>
                {isEditingDesignDocument ? (
                  <>
                    <Button variant="outline" className="text-xs h-6" size="sm" onClick={() => { 
                      setIsEditingDesignDocument(false) 
                      setEditingDesignDocument("")
                    }}>取消</Button>
                    <Button variant="default" className="text-xs h-6" size="sm" onClick={() => { saveIssueData() }}>保存</Button>
                  </>
                ) : (
                  <Button variant="outline" className="text-xs h-6" size="sm" onClick={() => { 
                    setEditingDesignDocument(issueData?.design_document || ""); 
                    setIsEditingDesignDocument(true) 
                  }}>编辑</Button>
                )}
              </div>
              {isEditingDesignDocument ? (
                <div className="min-h-100">
                  <MarkdownEditor 
                    value={editingDesignDocument} 
                    onChange={(value) => { 
                      setEditingDesignDocument(value)
                    }} />
                </div>
              ) : (
                <div className="border rounded-md p-2 min-h-10 bg-neutral-50">
                  <Markdown>{issueData?.design_document || "暂无内容"}</Markdown>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-6 flex-1 overflow-y-auto pr-2">
            <div className="flex flex-col gap-2">
              <Label>状态</Label>
              <Select value={issueData?.status} onValueChange={(value) => { handleStatusChange(value as ConstsProjectIssueStatus)}} disabled={loading}>
                <SelectTrigger className="w-full">
                  {loading ? <IconLoader className="size-4 animate-spin" /> : <SelectValue placeholder="选择状态" />}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ConstsProjectIssueStatus.ProjectIssueStatusOpen}>
                    <IconCircleDot className="text-primary" />
                    {getStatusName(ConstsProjectIssueStatus.ProjectIssueStatusOpen)}
                  </SelectItem>
                  <SelectItem value={ConstsProjectIssueStatus.ProjectIssueStatusCompleted}>
                    <IconCircleCheck className="" />
                    {getStatusName(ConstsProjectIssueStatus.ProjectIssueStatusCompleted)}
                  </SelectItem>
                  <SelectItem value={ConstsProjectIssueStatus.ProjectIssueStatusClosed}>
                    <IconCancel className="" />
                    {getStatusName(ConstsProjectIssueStatus.ProjectIssueStatusClosed)}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>优先级</Label>
              <Select value={issueData?.priority?.toString()} onValueChange={(value) => { handlePriorityChange(parseInt(value, 10) as ConstsProjectIssuePriority)}} disabled={loading}>
                <SelectTrigger className="w-full">
                  {loading ? <IconLoader className="size-4 animate-spin" /> : <SelectValue placeholder="选择优先级" />}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ConstsProjectIssuePriority.ProjectIssuePriorityThree.toString()}>
                    <IconCircleChevronsUp className="text-primary" />
                    高
                  </SelectItem>
                  <SelectItem value={ConstsProjectIssuePriority.ProjectIssuePriorityTwo.toString()}>
                    <IconCircleChevronUp className="text-primary" />
                    中
                  </SelectItem>
                  <SelectItem value={ConstsProjectIssuePriority.ProjectIssuePriorityOne.toString()}>
                    <IconCircleChevronDown />
                    低
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-3 text-sm">
              <Label>创建者</Label>
              <div className="flex flex-row gap-2 items-center">
                <Avatar className="size-5">
                  <AvatarImage src={issueData?.user?.avatar_url || "/logo-colored.png"} />
                  <AvatarFallback>{(issueData?.user?.name || "-").charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span>{issueData?.user?.name || "未知用户"}</span>
              </div>
            </div>
            
            <div className="flex flex-col gap-3 text-sm">
              <Label>创建时间</Label>
              <span>{issueData?.created_at ? dayjs(issueData?.created_at * 1000).format("YYYY-MM-DD HH:mm") : "-"}</span>
            </div>

            <div className="flex flex-row gap-2 border rounded-md px-2 py-1 bg-muted/30">
              <Label className="flex-1">更多操作</Label>
              <IssueMenu issue={issueData} projectId={projectId} project={project} onTaskCreated={onTaskCreated} />
            </div>

          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

