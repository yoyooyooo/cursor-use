import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("JSON output survives pipe backpressure beyond 64 KiB", async () => {
  const script = `import { Effect } from 'effect'; import { BunRuntime } from '@effect/platform-bun'; import { writeJson } from './src/output.ts'; writeJson({ok:true,data:'x'.repeat(300000)}).pipe(BunRuntime.runMain);`;
  const child = Bun.spawn([process.execPath, "--eval", script], { cwd: root, env: { NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe", timeout: 4000 });
  const reader = child.stdout.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(chunk.value);
  }
  reader.releaseLock();
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(result).toEqual({ ok: true, data: "x".repeat(300000) });
  expect(await child.exited).toBe(0);
  expect(await new Response(child.stderr).text()).toBe("");
});

test("independent CLI processes can initialize and update the same state directory", async () => {
  const directory = mkdtempSync(join(tmpdir(), "cursor-use-process-test-"));
  const children = Array.from({ length: 6 }, (_, index) => Bun.spawn([process.execPath, "dist/main.js", "envs", "add", "--name", `env-${index}`, "--json"], {
    cwd: root, env: { NO_COLOR: "1", CURSOR_USE_STATE_DIR: directory }, stdout: "pipe", stderr: "pipe", timeout: 4000,
  }));
  const results = await Promise.all(children.map(async (child) => ({ code: await child.exited, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text() })));
  for (const result of results) {
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).ok).toBe(true);
  }
  const child = Bun.spawn([process.execPath, "dist/main.js", "envs", "list", "--json"], { cwd: root, env: { CURSOR_USE_STATE_DIR: directory }, stdout: "pipe", stderr: "pipe", timeout: 4000 });
  const out = JSON.parse(await new Response(child.stdout).text());
  expect(out.data.items.map((item: { name: string }) => item.name)).toEqual(["env-0", "env-1", "env-2", "env-3", "env-4", "env-5"]);
  expect(await child.exited).toBe(0);
});
