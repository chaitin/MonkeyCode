"use strict"
const fs = require("fs")
const path = require("path")
const root = path.join(__dirname, "..")
const from = path.join(root, "..", "frontend", "public", "logo-colored.png")
const to = path.join(root, "electron", "icon.png")
fs.copyFileSync(from, to)
console.log("[sync-icon]", from, "->", to)
