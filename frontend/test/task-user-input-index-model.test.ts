import assert from "node:assert/strict";
import test from "node:test";

import {
  getNearestUserInputIdToViewport,
  getUserInputIndexDotIndexForEntryId,
  getUserInputIndexDots,
  mergeLoadedUserInputIndexEntries,
  mergeUserInputIndexEntries,
  normalizeUserInputIndexPage,
} from "../src/components/console/task/task-user-input-index-model.ts";

test("对话目录把接口倒序结果反转为旧到新展示", () => {
  const page = normalizeUserInputIndexPage([
    { id: "newest", timestamp: 300, content: "newest" },
    { id: "middle", timestamp: 200, content: "middle" },
    { id: "oldest", timestamp: 100, content: "oldest" },
  ]);

  assert.deepEqual(page.map((entry) => entry.content), ["oldest", "middle", "newest"]);
});

test("加载更多的旧数据插入到已有目录前面", () => {
  const current = normalizeUserInputIndexPage([
    { id: "newest", timestamp: 400, content: "newest" },
    { id: "newer", timestamp: 300, content: "newer" },
  ]);
  const olderPage = normalizeUserInputIndexPage([
    { id: "older", timestamp: 200, content: "older" },
    { id: "oldest", timestamp: 100, content: "oldest" },
  ]);

  const next = mergeLoadedUserInputIndexEntries(current, olderPage, true);

  assert.deepEqual(next.map((entry) => entry.content), ["oldest", "older", "newer", "newest"]);
});

test("合并实时 user input 时保留目录顺序并追加到底部", () => {
  const merged = mergeUserInputIndexEntries(
    [
      { id: "oldest", timestamp: 100, content: "oldest", truncated: false },
      { id: "newest", timestamp: 300, content: "newest", truncated: false },
    ],
    [
      { id: "newest", time: 300, type: "user_input", data: { content: "duplicated" } },
      { id: "live", time: 400, type: "user_input", data: { content: "live" } },
    ],
  );

  assert.deepEqual(merged.map((entry) => entry.id), ["oldest", "newest", "live"]);
});

test("收起态圆点数量跟随 user input 数量但最多 20 个", () => {
  const entries = Array.from({ length: 25 }, (_, index) => ({
    id: `entry-${index}`,
    timestamp: index,
    content: `entry ${index}`,
    truncated: false,
  }));

  const dots = getUserInputIndexDots(entries, 20);

  assert.equal(dots.length, 20);
  assert.deepEqual(dots[0], { key: "entry-0", startIndex: 0, endIndex: 0 });
  assert.deepEqual(dots[19], { key: "entry-23", startIndex: 23, endIndex: 24 });
});

test("高亮当前 user input 所在的分段圆点", () => {
  const entries = Array.from({ length: 25 }, (_, index) => ({
    id: `entry-${index}`,
    timestamp: index,
    content: `entry ${index}`,
    truncated: false,
  }));

  assert.equal(getUserInputIndexDotIndexForEntryId(entries, "entry-0", 20), 0);
  assert.equal(getUserInputIndexDotIndexForEntryId(entries, "entry-24", 20), 19);
  assert.equal(getUserInputIndexDotIndexForEntryId(entries, "missing", 20), null);
});

test("根据当前视口中心选择最近的 user input", () => {
  const nearest = getNearestUserInputIdToViewport(
    [
      { id: "first", top: 0, bottom: 20 },
      { id: "second", top: 240, bottom: 280 },
      { id: "third", top: 520, bottom: 560 },
    ],
    200,
    400,
  );

  assert.equal(nearest, "second");
  assert.equal(getNearestUserInputIdToViewport([], 200, 400), null);
});
