import Icon from "@/components/common/Icon";
import { TerminalFooter, TerminalHeader } from "@/components/welcome/terminal-chrome";
import { cn } from "@/lib/utils";
import { calculateSelfHostingResources, type MachineResources, TASK_CONCURRENCY_OPTIONS } from "@/utils/self-hosting-resources";
import { IconArrowRight, IconCheck, IconChevronDown } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

const SELF_HOSTING_DOC_LINK = "https://monkeycode.docs.baizhi.cloud/node/019eb0f3-9424-7c93-9489-4e584f989527";
const GITHUB_LINK = "https://github.com/chaitin/MonkeyCode/";
const CONSULT_LINK = "https://baizhi.cloud/consult";
const ONLINE_INSTALL_COMMAND = `bash -c "$(curl -fsSL 'https://monkeycode-ai.com/online/install')"`;
const OFFLINE_INSTALL_COMMAND = `curl -fL -o monkeycode-offline-linux-amd64.tgz \\
  https://monkeycode-release.oss-cn-hangzhou.aliyuncs.com/public/offline-package/monkeycode-offline-linux-amd64.tgz

tar -zxvf monkeycode-offline-linux-amd64.tgz
cd monkeycode-offline-linux-amd64/
sh install.sh`;

const themeVars = {
  "--a-bg": "#0a0d0a",
  "--a-bg-2": "#0d1210",
  "--a-panel": "#111814",
  "--a-line": "#1d2a22",
  "--a-line-2": "#243329",
  "--a-fg": "#c9d6cc",
  "--a-fg-dim": "#7a8c80",
  "--a-fg-mute": "#4a5b50",
  "--a-accent": "#7cf29c",
  "--a-info": "#61dafb",
} as React.CSSProperties;

const scenarioKeys = ["intranet", "compliance", "localModels", "teamControl"] as const;
const deploymentStepKeys = ["prepareResources", "installConsole", "installHost", "configureModels", "createAccounts", "startUsing"] as const;
const installMethodKeys = ["online", "offline"] as const;
const hostInstallStepKeys = ["login", "bind", "run"] as const;

function PageAction({
  href,
  to,
  primary,
  children,
}: {
  href?: string;
  to?: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  const className = cn(
    "inline-flex items-center justify-center gap-2 rounded-[4px] border px-4 py-3 text-sm font-semibold transition-colors",
    primary
      ? "border-[rgba(124,242,156,0.3)] bg-[var(--a-accent)] text-[var(--a-bg)] shadow-[0_0_24px_rgba(124,242,156,0.2)] hover:bg-[#93f7ae]"
      : "border-[var(--a-line-2)] bg-[var(--a-panel)] text-[var(--a-fg)] hover:bg-[#162019] hover:text-white"
  );

  if (to) {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}

function SectionHeading({
  index,
  label,
  title,
  description,
}: {
  index: string;
  label: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="text-[11px] tracking-[0.16em] text-[var(--a-accent)]">{index} / {label}</div>
        <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">{title}</h2>
      </div>
      <p className="max-w-[520px] text-sm leading-7 text-[var(--a-fg-dim)]">{description}</p>
    </div>
  );
}

function CommandBlock({ command }: { command: string }) {
  return (
    <pre className="mt-5 overflow-x-auto rounded border border-[var(--a-line-2)] bg-[var(--a-bg-2)] p-4">
      <code className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-[var(--a-fg)]">{command}</code>
    </pre>
  );
}

function ServerResourceCard({
  title,
  resource,
  labels,
}: {
  title: string;
  resource: MachineResources;
  labels: {
    cpu: string;
    memory: string;
    disk: string;
    coreUnit: string;
  };
}) {
  const metrics = [
    { label: labels.cpu, value: resource.cpuCores, unit: labels.coreUnit },
    { label: labels.memory, value: resource.memoryGb, unit: "GB" },
    { label: labels.disk, value: resource.diskGb, unit: "GB" },
  ];

  return (
    <div className="rounded border border-[var(--a-line-2)] bg-[var(--a-panel)] p-5">
      <div className="text-sm font-semibold text-[var(--a-fg)]">{title}</div>
      <dl className="mt-5 grid gap-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex items-center justify-between gap-4 border-b border-[var(--a-line)] pb-3 last:border-b-0 last:pb-0">
            <dt className="text-[11px] tracking-[0.12em] text-[var(--a-fg)]">{metric.label}</dt>
            <dd className="flex items-baseline gap-1 text-[var(--a-accent)]">
              <span className="text-2xl font-semibold leading-none">{metric.value}</span>
              <span className="text-xs text-[var(--a-fg-dim)]">{metric.unit}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DeploymentTimelineStep({
  stepNumber,
  title,
  body,
  children,
}: {
  stepNumber: number;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <li id={`deployment-step-${stepNumber}`} className="relative scroll-mt-[120px] pl-11 before:absolute before:bottom-[-1.25rem] before:left-[15px] before:top-9 before:w-px before:bg-[var(--a-line)] last:before:hidden">
      <div className="absolute left-0 top-0 flex size-8 items-center justify-center rounded-full border border-[rgba(124,242,156,0.32)] bg-[var(--a-bg-2)] text-sm font-semibold text-[var(--a-accent)]">
        {stepNumber}
      </div>
      <div className="rounded-md border border-[var(--a-line)] bg-[var(--a-panel)] p-6">
        <div className="text-[11px] tracking-[0.14em] text-[var(--a-fg-mute)]">STEP {String(stepNumber).padStart(2, "0")}</div>
        <h3 className="mt-3 text-xl font-semibold tracking-[-0.02em] text-[var(--a-accent)]">{title}</h3>
        <p className="mt-3 text-sm leading-7 text-[var(--a-fg-dim)]">{body}</p>
        {children}
      </div>
    </li>
  );
}

export default function SelfHostingPage() {
  const { t } = useTranslation();
  const [parallelTasks, setParallelTasks] = React.useState<number>(TASK_CONCURRENCY_OPTIONS[0]);
  const [installMethod, setInstallMethod] = React.useState<(typeof installMethodKeys)[number]>("online");
  const resourcePlan = calculateSelfHostingResources(parallelTasks);
  const resourceLabels = {
    cpu: t("selfHostingPage.sections.deploymentFlow.steps.prepareResources.metrics.cpu"),
    memory: t("selfHostingPage.sections.deploymentFlow.steps.prepareResources.metrics.memory"),
    disk: t("selfHostingPage.sections.deploymentFlow.steps.prepareResources.metrics.disk"),
    coreUnit: t("selfHostingPage.sections.deploymentFlow.steps.prepareResources.metrics.coreUnit"),
  };

  return (
    <div style={themeVars} className="min-h-screen overflow-x-hidden bg-[var(--a-bg)] text-[var(--a-fg)]">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(124,242,156,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(97,218,251,0.08),transparent_22%),linear-gradient(180deg,#090c09_0%,#0b0f0c_48%,#0a0d0a_100%)]" />
        <div className="absolute inset-0 opacity-35 [background:repeating-linear-gradient(0deg,rgba(124,242,156,0.025)_0px,rgba(124,242,156,0.025)_1px,transparent_1px,transparent_3px)]" />
      </div>

      <TerminalHeader homeAnchors={false} />

      <main className="relative z-10 mx-auto max-w-[1280px] px-5 pb-12 pt-[108px] sm:px-8 sm:pb-16 sm:pt-[120px]">
        <section className="border-b border-[var(--a-line)] pb-10">
          <div>
            <div className="inline-flex rounded border border-[rgba(124,242,156,0.18)] bg-[rgba(124,242,156,0.08)] px-3 py-1 text-[11px] tracking-[0.16em] text-[var(--a-accent)]">
              {t("selfHostingPage.hero.eyebrow")}
            </div>
            <h1 className="mt-6 text-4xl font-semibold leading-[1.04] tracking-[-0.04em] text-white sm:text-5xl lg:text-[64px]">
              {t("selfHostingPage.hero.title")}
            </h1>
            <p className="mt-5 text-sm leading-8 text-[var(--a-fg-dim)] sm:text-[15px]">
              {t("selfHostingPage.hero.subtitle")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PageAction href={SELF_HOSTING_DOC_LINK} primary>
                <IconArrowRight className="size-4" />
                <span>{t("selfHostingPage.actions.docs")}</span>
              </PageAction>
              <PageAction href={CONSULT_LINK}>
                <span>{t("selfHostingPage.actions.contact")}</span>
              </PageAction>
              <PageAction href={GITHUB_LINK}>
                <Icon name="GitHub-Uncolor" className="size-4 fill-current" />
                <span>{t("selfHostingPage.actions.github")}</span>
              </PageAction>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <SectionHeading
            index="01"
            label="SCENARIOS"
            title={t("selfHostingPage.sections.scenarios.title")}
            description={t("selfHostingPage.sections.scenarios.description")}
          />
          <div className="grid gap-px overflow-hidden rounded-md border border-[var(--a-line)] bg-[var(--a-line)] md:grid-cols-2">
            {scenarioKeys.map((key, index) => (
              <div key={key} className="bg-[var(--a-panel)] p-6">
                <div className="mb-5 flex items-center justify-between gap-4">
                  <span className="text-[11px] tracking-[0.12em] text-[var(--a-fg-mute)]">{String(index + 1).padStart(2, "0")}</span>
                  <IconCheck className="size-5 text-[var(--a-accent)]" />
                </div>
                <h3 className="text-xl font-semibold tracking-[-0.02em] text-[var(--a-accent)]">
                  {t(`selfHostingPage.sections.scenarios.items.${key}.title`)}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[var(--a-fg-dim)]">
                  {t(`selfHostingPage.sections.scenarios.items.${key}.body`)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <SectionHeading
            index="02"
            label="DEPLOYMENT"
            title={t("selfHostingPage.sections.deploymentFlow.title")}
            description={t("selfHostingPage.sections.deploymentFlow.description")}
          />
          <nav aria-label={t("selfHostingPage.sections.deploymentFlow.stepperLabel")} className="rounded-md border border-[var(--a-line)] bg-[var(--a-panel)] p-3">
            <ol className="grid gap-2 md:grid-cols-6">
              {deploymentStepKeys.map((key, index) => (
                <li key={key} className="min-w-0">
                  <a href={`#deployment-step-${index + 1}`} className="flex h-full items-center gap-3 rounded border border-[var(--a-line-2)] bg-[var(--a-bg-2)] px-3 py-3 transition-colors hover:border-[rgba(124,242,156,0.32)] hover:text-white">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[rgba(124,242,156,0.28)] text-xs font-semibold text-[var(--a-accent)]">
                      {index + 1}
                    </span>
                    <span className="min-w-0 text-sm font-semibold leading-5 text-[var(--a-fg)]">
                      {t(`selfHostingPage.sections.deploymentFlow.steps.${key}.title`)}
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <ol className="mt-6 space-y-5">
            <DeploymentTimelineStep
              stepNumber={1}
              title={t(`selfHostingPage.sections.deploymentFlow.steps.${deploymentStepKeys[0]}.title`)}
              body={t(`selfHostingPage.sections.deploymentFlow.steps.${deploymentStepKeys[0]}.body`)}
            >
              <div className="mt-6 rounded border border-[var(--a-line-2)] bg-[var(--a-bg-2)] p-4">
                <div className="flex flex-col gap-5 border-b border-[var(--a-line)] pb-5 md:flex-row md:items-end md:justify-between">
                  <div>
                    <div className="text-[11px] tracking-[0.16em] text-[var(--a-accent)]">
                      {t("selfHostingPage.sections.deploymentFlow.steps.prepareResources.calculatorTitle")}
                    </div>
                    <p className="mt-2 text-sm leading-7 text-[var(--a-fg-dim)]">
                      {t("selfHostingPage.sections.deploymentFlow.steps.prepareResources.note")}
                    </p>
                  </div>
                  <div className="relative md:min-w-[260px]">
                    <select
                      aria-label={t("selfHostingPage.sections.deploymentFlow.steps.prepareResources.calculatorTitle")}
                      value={parallelTasks}
                      onChange={(event) => setParallelTasks(Number(event.currentTarget.value))}
                      className="h-11 w-full appearance-none rounded border border-[var(--a-line-2)] bg-[var(--a-bg-2)] pl-3 pr-10 text-sm text-[var(--a-fg)] outline-none transition-colors hover:border-[rgba(124,242,156,0.32)] focus:border-[rgba(124,242,156,0.52)]"
                    >
                      {TASK_CONCURRENCY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {t("selfHostingPage.sections.deploymentFlow.steps.prepareResources.taskCountOption", { taskCount: option })}
                        </option>
                      ))}
                    </select>
                    <IconChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--a-fg-dim)]" />
                  </div>
                </div>

                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <ServerResourceCard
                    title={t("selfHostingPage.sections.deploymentFlow.steps.prepareResources.servers.console.title")}
                    resource={resourcePlan.console}
                    labels={resourceLabels}
                  />
                  <ServerResourceCard
                    title={t("selfHostingPage.sections.deploymentFlow.steps.prepareResources.servers.host.title")}
                    resource={resourcePlan.host}
                    labels={resourceLabels}
                  />
                </div>
              </div>
            </DeploymentTimelineStep>

            <DeploymentTimelineStep
              stepNumber={2}
              title={t(`selfHostingPage.sections.deploymentFlow.steps.${deploymentStepKeys[1]}.title`)}
              body={t(`selfHostingPage.sections.deploymentFlow.steps.${deploymentStepKeys[1]}.body`)}
            >
              <div className="mt-6 rounded border border-[var(--a-line-2)] bg-[var(--a-bg-2)] p-4">
                <div role="tablist" aria-label={t("selfHostingPage.sections.deploymentFlow.steps.installConsole.methodTabLabel")} className="grid gap-2 sm:grid-cols-2">
                  {installMethodKeys.map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={installMethod === key}
                      onClick={() => setInstallMethod(key)}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded border px-4 py-3 text-left text-sm font-semibold transition-colors",
                        installMethod === key
                          ? "border-[rgba(124,242,156,0.4)] bg-[rgba(124,242,156,0.1)] text-[var(--a-accent)]"
                          : "border-[var(--a-line-2)] bg-[var(--a-panel)] text-[var(--a-fg-dim)] hover:text-[var(--a-fg)]"
                      )}
                    >
                      <span>{t(`selfHostingPage.sections.deploymentFlow.steps.installConsole.methods.${key}.title`)}</span>
                      {key === "online" ? (
                        <span className="rounded border border-[rgba(124,242,156,0.3)] px-2 py-0.5 text-[11px] text-[var(--a-accent)]">
                          {t("selfHostingPage.sections.deploymentFlow.steps.installConsole.methods.online.recommendedBadge")}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>

                <div className="mt-5">
                  {installMethod === "online" ? (
                    <div role="tabpanel">
                      <p className="text-sm leading-7 text-[var(--a-fg-dim)]">
                        {t("selfHostingPage.sections.deploymentFlow.steps.installConsole.methods.online.description")}
                      </p>
                      <CommandBlock command={ONLINE_INSTALL_COMMAND} />
                    </div>
                  ) : (
                    <div role="tabpanel">
                      <p className="text-sm leading-7 text-[var(--a-fg-dim)]">
                        {t("selfHostingPage.sections.deploymentFlow.steps.installConsole.methods.offline.description")}
                      </p>
                      <CommandBlock command={OFFLINE_INSTALL_COMMAND} />
                    </div>
                  )}
                </div>
              </div>
            </DeploymentTimelineStep>

            <DeploymentTimelineStep
              stepNumber={3}
              title={t(`selfHostingPage.sections.deploymentFlow.steps.${deploymentStepKeys[2]}.title`)}
              body={t(`selfHostingPage.sections.deploymentFlow.steps.${deploymentStepKeys[2]}.body`)}
            >
              <div className="mt-5 grid gap-px overflow-hidden rounded-md border border-[var(--a-line)] bg-[var(--a-line)] md:grid-cols-3">
                {hostInstallStepKeys.map((key, index) => (
                  <div key={key} className="bg-[var(--a-bg-2)] p-5">
                    <div className="text-[11px] tracking-[0.14em] text-[var(--a-fg-mute)]">STEP {String(index + 1).padStart(2, "0")}</div>
                    <p className="mt-3 text-sm leading-7 text-[var(--a-fg-dim)]">
                      {t(`selfHostingPage.sections.deploymentFlow.steps.installHost.hostSteps.${key}`)}
                    </p>
                  </div>
                ))}
              </div>
            </DeploymentTimelineStep>

            {deploymentStepKeys.slice(3).map((key, index) => (
              <DeploymentTimelineStep
                key={key}
                stepNumber={index + 4}
                title={t(`selfHostingPage.sections.deploymentFlow.steps.${key}.title`)}
                body={t(`selfHostingPage.sections.deploymentFlow.steps.${key}.body`)}
              />
            ))}
          </ol>
        </section>

        <section className="mt-12 rounded-md border border-[var(--a-line)] bg-[var(--a-panel)] p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="text-[11px] tracking-[0.16em] text-[var(--a-accent)]">{t("selfHostingPage.final.label")}</div>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white">{t("selfHostingPage.final.title")}</h2>
              <p className="mt-4 max-w-[760px] text-sm leading-7 text-[var(--a-fg-dim)]">{t("selfHostingPage.final.description")}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <PageAction href={SELF_HOSTING_DOC_LINK} primary>
                <IconArrowRight className="size-4" />
                <span>{t("selfHostingPage.actions.docs")}</span>
              </PageAction>
              <PageAction to="/">
                <span>{t("selfHostingPage.actions.backHome")}</span>
              </PageAction>
            </div>
          </div>
        </section>
      </main>

      <TerminalFooter />
    </div>
  );
}
