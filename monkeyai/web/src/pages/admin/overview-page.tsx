import { MemberAnalysisPage } from "./member-analysis-page"
import { RealtimeStatusPage } from "./realtime-status-page"
import { TaskAnalysisPage } from "./task-analysis-page"

export function OverviewPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 p-4 pt-0">
      <RealtimeStatusPage overviewOnly />
      <MemberAnalysisPage overviewOnly />
      <TaskAnalysisPage overviewOnly />
    </div>
  )
}
