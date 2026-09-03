import type { TFunction } from "i18next"

export type AuthorizationGroup =
  | "all-members"
  | "administrators"
  | "product-and-engineering"
  | "product"
  | "engineering"
  | "operations"

export type AuthorizationGroupNode = {
  value: AuthorizationGroup
  labelKey: string
  children?: AuthorizationGroupNode[]
}

export type AuthorizationMember = {
  id: string
  name: string
  email: string
  groupId: AuthorizationGroup
}

export type AuthorizationSelection = {
  groupIds: AuthorizationGroup[]
  memberIds: string[]
}

export const AUTHORIZATION_GROUP_TREE: AuthorizationGroupNode[] = [
  {
    value: "all-members",
    labelKey: "pages.membersAndGroups.groupNames.rootGroup",
    children: [
      {
        value: "administrators",
        labelKey: "pages.membersAndGroups.groupNames.administrators",
      },
      {
        value: "product-and-engineering",
        labelKey: "pages.membersAndGroups.groupNames.productAndEngineering",
        children: [
          {
            value: "product",
            labelKey: "pages.membersAndGroups.groupNames.product",
          },
          {
            value: "engineering",
            labelKey: "pages.membersAndGroups.groupNames.engineering",
          },
        ],
      },
      {
        value: "operations",
        labelKey: "pages.membersAndGroups.groupNames.operations",
      },
    ],
  },
]

function flattenAuthorizationGroups(
  groups: AuthorizationGroupNode[]
): AuthorizationGroupNode[] {
  return groups.flatMap((group) => [
    group,
    ...flattenAuthorizationGroups(group.children ?? []),
  ])
}

export const AUTHORIZATION_GROUPS = flattenAuthorizationGroups(
  AUTHORIZATION_GROUP_TREE
)

export const AUTHORIZATION_MEMBERS: AuthorizationMember[] = [
  {
    id: "member-01",
    name: "陈晨",
    email: "chen.chen@example.com",
    groupId: "administrators",
  },
  {
    id: "member-02",
    name: "Alice Zhang",
    email: "alice.zhang@example.com",
    groupId: "administrators",
  },
  {
    id: "member-03",
    name: "Omar Hassan",
    email: "omar.hassan@example.com",
    groupId: "administrators",
  },
  {
    id: "member-04",
    name: "林玫",
    email: "lin.mei@example.com",
    groupId: "product",
  },
  {
    id: "member-05",
    name: "Sophia Chen",
    email: "sophia.chen@example.com",
    groupId: "product",
  },
  {
    id: "member-06",
    name: "Lucas Martin",
    email: "lucas.martin@example.com",
    groupId: "product",
  },
  {
    id: "member-07",
    name: "Priya Patel",
    email: "priya.patel@example.com",
    groupId: "product",
  },
  {
    id: "member-08",
    name: "Carlos Silva",
    email: "carlos.silva@example.com",
    groupId: "product",
  },
  {
    id: "member-09",
    name: "王伟",
    email: "wang.wei@example.com",
    groupId: "engineering",
  },
  {
    id: "member-10",
    name: "Alex Kim",
    email: "alex.kim@example.com",
    groupId: "engineering",
  },
  {
    id: "member-11",
    name: "Daniel Weber",
    email: "daniel.weber@example.com",
    groupId: "engineering",
  },
  {
    id: "member-12",
    name: "Elena Petrova",
    email: "elena.petrova@example.com",
    groupId: "engineering",
  },
  {
    id: "member-13",
    name: "Yuki Tanaka",
    email: "yuki.tanaka@example.com",
    groupId: "engineering",
  },
  {
    id: "member-14",
    name: "Minh Nguyen",
    email: "minh.nguyen@example.com",
    groupId: "engineering",
  },
  {
    id: "member-15",
    name: "Ahmed Saleh",
    email: "ahmed.saleh@example.com",
    groupId: "engineering",
  },
  {
    id: "member-16",
    name: "María García",
    email: "maria.garcia@example.com",
    groupId: "engineering",
  },
  {
    id: "member-17",
    name: "Ethan Brown",
    email: "ethan.brown@example.com",
    groupId: "engineering",
  },
  {
    id: "member-18",
    name: "李娜",
    email: "li.na@example.com",
    groupId: "operations",
  },
  {
    id: "member-19",
    name: "Emma Wilson",
    email: "emma.wilson@example.com",
    groupId: "operations",
  },
  {
    id: "member-20",
    name: "João Santos",
    email: "joao.santos@example.com",
    groupId: "operations",
  },
  {
    id: "member-21",
    name: "Fatima Zahra",
    email: "fatima.zahra@example.com",
    groupId: "operations",
  },
  {
    id: "member-22",
    name: "박지훈",
    email: "jihoon.park@example.com",
    groupId: "operations",
  },
  {
    id: "member-23",
    name: "Ivan Smirnov",
    email: "ivan.smirnov@example.com",
    groupId: "operations",
  },
  {
    id: "member-24",
    name: "Ana López",
    email: "ana.lopez@example.com",
    groupId: "operations",
  },
]

export function getAuthorizationGroupNames(
  groupIds: AuthorizationGroup[],
  t: TFunction
) {
  return groupIds
    .map((groupId) => {
      const group = AUTHORIZATION_GROUPS.find((item) => item.value === groupId)

      return group ? t(group.labelKey) : groupId
    })
    .join(", ")
}

export function getAuthorizationNames(
  authorization: AuthorizationSelection,
  t: TFunction
) {
  const groupNames = authorization.groupIds.map((groupId) => {
    const group = AUTHORIZATION_GROUPS.find((item) => item.value === groupId)

    return group ? t(group.labelKey) : groupId
  })
  const memberNames = authorization.memberIds.map((memberId) => {
    const member = AUTHORIZATION_MEMBERS.find((item) => item.id === memberId)

    return member?.name ?? memberId
  })

  return [...groupNames, ...memberNames].join(", ")
}
