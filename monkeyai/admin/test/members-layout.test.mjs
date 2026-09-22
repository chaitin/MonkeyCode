import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import test from "node:test"

test("admin AlertDialogs use the default width and keep descriptions in the body", async () => {
  const root = new URL("../src/pages/", import.meta.url)
  let count = 0
  for (const path of await readdir(root)) {
    if (!path.endsWith(".tsx")) continue
    const content = await readFile(new URL(path, root), "utf8")
    count += (content.match(/<AlertDialog([ >]|$)/gm) ?? []).length
    assert.doesNotMatch(content, /<AlertDialogContent\b[^>]*\bsize="sm"/, path)
    assert.doesNotMatch(
      content,
      /<AlertDialogHeader\b[^>]*>(?:(?!<\/AlertDialogHeader>)[\s\S])*?<AlertDialogDescription\b/,
      path
    )
  }
  assert.ok(count >= 10)
  const primitive = await readFile(
    new URL("../src/components/ui/alert-dialog.tsx", import.meta.url),
    "utf8"
  )
  assert.match(primitive, /max-w-xs[^"\n]*sm:max-w-lg/)
  assert.doesNotMatch(primitive, /data-\[size=sm\]|size\?: "default" \| "sm"/)
})

test("members page keeps the original split cards and compact member list", async () => {
  const source = await readFile(
    new URL("../src/pages/members-and-groups-page.tsx", import.meta.url),
    "utf8"
  )

  assert.match(source, /md:h-\[calc\(100svh-5rem\)\]/)
  assert.doesNotMatch(source, /md:h-\[calc\(100svh-4rem\)\]/)
  assert.match(
    source,
    /md:grid-cols-\[minmax\(14rem,1fr\)_minmax\(0,1\.5fr\)\]/
  )
  assert.match(source, /pages\.membersAndGroups\.groupsTitle/)
  assert.match(source, /<ItemGroup/)
  assert.match(source, /<Item\s+key=\{user\.id\}[\s\S]*?variant="outline"/)
  assert.doesNotMatch(source, /variant=\{isDisabled \? "muted"/)
  assert.match(source, /<ItemFooter/)
  assert.match(
    source,
    /user\.role === "admin" && \(\s*<Badge\s+variant="outline"\s+className="border-green-500\/40 text-green-700 dark:border-green-400\/40 dark:text-green-400"/
  )
  assert.match(
    source,
    /isDisabled && \(\s*<Badge\s+variant="outline"\s+className="border-red-500\/40 text-red-700 dark:border-red-400\/40 dark:text-red-400"/
  )
  assert.match(source, /groupsByMember\.get\(user\.id\)/)
  assert.doesNotMatch(source, /pages\.membersAndGroups\.ungroupedMembers/)
  assert.match(source, /<MemberActions/)
  assert.match(
    source,
    /<MemberAvatar\s+role=\{user\.role\}\s+status=\{user\.status\}\s+size="lg"/
  )
  assert.doesNotMatch(source, /groupMemberIDs\(/)
  assert.match(source, /\.sort\(compareMembers\)/)
  assert.doesNotMatch(source, /<Table/)
})

test("both members panels scroll inside shadcn Scroll Areas", async () => {
  const page = await readFile(
    new URL("../src/pages/members-and-groups-page.tsx", import.meta.url),
    "utf8"
  )
  const panels = page.split("{activeGroupAction &&")[0]
  assert.match(
    page,
    /import \{ ScrollArea \} from "@\/components\/ui\/scroll-area"/
  )
  assert.equal((panels.match(/<ScrollArea className=/g) ?? []).length, 2)
  assert.match(
    panels,
    /<ScrollArea className="-ms-1 -me-\(--card-spacing\) min-h-0 min-w-0 flex-1 pe-\[calc\(var\(--card-spacing\)-4px\)\]">/
  )
  assert.match(
    panels,
    /<ScrollArea className="-me-\(--card-spacing\) min-h-0 min-w-0 flex-1 pe-\(--card-spacing\)">/
  )
  assert.equal((panels.match(/<\/ScrollArea>/g) ?? []).length, 2)
  assert.match(panels, /<ul\s+className="flex flex-col gap-1"/)
  assert.match(panels, /<ItemGroup className="gap-2">/)
  assert.doesNotMatch(panels, /<ul\s+className="[^"]*\bpe-2\b/)
  assert.doesNotMatch(panels, /<ItemGroup className="[^"]*\bpe-3\b/)
  assert.doesNotMatch(panels, /<CardContent[^>]*overflow-y-auto/)

  const component = await readFile(
    new URL("../src/components/ui/scroll-area.tsx", import.meta.url),
    "utf8"
  )
  assert.match(component, /@base-ui\/react\/scroll-area/)
  assert.match(component, /<ScrollAreaPrimitive.Viewport/)
  assert.match(component, /<ScrollAreaPrimitive.Scrollbar/)
})

test("add member button opens one dialog with tabs for single and bulk forms", async () => {
  const source = await readFile(
    new URL("../src/pages/members-and-groups-page.tsx", import.meta.url),
    "utf8"
  )
  const bulk = await readFile(
    new URL(
      "../src/components/members/bulk-add-members-form.tsx",
      import.meta.url
    ),
    "utf8"
  )
  assert.match(source, /icon=\{Add01Icon\}/)
  assert.doesNotMatch(source, /<DropdownMenuTrigger/)
  assert.match(source, /setCreateOpen\(true\)/)
  assert.match(source, /open=\{createOpen\}/)
  assert.match(source, /<Tabs\s+value=\{createMode\}/)
  assert.match(source, /<TabsContent value="single" keepMounted/)
  assert.match(source, /<TabsContent value="bulk" keepMounted/)
  assert.match(source, /createMode === "bulk" && \(\s*<DialogDescription>/)
  assert.doesNotMatch(source, /singleDescription/)
  assert.match(source, /<BulkAddMembersForm/)
  assert.match(
    source,
    /<Select\s+items=\{\{\s+user: t\("pages\.membersAndGroups\.bulk\.member"\),\s+admin: t\("pages\.membersAndGroups\.bulk\.administrator"\),/
  )
  assert.match(source, /<SelectTrigger id="new-user-role"/)
  assert.doesNotMatch(source, /<select\b/)
  assert.doesNotMatch(bulk, /<Dialog(?:\s|>)/)
  assert.match(bulk, /parseBulkEmails\(input\)/)
  assert.match(bulk, /validateBulkMembers\(rows, knownEmails, role\)/)
  assert.match(bulk, /createBulkMembers\(/)
  assert.match(
    bulk,
    /<Select\s+items=\{\{\s+user: t\(`\$\{key\}\.member`\),\s+admin: t\(`\$\{key\}\.administrator`\),/
  )
  assert.match(bulk, /<SelectTrigger id="bulk-member-role"/)
  assert.match(bulk, /t\(`\$\{key\}\.memberList`\)/)
  assert.doesNotMatch(bulk, /<select\b|previewCount/)
  assert.match(bulk, /<DialogFooter>[\s\S]*?t\(`\$\{key\}\.previous`\)/)
  assert.match(bulk, /t\(`\$\{key\}\.next`\)/)
  assert.doesNotMatch(bulk, /editEmails/)
})

test("member creation reports results in toasts and closes only on success", async () => {
  const source = await readFile(
    new URL("../src/pages/members-and-groups-page.tsx", import.meta.url),
    "utf8"
  )
  const bulk = await readFile(
    new URL(
      "../src/components/members/bulk-add-members-form.tsx",
      import.meta.url
    ),
    "utf8"
  )
  const singleSubmit = source
    .split("const createUser = async")[1]
    .split("const nameCollator = useMemo")[0]
  assert.match(singleSubmit, /status: "success"[\s\S]*?setCreateOpen\(false\)/)
  assert.match(
    singleSubmit,
    /catch \(reason\) \{\s*showToast\(\{ status: "error"/
  )
  assert.doesNotMatch(singleSubmit, /setError\(\(reason as Error\)\.message\)/)

  const successBranch = bulk
    .split("if (failures.size === 0) {")[1]
    .split("setRows(")[0]
  assert.match(successBranch, /status: "success"[\s\S]*?onClose\(\)/)
  assert.match(bulk, /setRows\([\s\S]*?showToast\(\{\s*status: "error"/)
  assert.doesNotMatch(bulk, /setResult\(|\{result &&/)
})

test("member actions require confirmation and report results with toasts", async () => {
  const source = await readFile(
    new URL("../src/pages/members-and-groups-page.tsx", import.meta.url),
    "utf8"
  )
  const dialog = await readFile(
    new URL(
      "../src/components/members/group-action-dialog.tsx",
      import.meta.url
    ),
    "utf8"
  )
  const memberAction = source
    .split("const confirmMemberAction = async")[1]
    .split("const visibleUsers = useMemo")[0]
  assert.match(source, /<AlertDialog\s+open=\{pendingMemberAction !== null\}/)
  assert.match(
    source,
    /<form className="flex flex-col gap-6" onSubmit=\{confirmMemberAction\}>/
  )
  assert.match(
    memberAction,
    /action === "makeAdministrator"\s*\? \{ role: "admin" \}/
  )
  assert.doesNotMatch(source, /rolePassword|promote-user-password/)
  assert.doesNotMatch(memberAction, /password/)
  assert.match(memberAction, /await updateUser\(user, patch, action\)/)
  assert.match(
    memberAction,
    /if \(await updateUser\(user, patch, action\)\) \{\s*setPendingMemberAction\(null\)/
  )
  assert.doesNotMatch(source, /void updateUser\(|roleTarget/)
  assert.match(
    source,
    /status: "success"[\s\S]*?pages\.membersAndGroups\.actionSucceeded/
  )
  assert.match(source, /catch \(reason\) \{\s*showToast\(\{ status: "error"/)
  assert.match(dialog, /status: "success"[\s\S]*?onSaved\(updated\)/)
  assert.match(dialog, /catch \(reason\) \{\s*showToast\(\{ status: "error"/)
  assert.doesNotMatch(dialog, /role="alert"|setError\(/)
})

test("the tree root starts expanded without checking its ID", async () => {
  const tree = await readFile(
    new URL("../src/components/members/group-tree.tsx", import.meta.url),
    "utf8"
  )
  assert.match(tree, /useState\(group\.parent_id === null\)/)
  assert.match(tree, /<Collapsible open=\{expanded\} onOpenChange=\{setExpanded\}>/)
  assert.doesNotMatch(tree, /ROOT_GROUP_ID|ungroupedExpanded/)
})

test("members appear directly under their group without a virtual ungrouped row", async () => {
  const tree = await readFile(
    new URL("../src/components/members/group-tree.tsx", import.meta.url),
    "utf8"
  )
  assert.match(tree, /\{memberRows\}/)
  assert.match(tree, /directMemberIDs\(groups, group\.id\)/)
  assert.match(tree, /const actions = group\.actions/)
  assert.doesNotMatch(tree, /ungroupedMembers|isRoot|ungroupedExpanded/)
})

test("group rows swap the count for actions in the same slot on hover", async () => {
  const tree = await readFile(
    new URL("../src/components/members/group-tree.tsx", import.meta.url),
    "utf8"
  )
  const actionSlot = tree
    .split('"relative flex h-8 shrink-0 items-center justify-center"')[1]
    .split("</DropdownMenu>")[0]
  assert.match(actionSlot, /\{count\}/)
  assert.match(actionSlot, /<DropdownMenu onOpenChange=\{setMenuOpen\}>/)
  assert.match(actionSlot, /size="icon-xs"/)
  assert.match(actionSlot, /showActions && "w-6"/)
  assert.match(actionSlot, /onFocusCapture=/)
  assert.match(actionSlot, /pointer-events-none absolute inset-0 m-auto/)
  assert.match(actionSlot, /icon=\{MoreHorizontalIcon\}\s+className="size-4"/)
  assert.match(actionSlot, /showActions && "opacity-0"/)
  assert.match(
    actionSlot,
    /showActions &&\s*"pointer-events-auto opacity-100 transition-opacity duration-100 ease-out motion-reduce:transition-none"/
  )
  assert.match(actionSlot, /opacity-0 transition-none hover:bg-foreground\/5/)
  assert.match(actionSlot, /aria-expanded:bg-foreground\/5/)
  assert.match(actionSlot, /dark:hover:bg-foreground\/5/)
  assert.equal(
    (actionSlot.match(/transition-opacity duration-100 ease-out/g) ?? [])
      .length,
    1
  )
  assert.equal(
    (actionSlot.match(/motion-reduce:transition-none/g) ?? []).length,
    1
  )
  assert.match(actionSlot, /focus-visible:opacity-100/)
  assert.doesNotMatch(actionSlot, /hover:none|group-hover\/group-row/)
  assert.equal((tree.match(/onPointerEnter=/g) ?? []).length, 2)
  assert.equal((tree.match(/onPointerLeave=/g) ?? []).length, 2)
  assert.equal((tree.match(/bg-foreground\/5/g) ?? []).length, 5)
  assert.equal(
    (tree.match(/\(hovered \|\| menuOpen\) && "bg-foreground\/5"/g) ?? [])
      .length,
    2
  )
  assert.doesNotMatch(tree, /ungroupedHovered/)
  assert.equal(
    (
      tree.match(
        /"group\/group-row flex cursor-pointer items-center rounded-md pe-1 transition-colors"/g
      ) ?? []
    ).length,
    1
  )
  assert.doesNotMatch(tree, /bg-foreground\/8|dark:bg-foreground\/10/)
  const memberRow = tree.split("function GroupTreeMemberRow(")[1]
  assert.match(
    memberRow,
    /"flex min-w-0 cursor-pointer items-center gap-2 rounded-md pe-1 text-sm transition-colors"/
  )
  assert.match(memberRow, /treeActionsVisible=\{showActions\}/)
  assert.match(memberRow, /onMenuOpenChange=\{setMenuOpen\}/)
  assert.match(memberRow, /showActions \? "w-6" : "w-0"/)
  assert.doesNotMatch(memberRow, /transition-\[width\]/)
  const memberActions = await readFile(
    new URL("../src/components/members/member-actions.tsx", import.meta.url),
    "utf8"
  )
  assert.match(memberActions, /treeActionsVisible !== undefined/)
  assert.match(
    memberActions,
    /"cursor-pointer hover:bg-foreground\/5 aria-expanded:bg-foreground\/5 dark:hover:bg-foreground\/5"/
  )
  assert.match(
    memberActions,
    /size=\{treeActionsVisible !== undefined \? "icon-xs" : "icon-sm"\}/
  )
  assert.match(
    memberActions,
    /treeActionsVisible !== undefined &&\s*"pointer-events-none opacity-0 transition-none focus-visible:pointer-events-auto focus-visible:opacity-100"/
  )
  assert.match(
    memberActions,
    /className=\{treeActionsVisible !== undefined \? "size-4" : undefined\}/
  )
  assert.match(memberActions, /transition-opacity duration-100 ease-out/)
  assert.match(memberActions, /motion-reduce:transition-none/)
  assert.match(
    memberActions,
    /\(treeActionsVisible \|\| open\) &&\s*"pointer-events-auto opacity-100 transition-opacity duration-100 ease-out motion-reduce:transition-none"/
  )
  assert.match(memberActions, /onMenuOpenChange\?\.\(nextOpen\)/)
})

test("tree and list share the same member action menu", async () => {
  const tree = await readFile(
    new URL("../src/components/members/group-tree.tsx", import.meta.url),
    "utf8"
  )
  const actions = await readFile(
    new URL("../src/components/members/member-actions.tsx", import.meta.url),
    "utf8"
  )
  assert.match(tree, /directMemberIDs\(/)
  assert.match(
    tree,
    /className="size-4 shrink-0 text-yellow-600 dark:text-yellow-400"/
  )
  assert.equal(
    (
      tree.match(
        /\.sort\(\(a, b\) => compareByName\(a, b, nameCollator\)\)/g
      ) ?? []
    ).length,
    2
  )
  assert.match(tree, /<MemberActions/)
  const avatar = await readFile(
    new URL("../src/components/members/member-avatar.tsx", import.meta.url),
    "utf8"
  )
  assert.match(tree, /icon=\{User02Icon\}/)
  assert.match(tree, /memberIconColor\(member\)/)
  assert.doesNotMatch(tree, /<MemberAvatar/)
  assert.match(avatar, /<Avatar size=\{size\}>/)
  assert.match(avatar, /<AvatarFallback>/)
  assert.match(avatar, /status === "disabled"\s*\?\s*UserRoundXIcon/)
  assert.match(
    avatar,
    /role === "admin"\s*\?\s*UserRoundCogIcon\s*:\s*UserRoundCheckIcon/
  )
  assert.match(avatar, /memberIconColor\(\{ role, status \}\)/)
  assert.match(actions, /<DropdownMenu/)
})
