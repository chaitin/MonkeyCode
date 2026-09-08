import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": process.env.MONKEYAI_DEV_BACKEND_URL ?? "http://localhost:8080",
      "/oauth": process.env.MONKEYAI_DEV_BACKEND_URL ?? "http://localhost:8080",
      "/mcp": process.env.MONKEYAI_DEV_BACKEND_URL ?? "http://localhost:8080",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
})
