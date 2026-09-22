# React + TypeScript + Vite + shadcn/ui

This is a template for a new Vite project with React, TypeScript, and shadcn/ui.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `src/components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button"
```

## GroupSelect

`src/components/group-select.tsx` provides a controlled group/user tree selector.
It does not fetch data or apply membership permissions; callers supply options,
localized text, and disabled states. `MemberGroupSelect` wraps it for member creation.

```tsx
import { useState } from "react"
import { GroupSelect, type GroupSelectionValue } from "@/components/group-select"

function AssigneeSelect() {
  const [value, setValue] = useState<GroupSelectionValue>({
    groupIds: [],
    userIds: [],
  })

  return (
    <GroupSelect
      options={[
        { id: "team", name: "团队", disabled: true },
        { id: "engineering", parentId: "team", name: "研发" },
      ]}
      users={[
        { id: "alice", name: "Alice", groupIds: ["engineering"] },
      ]}
      value={value}
      onValueChange={setValue}
      label="负责人"
      placeholder="选择负责人"
      emptyText="暂无可选项"
      locale="zh-CN"
      defaultExpanded
      collapsible
      multiple={false}
      selectionMode="users"
      searchable
      searchPlaceholder="搜索名称、邮箱或拼音"
      noResultsText="没有匹配的分组或用户"
    />
  )
}
```

| Prop | Default | Behavior |
| --- | --- | --- |
| `defaultExpanded` | `true` | Initial expansion of all folders, including leaves; later prop changes do not reset expansion. |
| `collapsible` | `true` | Enables clicking folder icons to expand/collapse independently of selection. |
| `multiple` | `true` | Allows multiple selections. When false, selecting an item replaces both ID lists and closes the popover. |
| `searchable` | `false` | Shows a fixed search field above the scrollable tree. Searches names, user emails, and Chinese pinyin (full spelling or initials), retaining ancestor paths and matched groups' subtrees. |
| `searchPlaceholder` | `label` | Localized search placeholder and accessible label. |
| `noResultsText` | `emptyText` | Localized message for no search matches. |
| `selectionMode` | `"groups"` | `"groups"` shows/selects folders only; `"users"` shows users with folders as containers; `"both"` allows selecting both. |
| `options` | Required | Flat `{ id, parentId?, name, disabled? }` group data. Missing parents appear at the top level. |
| `users` | `[]` | `{ id, name, groupIds, disabled? }` records. Users with no matching group appear at the top level; users in multiple groups share one selection. |
| `value` / `onValueChange` | Required | Controlled `{ groupIds, userIds }` value. |
| `cascadeGroups` | `false` | Authorization inheritance for multi-selection: selecting a group covers descendants and their users, removes redundant explicit grants, and shows inherited/partial checkbox states. Without it, selections are independent. |

Use `defaultExpanded={true}` with `collapsible={false}` for an always expanded tree.
With both false, folders remain closed. Reset the controlled value when changing
selection modes; in single mode, supply at most one selected ID across both lists.
Pass `id` to associate an external `FieldLabel`; otherwise an ID is generated.
The trigger displays selected names without ancestor paths.
Searching temporarily expands matching paths without modifying selections or saved
folder expansion. Clearing the query restores folder expansion; closing the
popover clears the query. Authorization inheritance always uses the complete tree,
even when search hides some nodes. Supply `email` on user options to enable email
matching; email addresses are not displayed in the tree. Pinyin supports joined or
spaced spelling (`zhangsan` / `zhang san`) and initials (`zs`), using the library's
contextual pronunciation for Chinese names. Search indexes are memoized so typing
does not repeat transliteration.
