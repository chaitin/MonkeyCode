import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"

import "./index.css"
import "@/i18n"
import App from "./App.tsx"
import { AnimatedToastProvider } from "@/components/animated-toast-provider"
import { AuthProvider } from "@/components/auth-provider"
import { SkillTagsProvider } from "@/components/skill-tags-provider"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ThemeProvider>
          <AnimatedToastProvider>
            <SkillTagsProvider>
              <TooltipProvider>
                <App />
              </TooltipProvider>
            </SkillTagsProvider>
          </AnimatedToastProvider>
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
