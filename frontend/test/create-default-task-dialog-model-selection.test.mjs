import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import ts from "typescript"

const dialogSource = readFileSync(
  new URL("../src/components/console/task/create-default-task-dialog.tsx", import.meta.url),
  "utf8",
)

const selectionSource = readFileSync(
  new URL("../src/components/console/task/task-model-selection.ts", import.meta.url),
  "utf8",
)
const selectionModule = await import(
  `data:text/javascript,${encodeURIComponent(ts.transpileModule(selectionSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext },
  }).outputText)}`
)
const { resolveTaskModelSelection } = selectionModule

test("侧边栏启动任务弹窗在用户选择模型后保留该选择", () => {
  assert.match(dialogSource, /const modelTouchedRef = useRef\(false\)/)
  assert.match(
    dialogSource,
    /const handleModelChange = \(modelId: string\) => \{[\s\S]*?modelTouchedRef\.current = true[\s\S]*?setSelectedModelId\(modelId\)[\s\S]*?\}/,
  )
  assert.match(
    dialogSource,
    /setSelectedModelId\(\(currentModelId\) => resolveTaskModelSelection\(\{/,
  )
  assert.match(dialogSource, /setSelectedModelId=\{handleModelChange\}/)
})

test("模型数据刷新时执行真实的选择保持规则", () => {
  const initialModelId = resolveTaskModelSelection({
    availableModelIds: ["default", "custom"],
    currentModelId: "",
    preferredModelId: "default",
    touched: false,
  })
  assert.equal(initialModelId, "default")

  const selectedModelId = resolveTaskModelSelection({
    availableModelIds: ["new-default", "custom"],
    currentModelId: "custom",
    preferredModelId: "new-default",
    touched: true,
  })
  assert.equal(selectedModelId, "custom")
})

test("用户选择的模型失效后要求重新选择", () => {
  const selectedModelId = resolveTaskModelSelection({
    availableModelIds: ["new-default"],
    currentModelId: "custom",
    preferredModelId: "new-default",
    touched: true,
  })

  assert.equal(selectedModelId, "")
  assert.match(
    dialogSource,
    /!selectedModelId[\s\S]*?\|\| !selectedModel[\s\S]*?\|\| !canUseModelBySubscription\(selectedModel, subscription\)/,
  )
})

test("模型列表暂不可用或用户尚未完成选择时保持空值", () => {
  assert.equal(resolveTaskModelSelection({
    availableModelIds: [],
    currentModelId: "custom",
    preferredModelId: "",
    touched: true,
  }), "")
  assert.equal(resolveTaskModelSelection({
    availableModelIds: ["default"],
    currentModelId: "",
    preferredModelId: "default",
    touched: true,
  }), "")
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
