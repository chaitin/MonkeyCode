import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import cn from "../src/i18n/resources/cn.ts";
import en from "../src/i18n/resources/en.ts";

const sourceFiles = {
  app: readSource("../src/App.tsx"),
  page: readSource("../src/pages/self-hosting.tsx"),
  terminalChrome: readSource("../src/components/welcome/terminal-chrome.tsx"),
  terminalNative: readSource("../src/components/welcome/terminal-native-page.tsx"),
};

function readSource(path: string) {
  const sourceUrl = new URL(path, import.meta.url);
  return existsSync(sourceUrl) ? readFileSync(sourceUrl, "utf8") : "";
}

test("私有化部署页面注册为独立路由", () => {
  assert.match(sourceFiles.app, /import SelfHostingPage from "\.\/pages\/self-hosting"/);
  assert.match(sourceFiles.app, /<Route path="\/self-hosting" element=\{<SelfHostingPage \/>} \/>/);

  assert.match(sourceFiles.page, /TerminalHeader homeAnchors=\{false}/);
  assert.match(sourceFiles.page, /<TerminalFooter \/>/);
  assert.match(sourceFiles.page, /t\("selfHostingPage\.hero\.title"\)/);
});

test("欢迎页私有化入口指向独立页面", () => {
  assert.match(sourceFiles.terminalChrome, /const SELF_HOSTING_PAGE_PATH = "\/self-hosting"/);
  assert.match(sourceFiles.terminalChrome, /\{ labelKey: "welcomeShell\.nav\.selfHosting", href: SELF_HOSTING_PAGE_PATH }/);
  assert.doesNotMatch(sourceFiles.terminalChrome, /#self-hosting/);

  assert.match(sourceFiles.terminalNative, /<HeaderAction to="\/self-hosting">/);
  assert.doesNotMatch(sourceFiles.terminalNative, /selfHostingActionLink|SELF_HOSTING_DOC_LINK/);
});

test("私有化部署页面提供中英文文案", () => {
  assert.equal(cn.selfHostingPage?.hero.title, "私有化部署");
  assert.equal(en.selfHostingPage?.hero.title, "Private deployment");
  assert.equal(cn.selfHostingPage?.sections.scenarios.title, "适用场景");
  assert.equal(en.selfHostingPage?.sections.scenarios.title, "When to use it");
  assert.equal(cn.selfHostingPage?.actions.docs, "免费部署使用");
  assert.equal(en.selfHostingPage?.actions.docs, "Deploy for free");
  assert.equal(cn.selfHostingPage?.actions.contact, "咨询付费方案");
  assert.equal(en.selfHostingPage?.actions.contact, "Discuss paid plans");
});

test("私有化部署页面 hero 不展示部署路径卡片", () => {
  assert.doesNotMatch(sourceFiles.page, /selfHostingPage\.hero\.panelTitle/);
  assert.doesNotMatch(sourceFiles.page, /selfHostingPage\.hero\.terminal|selfHostingPage\.hero\.stats/);
  assert.doesNotMatch(sourceFiles.page, /monkey deploy --self-hosted|self-hosted/);

  assert.equal(cn.selfHostingPage?.hero.panelTitle, undefined);
  assert.equal(en.selfHostingPage?.hero.panelTitle, undefined);
  assert.equal(cn.selfHostingPage?.hero.terminal, undefined);
  assert.equal(en.selfHostingPage?.hero.terminal, undefined);
  assert.equal(cn.selfHostingPage?.hero.stats, undefined);
  assert.equal(en.selfHostingPage?.hero.stats, undefined);
});

test("私有化部署页面 hero 内容使用完整宽度并调整按钮顺序", () => {
  assert.doesNotMatch(sourceFiles.page, /<div className="max-w-\[760px\]">/);
  assert.doesNotMatch(sourceFiles.page, /<p className="mt-5 max-w-\[680px\]/);
  assert.match(
    sourceFiles.page,
    /<PageAction href=\{SELF_HOSTING_DOC_LINK} primary>[\s\S]*selfHostingPage\.actions\.docs[\s\S]*<PageAction href=\{CONSULT_LINK}>[\s\S]*selfHostingPage\.actions\.contact[\s\S]*<PageAction href=\{GITHUB_LINK}>[\s\S]*selfHostingPage\.actions\.github/
  );
});

test("私有化部署页面将资源、安装和流程合并为部署流程", () => {
  assert.match(sourceFiles.page, /label="DEPLOYMENT"/);
  assert.match(sourceFiles.page, /title=\{t\("selfHostingPage\.sections\.deploymentFlow\.title"\)\}/);
  assert.match(sourceFiles.page, /const deploymentStepKeys = \["prepareResources", "installConsole", "installHost", "configureModels", "createAccounts", "startUsing"\] as const/);
  assert.doesNotMatch(sourceFiles.page, /label="RESOURCES"|label="INSTALL"|label="FLOW"|flowKeys/);
  assert.doesNotMatch(sourceFiles.page, /sections\.resources|sections\.install|sections\.flow/);

  assert.equal(cn.selfHostingPage?.sections.deploymentFlow.title, "部署流程");
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.title, "Deployment flow");
  assert.deepEqual(Object.keys(cn.selfHostingPage?.sections.deploymentFlow.steps ?? {}), [
    "prepareResources",
    "installConsole",
    "installHost",
    "configureModels",
    "createAccounts",
    "startUsing",
  ]);
  assert.equal(cn.selfHostingPage?.sections.resources, undefined);
  assert.equal(en.selfHostingPage?.sections.resources, undefined);
  assert.equal(cn.selfHostingPage?.sections.install, undefined);
  assert.equal(en.selfHostingPage?.sections.install, undefined);
  assert.equal(cn.selfHostingPage?.sections.flow, undefined);
  assert.equal(en.selfHostingPage?.sections.flow, undefined);
});

test("私有化部署流程使用步骤条和时间轴布局", () => {
  assert.match(sourceFiles.page, /function DeploymentTimelineStep/);
  assert.match(sourceFiles.page, /<nav aria-label=\{t\("selfHostingPage\.sections\.deploymentFlow\.stepperLabel"\)\}/);
  assert.match(sourceFiles.page, /deploymentStepKeys\.map\(\(key, index\) =>/);
  assert.match(sourceFiles.page, /href=\{`#deployment-step-\$\{index \+ 1}`\}/);
  assert.match(sourceFiles.page, /id=\{`deployment-step-\$\{stepNumber}`\}/);
  assert.match(sourceFiles.page, /scroll-mt-\[120px\]/);
  assert.match(sourceFiles.page, /<ol className="mt-6 space-y-5"/);
  assert.match(sourceFiles.page, /<DeploymentTimelineStep/);
  assert.doesNotMatch(sourceFiles.page, /function DeploymentStep/);

  assert.equal(cn.selfHostingPage?.sections.deploymentFlow.stepperLabel, "部署步骤");
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.stepperLabel, "Deployment steps");
});

test("私有化部署流程直接展示控制台和宿主机安装方法", () => {
  assert.match(sourceFiles.page, /const ONLINE_INSTALL_COMMAND =/);
  assert.match(sourceFiles.page, /bash -c "\$\(curl -fsSL 'https:\/\/monkeycode-ai\.com\/online\/install'\)"/);
  assert.match(sourceFiles.page, /const OFFLINE_INSTALL_COMMAND =/);
  assert.match(sourceFiles.page, /https:\/\/monkeycode-release\.oss-cn-hangzhou\.aliyuncs\.com\/public\/offline-package\/monkeycode-offline-linux-amd64\.tgz/);
  assert.match(sourceFiles.page, /tar -zxvf monkeycode-offline-linux-amd64\.tgz/);
  assert.match(sourceFiles.page, /sh install\.sh/);
  assert.match(sourceFiles.page, /hostInstallStepKeys/);
  assert.match(sourceFiles.page, /role="tablist"/);
  assert.match(sourceFiles.page, /setInstallMethod/);
  assert.match(sourceFiles.page, /installMethod === key/);
  assert.match(sourceFiles.page, /installMethod === "online"/);

  assert.equal(cn.selfHostingPage?.sections.deploymentFlow.steps.installConsole.title, "安装控制台");
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.steps.installConsole.title, "Install the console");
  assert.equal(cn.selfHostingPage?.sections.deploymentFlow.steps.installConsole.methods.online.title, "在线安装");
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.steps.installConsole.methods.online.title, "Online install");
  assert.equal(cn.selfHostingPage?.sections.deploymentFlow.steps.installConsole.methods.online.recommendedBadge, "推荐");
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.steps.installConsole.methods.online.recommendedBadge, "Recommended");
  assert.doesNotMatch(cn.selfHostingPage?.sections.deploymentFlow.steps.installConsole.methods.online.title ?? "", /一键/);
  assert.doesNotMatch(cn.selfHostingPage?.sections.deploymentFlow.steps.installConsole.methods.online.description ?? "", /一键安装/);
  assert.match(cn.selfHostingPage?.sections.deploymentFlow.steps.installHost.hostSteps.login ?? "", /管理员账号登录控制面板/);
});

test("私有化部署流程在准备资源步骤提供资源计算器", () => {
  assert.match(sourceFiles.page, /calculateSelfHostingResources/);
  assert.match(sourceFiles.page, /TASK_CONCURRENCY_OPTIONS/);
  assert.match(sourceFiles.page, /setParallelTasks/);
  assert.match(sourceFiles.page, /<select[\s\S]*value=\{parallelTasks\}/);
  assert.match(sourceFiles.page, /onChange=\{\(event\) => setParallelTasks\(Number\(event\.currentTarget\.value\)\)\}/);
  assert.match(sourceFiles.page, /TASK_CONCURRENCY_OPTIONS\.map\(\(option\) => \(\s*<option/);
  assert.match(sourceFiles.page, /IconChevronDown/);
  assert.match(sourceFiles.page, /appearance-none[\s\S]*pr-10/);
  assert.match(sourceFiles.page, /pointer-events-none[\s\S]*right-3/);
  assert.match(sourceFiles.page, /function ServerResourceCard/);
  assert.match(sourceFiles.page, /<ServerResourceCard[\s\S]*resource=\{resourcePlan\.console\}/);
  assert.match(sourceFiles.page, /<ServerResourceCard[\s\S]*resource=\{resourcePlan\.host\}/);
  assert.match(sourceFiles.page, /resource\.cpuCores/);
  assert.match(sourceFiles.page, /resource\.diskGb/);
  assert.match(sourceFiles.page, /<dt className="text-\[11px\] tracking-\[0\.12em\] text-\[var\(--a-fg\)\]">/);
  assert.doesNotMatch(sourceFiles.page, /customLabel|type="number"|valueAsNumber/);
  assert.doesNotMatch(sourceFiles.page, /function ResourceMetric|<ResourceMetric/);
  assert.doesNotMatch(sourceFiles.page, /prepareResources\.summary|prepareResources\.option|prepareResources\.taskCountLabel|setParallelTasks\(option\)/);
  assert.doesNotMatch(sourceFiles.page, /formulaTitle|sections\.resources\.formula|sections\.resources\.rounding/);

  const prepareResources = cn.selfHostingPage?.sections.deploymentFlow.steps.prepareResources;
  assert.equal(prepareResources?.title, "准备资源");
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.steps.prepareResources.title, "Prepare resources");
  assert.match(prepareResources?.note ?? "", /两台 Linux x86 服务器/);
  assert.match(prepareResources?.note ?? "", /ubuntu24\.04/i);
  assert.equal(prepareResources?.calculatorTitle, "选择并发任务数");
  assert.equal(prepareResources?.taskCountOption, "并发执行 {{taskCount}} 个任务");
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.steps.prepareResources.taskCountOption, "Run {{taskCount}} tasks concurrently");
  assert.equal(prepareResources?.taskCountLabel, undefined);
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.steps.prepareResources.taskCountLabel, undefined);
  assert.equal(prepareResources?.summary, undefined);
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.steps.prepareResources.summary, undefined);
  assert.equal(prepareResources?.option, undefined);
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.steps.prepareResources.option, undefined);
  assert.equal(prepareResources?.customLabel, undefined);
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.steps.prepareResources.customLabel, undefined);
  assert.equal(prepareResources?.formulaTitle, undefined);
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.steps.prepareResources.formulaTitle, undefined);
  assert.equal(prepareResources?.formula, undefined);
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.steps.prepareResources.formula, undefined);
  assert.equal(prepareResources?.requirements, undefined);
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.steps.prepareResources.requirements, undefined);
  assert.equal(prepareResources?.minimumNote, undefined);
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.steps.prepareResources.minimumNote, undefined);
  assert.equal(prepareResources?.servers.console.description, undefined);
  assert.equal(en.selfHostingPage?.sections.deploymentFlow.steps.prepareResources.servers.console.description, undefined);
  assert.doesNotMatch(sourceFiles.page, /prepareResources\.requirements|prepareResources\.minimumNote|prepareResources\.servers\.\$\{key}\.description/);
});

test("私有化部署页面不展示核心能力说明", () => {
  assert.doesNotMatch(sourceFiles.page, /capabilityKeys|boundaryKeys|CAPABILITIES/);
  assert.doesNotMatch(sourceFiles.page, /sections\.capabilities|sections\.boundary/);

  assert.equal(cn.selfHostingPage?.sections.capabilities, undefined);
  assert.equal(en.selfHostingPage?.sections.capabilities, undefined);
  assert.equal(cn.selfHostingPage?.sections.boundary, undefined);
  assert.equal(en.selfHostingPage?.sections.boundary, undefined);
});

test("私有化部署页面底部入口指向详细使用文档", () => {
  assert.equal(cn.selfHostingPage?.final.title, "详细使用文档");
  assert.equal(en.selfHostingPage?.final.title, "Detailed documentation");
});
