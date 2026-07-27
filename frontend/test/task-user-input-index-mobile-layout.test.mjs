import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/console/task/task-user-input-index.tsx", import.meta.url),
  "utf8",
);
const cn = readFileSync(new URL("../src/i18n/resources/cn.ts", import.meta.url), "utf8");
const en = readFileSync(new URL("../src/i18n/resources/en.ts", import.meta.url), "utf8");

test("对话定位器提供手机 Drawer 和桌面圆点栏两种呈现", () => {
  assert.match(source, /presentation\?: "desktop" \| "mobile"/);
  assert.match(source, /presentation = "desktop"/);
  assert.match(source, /if \(presentation === "mobile"\)/);
  assert.match(source, /<Drawer open=\{mobileOpen\} onOpenChange=\{setMobileOpen\}>/);
  assert.match(source, /<DrawerClose asChild>/);
  assert.match(source, /aria-label=\{t\("taskDetail\.common\.close"\)\}/);
  assert.match(source, /className="size-11 shrink-0"/);
  assert.match(source, /className="absolute right-2 top-1\/2 z-20 -translate-y-1\/2"/);
});

test("手机和桌面定位列表复用同一渲染函数", () => {
  assert.match(source, /const renderEntries = \(onSelect: \(entry: UserInputIndexEntry\) => void\) =>/);
  assert.match(source, /renderEntries\(handleMobileJump\)/);
  assert.match(source, /renderEntries\(handleDesktopJump\)/);
});

test("手机定位操作满足触控尺寸且保持桌面密度", () => {
  assert.match(source, /presentation === "mobile" \? "h-11" : "h-8"/);
  assert.match(source, /presentation === "mobile" && "min-h-11"/);
});

test("手机和桌面跳转统一处理异步失败", () => {
  assert.match(source, /const handleJumpError = React\.useCallback/);
  assert.match(source, /if \(await handleJump\(entry\)\) \{\s*setMobileOpen\(false\)\s*\}/);
  assert.match(source, /catch \{\s*handleJumpError\(\)\s*\}/);
  assert.match(source, /handleJump\(entry\)\.catch\(handleJumpError\)/);
  assert.match(source, /React\.useLayoutEffect\(\(\) => \{\s*historyBoundaryRef\.current = liveMessages\[0\]\?\.id \?\? null\s*\}, \[liveMessages\]\)/);
  assert.match(source, /if \(historyBoundaryRef\.current === previousHistoryBoundary\) \{\s*throw new Error\("History loading made no progress"\)\s*\}/);
  assert.match(source, /if \(!container\) throw new Error\("Scroll container unavailable"\)/);
  assert.match(source, /disabled=\{Boolean\(jumpingId\)\}/);
  assert.doesNotMatch(source, /\(\) => undefined,\s*\)\s*\n\s*loadingRef/);
});

test("定位 Drawer 具备完整双语可访问文案", () => {
  assert.match(cn, /userInputIndex:\s*\{[\s\S]*?trigger: "对话定位"[\s\S]*?title: "定位到历史对话"[\s\S]*?description: "选择一条用户消息并跳转到对应位置。"/);
  assert.match(en, /userInputIndex:\s*\{[\s\S]*?trigger: "Conversation navigator"[\s\S]*?title: "Jump to a conversation"[\s\S]*?description: "Select a user message to jump to its position\."/);
});
