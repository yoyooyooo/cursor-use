import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { loadUserConfig, parseUserConfig, userConfigPath } from "../src/config.ts";

test("user config parses the selected model variant and wait limits", () => {
  const config = parseUserConfig(JSON.stringify({
    version: 1,
    model: { id: "grok-4.6", params: [{ id: "effort", value: "xhigh" }, { id: "fast", value: "false" }] },
    wait: { timeoutSeconds: 900, intervalSeconds: 5 },
  }));
  expect(config).toEqual({
    version: 1,
    model: { id: "grok-4.6", params: [{ id: "effort", value: "xhigh" }, { id: "fast", value: "false" }] },
    wait: { timeoutSeconds: 900, intervalSeconds: 5 },
  });
});

test("missing user config is an empty versioned configuration", async () => {
  const home = mkdtempSync(join(tmpdir(), "cursor-use-config-test-"));
  const result = await Effect.runPromise(loadUserConfig(userConfigPath(home)));
  expect(result).toEqual({ version: 1 });
});

test("unknown fields and invalid values fail before command execution", () => {
  expect(() => parseUserConfig(JSON.stringify({ version: 1, apiKey: "secret" }))).toThrow();
  expect(() => parseUserConfig(JSON.stringify({ version: 1, model: { id: "grok-4.6", params: [{ id: "fast", value: "sometimes" }] } }))).not.toThrow();
  expect(() => parseUserConfig(JSON.stringify({ version: 1, wait: { timeoutSeconds: 0 } }))).toThrow();
});

test("config file is bounded and must be a regular file", async () => {
  const home = mkdtempSync(join(tmpdir(), "cursor-use-config-test-"));
  const directory = join(home, ".cursor-use");
  mkdirSync(directory);
  const path = join(directory, "config.json");
  writeFileSync(path, "x".repeat(64 * 1024 + 1));
  const result = await Effect.runPromise(Effect.result(loadUserConfig(path)));
  expect(result._tag).toBe("Failure");
});
