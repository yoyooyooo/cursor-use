import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type SemVer = { major: number; minor: number; patch: number };
export type BumpKind = "major" | "minor" | "patch";

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RELEASED_HEADING = /^## (\d+\.\d+\.\d+) - (\d{4}-\d{2}-\d{2})$/;
const UNRELEASED_HEADING = "## Unreleased\n";
const PACKAGE_FILES = ["package.json", "CHANGELOG.md", "CHANGELOG.zh-CN.md"] as const;

export type ReleaseFlags = {
  spec: string;
  dryRun: boolean;
  commit: boolean;
  push: boolean;
  date: string | undefined;
};

export type ReleasePlan = {
  from: string;
  version: string;
  tag: string;
  date: string;
  packageJson: string;
  changelog: string;
  changelogZh: string;
  unreleased: { en: string[]; zh: string[] };
};

export function parseSemVer(text: string): SemVer {
  const match = VERSION_PATTERN.exec(text);
  if (!match) throw new Error(`Expected x.y.z, received ${text}.`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function formatSemVer(version: SemVer): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function bumpSemVer(version: SemVer, kind: BumpKind): SemVer {
  if (kind === "major") return { major: version.major + 1, minor: 0, patch: 0 };
  if (kind === "minor") return { major: version.major, minor: version.minor + 1, patch: 0 };
  return { major: version.major, minor: version.minor, patch: version.patch + 1 };
}

export function compareSemVer(left: SemVer, right: SemVer): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function extractUnreleasedItems(text: string): string[] {
  return unreleasedBody(text)
    .split("\n")
    .map(line => line.trimEnd())
    .filter(line => line.length > 0);
}

export function latestReleasedVersion(text: string): string {
  const remainder = text.slice(unreleasedEnd(text));
  const line = remainder.split("\n")[0] ?? "";
  const match = RELEASED_HEADING.exec(line);
  if (!match) throw new Error("CHANGELOG is missing a previous version heading.");
  return match[1]!;
}

export function promoteChangelog(text: string, version: string, date: string): string {
  const items = unreleasedItems(text);
  if (items.length === 0) throw new Error("Unreleased is empty; write notes before cutting a release.");
  const remainder = text.slice(unreleasedEnd(text));
  if (remainder.startsWith(`## ${version} `) || remainder.startsWith(`## ${version}\n`)) {
    throw new Error(`CHANGELOG already has ${version}.`);
  }
  const start = text.indexOf(UNRELEASED_HEADING);
  return `${text.slice(0, start)}## Unreleased\n\n## ${version} - ${date}\n\n${items.join("\n")}\n\n${remainder}`;
}

export function setPackageVersion(text: string, version: string): string {
  const manifest = JSON.parse(text) as { version: string };
  if (typeof manifest.version !== "string") throw new Error("package.json is missing version.");
  return `${JSON.stringify({ ...manifest, version }, null, 2)}\n`;
}

export function parseReleaseArgs(argv: string[]): ReleaseFlags {
  const rest = argv[0]?.endsWith("release.ts") ? argv.slice(1) : argv;
  let spec: string | undefined;
  let dryRun = false;
  let commit = false;
  let push = false;
  let date: string | undefined;
  for (const arg of rest) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--commit") commit = true;
    else if (arg === "--push") push = true;
    else if (arg.startsWith("--date=")) date = arg.slice("--date=".length);
    else if (arg === "--date") throw new Error("Use --date=YYYY-MM-DD.");
    else if (arg.startsWith("-")) throw new Error(`Unknown flag ${arg}.`);
    else if (spec) throw new Error(`Unexpected argument ${arg}.`);
    else spec = arg;
  }
  if (!spec) throw new Error("Usage: bun run release -- <patch|minor|major|x.y.z> [--dry-run|--commit|--push] [--date=YYYY-MM-DD]");
  if (date !== undefined && !DATE_PATTERN.test(date)) throw new Error("Use --date=YYYY-MM-DD.");
  if (push) commit = true;
  if (!commit && !push) dryRun = true;
  if (dryRun && (commit || push)) throw new Error("Do not combine --dry-run with --commit or --push.");
  return { spec, dryRun, commit, push, date };
}

export function planRelease(input: {
  packageJson: string;
  changelog: string;
  changelogZh: string;
  spec: string;
  date: string;
}): ReleasePlan {
  const manifest = JSON.parse(input.packageJson) as { version?: string };
  if (!manifest.version) throw new Error("package.json is missing version.");
  const from = parseSemVer(manifest.version);
  const version = nextVersion(from, input.spec);
  if (compareSemVer(parseSemVer(version), from) <= 0) throw new Error(`Version ${version} must be greater than ${manifest.version}.`);
  if (!DATE_PATTERN.test(input.date)) throw new Error("Release date must be YYYY-MM-DD.");
  const latestEn = latestReleasedVersion(input.changelog);
  const latestZh = latestReleasedVersion(input.changelogZh);
  if (latestEn !== manifest.version || latestZh !== manifest.version) {
    throw new Error(`Changelog latest versions ${latestEn}/${latestZh} must match package.json ${manifest.version}.`);
  }
  const unreleased = { en: unreleasedItems(input.changelog), zh: unreleasedItems(input.changelogZh) };
  if (unreleased.en.length === 0 || unreleased.zh.length === 0) {
    throw new Error("Unreleased is empty; write notes before cutting a release.");
  }
  if (unreleased.en.length !== unreleased.zh.length) {
    throw new Error(`Unreleased note counts differ: English ${unreleased.en.length}, Chinese ${unreleased.zh.length}.`);
  }
  return {
    from: manifest.version,
    version,
    tag: `v${version}`,
    date: input.date,
    packageJson: setPackageVersion(input.packageJson, version),
    changelog: promoteChangelog(input.changelog, version, input.date),
    changelogZh: promoteChangelog(input.changelogZh, version, input.date),
    unreleased,
  };
}

function nextVersion(from: SemVer, spec: string): string {
  if (spec === "major" || spec === "minor" || spec === "patch") return formatSemVer(bumpSemVer(from, spec));
  return formatSemVer(parseSemVer(spec));
}

function unreleasedBody(text: string): string {
  const start = text.indexOf(UNRELEASED_HEADING);
  if (start < 0) throw new Error("CHANGELOG is missing an Unreleased heading.");
  return text.slice(start + UNRELEASED_HEADING.length, unreleasedEnd(text));
}

function unreleasedEnd(text: string): number {
  const start = text.indexOf(UNRELEASED_HEADING);
  if (start < 0) throw new Error("CHANGELOG is missing an Unreleased heading.");
  const bodyStart = start + UNRELEASED_HEADING.length;
  const next = text.slice(bodyStart).search(/^## /m);
  if (next < 0) throw new Error("CHANGELOG is missing a previous version heading.");
  return bodyStart + next;
}

function unreleasedItems(text: string): string[] {
  const items: string[] = [];
  for (const line of extractUnreleasedItems(text)) {
    if (!line.startsWith("- ")) throw new Error(`Unreleased may only contain "- " notes, found: ${line}`);
    items.push(line);
  }
  return items;
}

type GitResult = { stdout: string; stderr: string; exitCode: number };

function git(cwd: string, args: string[]): GitResult {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    stdout: new TextDecoder().decode(result.stdout).trim(),
    stderr: new TextDecoder().decode(result.stderr),
    exitCode: result.exitCode ?? 1,
  };
}

function requireGit(cwd: string, args: string[]): string {
  const result = git(cwd, args);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed.`);
  return result.stdout;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function main() {
  let flags: ReleaseFlags;
  try {
    flags = parseReleaseArgs(process.argv.slice(1));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const cwd = process.cwd();
  if (git(cwd, ["rev-parse", "--is-inside-work-tree"]).stdout !== "true") fail("Run bun run release from a git repository root.");
  if (!flags.dryRun && requireGit(cwd, ["status", "--porcelain"]) !== "") fail("Working tree must be clean.");
  if (flags.commit && requireGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") {
    fail("Commit and push only from main.");
  }
  const date = flags.date ?? utcDate();
  let plan: ReleasePlan;
  try {
    plan = planRelease({
      packageJson: readFileSync(join(cwd, "package.json"), "utf8"),
      changelog: readFileSync(join(cwd, "CHANGELOG.md"), "utf8"),
      changelogZh: readFileSync(join(cwd, "CHANGELOG.zh-CN.md"), "utf8"),
      spec: flags.spec,
      date,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!flags.dryRun) {
    if (git(cwd, ["rev-parse", "-q", "--verify", `refs/tags/${plan.tag}`]).exitCode === 0) {
      fail(`Tag ${plan.tag} already exists.`);
    }
    writeFileSync(join(cwd, "package.json"), plan.packageJson);
    writeFileSync(join(cwd, "CHANGELOG.md"), plan.changelog);
    writeFileSync(join(cwd, "CHANGELOG.zh-CN.md"), plan.changelogZh);
  }
  if (flags.commit) {
    requireGit(cwd, ["add", ...PACKAGE_FILES]);
    requireGit(cwd, ["commit", "-m", `Release ${plan.version}.`]);
    requireGit(cwd, ["tag", plan.tag]);
  }
  let pushed = false;
  if (flags.push) {
    requireGit(cwd, ["push", "-u", "origin", "HEAD"]);
    requireGit(cwd, ["push", "origin", plan.tag]);
    pushed = true;
  }
  process.stdout.write(`${JSON.stringify({
    from: plan.from,
    version: plan.version,
    tag: plan.tag,
    date: plan.date,
    unreleased: plan.unreleased,
    wrote: !flags.dryRun,
    commit: flags.commit,
    tagCreated: flags.commit,
    pushed,
  }, null, 2)}\n`);
}

if (import.meta.main) main();
