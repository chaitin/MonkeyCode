import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { CalendarDays } from "lucide-react";


export default function TeamManagerDashboard() {

  return (
    <Empty className="bg-muted">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarDays />
        </EmptyMedia>
        <EmptyTitle>敬请期待</EmptyTitle>
        <EmptyDescription>
          别着急，这个功能还没做完
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}