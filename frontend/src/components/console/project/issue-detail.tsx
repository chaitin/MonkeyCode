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
import { Markdown } from "@/components/common/markdown"
import { useTranslation } from "react-i18next"

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
  const { t } = useTranslation()

  const getIssueStatusName = (status?: ConstsProjectIssueStatus) => {
    switch (status) {
      case ConstsProjectIssueStatus.ProjectIssueStatusOpen:
        return t("consoleProject.issue.status.open")
      case ConstsProjectIssueStatus.ProjectIssueStatusCompleted:
        return t("consoleProject.issue.status.completed")
      case ConstsProjectIssueStatus.ProjectIssueStatusClosed:
        return t("consoleProject.issue.status.closed")
      default:
        return status || "-"
    }
  }


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
        toast.success(t("consoleProject.issue.detail.toast.titleUpdated"))
        setIssueData({ ...issueData, title: newTitle })
        onSuccess?.()
      } else {
        toast.error(resp.message || t("consoleProject.issue.detail.toast.updateFailed"))
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
        toast.success(t("consoleProject.issue.detail.toast.saved"))
        onSuccess?.()
      } else {
        toast.error(resp.message || t("consoleProject.issue.detail.toast.saveFailed"))
      }
    })
    setLoading(false)
  }

  const handleStatusChange = async (status: ConstsProjectIssueStatus) => {
    if (!issueData?.id || loading) return
    
    setLoading(true)
    await apiRequest('v1UsersProjectsIssuesUpdate', { status }, [projectId, issueData?.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleProject.issue.detail.toast.statusUpdated"))
        onSuccess?.()
      } else {
        toast.error(resp.message || t("consoleProject.issue.detail.toast.updateFailed"))
      }
    })
    setLoading(false)
  }

  const handlePriorityChange = async (priority: ConstsProjectIssuePriority) => {
    if (!issueData?.id || loading) return
    
    setLoading(true)
    await apiRequest('v1UsersProjectsIssuesUpdate', { priority }, [projectId, issueData?.id], (resp) => {
      if (resp.code === 0) {
        toast.success(t("consoleProject.issue.detail.toast.priorityUpdated"))
        onSuccess?.()
      } else {
        toast.error(resp.message || t("consoleProject.issue.detail.toast.updateFailed"))
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
                {issueData?.title || t("consoleProject.issue.untitled")}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-row gap-6 max-h-[calc(90vh-120px)]">
          <div className="flex flex-col gap-6 flex-4 overflow-x-auto p-1 -m-1">
            <div className="flex flex-col gap-2">
              <div className="flex flex-row gap-2 items-center">
                <Label className="flex-1">{t("consoleProject.issue.detail.requirement")}</Label>
                {isEditingRequirementDocument ? (
                  <>
                    <Button variant="outline" className="text-xs h-6" size="sm" onClick={() => { 
                      setIsEditingRequirementDocument(false) 
                      setEditingRequirementDocument("")
                    }}>{t("consoleProject.common.cancel")}</Button>
                    <Button variant="default" className="text-xs h-6" size="sm" onClick={() => { saveIssueData() }}>{t("consoleProject.common.save")}</Button>
                  </>
                ) : (
                  <Button variant="outline" className="text-xs h-6" size="sm" onClick={() => { 
                    setEditingRequirementDocument(issueData?.requirement_document || ""); 
                    setIsEditingRequirementDocument(true) 
                  }}>{t("consoleProject.issue.detail.edit")}</Button>
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
                <div className="border rounded-md p-2 min-h-10 bg-muted/40">
                  <Markdown>{issueData?.requirement_document || t("consoleProject.issue.detail.emptyContent")}</Markdown>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex flex-row gap-2 items-center">
                <Label className="flex-1">{t("consoleProject.issue.detail.design")}</Label>
                {isEditingDesignDocument ? (
                  <>
                    <Button variant="outline" className="text-xs h-6" size="sm" onClick={() => { 
                      setIsEditingDesignDocument(false) 
                      setEditingDesignDocument("")
                    }}>{t("consoleProject.common.cancel")}</Button>
                    <Button variant="default" className="text-xs h-6" size="sm" onClick={() => { saveIssueData() }}>{t("consoleProject.common.save")}</Button>
                  </>
                ) : (
                  <Button variant="outline" className="text-xs h-6" size="sm" onClick={() => { 
                    setEditingDesignDocument(issueData?.design_document || ""); 
                    setIsEditingDesignDocument(true) 
                  }}>{t("consoleProject.issue.detail.edit")}</Button>
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
                <div className="border rounded-md p-2 min-h-10 bg-muted/40">
                  <Markdown>{issueData?.design_document || t("consoleProject.issue.detail.emptyContent")}</Markdown>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-6 flex-1 overflow-y-auto pr-2">
            <div className="flex flex-col gap-2">
              <Label>{t("consoleProject.issue.detail.status")}</Label>
              <Select value={issueData?.status} onValueChange={(value) => { handleStatusChange(value as ConstsProjectIssueStatus)}} disabled={loading}>
                <SelectTrigger className="w-full">
                  {loading ? <IconLoader className="size-4 animate-spin" /> : <SelectValue placeholder={t("consoleProject.issue.detail.selectStatus")} />}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ConstsProjectIssueStatus.ProjectIssueStatusOpen}>
                    <IconCircleDot className="text-primary" />
                    {getIssueStatusName(ConstsProjectIssueStatus.ProjectIssueStatusOpen)}
                  </SelectItem>
                  <SelectItem value={ConstsProjectIssueStatus.ProjectIssueStatusCompleted}>
                    <IconCircleCheck className="" />
                    {getIssueStatusName(ConstsProjectIssueStatus.ProjectIssueStatusCompleted)}
                  </SelectItem>
                  <SelectItem value={ConstsProjectIssueStatus.ProjectIssueStatusClosed}>
                    <IconCancel className="" />
                    {getIssueStatusName(ConstsProjectIssueStatus.ProjectIssueStatusClosed)}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t("consoleProject.issue.detail.priority")}</Label>
              <Select value={issueData?.priority?.toString()} onValueChange={(value) => { handlePriorityChange(parseInt(value, 10) as ConstsProjectIssuePriority)}} disabled={loading}>
                <SelectTrigger className="w-full">
                  {loading ? <IconLoader className="size-4 animate-spin" /> : <SelectValue placeholder={t("consoleProject.issue.detail.selectPriority")} />}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ConstsProjectIssuePriority.ProjectIssuePriorityThree.toString()}>
                    <IconCircleChevronsUp className="text-primary" />
                    {t("consoleProject.issue.priority.highShort")}
                  </SelectItem>
                  <SelectItem value={ConstsProjectIssuePriority.ProjectIssuePriorityTwo.toString()}>
                    <IconCircleChevronUp className="text-primary" />
                    {t("consoleProject.issue.priority.mediumShort")}
                  </SelectItem>
                  <SelectItem value={ConstsProjectIssuePriority.ProjectIssuePriorityOne.toString()}>
                    <IconCircleChevronDown />
                    {t("consoleProject.issue.priority.lowShort")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-3 text-sm">
              <Label>{t("consoleProject.issue.detail.creator")}</Label>
              <div className="flex flex-row gap-2 items-center">
                <Avatar className="size-5">
                  <AvatarImage src={issueData?.user?.avatar_url || "/logo-light.png"} />
                  <AvatarFallback>{(issueData?.user?.name || "-").charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span>{issueData?.user?.name || t("consoleProject.issue.detail.unknownUser")}</span>
              </div>
            </div>
            
            <div className="flex flex-col gap-3 text-sm">
              <Label>{t("consoleProject.issue.detail.createdTime")}</Label>
              <span>{issueData?.created_at ? dayjs(issueData?.created_at * 1000).format("YYYY-MM-DD HH:mm") : "-"}</span>
            </div>

            <div className="flex flex-row gap-2 border rounded-md px-2 py-1 bg-muted/30">
              <Label className="flex-1">{t("consoleProject.issue.detail.moreActions")}</Label>
              <IssueMenu issue={issueData} projectId={projectId} project={project} onTaskCreated={onTaskCreated} />
            </div>

          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
