import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

test("DCR 发起授权后立即同步连接，取消或关闭弹窗不影响版本同步", async (t) => {
  const source = await readFile(
    new URL("../src/components/connector-credentials.tsx", import.meta.url),
    "utf8"
  )
  const tree = ts.createSourceFile(
    "component.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  let handler
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === "authorize"
    )
      handler = node.initializer.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(handler)
  const compiled = ts.transpileModule(`(${handler})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const scenario of [
    "取消授权",
    "弹窗被阻止",
    "刷新列表失败",
    "注册失败",
    "连接保存失败",
  ]) {
    await t.test(scenario, async () => {
      const events = []
      let pending
      let request
      const popup = {
        opener: {},
        location: { href: "about:blank" },
        close: () => events.push("close"),
      }
      const authorize = runInNewContext(compiled, {
        credentialNameFor: (value) => value,
        lock: { current: false },
        credential: null,
        base: "",
        onPrepare: async () =>
          scenario === "连接保存失败"
            ? null
            : { id: "test", name: "连接器", credentials: [] },
        currentCredential: () => null,
        window: { open: () => (scenario === "弹窗被阻止" ? null : popup) },
        run: (action) => {
          pending = action()
        },
        api: async () => {
          events.push("register")
          if (scenario === "注册失败") throw new Error("注册失败")
          return {
            id: "auth",
            authorization_url: "https://oauth.example.com/authorize",
          }
        },
        setRequest: (value) => {
          request = value
        },
        onChange: async () => {
          events.push("reload")
          if (scenario === "刷新列表失败") throw new Error("刷新失败")
        },
      })
      authorize()
      if (scenario === "连接保存失败") {
        await pending
        assert.deepEqual(events, ["close"])
        assert.equal(request, undefined)
      } else if (scenario === "注册失败") {
        await assert.rejects(pending, /注册失败/)
        assert.deepEqual(events, ["register", "close"])
        assert.equal(request, undefined)
      } else {
        if (scenario === "刷新列表失败")
          await assert.rejects(pending, /刷新失败/)
        else await pending
        assert.deepEqual(events, ["register", "reload"])
        assert.equal(request.id, "auth")
        if (scenario !== "弹窗被阻止")
          assert.equal(popup.location.href, request.url)
      }
    })
  }
})

test("动态 Client 仅提交模式，传统配置不混入自动发现字段", async () => {
  const source = await readFile(
    new URL("../src/pages/admin/tools-page.tsx", import.meta.url),
    "utf8"
  )
  const tree = ts.createSourceFile(
    "page.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const helper = tree.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === "oauthFormConfig"
  )
  assert.ok(helper)
  const buildConfig = runInNewContext(
    ts.transpileModule(`(${helper.getText(tree)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText
  )
  const form = new FormData()
  form.set("oauthAuthorizationURL", " https://auth.example.com/authorize ")
  form.set("oauthTokenURL", "https://auth.example.com/token")
  form.set("oauthClientID", " manual-client ")
  form.set("oauthScopes", "read")
  form.set("oauthClientSecret", "secret")
  const dynamic = buildConfig("dynamic", form, { client_id: "existing" })
  assert.deepEqual(JSON.parse(JSON.stringify(dynamic)), { mode: "dynamic" })
  const manual = buildConfig("manual", form, {
    mode: "dynamic",
    resource: "old-resource",
  })
  assert.equal(manual.mode, "manual")
  assert.equal(manual.client_id, "manual-client")
  assert.equal(manual.authorization_url, "https://auth.example.com/authorize")
  assert.equal(manual.registration_url, "")
  assert.equal(manual.resource, undefined)
  assert.equal(manual.client_secret, undefined)
  form.set("oauthRegistrationURL", "https://auth.example.com/register")
  assert.equal(buildConfig("manual", form).mode, "manual")
  const legacy = buildConfig("manual", form, {})
  assert.equal(legacy.mode, "")
  assert.equal(legacy.registration_url, "https://auth.example.com/register")

  let branch
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      node.left.getText(tree) === 'oauthClientMode === "manual"'
    )
      branch = node
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(branch)
  assert.match(branch.right.getText(tree), /oauthAuthorizationURL/)
  assert.match(branch.right.getText(tree), /oauthClientID/)
  assert.match(branch.right.getText(tree), /oauthClientSecret/)
  assert.match(source, /description: t\("resources\.oauthDiscoveryHint"\)/)
  assert.match(source, /description: t\("resources\.oauthManualHint"\)/)
  assert.match(source, /useState<OAuthClientMode>\("dynamic"\)/)
})
