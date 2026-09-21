import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "../package.json";
import {
  bumpSemVer,
  extractUnreleasedItems,
  latestReleasedVersion,
  parseReleaseArgs,
  parseSemVer,
  planRelease,
  promoteChangelog,
} from "../scripts/release.ts";

const script = fileURLToPath(new URL("../scripts/release.ts", import.meta.url));

function changelog(unreleased: string) {
  return `# Changelog\n\n## Unreleased\n${unreleased}## 0.2.3 - 2026-09-21\n\n- shipped.\n`;
}

function git(cwd: string, args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr) || `git ${args.join(" ")} failed`);
  return new TextDecoder().decode(result.stdout).trim();
}

function runRelease(cwd: string, args: string[]) {
  return Bun.spawnSync(["bun", script, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
}

test("patch minor and major bumps stay on three-part versions", () => {
  const version = parseSemVer("0.2.3");
  expect(bumpSemVer(version, "patch")).toEqual({ major: 0, minor: 2, patch: 4 });
  expect(bumpSemVer(version, "minor")).toEqual({ major: 0, minor: 3, patch: 0 });
  expect(bumpSemVer(version, "major")).toEqual({ major: 1, minor: 0, patch: 0 });
});

test("parseReleaseArgs defaults to dry-run and treats --push as commit", () => {
  expect(parseReleaseArgs(["scripts/release.ts", "patch"])).toEqual({
    spec: "patch",
    dryRun: true,
    commit: false,
    push: false,
    date: undefined,
  });
  expect(parseReleaseArgs(["patch", "--push", "--date=2026-09-21"])).toEqual({
    spec: "patch",
    dryRun: false,
    commit: true,
    push: true,
    date: "2026-09-21",
  });
  expect(() => parseReleaseArgs(["patch", "--dry-run", "--commit"])).toThrow("Do not combine --dry-run");
  expect(() => parseReleaseArgs([])).toThrow("Usage:");
});

test("planRelease promotes Unreleased in both changelogs and bumps the package", () => {
  const plan = planRelease({
    packageJson: `${JSON.stringify({ name: "cursor-use", version: "0.2.3" }, null, 2)}\n`,
    changelog: changelog("\n- English note.\n\n"),
    changelogZh: changelog("\n- 中文说明。\n\n"),
    spec: "patch",
    date: "2026-09-22",
  });
  expect(plan).toMatchObject({ from: "0.2.3", version: "0.2.4", tag: "v0.2.4", date: "2026-09-22" });
  expect(JSON.parse(plan.packageJson).version).toBe("0.2.4");
  expect(plan.changelog).toContain("## Unreleased\n\n## 0.2.4 - 2026-09-22\n\n- English note.\n\n## 0.2.3 - 2026-09-21\n");
  expect(plan.changelogZh).toContain("- 中文说明。");
  expect(latestReleasedVersion(plan.changelog)).toBe("0.2.4");
});

test("planRelease refuses empty, unbalanced, or already-cut notes", () => {
  const packageJson = `${JSON.stringify({ version: "0.2.3" }, null, 2)}\n`;
  const en = changelog("\n- English note.\n\n");
  expect(() => planRelease({
    packageJson,
    changelog: changelog("\n"),
    changelogZh: changelog("\n- 中文说明。\n\n"),
    spec: "patch",
    date: "2026-09-22",
  })).toThrow("Unreleased is empty");
  expect(() => planRelease({
    packageJson,
    changelog: en,
    changelogZh: changelog("\n- one.\n- two.\n\n"),
    spec: "patch",
    date: "2026-09-22",
  })).toThrow("Unreleased note counts differ");
  expect(() => planRelease({
    packageJson,
    changelog: en,
    changelogZh: changelog("\n- 中文说明。\n\n"),
    spec: "0.2.3",
    date: "2026-09-22",
  })).toThrow("must be greater");
  expect(() => promoteChangelog(
    "# Changelog\n\n## Unreleased\n\n- English note.\n\n## 0.2.4 - 2026-09-22\n\n- already cut.\n",
    "0.2.4",
    "2026-09-22",
  )).toThrow("already has 0.2.4");
});

test("the repository changelogs match package.json and stay bilingual", async () => {
  const english = await Bun.file(new URL("../CHANGELOG.md", import.meta.url)).text();
  const chinese = await Bun.file(new URL("../CHANGELOG.zh-CN.md", import.meta.url)).text();
  expect(latestReleasedVersion(english)).toBe(manifest.version);
  expect(latestReleasedVersion(chinese)).toBe(manifest.version);
  expect(extractUnreleasedItems(english)).toHaveLength(extractUnreleasedItems(chinese).length);
});

test("release --commit writes, commits and tags on main", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cursor-use-release-"));
  writeFileSync(join(cwd, "package.json"), `${JSON.stringify({ name: "cursor-use", version: "0.2.3" }, null, 2)}\n`);
  writeFileSync(join(cwd, "CHANGELOG.md"), changelog("\n- English note.\n\n"));
  writeFileSync(join(cwd, "CHANGELOG.zh-CN.md"), changelog("\n- 中文说明。\n\n"));
  git(cwd, ["init", "-b", "main"]);
  git(cwd, ["config", "user.email", "release-test@example.com"]);
  git(cwd, ["config", "user.name", "Release Test"]);
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "seed"]);

  const dry = runRelease(cwd, ["patch", "--date=2026-09-22"]);
  expect({
    exitCode: dry.exitCode,
    stderr: new TextDecoder().decode(dry.stderr),
    stdout: JSON.parse(new TextDecoder().decode(dry.stdout)),
  }).toEqual({
    exitCode: 0,
    stderr: "",
    stdout: {
      from: "0.2.3",
      version: "0.2.4",
      tag: "v0.2.4",
      date: "2026-09-22",
      unreleased: { en: ["- English note."], zh: ["- 中文说明。"] },
      wrote: false,
      commit: false,
      tagCreated: false,
      pushed: false,
    },
  });
  expect(JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).version).toBe("0.2.3");

  const committed = runRelease(cwd, ["patch", "--commit", "--date=2026-09-22"]);
  expect(committed.exitCode).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(committed.stdout))).toMatchObject({
    version: "0.2.4",
    wrote: true,
    commit: true,
    tagCreated: true,
    pushed: false,
  });
  expect(JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).version).toBe("0.2.4");
  expect(git(cwd, ["log", "-1", "--pretty=%s"])).toBe("Release 0.2.4.");
  expect(git(cwd, ["status", "--porcelain"])).toBe("");
  expect(git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
  git(cwd, ["rev-parse", "v0.2.4"]);
});

test("release --commit refuses a dirty tree and non-main branches", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cursor-use-release-"));
  writeFileSync(join(cwd, "package.json"), `${JSON.stringify({ version: "0.2.3" }, null, 2)}\n`);
  writeFileSync(join(cwd, "CHANGELOG.md"), changelog("\n- English note.\n\n"));
  writeFileSync(join(cwd, "CHANGELOG.zh-CN.md"), changelog("\n- 中文说明。\n\n"));
  git(cwd, ["init", "-b", "main"]);
  git(cwd, ["config", "user.email", "release-test@example.com"]);
  git(cwd, ["config", "user.name", "Release Test"]);
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "seed"]);
  writeFileSync(join(cwd, "extra.txt"), "dirty\n");
  const dirty = runRelease(cwd, ["patch", "--commit", "--date=2026-09-22"]);
  expect(dirty.exitCode).toBe(1);
  expect(new TextDecoder().decode(dirty.stderr)).toContain("Working tree must be clean.");
  git(cwd, ["checkout", "-b", "topic"]);
  git(cwd, ["add", "extra.txt"]);
  git(cwd, ["commit", "-m", "dirty"]);
  const branch = runRelease(cwd, ["patch", "--commit", "--date=2026-09-22"]);
  expect(branch.exitCode).toBe(1);
  expect(new TextDecoder().decode(branch.stderr)).toContain("Commit and push only from main.");
});
