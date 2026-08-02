import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/pages/console/user/task/task-detail.tsx", import.meta.url),
  "utf8",
);
const cn = readFileSync(new URL("../src/i18n/resources/cn.ts", import.meta.url), "utf8");
const en = readFileSync(new URL("../src/i18n/resources/en.ts", import.meta.url), "utf8");
const useMobileSource = readFileSync(new URL("../src/hooks/use-mobile.ts", import.meta.url), "utf8");
const consoleUserPageSource = readFileSync(new URL("../src/pages/console/user/page.tsx", import.meta.url), "utf8");
const modeToggleSource = readFileSync(new URL("../src/components/mode-toggle.tsx", import.meta.url), "utf8");
const buttonSource = readFileSync(new URL("../src/components/ui/button.tsx", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile("task-detail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const consoleUserPageFile = ts.createSourceFile(
  "page.tsx",
  consoleUserPageSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function getClassName(node) {
  if (!ts.isJsxElement(node)) return undefined;
  const classAttribute = node.openingElement.attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === "className",
  );
  if (!classAttribute?.initializer || !ts.isStringLiteral(classAttribute.initializer)) return undefined;
  return classAttribute.initializer.text;
}

function findElementByClassName(file, className) {
  let result;

  function visit(node) {
    if (result) return;
    if (getClassName(node) === className) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return result;
}

function findSelfClosingElement(file, tagName) {
  let result;

  function visit(node) {
    if (result) return;
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === tagName) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return result;
}

test("手机页头恢复官方紧凑尺寸", () => {
  assert.match(source, /className="h-7 min-w-0 max-w-\[220px\] shrink gap-1 px-2 text-xs font-normal"/);
  assert.doesNotMatch(source, /className="h-7 min-w-0 flex-1 gap-1 px-2 text-xs font-normal/);
  assert.doesNotMatch(source, /getBrandFromModel\(currentModel\)[\s\S]*?md:hidden/);
  assert.doesNotMatch(source, /overflow-hidden rounded-md border md:contents/);
  assert.match(source, /className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm/);
  assert.match(source, /<CircularProgress[\s\S]*?size=\{20\}/);
  assert.match(source, /className="absolute right-0 top-1\/2 z-30 -translate-y-1\/2 md:hidden"[\s\S]*?size="icon-sm"/);
  assert.match(source, /size="icon-sm"[\s\S]*?className="!h-7 w-8 border-border bg-background shadow-xs"[\s\S]*?aria-label=\{t\("taskDetail\.page\.mobileTools\.trigger"\)\}/);
  assert.match(source, /onPointerUp=\{\(event\) => \{[\s\S]*?event\.pointerType === "touch"[\s\S]*?setContextUsagePopoverOpen\(\(open\) => !open\)/);
  assert.doesNotMatch(source, /className="h-11 min-w-0 flex-1/);
  assert.doesNotMatch(source, /className="size-11 shrink-0 md:hidden"/);
});

test("320px 页头使用自适应工具菜单", () => {
  assert.match(source, /className="flex min-w-0 flex-1 items-center gap-2"/);
  assert.match(source, /className="flex w-11 shrink-0 flex-wrap items-center/);
  assert.match(source, /mobileToolsView === "tools"[\s\S]*?"w-max min-w-\[120px\] max-w-\[calc\(100vw-2rem\)\] p-1\.5"/);
});

test("手机工具入口保持横向位置并与模型按钮中心对齐", () => {
  assert.match(source, /className="relative flex items-center gap-2 pr-10 md:justify-between md:gap-3 md:pr-0"/);
  assert.match(consoleUserPageSource, /<header className="flex h-15 shrink-0 items-center gap-2 overflow-hidden">/);
  assert.match(consoleUserPageSource, /className="ml-auto flex shrink-0 items-center gap-2 px-4"[\s\S]*?<ModeToggle \/>/);
  const outlet = findSelfClosingElement(consoleUserPageFile, "Outlet");
  assert.ok(outlet);
  assert.ok(getClassName(outlet.parent) === "h-full w-full min-w-0 px-4 overflow-x-hidden overflow-y-auto");
  assert.match(modeToggleSource, /<Button variant="outline" size="icon-sm">/);
  assert.match(buttonSource, /"icon-sm":\s*"size-8 /);
  assert.match(source, /className="h-7 min-w-0 max-w-\[220px\] shrink gap-1 px-2 text-xs font-normal"/);

  const mobileToolsStart = source.indexOf('<div className="absolute right-0 top-1/2 z-30 -translate-y-1/2 md:hidden">');
  const mobileToolsEnd = source.indexOf("</Popover>", mobileToolsStart);
  assert.ok(mobileToolsStart >= 0);
  assert.ok(mobileToolsEnd > mobileToolsStart);
  const mobileToolsSource = source.slice(mobileToolsStart, mobileToolsEnd);

  assert.match(mobileToolsSource, /<Popover modal open=\{mobileToolsOpen\} onOpenChange=\{handleMobileToolsOpenChange\}>/);
  assert.match(mobileToolsSource, /<PopoverTrigger asChild>[\s\S]*?size="icon-sm"[\s\S]*?aria-label=\{t\("taskDetail\.page\.mobileTools\.trigger"\)\}/);
  assert.match(mobileToolsSource, /<PopoverContent[\s\S]*?side="bottom"[\s\S]*?align="end"[\s\S]*?sideOffset=\{6\}[\s\S]*?avoidCollisions=\{false\}/);
  assert.doesNotMatch(source, /className="flex w-11 shrink-0 justify-end md:hidden"/);
  assert.doesNotMatch(source, /className="size-7 shrink-0"/);
});

test("手机工具入口锚定模型行并共享滚动参考系", () => {
  const modelRow = findElementByClassName(sourceFile, "relative flex items-center gap-2 pr-10 md:justify-between md:gap-3 md:pr-0");
  const mobileTools = findElementByClassName(sourceFile, "absolute right-0 top-1/2 z-30 -translate-y-1/2 md:hidden");
  assert.ok(modelRow);
  assert.ok(mobileTools);

  let ancestor = mobileTools.parent;
  while (ancestor && ancestor !== modelRow) {
    const ancestorClassName = getClassName(ancestor) ?? "";
    assert.doesNotMatch(ancestorClassName, /(?:^|\s)(?:relative|absolute|fixed|sticky)(?:\s|$)/);
    ancestor = ancestor.parent;
  }
  assert.ok(ancestor === modelRow);
  assert.doesNotMatch(source, /import \{ createPortal \} from "react-dom"/);
  assert.doesNotMatch(source, /createPortal\(|document\.body|fixed right-4 top-\[58px\]/);
});

test("手机页头不渲染消息定位按钮或定位下拉", () => {
  assert.doesNotMatch(source, /\{isMobile && \(\s*<TaskUserInputIndex/);
  assert.equal(source.match(/<TaskUserInputIndex/g)?.length, 1);
});

test("更多工具使用固定向下的动态宽度单一 Popover", () => {
  assert.equal(source.match(/<Popover modal open=\{mobileToolsOpen\}/g)?.length, 1);
  assert.match(source, /<PopoverContent[\s\S]*?side="bottom"[\s\S]*?align="end"[\s\S]*?sideOffset=\{6\}[\s\S]*?avoidCollisions=\{false\}/);
  assert.match(source, /className="flex w-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground md:w-auto"/);
  assert.match(source, /mobileToolsView === "tools"[\s\S]*?"w-max min-w-\[120px\] max-w-\[calc\(100vw-2rem\)\] p-1\.5"[\s\S]*?"w-\[calc\(100vw-2rem\)\] max-w-\[420px\] p-0"/);
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

test("文件和预览计数以图标角标展示", () => {
  assert.match(source, /aria-label=\{fileChangesCount > 0[\s\S]*?<span className="relative size-4 shrink-0">[\s\S]*?<IconFile className="size-4" \/>[\s\S]*?fileChangesCount > 0/);
  assert.match(source, /aria-label=\{previewPortCount > 0[\s\S]*?<span className="relative size-4 shrink-0">[\s\S]*?<IconDeviceDesktop className="size-4" \/>[\s\S]*?previewPortCount > 0/);
  assert.doesNotMatch(source, /<span className="ml-auto text-xs text-muted-foreground">\{(?:fileChangesCount|previewPortCount)\}<\/span>/);
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
