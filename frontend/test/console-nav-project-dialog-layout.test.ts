import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"

const source = readFileSync(
  new URL("../src/components/console/nav/nav-project.tsx", import.meta.url),
  "utf8",
)

function getDialogSource(stateName: string) {
  const start = source.indexOf(`<AlertDialog open={!!${stateName}}`)
  assert.notEqual(start, -1, `找不到 ${stateName} 弹窗`)

  const end = source.indexOf("</AlertDialog>", start)
  assert.notEqual(end, -1, `找不到 ${stateName} 弹窗结束标签`)

  return source.slice(start, end)
}

function assertDialogLayout(stateName: string, titleKey: string) {
  const dialogSource = getDialogSource(stateName)

  assert.match(
    dialogSource,
    /<AlertDialogContent[^>]*className="max-h-\[calc\(100dvh-2rem\)\] grid-rows-\[auto_minmax\(0,1fr\)_auto\] overflow-hidden"[^>]*>/,
  )
  assert.ok(
    dialogSource.includes(
      `<div
            role="region"
            tabIndex={0}
            aria-label={t("${titleKey}")}
            className="min-h-0 overflow-y-auto overscroll-contain outline-hidden ring-ring focus-visible:ring-2 focus-visible:ring-inset"
          >`,
    ),
  )
  assert.match(
    dialogSource,
    /<AlertDialogDescription className="break-words \[overflow-wrap:anywhere\]">/,
  )

  const headerEnd = dialogSource.indexOf("</AlertDialogHeader>")
  const footerStart = dialogSource.indexOf("<AlertDialogFooter>")
  const bodyStart = dialogSource.indexOf('<div\n            role="region"', headerEnd)
  assert.ok(headerEnd > -1 && bodyStart > headerEnd, "提示正文必须位于标题之外")
  assert.ok(footerStart > bodyStart, "操作区必须位于可滚动正文之外")
}

test("任务操作弹窗限制在视口内并保持操作区可见", () => {
  assertDialogLayout("taskToDelete", "navProject.deleteTask.title")
  assertDialogLayout("taskToStop", "navProject.stopTask.title")
})

test("所有 AlertDialog 使用默认宽度并把提示文字放在标题之外", () => {
  const root = new URL("../src/", import.meta.url)
  let count = 0
  for (const path of readdirSync(root, { recursive: true })) {
    if (!path.endsWith(".tsx")) continue
    const content = readFileSync(new URL(path, root), "utf8")
    count += (content.match(/<AlertDialog([ >]|$)/gm) ?? []).length
    assert.doesNotMatch(content, /<AlertDialogContent\b[^>]*\bsize="sm"/, path)
    assert.doesNotMatch(
      content,
      /<AlertDialogHeader\b[^>]*>(?:(?!<\/AlertDialogHeader>)[\s\S])*?<AlertDialogDescription\b/,
      path,
    )
  }
  assert.ok(count >= 47)
  const primitive = readFileSync(
    new URL("../src/components/ui/alert-dialog.tsx", import.meta.url),
    "utf8",
  )
  assert.match(primitive, /max-w-xs[^"\n]*sm:max-w-lg/)
  assert.doesNotMatch(primitive, /data-\[size=sm\]|size\?: "default" \| "sm"/)
})
