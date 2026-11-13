import "@/lib/browser-compat"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter, RouterProvider } from "react-router-dom"

import "./index.css"
import "@/i18n"
import App from "./App.tsx"
import { AnimatedToastProvider } from "@/components/animated-toast-provider"
import { BrandingProvider } from "@/components/branding-provider"
import { AuthProvider } from "@/components/auth-provider"
import { SkillTagsProvider } from "@/components/skill-tags-provider"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { TooltipProvider } from "@/components/ui/tooltip"

function Application() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <BrandingProvider>
          <AnimatedToastProvider>
            <SkillTagsProvider>
              <TooltipProvider>
                <App />
              </TooltipProvider>
            </SkillTagsProvider>
          </AnimatedToastProvider>
        </BrandingProvider>
      </ThemeProvider>
    </AuthProvider>
  )
}

const router = createBrowserRouter([{ path: "*", element: <Application /> }])

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
