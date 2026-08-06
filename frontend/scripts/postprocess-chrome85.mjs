import { readFile, readdir, rename, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const tailwindViteDirectory = dirname(require.resolve("@tailwindcss/vite"))
const tailwindNodeEntry = require.resolve("@tailwindcss/node", {
  paths: [tailwindViteDirectory],
})
const lightningCssEntry = require.resolve("lightningcss", {
  paths: [dirname(tailwindNodeEntry)],
})
const { transform, Features } = await import(lightningCssEntry)

const outputDirectory = process.argv[2] ?? "dist"
const assetsDirectory = join(outputDirectory, "assets")
let processedCssFiles = 0
let patchedCaptchaWorkers = 0
let patchedCaptchaFallbacks = 0
let patchedAdoptedStyleSheets = 0
let expandedSpacingValues = 0
let expandedIndividualTransforms = 0
let remainingHasSelectors = 0
const cssAssetRenames = []
let captchaAssetRename

function readQuoted(css, start) {
  const quote = css[start]
  let index = start + 1
  while (index < css.length) {
    if (css[index] === "\\") {
      index += 2
    } else if (css[index] === quote) {
      return index + 1
    } else {
      index += 1
    }
  }
  return index
}

function readComment(css, start) {
  const end = css.indexOf("*/", start + 2)
  return end === -1 ? css.length : end + 2
}

function findClosingBrace(css, openingBrace) {
  let depth = 1
  let parentheses = 0
  let index = openingBrace + 1
  while (index < css.length) {
    if (css.startsWith("/*", index)) {
      index = readComment(css, index)
    } else if (css[index] === '"' || css[index] === "'") {
      index = readQuoted(css, index)
    } else if (css[index] === "\\") {
      index += 2
    } else if (css[index] === "(") {
      parentheses += 1
      index += 1
    } else if (css[index] === ")") {
      parentheses -= 1
      index += 1
    } else if (parentheses === 0 && css[index] === "{") {
      depth += 1
      index += 1
    } else if (parentheses === 0 && css[index] === "}") {
      depth -= 1
      if (depth === 0) return index
      index += 1
    } else {
      index += 1
    }
  }
  throw new Error("Unclosed @layer block")
}

function findLayerBoundary(css, start) {
  let parentheses = 0
  let index = start
  while (index < css.length) {
    if (css.startsWith("/*", index)) {
      index = readComment(css, index)
    } else if (css[index] === '"' || css[index] === "'") {
      index = readQuoted(css, index)
    } else if (css[index] === "\\") {
      index += 2
    } else if (css[index] === "(") {
      parentheses += 1
      index += 1
    } else if (css[index] === ")") {
      parentheses -= 1
      index += 1
    } else if (parentheses === 0 && (css[index] === ";" || css[index] === "{")) {
      return index
    } else {
      index += 1
    }
  }
  throw new Error("Invalid @layer rule")
}

function flattenCascadeLayers(css) {
  let output = ""
  let index = 0
  while (index < css.length) {
    if (css.startsWith("/*", index)) {
      const end = readComment(css, index)
      output += css.slice(index, end)
      index = end
    } else if (css[index] === '"' || css[index] === "'") {
      const end = readQuoted(css, index)
      output += css.slice(index, end)
      index = end
    } else if (
      css.startsWith("@layer", index) &&
      !/[\w-]/.test(css[index + "@layer".length] ?? "")
    ) {
      const boundary = findLayerBoundary(css, index + "@layer".length)
      if (css[boundary] === ";") {
        index = boundary + 1
      } else {
        const closingBrace = findClosingBrace(css, boundary)
        output += flattenCascadeLayers(css.slice(boundary + 1, closingBrace))
        index = closingBrace + 1
      }
    } else {
      output += css[index]
      index += 1
    }
  }
  return output
}

function expandTailwindSpacing(css, file) {
  const spacingCalculations =
    /calc\(var\(--spacing\)\s*\*\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\)/g
  if (!spacingCalculations.test(css)) return css

  const spacingDefinition = css.match(
    /--spacing:\s*(-?(?:\d+(?:\.\d+)?|\.\d+))([a-z%]+)/i
  )
  if (!spacingDefinition) {
    throw new Error(`Unable to resolve Tailwind --spacing value: ${file}`)
  }

  const spacing = Number(spacingDefinition[1])
  const unit = spacingDefinition[2]
  return css.replace(spacingCalculations, (_, multiplier) => {
    expandedSpacingValues += 1
    const value = Number((spacing * Number(multiplier)).toFixed(8))
    return `${value}${unit}`
  })
}

function expandIndividualTransforms(css) {
  const legacyTransform =
    "transform:translate(var(--tw-translate-x,0),var(--tw-translate-y,0)) rotate(var(--chrome85-rotate,0deg)) scale(var(--tw-scale-x,1),var(--tw-scale-y,1))"

  return css
    .replace(
      /translate:\s*var\(--tw-translate-x\)\s+var\(--tw-translate-y\)/g,
      () => {
        expandedIndividualTransforms += 1
        return legacyTransform
      }
    )
    .replace(/rotate:\s*(-?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|rad|turn))/g, (_, value) => {
      expandedIndividualTransforms += 1
      return `--chrome85-rotate:${value};${legacyTransform}`
    })
    .replace(
      /scale:\s*var\(--tw-scale-x\)\s+var\(--tw-scale-y\)/g,
      () => {
        expandedIndividualTransforms += 1
        return legacyTransform
      }
    )
}

const assetNames = await readdir(assetsDirectory)
for (const name of assetNames.filter((name) => name.endsWith(".css"))) {
  const file = join(assetsDirectory, name)
  const alreadyProcessed = /\.chrome85-[a-f0-9]{12}\.css$/.test(name)
  let output = await readFile(file, "utf8")
  if (!alreadyProcessed) {
    const source = expandIndividualTransforms(
      expandTailwindSpacing(flattenCascadeLayers(output), file)
    )
    const { code } = transform({
      filename: file,
      code: Buffer.from(source),
      minify: true,
      targets: {
        chrome: 85 << 16,
      },
      include:
        Features.Colors |
        Features.DirSelector |
        Features.LogicalProperties |
        Features.MediaQueries |
        Features.Nesting,
    })
    output = code.toString()
    await writeFile(file, output)
  }
  if (output.includes("@layer")) {
    throw new Error(`Chrome 85 CSS still contains @layer: ${file}`)
  }
  if (output.includes("calc(var(--spacing)")) {
    throw new Error(`Chrome 85 CSS still contains spacing multiplication: ${file}`)
  }
  if (/[;{](?:translate|rotate|scale):/.test(output)) {
    throw new Error(`Chrome 85 CSS still contains individual transforms: ${file}`)
  }
  remainingHasSelectors += output.match(/:has\(/g)?.length ?? 0
  const fingerprint = createHash("sha256").update(output).digest("hex").slice(0, 12)
  const baseName = name.replace(/\.chrome85-[a-f0-9]{12}\.css$/, ".css")
  const fingerprintedName = baseName.replace(
    /\.css$/,
    `.chrome85-${fingerprint}.css`
  )
  if (name !== fingerprintedName) {
    await rename(file, join(assetsDirectory, fingerprintedName))
  }
  cssAssetRenames.push({ from: name, to: fingerprintedName })
  processedCssFiles += 1
}

const captchaWorkerBug = "let a;if(t===n||(t=n,await import(n)"
const captchaWorkerFix =
  "let a;if(t===n&&!r)return e({salt:o,target:s});if(t===n||(t=n,await import(n)"
const captchaFallbackBug =
  'const o=new TextEncoder,s=new Uint8Array(t.length/2);for(let e=0;e<s.length;e++)s[e]=parseInt(t.substring(2*e,2*e+2),16);const n=s.length;for(;;)try{for(let t=0;t<5e4;t++){const t=e+r,a=o.encode(t),l=await crypto.subtle.digest("SHA-256",a),c=new Uint8Array(l,0,n);let f=!0;for(let e=0;e<n;e++)if(c[e]!==s[e]){f=!1;break}'
const captchaFallbackLegacyFix =
  'const o=new TextEncoder,s=t.length;for(;;)try{for(let t=0;t<5e4;t++){const t=e+r,a=o.encode(t),l=await crypto.subtle.digest("SHA-256",a),c=new Uint8Array(l);let f=!0;for(let e=0;e<s;e++){const n=e&1?15&c[e>>1]:c[e>>1]>>4;if(n!==parseInt(t[e],16)){f=!1;break}}'
const captchaFallbackFix =
  'const o=new TextEncoder,s=Array.from(t,e=>parseInt(e,16));for(;;)try{for(let t=0;t<5e4;t++){const t=e+r,a=o.encode(t),l=await crypto.subtle.digest("SHA-256",a),c=new Uint8Array(l);let f=!0;for(let e=0;e<s.length;e++){const n=e&1?15&c[e>>1]:c[e>>1]>>4;if(n!==s[e]){f=!1;break}}'
const adoptedStyleSheetsBug =
  "e.adoptedStyleSheets&&e.adoptedStyleSheets.push(r)"
const adoptedStyleSheetsFix =
  "e.adoptedStyleSheets&&(e.adoptedStyleSheets=e.adoptedStyleSheets.concat(r))"

for (const name of assetNames.filter((name) => name.endsWith(".js"))) {
  const file = join(assetsDirectory, name)
  const source = await readFile(file, "utf8")
  let output = cssAssetRenames.reduce(
    (content, asset) => content.replaceAll(asset.from, asset.to),
    source
  )
  const matches = output.split(captchaWorkerBug).length - 1
  const fixedMatches = output.split(captchaWorkerFix).length - 1
  if (matches === 0 && fixedMatches === 0) {
    if (output !== source) {
      throw new Error(`CSS asset reference found outside the entry chunk: ${file}`)
    }
    continue
  }
  if (matches === 0 && fixedMatches === 1) {
    patchedCaptchaWorkers += 1
  } else if (matches === 1 && fixedMatches === 0) {
    output = output.replace(captchaWorkerBug, captchaWorkerFix)
    patchedCaptchaWorkers += 1
  } else {
    throw new Error(`Unexpected CAPTCHA worker match count (${matches}): ${file}`)
  }

  const fallbackMatches = output.split(captchaFallbackBug).length - 1
  const legacyFallbackMatches = output.split(captchaFallbackLegacyFix).length - 1
  const fixedFallbackMatches = output.split(captchaFallbackFix).length - 1
  if (
    fallbackMatches === 0 &&
    legacyFallbackMatches === 0 &&
    fixedFallbackMatches === 1
  ) {
    patchedCaptchaFallbacks += 1
  } else if (
    fallbackMatches + legacyFallbackMatches === 1 &&
    fixedFallbackMatches === 0
  ) {
    output = output
      .replace(captchaFallbackBug, captchaFallbackFix)
      .replace(captchaFallbackLegacyFix, captchaFallbackFix)
    patchedCaptchaFallbacks += 1
  } else {
    throw new Error(
      `Unexpected CAPTCHA fallback match counts (${fallbackMatches}/${legacyFallbackMatches}/${fixedFallbackMatches}): ${file}`
    )
  }

  const adoptedStyleSheetsMatches =
    output.split(adoptedStyleSheetsBug).length - 1
  const fixedAdoptedStyleSheetsMatches =
    output.split(adoptedStyleSheetsFix).length - 1
  if (adoptedStyleSheetsMatches === 0 && fixedAdoptedStyleSheetsMatches === 1) {
    patchedAdoptedStyleSheets += 1
  } else if (
    adoptedStyleSheetsMatches === 1 &&
    fixedAdoptedStyleSheetsMatches === 0
  ) {
    output = output.replace(adoptedStyleSheetsBug, adoptedStyleSheetsFix)
    patchedAdoptedStyleSheets += 1
  } else {
    throw new Error(
      `Unexpected adoptedStyleSheets match counts (${adoptedStyleSheetsMatches}/${fixedAdoptedStyleSheetsMatches}): ${file}`
    )
  }

  if (output !== source) await writeFile(file, output)

  const fingerprint = createHash("sha256").update(output).digest("hex").slice(0, 12)
  const baseName = name.replace(/\.chrome85-[a-f0-9]{12}\.js$/, ".js")
  const fingerprintedName = baseName.replace(/\.js$/, `.chrome85-${fingerprint}.js`)
  if (name !== fingerprintedName) {
    await rename(file, join(assetsDirectory, fingerprintedName))
  }
  captchaAssetRename = { from: name, to: fingerprintedName }
}

if (patchedCaptchaWorkers !== 1) {
  throw new Error(
    `Expected to patch one CAPTCHA worker, patched ${patchedCaptchaWorkers}`
  )
}
if (patchedCaptchaFallbacks !== 1) {
  throw new Error(
    `Expected to patch one CAPTCHA fallback, patched ${patchedCaptchaFallbacks}`
  )
}
if (patchedAdoptedStyleSheets !== 1) {
  throw new Error(
    `Expected to patch one adoptedStyleSheets call, patched ${patchedAdoptedStyleSheets}`
  )
}

const polyfills = `<script data-chrome85-polyfills>
if (!URL.canParse) {
  URL.canParse = function (url, base) {
    try {
      new URL(url, base);
      return true;
    } catch (_) {
      return false;
    }
  };
}
if (!Object.hasOwn) {
  Object.hasOwn = function (object, property) {
    return Object.prototype.hasOwnProperty.call(object, property);
  };
}
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, "at", {
    configurable: true,
    writable: true,
    value: function (index) {
      var length = this.length >>> 0;
      var relativeIndex = Math.trunc(index) || 0;
      var resolvedIndex = relativeIndex < 0 ? length + relativeIndex : relativeIndex;
      return resolvedIndex >= 0 && resolvedIndex < length ? this[resolvedIndex] : undefined;
    }
  });
}
if (!globalThis.structuredClone) {
  globalThis.structuredClone = function (value) {
    var seen = new Map();
    function clone(input) {
      if (input === null || typeof input !== "object") return input;
      if (seen.has(input)) return seen.get(input);
      if (input instanceof Date) return new Date(input.getTime());
      if (input instanceof RegExp) return new RegExp(input.source, input.flags);
      if (input instanceof ArrayBuffer) return input.slice(0);
      if (ArrayBuffer.isView(input)) {
        return new input.constructor(clone(input.buffer), input.byteOffset, input.length);
      }
      var output = Array.isArray(input)
        ? []
        : input instanceof Map
          ? new Map()
          : input instanceof Set
            ? new Set()
            : {};
      seen.set(input, output);
      if (input instanceof Map) {
        input.forEach(function (item, key) { output.set(clone(key), clone(item)); });
      } else if (input instanceof Set) {
        input.forEach(function (item) { output.add(clone(item)); });
      } else {
        Object.keys(input).forEach(function (key) { output[key] = clone(input[key]); });
      }
      return output;
    }
    return clone(value);
  };
}
if (!Object.groupBy) {
  Object.groupBy = function (items, callback) {
    var result = Object.create(null);
    var index = 0;
    for (var item of items) {
      var key = callback(item, index++);
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        result[key].push(item);
      } else {
        result[key] = [item];
      }
    }
    return result;
  };
}
</script>`

const htmlFile = join(outputDirectory, "index.html")
let html = await readFile(htmlFile, "utf8")
html = cssAssetRenames.reduce(
  (content, asset) => content.replaceAll(asset.from, asset.to),
  html
)
if (!captchaAssetRename) {
  throw new Error("Unable to locate the CAPTCHA entry asset")
}
if (captchaAssetRename.from !== captchaAssetRename.to) {
  const oldAssetPath = `assets/${captchaAssetRename.from}`
  const references = html.split(oldAssetPath).length - 1
  if (references !== 1) {
    throw new Error(
      `Expected one CAPTCHA entry reference in index.html, found ${references}`
    )
  }
  html = html.replace(oldAssetPath, `assets/${captchaAssetRename.to}`)
}
if (!html.includes("data-chrome85-polyfills")) {
  if (!html.includes('<script type="module"')) {
    throw new Error("Unable to find the Vite module entry in index.html")
  }
  html = html.replace('<script type="module"', `${polyfills}\n    <script type="module"`)
}
await writeFile(htmlFile, html)

console.log(
  `Chrome 85 post-processing completed for ${processedCssFiles} CSS files, ${expandedSpacingValues} spacing values, ${expandedIndividualTransforms} individual transforms, ${remainingHasSelectors} gracefully degraded :has() selectors, ${patchedCaptchaWorkers} CAPTCHA worker, ${patchedCaptchaFallbacks} fallback solver, and ${patchedAdoptedStyleSheets} adoptedStyleSheets call.`
)
