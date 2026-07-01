import { useAppRuntime } from "@/components/app-runtime-provider";
import { cn } from "@/lib/utils";
import { IconArrowRight, IconBrandDiscord, IconMenu2, IconPointFilled } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

const DOCS_LINK = "https://monkeycode.docs.baizhi.cloud/";
const GITHUB_LINK = "https://github.com/chaitin/MonkeyCode/";
const FORUM_LINK = "https://bbs.baizhi.cloud/";
const MODEL_SQUARE_LINK = "https://baizhi.cloud/landing/model-square";
const SHOWCASE_LINK = "https://showcase.monkeycode-ai.online/";
const CHAITIN_LINK = "https://www.chaitin.cn/";
const BAIZHI_LINK = "https://www.baizhi.cloud/";
const DISCORD_INVITE_LINK = "https://discord.gg/8NgHexaaMa";

const resourceLinks = [
  { titleKey: "welcomeShell.footer.productDocs", href: DOCS_LINK },
  { titleKey: "welcomeShell.footer.forum", href: FORUM_LINK },
  { titleKey: "welcomeShell.nav.openSourceRepo", href: GITHUB_LINK },
  { titleKey: "welcomeShell.footer.modelSquare", href: MODEL_SQUARE_LINK },
];

const aboutLinks = [
  { titleKey: "welcomeShell.footer.chaitin", href: CHAITIN_LINK },
  { titleKey: "welcomeShell.footer.baizhi", href: BAIZHI_LINK },
  { titleKey: "welcomeShell.nav.privacyPolicy", href: "/privacy-policy" },
  { titleKey: "welcomeShell.nav.userAgreement", href: "/user-agreement" },
];

const communityCards = [
  { labelKey: "welcomeShell.community.wechat", src: "/wechat.png", altKey: "welcomeShell.community.wechatAlt" },
  { labelKey: "welcomeShell.community.feishu", src: "/feishu.png", altKey: "welcomeShell.community.feishuAlt" },
  { labelKey: "welcomeShell.community.dingtalk", src: "/dingtalk.png", altKey: "welcomeShell.community.dingtalkAlt" },
];

function LogoWordmark({ href }: { href: string }) {
  return (
    <a href={href} className="inline-flex items-center gap-3">
      <img src="/logo-dark.png" alt="MonkeyCode" className="size-10" />
      <span className="text-[17px] font-semibold tracking-[-0.02em] text-white">
        Monkey<span className="text-[var(--a-accent)]">Code</span>
      </span>
    </a>
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

  if (to) return <Link to={to} className={className}>{children}</Link>;

  return (
    <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} className={className}>
      {children}
    </a>
  );
}

function FooterLinkItem({ title, href }: { title: string; href: string }) {
  if (href.startsWith("/")) {
    return (
      <Link to={href} className="block py-1.5 text-sm text-[var(--a-fg-dim)] transition-colors hover:text-[var(--a-fg)]">
        {title}
      </Link>
    );
  }

  return (
    <a href={href} target="_blank" rel="noreferrer" className="block py-1.5 text-sm text-[var(--a-fg-dim)] transition-colors hover:text-[var(--a-fg)]">
      {title}
    </a>
  );
}

export function TerminalHeader({ homeAnchors = true }: { homeAnchors?: boolean }) {
  const { auth, serverConfig } = useAppRuntime();
  const isLoggedIn = auth.status === "authenticated";
  const isGlobalRegion = serverConfig?.region === "global";
  const { t } = useTranslation();
  const [isScrolled, setIsScrolled] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const inviterId = typeof window !== "undefined" ? localStorage.getItem("ic") || "" : "";
  const signUpLink = `/api/v1/users/login?redirect=&inviter_id=${inviterId}`;
  const navPrefix = homeAnchors ? "" : "/";

  const pageNav = [
    { labelKey: "welcomeShell.nav.showcase", href: SHOWCASE_LINK, external: true },
    { labelKey: "welcomeShell.nav.client", href: `${navPrefix}#mobile-client` },
    { labelKey: "welcomeShell.nav.selfHosting", href: `${navPrefix}#self-hosting` },
  ];

  React.useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 4);
    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b border-[var(--a-line)] backdrop-blur-xl transition-colors",
        isScrolled ? "bg-[rgba(10,13,10,0.94)]" : "bg-[rgba(10,13,10,0.85)]"
      )}
    >
      <div className="mx-auto flex max-w-[1280px] items-center gap-5 px-4 py-3 sm:px-8">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className="inline-flex size-10 items-center justify-center rounded-[4px] border border-[var(--a-line-2)] bg-[var(--a-panel)] text-[var(--a-fg)] transition-colors hover:bg-[#162019] md:hidden"
            aria-label={t("welcomeShell.nav.toggleMenu")}
          >
            <IconMenu2 className="size-5" />
          </button>

          <LogoWordmark href={homeAnchors ? "#hero" : "/"} />
        </div>

        <nav className="hidden items-center gap-1 md:flex">
          {pageNav.map((item) =>
            item.external ? (
              <a
                key={item.labelKey}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1.5 text-[13px] text-[var(--a-fg-dim)] transition-colors hover:text-white"
              >
                {t(item.labelKey)}
              </a>
            ) : (
              <a
                key={item.labelKey}
                href={item.href}
                className="px-2.5 py-1.5 text-[13px] text-[var(--a-fg-dim)] transition-colors hover:text-white"
              >
                {t(item.labelKey)}
              </a>
            )
          )}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          {!isGlobalRegion && !isLoggedIn ? (
            <HeaderAction href={signUpLink}>{t("welcomeShell.actions.signUp")}</HeaderAction>
          ) : null}
          {!isLoggedIn ? (
            <HeaderAction to="/login" primary>
              {t("welcomeShell.actions.login")}
            </HeaderAction>
          ) : (
            <HeaderAction to="/console" primary>
              {t("welcomeShell.actions.console")} <IconArrowRight className="size-4" />
            </HeaderAction>
          )}
        </div>

        {menuOpen ? (
          <div className="mt-4 space-y-4 border-t border-[var(--a-line)] pt-4 md:hidden">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-[var(--a-fg-dim)]">
              <IconPointFilled className="size-3 text-[var(--a-accent)]" />
              {t("welcomeShell.terminal.systemOnline")}
            </div>
            <div className="grid gap-2">
              {pageNav.map((item) =>
                item.external ? (
                  <a
                    key={item.labelKey}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className="rounded-[4px] border border-[var(--a-line)] px-4 py-3 text-sm text-[var(--a-fg)] transition-colors hover:bg-[#162019]"
                  >
                    {t(item.labelKey)}
                  </a>
                ) : (
                  <a
                    key={item.labelKey}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className="rounded-[4px] border border-[var(--a-line)] px-4 py-3 text-sm text-[var(--a-fg)] transition-colors hover:bg-[#162019]"
                  >
                    {t(item.labelKey)}
                  </a>
                )
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {!isGlobalRegion && !isLoggedIn ? (
                <HeaderAction href={signUpLink}>{t("welcomeShell.actions.signUp")}</HeaderAction>
              ) : null}
              {!isLoggedIn ? (
                <HeaderAction to="/login" primary>
                  {t("welcomeShell.actions.login")}
                </HeaderAction>
              ) : (
                <HeaderAction to="/console" primary>
                  {t("welcomeShell.actions.console")} <IconArrowRight className="size-4" />
                </HeaderAction>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
}
export function TerminalFooter() {
  const { t } = useTranslation();
  const { serverConfig } = useAppRuntime();
  const isGlobalRegion = serverConfig?.region === "global";

  return (
    <footer id="community" className="relative z-10 mt-10 border-t border-[var(--a-line)] px-5 pb-8 pt-14 sm:px-8">
      <div className="mx-auto max-w-[1280px]">
        <div className="grid gap-10 xl:grid-cols-[1.3fr_0.8fr_0.8fr_1.5fr]">
          <div>
            <LogoWordmark href="/#hero" />
            <p className="mt-5 max-w-[320px] text-sm leading-7 text-[var(--a-fg-dim)]">
              {t("welcomeShell.footer.description")}
            </p>
          </div>

          <div>
            <div className="mb-4 text-[11px] font-semibold tracking-[0.08em] text-[var(--a-fg)]"># {t("welcomeShell.footer.resources")}</div>
            {resourceLinks.map((item) => (
              <FooterLinkItem key={item.titleKey} title={t(item.titleKey)} href={item.href} />
            ))}
          </div>

          <div>
            <div className="mb-4 text-[11px] font-semibold tracking-[0.08em] text-[var(--a-fg)]"># {t("welcomeShell.footer.about")}</div>
            {aboutLinks.map((item) => (
              <FooterLinkItem key={item.titleKey} title={t(item.titleKey)} href={item.href} />
            ))}
          </div>

          <div>
            <div className="mb-4 text-[11px] font-semibold tracking-[0.08em] text-[var(--a-fg)]"># {t("welcomeShell.footer.community")}</div>
            {isGlobalRegion ? (
              <a
                href={DISCORD_INVITE_LINK}
                target="_blank"
                rel="noreferrer"
                className="group flex min-h-[104px] items-center gap-4 rounded-[4px] border border-[var(--a-line-2)] bg-[var(--a-panel)] p-4 transition-colors hover:border-[rgba(124,242,156,0.35)] hover:bg-[#162019]"
              >
                <span className="flex size-12 shrink-0 items-center justify-center rounded-[4px] border border-[var(--a-line-2)] bg-[rgba(124,242,156,0.08)] text-[var(--a-accent)]">
                  <IconBrandDiscord className="size-6" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[var(--a-fg)]">{t("welcomeShell.community.discord")}</span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--a-fg-dim)] group-hover:text-[var(--a-fg)]">
                    {t("welcomeShell.community.discordDescription")}
                  </span>
                </span>
              </a>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                {communityCards.map((item) => (
                  <div key={item.labelKey} className="text-center">
                    <img src={item.src} alt={t(item.altKey)} className="mx-auto aspect-square w-full rounded-sm object-cover" />
                    <div className="mt-2 text-[11px] tracking-[0.04em] text-[var(--a-fg-dim)]">{t(item.labelKey)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-dashed border-[var(--a-line-2)] pt-5 text-[11px] tracking-[0.06em] text-[var(--a-fg-mute)] sm:flex-row sm:items-center sm:justify-between">
          <span>{t("welcomeShell.footer.copyright")}</span>
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer" className="transition-colors hover:text-[var(--a-fg)]">
            {t("welcomeShell.footer.icp")}
          </a>
        </div>
      </div>
    </footer>
  );
}
