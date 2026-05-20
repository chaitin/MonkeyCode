import type { DomainSkill } from "@/api/Api"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { getSkillTagIcon } from "@/utils/common"
import { defaultSkills } from "@/utils/config"
import { IconChevronLeft, IconChevronRight, IconPuzzle } from "@tabler/icons-react"
import { useCallback, useEffect, useRef, useState } from "react"

interface TaskSkillSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedSkills: string[]
  skills: DomainSkill[]
  skillTags: string[]
  activeSkillTag: string
  onActiveSkillTagChange: (tag: string) => void
  onSkillChange: (skillId: string, checked: boolean) => void
  triggerClassName?: string
  labelClassName?: string
}

interface SkillItemProps {
  skill: DomainSkill
  selectedSkills: string[]
  onSkillChange: (skillId: string, checked: boolean) => void
}

function SkillItem({ skill, selectedSkills, onSkillChange }: SkillItemProps) {
  if (!skill.id) {
    return null
  }

  const isChecked = selectedSkills.includes(skill.id)

  return (
    <div
      className="flex cursor-pointer flex-row items-center gap-2 rounded-md px-2 py-1 hover:bg-accent"
      onClick={() => onSkillChange(skill.id!, !isChecked)}
    >
      <Checkbox checked={isChecked} disabled={defaultSkills.includes(skill.id)} />
      <div className="min-w-0">
        <div className="text-sm">{skill.name}</div>
        <div className="line-clamp-1 break-all text-xs text-muted-foreground">
          {skill.description}
        </div>
      </div>
    </div>
  )
}

export function TaskSkillSelector({
  open,
  onOpenChange,
  selectedSkills,
  skills,
  skillTags,
  activeSkillTag,
  onActiveSkillTagChange,
  onSkillChange,
  triggerClassName,
  labelClassName,
}: TaskSkillSelectorProps) {
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(skillTags.length > 1)

  const updateScrollState = useCallback(() => {
    const tabsList = tabsListRef.current

    if (!tabsList) {
      setCanScrollLeft(false)
      setCanScrollRight(skillTags.length > 1)
      return
    }

    setCanScrollLeft(tabsList.scrollLeft > 0)
    setCanScrollRight(
      tabsList.scrollLeft + tabsList.clientWidth < tabsList.scrollWidth - 1
    )
  }, [skillTags.length])

  const scrollTabs = (direction: "left" | "right") => {
    tabsListRef.current?.scrollBy({
      left: direction === "left" ? -160 : 160,
      behavior: "smooth",
    })
  }

  useEffect(() => {
    if (!open) {
      return
    }

    const animationFrame = requestAnimationFrame(updateScrollState)

    return () => cancelAnimationFrame(animationFrame)
  }, [open, skillTags, updateScrollState])

  useEffect(() => {
    window.addEventListener("resize", updateScrollState)

    return () => window.removeEventListener("resize", updateScrollState)
  }, [updateScrollState])

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={cn(
            triggerClassName,
            selectedSkills.length > 0 && "text-primary hover:text-primary"
          )}
        >
          <IconPuzzle />
          <span className={labelClassName}>
            {selectedSkills.length > 0 ? `${selectedSkills.length} 个技能` : "技能"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[90vw] max-w-xl flex-col overflow-hidden p-2"
        align="start"
      >
        <Tabs
          value={activeSkillTag}
          onValueChange={onActiveSkillTagChange}
          className="flex min-h-0 w-full flex-1 flex-col"
        >
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              disabled={!canScrollLeft}
              onClick={() => scrollTabs("left")}
            >
              <IconChevronLeft className="size-4" />
            </Button>
            <TabsList
              ref={tabsListRef}
              onScroll={updateScrollState}
              className="no-scrollbar h-7 min-w-0 flex-1 justify-start gap-1 overflow-x-auto overflow-y-hidden bg-background p-0 whitespace-nowrap group-data-horizontal/tabs:h-7"
            >
              {skillTags.map((tag) => (
                <TabsTrigger
                  key={tag}
                  value={tag}
                  className="h-6 shrink-0 justify-start px-2 text-xs hover:bg-sidebar-accent data-[state=active]:bg-accent data-[state=active]:shadow-none"
                >
                  {getSkillTagIcon(tag)}
                  {tag}
                </TabsTrigger>
              ))}
            </TabsList>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              disabled={!canScrollRight}
              onClick={() => scrollTabs("right")}
            >
              <IconChevronRight className="size-4" />
            </Button>
          </div>
          {skillTags.map((tag) => (
            <TabsContent
              key={tag}
              value={tag}
              className="mt-0 min-h-0 flex-1 overflow-y-auto rounded-md border bg-background p-1"
            >
              {skills
                .filter((skill) => tag === "全部" || (skill.tags || []).includes(tag))
                .map((skill) => (
                  <SkillItem
                    key={skill.id}
                    skill={skill}
                    selectedSkills={selectedSkills}
                    onSkillChange={onSkillChange}
                  />
                ))}
            </TabsContent>
          ))}
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}
