import assert from "node:assert/strict";
import test from "node:test";

import { getTaskStreamDedupKey } from "../src/components/console/task/task-stream-dedupe.ts";

const chunk = {
  type: "task-running",
  kind: "acp_event",
  timestamp: 1710000000000,
  data: "same-payload",
};

test("stream dedupe key treats same millisecond repeated chunks with different seq as distinct", () => {
  assert.notEqual(
    getTaskStreamDedupKey({ ...chunk, seq: 1 }),
    getTaskStreamDedupKey({ ...chunk, seq: 2 }),
  );
});

test("stream dedupe key keeps identical seq chunks identical", () => {
  assert.equal(
    getTaskStreamDedupKey({ ...chunk, seq: 1 }),
    getTaskStreamDedupKey({ ...chunk, seq: 1 }),
  );
});
