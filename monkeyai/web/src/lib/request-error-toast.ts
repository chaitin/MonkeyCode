import type { ToastInput } from "@/components/motion/animated-toast-stack"
import { ApiError } from "./api"

export function requestErrorToast(
  error: unknown,
  retry?: ToastInput["action"]
): ToastInput {
  return {
    status: "error",
    title: error instanceof Error ? error.message : String(error),
    action: error instanceof ApiError && error.status === 403 ? undefined : retry,
  }
}
