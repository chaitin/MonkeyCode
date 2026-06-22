import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CirclePlusIcon } from "lucide-react"
import { useRef, useState } from "react"
import { GitBotTasks, type GitBotTasksRef } from "@/components/console/git-bot/git-bot-tasks"
import { GitBotConfig, type GitBotConfigRef } from "@/components/console/git-bot/git-bot-config"
import type { DomainGitBot } from "@/api/Api"
import { CreateGitBotDialog } from "@/components/console/git-bot/create-git-bot-dialog"
import { IconReload } from "@tabler/icons-react"
import { useTranslation } from "react-i18next"

export default function GitBotsPage() {
  const { t } = useTranslation()
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
              <TabsTrigger value="tasks">{t("consoleGitBot.tabs.tasks")}</TabsTrigger>
              <TabsTrigger value="config">{t("consoleGitBot.tabs.config")}</TabsTrigger>
            </TabsList>

            <div className="flex flex-row gap-2">
              {activeTab === "tasks" && <Button variant="outline" onClick={() => gitBotTasksRef.current?.fetchTasks()}>
                <IconReload />
                {t("consoleGitBot.actions.refresh")}
              </Button>}
              {activeTab === "config" && <Button variant="outline" onClick={() => setCreateDialogOpen(true)}>
                <CirclePlusIcon />
                {t("consoleGitBot.actions.create")}
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
