"use client"

import * as React from "react"
import {
  Bell,
  Bot,
  Blocks,
  Box,
  HardDrive,
  MonitorCloud,
  Settings,
} from "lucide-react"
import { IconPasswordFingerprint } from "@tabler/icons-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { useGitHubSetupCallback } from "@/hooks/useGitHubSetupCallback"
import { useCommonData } from "@/components/console/data-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

import Images from "./images"
import Models from "./models"
import Hosts from "./hosts"
import Identities from "./identities"
import VmsPage from "./vms"
import Notifications from "./notifications"
import ToolsAndMcp from "./tools-mcp"
import { useTranslation } from "react-i18next"

const SETTINGS_NAV = [
  { id: "identities", icon: IconPasswordFingerprint },
  { id: "tools-mcp", icon: Blocks },
  { id: "models", icon: Bot },
  { id: "images", icon: Box },
  { id: "hosts", icon: HardDrive },
  { id: "vms", icon: MonitorCloud },
  { id: "notifications", icon: Bell },
] as const

type SettingsSectionId = (typeof SETTINGS_NAV)[number]["id"]

function SettingsContent({ section }: { section: SettingsSectionId }) {
  switch (section) {
    case "identities":
      return <Identities />
    case "tools-mcp":
      return <ToolsAndMcp />
    case "models":
      return <Models />
    case "images":
      return <Images />
    case "hosts":
      return <Hosts />
    case "vms":
      return <VmsPage />
    case "notifications":
      return <Notifications />
    default:
      return <Identities />
  }
}

function SettingsNavContent({
  activeSection,
  onSectionChange,
}: {
  activeSection: SettingsSectionId
  onSectionChange: (id: SettingsSectionId) => void
}) {
  const { t } = useTranslation()

  return (
    <Sidebar collapsible="none" className="w-12 shrink-0 border-r md:w-44">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 pt-2 pb-4 font-semibold text-md">
          <Settings className="size-4 shrink-0" />
          <span className="hidden sm:inline">{t("consoleSettings.dialog.sidebarTitle")}</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {SETTINGS_NAV.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={activeSection === item.id}
                    onClick={() => onSectionChange(item.id)}
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="hidden sm:inline">{t(`consoleSettings.nav.${item.id}`)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

export interface SettingsDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t } = useTranslation()
  const [activeSection, setActiveSection] =
    React.useState<SettingsSectionId>("identities")
  const { reloadIdentities } = useCommonData()

  const { result, dismiss } = useGitHubSetupCallback(() => {
    reloadIdentities()
  })

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex h-[60vh] max-h-[90vh] w-[90vw] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{t("consoleSettings.dialog.title")}</DialogTitle>
            <DialogDescription>{t("consoleSettings.dialog.description")}</DialogDescription>
          </DialogHeader>
          <SidebarProvider
            style={
              {
                "--sidebar-width": "14rem",
              } as React.CSSProperties
            }
            className="flex min-h-0 flex-1 overflow-hidden"
          >
            <div className="flex min-h-0 w-full flex-1 overflow-hidden">
              <SettingsNavContent
                activeSection={activeSection}
                onSectionChange={setActiveSection}
              />
              <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
                  <SettingsContent section={activeSection} />
                </div>
              </main>
            </div>
          </SidebarProvider>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={result !== null}
        onOpenChange={(open) => {
          if (!open) dismiss()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {result?.type === "success"
                ? t("consoleSettings.githubApp.successTitle")
                : t("consoleSettings.githubApp.failedTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {result?.type === "success"
                ? result.accountLogin
                  ? t("consoleSettings.githubApp.linkedAccount", { account: result.accountLogin })
                  : t("consoleSettings.githubApp.successDescription")
                : t("consoleSettings.githubApp.failedDescription", { reason: result?.reason, message: result?.message })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={dismiss}>{t("consoleSettings.dialog.ok")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
