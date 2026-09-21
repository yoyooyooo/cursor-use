import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { version } from "../package.json";

const root = fileURLToPath(new URL("../", import.meta.url));

async function invoke(entrypoint: string, args: ReadonlyArray<string>, home = mkdtempSync(join(tmpdir(), "cursor-use-cli-home-"))) {
  const child = Bun.spawn([process.execPath, entrypoint, ...args], {
    cwd: root,
    env: { NO_COLOR: "1", TERM: "dumb", HOME: home },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 4_000,
  });

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    if (child.exitCode === null) child.kill();
  }
}

for (const entrypoint of ["src/main.ts", "dist/main.js"]) {
  describe(entrypoint, () => {
    test.each(["--help", "-h"])("%s describes the installed command without credentials", async (flag) => {
      const result = await invoke(entrypoint, [flag]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("cursor-use");
      expect(result.stdout).toContain("--help");
      expect(result.stdout).toContain("--version");
      expect(result.stdout).toContain("Control Cursor Cloud Agents");
      expect(result.stdout).toContain("agents");
      expect(result.stderr).toBe("");
    });

    test.each(["--version", "-v"])("%s agrees with the package being executed", async (flag) => {
      const result = await invoke(entrypoint, [flag]);
      expect(result).toEqual({ exitCode: 0, stdout: `cursor-use v${version}\n`, stderr: "" });
    });

    test("an unknown option fails instead of running a task", async () => {
      const result = await invoke(entrypoint, ["--not-a-real-option"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("not-a-real-option");
      expect(result.stdout).toBe("");
    });

    test("no arguments show help without starting an interactive prompt", async () => {
      const result = await invoke(entrypoint, []);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("cursor-use");
      expect(result.stdout).toContain("USAGE");
      expect(result.stdout).not.toContain("--wizard");
      expect(result.stderr).toBe("");
    });

    test("an unimplemented command fails instead of reporting success", async () => {
      const result = await invoke(entrypoint, ["not-implemented"]);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).error.code).toBe("INVALID_INPUT");
      expect(result.stdout).toBe("");
    });

    test("remote reads without a key fail with a machine-readable auth error", async () => {
      const result = await invoke(entrypoint, ["agents", "list", "--json"]);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
      expect(result.stdout).toBe("");
    });

    test("capabilities explicitly report unavailable native Projects", async () => {
      const result = await invoke(entrypoint, ["capabilities", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { nativeProjects: { available: false }, environmentCatalog: { complete: false } } });
      expect(result.stderr).toBe("");
      const projects = await invoke(entrypoint, ["projects", "list", "--json"]);
      expect(projects.exitCode).toBe(1);
      expect(JSON.parse(projects.stderr).error.code).toBe("UNSUPPORTED");
    });

    test("launch dry-run applies the user model default and explicit flags win", async () => {
      const home = mkdtempSync(join(tmpdir(), "cursor-use-cli-config-"));
      mkdirSync(join(home, ".cursor-use"));
      writeFileSync(join(home, ".cursor-use", "config.json"), JSON.stringify({ version: 1, model: { id: "grok-4.6", params: [{ id: "effort", value: "xhigh" }, { id: "fast", value: "false" }] } }));
      const configured = await invoke(entrypoint, ["agents", "launch", "--scratch", "--prompt", "configured model", "--dry-run", "--json"], home);
      expect(configured.exitCode).toBe(0);
      expect(JSON.parse(configured.stdout)).toMatchObject({ ok: true, data: { request: { model: { id: "grok-4.6", params: [{ id: "effort", value: "xhigh" }, { id: "fast", value: "false" }] } } } });
      const explicit = await invoke(entrypoint, ["agents", "launch", "--scratch", "--prompt", "explicit model", "--model", "test-model", "--dry-run", "--json"], home);
      expect(explicit.exitCode).toBe(0);
      expect(JSON.parse(explicit.stdout)).toMatchObject({ ok: true, data: { request: { model: { id: "test-model" } } } });
      expect(JSON.parse(explicit.stdout).data.request.model.params).toBeUndefined();
    });

    test("invalid user config fails before dry-run", async () => {
      const home = mkdtempSync(join(tmpdir(), "cursor-use-cli-config-"));
      mkdirSync(join(home, ".cursor-use"));
      writeFileSync(join(home, ".cursor-use", "config.json"), JSON.stringify({ version: 1, unsupported: true }));
      const result = await invoke(entrypoint, ["agents", "launch", "--scratch", "--prompt", "config failure", "--dry-run", "--json"], home);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({ ok: false, error: { code: "INVALID_CONFIG" } });
      expect(result.stdout).toBe("");
    });

    test("dry-run is offline and does not echo prompt contents", async () => {
      const result = await invoke(entrypoint, ["agents", "launch", "--scratch", "--prompt", "private test prompt", "--dry-run", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { dryRun: true, remoteValidated: false, receiptCreated: false } });
      expect(result.stdout).not.toContain("private test prompt");
      expect(result.stderr).toBe("");
    });

    test("env dry-run surfaces snapshot git limits without combining --repo", async () => {
      const result = await invoke(entrypoint, ["agents", "launch", "--env", "common", "--prompt", "private env prompt", "--dry-run", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        data: {
          dryRun: true,
          remoteValidated: false,
          request: { env: { type: "cloud", name: "common" } },
          git: {
            source: "named-environment-snapshot",
            repos: [],
            reposProvenance: "unavailable",
            requestIncludesRepos: false,
            promptDoesNotReplaceSnapshotRepos: true,
            envExclusiveOfRepoAndRef: true,
            authoritativeAfterLaunch: "agent.repos",
          },
        },
      });
      expect(JSON.parse(result.stdout).data.request.repos).toBeUndefined();
      expect(result.stdout).not.toContain("private env prompt");
      const combined = await invoke(entrypoint, ["agents", "launch", "--env", "common", "--repo", "https://github.com/example/repo", "--prompt", "no", "--dry-run", "--json"]);
      expect(combined.exitCode).toBe(1);
      expect(JSON.parse(combined.stderr).error.code).toBe("INVALID_INPUT");
    });

    test("follow-up, result and envs show help describe the lived recovery holes", async () => {
      const follow = await invoke(entrypoint, ["agents", "follow-up", "--help"]);
      expect(follow.exitCode).toBe(0);
      expect(follow.stdout).toContain("--wait");
      expect(follow.stdout.toLowerCase()).toContain("busy");
      const result = await invoke(entrypoint, ["agents", "result", "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("emptyResult");
      const envs = await invoke(entrypoint, ["envs", "show", "--help"]);
      expect(envs.exitCode).toBe(0);
      expect(envs.stdout).toContain("--name");
      expect(envs.stdout).toContain("--observed");
      const shown = await invoke(entrypoint, ["envs", "show", "--name", "common", "--json"]);
      expect(shown.exitCode).toBe(0);
      expect(JSON.parse(shown.stdout)).toMatchObject({
        ok: true,
        data: { name: "common", catalogAvailable: false, reposProvenance: "unavailable", git: { promptDoesNotReplaceSnapshotRepos: true } },
      });
    });
  });
}
