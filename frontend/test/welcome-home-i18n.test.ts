import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  banner: readSource("../src/components/welcome/banner.tsx"),
  sdd: readSource("../src/components/welcome/sdd.tsx"),
  highlights: readSource("../src/components/welcome/highlights.tsx"),
  gitBot: readSource("../src/components/welcome/git-bot.tsx"),
  downloads: readSource("../src/components/welcome/downloads.tsx"),
  finalCta: readSource("../src/components/welcome/final-cta.tsx"),
};
const cjkPattern = /[\u3400-\u9fff]/;

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("欢迎页主体小组件使用 welcomeHome i18n key", () => {
  for (const source of Object.values(sourceFiles)) {
    assert.match(source, /useTranslation/);
    assert.match(source, /welcomeHome\./);
    assert.doesNotMatch(source, cjkPattern);
  }

  assert.match(sourceFiles.banner, /t\("welcomeHome\.banner\.headlinePrefix"\)/);
  assert.match(sourceFiles.sdd, /t\("welcomeHome\.sdd\.title"\)/);
  assert.match(sourceFiles.highlights, /t\("welcomeHome\.highlights\.title"\)/);
  assert.match(sourceFiles.gitBot, /t\("welcomeHome\.gitBot\.title"\)/);
  assert.match(sourceFiles.downloads, /t\("welcomeHome\.downloads\.title"\)/);
  assert.match(sourceFiles.finalCta, /t\("welcomeHome\.finalCta\.title"\)/);
});

test("欢迎页主体小组件提供中英文资源", () => {
  assert.equal(cn.welcomeHome.banner.headlinePrefix, "MonkeyCode 是");
  assert.equal(en.welcomeHome.banner.headlinePrefix, "MonkeyCode is");
  assert.equal(cn.welcomeHome.sdd.title, "三个关键词，概括 MonkeyCode 最值得宣传的点");
  assert.equal(en.welcomeHome.sdd.title, "Three keywords that capture what MonkeyCode should highlight most");
  assert.equal(cn.welcomeHome.downloads.action, "下载");
  assert.equal(en.welcomeHome.downloads.action, "Download");
});
