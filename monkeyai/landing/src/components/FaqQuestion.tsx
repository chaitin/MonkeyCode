import { useEffect, useState } from "react"
import { Plus, MessagesSquare, ShieldCheck, Bot, Server, Code, Blocks, MonitorSmartphone, ClipboardList, Sparkles, KeyRound } from "lucide-react"
import { BouncyAccordion } from "@/components/motion/bouncy-accordion"

type FaqItem = { id: string; question: string; answer: string }
const icons = [MessagesSquare, ShieldCheck, Bot, Server, Code, Blocks, MonitorSmartphone, ClipboardList, Sparkles, KeyRound]

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  // Preserve native disclosure controls until the interactive accordion is ready.
  if (!hydrated) return (
    <div className="studio-faq-list">
      {items.map((item, index) => (
        <details key={item.id} name="homepage-faq" open={index === 0}>
          <FaqQuestion question={item.question} /><p>{item.answer}</p>
        </details>
      ))}
    </div>
  )

  return <BouncyAccordion defaultValue={items[0]?.id} items={items.map((item, index) => {
    const Icon = icons[index % icons.length]
    return { id: item.id, title: item.question, description: item.answer, icon: <Icon size={18} /> }
  })} />
}

export function FaqQuestion({ question }: { question: string }) {
  return (
    <summary>
      <span>{question}</span><Plus size={20} aria-hidden="true" />
    </summary>
  )
}
