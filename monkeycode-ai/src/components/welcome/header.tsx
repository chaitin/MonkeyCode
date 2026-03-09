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

  React.useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 px-4 ${
      isScrolled 
        ? 'backdrop-blur-md bg-background/60 shadow-sm' 
        : 'bg-transparent'
    }`}>
      <div className="flex flex-row justify-between mx-auto max-w-[1200px] py-4">
        <div className="md:hidden flex flex-row items-center gap-2">
          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <IconMenu2 className="size-5" />
              </Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>MonkeyCode</DrawerTitle>
              </DrawerHeader>
              <div className="flex flex-col gap-2 my-4">
                <Button variant="link" asChild>
                  <Link to="/">产品介绍</Link>
                </Button>
                <Button variant="link" asChild>
                  <Link to="/playground">广场</Link>
                </Button>
                <Button variant="link" asChild>
                  <Link to="https://monkeycode.docs.baizhi.cloud/" target="_blank">使用文档</Link>
                </Button>
              </div>
            </DrawerContent>
          </Drawer>
          <Link to="/" className="flex flex-row items-center gap-2 text-xl mr-6 cursor-pointer">
            <img src="/logo-colored.png" className="size-8" />
            MonkeyCode
          </Link>
        </div>
        <div className="hidden md:flex flex-row items-center gap-2">
          <Link to="/" className="flex flex-row items-center gap-2 text-xl mr-6 cursor-pointer">
            <img src="/logo-colored.png" className="size-8" />
            MonkeyCode
          </Link>
          <Button variant={"link"} className={cn(location.pathname === "/" ? "underline decoration-2" : "text-foreground")}>
            <Link to="/">产品介绍</Link>
          </Button>
          <Button variant={"link"} className={cn(location.pathname.startsWith("/playground") ? "underline decoration-2" : "text-foreground")}>
            <Link to="/playground">广场</Link>
          </Button>
          <Button variant={"link"} className="text-foreground">
            <Link to="https://monkeycode.docs.baizhi.cloud/" target="_blank">使用文档</Link>
          </Button>
        </div>
        <div className="flex flex-row items-center gap-4">
          {isLoggedIn ? (
            <Button asChild><Link to="/console">控制台</Link></Button>
          ) : (
            <>
              <Button variant="secondary" asChild><a href={"/api/v1/users/login?redirect=&inviter_id=" + (localStorage.getItem('ic') || '')}>注册</a></Button>
              <Button asChild><Link to="/login">登录</Link></Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export default Header;