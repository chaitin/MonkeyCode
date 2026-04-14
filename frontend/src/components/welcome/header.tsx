import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { IconMenu2 } from "@tabler/icons-react";
import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from "../ui/drawer";

const Header = () => {

  const { isLoggedIn } = useAuth();
  const [isScrolled, setIsScrolled] = React.useState(false);
  const location = useLocation();
  const isPixelPage =
    location.pathname === "/" ||
    location.pathname.startsWith("/pricing") ||
    location.pathname.startsWith("/points");

  React.useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
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
                  <Link to="/pricing">型号</Link>
                </Button>
                <Button variant="link" className={cn(isPixelPage && "justify-start text-slate-900 no-underline")} asChild>
                  <Link to="/points">积分</Link>
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
            location.pathname.startsWith("/pricing") ? (isPixelPage ? "border-slate-900 bg-amber-100" : "underline decoration-2 underline-offset-8") : "text-foreground"
          )}>
            <Link to="/pricing">型号</Link>
          </Button>
          <Button variant={"link"} className={cn(
            isPixelPage ? "rounded-none border-2 border-transparent text-slate-900 no-underline hover:bg-amber-50" : "",
            location.pathname.startsWith("/points") ? (isPixelPage ? "border-slate-900 bg-amber-100" : "underline decoration-2 underline-offset-8") : "text-foreground"
          )}>
            <Link to="/points">积分</Link>
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
              <Button variant="ghost" className={cn("hidden sm:inline-flex", isPixelPage && "pixel-button border-slate-900 bg-white text-slate-900 hover:bg-amber-50")} asChild><a href={"/api/v1/users/login?redirect=&inviter_id=" + (localStorage.getItem('ic') || '')}>注册</a></Button>
              <Button className={cn(isPixelPage && "pixel-button border-slate-900")} asChild><Link to="/login">立即开始</Link></Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export default Header;
