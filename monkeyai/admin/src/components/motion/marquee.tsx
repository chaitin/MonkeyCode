// beui.dev/components/motion/marquee
import { Children, type ReactNode, useState } from "react"
import { cn } from "@/lib/utils"

export interface MarqueeProps {
  children: ReactNode
  direction?: "left" | "right" | "up" | "down"
  speed?: number
  pauseOnHover?: boolean
  gap?: string
  className?: string
  fade?: boolean
}

export function Marquee({
  children,
  direction = "left",
  speed = 30,
  pauseOnHover = true,
  gap = "1rem",
  className,
  fade = true,
}: MarqueeProps) {
  const vertical = direction === "up" || direction === "down"
  const reverse = direction === "right" || direction === "down"
  const items = Children.toArray(children)
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onMouseEnter={pauseOnHover ? () => setHovered(true) : undefined}
      onMouseLeave={pauseOnHover ? () => setHovered(false) : undefined}
      className={cn("relative overflow-hidden", className)}
      style={{ "--gap": gap } as React.CSSProperties}
    >
      <div
        className={cn(
          "flex w-full overflow-hidden",
          vertical ? "flex-col" : "flex-row",
          fade &&
            !vertical &&
            "[mask-image:linear-gradient(to_right,transparent,black_25%,black_75%,transparent)]",
          fade &&
            vertical &&
            "[mask-image:linear-gradient(to_bottom,transparent,black_25%,black_75%,transparent)]"
        )}
        style={{ gap }}
      >
        {[0, 1].map((dup) => (
          <div
            key={dup}
            aria-hidden={dup === 1}
            inert={dup === 1}
            style={{
              animationDuration: `${speed}s`,
              animationDirection: reverse ? "reverse" : "normal",
              animationPlayState: hovered ? "paused" : "running",
              gap,
            }}
            className={cn(
              "flex shrink-0 items-center",
              vertical
                ? "animate-marquee-vertical flex-col"
                : "animate-marquee flex-row",
              "motion-reduce:animate-none"
            )}
          >
            {items.map((child, i) => (
              <div key={i} className="shrink-0">
                {child}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
