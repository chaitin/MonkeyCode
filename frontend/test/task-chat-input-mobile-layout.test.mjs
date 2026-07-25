import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/console/task/chat-inputbox.tsx", import.meta.url),
  "utf8",
);

test("任务对话输入栏在窄屏隔离输入区和操作区", () => {
  assert.match(
    source,
    /className="min-h-8 min-w-0 w-full max-h-36 resize-none overflow-y-auto/,
  );
  assert.match(
    source,
    /className="flex w-full min-w-0 flex-row items-center justify-between gap-2"/,
  );
  assert.match(
    source,
    /className="no-scrollbar flex min-w-0 flex-1 flex-row items-center gap-2 overflow-x-auto"/,
  );
  assert.match(
    source,
    /className="flex shrink-0 flex-row items-center gap-2"/,
  );
});

test("手机端操作保持 44px 触控区和发送可访问名称", () => {
  const mobileTouchTargets = source.match(/max-sm:size-11/g) ?? [];
  assert.ok(mobileTouchTargets.length >= 6);
  assert.match(source, /aria-label=\{t\("taskDetail\.common\.send"\)\}/);
  assert.match(
    source,
    /<span className="max-sm:hidden">\{t\("taskDetail\.common\.send"\)\}<\/span>/,
  );
  assert.match(
    source,
    /<VoiceInputButton[\s\S]*?className="max-sm:min-h-11 max-sm:min-w-11"/,
  );
});
