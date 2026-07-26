import { pathToFileURL } from "node:url";

const checks = [
  {
    label: "CAP JavaScript",
    path: "/captcha/cap_wasm.js",
    expectedStatus: 200,
    contentTypePattern: /^(application|text)\/javascript(?:;|$)/i,
  },
  {
    label: "CAP WASM",
    path: "/captcha/cap_wasm_bg.wasm",
    expectedStatus: 200,
    contentTypePattern: /^application\/wasm(?:;|$)/i,
  },
  {
    label: "Captcha challenge",
    path: "/api/v1/public/captcha/challenge",
    method: "POST",
    expectedStatus: 201,
    contentTypePattern: /^application\/json(?:;|$)/i,
    validateBody: true,
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
  return Boolean(
    data &&
      typeof data.token === "string" &&
      data.token.length > 0 &&
      Number.isFinite(data.expires) &&
      data.challenge &&
      Number.isFinite(data.challenge.c) &&
      Number.isFinite(data.challenge.s) &&
      Number.isFinite(data.challenge.d),
  );
}

export async function checkOnlinePreview(rawBaseUrl, fetchImpl = fetch) {
  const baseUrl = resolveBaseUrl(rawBaseUrl);

  for (const check of checks) {
    let response;
    try {
      response = await fetchImpl(new URL(check.path, baseUrl), {
        method: check.method ?? "GET",
        headers:
          check.method === "POST" ? { "content-type": "application/json" } : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error(`${check.label} request failed`);
    }
    const contentType = response.headers.get("content-type") ?? "(missing)";

    if (
      response.status !== check.expectedStatus ||
      !check.contentTypePattern.test(contentType)
    ) {
      throw new Error(
        `${check.label} check failed: status=${response.status}, content-type=${contentType}`,
      );
    }

    if (check.validateBody) {
      let challenge;
      try {
        challenge = await response.json();
      } catch {
        throw new Error("Captcha challenge response has an invalid structure");
      }

      if (!isValidChallenge(challenge)) {
        throw new Error("Captcha challenge response has an invalid structure");
      }
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
