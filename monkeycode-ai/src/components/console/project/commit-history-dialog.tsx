import { useState, useCallback, useEffect } from "react"
import { apiRequest } from "@/utils/requestUtils"
import { type DomainProjectCommitEntry } from "@/api/Api"
import { IconLoader, IconReport } from "@tabler/icons-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import dayjs from "dayjs"

interface CommitHistoryDialogProps {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const CommitHistoryDialog = ({ projectId, open, onOpenChange }: CommitHistoryDialogProps) => {
  const [historyLogs, setHistoryLogs] = useState<DomainProjectCommitEntry[]>([])
  const [loading, setLoading] = useState(false)

  const fetchHistoryLogs = useCallback(async () => {
    if (!projectId) return
    
    setLoading(true)
    setHistoryLogs([])
    
    await apiRequest('v1UsersProjectsTreeLogsDetail', {
      limit: 50
    }, [projectId], (resp) => {
      if (resp.code === 0 && resp.data?.entries) {
        setHistoryLogs(resp.data.entries)
      }
    })
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    if (open) {
      fetchHistoryLogs()
    }
  }, [open, fetchHistoryLogs])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconReport className="h-5 w-5" />
            修改历史
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto">
          {loading ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconLoader className="animate-spin" />
                </EmptyMedia>
                <EmptyDescription>正在加载...</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : historyLogs.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconReport />
                </EmptyMedia>
                <EmptyDescription>暂无修改记录</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="space-y-2">
              {historyLogs.map((entry, index) => (
                <div
                  key={entry.commit?.sha || index}
                  className="px-4 py-3 border rounded-md hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <Avatar className="size-6 shrink-0">
                      <AvatarImage src="/logo-colored.png" />
                      <AvatarFallback>{(entry.commit?.author?.name || 'U').charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 flex flex-col gap-2">
                      <div className="text-sm break-all whitespace-pre-wrap line-clamp-2">
                        {entry.commit?.message || '无提交信息'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {entry.commit?.author?.name || '未知用户'} 修改于 {entry.commit?.author?.when ? dayjs.unix(entry.commit.author.when).fromNow() : '-'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default CommitHistoryDialog
