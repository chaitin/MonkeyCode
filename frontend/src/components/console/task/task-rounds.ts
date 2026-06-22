import { apiRequest } from "@/utils/requestUtils"
import type { MessageType } from "./message"
import { taskDetailT } from "./task-i18n"
import { TaskMessageHandler } from "./task-message-handler"

export async function loadAllTaskRoundMessages(taskId: string, limit = 20): Promise<MessageType[]> {
  const messages: MessageType[] = []
  let cursor: string | undefined
  let hasMore = true
  let errorMessage: string | null = null

  while (hasMore) {
    let pageLoaded = false

    await apiRequest(
      "v1UsersTasksRoundsList",
      {
        id: taskId,
        limit,
        ...(cursor ? { cursor } : {}),
      },
      [],
      (resp) => {
        pageLoaded = true
        if (resp.code !== 0) {
          errorMessage = resp.message || taskDetailT("rounds.loadFailed")
          hasMore = false
          return
        }

        const messageHandler = new TaskMessageHandler()
        messageHandler.pushChunks(resp.data?.chunks ?? [])
        const messageState = messageHandler.finalizeCycle()
        messages.unshift(...messageState.messages)

        cursor = resp.data?.next_cursor ?? undefined
        hasMore = !!resp.data?.has_more && !!cursor
      },
      () => undefined,
    )

    if (!pageLoaded) {
      throw new Error(taskDetailT("rounds.loadFailed"))
    }

    if (errorMessage) {
      throw new Error(errorMessage)
    }
  }

  return messages
}
