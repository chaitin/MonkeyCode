import { describe, expect, it } from "vitest";

import { mcpNameValidationError, modelsToConfig, validateMcpNames } from "./settingsConfig";
import type { HostModel } from "./types";

describe("modelsToConfig", () => {
  it("persists only fields supported by the engine schema", () => {
    const legacy = {
      name: "  local  ",
      provider: "anthropic",
      base_url: "https://gateway.test",
      api_key: "secret",
      model: "model-1",
      context_window: 42,
      max_output: 32768,
      think: "high",
      vision: true,
      source: "baizhi",
      skip_tls_verify: true,
    } as HostModel & { skip_tls_verify: boolean };

    const [saved] = modelsToConfig([legacy], 0);

    expect(saved).toEqual({
      name: "local",
      provider: "anthropic",
      base_url: "https://gateway.test",
      api_key: "secret",
      model: "model-1",
      default: true,
      context_window: 42,
      max_output: 32768,
      think: "high",
      vision: true,
      source: "baizhi",
    });
    expect(saved).not.toHaveProperty("skip_tls_verify");
  });
});

describe("MCP name validation", () => {
  it("accepts only identifiers supported by OpenAI tool names", () => {
    expect(mcpNameValidationError("context7")).toBeNull();
    expect(mcpNameValidationError("mc-browser_2")).toBeNull();
    expect(mcpNameValidationError("  github  ")).toBeNull();
    expect(mcpNameValidationError("")).toBe("请输入 MCP 名称");
    expect(mcpNameValidationError("我的知识库")).toBe("仅支持英文字母、数字、_ 和 -");
    expect(mcpNameValidationError("my.server")).toBe("仅支持英文字母、数字、_ 和 -");
    expect(mcpNameValidationError("my server")).toBe("仅支持英文字母、数字、_ 和 -");
  });

  it("marks every duplicate after trimming", () => {
    expect(validateMcpNames([{ name: "github" }, { name: " github " }, { name: "context7" }])).toEqual([
      "MCP 名称重复: github",
      "MCP 名称重复: github",
      null,
    ]);
  });
});
