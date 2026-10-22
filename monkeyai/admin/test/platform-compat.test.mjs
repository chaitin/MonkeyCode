import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { webcrypto } from "node:crypto"
import vm from "node:vm"
import test from "node:test"
import ts from "typescript"

const source = ts.transpile(
  await readFile(
    new URL("../src/lib/platform-compat.ts", import.meta.url),
    "utf8"
  ),
  {
    target: ts.ScriptTarget.ES2020,
  }
)

function legacyPlatform() {
  class Signal {
    aborted = false
  }
  class Controller {
    signal = new Signal()
    abort() {
      this.signal.aborted = true
    }
  }
  const timers = []
  const scope = {
    AbortSignal: Signal,
    AbortController: Controller,
    DOMException,
    crypto: { getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) },
    window: {
      setTimeout: (callback, delay) => timers.push({ callback, delay }),
    },
  }
  vm.runInNewContext(source, scope)
  return { ...scope, timers }
}

test("Chrome 86 中保留取消原因，重复取消不覆盖首次原因", () => {
  const { AbortController: Controller } = legacyPlatform()
  for (const reason of [undefined, null, "cancelled", new Error("cancelled")]) {
    const controller = new Controller()
    assert.equal(controller.signal.reason, undefined)
    assert.doesNotThrow(() => controller.signal.throwIfAborted())
    controller.abort(reason)
    const expected = reason === undefined ? controller.signal.reason : reason
    if (reason === undefined) assert.equal(expected.name, "AbortError")
    assert.equal(controller.signal.reason, expected)
    controller.abort("replacement")
    assert.equal(controller.signal.reason, expected)
    let thrown = false
    try {
      controller.signal.throwIfAborted()
    } catch (actual) {
      thrown = true
      assert.equal(actual, expected)
    }
    assert.equal(thrown, true)
  }
})

test("旧版浏览器授权超时会中止请求，并保留 TimeoutError 原因", () => {
  const { AbortSignal: Signal, timers } = legacyPlatform()
  const signal = Signal.timeout(15000)
  assert.equal(signal.aborted, false)
  assert.equal(timers[0].delay, 15000)
  timers[0].callback()
  assert.equal(signal.aborted, true)
  assert.equal(signal.reason.name, "TimeoutError")
  assert.throws(() => signal.throwIfAborted(), { name: "TimeoutError" })
})

test("HTTP 与 Chrome 86 下 UUID 保留随机性及版本、变体位", () => {
  const { crypto } = legacyPlatform()
  const ids = Array.from({ length: 100 }, () => crypto.randomUUID())
  assert.equal(new Set(ids).size, 100)
  for (const id of ids)
    assert.match(
      id,
      /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/
    )
})

test("现代浏览器原生 API 保持不变", () => {
  const original = {
    abort: AbortController.prototype.abort,
    timeout: AbortSignal.timeout,
    throwIfAborted: AbortSignal.prototype.throwIfAborted,
  }
  const randomUUID = () => "native"
  vm.runInNewContext(source, {
    AbortSignal,
    AbortController,
    DOMException,
    crypto: { randomUUID },
  })
  assert.equal(AbortController.prototype.abort, original.abort)
  assert.equal(AbortSignal.timeout, original.timeout)
  assert.equal(AbortSignal.prototype.throwIfAborted, original.throwIfAborted)
})
