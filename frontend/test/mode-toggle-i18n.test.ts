import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const source = readFileSync(new URL("../src/components/mode-toggle.tsx", import.meta.url), "utf8");
const cjkPattern = /[\u3400-\u9fff]/;

test("主题切换菜单使用 common i18n key", () => {
  assert.match(source, /useTranslation/);
  assert.match(source, /t\("common\.theme\.light"\)/);
  assert.match(source, /t\("common\.theme\.dark"\)/);
  assert.match(source, /t\("common\.theme\.system"\)/);
  assert.doesNotMatch(source, cjkPattern);
});

test("主题切换菜单提供中英文资源", () => {
  assert.equal(cn.common.theme.light, "明亮模式");
  assert.equal(en.common.theme.light, "Light mode");
  assert.equal(cn.common.theme.system, "跟随系统");
  assert.equal(en.common.theme.system, "Follow system");
});

test("主题切换菜单可容纳英文长文案", () => {
  assert.match(source, /<DropdownMenuContent align="end" className="w-max min-w-40">/);
});
