import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { resolveReadmeMediaUrl } from "../src/utils/readme-media.ts"

const options = {
  projectId: "project/id",
  readmePath: "docs/README.md",
  ref: "feature/readme",
}

test("README 图片相对 README 所在目录解析，并保留项目和分支", () => {
  const result = resolveReadmeMediaUrl({ ...options, src: "./images/demo.png" })

  assert.equal(
    result,
    "/api/v1/users/projects/project%2Fid/tree/media?path=docs%2Fimages%2Fdemo.png&ref=feature%2Freadme",
  )
})

test("README 图片支持父目录和仓库根目录路径", () => {
  assert.match(
    resolveReadmeMediaUrl({ ...options, src: "../assets/demo.png" }) ?? "",
    /path=assets%2Fdemo\.png/,
  )
  assert.match(
    resolveReadmeMediaUrl({ ...options, src: "/assets/demo.png" }) ?? "",
    /path=assets%2Fdemo\.png/,
  )
})

test("README 图片正确编码中文、空格和特殊文件名", () => {
  const result = resolveReadmeMediaUrl({
    ...options,
    readmePath: "中文目录/README.md",
    src: "图片/a%3Fb c.png#preview",
  })

  const url = new URL(result ?? "", "https://monkeycode.invalid")
  assert.equal(url.searchParams.get("path"), "中文目录/图片/a?b c.png")
})

test("外部 HTTP(S) 和协议相对图片保持原地址", () => {
  assert.equal(resolveReadmeMediaUrl({ ...options, src: "https://example.com/a.png" }), "https://example.com/a.png")
  assert.equal(resolveReadmeMediaUrl({ ...options, src: "http://example.com/a.png" }), "http://example.com/a.png")
  assert.equal(resolveReadmeMediaUrl({ ...options, src: "//example.com/a.png" }), "//example.com/a.png")
})

test("拒绝主动协议、空地址和越出仓库根目录的路径", () => {
  assert.equal(resolveReadmeMediaUrl({ ...options, src: "javascript:alert(1)" }), undefined)
  assert.equal(resolveReadmeMediaUrl({ ...options, src: "data:image/png;base64,AAAA" }), undefined)
  assert.equal(resolveReadmeMediaUrl({ ...options, src: "" }), undefined)
  assert.equal(resolveReadmeMediaUrl({ ...options, src: "../../../secret.png" }), undefined)
})

test("项目 README 启用安全 HTML 图片解析并保留生成的媒体 API 契约", () => {
  const markdownSource = readFileSync(new URL("../src/components/common/markdown.tsx", import.meta.url), "utf8")
  const infoTabSource = readFileSync(new URL("../src/pages/console/user/project/overview/info-tab.tsx", import.meta.url), "utf8")
  const apiSource = readFileSync(new URL("../src/api/Api.ts", import.meta.url), "utf8")

  assert.match(markdownSource, /rehypePlugins=\{allowHtml \? \[rehypeRaw, rehypeSanitize\] : \[\]\}/)
  assert.match(markdownSource, /const resolvedSrc = resolveImageUrl \? resolveImageUrl\(src \?\? ""\) : src/)
  assert.match(infoTabSource, /<Markdown allowHtml resolveImageUrl=\{resolveReadmeImageUrl\}>/)
  assert.match(apiSource, /v1UsersProjectsTreeMediaDetail/)
  assert.match(apiSource, /path: `\/api\/v1\/users\/projects\/\$\{id\}\/tree\/media`/)
  assert.match(apiSource, /format: "blob"/)
})
