import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
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
    <TerminalNativePage />
  )
}

export default WelcomePage
