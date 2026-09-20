import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Deferred, Effect, Fiber } from "effect";
import { makeArtifactDownloader, validateArtifactUrl } from "../src/artifact-download.ts";

const signed = "https://cloud-agent-artifacts.s3.us-east-1.amazonaws.com/proof?X-Amz-Signature=test-only";
const target = () => join(mkdtempSync(join(tmpdir(), "cursor-use-download-")), "proof.txt");

test("both documented and live-verified Cursor buckets are accepted, not arbitrary S3 buckets", () => {
  expect(validateArtifactUrl("https://agent-stores.s3.us-east-1.amazonaws.com/stores/example?signature=test")).toContain("agent-stores.s3.us-east-1.amazonaws.com");
  expect(() => validateArtifactUrl("https://unrelated.s3.us-east-1.amazonaws.com/data")).toThrow();
});

test("artifact downloader writes exact bytes with a digest and never sends API authorization", async () => {
  let observed: RequestInit | undefined;
  const data = "cursor-use artifact proof\n";
  const client = makeArtifactDownloader(async (_url, init) => { observed = init; return new Response(data); });
  const output = target();
  const digest = createHash("sha256").update(data).digest("hex");
  const receipt = await Effect.runPromise(client.download(signed, output, { expectedSha256: digest }));
  expect(receipt).toEqual({ output, bytes: Buffer.byteLength(data), sha256: digest });
  expect(readFileSync(output, "utf8")).toBe(data);
  expect(statSync(output).mode & 0o777).toBe(0o600);
  expect(new Headers(observed?.headers).has("Authorization")).toBe(false);
  expect(observed).toMatchObject({ redirect: "error", credentials: "omit" });
});

test("artifact downloader rejects non-verified hosts before making a request", async () => {
  let calls = 0;
  const client = makeArtifactDownloader(async () => { calls++; return new Response("unexpected"); });
  for (const url of ["http://cloud-agent-artifacts.s3.us-east-1.amazonaws.com/x", "https://127.0.0.1/x", "https://cloud-agent-artifacts.s3.us-east-1.amazonaws.com.evil.test/x", "https://user:password@cloud-agent-artifacts.s3.us-east-1.amazonaws.com/x"]) {
    const result = await Effect.runPromise(Effect.result(client.download(url, target(), {})));
    expect(result._tag).toBe("Failure");
  }
  expect(calls).toBe(0);
});

test("artifact downloader refuses existing files and symlinks", async () => {
  const client = makeArtifactDownloader(async () => new Response("replacement"));
  const output = target();
  writeFileSync(output, "keep");
  const alias = `${output}.link`;
  symlinkSync(output, alias);
  for (const path of [output, alias]) {
    const result = await Effect.runPromise(Effect.result(client.download(signed, path, {})));
    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected failure");
    expect(result.failure.code).toBe("OUTPUT_EXISTS");
  }
  expect(readFileSync(output, "utf8")).toBe("keep");
});

test("oversized streaming downloads retain the partial file without retrying or deleting", async () => {
  let calls = 0;
  const client = makeArtifactDownloader(async () => {
    calls++;
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("abc")); c.enqueue(new TextEncoder().encode("def")); c.close(); } }));
  });
  const output = target();
  const result = await Effect.runPromise(Effect.result(client.download(signed, output, { maxBytes: 4 })));
  expect(result._tag).toBe("Failure");
  if (result._tag !== "Failure") throw new Error("Expected failure");
  expect(result.failure).toMatchObject({ code: "ARTIFACT_TOO_LARGE", details: { output, bytesWritten: 3, partialFileRetained: true } });
  expect(readFileSync(output, "utf8")).toBe("abc");
  expect(calls).toBe(1);
});

test("expired URLs leave no output and are not copied into errors", async () => {
  const client = makeArtifactDownloader(async () => new Response("expired", { status: 403 }));
  const output = target();
  const result = await Effect.runPromise(Effect.result(client.download(signed, output, {})));
  expect(result._tag).toBe("Failure");
  if (result._tag !== "Failure") throw new Error("Expected failure");
  expect(result.failure.code).toBe("ARTIFACT_HTTP_ERROR");
  expect(JSON.stringify(result.failure)).not.toContain("X-Amz-Signature");
  expect(existsSync(output)).toBe(false);
});

test("checksum mismatch is a failure and retains the unverified output", async () => {
  const client = makeArtifactDownloader(async () => new Response("payload"));
  const output = target();
  const result = await Effect.runPromise(Effect.result(client.download(signed, output, { expectedSha256: "0".repeat(64) })));
  expect(result._tag).toBe("Failure");
  if (result._tag !== "Failure") throw new Error("Expected failure");
  expect(result.failure.code).toBe("CHECKSUM_MISMATCH");
  expect(readFileSync(output, "utf8")).toBe("payload");
});

test("interrupting a pending artifact connection aborts the transport", async () => {
  let signal: AbortSignal | undefined;
  await Effect.runPromise(Effect.gen(function* () {
    const ready = yield* Deferred.make<void>();
    const client = makeArtifactDownloader((_url, init) => {
      signal = init.signal!;
      Effect.runSync(Deferred.succeed(ready, undefined));
      return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    const fiber = yield* Effect.forkChild(client.download(signed, target(), {}));
    yield* Deferred.await(ready);
    yield* Fiber.interrupt(fiber);
  }));
  expect(signal?.aborted).toBe(true);
});
