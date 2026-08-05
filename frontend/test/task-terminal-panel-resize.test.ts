import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/pages/console/user/task/task-detail.tsx", import.meta.url),
  "utf8",
);

test("任务详情面板使用 react-resizable-panels v4 的显式百分比尺寸", () => {
  assert.match(
    source,
    /id="top" defaultSize=\{hasBottomTerminal \? "75%" : "100%"\} minSize="30%"/,
  );
  assert.match(
    source,
    /id="chat" defaultSize=\{hasSidePanel \? "50%" : "100%"\} minSize=\{hasSidePanel \? "30%" : "100%"\}/,
  );
  assert.match(source, /id="right-panel" defaultSize="50%" minSize="25%"/);
  assert.match(
    source,
    /id="bottom-terminal" defaultSize="25%" minSize="20%" maxSize="70%"/,
  );
});

test("任务详情面板不再把百分比意图作为像素数传给 v4", () => {
  assert.doesNotMatch(
    source,
    /(?:defaultSize|minSize|maxSize)=\{(?:20|25|30|50|75|100)\}/,
  );
});
