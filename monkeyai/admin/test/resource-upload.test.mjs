import assert from "node:assert/strict"
import { File } from "node:buffer"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { archiveChunk, matchArchives, sortArchives, uploadArchives, uploadedFileBytes, validateArchives } from "../src/lib/resource-upload.ts"

const sha = (data) => "sha256:" + createHash("sha256").update(data).digest("hex")

function upload(files, chunks = []) {
  return { id: "test-upload", files, total_size: files.reduce((sum, file) => sum + file.size, 0), status: "uploading", package_sha256: "", created_at: "", expires_at: "", chunk_size: 4, chunks }
}

test("分卷按数字排序并识别缺卷、重卷及混包", () => {
  const files = sortArchives([new File(["b"], "release.zip.002"), new File(["a"], "release.zip.001")])
  assert.deepEqual(files.map((file) => file.name), ["release.zip.001", "release.zip.002"])
  assert.doesNotThrow(() => validateArchives(files))
  for (const names of [["release.zip.002"], ["release.zip.001", "release.zip.001"], ["release.zip.001", "other.zip.002"], ["release.z01"], ["release.7z.001"]]) {
    assert.throws(() => validateArchives(names.map((name) => ({ name, size: 1 }))))
  }
  assert.throws(() => validateArchives([{ name: "release.zip", size: 2 ** 31 + 1 }]), /2 GiB/)
  assert.throws(() => validateArchives([{ name: "release.zip", size: 0 }]), /空文件/)
})

test("传输块跨越本地分卷边界，保持原始 ZIP 字节顺序", async () => {
  const files = [new Blob(["abc"]), new Blob(["defgh"]), new Blob(["ij"])]
  assert.equal(await archiveChunk(files, 0, 4).text(), "abcd")
  assert.equal(await archiveChunk(files, 1, 4).text(), "efgh")
  assert.equal(await archiveChunk(files, 2, 4).text(), "ij")
  assert.equal(archiveChunk(files, 3, 4).size, 0)
})

test("每卷进度根据传输块区间计算，支持非连续已上传块", () => {
  const files = [{ name: "a", size: 3 }, { name: "b", size: 5 }, { name: "c", size: 2 }]
  assert.deepEqual(uploadedFileBytes(files, 4, { chunks: [{ index: 0, size: 4 }, { index: 2, size: 2 }], index: 1, loaded: 2 }), [3, 3, 2])
  assert.equal(matchArchives(files, files.map((file) => ({ ...file }))), true)
  assert.equal(matchArchives(files, files.slice(1)), false)
  assert.equal(matchArchives(files, [{ name: "a", size: 4 }, ...files.slice(1)]), false)
})

for (const mode of ["原生摘要", "缺少 subtle", "缺少 crypto"]) {
  test(`续传核对已上传内容，只发送缺失块并更新进度（${mode}）`, async (t) => {
    if (mode !== "原生摘要") t.mock.getter(globalThis, "crypto", () => mode === "缺少 subtle" ? {} : undefined)
    const files = [new File(["abc"], "release.zip.001"), new File(["defgh"], "release.zip.002")]
    const existing = { index: 0, size: 4, sha256: sha("abcd") }
    const requests = []
    class XHR {
      upload = {}
      status = 204
      open(method, path) { requests.push({ method, path, headers: {} }); this.request = requests.at(-1) }
      setRequestHeader(name, value) { this.request.headers[name] = value }
      send(blob) {
        this.request.blob = blob
        this.upload.onprogress({ loaded: blob.size })
        queueMicrotask(() => this.onload())
      }
      abort() { this.onabort() }
    }
    const original = globalThis.XMLHttpRequest
    globalThis.XMLHttpRequest = XHR
    t.after(() => { if (original) globalThis.XMLHttpRequest = original; else delete globalThis.XMLHttpRequest })
    const progress = []
    const result = await uploadArchives(upload(files, [existing]), files, new AbortController().signal, (value) => progress.push(value))
    assert.equal(requests.length, 1)
    assert.equal(requests[0].path, "/api/admin/v1/resource-import-uploads/test-upload/chunks/1")
    assert.equal(await requests[0].blob.text(), "efgh")
    assert.equal(requests[0].headers["X-Content-SHA256"], sha("efgh"))
    assert.equal(result.chunks.length, 2)
    assert.equal(progress.at(-1).chunks.length, 2)
    await assert.rejects(uploadArchives(upload(files, [{ ...existing, sha256: sha("xxxx") }]), files, new AbortController().signal, () => {}), /本地文件内容/)
    assert.equal(requests.length, 1)
  })
}

test("缺少 subtle 时二进制块摘要与标准 SHA-256 一致", async (t) => {
  t.mock.getter(globalThis, "crypto", () => ({}))
  const requests = []
  class XHR {
    upload = {}
    status = 204
    open() { this.request = {}; requests.push(this.request) }
    setRequestHeader(name, value) { this.request[name] = value }
    send(blob) { this.request.blob = blob; queueMicrotask(() => this.onload()) }
  }
  const original = globalThis.XMLHttpRequest
  globalThis.XMLHttpRequest = XHR
  t.after(() => { if (original) globalThis.XMLHttpRequest = original; else delete globalThis.XMLHttpRequest })
  for (const size of [1, 55, 56, 63, 64, 65, 1024 * 1024 + 17]) {
    const data = Uint8Array.from({ length: size }, (_, index) => index % 256)
    const files = [new File([data], "release.zip.001")]
    const result = await uploadArchives({ ...upload(files), chunk_size: 256 * 1024 }, files, new AbortController().signal, () => {})
    assert.equal(result.chunks.length, Math.ceil(size / (256 * 1024)))
  }
  for (const request of requests) {
    assert.equal(request["X-Content-SHA256"], sha(new Uint8Array(await request.blob.arrayBuffer())))
  }
})

test("暂停上传不会继续发送后续传输块", async (t) => {
  const files = [new File(["abcdefghij"], "release.zip")]
  const controller = new AbortController()
  let count = 0
  class XHR {
    upload = {}
    status = 204
    open() { count++ }
    setRequestHeader() {}
    send() { queueMicrotask(() => controller.abort()) }
    abort() { this.onabort() }
  }
  const original = globalThis.XMLHttpRequest
  globalThis.XMLHttpRequest = XHR
  t.after(() => { if (original) globalThis.XMLHttpRequest = original; else delete globalThis.XMLHttpRequest })
  await assert.rejects(uploadArchives(upload(files), files, controller.signal, () => {}), { name: "AbortError" })
  assert.equal(count, 1)
})
