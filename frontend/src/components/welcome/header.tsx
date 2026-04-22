import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { IconArrowLeft, IconMenu2 } from "@tabler/icons-react";
import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "../ui/drawer";

const docsLink = "https://monkeycode.docs.baizhi.cloud/";
const githubLink = "https://github.com/chaitin/MonkeyCode";

const Header = () => {
  const { isLoggedIn } = useAuth();
  const [isScrolled, setIsScrolled] = React.useState(false);
  const location = useLocation();
  const isWelcomePage = location.pathname === "/";
  const isLegalPage = location.pathname === "/privacy-policy" || location.pathname === "/user-agreement";
  const isTerminalPage = isWelcomePage || isLegalPage;
  const isPixelPage = isWelcomePage;
  const inviterId = typeof window !== "undefined" ? localStorage.getItem('ic') || '' : '';
  const signUpLink = "/api/v1/users/login?redirect=&inviter_id=" + inviterId;
  const navItems = isLegalPage
    ? [
        { label: "隐私政策", to: "/privacy-policy" },
        { label: "用户协议", to: "/user-agreement" },
      ]
    : [
        { label: "介绍", to: "/" },
        { label: "广场", to: "/playground" },
      ];
  const activeNav = navItems.find((item) =>
    item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to)
  )?.to;

  React.useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (isTerminalPage) {
    return (
      <header className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6">
        <div
          className={cn(
            "mx-auto flex max-w-[1280px] items-center gap-3 rounded-[22px] border px-3 py-3 text-[#c9d6cc] transition-all duration-300 sm:px-5",
            isScrolled
              ? "border-[#2c3a30] bg-[#0a0d0be6] shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl"
              : "border-[#243329] bg-[#0a0d0bd4] shadow-[0_12px_32px_rgba(0,0,0,0.32)] backdrop-blur-lg"
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <Drawer>
              <DrawerTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 border border-[#243329] bg-[#111814] text-[#c9d6cc] hover:bg-[#162019] hover:text-[#e8efe9] md:hidden"
                >
                  <IconMenu2 className="size-5" />
                </Button>
              </DrawerTrigger>
              <DrawerContent className="border-[#243329] bg-[#0d1210] text-[#c9d6cc]">
                <DrawerHeader className="border-b border-[#1d2a22] text-left">
                  <DrawerTitle className="flex items-center gap-3 text-sm font-medium tracking-[0.18em] text-[#7cf29c]">
                    <img
                      src="/logo-colored.png"
                      className="size-9 rounded-xl border border-[#243329] bg-[#111814] p-1.5"
                      alt="MonkeyCode Logo"
                    />
                    MONKEYCODE
                  </DrawerTitle>
                </DrawerHeader>
                <div className="space-y-5 px-4 py-5">
                  <div className="flex flex-col gap-2">
                    {isLegalPage ? (
                      <Button
                        variant="ghost"
                        className="h-11 justify-start rounded-xl border border-[#1d2a22] px-4 text-sm text-[#a9b7ae] hover:bg-[#162019] hover:text-[#e8efe9]"
                        asChild
                      >
                        <Link to="/">
                          <IconArrowLeft className="size-4" />
                          返回首页
                        </Link>
                      </Button>
                    ) : null}
                    {navItems.map((item) => (
                      <Button
                        key={item.to}
                        variant="ghost"
                        className={cn(
                          "h-11 justify-start rounded-xl border px-4 text-sm text-[#a9b7ae] hover:bg-[#162019] hover:text-[#e8efe9]",
                          activeNav === item.to
                            ? "border-[#35523d] bg-[#131b17] text-[#7cf29c]"
                            : "border-[#1d2a22] bg-transparent"
                        )}
                        asChild
                      >
                        <Link to={item.to}>{item.label}</Link>
                      </Button>
                    ))}
                    <Button variant="ghost" className="h-11 justify-start rounded-xl border border-[#1d2a22] px-4 text-sm text-[#a9b7ae] hover:bg-[#162019] hover:text-[#e8efe9]" asChild>
                      <a href={docsLink} target="_blank" rel="noreferrer">文档</a>
                    </Button>
                    {!isLegalPage ? (
                      <Button variant="ghost" className="h-11 justify-start rounded-xl border border-[#1d2a22] px-4 text-sm text-[#a9b7ae] hover:bg-[#162019] hover:text-[#e8efe9]" asChild>
                        <a href={githubLink} target="_blank" rel="noreferrer">开源仓库</a>
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {!isLoggedIn && (
                      <Button
                        variant="ghost"
                        className="h-11 rounded-xl border border-[#243329] bg-[#111814] text-[#c9d6cc] hover:bg-[#162019] hover:text-[#e8efe9]"
                        asChild
                      >
                        <a href={signUpLink}>注册</a>
                      </Button>
                    )}
                    <Button
                      className="h-11 rounded-xl border border-[#7cf29c]/30 bg-[#7cf29c] text-[#08110a] hover:bg-[#93f7ae]"
                      asChild
                    >
                      <Link to={isLoggedIn ? "/console" : "/login"}>
                        {isLoggedIn ? "进入控制台" : "立即开始"}
                      </Link>
                    </Button>
                  </div>
                </div>
              </DrawerContent>
            </Drawer>

            <Link to="/" className="flex min-w-0 items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-[#243329] bg-[#111814] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <img src="/logo-colored.png" className="size-7" alt="MonkeyCode Logo" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[11px] uppercase tracking-[0.26em] text-[#7cf29c]">Terminal Native</div>
                <div className="truncate text-sm font-medium text-[#e8efe9] sm:text-[15px]">MonkeyCode</div>
              </div>
            </Link>
          </div>

          <nav className="hidden min-w-0 flex-1 items-center justify-center md:flex">
            <div className="flex items-center rounded-full border border-[#1d2a22] bg-[#111814]/85 p-1">
              {isLegalPage ? (
                <Link
                  to="/"
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm text-[#7a8c80] transition-colors hover:text-[#e8efe9]"
                >
                  <IconArrowLeft className="size-4" />
                  返回首页
                </Link>
              ) : null}
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm transition-colors",
                    activeNav === item.to
                      ? "bg-[#162019] text-[#7cf29c]"
                      : "text-[#7a8c80] hover:text-[#e8efe9]"
                  )}
                >
                  {item.label}
                </Link>
              ))}
              <a
                href={docsLink}
                target="_blank"
                rel="noreferrer"
                className="rounded-full px-4 py-2 text-sm text-[#7a8c80] transition-colors hover:text-[#e8efe9]"
              >
                文档
              </a>
              {!isLegalPage ? (
                <a
                  href={githubLink}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full px-4 py-2 text-sm text-[#7a8c80] transition-colors hover:text-[#e8efe9]"
                >
                  开源
                </a>
              ) : null}
            </div>
          </nav>

          <div className="ml-auto hidden items-center gap-3 md:flex">
            {!isLoggedIn && (
              <Button
                variant="ghost"
                className="rounded-full border border-[#243329] bg-[#111814] px-5 text-[#c9d6cc] hover:bg-[#162019] hover:text-[#e8efe9]"
                asChild
              >
                <a href={signUpLink}>注册</a>
              </Button>
            )}

            <Button
              className="rounded-full border border-[#7cf29c]/30 bg-[#7cf29c] px-5 text-[#08110a] shadow-[0_0_24px_rgba(124,242,156,0.24)] hover:bg-[#93f7ae]"
              asChild
            >
              <Link to={isLoggedIn ? "/console" : "/login"}>
                {isLoggedIn ? "进入控制台" : "立即开始"}
              </Link>
            </Button>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className={`fixed top-4 left-0 right-0 z-50 px-4 transition-all duration-300 ${
      isScrolled 
        ? 'translate-y-0'
        : 'translate-y-0'
    }`}>
      <div className={cn(
        "mx-auto flex max-w-[1200px] flex-row justify-between px-4 py-3 transition-all duration-300",
        isPixelPage
          ? "pixel-panel border-slate-900 bg-[#fffdf8]"
          : "rounded-2xl border",
        !isPixelPage && (
          isScrolled
            ? "border-border/80 bg-background/88 shadow-lg shadow-primary/5 backdrop-blur-xl"
            : "border-border/40 bg-background/72 backdrop-blur-md"
        ),
        isPixelPage && (isScrolled ? "bg-[#fffaf0]" : "bg-[#fffdf8]")
      )}>
        <div className="md:hidden flex flex-row items-center gap-2">
          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="ghost" size="icon-sm" className={cn(isPixelPage && "pixel-button border-slate-900 bg-white text-slate-900 hover:bg-amber-50")}>
                <IconMenu2 className="size-5" />
              </Button>
            </DrawerTrigger>
            <DrawerContent className={cn(isPixelPage && "border-2 border-slate-900 bg-[#fffdf8]")}>
              <DrawerHeader>
                <DrawerTitle className={cn(isPixelPage && "font-pixel text-xs text-slate-900")}>MonkeyCode</DrawerTitle>
              </DrawerHeader>
              <div className="flex flex-col gap-2 my-4">
                <Button variant="link" className={cn(isPixelPage && "justify-start text-slate-900 no-underline")} asChild>
                  <Link to="/">介绍</Link>
                </Button>
                <Button variant="link" className={cn(isPixelPage && "justify-start text-slate-900 no-underline")} asChild>
                  <Link to="/playground">广场</Link>
                </Button>
                <Button variant="link" className={cn(isPixelPage && "justify-start text-slate-900 no-underline")} asChild>
                  <Link to="https://monkeycode.docs.baizhi.cloud/" target="_blank">使用文档</Link>
                </Button>
              </div>
            </DrawerContent>
          </Drawer>
          <Link to="/" className={cn("mr-6 flex flex-row items-center gap-3 text-base font-semibold cursor-pointer", isPixelPage && "text-slate-950")}>
            <img src="/logo-colored.png" className={cn("size-8", isPixelPage && "border-2 border-slate-900 bg-white p-1")} alt="MonkeyCode Logo" />
            <span className={cn(isPixelPage ? "font-pixel text-sm tracking-normal sm:text-base" : "text-base")}>MonkeyCode</span>
          </Link>
        </div>
        <div className="hidden md:flex flex-row items-center gap-2">
          <Link to="/" className={cn("mr-6 flex flex-row items-center gap-3 text-base font-semibold cursor-pointer", isPixelPage && "text-slate-950")}>
            <img src="/logo-colored.png" className={cn("size-8", isPixelPage && "border-2 border-slate-900 bg-white p-1")} alt="MonkeyCode Logo" />
            <span className={cn(isPixelPage ? "font-pixel text-sm tracking-normal sm:text-base" : "text-base")}>MonkeyCode</span>
          </Link>
          <Button variant={"link"} className={cn(
            isPixelPage ? "rounded-none border-2 border-transparent text-slate-900 no-underline hover:bg-amber-50" : "",
            location.pathname === "/" ? (isPixelPage ? "border-slate-900 bg-amber-100" : "underline decoration-2 underline-offset-8") : "text-foreground"
          )}>
            <Link to="/">介绍</Link>
          </Button>
          <Button variant={"link"} className={cn(
            isPixelPage ? "rounded-none border-2 border-transparent text-slate-900 no-underline hover:bg-amber-50" : "",
            location.pathname.startsWith("/playground") ? (isPixelPage ? "border-slate-900 bg-amber-100" : "underline decoration-2 underline-offset-8") : "text-foreground"
          )}>
            <Link to="/playground">广场</Link>
          </Button>
          <Button variant={"link"} className={cn(isPixelPage ? "rounded-none border-2 border-transparent text-slate-900 no-underline hover:bg-amber-50" : "text-foreground")}>
            <Link to="https://monkeycode.docs.baizhi.cloud/" target="_blank">使用文档</Link>
          </Button>
        </div>
        <div className="flex flex-row items-center gap-2 sm:gap-3">
          {isLoggedIn ? (
            <Button className={cn(isPixelPage && "pixel-button border-slate-900")} asChild><Link to="/console">控制台</Link></Button>
          ) : (
            <>
              <Button variant="ghost" className={cn("hidden sm:inline-flex", isPixelPage && "pixel-button border-slate-900 bg-white text-slate-900 hover:bg-amber-50")} asChild><a href={signUpLink}>注册</a></Button>
              <Button className={cn(isPixelPage && "pixel-button border-slate-900")} asChild><Link to="/login">立即开始</Link></Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export default Header;
