import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/console/task/task-user-input-index.tsx", import.meta.url),
  "utf8",
);
const taskDetailSource = readFileSync(
  new URL("../src/pages/console/user/task/task-detail.tsx", import.meta.url),
  "utf8",
);
const virtualListSource = readFileSync(
  new URL("../src/components/console/task/task-message-virtual-list.tsx", import.meta.url),
  "utf8",
);
const cn = readFileSync(new URL("../src/i18n/resources/cn.ts", import.meta.url), "utf8");
const en = readFileSync(new URL("../src/i18n/resources/en.ts", import.meta.url), "utf8");

test("消息定位器保留官方单一右侧圆点面板", () => {
  assert.match(source, /className="absolute right-2 top-1\/2 z-20 -translate-y-1\/2"/);
  assert.match(source, /onMouseEnter=\{\(\) => setExpanded\(true\)\}/);
  assert.match(source, /onMouseLeave=\{\(\) => setExpanded\(false\)\}/);
  assert.match(source, /style=\{\{ maxHeight: "min\(480px, 70vh\)", width: "280px" \}\}/);
  assert.doesNotMatch(source, /<Drawer/);
  assert.doesNotMatch(source, /presentation\?: "desktop" \| "mobile"/);
});

test("手机端恢复官方紧凑圆点并为消息预留右侧安全槽", () => {
  assert.match(source, /"flex flex-col items-center justify-center gap-\[5px\] rounded-full border bg-popover\/90 p-3/);
  assert.doesNotMatch(source, /min-h-11 min-w-11/);
  assert.match(virtualListSource, /className="absolute top-0 left-0 w-full pr-11 md:pr-0"/);
});

test("任务页只在消息区域挂载一个官方定位实例", () => {
  assert.equal(taskDetailSource.match(/<TaskUserInputIndex/g)?.length, 1);
  assert.match(taskDetailSource, /<TaskMessageVirtualList[\s\S]*?<TaskUserInputIndex/);
  assert.doesNotMatch(taskDetailSource, /\{isMobile && \(\s*<TaskUserInputIndex/);
});

test("官方原面板在离开底部时显示固定的回到底部操作", () => {
  assert.match(source, /isAtBottom: boolean/);
  assert.match(source, /scrollToBottom: \(\) => void/);
  assert.match(source, /if \(isAtBottom\) return null/);
  assert.match(source, /taskDetail\.userInputIndex\.scrollToBottom/);
  assert.match(source, /"flex h-8 w-full items-center justify-center gap-1\.5 rounded-md text-sm transition-colors"/);
  assert.match(source, /className="h-8 w-full gap-1\.5 text-muted-foreground hover:text-popover-foreground"/);
  assert.doesNotMatch(source, /className="h-11 w-full[^"]*md:h-8"/);
  assert.match(source, /className="min-h-0 overflow-y-auto overflow-x-hidden"/);
  assert.equal(source.match(/renderScrollToBottom\(\)/g)?.length, 1);
});

test("圆点栏支持触摸展开和面板外部收起", () => {
  assert.match(source, /const rootRef = React\.useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(source, /onClick=\{\(\) => setExpanded\(true\)\}/);
  assert.match(source, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(source, /if \(!rootRef\.current\?\.contains\(event\.target as Node\)\) \{\s*setExpanded\(false\)\s*\}/);
  assert.match(source, /document\.removeEventListener\("pointerdown", handlePointerDown\)/);
});

test("选择消息和回到底部后收起官方面板", () => {
  assert.match(source, /const handleSelectEntry = React\.useCallback\(\(entry: UserInputIndexEntry\) => \{\s*setExpanded\(false\)\s*void handleJump\(entry\)\.catch\(handleJumpError\)\s*\}, \[handleJump, handleJumpError\]\)/);
  assert.match(source, /const handleScrollToBottom = React\.useCallback\(\(\) => \{\s*setExpanded\(false\)\s*scrollToBottom\(\)\s*\}, \[scrollToBottom\]\)/);
});

test("历史定位在加载无进展或异步失败时停止并提示", () => {
  assert.match(source, /React\.useLayoutEffect\(\(\) => \{\s*historyBoundaryRef\.current = liveMessages\[0\]\?\.id \?\? null\s*\}, \[liveMessages\]\)/);
  assert.match(source, /if \(!container\) throw new Error\("Scroll container unavailable"\)/);
  assert.match(source, /if \(historyBoundaryRef\.current === previousHistoryBoundary\) \{\s*throw new Error\("History loading made no progress"\)\s*\}/);
  assert.match(source, /const handleJumpError = React\.useCallback/);
  assert.match(source, /handleJump\(entry\)\.catch\(handleJumpError\)/);
  assert.match(source, /disabled=\{Boolean\(jumpingId\)\}/);
  assert.match(source, /setActiveUserInputId\(null\)\s*setExpanded\(false\)\s*\}, \[taskId\]\)/);
});

test("任务页复用底部判断并只向一个定位实例传参", () => {
  assert.match(taskDetailSource, /const \[chatAtBottom, setChatAtBottom\] = React\.useState\(true\)/);
  assert.match(taskDetailSource, /setChatAtBottom\(\(previous\) => previous === isAtBottom \? previous : isAtBottom\)/);
  assert.match(taskDetailSource, /const handleScrollToBottom = React\.useCallback\(\(\) => \{\s*scheduleChatScrollToBottom\("smooth", \{ forceAutoScroll: true \}\)/);
  assert.equal(taskDetailSource.match(/isAtBottom=\{chatAtBottom\}/g)?.length, 1);
  assert.equal(taskDetailSource.match(/scrollToBottom=\{handleScrollToBottom\}/g)?.length, 1);
});

test("回到底部具备完整双语文案", () => {
  assert.match(cn, /userInputIndex:[\s\S]*?scrollToBottom: "回到底部"/);
  assert.match(en, /userInputIndex:[\s\S]*?scrollToBottom: "Back to bottom"/);
});
