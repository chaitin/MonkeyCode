import { useState } from "react"
import { ArrowRight01Icon, DotIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { NavLink, useLocation } from "react-router-dom"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

const mainItemClassName =
  "h-10 text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/85 data-active:bg-sidebar-accent data-active:font-normal data-active:text-sidebar-foreground/65 data-active:hover:bg-sidebar-accent data-active:hover:text-sidebar-foreground/85"

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
  const location = useLocation()
  const [openSection, setOpenSection] = useState<string | null>(
    () => items.find((item) => item.items?.length)?.url ?? null
  )

  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => (
          <Collapsible
            key={item.title}
            open={openSection === item.url}
            onOpenChange={(open) => {
              setOpenSection((current) =>
                open ? item.url : current === item.url ? null : current
              )
            }}
            render={<SidebarMenuItem />}
          >
            {item.items?.length ? (
              <>
                <CollapsibleTrigger
                  render={
                    <SidebarMenuButton
                      className={mainItemClassName}
                      isActive={
                        location.pathname === item.url ||
                        item.items.some(
                          (subItem) => location.pathname === subItem.url
                        )
                      }
                    />
                  }
                >
                  {item.icon}
                  <span>{item.title}</span>
                  <HugeiconsIcon
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none ms-auto size-4 transition-transform motion-reduce:transition-none",
                      openSection === item.url ? "rotate-90" : "rtl:rotate-180"
                    )}
                    icon={ArrowRight01Icon}
                    strokeWidth={2}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height,opacity] duration-200 ease-out data-ending-style:h-0 data-ending-style:opacity-0 data-starting-style:h-0 data-starting-style:opacity-0 motion-reduce:transition-none">
                  <SidebarMenuSub className="mx-0 translate-x-0 border-s-0 px-0 pt-1 pb-0 rtl:translate-x-0">
                    {item.items.map((subItem) => (
                      <SidebarMenuSubItem key={subItem.title}>
                        <SidebarMenuSubButton
                          className="h-9 translate-x-0 text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/85 rtl:translate-x-0 data-active:bg-sidebar-accent data-active:font-medium data-active:text-foreground data-active:hover:bg-sidebar-accent data-active:hover:text-foreground [&>svg]:text-sidebar-foreground/40 data-active:[&>svg]:text-foreground"
                          isActive={location.pathname === subItem.url}
                          size="sm"
                          render={<NavLink to={subItem.url} />}
                        >
                          <HugeiconsIcon
                            aria-hidden="true"
                            icon={DotIcon}
                            strokeWidth={2}
                          />
                          <span>{subItem.title}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </>
            ) : (
              <SidebarMenuButton
                className={mainItemClassName}
                isActive={location.pathname === item.url}
                render={<NavLink to={item.url} />}
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            )}
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
