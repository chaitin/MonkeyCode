import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

const outputDirectory = process.argv[2] ?? "dist"
const assetsDirectory = join(outputDirectory, "assets")
const assetNames = await readdir(assetsDirectory)
const cssNames = assetNames.filter((name) => name.endsWith(".css"))

if (cssNames.length === 0) {
  throw new Error("Chrome 85 build contains no CSS assets")
}
if (!cssNames.every((name) => /\.chrome85-[a-f0-9]{12}\.css$/.test(name))) {
  throw new Error("Chrome 85 CSS assets are missing final-content fingerprints")
}

const css = (
  await Promise.all(
    cssNames.map((name) => readFile(join(assetsDirectory, name), "utf8"))
  )
).join("\n")

const unsupportedCss = [
  ["@layer", "cascade layers"],
  ["calc(var(--spacing)", "Tailwind spacing multiplication"],
]
for (const [token, label] of unsupportedCss) {
  if (css.includes(token)) {
    throw new Error(`Chrome 85 CSS still contains ${label}`)
  }
}
if (/[;{](?:translate|rotate|scale):/.test(css)) {
  throw new Error("Chrome 85 CSS still contains individual transforms")
}

const html = await readFile(join(outputDirectory, "index.html"), "utf8")
if ((html.match(/data-chrome85-polyfills/g) ?? []).length !== 1) {
  throw new Error("Chrome 85 polyfills must be injected exactly once")
}

const entryMatch = html.match(
  /(?:\.\/|\/)assets\/([^"']+\.chrome85-[a-f0-9]{12}\.js)/
)
if (!entryMatch) {
  throw new Error("Chrome 85 entry asset fingerprint is missing")
}
if (!assetNames.includes(entryMatch[1])) {
  throw new Error(`Chrome 85 entry asset does not exist: ${entryMatch[1]}`)
}

console.log(
  `Chrome 85 dist check passed for ${cssNames.length} CSS assets and entry ${entryMatch[1]}.`
)
