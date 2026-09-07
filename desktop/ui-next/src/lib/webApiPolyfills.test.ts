import { describe, expect, it } from "vitest";
import { installWebApiPolyfills, randomUuidFallback } from "./webApiPolyfills";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("webApiPolyfills", () => {
  it("randomUuidFallback 产出 RFC 4122 v4 格式,与原生 crypto.randomUUID 同形", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const id = randomUuidFallback(globalThis.crypto);
      expect(id).toMatch(UUID_V4);
      seen.add(id);
    }
    expect(seen.size).toBe(50);
  });

  it("内核缺 randomUUID 时补上;已有原生实现时不覆盖", () => {
    const bare = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) } as Crypto;
    installWebApiPolyfills({ crypto: bare });
    expect(bare.randomUUID()).toMatch(UUID_V4);

    const native = () => "native-uuid" as ReturnType<Crypto["randomUUID"]>;
    const withNative = { getRandomValues: bare.getRandomValues, randomUUID: native } as Crypto;
    installWebApiPolyfills({ crypto: withNative });
    expect(withNative.randomUUID).toBe(native);

    expect(() => installWebApiPolyfills({})).not.toThrow();
  });
});
