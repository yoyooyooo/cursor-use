#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { cli } from "./cli.ts";
import { CursorApiLive } from "./cursor-api.ts";
import { ReceiptStoreLive } from "./receipts.ts";
import { ArtifactDownloaderLive } from "./artifact-download.ts";

cli.pipe(
  Effect.provide(BunServices.layer),
  Effect.provide(CursorApiLive),
  Effect.provide(ReceiptStoreLive),
  Effect.provide(ArtifactDownloaderLive),
  BunRuntime.runMain({ disableErrorReporting: true }),
);
