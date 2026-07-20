import type { DomainSkillListItem } from "@/api/Api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { getSkillTagIcon } from "@/utils/common"
import { defaultSkills } from "@/utils/config"
import { IconChevronLeft, IconChevronRight, IconPuzzle, IconSearch, IconX } from "@tabler/icons-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

export const ALL_SKILLS_TAG = "__all__"

const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2
const WHEEL_LINE_HEIGHT = 16
const ACTIVE_SKILL_LIST_SELECTOR = '[role="tabpanel"][data-state="active"]'

function getWheelScrollDelta(deltaY: number, deltaMode: number, pageHeight: number) {
  if (deltaMode === DOM_DELTA_LINE) {
    return deltaY * WHEEL_LINE_HEIGHT
  }

  if (deltaMode === DOM_DELTA_PAGE) {
    return deltaY * pageHeight
  }

  return deltaY
}

type DomainSkill = DomainSkillListItem & { tags?: string[] }

/**
 * SkillForPicker augments the swagger-generated DomainSkill with the
 * `is_force_delivery` flag returned by /api/v1/skills (see
 * lib/agent-resources-api.ts SkillListItem). The picker treats
 * force-delivered skills as visible-but-disabled chips so the user
 * knows about the admin-mandated dependency without being able to
 * un-tick it (the backend re-injects these IDs server-side).
 */
export type SkillForPicker = DomainSkill & { is_force_delivery?: boolean }

interface TaskSkillSelectorProps {
  enableWheelScrollFallback?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedSkills: string[]
  skills: SkillForPicker[]
  skillTags: string[]
  activeSkillTag: string
  onActiveSkillTagChange: (tag: string) => void
  onSkillChange: (skillId: string, checked: boolean) => void
  triggerClassName?: string
  labelClassName?: string
}

interface SkillItemProps {
  skill: SkillForPicker
  selectedSkills: string[]
  onSkillChange: (skillId: string, checked: boolean) => void
}

function SkillItem({ skill, selectedSkills, onSkillChange }: SkillItemProps) {
  const { t } = useTranslation()

  if (!skill.id) {
    return null
  }

  const isForceDelivery = !!skill.is_force_delivery
  // Force-delivered + hard-coded legacy default skills are both shown as
  // checked-and-disabled. Force-delivered skills are presented as "checked"
  // regardless of the parent's selectedSkills state because the backend
  // injects them server-side and we do not want users to see an unchecked
  // tickbox for something they cannot opt out of.
  const isLegacyDefault = defaultSkills.includes(skill.id)
  const isDisabled = isLegacyDefault || isForceDelivery
  const isChecked = isForceDelivery || selectedSkills.includes(skill.id)

  return (
    <div
      className={cn(
        "flex flex-row items-center gap-2 rounded-md px-2 py-1",
        isDisabled
          ? "cursor-not-allowed opacity-80"
          : "cursor-pointer hover:bg-accent"
      )}
      onClick={() => {
        if (isDisabled) {
          return
        }
        onSkillChange(skill.id!, !isChecked)
      }}
    >
      <Checkbox checked={isChecked} disabled={isDisabled} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="truncate">{skill.name}</span>
          {isForceDelivery && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="secondary"
                  className="shrink-0 px-1.5 py-0 text-[10px] leading-4"
                >
                  {t("taskWorkflow.skill.forceDelivery")}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {t("taskWorkflow.skill.forceDeliveryTooltip")}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="line-clamp-1 break-all text-xs text-muted-foreground">
          {skill.description}
        </div>
      </div>
    </div>
  )
}

interface TaskSkillPickerBodyProps {
  active: boolean
  selectedSkills: string[]
  skills: SkillForPicker[]
  skillTags: string[]
  activeSkillTag: string
  onActiveSkillTagChange: (tag: string) => void
  onSkillChange: (skillId: string, checked: boolean) => void
  className?: string
}

export function TaskSkillPickerBody({
  active,
  selectedSkills,
  skills,
  skillTags,
  activeSkillTag,
  onActiveSkillTagChange,
  onSkillChange,
  className,
}: TaskSkillPickerBodyProps) {
  const { t } = useTranslation()
  const tabsListRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(skillTags.length > 1)
  const [searchQuery, setSearchQuery] = useState("")

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const searchedSkills = normalizedSearchQuery
    ? skills.filter((skill) => [
        skill.name || "",
        skill.description || "",
        ...(skill.tags || []),
      ].some((value) => value.toLowerCase().includes(normalizedSearchQuery)))
    : skills

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
    if (!active) {
      setSearchQuery("")
      return
    }

    const animationFrame = requestAnimationFrame(updateScrollState)

    return () => cancelAnimationFrame(animationFrame)
  }, [active, skillTags, updateScrollState])

  useEffect(() => {
    window.addEventListener("resize", updateScrollState)

    return () => window.removeEventListener("resize", updateScrollState)
  }, [updateScrollState])

  return (
    <Tabs
      value={activeSkillTag}
      onValueChange={onActiveSkillTagChange}
      className={cn("flex min-h-0 w-full flex-1 flex-col", className)}
    >
      <div className="relative mb-2">
        <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t("taskWorkflow.skill.searchPlaceholder")}
          aria-label={t("taskWorkflow.skill.searchPlaceholder")}
          className="h-11 pr-8 pl-8 md:h-8"
        />
        {searchQuery && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute top-1/2 right-1.5 h-6 w-6 -translate-y-1/2 text-muted-foreground hover:bg-transparent hover:text-foreground"
            aria-label={t("taskWorkflow.skill.searchClear")}
            onClick={() => setSearchQuery("")}
          >
            <IconX className="size-3.5" />
          </Button>
        )}
      </div>
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
              {getSkillTagIcon(tag === ALL_SKILLS_TAG ? t("taskWorkflow.skill.all") : tag)}
              {tag === ALL_SKILLS_TAG ? t("taskWorkflow.skill.all") : tag}
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
      {skillTags.map((tag) => {
        const visibleSkills = searchedSkills
          .filter((skill) => !skill.is_force_delivery)
          .filter((skill) => tag === ALL_SKILLS_TAG || (skill.tags || []).includes(tag))

        return (
          <TabsContent
            key={tag}
            value={tag}
            className="mt-0 min-h-0 flex-1 overflow-y-auto rounded-md border bg-background p-1"
          >
            {visibleSkills.length > 0 ? (
              visibleSkills.map((skill) => (
                <SkillItem
                  key={skill.id}
                  skill={skill}
                  selectedSkills={selectedSkills}
                  onSkillChange={onSkillChange}
                />
              ))
            ) : (
              <div role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t("taskWorkflow.skill.searchEmpty")}
              </div>
            )}
          </TabsContent>
        )
      })}
    </Tabs>
  )
}

export function TaskSkillSelector({
  enableWheelScrollFallback,
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
  const { t } = useTranslation()
  const [popoverContentElement, setPopoverContentElement] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!enableWheelScrollFallback || !open || !popoverContentElement) {
      return
    }

    const handleSkillListWheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        event.deltaY === 0 ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX) ||
        !(event.target instanceof Element)
      ) {
        return
      }

      const activeSkillList = event.target.closest<HTMLDivElement>(ACTIVE_SKILL_LIST_SELECTOR)
      if (!activeSkillList || !popoverContentElement.contains(activeSkillList)) {
        return
      }

      event.preventDefault()
      activeSkillList.scrollTop += getWheelScrollDelta(
        event.deltaY,
        event.deltaMode,
        activeSkillList.clientHeight
      )
    }

    popoverContentElement.addEventListener("wheel", handleSkillListWheel, { passive: false })

    return () => popoverContentElement.removeEventListener("wheel", handleSkillListWheel)
  }, [enableWheelScrollFallback, open, popoverContentElement])

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
            {selectedSkills.length > 0
              ? t("taskWorkflow.skill.selectedCount", { count: selectedSkills.length })
              : t("taskWorkflow.skill.label")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={setPopoverContentElement}
        className="flex max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[90vw] max-w-xl flex-col overflow-hidden p-2"
        align="start"
      >
        <TaskSkillPickerBody
          active={open}
          selectedSkills={selectedSkills}
          skills={skills}
          skillTags={skillTags}
          activeSkillTag={activeSkillTag}
          onActiveSkillTagChange={onActiveSkillTagChange}
          onSkillChange={onSkillChange}
        />
      </PopoverContent>
    </Popover>
  )
}
