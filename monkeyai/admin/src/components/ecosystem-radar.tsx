import type { PointerEvent } from "react"

import {
  Atom02Icon,
  BookOpen02Icon,
  BubbleChatSparkIcon,
  CloudIcon,
  Database01Icon,
  FlowConnectionIcon,
  Plug01Icon,
  SourceCodeCircleIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"

const ecosystemNodes = [
  { icon: Atom02Icon, x: 50, y: 7, delay: "-1.5s" },
  { icon: CloudIcon, x: 79, y: 20, delay: "-3.8s" },
  { icon: Plug01Icon, x: 92, y: 49, delay: "-2.6s" },
  { icon: SourceCodeCircleIcon, x: 80, y: 79, delay: "-4.9s" },
  { icon: FlowConnectionIcon, x: 50, y: 92, delay: "-0.8s" },
  { icon: BubbleChatSparkIcon, x: 20, y: 80, delay: "-3.1s" },
  { icon: Database01Icon, x: 8, y: 50, delay: "-5.4s" },
  { icon: BookOpen02Icon, x: 21, y: 20, delay: "-2.1s" },
]

export function EcosystemRadar() {
  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - bounds.left) / bounds.width - 0.5
    const y = (event.clientY - bounds.top) / bounds.height - 0.5

    event.currentTarget.style.setProperty("--radar-shift-x", `${x * 10}px`)
    event.currentTarget.style.setProperty("--radar-shift-y", `${y * 10}px`)
    event.currentTarget.style.setProperty("--radar-grid-x", `${x * -2.5}px`)
    event.currentTarget.style.setProperty("--radar-grid-y", `${y * -2.5}px`)
  }

  function resetPointer(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.style.setProperty("--radar-shift-x", "0px")
    event.currentTarget.style.setProperty("--radar-shift-y", "0px")
    event.currentTarget.style.setProperty("--radar-grid-x", "0px")
    event.currentTarget.style.setProperty("--radar-grid-y", "0px")
  }

  return (
    <div
      aria-hidden="true"
      className="ecosystem-radar relative flex h-full min-h-[36rem] items-center justify-center overflow-hidden"
      onPointerLeave={resetPointer}
      onPointerMove={handlePointerMove}
    >
      <div className="ecosystem-radar-grid absolute inset-0" />
      <div className="ecosystem-radar-glow absolute inset-0" />

      <div className="ecosystem-radar-stage relative aspect-square w-[92%] max-w-[30rem]">
        <svg
          className="absolute inset-0 size-full overflow-visible"
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle className="ecosystem-ring" cx="50" cy="50" r="42" />
          <circle className="ecosystem-ring" cx="50" cy="50" r="31" />
          <circle className="ecosystem-ring" cx="50" cy="50" r="20" />
          <circle
            className="ecosystem-ring ecosystem-ring-dashed"
            cx="50"
            cy="50"
            r="36.5"
          />
        </svg>

        <div className="ecosystem-orbit absolute inset-0">
          {ecosystemNodes.map((node, index) => (
            <div
              key={`${node.x}-${node.y}`}
              className="ecosystem-node-anchor absolute"
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
            >
              <div className="ecosystem-node-counter">
                <div
                  className="ecosystem-node relative flex size-11 items-center justify-center rounded-2xl border border-border/70 bg-card/80 text-foreground shadow-sm backdrop-blur-md"
                  style={{ animationDelay: node.delay }}
                >
                  <HugeiconsIcon
                    icon={node.icon}
                    className="size-5"
                    strokeWidth={1.6}
                  />
                  <span
                    className="ecosystem-node-signal absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-primary"
                    style={{ animationDelay: `${index * -0.35}s` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="ecosystem-console absolute top-1/2 left-1/2 flex size-[25%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-3xl border border-border/80 bg-card/85 backdrop-blur-xl">
          <span className="ecosystem-console-orbit absolute -inset-3 rounded-[2rem] border border-dashed border-primary/25" />
          <span className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-primary/20" />
          <span className="absolute inset-y-3 left-1/2 w-px -translate-x-1/2 bg-primary/20" />
          <span className="absolute top-2.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary/60" />
          <span className="absolute top-1/2 right-2.5 size-1.5 -translate-y-1/2 rounded-full bg-primary/60" />
          <span className="absolute bottom-2.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary/60" />
          <span className="absolute top-1/2 left-2.5 size-1.5 -translate-y-1/2 rounded-full bg-primary/60" />
          <div className="ecosystem-core relative flex size-12 items-center justify-center rounded-2xl border border-primary/25 bg-card text-primary shadow-sm">
            <HugeiconsIcon
              icon={FlowConnectionIcon}
              className="size-6"
              strokeWidth={1.7}
            />
            <span className="ecosystem-core-pulse absolute inset-0 rounded-2xl border border-primary/40" />
          </div>
        </div>
      </div>
    </div>
  )
}
