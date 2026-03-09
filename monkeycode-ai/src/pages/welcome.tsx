import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import Header from "@/components/welcome/header"
import Banner from "@/components/welcome/banner"
import Task from "@/components/welcome/task";
import Footer from "@/components/welcome/footer";
import Numbers from "@/components/welcome/numbers";
import Pricing from "@/components/welcome/pricing";
import GitBot from "@/components/welcome/git-bot";
import SDD from "@/components/welcome/sdd";
import { AuthProvider } from "@/components/auth-provider";

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
      <div className="flex flex-col">
        <Header />
        <main className="flex flex-col w-full">
          <Banner />
          <Numbers />
          <Task />
          <SDD />
          <GitBot />
          {/* <IDE /> */}
          <Pricing />
        </main>
        <Footer />
      </div>
    </AuthProvider>
  )
}

export default WelcomePage


