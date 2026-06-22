import { MessageItem, type MessageType } from "@/components/console/task/message"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { formatTokens } from "@/utils/common"
import { IconDeviceDesktop, IconFile, IconGitBranch, IconSend, IconTerminal2 } from "@tabler/icons-react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"

function createMockMessages(t: TFunction): MessageType[] {
  return [
    {
      id: "1",
      time: Date.now() - 300000,
      role: "user",
      type: "user_input",
      data: { content: t("taskDetail.chat.mock.userRequest") },
    },
    {
      id: "2",
      time: Date.now() - 270000,
      role: "agent",
      type: "agent_message_chunk",
      data: { content: t("taskDetail.chat.mock.agentReply") },
    },
    {
      id: "3",
      time: Date.now() - 240000,
      role: "user",
      type: "user_input",
      data: { content: t("taskDetail.chat.mock.userFollowup") },
    },
    {
      id: "4",
      time: Date.now() - 240000,
      role: "user",
      type: "user_input",
      data: { content: t("taskDetail.chat.mock.userFollowup") },
    },
    {
      id: "5",
      time: Date.now() - 270000,
      role: "agent",
      type: "agent_message_chunk",
      data: { content: t("taskDetail.chat.mock.agentReply") },
    },
    {
      id: "6",
      time: Date.now() - 270000,
      role: "agent",
      type: "agent_message_chunk",
      data: { content: t("taskDetail.chat.mock.agentReply") },
    },
    {
      id: "7",
      time: Date.now() - 270000,
      role: "agent",
      type: "agent_message_chunk",
      data: { content: t("taskDetail.chat.mock.agentReply") },
    },
    {
      id: "8",
      time: Date.now() - 270000,
      role: "agent",
      type: "agent_message_chunk",
      data: { content: t("taskDetail.chat.mock.agentReply") },
    },
  ]
}

export type PanelType = "files" | "terminal" | "changes" | "preview"

export interface TaskChatSectionProps {
  inputValue: string
  onInputChange: (value: string) => void
  onSend: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  hasPanel: boolean
  activePanel: PanelType | null
  onTogglePanel: (panel: PanelType) => void
  panelsDisabled?: boolean
  taskStats?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
}

function PanelButton({
  active,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  disabled: boolean
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  const { t } = useTranslation()
  const button = (
    <Button
      variant="ghost"
      size="sm"
      className={cn("h-6 min-w-0 px-2 gap-1 text-xs font-normal", active && "text-primary bg-accent")}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon className="size-3.5" />
      {label}
    </Button>
  )
  if (disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">{button}</span>
        </TooltipTrigger>
        <TooltipContent>{t("taskDetail.panels.disabledTooltip")}</TooltipContent>
      </Tooltip>
    )
  }
  return button
}

export function TaskChatSection({
  inputValue,
  onInputChange,
  onSend,
  onKeyDown,
  hasPanel,
  activePanel,
  onTogglePanel,
  panelsDisabled = false,
  taskStats,
}: TaskChatSectionProps) {
  const { t } = useTranslation()
  const mockMessages = createMockMessages(t)
  const totalTokens = taskStats?.total_tokens ?? ((taskStats?.input_tokens ?? 0) + (taskStats?.output_tokens ?? 0))
  const formattedTotalTokens = formatTokens(totalTokens) || "-"
  const formattedInputTokens = formatTokens(taskStats?.input_tokens) || "-"
  const formattedOutputTokens = formatTokens(taskStats?.output_tokens) || "-"

  return (
    <div className="flex flex-col h-full min-h-0 gap-4">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className={cn("flex flex-col gap-4", hasPanel ? "max-w-full" : "mx-auto max-w-[800px]")}>
          {mockMessages.map((msg) => (
            <MessageItem key={msg.id} message={msg} />
          ))}
        </div>
      </div>
      <div className="shrink-0 bg-background">
        <div className={cn("flex flex-col gap-2", hasPanel ? "max-w-full" : "mx-auto max-w-[800px]")}>
          <InputGroup className="rounded-lg">
            <InputGroupTextarea
              className="min-h-10 max-h-32 text-sm break-all resize-none"
              placeholder={t("taskDetail.chat.followupPlaceholder")}
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <InputGroupAddon align="block-end" className="flex justify-end">
              <InputGroupButton
                variant="default"
                size="sm"
                onClick={onSend}
                disabled={!inputValue.trim()}
                className="gap-1"
              >
                <IconSend className="size-4" />
                {t("taskDetail.common.send")}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-0.5">
              <PanelButton
                active={activePanel === "files"}
                disabled={panelsDisabled}
                icon={IconFile}
                label={t("taskDetail.panels.files")}
                onClick={() => onTogglePanel("files")}
              />
              <PanelButton
                active={activePanel === "terminal"}
                disabled={panelsDisabled}
                icon={IconTerminal2}
                label={t("taskDetail.panels.terminal")}
                onClick={() => onTogglePanel("terminal")}
              />
              <PanelButton
                active={activePanel === "changes"}
                disabled={panelsDisabled}
                icon={IconGitBranch}
                label={t("taskDetail.panels.changes")}
                onClick={() => onTogglePanel("changes")}
              />
              <PanelButton
                active={activePanel === "preview"}
                disabled={panelsDisabled}
                icon={IconDeviceDesktop}
                label={t("taskDetail.panels.preview")}
                onClick={() => onTogglePanel("preview")}
              />
            </div>
            {(taskStats?.input_tokens != null || taskStats?.output_tokens != null || taskStats?.total_tokens != null) ? (
              <span className="text-xs text-muted-foreground shrink-0">
                <span className="sm:hidden">
                  {t("taskDetail.panels.tokenStatsCompact", { total: formattedTotalTokens })}
                </span>
                <span className="hidden sm:inline">
                  {t("taskDetail.panels.tokenStatsFull", {
                    input: formattedInputTokens,
                    output: formattedOutputTokens,
                  })}
                </span>
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
