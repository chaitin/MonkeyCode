import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { IconArrowRight, IconMenu2, IconPointFilled } from "@tabler/icons-react";
import React from "react";
import { Link } from "react-router-dom";

const DOCS_LINK = "https://monkeycode.docs.baizhi.cloud/";
const GITHUB_LINK = "https://github.com/chaitin/MonkeyCode/";
const FORUM_LINK = "https://bbs.baizhi.cloud/";
const MODEL_SQUARE_LINK = "https://baizhi.cloud/landing/model-square";
const CHAITIN_LINK = "https://www.chaitin.cn/";
const BAIZHI_LINK = "https://www.baizhi.cloud/";

const resourceLinks = [
  { title: "产品文档", href: DOCS_LINK },
  { title: "技术论坛", href: FORUM_LINK },
  { title: "开源仓库", href: GITHUB_LINK },
  { title: "模型广场", href: MODEL_SQUARE_LINK },
];

const aboutLinks = [
  { title: "长亭科技", href: CHAITIN_LINK },
  { title: "长亭百智云", href: BAIZHI_LINK },
  { title: "隐私政策", href: "/privacy-policy" },
  { title: "用户协议", href: "/user-agreement" },
];

const communityCards = [
  { label: "微信群", src: "/wechat.png", alt: "微信二维码" },
  { label: "飞书群", src: "/feishu.png", alt: "飞书群二维码" },
  { label: "钉钉群", src: "/dingtalk.png", alt: "钉钉群二维码" },
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
  const { isLoggedIn } = useAuth();
  const [isScrolled, setIsScrolled] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const inviterId = typeof window !== "undefined" ? localStorage.getItem("ic") || "" : "";
  const signUpLink = `/api/v1/users/login?redirect=&inviter_id=${inviterId}`;
  const navPrefix = homeAnchors ? "" : "/";

  const pageNav = [
    { label: "介绍", href: `${navPrefix}#hero` },
    { label: "特色", href: `${navPrefix}#features` },
    { label: "场景", href: `${navPrefix}#usecases` },
    { label: "套餐", href: `${navPrefix}#pricing` },
    { label: "文档", href: DOCS_LINK, external: true },
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
            aria-label="切换导航菜单"
          >
            <IconMenu2 className="size-5" />
          </button>

          <LogoWordmark href={homeAnchors ? "#hero" : "/"} />
        </div>

        <nav className="hidden items-center gap-1 md:flex">
          {pageNav.map((item) =>
            item.external ? (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1.5 text-[13px] text-[var(--a-fg-dim)] transition-colors hover:text-white"
              >
                {item.label}
              </a>
            ) : (
              <a
                key={item.label}
                href={item.href}
                className="px-2.5 py-1.5 text-[13px] text-[var(--a-fg-dim)] transition-colors hover:text-white"
              >
                {item.label}
              </a>
            )
          )}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          {!isLoggedIn ? (
            <>
              <HeaderAction href={signUpLink}>注册</HeaderAction>
              <HeaderAction to="/login" primary>
                登录
              </HeaderAction>
            </>
          ) : (
            <HeaderAction to="/console" primary>
              进入控制台 <IconArrowRight className="size-4" />
            </HeaderAction>
          )}
        </div>

        {menuOpen ? (
          <div className="mt-4 space-y-4 border-t border-[var(--a-line)] pt-4 md:hidden">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-[var(--a-fg-dim)]">
              <IconPointFilled className="size-3 text-[var(--a-accent)]" />
              System Online
            </div>
            <div className="grid gap-2">
              {pageNav.map((item) =>
                item.external ? (
                  <a
                    key={item.label}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className="rounded-[4px] border border-[var(--a-line)] px-4 py-3 text-sm text-[var(--a-fg)] transition-colors hover:bg-[#162019]"
                  >
                    {item.label}
                  </a>
                ) : (
                  <a
                    key={item.label}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className="rounded-[4px] border border-[var(--a-line)] px-4 py-3 text-sm text-[var(--a-fg)] transition-colors hover:bg-[#162019]"
                  >
                    {item.label}
                  </a>
                )
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {!isLoggedIn ? (
                <>
                  <HeaderAction href={signUpLink}>注册</HeaderAction>
                  <HeaderAction to="/login" primary>
                    登录
                  </HeaderAction>
                </>
              ) : (
                <HeaderAction to="/console" primary>
                  进入控制台 <IconArrowRight className="size-4" />
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
  return (
    <footer id="community" className="relative z-10 mt-10 border-t border-[var(--a-line)] px-5 pb-8 pt-14 sm:px-8">
      <div className="mx-auto max-w-[1280px]">
        <div className="grid gap-10 xl:grid-cols-[1.3fr_0.8fr_0.8fr_1.5fr]">
          <div>
            <LogoWordmark href="/#hero" />
            <p className="mt-5 max-w-[320px] text-sm leading-7 text-[var(--a-fg-dim)]">
              免费使用，无需安装，内置云端开发环境，并支持业内最全的顶尖大模型。无论是开发项目、做调研、写文档，还是分析数据、处理任务，打开浏览器就能随时开始，让 AI 持续帮你推进工作。
            </p>
          </div>

          <div>
            <div className="mb-4 text-[11px] font-semibold tracking-[0.08em] text-[var(--a-fg)]"># 资源</div>
            {resourceLinks.map((item) => (
              <FooterLinkItem key={item.title} title={item.title} href={item.href} />
            ))}
          </div>

          <div>
            <div className="mb-4 text-[11px] font-semibold tracking-[0.08em] text-[var(--a-fg)]"># 关于我们</div>
            {aboutLinks.map((item) => (
              <FooterLinkItem key={item.title} title={item.title} href={item.href} />
            ))}
          </div>

          <div>
            <div className="mb-4 text-[11px] font-semibold tracking-[0.08em] text-[var(--a-fg)]"># 技术交流群</div>
            <div className="grid gap-4 sm:grid-cols-3">
              {communityCards.map((item) => (
                <div key={item.label} className="text-center">
                  <img src={item.src} alt={item.alt} className="mx-auto aspect-square w-full rounded-sm object-cover" />
                  <div className="mt-2 text-[11px] tracking-[0.04em] text-[var(--a-fg-dim)]">{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-dashed border-[var(--a-line-2)] pt-5 text-[11px] tracking-[0.06em] text-[var(--a-fg-mute)] sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 MonkeyCode · 版权所有：北京长亭科技有限公司 · 本应用由 MonkeyCode 开发</span>
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer" className="transition-colors hover:text-[var(--a-fg)]">
            京ICP备2024055124号-12
          </a>
        </div>
      </div>
    </footer>
  );
}
