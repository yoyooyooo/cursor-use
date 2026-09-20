import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import manifest from "../package.json";

test("public package metadata has an explicit license and bounded contents", () => {
  expect("private" in manifest).toBe(false);
  expect(manifest.license).toBe("MIT");
  expect(manifest.repository).toEqual({ type: "git", url: "git+https://github.com/yoyooyooo/cursor-use.git" });
  expect(manifest.files).toEqual([
    "dist/main.js",
    "skills/cursor-use/SKILL.md",
    "README.md",
    "README.zh-CN.md",
    "LICENSE",
    "CHANGELOG.md",
    "THIRD_PARTY_NOTICES.md",
  ]);
  for (const path of manifest.files) expect(existsSync(path)).toBe(true);
  expect(manifest.files.some(path => path.startsWith("docs/") || path.startsWith("test/") || path === "AGENTS.md")).toBe(false);
  expect(manifest.dependencies.effect).toBe("catalog:");
  expect(manifest.overrides.effect).toBe("catalog:");
});
