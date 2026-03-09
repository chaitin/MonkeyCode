import {
  BookOpenIcon,
  CalendarDays,
  ExternalLink
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export default function IDEIDE() {
  return (
    <Empty className="bg-muted">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarDays />
        </EmptyMedia>
        <EmptyTitle>敬请期待</EmptyTitle>
        <EmptyDescription>
          别着急，这个功能虽然还没开发完，但是已经开源了
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <a href="https://github.com/chaitin/MonkeyCode" target="_blank">
              <ExternalLink />
              开源仓库
            </a>
          </Button>
          <Button>
            <BookOpenIcon />
            <a href="https://monkeycode.docs.baizhi.cloud/node/019a6cdd-28c5-74ce-a39b-859e15a06c95" target="_blank">阅读文档</a>
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  )
}

