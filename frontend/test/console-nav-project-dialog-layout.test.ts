import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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
    /<AlertDialogContent[^>]*className="max-h-\[calc\(100dvh-2rem\)\] grid-rows-\[minmax\(0,1fr\)_auto\] overflow-hidden"[^>]*>/,
  )
  assert.ok(
    dialogSource.includes(
      `<AlertDialogHeader
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
  assert.ok(headerEnd > -1 && footerStart > headerEnd, "操作区必须位于可滚动 Header 之外")
}

test("任务操作弹窗限制在视口内并保持操作区可见", () => {
  assertDialogLayout("taskToDelete", "navProject.deleteTask.title")
  assertDialogLayout("taskToStop", "navProject.stopTask.title")
})
