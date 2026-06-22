import { createContext, useContext } from "react"

export const SettingsDialogContext = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null)

export const useSettingsDialog = () => {
  const ctx = useContext(SettingsDialogContext)
  if (!ctx) throw new Error("useSettingsDialog must be used within SettingsDialogContext.Provider")
  return ctx
}
