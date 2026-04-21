import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { AuthProvider } from "@/components/auth-provider";
import TerminalNativePage from "@/components/welcome/terminal-native-page";

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
      <TerminalNativePage />
    </AuthProvider>
  )
}

export default WelcomePage
