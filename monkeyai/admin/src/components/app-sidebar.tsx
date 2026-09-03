"use client"

import * as React from "react"
import { useTranslation } from "react-i18next"
import { NavLink } from "react-router-dom"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ChartRingIcon,
  RoboticIcon,
  Settings05Icon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons"
import { CONSOLE_ROUTES, DEFAULT_CONSOLE_PATH } from "@/lib/routes"

const user = {
  name: "MonkeyAI Admin",
  email: "admin@monkeyai.local",
  avatar: "/placeholder.svg",
}

export function AppSidebar({
  onLogout,
  ...props
}: React.ComponentProps<typeof Sidebar> & { onLogout: () => void }) {
  const { i18n, t } = useTranslation()
  const navMain = [
    {
      title: t("sections.statistics"),
      url: CONSOLE_ROUTES.realtimeStatus,
      icon: <HugeiconsIcon icon={ChartRingIcon} strokeWidth={2} />,
      items: [
        {
          title: t("pages.realtimeStatus.title"),
          url: CONSOLE_ROUTES.realtimeStatus,
        },
        {
          title: t("pages.taskStatistics.title"),
          url: CONSOLE_ROUTES.taskStatistics,
        },
        {
          title: t("pages.modelStatistics.title"),
          url: CONSOLE_ROUTES.modelStatistics,
        },
        {
          title: t("pages.taskHistory.title"),
          url: CONSOLE_ROUTES.taskHistory,
        },
      ],
    },
    {
      title: t("sections.aiResources"),
      url: CONSOLE_ROUTES.models,
      icon: <HugeiconsIcon icon={RoboticIcon} strokeWidth={2} />,
      items: [
        {
          title: t("pages.models.title"),
          url: CONSOLE_ROUTES.models,
        },
        {
          title: t("pages.knowledgeBases.title"),
          url: CONSOLE_ROUTES.knowledgeBases,
        },
        {
          title: t("pages.skills.title"),
          url: CONSOLE_ROUTES.skills,
        },
        {
          title: t("pages.experts.title"),
          url: CONSOLE_ROUTES.experts,
        },
        {
          title: t("pages.tools.title"),
          url: CONSOLE_ROUTES.tools,
        },
        {
          title: t("pages.rules.title"),
          url: CONSOLE_ROUTES.rules,
        },
      ],
    },
    {
      title: t("sections.billingManagement"),
      url: CONSOLE_ROUTES.billingDetails,
      icon: <HugeiconsIcon icon={Wallet01Icon} strokeWidth={2} />,
      items: [
        {
          title: t("pages.billingDetails.title"),
          url: CONSOLE_ROUTES.billingDetails,
        },
        {
          title: t("pages.billingSettings.title"),
          url: CONSOLE_ROUTES.billingSettings,
        },
      ],
    },
    {
      title: t("sections.systemSettings"),
      url: CONSOLE_ROUTES.membersAndGroups,
      icon: <HugeiconsIcon icon={Settings05Icon} strokeWidth={2} />,
      items: [
        {
          title: t("pages.membersAndGroups.title"),
          url: CONSOLE_ROUTES.membersAndGroups,
        },
        {
          title: t("pages.operationLogs.title"),
          url: CONSOLE_ROUTES.operationLogs,
        },
        {
          title: t("pages.otherSettings.title"),
          url: CONSOLE_ROUTES.otherSettings,
        },
      ],
    },
  ]

  return (
    <Sidebar
      variant="inset"
      side={i18n.dir() === "rtl" ? "right" : "left"}
      dir={i18n.dir()}
      {...props}
    >
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<NavLink to={DEFAULT_CONSOLE_PATH} />}
            >
              <div className="size-8 shrink-0 overflow-hidden rounded-lg">
                <img
                  src="/logo-light.png"
                  alt=""
                  className="size-full object-contain dark:hidden"
                />
                <img
                  src="/logo-dark.png"
                  alt=""
                  className="hidden size-full object-contain dark:block"
                />
              </div>
              <div className="grid flex-1 text-start text-sm leading-tight">
                <span className="truncate font-medium">MonkeyAI</span>
                <span className="truncate text-xs">
                  {t("app.adminConsole")}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} onLogout={onLogout} />
      </SidebarFooter>
    </Sidebar>
  )
}
