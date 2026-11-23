import { useTranslation } from "react-i18next"

import { Marquee } from "@/components/motion/marquee"

const modelNames = [
  "GPT-6",
  "Claude Fable 5",
  "Deepseek-flash",
  "Qwen3.8",
  "Kimi K3",
  "GLM-5.3",
]

export function LoginMarquees() {
  const { t } = useTranslation()
  const rows = [
    {
      id: "capabilities",
      items: t("login.marqueeCapabilities", {
        returnObjects: true,
      }) as string[],
      direction: "left",
      speed: 32,
    },
    { id: "models", items: modelNames, direction: "right", speed: 38 },
    {
      id: "skills",
      items: t("login.marqueeSkills", { returnObjects: true }) as string[],
      direction: "left",
      speed: 35,
    },
  ] as const

  return (
    <div
      aria-hidden="true"
      dir="ltr"
      className="absolute inset-0 z-10 flex flex-col justify-center gap-8 py-12"
    >
      {rows.map(({ id, items, direction, speed }) => (
        <Marquee
          key={id}
          direction={direction}
          speed={speed}
          pauseOnHover={true}
          fade={true}
          gap="0.75rem"
          className="w-full"
        >
          {items.map((item) => (
            <span
              key={item}
              dir="auto"
              className="inline-flex h-10 items-center rounded-full bg-neutral-50/6 px-4 text-sm font-medium whitespace-nowrap text-neutral-950/60 dark:bg-neutral-900/6 dark:text-neutral-50/60"
            >
              {item}
            </span>
          ))}
        </Marquee>
      ))}
    </div>
  )
}
