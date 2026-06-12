import assert from "node:assert/strict";
import test from "node:test";

import { resolveMemberLimit, resolveUsedSeats } from "../src/pages/console/manager/member-seat.js";

test("成员管理优先使用 license 席位上限", () => {
  assert.equal(resolveMemberLimit(5, { seats: 12 }), 12);
  assert.equal(resolveMemberLimit(5, { seats: 12, limits: { max_members: 20 } }), 20);
});

test("成员管理优先使用 license 已用席位", () => {
  assert.equal(resolveUsedSeats(3, { used_seats: 8 }), 8);
});
