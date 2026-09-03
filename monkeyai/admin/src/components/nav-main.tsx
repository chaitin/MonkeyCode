import { useState } from "react"
import { useTranslation } from "react-i18next"
import { NavLink, useLocation } from "react-router-dom"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"

export function NavMain({
  items,
}: {
  items: {
    title: string
    url: string
    icon: React.ReactNode
    items?: {
      title: string
      url: string
    }[]
  }[]
}) {
  const { t } = useTranslation()
  const location = useLocation()
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    () => {
      const initialOpenSections: Record<string, boolean> = {}

      for (const item of items) {
        initialOpenSections[item.url] =
          location.pathname === item.url ||
          Boolean(
            item.items?.some((subItem) => location.pathname === subItem.url)
          )
      }

      return initialOpenSections
    }
  )

  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => {
          const isSectionActive =
            location.pathname === item.url ||
            item.items?.some((subItem) => location.pathname === subItem.url)

          return (
            <Collapsible
              key={item.title}
              open={openSections[item.url] ?? isSectionActive}
              onOpenChange={(open) => {
                setOpenSections((current) => ({
                  ...current,
                  [item.url]: open,
                }))
              }}
              render={<SidebarMenuItem />}
            >
              <SidebarMenuButton
                isActive={isSectionActive}
                tooltip={item.title}
                render={<NavLink to={item.url} />}
                onClick={() => {
                  if (!item.items?.length) {
                    return
                  }

                  setOpenSections((current) =>
                    current[item.url]
                      ? current
                      : { ...current, [item.url]: true }
                  )
                }}
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
              {item.items?.length ? (
                <>
                  <CollapsibleTrigger
                    render={
                      <SidebarMenuAction className="aria-expanded:rotate-90 rtl:rotate-180 rtl:aria-expanded:rotate-90" />
                    }
                  >
                    <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
                    <span className="sr-only">
                      {t("navigation.expandOrCollapse")}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.items.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton
                            isActive={location.pathname === subItem.url}
                            render={<NavLink to={subItem.url} />}
                          >
                            <span>{subItem.title}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </>
              ) : null}
            </Collapsible>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
