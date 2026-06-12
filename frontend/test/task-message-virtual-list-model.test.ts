import assert from "node:assert/strict";
import test from "node:test";

import {
  getTaskMessageIndexFromVirtualRow,
  getTaskMessageVirtualRow,
  getTaskMessageVirtualRowCount,
  getTaskMessageVirtualRowIndex,
} from "../src/components/console/task/task-message-virtual-list-model.ts";

const messages = [
  { id: "m-1", type: "agent_message_chunk" },
  { id: "m-2", type: "user_input" },
  { id: "m-3", type: "tool_call" },
  { id: "m-4", type: "user_input" },
  { id: "m-5", type: "agent_message_chunk" },
];

test("虚拟消息列表把历史加载按钮作为首行", () => {
  assert.equal(getTaskMessageVirtualRowCount(messages.length, true), 6);
  assert.deepEqual(getTaskMessageVirtualRow(0, messages.length, true), { type: "history-loader" });
  assert.deepEqual(getTaskMessageVirtualRow(1, messages.length, true), { type: "message", messageIndex: 0 });
  assert.equal(getTaskMessageVirtualRowIndex(3, true), 4);
  assert.equal(getTaskMessageIndexFromVirtualRow(4, true), 3);
});

test("没有历史加载按钮时消息索引不偏移", () => {
  assert.equal(getTaskMessageVirtualRowCount(messages.length, false), 5);
  assert.deepEqual(getTaskMessageVirtualRow(0, messages.length, false), { type: "message", messageIndex: 0 });
  assert.equal(getTaskMessageVirtualRowIndex(3, false), 3);
  assert.equal(getTaskMessageIndexFromVirtualRow(3, false), 3);
});
