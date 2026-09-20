import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { Context, Effect, Layer } from "effect";
import { Fault, assertInput, updateFault } from "./errors.ts";
import { artifacts, validate } from "./operations.ts";

export type DownloadOptions = { maxBytes?: number | undefined; timeoutSeconds?: number | undefined; expectedSha256?: string | undefined };
export type DownloadReceipt = { output: string; bytes: number; sha256: string };
export class ArtifactDownloader extends Context.Service<ArtifactDownloader, {
  readonly download: (url: string, output: string, options: DownloadOptions) => Effect.Effect<DownloadReceipt, Fault>;
}>()("cursor-use/ArtifactDownloader") {}

export function validateArtifactUrl(value: string) {
  const url = new URL(value);
  // The second bucket was verified through a real v1 artifact response.
  const bucketHost = /^(?:cloud-agent-artifacts|agent-stores)\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname);
  const pathStyle = url.hostname === "s3.amazonaws.com" && /^\/(?:cloud-agent-artifacts|agent-stores)\//.test(url.pathname);
  assertInput(url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash && (bucketHost || pathStyle), "Artifact downloads require a verified Cursor artifact S3 HTTPS URL.");
  return url.href;
}

export function makeArtifactDownloader(transport: (url: string, init: RequestInit) => Promise<Response> = fetch): typeof ArtifactDownloader.Service {
  return { download: (value, output, options) => Effect.scoped(Effect.gen(function* () {
    const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
    const timeoutSeconds = options.timeoutSeconds ?? 120;
    const url = yield* validate(() => {
      assertInput(Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= 512 * 1024 * 1024, "max-bytes must be between 1 and 536870912.");
      assertInput(Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 && timeoutSeconds <= 3600, "Download timeout must be between 0 and 3600 seconds.");
      assertInput(output.length > 0, "An explicit output file is required.");
      assertInput(!options.expectedSha256 || /^[a-fA-F0-9]{64}$/.test(options.expectedSha256), "Expected SHA-256 must contain 64 hexadecimal characters.");
      return validateArtifactUrl(value);
    });
    const target = resolve(output);
    let bytes = 0;
    let created = false;
    const controller = yield* Effect.acquireRelease(Effect.sync(() => new AbortController()), c => Effect.sync(() => c.abort()));
    const transfer = Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () => transport(url, { method: "GET", redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal }),
        catch: () => new Fault({ code: "ARTIFACT_NETWORK_ERROR", message: "Unable to fetch the artifact. Obtain a fresh URL if it expired." }),
      });
      yield* Effect.addFinalizer(() => Effect.promise(async () => { controller.abort(); if (!response.body?.locked) await response.body?.cancel().catch(() => undefined); }));
      if (!response.ok || !response.body) return yield* Effect.fail(new Fault({ code: "ARTIFACT_HTTP_ERROR", message: `Artifact server returned HTTP ${response.status}.`, status: response.status }));
      const declared = response.headers.get("content-length");
      if (declared !== null && Number(declared) > maxBytes) return yield* Effect.fail(new Fault({ code: "ARTIFACT_TOO_LARGE", message: "Artifact exceeds max-bytes." }));
      const reader = yield* Effect.acquireRelease(Effect.sync(() => response.body!.getReader()), r => Effect.promise(async () => { await r.cancel().catch(() => undefined); r.releaseLock(); }));
      const file = yield* Effect.acquireRelease(Effect.tryPromise({ try: async () => { const handle = await open(target, "wx", 0o600); created = true; return handle; }, catch: error => new Fault({ code: (error as NodeJS.ErrnoException).code === "EEXIST" ? "OUTPUT_EXISTS" : "LOCAL_FILE_ERROR", message: "Output must be a new file in an existing directory; no file was overwritten." }) }), handle => Effect.promise(() => handle.close()));
      const hash = createHash("sha256");
      while (true) {
        const chunk = yield* Effect.tryPromise({ try: () => reader.read(), catch: () => new Fault({ code: "ARTIFACT_NETWORK_ERROR", message: "Artifact transfer was interrupted." }) });
        if (chunk.done) break;
        if (bytes + chunk.value.byteLength > maxBytes) return yield* Effect.fail(new Fault({ code: "ARTIFACT_TOO_LARGE", message: "Artifact exceeded max-bytes while downloading." }));
        yield* Effect.tryPromise({ try: async () => {
          let offset = 0;
          while (offset < chunk.value.byteLength) {
            const written = await file.write(chunk.value, offset, chunk.value.byteLength - offset);
            if (written.bytesWritten === 0) throw new Error("No write progress");
            offset += written.bytesWritten;
            bytes += written.bytesWritten;
          }
        }, catch: () => new Fault({ code: "LOCAL_FILE_ERROR", message: "Unable to write the artifact output." }) });
        hash.update(chunk.value);
      }
      const sha256 = hash.digest("hex");
      if (declared !== null && !response.headers.get("content-encoding") && /^\d+$/.test(declared) && bytes !== Number(declared)) return yield* Effect.fail(new Fault({ code: "ARTIFACT_TRUNCATED", message: "Artifact length does not match Content-Length." }));
      if (options.expectedSha256 && options.expectedSha256.toLowerCase() !== sha256) return yield* Effect.fail(new Fault({ code: "CHECKSUM_MISMATCH", message: "Artifact SHA-256 does not match the expected digest." }));
      yield* Effect.tryPromise({ try: () => file.sync(), catch: () => new Fault({ code: "LOCAL_FILE_ERROR", message: "Unable to flush artifact output to disk." }) });
      return { output: target, bytes, sha256 };
    });
    return yield* transfer.pipe(
      Effect.timeoutOrElse({ duration: timeoutSeconds * 1000, orElse: () => Effect.fail(new Fault({ code: "DOWNLOAD_TIMEOUT", message: "Artifact download exceeded its local deadline." })) }),
      Effect.mapError(error => updateFault(error, { details: { output: target, bytesWritten: bytes, partialFileRetained: created } })),
    );
  })) };
}

export const ArtifactDownloaderLive = Layer.sync(ArtifactDownloader, () => makeArtifactDownloader());

export function downloadArtifact(agentId: string, artifactPath: string, output: string, options: DownloadOptions = {}) {
  return Effect.gen(function* () {
    const signed = yield* artifacts(agentId, artifactPath);
    if (!("url" in signed) || typeof signed.url !== "string") return yield* Effect.fail(new Fault({ code: "PROVIDER_CONTRACT", message: "Missing artifact URL." }));
    const downloader = yield* ArtifactDownloader;
    return { agentId, artifactPath, ...(yield* downloader.download(signed.url, output, options)) };
  });
}
