import { type DomainProjectIssue } from "@/api/Api"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { IconDeviceImacCode, IconSparkles, IconTrash } from "@tabler/icons-react"
import { MoreVertical } from "lucide-react"
import { useState } from "react"
import IssueDesignDialog from "./issue-design-dialog"
import IssueDevelopDialog from "./issue-dev-dialog"

interface IssueMenuProps {
  issue?: DomainProjectIssue
  projectId: string
}

export default function IssueMenu({ issue, projectId }: IssueMenuProps) {
  const [designDialogOpen, setDesignDialogOpen] = useState(false)
  const [developDialogOpen, setDevelopDialogOpen] = useState(false)

  if (!issue) {
    return null
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setDesignDialogOpen(true)}>
            <IconSparkles />
            启动设计任务
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDevelopDialogOpen(true)}>
            <IconDeviceImacCode />
            启动开发任务
          </DropdownMenuItem>
          <DropdownMenuItem>
            <IconTrash />
            移除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <IssueDesignDialog
        open={designDialogOpen}
        onOpenChange={setDesignDialogOpen}
        issue={issue}
        projectId={projectId}
      />
      <IssueDevelopDialog
        open={developDialogOpen}
        onOpenChange={setDevelopDialogOpen}
        issue={issue}
        projectId={projectId}
      />
    </>
  )
}

