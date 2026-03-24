#!/usr/bin/env node
/**
 * 将 frontend 的 Vite 构建结果复制到 desktop/web-dist，供 electron-builder.full 打入安装包。
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const src = path.join(root, "..", "frontend", "dist")
const dest = path.join(root, "web-dist")

if (!existsSync(path.join(src, "index.html"))) {
  console.error("[sync-web-dist] 缺少 ../frontend/dist/index.html，请先执行：pnpm electron:build:dist")
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log(`[sync-web-dist] 已同步 ${src} -> ${dest}`)
