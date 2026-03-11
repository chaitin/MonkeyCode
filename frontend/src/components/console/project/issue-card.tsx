import { ConstsProjectIssuePriority, ConstsProjectIssueStatus, type DomainProjectIssue, type DomainProject } from "@/api/Api"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import dayjs from "dayjs"
import IssueMenu from "./issue-menu"
import { IconChevronDown, IconCircleDot, IconCancel, IconCircleCheck, IconChevronUp, IconChevronsUp, IconAlertTriangle } from "@tabler/icons-react"
import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { getStatusName } from "@/utils/common"

interface IssueCardProps {
  issue: DomainProjectIssue
  projectId: string
  project?: DomainProject
  onViewIssue: (issue: DomainProjectIssue) => void
}

export default function IssueCard({ issue, projectId, project, onViewIssue }: IssueCardProps) {

  const priority = useMemo(() => {
    switch (issue.priority) {
      case ConstsProjectIssuePriority.ProjectIssuePriorityThree:
        return <>
          <IconChevronsUp className="text-primary" />
          高优先级
        </>
      case ConstsProjectIssuePriority.ProjectIssuePriorityTwo:
        return <>
          <IconChevronUp className="text-primary" />
          中优先级
        </>
      case ConstsProjectIssuePriority.ProjectIssuePriorityOne:
        return <>
          <IconChevronDown className="" />
          低优先级
        </>
      default:
        return null
    }
  }, [issue.priority])

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
          {getStatusName(issue.status as ConstsProjectIssueStatus)}
        </Badge>
        <div 
          className={cn("flex-1 text-sm group-hover:text-primary cursor-pointer hover:underline line-clamp-1 break-all", issue.status === ConstsProjectIssueStatus.ProjectIssueStatusClosed && "line-through text-muted-foreground hover:line-through", issue.status === ConstsProjectIssueStatus.ProjectIssueStatusCompleted && "text-muted-foreground")}
          onClick={() => onViewIssue(issue)}
        >
          {issue.title}
        </div>
        <IssueMenu issue={issue} projectId={projectId} project={project} />
      </div>
      <div className="text-xs text-muted-foreground line-clamp-2 break-all">{issue.summary}</div>
      <Separator className="my-2" />
      <div className="flex flex-row gap-2 items-center text-xs text-muted-foreground">
        <Badge variant="outline" className={cn("flex flex-row gap-1 items-center", issue.status === ConstsProjectIssueStatus.ProjectIssueStatusCompleted ? "text-muted-foreground" : "", issue.status === ConstsProjectIssueStatus.ProjectIssueStatusClosed ? "text-muted-foreground" : "")}>
          {priority}
        </Badge>
        {!issue.design_document && <Badge variant="outline" className={cn(issue.status === ConstsProjectIssueStatus.ProjectIssueStatusCompleted ? "text-muted-foreground" : "", issue.status === ConstsProjectIssueStatus.ProjectIssueStatusClosed ? "text-muted-foreground" : "")}>
          <IconAlertTriangle />
          缺少设计文档
        </Badge>}
        <div className="flex-1 text-right">{dayjs((issue.created_at || 0) * 1000).fromNow()}创建</div>
      </div>
    </div>
  )
}
