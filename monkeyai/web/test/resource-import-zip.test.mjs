import assert from "node:assert/strict"
import { File } from "node:buffer"
import { test } from "node:test"
import JSZip from "jszip"

import { archiveDirectory } from "../src/lib/resource-upload.ts"
import { stageDirectoryZip } from "../src/lib/stream-zip.ts"

function mockStorage() {
  let chunks = []
  let removed = false
  const root = {
    async getFileHandle() {
      return {
        async createWritable() {
          return {
            async write(chunk) { chunks.push(new Uint8Array(chunk)) },
            async close() {},
            async abort() { chunks = [] },
          }
        },
        async getFile() { return new File(chunks, "release.zip") },
      }
    },
    async removeEntry() { removed = true },
  }
  Object.defineProperty(globalThis.navigator, "storage", { configurable: true, value: { getDirectory: async () => root } })
  return { wasRemoved: () => removed }
}

test("目录流式 ZIP 可读取且清理暂存", async () => {
  const storage = mockStorage()
  const files = new Map([
    ["release.json", new File(['{"version":17}'], "release.json")],
    ["agent/skills/示例.zip", new File(["payload"], "示例.zip")],
  ])
  const staged = await stageDirectoryZip(files, 1024 * 1024)
  const archive = await JSZip.loadAsync(await staged.file.arrayBuffer(), { checkCRC32: true })
  assert.equal(await archive.file("release.json").async("string"), '{"version":17}')
  assert.equal(await archive.file("agent/skills/示例.zip").async("string"), "payload")
  await staged.cleanup()
  assert.equal(storage.wasRemoved(), true)
})

test("目录上传接受超过 5000 个文件", async () => {
  const storage = mockStorage()
  const files = Array.from({ length: 5001 }, (_, index) => {
    const name = index === 0 ? "manifest.json" : `assets/${index}.txt`
    const file = new File([index === 0 ? "{}" : ""], name)
    Object.defineProperty(file, "webkitRelativePath", { value: `release/${name}` })
    return file
  })
  const staged = await archiveDirectory(files)
  const archive = await JSZip.loadAsync(await staged.file.arrayBuffer(), { checkCRC32: true })
  assert.equal(Object.values(archive.files).filter((entry) => !entry.dir).length, files.length)
  await staged.cleanup()
  assert.equal(storage.wasRemoved(), true)
})

test("生成超过限制时清理临时 ZIP", async () => {
  const storage = mockStorage()
  await assert.rejects(() => stageDirectoryZip(new Map([["release.json", new File(["payload"], "release.json")]]), 24), /2 GiB/)
  assert.equal(storage.wasRemoved(), true)
})
