import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("resource editors retain and save tags", async () => {
  for (const page of ["models", "experts", "tools"]) {
    const source = await readFile(
      new URL(`../src/pages/${page}-page.tsx`, import.meta.url),
      "utf8"
    )
    assert.match(source, /<SkillTagSelect/, `${page} is missing tag selection`)
    assert.match(source, /tag_ids:/, `${page} does not save tags`)
    assert.match(
      source,
      /\(.*\.tags \?\? \[\]\)\.map\(\(tag\) => tag\.id\)/,
      `${page} does not restore tags`
    )
  }
})

test("resource cards show configured tag names", async () => {
  const summary = await readFile(
    new URL("../src/components/resource-tag-summary.tsx", import.meta.url),
    "utf8"
  )
  assert.match(summary, /tagIds\.includes\(tag\.id\)/)
  assert.match(summary, /pages\.skills\.noTags/)

  for (const [page, item] of [
    ["models", "model"],
    ["experts", "expert"],
    ["tools", "server"],
  ]) {
    const source = await readFile(
      new URL(`../src/pages/${page}-page.tsx`, import.meta.url),
      "utf8"
    )
    assert.match(
      source,
      new RegExp(`<ResourceTagSummary tagIds=\\{${item}\\.tagIds\\}`)
    )
  }
})

test("models page uses backend models and authorization subjects", async () => {
  const source = await readFile(
    new URL("../src/pages/models-page.tsx", import.meta.url),
    "utf8"
  )

  assert.doesNotMatch(source, /INITIAL_MODELS/)
  assert.match(source, /\/api\/admin\/v1\/models/)
  assert.match(source, /\/authorization-subjects/)
  assert.match(source, /max_output_tokens/)
  assert.match(source, /api_key_configured/)
  assert.match(source, /openai_responses/)
  assert.doesNotMatch(source, /member-01|engineering|operations/)
})
