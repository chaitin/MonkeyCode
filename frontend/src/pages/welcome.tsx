import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import Header from "@/components/welcome/header"
import Banner from "@/components/welcome/banner"
import Highlights from "@/components/welcome/highlights"
import Task from "@/components/welcome/task";
import Footer from "@/components/welcome/footer";
import GitBot from "@/components/welcome/git-bot";
import SDD from "@/components/welcome/sdd";
import FinalCTA from "@/components/welcome/final-cta";
import { AuthProvider } from "@/components/auth-provider";
import "@/styles/welcome-pixel.css";

const WelcomePage = () => {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const ic = searchParams.get("ic");
    if (ic) {
      localStorage.setItem("ic", ic);
    }
  }, [searchParams]);

  return (
    <AuthProvider>
      <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,#fff7ed_0%,#fffdf8_28%,#ffffff_60%)]">
        <Header />
        <main className="flex w-full flex-col">
          <Banner />
          <Highlights />
          <Task />
          <SDD />
          <GitBot />
          <FinalCTA />
        </main>
        <Footer />
      </div>
    </AuthProvider>
  )
}

export default WelcomePage
