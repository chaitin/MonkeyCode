import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  header: readSource("../src/components/welcome/header.tsx"),
  footer: readSource("../src/components/welcome/footer.tsx"),
  terminalChrome: readSource("../src/components/welcome/terminal-chrome.tsx"),
  legalTerminalPage: readSource("../src/components/welcome/legal-terminal-page.tsx"),
};

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("欢迎页外壳组件使用 welcomeShell i18n key", () => {
  assert.match(sourceFiles.header, /useTranslation/);
  assert.match(sourceFiles.header, /t\("welcomeShell\.nav\.intro"\)/);
  assert.match(sourceFiles.header, /t\("welcomeShell\.actions\.start"\)/);

  assert.match(sourceFiles.footer, /useTranslation/);
  assert.match(sourceFiles.footer, /titleKey: "welcomeShell\.footer\.resources"/);
  assert.match(sourceFiles.footer, /t\(link\.titleKey\)/);
  assert.match(sourceFiles.footer, /t\("welcomeShell\.community\.wechat"\)/);

  assert.match(sourceFiles.terminalChrome, /useTranslation/);
  assert.match(sourceFiles.terminalChrome, /t\("welcomeShell\.terminal\.systemOnline"\)/);
  assert.match(sourceFiles.terminalChrome, /t\("welcomeShell\.footer\.description"\)/);

  assert.match(sourceFiles.legalTerminalPage, /useTranslation/);
  assert.match(sourceFiles.legalTerminalPage, /t\("welcomeShell\.legal\.lastUpdated"/);
  assert.match(sourceFiles.legalTerminalPage, /t\("welcomeShell\.legal\.contents"\)/);
});

test("欢迎页外壳提供中英文资源", () => {
  assert.equal(cn.welcomeShell.nav.intro, "介绍");
  assert.equal(en.welcomeShell.nav.intro, "Intro");
  assert.equal(cn.welcomeShell.actions.console, "进入控制台");
  assert.equal(en.welcomeShell.actions.console, "Console");
  assert.equal(cn.welcomeShell.footer.resources, "资源");
  assert.equal(en.welcomeShell.footer.resources, "Resources");
  assert.equal(cn.welcomeShell.legal.contents, "# 目录");
  assert.equal(en.welcomeShell.legal.contents, "# Contents");
});

test("欢迎页终端 header 在国际版隐藏注册入口", () => {
  assert.match(sourceFiles.header, /const \{ auth, serverConfig \} = useAppRuntime\(\)/);
  assert.match(sourceFiles.header, /const isGlobalRegion = serverConfig\?\.region === "global"/);
  assert.match(sourceFiles.header, /!isGlobalRegion && \(/);

  assert.match(sourceFiles.terminalChrome, /const \{ auth, serverConfig \} = useAppRuntime\(\)/);
  assert.match(sourceFiles.terminalChrome, /const isGlobalRegion = serverConfig\?\.region === "global"/);
  assert.match(sourceFiles.terminalChrome, /!\s*isGlobalRegion && !isLoggedIn \?/);
});

test("欢迎页 footer 在国际版隐藏 ICP 备案信息", () => {
  assert.match(sourceFiles.footer, /const \{ serverConfig \} = useAppRuntime\(\)/);
  assert.match(sourceFiles.footer, /const isGlobalRegion = serverConfig\?\.region === "global"/);
  assert.match(sourceFiles.footer, /isGlobalRegion && link\.titleKey === "welcomeShell\.footer\.icp"/);

  assert.match(sourceFiles.terminalChrome, /!\s*isGlobalRegion \? \([\s\S]*t\("welcomeShell\.footer\.icp"\)[\s\S]*\) : null/);
});

test("欢迎页资源列表不展示模型广场", () => {
  assert.doesNotMatch(sourceFiles.footer, /modelSquare|model-square/);
  assert.doesNotMatch(sourceFiles.terminalChrome, /MODEL_SQUARE_LINK|modelSquare|model-square/);
});
