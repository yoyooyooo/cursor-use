import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packageRoot } from "./package-paths.ts";

const destination = mkdtempSync(join(tmpdir(), "cursor-use-package-check-"));
const result = Bun.spawnSync(["bun", "pm", "pack", "--destination", destination, "--quiet"], { cwd: packageRoot, stdout: "pipe", stderr: "pipe" });
if (result.exitCode !== 0) {
  process.stderr.write(new TextDecoder().decode(result.stderr));
  process.exit(result.exitCode);
}
const archive = readdirSync(destination).find(name => name.endsWith(".tgz"));
if (archive === undefined) throw new Error("bun pm pack did not produce a tarball");
const archivePath = join(destination, archive);
const manifestResult = Bun.spawnSync(["tar", "-xOf", archivePath, "package/package.json"], { stdout: "pipe", stderr: "pipe" });
if (manifestResult.exitCode !== 0) throw new Error(new TextDecoder().decode(manifestResult.stderr));
const manifest = JSON.parse(new TextDecoder().decode(manifestResult.stdout)) as {
  license?: string;
  private?: unknown;
  files: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
};
if (manifest.license !== "MIT") throw new Error("Published package must use the MIT license");
if (manifest.private) throw new Error("Published package must not be private");
const dependencyText = JSON.stringify({ dependencies: manifest.dependencies, devDependencies: manifest.devDependencies, overrides: manifest.overrides });
if (dependencyText.includes("catalog:")) throw new Error("Published package manifest still contains catalog: references");
const expected = [
  "package/CHANGELOG.md",
  "package/LICENSE",
  "package/README.md",
  "package/README.zh-CN.md",
  "package/THIRD_PARTY_NOTICES.md",
  "package/dist/main.js",
  "package/package.json",
  "package/skills/cursor-use/SKILL.md",
];
const filesResult = Bun.spawnSync(["tar", "-tzf", archivePath], { stdout: "pipe", stderr: "pipe" });
if (filesResult.exitCode !== 0) throw new Error(new TextDecoder().decode(filesResult.stderr));
const actual = new TextDecoder().decode(filesResult.stdout).trim().split("\n").sort();
if (JSON.stringify(actual) !== JSON.stringify(expected.sort())) throw new Error(`Unexpected package files: ${actual.join(", ")}`);
if (!existsSync(join(packageRoot, "dist/main.js"))) throw new Error("Build output is missing");
console.log(`Package manifest and ${actual.length} files verified: ${archive}`);
