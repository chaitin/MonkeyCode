import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import type { SwitchAgentResourcesResponse } from "@/components/console/task/task-control-client"
import { apiRequest } from "@/utils/requestUtils"

import { filterSelectableSkillIds } from "./task-skill-selection"
import {
  ALL_SKILLS_TAG,
  type SkillForPicker,
  TaskSkillPickerBody,
} from "./task-skill-selector"

interface TaskSkillsUpdateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSkillIds: string[]
  pluginIds: string[]
  onSwitch: (
    skillIds: string[],
    pluginIds: string[],
  ) => Promise<SwitchAgentResourcesResponse | null> | undefined
}

export function TaskSkillsUpdateDialog({
  open,
  onOpenChange,
  initialSkillIds,
  pluginIds,
  onSwitch,
}: TaskSkillsUpdateDialogProps) {
  const { t } = useTranslation()
  const [skillList, setSkillList] = useState<SkillForPicker[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedSkills, setSelectedSkills] = useState<string[]>(initialSkillIds)
  const [activeSkillTag, setActiveSkillTag] = useState<string>(ALL_SKILLS_TAG)
  const [submitting, setSubmitting] = useState(false)
  const prevOpenRef = useRef(false)

  useEffect(() => {
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = open
    if (!open || wasOpen) return
    setSelectedSkills(initialSkillIds)
    setLoading(true)
    apiRequest("v1SkillsList", {}, [], (resp) => {
      setLoading(false)
      if (resp.code === 0) {
        const skills = (resp.data || []) as SkillForPicker[]
        setSkillList(skills)
        setSelectedSkills((prev) => filterSelectableSkillIds(prev, skills))
      } else {
        toast.error(resp.message || t("taskWorkflow.toast.fetchSkillsFailed"))
      }
    })
  }, [open])

  const skillTags = useMemo(() => {
    const tagCountMap = new Map<string, number>()
    skillList.forEach((skill) => {
      ;(skill.tags || []).forEach((tag) => {
        tagCountMap.set(tag, (tagCountMap.get(tag) || 0) + 1)
      })
    })
    const sortedTags = Array.from(tagCountMap.keys()).sort(
      (a, b) => tagCountMap.get(b)! - tagCountMap.get(a)!,
    )
    return [ALL_SKILLS_TAG].concat(sortedTags)
  }, [skillList])

  useEffect(() => {
    if (!skillTags.includes(activeSkillTag)) {
      setActiveSkillTag(skillTags[0] || ALL_SKILLS_TAG)
    }
  }, [activeSkillTag, skillTags])

  const handleSkillChange = useCallback((skillId: string, checked: boolean) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(skillId)
      } else {
        next.delete(skillId)
      }
      return Array.from(next)
    })
  }, [])

  const handleSave = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      // Backend expects a full declaration: pass current plugin_ids
      // through so we don't accidentally clear the task's plugin
      // selection when the user only edits skills.
      const response = await onSwitch(selectedSkills, pluginIds)
      if (!response) {
        toast.error(t("taskDetail.chat.skillsDialog.toast.timeout"))
        return
      }
      if (response.success) {
        toast.success(
          response.message || t("taskDetail.chat.skillsDialog.toast.success"),
        )
        onOpenChange(false)
        return
      }
      toast.error(response.message || t("taskDetail.chat.skillsDialog.toast.failed"))
    } finally {
      setSubmitting(false)
    }
  }, [onOpenChange, onSwitch, pluginIds, selectedSkills, submitting, t])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (submitting && !nextOpen) return
      onOpenChange(nextOpen)
    },
    [onOpenChange, submitting],
  )

  const renderBody = () => {
    if (loading) {
      return (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="size-5" />
        </div>
      )
    }

    if (skillList.length === 0) {
      return (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          {t("taskDetail.chat.skillsDialog.empty")}
        </div>
      )
    }

    return (
      <div className="flex h-80 min-h-0 flex-col">
        <TaskSkillPickerBody
          active={open}
          selectedSkills={selectedSkills}
          skills={skillList}
          skillTags={skillTags}
          activeSkillTag={activeSkillTag}
          onActiveSkillTagChange={setActiveSkillTag}
          onSkillChange={handleSkillChange}
        />
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("taskDetail.chat.skillsDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("taskDetail.chat.skillsDialog.description")}
          </DialogDescription>
        </DialogHeader>
        {renderBody()}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            {t("taskDetail.common.cancel")}
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={submitting || loading}>
            {submitting && <Spinner className="mr-2 size-4" />}
            {t("taskDetail.chat.skillsDialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
