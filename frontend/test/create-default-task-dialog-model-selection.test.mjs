import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const dialogSource = readFileSync(
  new URL("../src/components/console/task/create-default-task-dialog.tsx", import.meta.url),
  "utf8",
)

test("侧边栏启动任务弹窗在用户选择模型后保留该选择", () => {
  assert.match(dialogSource, /const modelTouchedRef = useRef\(false\)/)
  assert.match(
    dialogSource,
    /const handleModelChange = \(modelId: string\) => \{[\s\S]*?modelTouchedRef\.current = true[\s\S]*?setSelectedModelId\(modelId\)[\s\S]*?\}/,
  )
  assert.match(
    dialogSource,
    /if \(!open \|\| modelTouchedRef\.current \|\| models\.length === 0\) \{[\s\S]*?return[\s\S]*?\}[\s\S]*?setSelectedModelId\(selectPreferredTaskModel\(models, subscription\)\)/,
  )
  assert.match(dialogSource, /setSelectedModelId=\{handleModelChange\}/)
})

test("侧边栏启动任务弹窗关闭时重置模型操作状态", () => {
  assert.match(
    dialogSource,
    /if \(!open\) \{[\s\S]*?modelTouchedRef\.current = false[\s\S]*?setSelectedModelId\(""\)/,
  )
})

test("侧边栏启动任务弹窗提交用户最后选择的模型", () => {
  assert.match(dialogSource, /model_id: selectedModelId/)
})
