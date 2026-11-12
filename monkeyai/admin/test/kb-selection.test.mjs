import assert from "node:assert/strict"
import test from "node:test"
import { toggleKbSelection } from "../src/lib/kb-selection.ts"

const tree = [
  { id: "folder", children: [
    { id: "file" },
    { id: "nested", children: [{ id: "deep-file" }] },
  ] },
  { id: "other" },
  { id: "empty", children: [] },
]

test("selecting a folder includes all descendants and preserves other selections without duplicates", () => {
  assert.deepEqual(new Set(toggleKbSelection(tree, ["other", "file"], "folder")),
    new Set(["other", "folder", "file", "nested", "deep-file"]))
})

test("deselecting a folder clears its entire subtree only", () => {
  const selected = toggleKbSelection(tree, ["other"], "folder")
  assert.deepEqual(toggleKbSelection(tree, selected, "folder"), ["other"])
})

test("deselecting a descendant clears selected ancestors so batch actions cannot include it", () => {
  const selected = toggleKbSelection(tree, ["other"], "folder")
  assert.deepEqual(new Set(toggleKbSelection(tree, selected, "deep-file")), new Set(["other", "file"]))
})

test("files and empty folders can be toggled independently", () => {
  assert.deepEqual(toggleKbSelection(tree, [], "empty"), ["empty"])
  assert.deepEqual(toggleKbSelection(tree, ["empty"], "empty"), [])
  assert.deepEqual(toggleKbSelection(tree, [], "file"), ["file"])
})
