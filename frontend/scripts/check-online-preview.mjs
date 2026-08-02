import { pathToFileURL } from "node:url";

const MAX_RESPONSE_BYTES = 1024 * 1024;

class ResponseSizeLimitError extends Error {}

const checks = [
  {
    label: "CAP JavaScript",
    path: "/captcha/cap_wasm.js",
    expectedStatus: 200,
    contentTypePattern: /^(application|text)\/javascript(?:;|$)/i,
    bodyType: "javascript",
  },
  {
    label: "CAP WASM",
    path: "/captcha/cap_wasm_bg.wasm",
    expectedStatus: 200,
    contentTypePattern: /^application\/wasm(?:;|$)/i,
    bodyType: "wasm",
  },
  {
    label: "Captcha challenge",
    path: "/api/v1/public/captcha/challenge",
    method: "POST",
    expectedStatus: 201,
    contentTypePattern: /^application\/json(?:;|$)/i,
    bodyType: "challenge",
  },
];

function resolveBaseUrl(rawBaseUrl) {
  if (!rawBaseUrl) {
    throw new Error("PREVIEW_URL is required");
  }

  let baseUrl;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new Error("PREVIEW_URL must be an absolute HTTP(S) URL");
  }

  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("PREVIEW_URL must be an absolute HTTP(S) URL");
  }

  return baseUrl;
}

function isValidChallenge(data) {
  const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

  return Boolean(
    data &&
      typeof data.token === "string" &&
      data.token.length > 0 &&
      Number.isFinite(data.expires) &&
      data.expires > Date.now() &&
      data.challenge &&
      isPositiveInteger(data.challenge.c) &&
      isPositiveInteger(data.challenge.s) &&
      isPositiveInteger(data.challenge.d),
  );
}

async function readResponseBody(response, label) {
  const reader = response.body?.getReader();
  if (!reader) {
    return new Uint8Array();
  }

  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ResponseSizeLimitError(`${label} response body exceeds size limit`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ResponseSizeLimitError) {
      throw error;
    }
    throw new Error(`${label} response body read failed`);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function validateStaticResourceBody(bodyType, body) {
  if (bodyType === "javascript" && body.byteLength === 0) {
    throw new Error("CAP JavaScript response body is invalid");
  }

  if (
    bodyType === "wasm" &&
    (body.byteLength < 4 ||
      body[0] !== 0 ||
      body[1] !== 97 ||
      body[2] !== 115 ||
      body[3] !== 109)
  ) {
    throw new Error("CAP WASM response body is invalid");
  }
}

export async function checkOnlinePreview(rawBaseUrl, fetchImpl = fetch, timeoutMs = 10_000) {
  const baseUrl = resolveBaseUrl(rawBaseUrl);

  for (const check of checks) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(new URL(check.path, baseUrl), {
          method: check.method ?? "GET",
          headers:
            check.method === "POST" ? { "content-type": "application/json" } : undefined,
          signal: controller.signal,
        });
      } catch {
        throw new Error(`${check.label} request failed`);
      }
      const contentType = response.headers.get("content-type") ?? "(missing)";

      if (
        response.status !== check.expectedStatus ||
        !check.contentTypePattern.test(contentType)
      ) {
        try {
          await response.body?.cancel();
        } catch {
          // Preserve the HTTP metadata error when cancellation fails.
        }
        throw new Error(
          `${check.label} check failed: status=${response.status}, content-type=${contentType}`,
        );
      }

      const body = await readResponseBody(response, check.label);
      validateStaticResourceBody(check.bodyType, body);

      if (check.bodyType === "challenge") {
        let challenge;
        try {
          challenge = JSON.parse(new TextDecoder().decode(body));
        } catch {
          throw new Error("Captcha challenge response has an invalid structure");
        }

        if (!isValidChallenge(challenge)) {
          throw new Error("Captcha challenge response has an invalid structure");
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  checkOnlinePreview(process.env.PREVIEW_URL)
    .then(() => {
      console.log("Online preview captcha health check passed.");
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
