export const LOGIN_PATH = "/login"
export const CONSOLE_PATH = "/console"

export const CONSOLE_ROUTES = {
  realtimeStatus: "/console/statistics/realtime",
  taskStatistics: "/console/statistics/tasks",
  modelStatistics: "/console/statistics/models",
  taskHistory: "/console/statistics/task-history",
  models: "/console/resources/models",
  knowledgeBases: "/console/resources/knowledge-bases",
  skills: "/console/resources/skills",
  experts: "/console/resources/experts",
  tools: "/console/resources/tools",
  rules: "/console/resources/rules",
  billingDetails: "/console/billing/details",
  billingSettings: "/console/billing/settings",
  membersAndGroups: "/console/settings/members",
  operationLogs: "/console/settings/operation-logs",
  otherSettings: "/console/settings/other",
} as const

export const DEFAULT_CONSOLE_PATH = CONSOLE_ROUTES.realtimeStatus

export const CONSOLE_PAGES = [
  {
    path: CONSOLE_ROUTES.realtimeStatus,
    sectionKey: "sections.statistics",
    sectionPath: CONSOLE_ROUTES.realtimeStatus,
    titleKey: "pages.realtimeStatus.title",
    descriptionKey: "pages.realtimeStatus.description",
  },
  {
    path: CONSOLE_ROUTES.taskStatistics,
    sectionKey: "sections.statistics",
    sectionPath: CONSOLE_ROUTES.realtimeStatus,
    titleKey: "pages.taskStatistics.title",
    descriptionKey: "pages.taskStatistics.description",
  },
  {
    path: CONSOLE_ROUTES.modelStatistics,
    sectionKey: "sections.statistics",
    sectionPath: CONSOLE_ROUTES.realtimeStatus,
    titleKey: "pages.modelStatistics.title",
    descriptionKey: "pages.modelStatistics.description",
  },
  {
    path: CONSOLE_ROUTES.taskHistory,
    sectionKey: "sections.statistics",
    sectionPath: CONSOLE_ROUTES.realtimeStatus,
    titleKey: "pages.taskHistory.title",
    descriptionKey: "pages.taskHistory.description",
  },
  {
    path: CONSOLE_ROUTES.models,
    sectionKey: "sections.aiResources",
    sectionPath: CONSOLE_ROUTES.models,
    titleKey: "pages.models.title",
    descriptionKey: "pages.models.description",
  },
  {
    path: CONSOLE_ROUTES.knowledgeBases,
    sectionKey: "sections.aiResources",
    sectionPath: CONSOLE_ROUTES.models,
    titleKey: "pages.knowledgeBases.title",
    descriptionKey: "pages.knowledgeBases.description",
  },
  {
    path: CONSOLE_ROUTES.skills,
    sectionKey: "sections.aiResources",
    sectionPath: CONSOLE_ROUTES.models,
    titleKey: "pages.skills.title",
    descriptionKey: "pages.skills.description",
  },
  {
    path: CONSOLE_ROUTES.experts,
    sectionKey: "sections.aiResources",
    sectionPath: CONSOLE_ROUTES.models,
    titleKey: "pages.experts.title",
    descriptionKey: "pages.experts.description",
  },
  {
    path: CONSOLE_ROUTES.tools,
    sectionKey: "sections.aiResources",
    sectionPath: CONSOLE_ROUTES.models,
    titleKey: "pages.tools.title",
    descriptionKey: "pages.tools.description",
  },
  {
    path: CONSOLE_ROUTES.rules,
    sectionKey: "sections.aiResources",
    sectionPath: CONSOLE_ROUTES.models,
    titleKey: "pages.rules.title",
    descriptionKey: "pages.rules.description",
  },
  {
    path: CONSOLE_ROUTES.billingDetails,
    sectionKey: "sections.billingManagement",
    sectionPath: CONSOLE_ROUTES.billingDetails,
    titleKey: "pages.billingDetails.title",
    descriptionKey: "pages.billingDetails.description",
  },
  {
    path: CONSOLE_ROUTES.billingSettings,
    sectionKey: "sections.billingManagement",
    sectionPath: CONSOLE_ROUTES.billingDetails,
    titleKey: "pages.billingSettings.title",
    descriptionKey: "pages.billingSettings.description",
  },
  {
    path: CONSOLE_ROUTES.membersAndGroups,
    sectionKey: "sections.systemSettings",
    sectionPath: CONSOLE_ROUTES.membersAndGroups,
    titleKey: "pages.membersAndGroups.title",
    descriptionKey: "pages.membersAndGroups.description",
  },
  {
    path: CONSOLE_ROUTES.operationLogs,
    sectionKey: "sections.systemSettings",
    sectionPath: CONSOLE_ROUTES.membersAndGroups,
    titleKey: "pages.operationLogs.title",
    descriptionKey: "pages.operationLogs.description",
  },
  {
    path: CONSOLE_ROUTES.otherSettings,
    sectionKey: "sections.systemSettings",
    sectionPath: CONSOLE_ROUTES.membersAndGroups,
    titleKey: "pages.otherSettings.title",
    descriptionKey: "pages.otherSettings.description",
  },
] as const

export function getConsolePage(pathname: string) {
  return CONSOLE_PAGES.find((page) => page.path === pathname)
}
