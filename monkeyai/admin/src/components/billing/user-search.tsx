import { UserSearch, type UserSearchProps } from "@/components/user-search"

export function BillingUserSearch(props: UserSearchProps) {
  return <UserSearch id="billing-user" {...props} />
}
