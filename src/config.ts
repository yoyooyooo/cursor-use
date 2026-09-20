import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { Fault, assertInput } from "./errors.ts";

const ConfigModelParam = Schema.Struct({ id: Schema.String, value: Schema.String });
const ConfigModel = Schema.Struct({
  id: Schema.String,
  params: Schema.optional(Schema.Array(ConfigModelParam)),
});
const ConfigWait = Schema.Struct({
  timeoutSeconds: Schema.optional(Schema.Number),
  intervalSeconds: Schema.optional(Schema.Number),
});
const ConfigStream = Schema.Struct({
  timeoutSeconds: Schema.optional(Schema.Number),
  reconnects: Schema.optional(Schema.Number),
});
export const UserConfigSchema = Schema.Struct({
  version: Schema.Literals([1]),
  model: Schema.optional(ConfigModel),
  wait: Schema.optional(ConfigWait),
  stream: Schema.optional(ConfigStream),
});
export type UserConfig = typeof UserConfigSchema.Type;

export const userConfigPath = (home = homedir()) => join(home, ".cursor-use", "config.json");

function validateInteger(value: number | undefined, name: string, minimum: number, maximum: number) {
  if (value === undefined) return;
  assertInput(Number.isInteger(value) && value >= minimum && value <= maximum, `${name} must be an integer from ${minimum} to ${maximum}.`);
}

export function parseUserConfig(text: string, path = "~/.cursor-use/config.json"): UserConfig {
  try {
    const parsed = Schema.decodeUnknownSync(UserConfigSchema, { onExcessProperty: "error" })(JSON.parse(text));
    if (parsed.model) {
      assertInput(parsed.model.id.trim() === parsed.model.id && parsed.model.id.length > 0 && parsed.model.id.length <= 200, "Config model.id must be a non-empty exact model ID.");
      const params = parsed.model.params ?? [];
      assertInput(new Set(params.map((param) => param.id)).size === params.length && params.length <= 30, "Config model.params must contain at most 30 unique parameters.");
      for (const param of params) {
        assertInput(param.id.trim() === param.id && param.id.length > 0 && param.id.length <= 100, "Config model parameter IDs must be non-empty.");
        assertInput(param.value.length <= 500, "Config model parameter values must be at most 500 characters.");
      }
    }
    validateInteger(parsed.wait?.timeoutSeconds, "Config wait.timeoutSeconds", 1, 3600);
    validateInteger(parsed.wait?.intervalSeconds, "Config wait.intervalSeconds", 1, 3600);
    validateInteger(parsed.stream?.timeoutSeconds, "Config stream.timeoutSeconds", 1, 3600);
    validateInteger(parsed.stream?.reconnects, "Config stream.reconnects", 0, 10);
    return parsed;
  } catch (error) {
    if (error instanceof Fault) throw error;
    throw new Fault({ code: "INVALID_CONFIG", message: "~/.cursor-use/config.json is not valid JSON or does not match version 1.", details: { path } });
  }
}

export function loadUserConfig(path = userConfigPath()): Effect.Effect<UserConfig, Fault> {
  return Effect.try({
    try: () => {
      let info: ReturnType<typeof lstatSync>;
      try {
        info = lstatSync(path);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return { version: 1 } as UserConfig;
        throw error;
      }
      if (info.isSymbolicLink() || !info.isFile() || info.size > 64 * 1024) throw new Fault({ code: "INVALID_CONFIG", message: "~/.cursor-use/config.json must be a regular file of at most 64 KiB.", details: { path } });
      return parseUserConfig(readFileSync(path, "utf8"), path);
    },
    catch: (error) => error instanceof Fault ? error : new Fault({ code: "INVALID_CONFIG", message: "Unable to read ~/.cursor-use/config.json.", details: { path } }),
  });
}
