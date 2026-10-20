import { useEffect, useRef, useState } from "react"
import { Code, Briefcase, Palette } from "lucide-react"
import { Button } from "@/components/ui/button"

const icons = { coding: Code, work: Briefcase, design: Palette }
type Tab = { id: keyof typeof icons; title: string }

export function WorkspaceTabs({ views }: { views: readonly Tab[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [active, setActive] = useState(views[0].id)

  useEffect(() => {
    const workspace = ref.current?.closest("[data-workspace]")
    workspace?.querySelectorAll<HTMLElement>("[data-workspace-panel]").forEach(panel => {
      panel.hidden = panel.dataset.workspacePanel !== active
      panel.setAttribute("role", "tabpanel")
      panel.setAttribute("aria-labelledby", `tab-${panel.dataset.workspacePanel}`)
      panel.tabIndex = 0
    })
    setReady(true)
  }, [active])

  function activate(index: number) {
    setActive(views[index].id)
    ref.current?.querySelectorAll<HTMLButtonElement>("[data-workspace-tab]")[index]?.focus()
  }

  return (
    <div ref={ref} className="studio-capability-tabs" role="tablist" aria-label="选择工作场景" hidden={!ready}>
      {views.map(({ id, title }, index) => {
        const Icon = icons[id]
        return (
          <Button key={id} variant="ghost" role="tab" id={`tab-${id}`} data-workspace-tab={id}
            aria-controls={`panel-${id}`} aria-selected={active === id} tabIndex={active === id ? 0 : -1}
            onClick={() => setActive(id)} onKeyDown={event => {
              let next: number
              if (event.key === "ArrowRight") next = (index + 1) % views.length
              else if (event.key === "ArrowLeft") next = (index - 1 + views.length) % views.length
              else if (event.key === "Home") next = 0
              else if (event.key === "End") next = views.length - 1
              else return
              event.preventDefault()
              activate(next)
            }}>
            <Icon aria-hidden="true" /><span>{title}</span>
          </Button>
        )
      })}
    </div>
  )
}
