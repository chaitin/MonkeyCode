import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/pages/console/user/task/task-detail.tsx", import.meta.url),
  "utf8",
);
const cn = readFileSync(new URL("../src/i18n/resources/cn.ts", import.meta.url), "utf8");
const en = readFileSync(new URL("../src/i18n/resources/en.ts", import.meta.url), "utf8");
const useMobileSource = readFileSync(new URL("../src/hooks/use-mobile.ts", import.meta.url), "utf8");

test("手机页头恢复官方紧凑尺寸", () => {
  assert.match(source, /className="h-7 min-w-0 flex-1 gap-1 px-2 text-xs font-normal md:max-w-\[220px\]/);
  assert.doesNotMatch(source, /getBrandFromModel\(currentModel\)[\s\S]*?md:hidden/);
  assert.doesNotMatch(source, /overflow-hidden rounded-md border md:contents/);
  assert.match(source, /className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm/);
  assert.match(source, /<CircularProgress[\s\S]*?size=\{20\}/);
  assert.match(source, /className="flex w-11 shrink-0 justify-end md:hidden"[\s\S]*?className="size-7 shrink-0"/);
  assert.match(source, /onPointerUp=\{\(event\) => \{[\s\S]*?event\.pointerType === "touch"[\s\S]*?setContextUsagePopoverOpen\(\(open\) => !open\)/);
  assert.doesNotMatch(source, /className="h-11 min-w-0 flex-1/);
  assert.doesNotMatch(source, /className="size-11 shrink-0 md:hidden"/);
});

test("320px 页头保留 104px 尾部对齐轨道", () => {
  assert.match(source, /className="flex min-w-0 flex-1 items-center gap-2"/);
  assert.match(source, /className="flex w-11 shrink-0 flex-wrap items-center/);
  assert.match(source, /className="flex w-11 shrink-0 justify-end md:hidden"/);
  assert.match(source, /mobileToolsView === "tools"[\s\S]*?"w-\[104px\] p-1\.5"/);
});

test("手机页头不渲染消息定位按钮或定位下拉", () => {
  assert.doesNotMatch(source, /\{isMobile && \(\s*<TaskUserInputIndex/);
  assert.equal(source.match(/<TaskUserInputIndex/g)?.length, 1);
});

test("更多工具使用固定向下的动态宽度单一 Popover", () => {
  assert.match(source, /<Popover modal open=\{mobileToolsOpen\} onOpenChange=\{handleMobileToolsOpenChange\}>/);
  assert.match(source, /<PopoverContent[\s\S]*?side="bottom"[\s\S]*?align="end"[\s\S]*?avoidCollisions=\{false\}/);
  assert.match(source, /className="flex w-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground md:w-auto"/);
  assert.match(source, /mobileToolsView === "tools"[\s\S]*?"w-\[104px\] p-1\.5"[\s\S]*?"w-\[calc\(100vw-2rem\)\] max-w-\[420px\] p-0"/);
  assert.match(source, /className="flex min-h-0 flex-col"/);
  assert.doesNotMatch(source, /grid min-h-0 grid-cols-2 gap-2 overflow-y-auto border-t p-4/);
  assert.doesNotMatch(source, /taskDetail\.page\.mobileTools\.(title|description)/);
  assert.doesNotMatch(source, /<Drawer[\s\S]*?open=\{mobileToolsOpen\}/);
  assert.match(source, /type MobileToolsView = "tools" \| "files"/);
  assert.match(source, /React\.useEffect\(\(\) => \{[\s\S]*?if \(!isMobile\) \{[\s\S]*?setMobileToolsOpen\(false\)[\s\S]*?\}, \[isMobile\]\)/);
});

test("竖向菜单沿用现有图标和 44px 操作行", () => {
  assert.match(source, /className="h-11 justify-start gap-2 px-3"[\s\S]*?<IconPuzzle/);
  assert.match(source, /className="h-11 justify-start gap-2 px-3"[\s\S]*?<IconFile/);
  assert.match(source, /className=\{cn\("h-11 justify-start gap-2 px-3"[\s\S]*?<IconDeviceDesktop/);
  assert.match(source, /canPublishWebsite && \([\s\S]*?className=\{cn\("h-11 justify-start gap-2 px-3"[\s\S]*?<IconUpload/);
});

test("文件与工具共享 Popover 且手机端不打开右侧面板", () => {
  assert.match(source, /mobileToolsView === "tools"/);
  assert.match(source, /mobileToolsView === "files"[\s\S]*?<TaskFileExplorer/);
  assert.match(source, /onClick=\{\(\) => setMobileToolsView\("files"\)\}/);
  assert.match(source, /onClosePanel=\{\(\) => handleMobileToolsOpenChange\(false\)\}/);
  assert.match(source, /const hasSidePanel = !isMobile && activeSidePanel !== null/);
});

test("关闭手机工具浮层时立即恢复工具视图", () => {
  assert.match(source, /const handleMobileToolsOpenChange = React\.useCallback\(\(open: boolean\) => \{\s*setMobileToolsView\("tools"\)\s*setMobileToolsOpen\(open\)/);
  assert.match(source, /if \(!isMobile\) \{\s*setMobileToolsView\("tools"\)\s*setMobileToolsOpen\(false\)/);
});

test("后续 Dialog 在 Popover 关闭生命周期后执行", () => {
  assert.match(source, /const runMobileToolAction = React\.useCallback\(\(action: \(\) => void\) => \{[\s\S]*?pendingMobileToolActionRef\.current = action[\s\S]*?setMobileToolsOpen\(false\)/);
  assert.match(source, /const handleMobileToolsCloseAutoFocus = React\.useCallback/);
  assert.match(source, /event\.preventDefault\(\)[\s\S]*?pendingMobileToolActionRef\.current = null[\s\S]*?action\(\)/);
  assert.match(source, /onCloseAutoFocus=\{handleMobileToolsCloseAutoFocus\}/);
});

test("手机断点首次渲染与更多工具触发文案保持完整", () => {
  assert.match(useMobileSource, /React\.useState\(\s*\(\) => typeof window !== "undefined" && window\.innerWidth < MOBILE_BREAKPOINT/);
  assert.match(cn, /mobileTools:\s*\{[\s\S]*?trigger: "更多任务工具"/);
  assert.match(en, /mobileTools:\s*\{[\s\S]*?trigger: "More task tools"/);
  assert.doesNotMatch(cn, /mobileTools:\s*\{[\s\S]*?title: "任务工具"/);
  assert.doesNotMatch(en, /mobileTools:\s*\{[\s\S]*?title: "Task tools"/);
});
