import type { MessageType } from "../message";
import { taskDetailT } from "../task-i18n";

export const renderTitle = (_message: MessageType) => {
  return taskDetailT("toolcall.abuseReported")
}

export const renderDetail = (_message: MessageType) => {
  return null
}
