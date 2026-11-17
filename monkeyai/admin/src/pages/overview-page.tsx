import { MemberAnalysisPage } from "@/pages/member-analysis-page"
import { RealtimeStatusPage } from "@/pages/realtime-status-page"
import { TaskAnalysisPage } from "@/pages/task-analysis-page"

export function OverviewPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 pt-0">
      <RealtimeStatusPage overviewOnly />
      <MemberAnalysisPage overviewOnly />
      <TaskAnalysisPage overviewOnly />
    </div>
  )
}
