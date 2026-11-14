import assert from "node:assert/strict"
import test from "node:test"
import {
  environmentCreditPrice,
  environmentHourlyCredits,
} from "../src/lib/environment-billing.ts"

const GiB = 1073741824
const pricing = (cpu, memory) => ({
  cpu_credits_per_core_hour: cpu,
  memory_credits_per_gib_hour: memory,
})

test("环境积分单价保留十进制精度并拒绝指数、负值和过多小数", () => {
  assert.equal(environmentCreditPrice("000.100000"), "0.1")
  assert.equal(environmentCreditPrice(" 0.000001 "), "0.000001")
  for (const value of [
    "",
    "-1",
    "NaN",
    "1e3",
    ".5",
    "1.0000001",
    "1000000000000.000001",
  ])
    assert.throws(() => environmentCreditPrice(value), value)
})

test("按CPU毫核和内存字节计算每小时规格价", () => {
  assert.equal(
    environmentHourlyCredits(
      { cpu_millis: 1000, memory_bytes: 2 * GiB },
      pricing("0.1", "0.025")
    ),
    "0.15"
  )
  assert.equal(
    environmentHourlyCredits(
      { cpu_millis: 100, memory_bytes: GiB / 4 },
      pricing("0.1", "0.025")
    ),
    "0.01625"
  )
  assert.equal(
    environmentHourlyCredits(
      { cpu_millis: 1000, memory_bytes: GiB / 2 },
      pricing("0", "0.000001")
    ),
    "0.000001"
  )
})

test("大额预览不经过JS浮点并与服务端六位舍入一致", () => {
  assert.equal(
    environmentHourlyCredits(
      { cpu_millis: 256000, memory_bytes: GiB },
      pricing("1000000000.000001", "0")
    ),
    "256000000000.000256"
  )
  assert.throws(() =>
    environmentHourlyCredits(
      { cpu_millis: 256000, memory_bytes: GiB },
      pricing("1000000000000", "0")
    )
  )
  assert.throws(() =>
    environmentHourlyCredits(
      { cpu_millis: 1000.1, memory_bytes: GiB },
      pricing("1", "0")
    )
  )
})
