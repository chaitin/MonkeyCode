"use strict"

/** CI / 无桌面需求时设为 1，可跳过 Chromium 下载 */
if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD === "1") {
  process.exit(0)
}

const { execSync } = require("child_process")
const fs = require("fs")
const path = require("path")

const installScript = path.join(__dirname, "..", "node_modules", "electron", "install.js")
if (fs.existsSync(installScript)) {
  execSync(`node "${installScript}"`, { stdio: "inherit" })
}
