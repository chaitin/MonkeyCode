#!/usr/bin/env node
/**
 * Windows 打包：默认使用 dir（免 NSIS 下载，适合 WSL/弱 GitHub 网络）。
 * 可选参数会原样传给 electron-builder，例如：
 *   node scripts/pack-win.mjs -- --win portable --x64 --publish never
 */
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

process.env.ELECTRON_MIRROR ||= "https://npmmirror.com/mirrors/electron/"
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||= "https://npmmirror.com/mirrors/electron-builder-binaries/"
process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false"

const eb = path.join(root, "node_modules", ".bin", "electron-builder")
let extra = process.argv.slice(2)
if (extra[0] === "--") extra = extra.slice(1)
const useDefaultDir = extra.length === 0
const args = useDefaultDir ? ["--win", "dir", "--x64", "--publish", "never"] : extra

const r = spawnSync(eb, args, { stdio: "inherit", cwd: root, shell: false })
if ((r.status ?? 1) !== 0) process.exit(r.status ?? 1)

if (useDefaultDir) {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  const ver = pkg.version || "0.0.0"
  const zipName = `MonkeyCode-${ver}-win-x64.zip`
  const releaseDir = path.join(root, "release")
  const z = spawnSync("zip", ["-rq", zipName, "win-unpacked"], {
    stdio: "inherit",
    cwd: releaseDir,
  })
  if ((z.status ?? 1) !== 0) {
    console.error("[pack-win] zip 失败，请手动压缩 release/win-unpacked")
    process.exit(z.status ?? 1)
  }
  console.log(`[pack-win] 已生成 ${path.join(releaseDir, zipName)}`)
}
