import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const inputGroupSource = readSource("../src/components/ui/input-group.tsx");
const blockInputSources = {
  chatInput: readSource("../src/components/console/task/chat-inputbox.tsx"),
  taskInput: readSource("../src/components/console/task/task-input.tsx"),
  chatSection: readSource("../src/components/console/task/task-chat-section.tsx"),
};

test("InputGroup 提供显式纵向布局且默认保持横向", () => {
  assert.match(
    inputGroupSource,
    /orientation\?: "horizontal" \| "vertical"/,
  );
  assert.match(inputGroupSource, /orientation = "horizontal"/);
  assert.match(inputGroupSource, /data-orientation=\{orientation\}/);
  assert.match(
    inputGroupSource,
    /orientation === "vertical" && "h-auto flex-col items-stretch"/,
  );
});

test("所有 block-end 输入组显式声明纵向布局", () => {
  for (const [name, source] of Object.entries(blockInputSources)) {
    assert.match(
      source,
      /<InputGroup\s+orientation="vertical"/,
      `${name} 缺少 vertical orientation`,
    );
    assert.match(source, /<InputGroupAddon align="block-end"/);
  }
});
