import { type DomainProjectIssue } from "@/api/Api";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { CalendarDays } from "lucide-react";
import IssueCard from "./issue-card";

export default function ProjectIssueList({ issues, projectId, onViewIssue }: { issues: DomainProjectIssue[], projectId: string, onViewIssue: (issue: DomainProjectIssue) => void }) {
  if (issues.length === 0) {
    return (
      <Empty className="border">
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
    )
  }
  
  return (
    <div className="flex-1 rounded-md flex flex-col gap-3">
      {issues.map((issue) => (
        <IssueCard 
          key={issue.id} 
          issue={issue} 
          projectId={projectId} 
          onViewIssue={onViewIssue}
        />
      ))}
    </div>
  )
}