export const APP_EDITIONS = ["online", "offline"] as const

export type AppEdition = (typeof APP_EDITIONS)[number]

export const APP_EDITION = import.meta.env.VITE_APP_EDITION as AppEdition

export const IS_ONLINE_EDITION = APP_EDITION === "online"
export const IS_OFFLINE_EDITION = APP_EDITION === "offline"
