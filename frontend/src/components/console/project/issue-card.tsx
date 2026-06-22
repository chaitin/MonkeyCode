import { ConstsProjectIssuePriority, ConstsProjectIssueStatus, type DomainProjectIssue, type DomainProject } from "@/api/Api"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import dayjs from "dayjs"
import IssueMenu from "./issue-menu"
import { IconChevronDown, IconCircleDot, IconCancel, IconCircleCheck, IconChevronUp, IconChevronsUp, IconAlertTriangle } from "@tabler/icons-react"
import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { useTranslation } from "react-i18next"

interface IssueCardProps {
  issue: DomainProjectIssue
  projectId: string
  project?: DomainProject
  onViewIssue: (issue: DomainProjectIssue) => void
  onTaskCreated?: () => void
  onIssueDeleted?: () => void
}

export default function IssueCard({ issue, projectId, project, onViewIssue, onTaskCreated, onIssueDeleted }: IssueCardProps) {
  const { t } = useTranslation()

  const statusLabel = useMemo(() => {
    switch (issue.status) {
      case ConstsProjectIssueStatus.ProjectIssueStatusOpen:
        return t("consoleProject.issue.status.open")
      case ConstsProjectIssueStatus.ProjectIssueStatusCompleted:
        return t("consoleProject.issue.status.completed")
      case ConstsProjectIssueStatus.ProjectIssueStatusClosed:
        return t("consoleProject.issue.status.closed")
      default:
        return issue.status || "-"
    }
  }, [issue.status, t])

  const priority = useMemo(() => {
    switch (issue.priority) {
      case ConstsProjectIssuePriority.ProjectIssuePriorityThree:
        return <>
          <IconChevronsUp className="text-primary" />
          {t("consoleProject.issue.priority.high")}
        </>
      case ConstsProjectIssuePriority.ProjectIssuePriorityTwo:
        return <>
          <IconChevronUp className="text-primary" />
          {t("consoleProject.issue.priority.medium")}
        </>
      case ConstsProjectIssuePriority.ProjectIssuePriorityOne:
        return <>
          <IconChevronDown className="" />
          {t("consoleProject.issue.priority.low")}
        </>
      default:
        return null
    }
  }, [issue.priority, t])

  return (
    <div className={cn("border rounded-md flex flex-col group hover:border-primary/50 p-2 gap-1 cursor-default", issue.status === ConstsProjectIssueStatus.ProjectIssueStatusClosed ? "bg-muted/30" : "", issue.status === ConstsProjectIssueStatus.ProjectIssueStatusCompleted ? "bg-muted/30" : "")}>
      <div className="flex flex-row items-center gap-2">
        <Badge
          variant="secondary"
          className={cn(
            issue.status === ConstsProjectIssueStatus.ProjectIssueStatusOpen ? 'text-primary bg-primary/20' : '',
            issue.status === ConstsProjectIssueStatus.ProjectIssueStatusClosed ? 'text-muted-foreground' : '',
            issue.status === ConstsProjectIssueStatus.ProjectIssueStatusCompleted ? 'text-primary' : '',
          )}>
          {issue.status === ConstsProjectIssueStatus.ProjectIssueStatusOpen ? <IconCircleDot /> : null}
          {issue.status === ConstsProjectIssueStatus.ProjectIssueStatusClosed ? <IconCancel /> : null}
          {issue.status === ConstsProjectIssueStatus.ProjectIssueStatusCompleted ? <IconCircleCheck /> : null}
          {statusLabel}
        </Badge>
        <div 
          className={cn("flex-1 text-sm group-hover:text-primary cursor-pointer hover:underline line-clamp-1 break-all", issue.status === ConstsProjectIssueStatus.ProjectIssueStatusClosed && "line-through text-muted-foreground hover:line-through", issue.status === ConstsProjectIssueStatus.ProjectIssueStatusCompleted && "text-muted-foreground")}
          onClick={() => onViewIssue(issue)}
        >
          {issue.title}
        </div>
        <IssueMenu issue={issue} projectId={projectId} project={project} onTaskCreated={onTaskCreated} onIssueDeleted={onIssueDeleted} />
      </div>
      <div className="text-xs text-muted-foreground line-clamp-2 break-all">{issue.summary}</div>
      <Separator className="my-2" />
      <div className="flex flex-row gap-2 items-center text-xs text-muted-foreground">
        <Badge variant="outline" className={cn("flex flex-row gap-1 items-center", issue.status === ConstsProjectIssueStatus.ProjectIssueStatusCompleted ? "text-muted-foreground" : "", issue.status === ConstsProjectIssueStatus.ProjectIssueStatusClosed ? "text-muted-foreground" : "")}>
          {priority}
        </Badge>
        {!issue.design_document && <Badge variant="outline" className={cn(issue.status === ConstsProjectIssueStatus.ProjectIssueStatusCompleted ? "text-muted-foreground" : "", issue.status === ConstsProjectIssueStatus.ProjectIssueStatusClosed ? "text-muted-foreground" : "")}>
          <IconAlertTriangle />
          {t("consoleProject.issue.missingDesign")}
        </Badge>}
        <div className="flex-1 text-right">{t("consoleProject.issue.createdAt", { time: dayjs((issue.created_at || 0) * 1000).fromNow() })}</div>
      </div>
    </div>
  )
}
