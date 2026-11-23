export const LOGIN_PATH = "/login"
export const CLIENT_ROUTE = "/client/*"
export const CONSOLE_PATH = "/admin"

export const CONSOLE_ROUTES = {
  cloudHosts: `${CONSOLE_PATH}/environments/cloud-hosts`,
  environments: `${CONSOLE_PATH}/environments/instances`,
  environmentCapacity: `${CONSOLE_PATH}/environments/capacity`,
  environmentQuotas: `${CONSOLE_PATH}/environments/quotas`,
  overview: `${CONSOLE_PATH}/statistics/overview`,
  realtimeStatus: `${CONSOLE_PATH}/statistics/models`,
  taskHistory: `${CONSOLE_PATH}/statistics/task-history`,
  conversationHistory: `${CONSOLE_PATH}/statistics/conversation-history`,
  sessionDetail: `${CONSOLE_PATH}/statistics/session-reporting/sessions/:sessionId`,
  memberAnalysis: `${CONSOLE_PATH}/statistics/members`,
  taskAnalysis: `${CONSOLE_PATH}/statistics/sessions`,
  resourceAnalysis: `${CONSOLE_PATH}/statistics/ai-behavior`,
  clientAnalysis: `${CONSOLE_PATH}/statistics/clients`,
  models: `${CONSOLE_PATH}/resources/models`,
  kb: `${CONSOLE_PATH}/resources/kb`,
  skills: `${CONSOLE_PATH}/resources/skills`,
  experts: `${CONSOLE_PATH}/resources/experts`,
  tools: `${CONSOLE_PATH}/resources/tools`,
  rules: `${CONSOLE_PATH}/resources/rules`,
  resourceImports: `${CONSOLE_PATH}/resources/imports`,
  billingDetails: `${CONSOLE_PATH}/billing/details`,
  billingSettings: `${CONSOLE_PATH}/billing/settings`,
  membersAndGroups: `${CONSOLE_PATH}/settings/members`,
  feedback: `${CONSOLE_PATH}/settings/feedback`,
  operationLogs: `${CONSOLE_PATH}/settings/operation-logs`,
  otherSettings: `${CONSOLE_PATH}/settings/other`,
  engineHosts: `${CONSOLE_PATH}/settings/engine-hosts`,
} as const

export const DEFAULT_CONSOLE_PATH = CONSOLE_ROUTES.realtimeStatus

export const CONSOLE_PAGES = [
  {
    path: CONSOLE_ROUTES.cloudHosts,
    sectionKey: "sections.aiResources",
    sectionPath: CONSOLE_ROUTES.models,
    titleKey: "environmentAdmin.cloudHostsTitle",
    descriptionKey: "environmentAdmin.cloudHostsDescription",
  },
  {
    path: CONSOLE_ROUTES.overview,
    sectionKey: "sections.statistics",
    sectionPath: CONSOLE_ROUTES.realtimeStatus,
    titleKey: "pages.overview.title",
    descriptionKey: "pages.overview.description",
  },
  {
    path: CONSOLE_ROUTES.realtimeStatus,
    sectionKey: "sections.statistics",
    sectionPath: CONSOLE_ROUTES.realtimeStatus,
    titleKey: "pages.realtimeStatus.title",
    descriptionKey: "pages.realtimeStatus.description",
  },
  {
    path: CONSOLE_ROUTES.taskHistory,
    sectionKey: "sections.usageRecords",
    sectionPath: CONSOLE_ROUTES.taskHistory,
    titleKey: "pages.taskHistory.title",
    descriptionKey: "pages.taskHistory.description",
  },
  {
    path: CONSOLE_ROUTES.conversationHistory,
    sectionKey: "sections.usageRecords",
    sectionPath: CONSOLE_ROUTES.taskHistory,
    titleKey: "pages.conversationHistory.title",
    descriptionKey: "pages.conversationHistory.description",
  },
  ...(
    [
      ["memberAnalysis", CONSOLE_ROUTES.memberAnalysis],
      ["taskAnalysis", CONSOLE_ROUTES.taskAnalysis],
      ["clientAnalysis", CONSOLE_ROUTES.clientAnalysis],
      ["resourceAnalysis", CONSOLE_ROUTES.resourceAnalysis],
    ] as const
  ).map(([name, path]) => ({
    path,
    sectionKey: "sections.statistics",
    sectionPath: CONSOLE_ROUTES.realtimeStatus,
    titleKey: `pages.sessionReporting.${name}.title`,
    descriptionKey: `pages.sessionReporting.${name}.description`,
  })),
  {
    path: CONSOLE_ROUTES.models,
    sectionKey: "sections.aiResources",
    sectionPath: CONSOLE_ROUTES.models,
    titleKey: "pages.models.title",
    descriptionKey: "pages.models.description",
  },
  {
    path: CONSOLE_ROUTES.kb,
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
    path: CONSOLE_ROUTES.resourceImports,
    sectionKey: "sections.aiResources",
    sectionPath: CONSOLE_ROUTES.models,
    titleKey: "pages.resourceImports.title",
    descriptionKey: "pages.resourceImports.description",
  },
  {
    path: CONSOLE_ROUTES.billingDetails,
    sectionKey: "sections.billingManagement",
    sectionPath: CONSOLE_ROUTES.billingSettings,
    titleKey: "pages.billingDetails.title",
    descriptionKey: "pages.billingDetails.description",
  },
  {
    path: CONSOLE_ROUTES.billingSettings,
    sectionKey: "sections.billingManagement",
    sectionPath: CONSOLE_ROUTES.billingSettings,
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
    path: CONSOLE_ROUTES.feedback,
    sectionKey: "sections.systemSettings",
    sectionPath: CONSOLE_ROUTES.membersAndGroups,
    titleKey: "pages.feedback.title",
    descriptionKey: "pages.feedback.description",
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
  return (
    CONSOLE_PAGES.find((page) => page.path === pathname) ??
    (pathname.startsWith(`${CONSOLE_ROUTES.kb}/`)
      ? {
          path: pathname,
          sectionKey: "sections.aiResources",
          sectionPath: CONSOLE_ROUTES.kb,
          titleKey: "pages.knowledgeBases.preview",
          descriptionKey: "pages.knowledgeBases.description",
        }
      : undefined) ??
    (pathname.startsWith(CONSOLE_ROUTES.sessionDetail.replace(":sessionId", ""))
      ? {
          path: pathname,
          sectionKey: "sections.usageRecords",
          sectionPath: CONSOLE_ROUTES.taskHistory,
          titleKey: "pages.sessionReporting.detail.title",
          descriptionKey: "pages.sessionReporting.detail.description",
        }
      : undefined)
  )
}
