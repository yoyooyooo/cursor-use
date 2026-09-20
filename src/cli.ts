import { Cause, Console, Effect, Exit, FileSystem, Option, Schema } from "effect";
import { CliConfig, Command, Flag, GlobalFlag } from "effect/unstable/cli";
import { name, version } from "../package.json";
import { Fault } from "./errors.ts";
import { respond, writeJson } from "./output.ts";
import { ReceiptStore } from "./receipts.ts";
import * as operations from "./operations.ts";
import { streamRun } from "./run-stream.ts";
import { downloadArtifact } from "./artifact-download.ts";
import { ModelParam } from "./schemas.ts";
import { loadUserConfig } from "./config.ts";

const optionalString = (name: string) => Flag.string(name).pipe(Flag.optional);
const id = Flag.string("agent-id");
const runId = Flag.string("run-id");
const limit = Flag.integer("limit").pipe(Flag.withDefault(20));
const cursor = optionalString("cursor");
const promptFlags = { prompt: optionalString("prompt"), promptFile: optionalString("prompt-file") };
const optional = Option.getOrUndefined;
const pageFlags = { all: Flag.boolean("all"), maxPages: Flag.integer("max-pages").pipe(Flag.withDefault(10)) };
const waitTimeout = Flag.integer("timeout").pipe(Flag.optional);
const waitInterval = Flag.integer("interval").pipe(Flag.optional);
const streamTimeout = Flag.integer("timeout").pipe(Flag.optional);
const streamReconnects = Flag.integer("reconnects").pipe(Flag.optional);

function readInputFile(path: string, maxBytes: number) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat(path).pipe(Effect.mapError(() => new Fault({ code: "INVALID_INPUT", message: "Unable to inspect the input file." })));
    if (info.type !== "File" || info.size > maxBytes) return yield* Effect.fail(new Fault({ code: "INVALID_INPUT", message: `Input must be a regular file of at most ${maxBytes} bytes.` }));
    const text = yield* fs.readFileString(path).pipe(Effect.mapError(() => new Fault({ code: "INVALID_INPUT", message: "Unable to read the input file." })));
    if (Buffer.byteLength(text) > maxBytes) return yield* Effect.fail(new Fault({ code: "INVALID_INPUT", message: "Input grew beyond its size limit." }));
    return text;
  });
}

function readJson<A>(path: Option.Option<string>, schema: Schema.Codec<A>) {
  return Effect.gen(function* () {
    if (Option.isNone(path)) return undefined;
    const text = yield* readInputFile(path.value, 64 * 1024);
    return yield* operations.validate(() => Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(JSON.parse(text)));
  });
}

function readPrompt(args: { prompt: Option.Option<string>; promptFile: Option.Option<string> }) {
  return Effect.gen(function* () {
    if (Option.isSome(args.prompt) === Option.isSome(args.promptFile)) return yield* Effect.fail(new Fault({ code: "INVALID_INPUT", message: "Provide exactly one of --prompt or --prompt-file." }));
    if (Option.isSome(args.prompt)) return args.prompt.value;
    return yield* readInputFile(Option.getOrThrow(args.promptFile), 512 * 1024);
  });
}

const agents = Command.make("agents").pipe(Command.withSubcommands([
  Command.make("list", { limit, cursor, ...pageFlags, excludeArchived: Flag.boolean("exclude-archived"), prUrl: optionalString("pr-url") }, (args) => respond(operations.listAgents(args.limit, optional(args.cursor), { ...args, includeArchived: args.excludeArchived ? false : undefined, prUrl: optional(args.prUrl) }))),
  Command.make("show", { agentId: id }, (args) => respond(operations.getAgent(args.agentId))),
  Command.make("result", { agentId: id, runId: optionalString("run-id") }, args => respond(operations.agentResult(args.agentId, optional(args.runId)))),
  Command.make("launch", {
    ...promptFlags,
    env: optionalString("env"), repo: optionalString("repo"), ref: optionalString("ref"),
    scratch: Flag.boolean("scratch"), model: optionalString("model"), name: optionalString("name"),
    autoPr: Flag.boolean("auto-pr"), mode: optionalString("mode"), requestId: optionalString("request-id"),
    modelParams: optionalString("model-params-file"), repos: optionalString("repos-file"), dryRun: Flag.boolean("dry-run"),
  }, (args) => respond(Effect.gen(function* () {
    const prompt = yield* readPrompt(args);
    const config = yield* loadUserConfig();
    const cliModel = optional(args.model);
    const modelParams = yield* readJson(args.modelParams, Schema.Array(ModelParam));
    const repos = yield* readJson(args.repos, Schema.Array(Schema.Struct({ url: Schema.String, startingRef: Schema.optional(Schema.String) })));
    const model = cliModel ?? config.model?.id;
    const effectiveModelParams = modelParams ?? (cliModel === undefined ? config.model?.params : undefined);
    const input = { prompt, env: optional(args.env), repo: optional(args.repo), ref: optional(args.ref), scratch: args.scratch, model, name: optional(args.name), autoPr: args.autoPr, mode: optional(args.mode), requestId: optional(args.requestId), modelParams: effectiveModelParams, repos };
    return yield* args.dryRun ? operations.validate(() => operations.previewLaunch(input)) : operations.launch(input);
  }))).pipe(Command.withDescription("Start a paid Cloud Agent. Saves a recovery receipt before submission.")),
  Command.make("follow-up", { agentId: id, ...promptFlags, requestId: optionalString("request-id"), mode: optionalString("mode") }, (args) => respond(Effect.gen(function* () {
    const prompt = yield* readPrompt(args);
    return yield* operations.followUp({ agentId: args.agentId, prompt, requestId: optional(args.requestId), mode: optional(args.mode) });
  }))),
  Command.make("reconcile", { requestId: Flag.string("request-id") }, (args) => respond(operations.reconcile(args.requestId))),
]));

const runs = Command.make("runs").pipe(Command.withSubcommands([
  Command.make("list", { agentId: id, limit, cursor, ...pageFlags }, (args) => respond(operations.listRuns(args.agentId, args.limit, optional(args.cursor), args))),
  Command.make("show", { agentId: id, runId }, (args) => respond(operations.getRun(args.agentId, args.runId))),
  Command.make("wait", {
    agentId: id, runId,
    timeout: waitTimeout,
    interval: waitInterval,
  }, (args) => respond(Effect.gen(function* () {
    const config = yield* loadUserConfig();
    return yield* operations.waitRun(args.agentId, args.runId, optional(args.timeout) ?? config.wait?.timeoutSeconds ?? 600, optional(args.interval) ?? config.wait?.intervalSeconds ?? 5);
  }))),
  Command.make("cancel", { agentId: id, runId }, (args) => respond(operations.cancelRun(args.agentId, args.runId))),
  Command.make("stream", { agentId: id, runId, afterEvent: optionalString("after-event"), timeout: streamTimeout, reconnects: streamReconnects }, args => respond(Effect.gen(function* () {
    const config = yield* loadUserConfig();
    return yield* streamRun(args.agentId, args.runId, { afterEvent: optional(args.afterEvent), timeoutSeconds: optional(args.timeout) ?? config.stream?.timeoutSeconds ?? 600, reconnects: optional(args.reconnects) ?? config.stream?.reconnects ?? 3 }, event => writeJson({ ok: true, type: "event", agentId: args.agentId, runId: args.runId, ...event }));
  }))),
]));

const receipts = Command.make("receipts").pipe(Command.withSubcommands([
  Command.make("list", {}, () => respond(Effect.gen(function* () { return yield* (yield* ReceiptStore).list(); }))),
  Command.make("show", { requestId: Flag.string("request-id") }, (args) => respond(Effect.gen(function* () { return yield* (yield* ReceiptStore).get(args.requestId); }))),
  Command.make("bind-run", { requestId: Flag.string("request-id"), runId, confirm: Flag.boolean("confirm") }, args => respond(operations.bindRun(args.requestId, args.runId, args.confirm))),
]));

const environments = Command.make("envs").pipe(Command.withSubcommands([
  Command.make("add", { name: Flag.string("name") }, (args) => respond(operations.addEnvironment(args.name))),
  Command.make("list", { observed: Flag.boolean("observed"), limit, ...pageFlags }, (args) => respond(operations.listEnvironments(args.observed, args.limit, args))),
]));

const artifacts = Command.make("artifacts").pipe(Command.withSubcommands([
  Command.make("list", { agentId: id }, (args) => respond(operations.artifacts(args.agentId))),
  Command.make("url", { agentId: id, path: Flag.string("path") }, (args) => respond(operations.artifacts(args.agentId, args.path))),
  Command.make("download", { agentId: id, path: Flag.string("path"), output: Flag.string("output"), maxBytes: Flag.integer("max-bytes").pipe(Flag.withDefault(64 * 1024 * 1024)), timeout: Flag.integer("timeout").pipe(Flag.withDefault(120)), sha256: optionalString("sha256") }, args => respond(downloadArtifact(args.agentId, args.path, args.output, { maxBytes: args.maxBytes, timeoutSeconds: args.timeout, expectedSha256: optional(args.sha256) }))),
]));

const command = Command.make(name).pipe(
  Command.withDescription("Control Cursor Cloud Agents with recoverable requests and JSON results."),
  Command.withSharedFlags({ json: Flag.boolean("json").pipe(Flag.withDescription("JSON is the default for business commands.")) }),
  Command.withSubcommands([
    Command.make("capabilities", {}, () => respond(Effect.succeed(operations.capabilities))),
    Command.make("doctor", {}, () => respond(Effect.gen(function* () { return { identity: yield* operations.whoami(), runtime: { bun: Bun.version, version }, capabilities: operations.capabilities }; }))),
    Command.make("models", {}, () => respond(operations.models())),
    Command.make("repos", {}, () => respond(operations.repositories())),
    agents, runs, receipts, environments, artifacts,
    Command.make("usage", { agentId: id, runId: optionalString("run-id") }, (args) => respond(operations.usage(args.agentId, optional(args.runId)))),
    Command.make("projects").pipe(Command.withSubcommands([
      Command.make("list", {}, () => Effect.fail(new Fault({ code: "UNSUPPORTED", message: "Native Projects listing has no verified public API. Repositories and environment groups are not Projects.", details: { url: "https://cursor.com/docs/agent/projects" } }))),
    ])),
  ]),
);

export const cli = Effect.gen(function* () {
  const terminal = yield* Console.Console;
  const output: Array<ReadonlyArray<unknown>> = [];
  const diagnostics: Array<ReadonlyArray<unknown>> = [];

  // This beta prints parse-error help to stdout. Route it after the outcome is known.
  const result = yield* command.pipe(
    Command.run({ version }),
    Effect.provide(CliConfig.layer({ builtIns: [GlobalFlag.Help, GlobalFlag.Version] })),
    Effect.provideService(Console.Console, {
      ...terminal,
      log: (...args) => {
        output.push(args);
      },
      error: (...args) => {
        diagnostics.push(args);
      },
    }),
    Effect.catchTag("ShowHelp", (error) =>
      error.errors.length === 0 ? Effect.void : Effect.fail(error),
    ),
    Effect.exit,
  );

  if (Exit.isSuccess(result)) {
    for (const args of output) yield* Console.log(...args);
    return;
  }

  if (Cause.hasInterruptsOnly(result.cause)) return yield* Effect.failCause(result.cause);
  const error = optional(Cause.findErrorOption(result.cause));
  const fault = error instanceof Fault ? error : new Fault({
    code: error === undefined ? "INTERNAL_ERROR" : "INVALID_INPUT",
    message: error === undefined ? "Unexpected CLI defect." : "Invalid command arguments.",
    details: error === undefined ? Cause.pretty(result.cause) : { diagnostics: diagnostics.flat().map(String) },
  });
  yield* writeJson({ ok: false, error: { code: fault.code, message: fault.message, status: fault.status, uncertain: fault.uncertain, providerCode: fault.providerCode, retryAfterSeconds: fault.retryAfterSeconds, providerRequestId: fault.providerRequestId, details: fault.details } }, "stderr");
  return yield* Effect.fail(fault);
});
