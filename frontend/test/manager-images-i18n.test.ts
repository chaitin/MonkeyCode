import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const files = [
  "../src/pages/console/manager/images.tsx",
  "../src/components/manager/add-image.tsx",
  "../src/components/manager/edit-image.tsx",
] as const;
const sources = files.map((file) =>
  readFileSync(new URL(file, import.meta.url), "utf8"),
);
const combinedSource = sources.join("\n");
const cjkPattern = /[\u3400-\u9fff]/;

test("manager image pages use managerImages i18n keys", () => {
  assert.match(combinedSource, /useTranslation/);
  assert.match(combinedSource, /t\("managerImages\.title"\)/);
  assert.match(combinedSource, /t\("managerImages\.add\.title"\)/);
  assert.match(combinedSource, /t\("managerImages\.edit\.title"\)/);
  assert.match(combinedSource, /t\("managerImages\.toast\.fetchFailed"\)/);
  for (const source of sources) {
    assert.doesNotMatch(source, cjkPattern);
  }
});

test("manager image pages provide Chinese and English resources", () => {
  assert.equal(cn.managerImages.title, "系统镜像");
  assert.equal(en.managerImages.title, "System images");
  assert.equal(cn.managerImages.add.title, "绑定系统镜像");
  assert.equal(en.managerImages.add.title, "Bind system image");
});
