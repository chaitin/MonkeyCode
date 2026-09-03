import assert from "node:assert/strict"
import test from "node:test"

import JSZip from "jszip"

import {
  inspectSkillArchive,
  inspectSkillDirectory,
  inspectSkillPackage,
  SkillPackageError,
} from "../src/lib/skill-package.ts"

const VALID_MANIFEST = `---
name: code-review
description: Review code for correctness and security.
tags:
  - code
  - security
---

# Code review
`

async function createArchive(files) {
  const archive = new JSZip()

  for (const [path, content] of Object.entries(files)) {
    archive.file(path, content)
  }

  const bytes = await archive.generateAsync({
    type: "uint8array",
    platform: "UNIX",
  })

  return new File([bytes], "skill.zip", { type: "application/zip" })
}

async function expectPackageError(files, code) {
  const file = await createArchive(files)

  await assert.rejects(
    inspectSkillPackage(file),
    (error) => error instanceof SkillPackageError && error.code === code
  )
}

test("recognizes a skill directory and parses SKILL.md metadata", async () => {
  const file = await createArchive({
    "code-review/SKILL.md": VALID_MANIFEST,
    "code-review/scripts/check.sh": "#!/bin/sh\n",
    "code-review/references/checklist.md": "# Checklist\n",
  })

  const result = await inspectSkillPackage(file)

  assert.equal(result.name, "code-review")
  assert.equal(result.description, "Review code for correctness and security.")
  assert.deepEqual(result.tags, ["code", "security"])
  assert.equal(result.entryPath, "code-review/SKILL.md")
  assert.equal(result.rootPath, "code-review")
  assert.equal(result.fileCount, 3)
  assert.ok(result.unpackedSize > 0)
})

test("rejects archives without SKILL.md", async () => {
  await expectPackageError({ "README.md": "not a skill" }, "missingManifest")
})

test("rejects archives with multiple skill entries", async () => {
  await expectPackageError(
    {
      "one/SKILL.md": VALID_MANIFEST,
      "two/SKILL.md": VALID_MANIFEST.replace("code-review", "other-skill"),
    },
    "multipleManifests"
  )
})

test("discovers multiple skills in one archive", async () => {
  const file = await createArchive({
    "bundle/one/SKILL.md": VALID_MANIFEST,
    "bundle/one/scripts/check.sh": "#!/bin/sh\n",
    "bundle/two/SKILL.md": VALID_MANIFEST.replace("code-review", "other-skill"),
    "bundle/two/reference.md": "# Reference\n",
    "bundle/README.md": "# Skill bundle\n",
  })

  const results = await inspectSkillArchive(file)

  assert.deepEqual(
    results.map((skill) => skill.name),
    ["code-review", "other-skill"]
  )
  assert.deepEqual(
    results.map((skill) => skill.fileCount),
    [2, 2]
  )
})

test("discovers multiple skills from a browser directory selection", async () => {
  const makeDirectoryFile = (path, content) => {
    const file = new File([content], path.split("/").at(-1))
    Object.defineProperty(file, "webkitRelativePath", { value: path })
    return file
  }
  const files = [
    makeDirectoryFile("skills/one/SKILL.md", VALID_MANIFEST),
    makeDirectoryFile("skills/one/check.md", "# Check\n"),
    makeDirectoryFile(
      "skills/two/SKILL.md",
      VALID_MANIFEST.replace("code-review", "other-skill")
    ),
  ]

  const results = await inspectSkillDirectory(files)

  assert.deepEqual(
    results.map((skill) => skill.name),
    ["code-review", "other-skill"]
  )
  assert.deepEqual(
    results.map((skill) => skill.fileCount),
    [2, 1]
  )
})

test("rejects files outside the skill directory", async () => {
  await expectPackageError(
    {
      "code-review/SKILL.md": VALID_MANIFEST,
      "README.md": "outside",
    },
    "mixedRoot"
  )
})

test("rejects SKILL.md without valid frontmatter", async () => {
  await expectPackageError(
    { "code-review/SKILL.md": "# Missing frontmatter" },
    "invalidFrontmatter"
  )
})

test("rejects unsafe archive paths", async () => {
  await expectPackageError(
    {
      "code-review/SKILL.md": VALID_MANIFEST,
      "../outside.txt": "unsafe",
    },
    "unsafePath"
  )
})

test("rejects symbolic links", async () => {
  const archive = new JSZip()
  archive.file("code-review/SKILL.md", VALID_MANIFEST)
  archive.file("code-review/reference", "target.txt", {
    unixPermissions: 0o120777,
  })
  const bytes = await archive.generateAsync({
    type: "uint8array",
    platform: "UNIX",
  })
  const file = new File([bytes], "skill.zip", { type: "application/zip" })

  await assert.rejects(
    inspectSkillPackage(file),
    (error) => error instanceof SkillPackageError && error.code === "symlink"
  )
})
