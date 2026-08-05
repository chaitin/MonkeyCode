import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/common/terminal.tsx", import.meta.url),
  "utf8",
);

test("浏览器容器是终端行列数的唯一来源", () => {
  const remoteResizeBranch = source.match(
    /else if \(data\.type === ['"]resize['"]\) \{([\s\S]*?)\n\s*\} else if/,
  );

  assert.equal(remoteResizeBranch, null);
  assert.doesNotMatch(source, /xtermInstance\.current\?\.resize\(col, row\)/);
});

test("容器变化在下一帧完成 fit 并上报最新行列数", () => {
  assert.match(
    source,
    /const scheduleResize = \(\) => \{[\s\S]*requestAnimationFrame/,
  );
  assert.match(
    source,
    /new ResizeObserver\(\(\) => \{\s*scheduleResize\(\);?\s*\}\)/,
  );
  assert.match(
    source,
    /fitAddonRef\.current\?\.fit\(\)[\s\S]*row: xtermInstance\.current\.rows[\s\S]*col: xtermInstance\.current\.cols/,
  );
});
