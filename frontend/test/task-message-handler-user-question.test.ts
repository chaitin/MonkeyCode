import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/console/task/task-message-handler.ts", import.meta.url),
  "utf8",
);
const taskDetailSource = readFileSync(
  new URL("../src/pages/console/user/task/task-detail.tsx", import.meta.url),
  "utf8",
);
const taskStreamClientSource = readFileSync(
  new URL("../src/components/console/task/task-stream-client.ts", import.meta.url),
  "utf8",
);

test("task message handler renders user-question tool calls as ask_user_question messages", () => {
  assert.match(source, /isUserQuestionToolCall/);
  assert.match(source, /upsertAskUserQuestionFromToolCall/);
  assert.match(source, /getAskUserQuestionRawQuestions/);
  assert.match(source, /question\?\.multiple \?\? question\?\.multiSelect \?\? defaultMultiple/);
  assert.match(source, /_meta\?\.askUserQuestion\?\.questions/);
  assert.match(source, /rawInput\?\.multiple \?\? toolCall\?._meta\?\.askUserQuestion\?\.multiple/);
  assert.match(source, /replace\(\/\[_\\s\]\+\/g, "-"\)/);
  assert.match(source, /normalizedTitle === "question"/);
  assert.match(source, /normalizedTitle === "user-question"/);
  assert.match(source, /normalizedTitle\.includes\("ask-user-question"\)/);
  assert.match(source, /message\.type === "tool_call" && message\.data\.toolCallId === askId/);
  assert.match(source, /type: "ask_user_question"/);
  assert.match(source, /if \(this\.isUserQuestionToolCall\(data\)\)/);
  assert.match(source, /applyOptimisticReplyQuestion/);
  assert.match(source, /applyReplyQuestionAnswers/);
  assert.match(source, /this\.applyReplyQuestionAnswers\(data\.request_id, answers, "completed"\)/);
});

test("task detail treats dismissed question tool calls as expired", () => {
  assert.match(taskDetailSource, /baseStatus === "failed"/);
  assert.match(taskDetailSource, /isExpired \? "expired" : "pending"/);
  assert.match(taskDetailSource, /!isCompleted && !isExpired/);
});

test("reply-question answers are inserted optimistically before server correction", () => {
  assert.match(taskStreamClientSource, /this\.messageHandler\.applyOptimisticReplyQuestion\(requestId, answers\)/);
  assert.match(taskStreamClientSource, /this\.submittingReplies\.add\(requestId\)/);
  assert.match(taskStreamClientSource, /this\.queuedReplies\.set\(requestId, JSON\.stringify\(payload\)\)/);
});
