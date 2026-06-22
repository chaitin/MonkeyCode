import i18n from "@/i18n"

export function taskDetailT(key: string, options?: Record<string, unknown>) {
  return String(i18n.t(`taskDetail.${key}`, options))
}
