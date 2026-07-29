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

test("挂起请求在超时后中止并释放", async () => {
  let aborted = false;

  await assert.rejects(
    () =>
      checkOnlinePreview(
        "https://preview.example",
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(options.signal.reason);
              },
              { once: true },
            );
          }),
        10,
      ),
    /CAP JavaScript request failed/,
  );
  assert.equal(aborted, true);
});

test("响应正文流挂起时在超时后中止", async () => {
  let aborted = false;

  await assert.rejects(
    () =>
      checkOnlinePreview(
        "https://preview.example",
        async (_url, options) =>
          new Response(
            new ReadableStream({
              start(controller) {
                options.signal.addEventListener(
                  "abort",
                  () => {
                    aborted = true;
                    controller.error(options.signal.reason);
                  },
                  { once: true },
                );
              },
            }),
            {
              status: 200,
              headers: { "content-type": "text/javascript" },
            },
          ),
        10,
      ),
    /CAP JavaScript response body read failed/,
  );
  assert.equal(aborted, true);
});

test("HTTP 元数据失败时取消响应正文", async () => {
  let bodyCancelled = false;
  const leakedMessage = "sensitive-cancel-error";

  await assert.rejects(
    () =>
      checkOnlinePreview("https://preview.example", async () => ({
        status: 500,
        headers: new Headers({ "content-type": "text/javascript" }),
        body: {
          cancel: async () => {
            bodyCancelled = true;
            throw new Error(leakedMessage);
          },
        },
      })),
    (error) => {
      assert.equal(
        error.message,
        "CAP JavaScript check failed: status=500, content-type=text/javascript",
      );
      assert.doesNotMatch(error.message, new RegExp(leakedMessage));
      return true;
    },
  );
  assert.equal(bodyCancelled, true);
});

test("正文读取错误隐藏底层消息", async () => {
  const leakedMessage = "CAP JavaScript response body leaked-data";

  await assert.rejects(
    () =>
      checkOnlinePreview("https://preview.example", async () => ({
        status: 200,
        headers: new Headers({ "content-type": "text/javascript" }),
        body: {
          getReader: () => ({
            read: async () => {
              throw new Error(leakedMessage);
            },
          }),
        },
      })),
    (error) => {
      assert.equal(error.message, "CAP JavaScript response body read failed");
      assert.doesNotMatch(error.message, new RegExp(leakedMessage));
      return true;
    },
  );
});

test("空 CAP JavaScript 资源失败", async () => {
  await withPreviewServer(
    {
      "/captcha/cap_wasm.js": { body: "" },
    },
    async (baseUrl) => {
      await assert.rejects(
        () => checkOnlinePreview(baseUrl),
        /CAP JavaScript response body is invalid/,
      );
    },
  );
});

test("缺少魔数的 CAP WASM 资源失败", async () => {
  await withPreviewServer(
    {
      "/captcha/cap_wasm_bg.wasm": { body: Buffer.from([1, 2, 3, 4]) },
    },
    async (baseUrl) => {
      await assert.rejects(
        () => checkOnlinePreview(baseUrl),
        /CAP WASM response body is invalid/,
      );
    },
  );
});

test("超过大小上限的静态资源失败", async () => {
  await withPreviewServer(
    {
      "/captcha/cap_wasm.js": { body: Buffer.alloc(1024 * 1024 + 1) },
    },
    async (baseUrl) => {
      await assert.rejects(
        () => checkOnlinePreview(baseUrl),
        /CAP JavaScript response body exceeds size limit/,
      );
    },
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
        contentType: "application/json",
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
      }, /Captcha challenge check failed: status=500, content-type=application\/json/);
    },
  );
});

test("challenge MIME 类型错误时失败", async () => {
  await withPreviewServer(
    {
      "/api/v1/public/captcha/challenge": {
        contentType: "text/plain",
      },
    },
    async (baseUrl) => {
      await assert.rejects(
        () => checkOnlinePreview(baseUrl),
        /Captcha challenge check failed: status=201, content-type=text\/plain/,
      );
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

test("已过期 challenge 失败", async () => {
  await withPreviewServer(
    {
      "/api/v1/public/captcha/challenge": {
        body: JSON.stringify({
          challenge: { c: 50, s: 32, d: 3 },
          expires: Date.now() - 1,
          token: "expired-challenge-token",
        }),
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

test("零求解参数 challenge 失败", async () => {
  await withPreviewServer(
    {
      "/api/v1/public/captcha/challenge": {
        body: JSON.stringify({
          challenge: { c: 0, s: 0, d: 0 },
          expires: Date.now() + 120_000,
          token: "zero-parameter-token",
        }),
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
