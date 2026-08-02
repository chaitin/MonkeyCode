import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadConfigFromFile } from "vite";

const viteConfigSource = readFileSync(
  new URL("../vite.config.ts", import.meta.url),
  "utf8",
);
const frontendRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const configPath = fileURLToPath(new URL("../vite.config.ts", import.meta.url));

async function withEnvironment(overrides, run) {
  const originalValues = new Map(
    Object.keys(overrides).map((name) => [name, process.env[name]]),
  );

  try {
    for (const [name, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    return await run();
  } finally {
    for (const [name, value] of originalValues) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function loadOnlineConfig(command = "serve") {
  const loadedConfig = await loadConfigFromFile(
    { command, mode: "online" },
    configPath,
  );
  assert.ok(loadedConfig);
  return loadedConfig.config;
}

function getApiProxy(config) {
  return config.server?.proxy?.["/api"];
}

test("开发服务白名单从 Vite 配置目录查找 workspace root", () => {
  assert.match(
    viteConfigSource,
    /searchForWorkspaceRoot\(__dirname\)/,
  );
  assert.doesNotMatch(
    viteConfigSource,
    /searchForWorkspaceRoot\(process\.cwd\(\)\)/,
  );
  assert.match(viteConfigSource, /loadEnv\(mode, __dirname, ''\)/);
  assert.doesNotMatch(viteConfigSource, /loadEnv\(mode, process\.cwd\(\)/);
});

test("从外部工作目录加载配置时仍允许 frontend 和字体目录", async () => {
  const originalCwd = process.cwd();
  const externalCwd = path.dirname(frontendRoot);

  try {
    process.chdir(externalCwd);
    const config = await withEnvironment(
      {
        VITE_APP_EDITION: "online",
        TARGET: "https://example.com",
        PROXY_BASIC_AUTH_USERNAME: undefined,
        PROXY_BASIC_AUTH_PASSWORD: undefined,
      },
      () => loadOnlineConfig(),
    );
    const allow = config.server?.fs?.allow ?? [];

    assert.equal(allow[0], frontendRoot);
    assert.equal(allow.length, 3);
    assert.match(allow[1], /@fontsource-variable\/jetbrains-mono$/);
    assert.match(allow[2], /@fontsource-variable\/noto-sans-sc$/);
    assert.equal(allow.includes(externalCwd), false);
  } finally {
    process.chdir(originalCwd);
  }
});

test("online serve 缺少 TARGET 时立即失败", async () => {
  await assert.rejects(
    () =>
      withEnvironment(
        {
          VITE_APP_EDITION: "online",
          TARGET: " ",
          PROXY_BASIC_AUTH_USERNAME: undefined,
          PROXY_BASIC_AUTH_PASSWORD: undefined,
        },
        () => loadOnlineConfig(),
      ),
    /TARGET is required for online preview/,
  );
});

test("online serve 拒绝非 HTTP 协议 TARGET", async () => {
  await assert.rejects(
    () =>
      withEnvironment(
        {
          VITE_APP_EDITION: "online",
          TARGET: "file:///tmp/backend",
          PROXY_BASIC_AUTH_USERNAME: undefined,
          PROXY_BASIC_AUTH_PASSWORD: undefined,
        },
        () => loadOnlineConfig(),
      ),
    /TARGET must be an absolute HTTP\(S\) URL/,
  );
});

for (const target of [
  "https://example.com/api",
  "https://user:pass@example.com",
  "https://example.com?region=test",
  "https://example.com#preview",
]) {
  test(`online serve 拒绝非纯 origin TARGET: ${target}`, async () => {
    await assert.rejects(
      () =>
        withEnvironment(
          {
            VITE_APP_EDITION: "online",
            TARGET: target,
            PROXY_BASIC_AUTH_USERNAME: undefined,
            PROXY_BASIC_AUTH_PASSWORD: undefined,
          },
          () => loadOnlineConfig(),
        ),
      /TARGET must contain only an HTTP\(S\) origin/,
    );
  });
}

test("online serve 返回规范化的 HTTPS origin", async () => {
  const config = await withEnvironment(
    {
      VITE_APP_EDITION: "online",
      TARGET: "  https://example.com  ",
      PROXY_BASIC_AUTH_USERNAME: undefined,
      PROXY_BASIC_AUTH_PASSWORD: undefined,
    },
    () => loadOnlineConfig(),
  );
  assert.equal(getApiProxy(config)?.target, "https://example.com");
  assert.equal(getApiProxy(config)?.secure, true);
});

test("代理 Basic Auth 拒绝远程 HTTP TARGET", async () => {
  await assert.rejects(
    () =>
      withEnvironment(
        {
          VITE_APP_EDITION: "online",
          TARGET: "http://example.com",
          PROXY_BASIC_AUTH_USERNAME: "preview-user",
          PROXY_BASIC_AUTH_PASSWORD: "preview-password",
        },
        () => loadOnlineConfig(),
      ),
    /Proxy basic authentication requires an HTTPS or loopback TARGET/,
  );
});

test("代理 Basic Auth 允许 HTTP loopback TARGET", async () => {
  const config = await withEnvironment(
    {
      VITE_APP_EDITION: "online",
      TARGET: "http://127.0.0.1:3001",
      PROXY_BASIC_AUTH_USERNAME: "preview-user",
      PROXY_BASIC_AUTH_PASSWORD: "preview-password",
    },
    () => loadOnlineConfig(),
  );
  assert.equal(getApiProxy(config)?.target, "http://127.0.0.1:3001");
  assert.equal(getApiProxy(config)?.secure, false);
  assert.match(getApiProxy(config)?.headers?.Authorization ?? "", /^Basic /);
});

test("代理 Basic Auth 要求用户名和密码成对配置", async () => {
  await assert.rejects(
    () =>
      withEnvironment(
        {
          VITE_APP_EDITION: "online",
          TARGET: "https://example.com",
          PROXY_BASIC_AUTH_USERNAME: "preview-user",
          PROXY_BASIC_AUTH_PASSWORD: undefined,
        },
        () => loadOnlineConfig(),
      ),
    /Proxy basic authentication requires both username and password/,
  );
});

test("online build 缺少 TARGET 时保持可用", async () => {
  const config = await withEnvironment(
    {
      VITE_APP_EDITION: "online",
      TARGET: " ",
      PROXY_BASIC_AUTH_USERNAME: undefined,
      PROXY_BASIC_AUTH_PASSWORD: undefined,
    },
    () => loadOnlineConfig("build"),
  );
  assert.equal(getApiProxy(config)?.target, undefined);
});

test("online build 忽略仅供开发代理使用的 Basic Auth", async () => {
  const config = await withEnvironment(
    {
      VITE_APP_EDITION: "online",
      TARGET: " ",
      PROXY_BASIC_AUTH_USERNAME: "preview-user",
      PROXY_BASIC_AUTH_PASSWORD: "preview-password",
    },
    () => loadOnlineConfig("build"),
  );
  assert.equal(getApiProxy(config)?.target, undefined);
  assert.equal(getApiProxy(config)?.headers, undefined);
});

test("online build 忽略无效的开发代理 TARGET", async () => {
  const config = await withEnvironment(
    {
      VITE_APP_EDITION: "online",
      TARGET: "invalid-dev-proxy-target",
      PROXY_BASIC_AUTH_USERNAME: undefined,
      PROXY_BASIC_AUTH_PASSWORD: undefined,
    },
    () => loadOnlineConfig("build"),
  );
  assert.equal(getApiProxy(config)?.target, "invalid-dev-proxy-target");
});
