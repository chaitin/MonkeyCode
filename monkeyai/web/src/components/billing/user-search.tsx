import { UserSearch, type UserSearchProps } from "@/components/user-search"

export function BillingUserSearch(props: UserSearchProps) {
  return <UserSearch includeDeleted id="billing-user" {...props} />
}
