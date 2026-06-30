import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { getSiteRedirectPrompt, type SiteRedirectPrompt, type SiteRegion } from "@/site-redirect"

const SITE_REGION_PROMPT_STORAGE_PREFIX = "site_region_prompt_dismissed:"
const LANGUAGE_DISPLAY_LIMIT = 2

function getStorageKey(prompt: SiteRedirectPrompt) {
  const languages = prompt.detectedLanguages.slice(0, LANGUAGE_DISPLAY_LIMIT).join(",") || "unknown"
  return `${SITE_REGION_PROMPT_STORAGE_PREFIX}${prompt.currentHost}->${prompt.targetHost}:${languages}`
}

function hasDismissedPrompt(prompt: SiteRedirectPrompt) {
  if (typeof window === "undefined") {
    return false
  }

  try {
    return window.localStorage.getItem(getStorageKey(prompt)) === "1"
  } catch {
    return false
  }
}

function dismissPrompt(prompt: SiteRedirectPrompt) {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.localStorage.setItem(getStorageKey(prompt), "1")
  } catch {
    // Ignore storage failures. The user can still choose for the current page.
  }
}

function getRegionLanguage(region: SiteRegion) {
  return region === "cn" ? "cn" : "en"
}

export function SiteRegionPrompt() {
  const { t } = useTranslation()
  const prompt = useMemo(() => getSiteRedirectPrompt(), [])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!prompt || hasDismissedPrompt(prompt)) {
      return
    }

    setOpen(true)
  }, [prompt])

  if (!prompt) {
    return null
  }

  const targetLanguage = getRegionLanguage(prompt.targetRegion)
  const currentLanguage = getRegionLanguage(prompt.currentRegion)
  const currentRegionLabel = t(`siteRegionPrompt.versions.${prompt.currentRegion}`, { lng: targetLanguage })
  const targetRegionLabel = t(`siteRegionPrompt.versions.${prompt.targetRegion}`, { lng: targetLanguage })
  const stayRegionLabel = t(`siteRegionPrompt.versions.${prompt.currentRegion}`, { lng: currentLanguage })
  const switchRegionLabel = t(`siteRegionPrompt.versions.${prompt.targetRegion}`, { lng: targetLanguage })

  const handleStay = () => {
    dismissPrompt(prompt)
    setOpen(false)
  }

  const handleSwitch = () => {
    dismissPrompt(prompt)
    window.location.replace(prompt.targetUrl)
  }

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        handleStay()
        return
      }

      setOpen(true)
    }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("siteRegionPrompt.title", {
              lng: targetLanguage,
              targetRegion: targetRegionLabel,
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("siteRegionPrompt.description", {
              lng: targetLanguage,
              currentRegion: currentRegionLabel,
              targetRegion: targetRegionLabel,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleStay}>
            {t("siteRegionPrompt.actions.stay", {
              lng: currentLanguage,
              region: stayRegionLabel,
            })}
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleSwitch}>
            {t("siteRegionPrompt.actions.switch", {
              lng: targetLanguage,
              region: switchRegionLabel,
            })}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
