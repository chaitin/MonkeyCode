import assert from "node:assert/strict";
import test from "node:test";

import {
  getRecommendedTaskQuickInputs,
  getTaskQuickInputTextWidthUnits,
  getTaskQuickInputVisibleCount,
  incrementTaskQuickInput,
  normalizeTaskQuickInputs,
  parseTaskQuickInputStorage,
  shouldRecordShortQuickInput,
  TASK_QUICK_INPUT_EXPIRE_MS,
  TASK_QUICK_INPUT_STORAGE_KEY,
} from "../src/components/console/task/task-quick-inputs.ts";

test("任务快捷输入不初始化内置项", () => {
  assert.deepEqual(normalizeTaskQuickInputs([]), []);
});

test("任务快捷输入会合并重复项并排序", () => {
  const now = 1_000;
  const items = normalizeTaskQuickInputs([
    { text: "检查", count: 2, updatedAt: 80 },
    { text: "继续", count: 4, updatedAt: 70 },
    { text: "检查", count: 5, updatedAt: 90 },
  ], now);

  assert.equal(items[0].text, "检查");
  assert.equal(items[0].count, 5);
  assert.equal(items[1].text, "继续");
  assert.equal(items[1].count, 4);
});

test("任务快捷输入会清理超过 30 天未使用的记录", () => {
  const now = 10_000_000_000;
  const items = normalizeTaskQuickInputs([
    { text: "继续", count: 4, updatedAt: now - TASK_QUICK_INPUT_EXPIRE_MS + 1 },
    { text: "检查", count: 5, updatedAt: now - TASK_QUICK_INPUT_EXPIRE_MS - 1 },
  ], now);

  assert.deepEqual(items.map((item) => item.text), ["继续"]);
});

test("任务快捷输入只自动记录少于 10 个字符的普通消息", () => {
  assert.equal(shouldRecordShortQuickInput("Continue"), true);
  assert.equal(shouldRecordShortQuickInput("123456789"), true);
  assert.equal(shouldRecordShortQuickInput("1234567890"), false);
  assert.equal(shouldRecordShortQuickInput("/restart"), false);
});

test("任务快捷输入只推荐使用超过 3 次的短消息", () => {
  const now = 1_000;
  const items = normalizeTaskQuickInputs([
    { text: "继续", count: 3, updatedAt: 80 },
    { text: "检查", count: 4, updatedAt: 90 },
    { text: "Commit now", count: 5, updatedAt: 100 },
  ], now);
  const recommended = getRecommendedTaskQuickInputs(items);

  assert.deepEqual(recommended.map((item) => item.text), ["检查"]);
});

test("任务快捷输入采纳后可以增加次数", () => {
  const updated = incrementTaskQuickInput([
    { text: "检查", count: 4, updatedAt: 100 },
  ], "检查", { force: true, now: 120 });

  assert.equal(updated[0].text, "检查");
  assert.equal(updated[0].count, 5);
  assert.equal(updated[0].updatedAt, 120);
});

test("任务快捷输入可以解析非法 localStorage 内容", () => {
  assert.deepEqual(parseTaskQuickInputStorage("not json"), []);
  assert.deepEqual(parseTaskQuickInputStorage(JSON.stringify([{ text: "  OK  ", count: 2, updatedAt: 1 }])), [
    { text: "OK", count: 2, updatedAt: 1 },
  ]);
});

test("任务快捷输入使用单一 localStorage key", () => {
  assert.equal(TASK_QUICK_INPUT_STORAGE_KEY, "task-chat-quick-inputs");
});

test("任务快捷输入宽度计算按中文双倍宽度处理", () => {
  assert.equal(getTaskQuickInputTextWidthUnits("ab"), 2);
  assert.equal(getTaskQuickInputTextWidthUnits("继续"), 4);
  assert.equal(getTaskQuickInputTextWidthUnits("a你"), 3);
});

test("任务快捷输入根据容器宽度决定更多菜单", () => {
  const now = 1_000;
  const items = normalizeTaskQuickInputs([
    { text: "继续", count: 8, updatedAt: 100 },
    { text: "检查", count: 7, updatedAt: 90 },
    { text: "提交", count: 6, updatedAt: 80 },
    { text: "测试", count: 5, updatedAt: 70 },
    { text: "修复", count: 4, updatedAt: 60 },
  ], now);

  assert.equal(getTaskQuickInputVisibleCount(items.slice(0, 3), 172, "更多"), 3);
  assert.equal(getTaskQuickInputVisibleCount(items, 140, "更多"), 1);
  assert.equal(getTaskQuickInputVisibleCount(items, 250, "更多"), 3);
});
