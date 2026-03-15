"use client"

import * as React from "react"
import {
  Bell,
  Bot,
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

const SETTINGS_NAV = [
  { id: "identities", name: "Git 身份", icon: IconPasswordFingerprint },
  { id: "models", name: "AI 大模型", icon: Bot },
  { id: "images", name: "系统镜像", icon: Box },
  { id: "hosts", name: "宿主机", icon: HardDrive },
  { id: "vms", name: "开发环境", icon: MonitorCloud },
  { id: "notifications", name: "通知", icon: Bell },
] as const

type SettingsSectionId = (typeof SETTINGS_NAV)[number]["id"]

function SettingsContent({ section }: { section: SettingsSectionId }) {
  switch (section) {
    case "identities":
      return <Identities />
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
  return (
    <Sidebar collapsible="none" className="w-12 shrink-0 border-r sm:w-44 md:w-56">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 pt-2 pb-4 font-semibold text-md">
          <Settings className="size-4 shrink-0" />
          <span className="hidden sm:inline">设置</span>
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
                    <span className="hidden sm:inline">{item.name}</span>
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
            <DialogTitle>配置</DialogTitle>
            <DialogDescription>自定义您的配置选项</DialogDescription>
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
                ? "GitHub App 安装成功"
                : "GitHub App 安装失败"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {result?.type === "success"
                ? result.accountLogin
                  ? `已关联到账户 ${result.accountLogin}`
                  : "GitHub App 已成功安装"
                : `安装失败 (${result?.reason}): ${result?.message}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={dismiss}>确定</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
