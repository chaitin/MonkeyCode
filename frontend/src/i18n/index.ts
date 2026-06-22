import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import { patchDocumentMeta } from "./document-meta"
import { initLanguage, type AppLanguage } from "./language"
import cn from "./resources/cn"
import en from "./resources/en"

const resources = {
  cn: {
    translation: cn,
  },
  en: {
    translation: en,
  },
} as const

export async function initI18n(language: AppLanguage = initLanguage()) {
  if (i18n.isInitialized) {
    await i18n.changeLanguage(language)
    syncDocumentMeta()
    return
  }

  await i18n.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: "en",
    interpolation: {
      escapeValue: false,
    },
  })

  syncDocumentMeta()
}

function syncDocumentMeta() {
  patchDocumentMeta((key) => String(i18n.t(key)))
}

export default i18n
