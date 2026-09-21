import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"

test("login method switches persist with authentication settings", async () => {
  const source = await readFile(
    new URL("../src/pages/other-settings-page.tsx", import.meta.url),
    "utf8"
  )

  assert.match(source, /pages\.otherSettings\.loginMethods\.password/)
  assert.match(source, /pages\.otherSettings\.loginMethods\.emailCode/)
  assert.match(source, /password_enabled: loginMethods\.passwordEnabled/)
  assert.match(source, /email_code_enabled: loginMethods\.emailCodeEnabled/)
  assert.match(
    source,
    /email_code_auto_registration_enabled:\s*loginMethods\.emailCodeAutoRegistrationEnabled/
  )
  assert.doesNotMatch(source, /\bregistration_enabled\b/)
})

test("third-party sign-in uses items, an action menu, and confirmations", async () => {
  const source = await readFile(
    new URL("../src/pages/other-settings-page.tsx", import.meta.url),
    "utf8"
  )
  const list = source
    .split("{oauthConnections.map((connection) => (")[1]
    .split("</ItemGroup>")[0]

  assert.match(list, /<Item key=\{connection\.id\} variant="outline">/)
  assert.match(list, /<ItemContent>/)
  assert.match(list, /<ItemActions>/)
  assert.doesNotMatch(list, /<ItemMedia>|<ItemDescription>/)
  assert.match(
    list,
    /<Badge\s+variant="outline"\s+className=\{[\s\S]*?border-green-500\/40[\s\S]*?border-red-500\/40 text-red-700/
  )
  assert.doesNotMatch(source, /getProviderName/)
  assert.match(list, /icon=\{MoreHorizontalIcon\}/)
  assert.match(list, /openOauthEditDialog\(connection\)/)
  assert.match(list, /setOauthCallbackDialogOpen\(true\)/)
  assert.match(list, /oauth\.viewCallback/)
  assert.match(list, /icon=\{Route02Icon\}/)
  assert.ok(
    list.indexOf("openOauthEditDialog(connection)") <
      list.indexOf("setOauthCallbackDialogOpen(true)")
  )
  assert.match(list, /action: connection\.enabled \? "disable" : "enable"/)
  assert.ok(
    list.indexOf('action: connection.enabled ? "disable" : "enable"') <
      list.indexOf("openOauthEditDialog(connection)")
  )
  assert.match(
    list,
    /icon=\{\s*connection\.enabled \? PowerOffIcon : PowerIcon\s*\}/
  )
  assert.match(list, /action: "delete"/)
  assert.match(
    list,
    /<ItemFooter>\s*<Item size="sm" variant="outline">[\s\S]*?loginMethods\.autoRegisterMissingUsers[\s\S]*?<Switch[\s\S]*?checked=\{connection\.autoRegistrationEnabled\}[\s\S]*?type: "oauth"/
  )
  assert.doesNotMatch(list, /<div\s+key=\{connection\.id\}/)
  assert.match(
    source,
    /auto_registration_enabled: connection\.autoRegistrationEnabled/
  )
  assert.match(
    source,
    /autoRegistrationEnabled:\s*connection\.auto_registration_enabled !== false/
  )
  assert.match(
    source,
    /autoRegistrationEnabled:\s*editingOauthConnection\?\.autoRegistrationEnabled \?\? true/
  )

  assert.match(source, /open=\{oauthPendingAction !== null\}/)
  assert.match(
    source,
    /<AlertDialogAction[\s\S]*?onClick=\{confirmOauthAction\}/
  )
  assert.match(source, /action === "delete"[\s\S]*?removeOauthConnection/)
  assert.match(source, /setOauthEnabled\(connection\.id, action === "enable"\)/)
  assert.match(source, /setOauthPendingAction\(null\)/)

  assert.match(source, /setEditingOauthID\(connection\.id\)/)
  assert.match(source, /defaultValue=\{editingOauthConnection\?\.name\}/)
  assert.match(source, /defaultValue=\{editingOauthConnection\?\.clientId\}/)
  assert.match(source, /required=\{!editingOauthConnection\}/)
  assert.match(source, /placeholder=\{[\s\S]*?secretUpdatePlaceholder/)
  assert.doesNotMatch(
    source,
    /oauth\.(dialogDescription|secretDescription)|secretUpdateDescription/
  )

  assert.match(
    source,
    /useState\(\s*\(\) => `\$\{window\.location\.origin\}\/api\/auth\/v1\/oauth\/callback`\s*\)/
  )
  assert.match(source, /"\/\.well-known\/oauth-authorization-server"/)
  assert.match(
    source,
    /setOauthCallbackURL\(`\$\{publicURL\}\/api\/auth\/v1\/oauth\/callback`\)/
  )
  assert.match(source, /open=\{oauthCallbackDialogOpen\}/)
  assert.match(source, /oauth\.callbackDialogTitle/)
  assert.match(source, /value=\{oauthCallbackURL\}/)
  assert.match(source, /navigator\.clipboard\.writeText\(oauthCallbackURL\)/)
  assert.match(source, /oauth\.callbackCopied/)
  assert.match(source, /oauth\.callbackCopyFailed/)
  const callbackDialog = source
    .split("open={oauthCallbackDialogOpen}")[1]
    .split("<Card>")[0]
  assert.match(
    callbackDialog,
    /<DialogFooter>[\s\S]*?<Button[\s\S]*?variant="outline"[\s\S]*?oauth\.copyCallback[\s\S]*?<DialogClose render=\{<Button type="button" \/>\}>[\s\S]*?common\.close/
  )
})

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
        name: "凭证",
        lock: { current: false },
        credential: null,
        path: "/connectors/test",
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
      if (scenario === "注册失败") {
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
    new URL("../src/pages/tools-page.tsx", import.meta.url),
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
      ts.isConditionalExpression(node) &&
      node.condition.getText(tree) === 'oauthClientMode === "dynamic"'
    )
      branch = node
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.ok(branch)
  assert.match(branch.whenTrue.getText(tree), /resources\.oauthDiscoveryHint/)
  assert.doesNotMatch(
    branch.whenTrue.getText(tree),
    /<Input|<select|saveBeforeAuthorize/
  )
  assert.match(branch.whenFalse.getText(tree), /oauthAuthorizationURL/)
  assert.match(branch.whenFalse.getText(tree), /oauthClientID/)
  assert.match(branch.whenFalse.getText(tree), /oauthClientSecret/)
  assert.match(source, /useState<OAuthClientMode>\("dynamic"\)/)
})

test("admin login lists configured OAuth providers and uses the admin flow", async () => {
  const [page, form] = await Promise.all([
    readFile(new URL("../src/pages/login-page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/components/login-form.tsx", import.meta.url),
      "utf8"
    ),
  ])

  assert.match(page, /\/api\/auth\/v1\/providers/)
  assert.match(page, /\/admin-start/)
  assert.match(form, /providers\.map/)
})
