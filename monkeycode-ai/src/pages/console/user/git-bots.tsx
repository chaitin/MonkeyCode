import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CirclePlusIcon } from "lucide-react"
import { useRef, useState } from "react"
import { GitBotTasks, type GitBotTasksRef } from "@/components/console/git-bot/git-bot-tasks"
import { GitBotConfig, type GitBotConfigRef } from "@/components/console/git-bot/git-bot-config"
import type { DomainGitBot } from "@/api/Api"
import { CreateGitBotDialog } from "@/components/console/git-bot/create-git-bot-dialog"
import { IconReload } from "@tabler/icons-react"

export default function GitBotsPage() {
  const [activeTab, setActiveTab] = useState("tasks")
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const gitBotTasksRef = useRef<GitBotTasksRef>(null)
  const gitBotConfigRef = useRef<GitBotConfigRef>(null)

  const handleCreateSuccess = (bot: DomainGitBot) => {
    setActiveTab("config")
    gitBotConfigRef.current?.fetchGitBots()
    gitBotConfigRef.current?.showWebhook(bot)
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex flex-1">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex flex-row justify-between">
            <TabsList>
              <TabsTrigger value="tasks">审查任务</TabsTrigger>
              <TabsTrigger value="config">机器人</TabsTrigger>
            </TabsList>

            <div className="flex flex-row gap-2">
              {activeTab === "tasks" && <Button variant="outline" onClick={() => gitBotTasksRef.current?.fetchTasks()}>
                <IconReload />
                刷新
              </Button>}
              {activeTab === "config" && <Button variant="outline" onClick={() => setCreateDialogOpen(true)}>
                <CirclePlusIcon />
                创建审查机器人
              </Button>}
            </div>
          </div>
          <TabsContent value="tasks" className="w-full mt-2">
            <GitBotTasks ref={gitBotTasksRef} />
          </TabsContent>
          <TabsContent value="config" className="w-full mt-2">
            <GitBotConfig ref={gitBotConfigRef} />
          </TabsContent>
        </Tabs>
      </div>
      <CreateGitBotDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} onSuccess={handleCreateSuccess} />
    </div>
  )
}
