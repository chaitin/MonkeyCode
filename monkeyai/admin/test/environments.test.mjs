import assert from "node:assert/strict"
import test from "node:test"
import {
  canDelete,
  canStop,
  environmentState,
  hostSyncFresh,
  units,
  GiB,
} from "../src/lib/environments.ts"

test("旧观察代次不能显示新目标已完成", () => {
  const env = {
    generation: 3,
    observed_generation: 2,
    phase: "running",
    desired: "stopped",
  }
  assert.equal(environmentState(env), "pending_stopped")
  assert.equal(canStop(env), false)
  assert.equal(
    environmentState({ ...env, observed_generation: 3, phase: "stopped" }),
    "stopped"
  )
  assert.equal(
    canStop({ ...env, observed_generation: 3, phase: "failed" }),
    true
  )
})
test("删除只允许首次执行或确认失败后的重试", () => {
  const env = {
    generation: 3,
    observed_generation: 2,
    phase: "failed",
    desired: "deleted",
  }
  assert.equal(canDelete(env), false)
  assert.equal(canStop(env), false)
  assert.equal(canDelete({ ...env, observed_generation: 3 }), true)
  assert.equal(
    canDelete({ ...env, observed_generation: 3, phase: "deleted" }),
    false
  )
})
test("容量单位换算保留毫核与字节精度并拒绝非法值", () => {
  assert.equal(units("1.001", 1000), 1001)
  assert.equal(units("0.0625", GiB), 64 * 1024 ** 2)
  assert.equal(units(String(1 / GiB), GiB), 1)
  for (const value of ["", " ", "NaN", "Infinity", "-1", "1.5"])
    assert.throws(() => units(value))
  assert.throws(() => units("1.0001", 1000))
})
test("通信状态同时核对身份、协议、心跳和同步时效", () => {
  const now = Date.now(),
    at = new Date(now).toISOString()
  const host = { status: "active", protocol: 1, sync_at: at, last_seen_at: at }
  assert.equal(hostSyncFresh(host, now), true)
  for (const change of [
    { status: "revoked" },
    { protocol: 0 },
    { sync_at: null },
    { last_seen_at: "bad" },
    { sync_at: new Date(now - 90001).toISOString() },
  ])
    assert.equal(hostSyncFresh({ ...host, ...change }, now), false)
})
