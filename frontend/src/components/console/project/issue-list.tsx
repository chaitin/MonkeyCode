import { type DomainProjectIssue, type DomainProject } from "@/api/Api";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { CalendarDays } from "lucide-react";
import IssueCard from "./issue-card";

export default function ProjectIssueList({ issues, projectId, project, onViewIssue }: { issues: DomainProjectIssue[], projectId: string, project?: DomainProject, onViewIssue: (issue: DomainProjectIssue) => void }) {
  if (issues.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <Empty className="border flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarDays />
            </EmptyMedia>
            <EmptyTitle>暂无内容</EmptyTitle>
            <EmptyDescription>
              可以点击右上角的 “创建需求”
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }
  
  return (
    <div className="flex-1 rounded-md flex flex-col gap-3">
      {issues.map((issue) => (
        <IssueCard 
          key={issue.id} 
          issue={issue} 
          projectId={projectId}
          project={project}
          onViewIssue={onViewIssue}
        />
      ))}
    </div>
  )
}