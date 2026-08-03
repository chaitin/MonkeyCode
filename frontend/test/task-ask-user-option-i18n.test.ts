import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getAskUserOptionDisplayLabel } from "../src/components/console/task/ask-user-option-label.ts";
import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(
  new URL(
    "../src/components/console/task/message-ask-user-question.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("AI 提问的其它选项按界面语言显示", () => {
  assert.equal(
    getAskUserOptionDisplayLabel("其它", en.taskDetail.askUser.other),
    "Other",
  );
  assert.equal(
    getAskUserOptionDisplayLabel("其他", en.taskDetail.askUser.other),
    "Other",
  );
  assert.equal(
    getAskUserOptionDisplayLabel("Other", cn.taskDetail.askUser.other),
    "其他",
  );
  assert.equal(
    getAskUserOptionDisplayLabel(" 其它 ", en.taskDetail.askUser.other),
    "Other",
  );
});

test("普通 AI 选项保持原始显示文本", () => {
  assert.equal(
    getAskUserOptionDisplayLabel("方案 A", en.taskDetail.askUser.other),
    "方案 A",
  );
  assert.equal(
    getAskUserOptionDisplayLabel(" Option A ", en.taskDetail.askUser.other),
    " Option A ",
  );
  assert.equal(
    getAskUserOptionDisplayLabel(undefined, en.taskDetail.askUser.other),
    "",
  );
});

test("单选和多选只转换显示文本并保留原始选项值", () => {
  const displayCalls =
    source.match(
      /getAskUserOptionDisplayLabel\(option\.label, t\("taskDetail\.askUser\.other"\)\)/g,
    ) || [];
  assert.equal(displayCalls.length, 2);
  assert.match(
    source,
    /handleCheckboxClick\(questionIndex, option\.label, checked === true\)/,
  );
  assert.match(source, /value=\{option\.label\}/);
});
