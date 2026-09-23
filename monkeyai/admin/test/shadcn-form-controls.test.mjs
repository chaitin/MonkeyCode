import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import test from "node:test"

const sourceRoot = new URL("../src/", import.meta.url)

test("admin forms use shared shadcn controls instead of native form elements", async () => {
  const files = (await readdir(sourceRoot, { recursive: true }))
    .filter((path) => path.endsWith(".tsx"))
    .filter((path) => !path.startsWith("components/ui/"))

  for (const path of files) {
    const source = await readFile(new URL(path, sourceRoot), "utf8")
    assert.doesNotMatch(
      source,
      /<(?:input|select|textarea|details|summary)\b|type="(?:checkbox|radio)"/,
      `${path} should use the shared shadcn controls`
    )
  }
})

test("specialized admin forms use the matching shadcn control", async () => {
  const [
    tools,
    imageTest,
    billing,
    models,
    imageCapabilities,
    experts,
    credentials,
  ] = await Promise.all(
    [
      "pages/tools-page.tsx",
      "components/image-generation-test.tsx",
      "pages/billing-details-page.tsx",
      "pages/models-page.tsx",
      "components/image-capability-selector.tsx",
      "pages/experts-page.tsx",
      "components/connector-credentials.tsx",
    ].map(async (path) => [
      path,
      await readFile(new URL(path, sourceRoot), "utf8"),
    ])
  )
  const sources = Object.fromEntries([
    tools,
    imageTest,
    billing,
    models,
    imageCapabilities,
    experts,
    credentials,
  ])

  assert.match(sources["pages/tools-page.tsx"], /<Select/)
  assert.match(sources["components/image-generation-test.tsx"], /<Textarea/)
  assert.match(sources["components/image-generation-test.tsx"], /<Select/)
  assert.match(
    sources["pages/billing-details-page.tsx"],
    /items=\{resultItems\}/
  )
  assert.match(sources["pages/models-page.tsx"], /<ImageCapabilitySelector/)
  assert.match(
    sources["components/image-capability-selector.tsx"],
    /<ToggleGroup/
  )
  assert.match(sources["pages/experts-page.tsx"], /<Checkbox/)
  assert.match(sources["components/connector-credentials.tsx"], /<Checkbox/)
})
