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

for (const extra of [0, 1]) {
  test(`compressed size ${extra === 0 ? "at" : "above"} 500 MiB`, async () => {
    const file = await createArchive({ "SKILL.md": VALID_MANIFEST })
    // 覆盖声明大小，避免为大小门槛测试实际分配数百 MiB。
    Object.defineProperty(file, "size", { value: 500 * 1024 * 1024 + extra })

    if (extra) {
      await assert.rejects(
        inspectSkillPackage(file),
        (error) =>
          error instanceof SkillPackageError && error.code === "fileTooLarge"
      )
    } else {
      assert.equal((await inspectSkillPackage(file)).name, "code-review")
    }
  })

  test(`expanded size ${extra === 0 ? "at" : "above"} 1 GiB`, async () => {
    const manifest = new File([VALID_MANIFEST], "SKILL.md")
    const data = new File([], "data.bin")
    Object.defineProperty(data, "size", {
      value: 1024 * 1024 * 1024 - manifest.size + extra,
    })

    if (extra) {
      await assert.rejects(
        inspectSkillDirectory([manifest, data]),
        (error) =>
          error instanceof SkillPackageError && error.code === "unpackedTooLarge"
      )
    } else {
      const [analysis] = await inspectSkillDirectory([manifest, data])
      assert.equal(analysis.unpackedSize, 1024 * 1024 * 1024)
    }
  })
}

for (const count of [5000, 5001]) {
  for (const source of ["archive", "directory"]) {
    test(`${source} accepts a skill with ${count} files`, async () => {
      const files = { "SKILL.md": VALID_MANIFEST }
      for (let i = 1; i < count; i++) {
        files[`reference-${i}.md`] = "reference"
      }
      const inspection =
        source === "archive"
          ? inspectSkillPackage(await createArchive(files))
          : inspectSkillDirectory(
              Object.entries(files).map(
                ([path, content]) => new File([content], path)
              )
            )

      const result = await inspection
      const analysis = source === "archive" ? result : result[0]
      assert.equal(analysis.fileCount, count)
    })
  }
}

for (const source of ["archive", "directory"]) {
  test(`${source} 接受超过 512 KiB 的 SKILL.md`, async () => {
    const content = VALID_MANIFEST + "正文\n".repeat(200000)
    const analysis = source === "archive"
      ? await inspectSkillPackage(await createArchive({ "SKILL.md": content }))
      : (await inspectSkillDirectory([new File([content], "SKILL.md")]))[0]
    assert.equal(analysis.content, content)
    assert.equal(analysis.name, "code-review")
  })
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

for (const root of ["", "code-review/"]) {
  test(`以 ${root || "ZIP 根目录"} 的 SKILL.md 为入口并保留嵌套文件`, async () => {
    const files = {
      [`${root}examples/child/SKILL.md`]: "附属文件，无需有效元信息",
      [`${root}references/SKILL.md`]: VALID_MANIFEST.replace("code-review", "nested"),
      [`${root}SKILL.md`]: VALID_MANIFEST,
    }
    const archive = await createArchive(files)
    const analysis = await inspectSkillPackage(archive)
    assert.equal(analysis.name, "code-review")
    assert.equal(analysis.entryPath, `${root}SKILL.md`)
    assert.equal(analysis.fileCount, 3)
    assert.equal(
      analysis.unpackedSize,
      Object.values(files).reduce((size, content) => size + Buffer.byteLength(content), 0)
    )
    assert.deepEqual(await inspectSkillArchive(archive), [analysis])
    const directory = Object.entries(files).map(([path, content]) => {
      const file = new File([content], path.split("/").at(-1))
      Object.defineProperty(file, "webkitRelativePath", { value: path })
      return file
    })
    assert.deepEqual(await inspectSkillDirectory(directory), [analysis])
  })
}

test("根目录入口无效时不回退到嵌套入口", async () => {
  await expectPackageError(
    { "SKILL.md": "无效入口", "nested/SKILL.md": VALID_MANIFEST },
    "invalidFrontmatter"
  )
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
