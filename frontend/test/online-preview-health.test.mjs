import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { checkOnlinePreview } from "../scripts/check-online-preview.mjs";

const validChallenge = JSON.stringify({
  challenge: { c: 50, s: 32, d: 3 },
  expires: Date.now() + 120_000,
  token: "test-challenge-token",
});

async function withPreviewServer(overrides, callback) {
  const server = createServer((request, response) => {
    const override = overrides[request.url] ?? {};

    if (request.url === "/captcha/cap_wasm.js") {
      response.writeHead(override.status ?? 200, {
        "content-type": override.contentType ?? "text/javascript",
      });
      response.end(override.body ?? "export default async function init() {};");
      return;
    }

    if (request.url === "/captcha/cap_wasm_bg.wasm") {
      response.writeHead(override.status ?? 200, {
        "content-type": override.contentType ?? "application/wasm",
      });
      response.end(override.body ?? Buffer.from([0, 97, 115, 109]));
      return;
    }

    if (
      request.url === "/api/v1/public/captcha/challenge" &&
      request.method === "POST"
    ) {
      response.writeHead(override.status ?? 201, {
        "content-type": override.contentType ?? "application/json",
      });
      response.end(override.body ?? validChallenge);
      return;
    }

    response.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("验证码预览资源和 challenge 健康时通过", async () => {
  await withPreviewServer({}, async (baseUrl) => {
    await assert.doesNotReject(() => checkOnlinePreview(baseUrl));
  });
});

test("网络错误包含当前检查阶段", async () => {
  await assert.rejects(
    () =>
      checkOnlinePreview("https://preview.example", async () => {
        throw new Error("connection refused");
      }),
    /CAP JavaScript request failed/,
  );
});

test("WASM MIME 类型错误时失败", async () => {
  await withPreviewServer(
    {
      "/captcha/cap_wasm_bg.wasm": { contentType: "text/plain" },
    },
    async (baseUrl) => {
      await assert.rejects(
        () => checkOnlinePreview(baseUrl),
        /CAP WASM check failed: status=200, content-type=text\/plain/,
      );
    },
  );
});

test("challenge 代理失败时只输出 HTTP 元数据", async () => {
  const sensitiveBody = "sensitive-response-body";

  await withPreviewServer(
    {
      "/api/v1/public/captcha/challenge": {
        status: 500,
        contentType: "text/plain",
        body: sensitiveBody,
      },
    },
    async (baseUrl) => {
      await assert.rejects(async () => {
        try {
          await checkOnlinePreview(baseUrl);
        } catch (error) {
          assert.doesNotMatch(error.message, new RegExp(sensitiveBody));
          throw error;
        }
      }, /Captcha challenge check failed: status=500, content-type=text\/plain/);
    },
  );
});

test("challenge JSON 结构缺失时失败", async () => {
  await withPreviewServer(
    {
      "/api/v1/public/captcha/challenge": {
        body: JSON.stringify({ success: true }),
      },
    },
    async (baseUrl) => {
      await assert.rejects(
        () => checkOnlinePreview(baseUrl),
        /Captcha challenge response has an invalid structure/,
      );
    },
  );
});
