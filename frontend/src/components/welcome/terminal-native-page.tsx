import { useAppRuntime } from "@/components/app-runtime-provider";
import Icon from "@/components/common/Icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { IconArrowRight, IconBrandAndroid, IconBrandApple, IconCheck, IconCoins, IconDownload, IconFile, IconFilePencil, IconFolder, IconFolderOpen, IconHelpCircle, IconSend, IconX } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { TerminalFooter, TerminalHeader } from "./terminal-chrome";
import {
  CREDIT_RECHARGE_PACKAGES,
  formatRegionCurrency,
  getCreditRechargeAmount,
  getPricingRegion,
  getSubscriptionPlanAmount,
  type SubscriptionPlanPriceId,
} from "@/utils/pricing";

const GITHUB_LINK = "https://github.com/chaitin/MonkeyCode/";
const CONSULT_LINK = "https://baizhi.cloud/consult";

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
  "--a-accent-dim": "#3ba863",
  "--a-warn": "#d8a84f",
  "--a-danger": "#ff6b6b",
  "--a-info": "#61dafb",
  "--a-magenta": "#ff6b9d",
  "--a-purple": "#c39bff",
} as React.CSSProperties;

const featureItems = [
  {
    key: "01",
    cmd: "--free --no-install",
    i18nKey: "free",
  },
  {
    key: "02",
    cmd: "--cloud --dedicated",
    i18nKey: "cloud",
  },
  {
    key: "03",
    cmd: "--models --all-major",
    i18nKey: "models",
  },
  {
    key: "04",
    cmd: "--mobile --cross-device",
    i18nKey: "mobile",
  },
  {
    key: "05",
    cmd: "--opensource --auditable",
    i18nKey: "openSource",
  },
  {
    key: "06",
    cmd: "--self-host --air-gapped",
    i18nKey: "selfHost",
  },
] as const;

const useCaseItems = [
  {
    tag: "game",
    key: "game",
  },
  {
    tag: "feature",
    key: "feature",
  },
  {
    tag: "security",
    key: "security",
  },
  {
    tag: "paper",
    key: "paper",
  },
  {
    tag: "data",
    key: "data",
  },
  {
    tag: "research",
    key: "research",
  },
] as const;

const mobileClientItems = [
  {
    platform: "Android",
    icon: IconBrandAndroid,
    href: "https://release.monkeycode-ai.com/public/mobile/app/monkeycode-latest.apk",
    i18nKey: "android",
  },
  {
    platform: "iOS",
    icon: IconBrandApple,
    href: "https://apps.apple.com/cn/app/monkeycode%E7%BC%96%E7%A8%8B%E5%8A%A9%E6%89%8B/id6777423440",
    i18nKey: "ios",
  },
] as const;

const selfHostingAdvantageKeys = ["dataBoundary", "governance", "integration", "offline"] as const;

const compareColumns = ["MonkeyCode", "Cursor", "Claude Code", "Codex"] as const;

const compareRows = [
  { key: "online", values: [1, 1, 1, 1] },
  { key: "localIde", values: [0, 1, 1, 1] },
  { key: "localCli", values: [0, 1, 1, 1] },
  { key: "specManagement", values: [1, 0, 0, 0] },
  { key: "cloudEnvironment", values: [1, 2, 2, 2] },
  { key: "completion", values: [0, 1, 0, 0] },
  { key: "review", values: [1, 2, 2, 2] },
  { key: "collaboration", values: [1, 0, 0, 0] },
  { key: "domesticModels", values: [1, 0, 0, 0] },
  { key: "selfHosting", values: [1, 0, 0, 0] },
  { key: "openSource", values: [1, 0, 0, 0] },
] as const;

const testimonialKeys = [
  "aiwenming",
  "yitao",
  "full",
  "liHongxi",
  "clever",
  "situBei",
  "sinianLiu",
  "timeTraveler",
  "darkStreet",
  "xiaotantan",
  "nanshan",
  "ajie",
] as const;

type PricingFeature = {
  status?: "supported" | "partial" | "unsupported";
  key: string;
  tooltipKey?: "credit" | "thirdPartyModels" | "enhancedCapabilities";
};

type PricingTier = {
  key: string;
  cmd: string;
  planId: SubscriptionPlanPriceId;
  features: PricingFeature[];
  ctaTo: string;
  featured?: boolean;
};

const pricingTiers: PricingTier[] = [
  {
    key: "free",
    cmd: "monkey account --free",
    planId: "basic",
    features: [
      { key: "concurrency1" },
      { key: "cloud1c4g" },
      { key: "dailyQuotaBasic" },
      { key: "modelScopeBasic" },
      { key: "noCredits", status: "unsupported", tooltipKey: "credit" },
      { key: "thirdPartyModels", status: "partial", tooltipKey: "thirdPartyModels" },
      { key: "enhancedCapabilities", status: "partial", tooltipKey: "enhancedCapabilities" },
    ],
    ctaTo: "/console",
    featured: true,
  },
  {
    key: "pro",
    cmd: "monkey account --pro",
    planId: "pro",
    features: [
      { key: "concurrency3" },
      { key: "cloud2c8g" },
      { key: "dailyQuotaPro" },
      { key: "modelScopePro" },
      { key: "credits10k", tooltipKey: "credit" },
      { key: "thirdPartyModels", tooltipKey: "thirdPartyModels" },
      { key: "enhancedCapabilities", tooltipKey: "enhancedCapabilities" },
    ],
    ctaTo: "/console",
  },
  {
    key: "ultra",
    cmd: "monkey account --ultra",
    planId: "ultra",
    features: [
      { key: "concurrency3" },
      { key: "cloud2c8g" },
      { key: "dailyQuotaUltra" },
      { key: "modelScopeUltra" },
      { key: "credits100k", tooltipKey: "credit" },
      { key: "thirdPartyModels", tooltipKey: "thirdPartyModels" },
      { key: "enhancedCapabilities", tooltipKey: "enhancedCapabilities" },
    ],
    ctaTo: "/console",
  },
];

const billingOptions = [
  { value: "monthly", i18nKey: "monthly" },
  { value: "yearly", i18nKey: "yearly" },
] as const;

type BillingPeriod = (typeof billingOptions)[number]["value"];

const earnWays = [
  { icon: "↗", key: "invite" },
  { icon: "✓", key: "checkin" },
  { icon: "✎", key: "article" },
  { icon: "#", key: "community", valueTo: "#community" },
] as const;

const faqKeys = ["free", "training", "models", "offline", "difference", "production"] as const;

type HeroFileTreeItem = {
  name: string;
  type: "folder" | "file";
  indent?: number;
  open?: boolean;
  dot?: string;
  active?: boolean;
};

const heroContextUsage = 70;

const heroFileTree: HeroFileTreeItem[] = [
  { name: "src", type: "folder", open: true },
  { name: "world", type: "folder", indent: 1, open: true },
  { name: "chunk.ts", type: "file", indent: 2, dot: "var(--a-warn)" },
  { name: "terrain.ts", type: "file", indent: 2, dot: "var(--a-accent)" },
  { name: "inventory.ts", type: "file", indent: 2 },
  { name: "App.tsx", type: "file", indent: 1 },
  { name: "main.tsx", type: "file", indent: 1 },
  { name: "textures", type: "folder", indent: 1 },
  { name: "tests", type: "folder" },
  { name: "package.json", type: "file" },
  { name: "README.md", type: "file" },
];

function tStringList(t: TFunction, key: string) {
  const value = t(key, { returnObjects: true });
  return Array.isArray(value) ? value.map(String) : [];
}

function SectionShell({
  id,
  index,
  label,
  title,
  subtitle,
  action,
  children,
}: {
  id: string;
  index: string;
  label: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mx-auto max-w-[1280px] px-5 py-14 sm:px-8 sm:py-20">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-[11px] tracking-[0.22em] text-[var(--a-accent)]">{index}</span>
        <span className="text-[11px] tracking-[0.22em] text-[var(--a-fg-mute)]">// {label}</span>
        <div className="h-px flex-1 bg-gradient-to-r from-[var(--a-line-2)] to-transparent" />
      </div>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <h2 className="max-w-[820px] text-3xl font-semibold leading-[1.08] tracking-[-0.03em] text-[var(--a-fg)] sm:text-4xl lg:text-[44px]">
          {title}
        </h2>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {subtitle ? (
        <p className="mt-4 w-full text-sm leading-7 text-[var(--a-fg-dim)] sm:text-[15px] sm:leading-8">
          {subtitle}
        </p>
      ) : null}
      <div className="mt-10">{children}</div>
    </section>
  );
}

function BlinkCursor() {
  return <span className="mc-blink inline-block h-[0.95em] w-[0.55em] align-middle bg-[var(--a-accent)]" />;
}

function PromptLine({
  path = "~",
  children,
  className,
}: {
  path?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-[13px] leading-7 text-[var(--a-fg)]", className)}>
      <span className="text-[var(--a-accent)]">dev@monkey</span>
      <span className="text-[var(--a-fg-dim)]">:</span>
      <span className="text-[var(--a-info)]">{path}</span>
      <span className="text-[var(--a-fg-dim)]"> $ </span>
      <span>{children}</span>
    </div>
  );
}

function HeaderAction({
  to,
  href,
  external,
  children,
  primary,
}: {
  to?: string;
  href?: string;
  external?: boolean;
  children: React.ReactNode;
  primary?: boolean;
}) {
  const className = cn(
    "inline-flex items-center justify-center gap-2 rounded-[4px] border px-3.5 py-2 text-[13px] transition-colors",
    primary
      ? "border-[rgba(124,242,156,0.3)] bg-[var(--a-accent)] text-[var(--a-bg)] shadow-[0_0_24px_rgba(124,242,156,0.24)] hover:bg-[#93f7ae]"
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
    <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} className={className}>
      {children}
    </a>
  );
}

export default function TerminalNativePage() {
  const { auth, serverConfig } = useAppRuntime();
  const isLoggedIn = auth.status === "authenticated";
  const { t } = useTranslation();
  const pricingRegion = getPricingRegion(serverConfig?.region);
  const [openFaq, setOpenFaq] = React.useState(0);
  const [billingPeriod, setBillingPeriod] = React.useState<BillingPeriod>("monthly");
  const selfHostingAdvantages = selfHostingAdvantageKeys.map((key) => t(`terminalNative.selfHosting.advantages.${key}`));
  const testimonialItems = testimonialKeys.map((key) => ({
    key,
    quote: String(t(`terminalNative.testimonials.items.${key}.quote`)),
    name: String(t(`terminalNative.testimonials.items.${key}.name`)),
    role: String(t(`terminalNative.testimonials.items.${key}.role`)),
  }));

  return (
    <div
      className="relative min-h-screen overflow-x-hidden bg-[var(--a-bg)] text-[var(--a-fg)]"
      style={{ ...themeVars, wordBreak: "normal" }}
    >
      <style>{`
        @keyframes mc-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
        @keyframes mc-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .mc-blink { animation: mc-blink 1s steps(2) infinite; }
        .mc-pulse { animation: mc-pulse 1.5s infinite; }
      `}</style>

      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(circle at top, rgba(124,242,156,0.08), transparent 34%), radial-gradient(circle at 20% 12%, rgba(124,242,156,0.1), transparent 24%), radial-gradient(circle at 80% 16%, rgba(97,218,251,0.08), transparent 22%), linear-gradient(180deg, #0a0d0a 0%, #0a0d0a 100%)",
          }}
        />
        <div
          className="absolute inset-0 mix-blend-screen opacity-40"
          style={{
            background:
              "repeating-linear-gradient(0deg, rgba(124,242,156,0.02) 0px, rgba(124,242,156,0.02) 1px, transparent 1px, transparent 3px)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,0.45) 100%)" }}
        />
      </div>

      <TerminalHeader />

      <main className="relative z-10 pt-[88px] sm:pt-[92px]">
        <section id="hero" className="mx-auto max-w-[1280px] px-5 pb-10 pt-8 sm:px-8 sm:pt-12 sm:pb-16">
          <div className="grid items-center gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14">
            <div className="relative">
              <div className="pointer-events-none absolute left-[18%] top-[8%] h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(124,242,156,0.12),transparent_70%)] blur-3xl" />
              <div className="relative">
                <h1 className="text-4xl font-semibold leading-[1.03] tracking-[-0.04em] text-white sm:text-5xl lg:text-[68px]">
                  <span>Monkey</span>
                  <span className="text-[var(--a-accent)] [text-shadow:0_0_24px_rgba(124,242,156,0.35)]">Code</span>
                </h1>
                <p className="mt-4 max-w-[540px] text-2xl font-medium leading-[1.08] tracking-[-0.03em] text-[var(--a-fg)] sm:text-[30px]">
                  {t("terminalNative.hero.tagline")}
                </p>
                <p className="mt-5 max-w-[540px] text-sm leading-8 text-[var(--a-fg-dim)] sm:text-[15px]">
                  {t("terminalNative.hero.description")}
                </p>

                <div className="mt-9 flex flex-wrap gap-3">
                  <HeaderAction to="/console" primary>
                    <IconArrowRight className="size-4" />
                    <span>{t("terminalNative.actions.start")}</span>
                  </HeaderAction>
                  <HeaderAction href="#mobile-client">
                    <IconArrowRight className="size-4" />
                    <span>{t("terminalNative.actions.mobileClient")}</span>
                  </HeaderAction>
                  <HeaderAction href={GITHUB_LINK} external>
                    <Icon name="GitHub-Uncolor" className="size-4 fill-current" />
                    <span>GitHub</span>
                  </HeaderAction>
                </div>

              </div>
            </div>

            <HeroTerminalCard />
          </div>
        </section>

        <SectionShell
          id="features"
          index="01"
          label="FEATURES"
          title={t("terminalNative.features.title")}
          subtitle={t("terminalNative.features.subtitle")}
        >
          <div className="grid gap-px overflow-hidden rounded-md border border-[var(--a-line)] bg-[var(--a-line)] md:grid-cols-2 lg:grid-cols-3">
            {featureItems.map((item) => (
              <div
                key={item.key}
                className="group min-h-[220px] bg-[var(--a-panel)] p-7 transition-colors hover:bg-[rgba(124,242,156,0.03)]"
              >
                <div className="mb-6 flex items-baseline justify-between gap-4">
                  <span className="text-[10px] tracking-[0.14em] text-[var(--a-fg-mute)]">{item.key}</span>
                  <span className="text-[10px] tracking-[0.08em] text-[var(--a-accent)] opacity-60 transition-opacity group-hover:opacity-100">
                    {item.cmd}
                  </span>
                </div>
                <h3 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--a-accent)] transition-[text-shadow] group-hover:[text-shadow:0_0_18px_rgba(124,242,156,0.4)]">
                  {t(`terminalNative.featureItems.${item.i18nKey}.title`)}
                </h3>
                <p className="mt-4 text-sm leading-7 text-[var(--a-fg-dim)]">{t(`terminalNative.featureItems.${item.i18nKey}.body`)}</p>
              </div>
            ))}
          </div>
        </SectionShell>

        <SectionShell
          id="usecases"
          index="02"
          label="USE CASES"
          title={t("terminalNative.useCases.title")}
          subtitle={t("terminalNative.useCases.subtitle")}
        >
          <div className="grid gap-px overflow-hidden rounded-md border border-[var(--a-line-2)] bg-[var(--a-line)] md:grid-cols-2 lg:grid-cols-3">
            {useCaseItems.map((item, index) => (
              <div
                key={item.key}
                className="group flex min-h-[280px] flex-col bg-[var(--a-panel)] p-7 transition-colors hover:bg-[rgba(124,242,156,0.035)]"
              >
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[10px] tracking-[0.14em] text-[var(--a-fg-mute)]">CASE / {String(index + 1).padStart(2, "0")}</span>
                  <span className="rounded border border-[rgba(124,242,156,0.15)] bg-[rgba(124,242,156,0.06)] px-2 py-0.5 text-[10px] tracking-[0.08em] text-[var(--a-accent)]">
                    #{item.tag}
                  </span>
                </div>
                <h3 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--a-accent)] transition-[text-shadow] group-hover:[text-shadow:0_0_14px_rgba(124,242,156,0.4)]">
                  {t(`terminalNative.useCaseItems.${item.key}.title`)}
                </h3>
                <p className="mt-3 flex-1 text-sm leading-7 text-[var(--a-fg-dim)]">{t(`terminalNative.useCaseItems.${item.key}.body`)}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {tStringList(t, `terminalNative.useCaseItems.${item.key}.stack`).map((tag) => (
                    <span key={tag} className="rounded border border-[var(--a-line-2)] px-2 py-1 text-[11px] text-[var(--a-fg-dim)]">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionShell>

        <SectionShell
          id="mobile-client"
          index="03"
          label="MOBILE CLIENT"
          title={t("terminalNative.mobile.title")}
          subtitle={t("terminalNative.mobile.subtitle")}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {mobileClientItems.map((item) => (
              <div
                key={item.platform}
                className="rounded-md border border-[var(--a-line)] bg-[var(--a-panel)] p-6 transition-colors hover:border-[rgba(124,242,156,0.32)] hover:bg-[rgba(124,242,156,0.025)]"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-11 shrink-0 items-center justify-center rounded border border-[rgba(124,242,156,0.16)] bg-[rgba(124,242,156,0.06)] text-[var(--a-accent)]">
                    <item.icon className="size-6" />
                  </span>
                  <div>
                    <h3 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--a-accent)]">
                      {item.platform}
                    </h3>
                  </div>
                </div>
                <a
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded border border-[rgba(124,242,156,0.24)] bg-[rgba(124,242,156,0.08)] px-4 py-3 text-sm font-semibold text-[var(--a-accent)] transition-colors hover:bg-[rgba(124,242,156,0.14)] hover:text-[var(--a-fg)]"
                >
                  <IconDownload className="size-4" />
                  {t(`terminalNative.mobile.items.${item.i18nKey}.cta`)}
                </a>
              </div>
            ))}
          </div>
        </SectionShell>

        <SectionShell
          id="self-hosting"
          index="04"
          label="SELF HOSTING"
          title={t("terminalNative.selfHosting.title")}
          subtitle={t("terminalNative.selfHosting.subtitle")}
          action={
            <HeaderAction to="/self-hosting">
              <IconArrowRight className="size-4" />
              <span>{t("terminalNative.selfHosting.action")}</span>
            </HeaderAction>
          }
        >
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-md border border-[var(--a-line)] bg-[var(--a-panel)] p-6">
              <div className="text-[10px] tracking-[0.12em] text-[var(--a-accent)]">$ monkey deploy --self-hosted</div>
              <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[var(--a-fg)]">
                {t("terminalNative.selfHosting.cardTitle")}
              </h3>
              <p className="mt-4 text-sm leading-7 text-[var(--a-fg-dim)]">
                {t("terminalNative.selfHosting.cardBody")}
              </p>
            </div>
            <div className="grid gap-px overflow-hidden rounded-md border border-[var(--a-line)] bg-[var(--a-line)]">
              {selfHostingAdvantages.map((item, index) => (
                <div key={item} className="flex gap-4 bg-[var(--a-panel)] p-5">
                  <span className="mt-1 text-[11px] tracking-[0.12em] text-[var(--a-accent)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="text-sm leading-7 text-[var(--a-fg-dim)]">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </SectionShell>

        <SectionShell
          id="why"
          index="05"
          label="WHY MONKEYCODE"
          title={t("terminalNative.compare.title")}
          subtitle={t("terminalNative.compare.subtitle")}
        >
          <div className="overflow-x-auto rounded-md border border-[var(--a-line-2)] bg-[var(--a-panel)]">
            <table className="min-w-[900px] w-full border-collapse">
              <thead>
                <tr className="border-b border-[var(--a-line-2)] bg-[var(--a-bg-2)]">
                  <th className="px-5 py-4 text-left text-[11px] tracking-[0.12em] text-[var(--a-fg-mute)]"># {t("terminalNative.compare.dimension")}</th>
                  {compareColumns.map((column, index) => (
                    <th
                      key={column}
                      className={cn(
                        "px-3 py-4 text-center text-xs font-medium tracking-[0.06em]",
                        index === 0
                          ? "border-x border-[rgba(124,242,156,0.18)] bg-[rgba(124,242,156,0.04)] text-[var(--a-accent)]"
                          : "border-l border-[var(--a-line)] text-[var(--a-fg)]"
                      )}
                    >
                      <div className="relative">
                        {column}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row, rowIndex) => (
                  <tr key={row.key} className={rowIndex % 2 === 1 ? "bg-[rgba(255,255,255,0.012)]" : ""}>
                    <td className="border-b border-[var(--a-line)] px-5 py-4 text-sm text-[var(--a-fg)]">{t(`terminalNative.compare.rows.${row.key}`)}</td>
                    {row.values.map((value, cellIndex) => (
                      <td
                        key={`${row.key}-${cellIndex}`}
                        className={cn(
                          "border-b border-[var(--a-line)] px-3 py-4 text-center",
                          cellIndex === 0
                            ? "border-x border-x-[rgba(124,242,156,0.18)] bg-[rgba(124,242,156,0.04)]"
                            : "border-l border-l-[var(--a-line)]"
                        )}
                      >
                        {value === 1 ? (
                          <span className="inline-flex size-[18px] items-center justify-center rounded-[3px] bg-[var(--a-accent)] text-[11px] font-bold text-[var(--a-bg)]">
                            ✓
                          </span>
                        ) : value === 2 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex size-[18px] cursor-help items-center justify-center rounded-[3px] bg-[rgba(247,185,85,0.72)] text-[11px] font-bold text-[var(--a-bg)]">
                                ✓
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{t("terminalNative.compare.partialTooltip")}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="inline-flex size-[18px] items-center justify-center text-[13px] text-[var(--a-fg-mute)]">✕</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-[11px] tracking-[0.04em] text-[var(--a-fg-mute)]">
            // {t("terminalNative.compare.note")}
          </div>
        </SectionShell>

        <SectionShell
          id="testimonials"
          index="06"
          label="WHAT DEVS SAY"
          title={t("terminalNative.testimonials.title")}
          subtitle={t("terminalNative.testimonials.subtitle")}
        >
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            {[...testimonialItems].sort((a, b) => a.quote.length - b.quote.length).map((item) => (
              <div key={item.key} className="relative flex h-full flex-col rounded-md border border-[var(--a-line)] bg-[var(--a-panel)] p-6">
                <div className="absolute left-5 top-4 text-4xl leading-none text-[var(--a-accent-dim)] opacity-40">❝</div>
                <p className="relative flex-1 text-sm leading-7 text-[var(--a-fg)]">{item.quote}</p>
                <div className="mt-5 border-t border-dashed border-[var(--a-line-2)] pt-4">
                  <div className="text-sm text-[var(--a-accent)]">{item.name}</div>
                  <div className="mt-1 text-[13px] text-[var(--a-fg-dim)]">{item.role}</div>
                </div>
              </div>
            ))}
          </div>
        </SectionShell>

        <SectionShell
          id="pricing"
          index="07"
          label="PRICING"
          title={t("terminalNative.pricing.title")}
          subtitle={t("terminalNative.pricing.subtitle")}
          action={
            <div className="inline-flex rounded-md border border-[var(--a-line-2)] bg-[var(--a-bg-2)] p-1">
              {billingOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setBillingPeriod(option.value)}
                  className={cn(
                    "rounded px-3 py-2 text-sm font-semibold transition-colors",
                    billingPeriod === option.value
                      ? "bg-[var(--a-accent)] text-[var(--a-bg)]"
                      : "text-[var(--a-fg-dim)] hover:text-[var(--a-fg)]"
                  )}
                >
                  {t(`terminalNative.pricing.billing.${option.i18nKey}`)}
                </button>
              ))}
            </div>
          }
        >
          <div className="grid gap-4 xl:grid-cols-3">
            {pricingTiers.map((tier) => {
              const price = formatRegionCurrency(
                getSubscriptionPlanAmount(pricingRegion, tier.planId, billingPeriod),
                pricingRegion,
              );
              const unit = t(`terminalNative.pricing.tiers.${tier.key}.${billingPeriod}Unit`);
              const discount = billingPeriod === "yearly" ? t(`terminalNative.pricing.tiers.${tier.key}.yearlyDiscount`) : "";

              return (
                <div
                  key={tier.key}
                  className={cn(
                    "relative flex h-full flex-col rounded-md border p-7",
                    tier.featured
                      ? "border-[var(--a-accent-dim)] bg-[var(--a-panel)] shadow-[0_0_40px_rgba(124,242,156,0.1)]"
                      : "border-[var(--a-line)] bg-[var(--a-bg-2)]"
                  )}
                >
                  {tier.featured ? (
                    <div className="absolute left-1/2 top-[-10px] -translate-x-1/2 rounded bg-[var(--a-accent)] px-2 py-1 text-[10px] font-semibold tracking-[0.1em] text-[var(--a-bg)]">
                      {t("terminalNative.pricing.recommended")}
                    </div>
                  ) : null}
                  <div className="text-[11px] tracking-[0.08em] text-[var(--a-fg-mute)]">$ {tier.cmd}</div>
                  <div className="mt-2 text-[22px] font-semibold text-[var(--a-fg)]">{t(`terminalNative.pricing.tiers.${tier.key}.name`)}</div>
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "font-semibold leading-none tracking-[-0.04em] text-[var(--a-accent)]",
                        price.length > 5 ? "text-[32px]" : "text-[40px]"
                      )}
                    >
                      {price}
                    </span>
                    <span className="text-sm text-[var(--a-fg-dim)]">{unit}</span>
                    {discount ? (
                      <span className="rounded bg-[rgba(124,242,156,0.08)] px-2 py-1 text-[11px] font-semibold tracking-[0.04em] text-[var(--a-accent)]">
                        {discount}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-4 text-[12.5px] leading-[1.6] text-[var(--a-fg-dim)]">{t(`terminalNative.pricing.tiers.${tier.key}.desc`)}</p>
                  <div className="mt-5 flex-1 space-y-2">
                    {tier.features.map((feature) => {
                      const status = feature.status || "supported";
                      const FeatureIcon = status === "unsupported" ? IconX : IconCheck;
                      const featureLabel = t(`terminalNative.pricing.features.${feature.key}`);

                      return (
                        <div key={feature.key} className={cn("flex items-start gap-2 text-[12.5px]", status === "unsupported" ? "text-[var(--a-fg-dim)]" : "text-[var(--a-fg)]")}>
                          <FeatureIcon
                            className={cn(
                              "mt-[2px] size-3.5 shrink-0",
                              status === "unsupported"
                                ? "text-[var(--a-fg-mute)]"
                                : status === "partial"
                                  ? "text-[var(--a-warn)]"
                                  : "text-[var(--a-accent)]"
                            )}
                          />
                          <div className="min-w-0">
                            {feature.tooltipKey ? (
                              <Tooltip>
                                <span>{featureLabel}</span>
                                <TooltipTrigger className="ml-1 inline-flex align-[-2px] text-[var(--a-fg-mute)] transition-colors hover:text-[var(--a-accent)]">
                                  <IconHelpCircle className="size-3.5" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[320px] text-balance leading-6">
                                  {t(`terminalNative.pricing.tooltips.${feature.tooltipKey}`)}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              featureLabel
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Link
                    to={tier.ctaTo}
                    className={cn(
                      "mt-6 inline-flex w-full items-center justify-center rounded border px-4 py-3 text-sm font-semibold transition-colors",
                      tier.featured
                        ? "border-transparent bg-[var(--a-accent)] text-[var(--a-bg)] hover:bg-[#93f7ae]"
                        : "border-[var(--a-line-2)] text-[var(--a-fg)] hover:bg-[#162019]"
                    )}
                  >
                    {t(`terminalNative.pricing.tiers.${tier.key}.cta`)} →
                  </Link>
                </div>
              );
            })}
          </div>

          <div className="mt-8 grid gap-4 xl:grid-cols-2">
            <div className="rounded-md border border-[var(--a-line)] bg-[var(--a-panel)] p-6">
              <div className="text-[10px] tracking-[0.12em] text-[var(--a-accent)]">▸ EARN</div>
              <div className="mt-2 text-lg font-semibold text-[var(--a-fg)]">{t("terminalNative.pricing.earn.title")}</div>
              <div className="mt-4">
                {earnWays.map((item, index) => (
                  <div
                    key={item.key}
                    className={cn(
                      "flex items-center gap-3 py-3",
                      index > 0 ? "border-t border-[var(--a-line)]" : ""
                    )}
                  >
                    <span className="inline-flex size-6 items-center justify-center rounded bg-[rgba(124,242,156,0.08)] text-[13px] text-[var(--a-accent)]">
                      {item.icon}
                    </span>
                    <span className="flex-1 text-sm font-medium text-[var(--a-fg)]">{t(`terminalNative.pricing.earn.items.${item.key}.label`)}</span>
                    {"valueTo" in item ? (
                      <a href={item.valueTo} className="text-sm font-medium text-[var(--a-accent)] transition-colors hover:text-[var(--a-fg)]">
                        {t(`terminalNative.pricing.earn.items.${item.key}.value`)}
                      </a>
                    ) : (
                      <span className="text-sm font-medium text-[var(--a-accent)]">{t(`terminalNative.pricing.earn.items.${item.key}.value`)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-md border border-[var(--a-line)] bg-[var(--a-panel)] p-6">
              <div className="text-[10px] tracking-[0.12em] text-[var(--a-warn)]">▸ RECHARGE</div>
              <div className="mt-2 text-lg font-semibold text-[var(--a-fg)]">{t("terminalNative.pricing.recharge.title")}</div>
              <div className="mt-4">
                {CREDIT_RECHARGE_PACKAGES.map((item, index) => (
                  <div
                    key={item.labelKey}
                    className={cn(
                      "flex items-center gap-3 py-3",
                      index > 0 ? "border-t border-[var(--a-line)]" : ""
                    )}
                  >
                    <span className="inline-flex size-6 items-center justify-center rounded bg-[rgba(247,185,85,0.08)] text-[13px] text-[var(--a-warn)]">
                      <IconCoins className="size-4" />
                    </span>
                    <span className="flex-1 text-sm font-medium text-[var(--a-fg)]">{t(`terminalNative.pricing.recharge.items.${item.labelKey}.points`)}</span>
                    <span className="rounded bg-[rgba(124,242,156,0.08)] px-2 py-1 text-[11px] tracking-[0.04em] text-[var(--a-accent)]">
                      {t(`terminalNative.pricing.recharge.items.${item.labelKey}.extra`)}
                    </span>
                    <span className="text-base font-semibold text-[var(--a-fg)]">
                      {formatRegionCurrency(getCreditRechargeAmount(pricingRegion, item), pricingRegion)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 grid gap-3 xl:grid-cols-2">
            <a
              href={GITHUB_LINK}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-4 rounded-md border border-[var(--a-line-2)] bg-[var(--a-bg-2)] px-5 py-4 transition-colors hover:bg-[#111814]"
            >
              <span className="w-12 text-[10px] tracking-[0.1em] text-[var(--a-fg-mute)]">$ OSS</span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--a-fg)]">{t("terminalNative.pricing.openSource.title")}</div>
                <div className="mt-1 text-[12px] text-[var(--a-fg-dim)]">{t("terminalNative.pricing.openSource.description")}</div>
              </div>
              <span className="text-sm text-[var(--a-accent)]">→ GitHub</span>
            </a>
            <a
              href={CONSULT_LINK}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-4 rounded-md border border-[var(--a-line-2)] bg-[var(--a-bg-2)] px-5 py-4 transition-colors hover:bg-[#111814]"
            >
              <span className="w-12 text-[10px] tracking-[0.1em] text-[var(--a-fg-mute)]">$ ENT</span>
              <div className="flex-1">
                <div className="text-sm font-semibold text-[var(--a-fg)]">{t("terminalNative.pricing.enterprise.title")}</div>
                <div className="mt-1 text-[12px] text-[var(--a-fg-dim)]">{t("terminalNative.pricing.enterprise.description")}</div>
              </div>
              <span className="text-sm text-[var(--a-accent)]">→ {t("terminalNative.pricing.enterprise.action")}</span>
            </a>
          </div>
        </SectionShell>

        <SectionShell
          id="faq"
          index="08"
          label="FAQ"
          title={t("terminalNative.faq.title")}
          subtitle={t("terminalNative.faq.subtitle")}
        >
          <div className="overflow-hidden rounded-md border border-[var(--a-line)] bg-[var(--a-panel)]">
            {faqKeys.map((itemKey, index) => (
              <div key={itemKey} className={index < faqKeys.length - 1 ? "border-b border-[var(--a-line)]" : ""}>
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === index ? -1 : index)}
                  className="flex w-full items-center gap-4 px-5 py-5 text-left text-sm text-[var(--a-fg)] transition-colors hover:bg-[rgba(124,242,156,0.03)]"
                >
                  <span className="w-4 text-[var(--a-accent)]">{openFaq === index ? "▾" : "▸"}</span>
                  <span className="flex-1">{t(`terminalNative.faq.items.${itemKey}.question`)}</span>
                  <span className="text-[11px] tracking-[0.08em] text-[var(--a-fg-mute)]">Q{String(index + 1).padStart(2, "0")}</span>
                </button>
                {openFaq === index ? (
                  <div className="px-5 pb-5 pl-[52px] text-sm leading-7 text-[var(--a-fg-dim)]">{t(`terminalNative.faq.items.${itemKey}.answer`)}</div>
                ) : null}
              </div>
            ))}
          </div>
        </SectionShell>

        <section className="mx-auto max-w-[1280px] px-5 pb-10 pt-6 text-center sm:px-8 sm:pb-14 sm:pt-10">
          <div className="pointer-events-none absolute left-1/2 h-[280px] w-[600px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(124,242,156,0.15),transparent_70%)] blur-3xl" />
          <div className="relative">
            <div className="text-[11px] tracking-[0.12em] text-[var(--a-accent)]">┌─ START WITH MONKEYCODE ─┐</div>
            <h2 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-[-0.04em] text-white sm:text-5xl lg:text-[56px]">
              {t("terminalNative.finalCta.titlePrefix")}
              <br />
              <span className="text-[var(--a-accent)]">{t("terminalNative.finalCta.titleHighlight")}</span>
            </h2>
            <p className="mx-auto mt-4 max-w-[480px] text-sm leading-8 text-[var(--a-fg-dim)]">
              {t("terminalNative.finalCta.description")}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <HeaderAction to={isLoggedIn ? "/console" : "/login"} primary>
                <IconArrowRight className="size-4" />
                <span>{t("terminalNative.actions.start")}</span>
              </HeaderAction>
              <HeaderAction href={GITHUB_LINK} external>
                <Icon name="GitHub-Uncolor" className="size-4 fill-current" />
                <span>GitHub</span>
              </HeaderAction>
            </div>
          </div>
        </section>
      </main>

      <TerminalFooter />
    </div>
  );
}

function HeroTerminalCard() {
  const { t } = useTranslation();

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-[-20px] bg-[radial-gradient(ellipse_at_center,rgba(124,242,156,0.12),transparent_70%)] blur-3xl" />
      <div className="relative overflow-hidden rounded-xl border border-[var(--a-line-2)] bg-[var(--a-panel)] shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7),0_0_40px_rgba(124,242,156,0.04)]">
        <div className="flex items-center gap-3 border-b border-[var(--a-line)] bg-[var(--a-bg)] px-4 py-3">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[#ff5f56]" />
            <span className="size-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="size-2.5 rounded-full bg-[#27c93f]" />
          </div>
          <div className="text-[9px] text-[var(--a-fg-dim)] sm:text-[10px]">{t("terminalNative.heroTerminal.title")}</div>
          <div className="ml-auto flex items-center gap-2 text-[8.5px] text-[var(--a-accent)]">
            <span className="size-[5px] rounded-full bg-[var(--a-accent)] shadow-[0_0_5px_var(--a-accent)]" />
            LIVE
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_170px]">
          <div className="border-b border-[var(--a-line)] lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-3 border-b border-[var(--a-line)] bg-[var(--a-bg-2)] px-3 py-2 text-[9px]">
              <span className="inline-flex items-center rounded-full border border-[rgba(124,242,156,0.18)] bg-[rgba(124,242,156,0.08)] px-2 py-0.5 leading-none text-[var(--a-accent)]">
                glm-5.1
              </span>
              <div className="flex min-w-0 flex-1 items-center">
                <span className="ml-auto inline-flex size-4 items-center justify-center text-[var(--a-warn)]">
                  <svg viewBox="0 0 20 20" className="size-4 -rotate-90" aria-hidden="true">
                    <circle cx="10" cy="10" r="6" fill="none" stroke="var(--a-line-2)" strokeWidth="2.2" />
                    <circle
                      cx="10"
                      cy="10"
                      r="6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 6}`}
                      strokeDashoffset={`${2 * Math.PI * 6 * (1 - heroContextUsage / 100)}`}
                      className="drop-shadow-[0_0_4px_rgba(124,242,156,0.45)]"
                    />
                  </svg>
                </span>
              </div>
              <span className="leading-none text-[var(--a-fg-dim)]">14.2k tokens</span>
            </div>

            <div className="space-y-4 px-4 py-4">
              <div>
                <div className="text-[10px] leading-6 text-[var(--a-fg)]">{t("terminalNative.heroTerminal.planTitle")}</div>
                <div className="mt-2 space-y-1 text-[9.5px] leading-6 text-[var(--a-fg-dim)]">
                  <div>
                    <span className="text-[var(--a-accent)]">1.</span> {t("terminalNative.heroTerminal.steps.terrain.before")} <span className="text-[var(--a-magenta)]">terrain.ts</span> {t("terminalNative.heroTerminal.steps.terrain.after")}
                  </div>
                  <div>
                    <span className="text-[var(--a-accent)]">2.</span> {t("terminalNative.heroTerminal.steps.chunk.before")} <span className="text-[var(--a-magenta)]">chunk.ts</span> {t("terminalNative.heroTerminal.steps.chunk.after")}
                  </div>
                  <div>
                    <span className="text-[var(--a-accent)]">3.</span> {t("terminalNative.heroTerminal.steps.inventory.before")} <span className="text-[var(--a-magenta)]">inventory.ts</span> {t("terminalNative.heroTerminal.steps.inventory.after")}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 rounded border border-[rgba(124,242,156,0.16)] bg-[rgba(124,242,156,0.04)] px-3 py-2 text-[9px] leading-none text-[var(--a-fg-dim)]">
                  <IconFilePencil className="size-3 shrink-0 text-[var(--a-accent-dim)]" />
                  <span className="inline-flex items-center gap-1 leading-none">
                    <span>{t("terminalNative.heroTerminal.modifiedFile")}</span>
                    <span className="text-[var(--a-fg)]">chunk.ts</span>
                  </span>
                  <span className="ml-auto inline-flex items-center gap-2 text-[8.5px] leading-none">
                    <span className="text-[var(--a-accent)]">+126</span>
                    <span className="text-[var(--a-danger)]">-18</span>
                  </span>
                </div>
                <div className="mt-3 text-[9.5px] leading-6 text-[var(--a-fg-dim)]">
                  {t("terminalNative.heroTerminal.summary")}
                </div>
                <div className="mt-2 space-y-1 text-[9px] leading-5 text-[var(--a-fg-dim)]">
                  {tStringList(t, "terminalNative.heroTerminal.bullets").map((item) => (
                    <div key={item}>• {item}</div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex h-8 min-w-0 flex-1 items-center rounded-[6px] border border-[var(--a-line-2)] bg-[var(--a-panel)] px-3 text-[9px] leading-none text-[var(--a-fg-dim)] ring-1 ring-inset ring-[rgba(124,242,156,0.12)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                  <span className="truncate leading-none text-[var(--a-fg)]">{t("terminalNative.heroTerminal.inputPlaceholder")}</span>
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-[4px] border border-[rgba(124,242,156,0.24)] bg-[rgba(124,242,156,0.1)] px-2.5 text-[8.5px] leading-none text-[var(--a-accent)]"
                >
                  <IconSend className="size-2.5" />
                  <span className="inline-flex items-center leading-none">{t("terminalNative.heroTerminal.send")}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="bg-[var(--a-bg-2)]">
            <div className="py-2">
              {heroFileTree.map((file) => (
                <div
                  key={`${file.name}-${file.indent ?? 0}`}
                  className={cn(
                    "group flex cursor-pointer items-center gap-1.5 border-l-2 px-3 py-1 text-[9.5px] transition-colors",
                    file.active
                      ? "border-[var(--a-accent)] bg-[rgba(124,242,156,0.06)] text-[var(--a-accent)]"
                      : "border-transparent text-[var(--a-fg-dim)] hover:bg-[rgba(124,242,156,0.04)] hover:text-[var(--a-fg)]"
                  )}
                  style={{ paddingLeft: 10 + (file.indent || 0) * 10 }}
                >
                  {file.type === "folder" ? (
                    file.open ? (
                      <IconFolderOpen className="size-3 shrink-0 text-[var(--a-fg-mute)] transition-colors group-hover:text-[var(--a-accent)]" />
                    ) : (
                      <IconFolder className="size-3 shrink-0 text-[var(--a-fg-mute)] transition-colors group-hover:text-[var(--a-accent)]" />
                    )
                  ) : (
                    <IconFile className="size-3 shrink-0 text-[var(--a-fg-mute)] transition-colors group-hover:text-[var(--a-accent)]" />
                  )}
                  <span className="flex-1 truncate">{file.name}</span>
                  {file.dot ? <span className="size-[5px] rounded-full" style={{ background: file.dot }} /> : null}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-[var(--a-line-2)] bg-[var(--a-bg)] px-4 py-3 text-[9.5px] leading-[14px]">
          <PromptLine path="~/app" className="text-[9.5px] leading-[14px]">pnpm add three zustand</PromptLine>
          <div className="pl-1 leading-[14px] text-[var(--a-fg-dim)]">
            + three 0.181.1
            <br />+ zustand 5.1.0
            <br />
            <span className="text-[var(--a-accent)]">✓ 2 packages added in 1.2s</span>
          </div>
          <div>
            <PromptLine path="~/app" className="text-[9.5px] leading-[14px]">
              <BlinkCursor />
            </PromptLine>
          </div>
        </div>
      </div>
    </div>
  );
}
