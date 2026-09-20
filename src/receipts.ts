import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer, Schedule, Schema } from "effect";
import { Fault } from "./errors.ts";

export const ReceiptSchema = Schema.Struct({
  requestId: Schema.String,
  operation: Schema.Literals(["launch", "follow-up"]),
  account: Schema.String,
  fingerprint: Schema.String,
  agentId: Schema.String,
  runId: Schema.optional(Schema.String),
  runAttribution: Schema.optional(Schema.Literals(["confirmed", "latest-observed", "operator-selected"])),
  baselineRunId: Schema.optional(Schema.String),
  state: Schema.Literals(["prepared", "dispatching", "submitted", "unknown", "rejected"]),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  target: Schema.optional(Schema.String),
  environmentName: Schema.optional(Schema.String),
  expectedRepos: Schema.optional(Schema.Array(Schema.Struct({ url: Schema.String, startingRef: Schema.optional(Schema.String) }))),
  scratch: Schema.optional(Schema.Boolean),
  error: Schema.optional(Schema.String),
});
export type Receipt = typeof ReceiptSchema.Type;

export class ReceiptStore extends Context.Service<ReceiptStore, {
  readonly prepare: (receipt: Receipt) => Effect.Effect<Receipt, Fault>;
  readonly get: (requestId: string) => Effect.Effect<Receipt, Fault>;
  readonly claim: (requestId: string) => Effect.Effect<boolean, Fault>;
  readonly update: (requestId: string, patch: Pick<Receipt, "state"> & Partial<Pick<Receipt, "runId" | "error" | "runAttribution">>) => Effect.Effect<Receipt, Fault>;
  readonly list: () => Effect.Effect<ReadonlyArray<Receipt>, Fault>;
  readonly addEnvironment: (name: string) => Effect.Effect<void, Fault>;
  readonly environments: () => Effect.Effect<ReadonlyArray<{ name: string; createdAt: string }>, Fault>;
}>()("cursor-use/ReceiptStore") {}

export function makeReceiptStore(directory: string): typeof ReceiptStore.Service {
  const databasePath = join(directory, "state.sqlite");
  const storageFault = (error: unknown) => {
    if (error instanceof Fault) return error;
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
    return new Fault({ code: code.startsWith("SQLITE_BUSY") || code === "SQLITE_LOCKED" ? "LOCAL_STORE_BUSY" : "LOCAL_STORE_ERROR", message: "Unable to read or update cursor-use state.", details: { storageCode: code } });
  };
  const using = <A>(body: (db: Database) => A): Effect.Effect<A, Fault> => Effect.acquireUseRelease(
    Effect.try({
      try: () => {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const db = new Database(databasePath, { create: true });
        try {
          chmodSync(databasePath, 0o600);
          db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
          db.exec("CREATE TABLE IF NOT EXISTS receipts (request_id TEXT PRIMARY KEY, account TEXT NOT NULL, fingerprint TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS environments (name TEXT PRIMARY KEY, created_at TEXT NOT NULL);");
          return db;
        } catch (error) { db.close(); throw error; }
      },
      catch: storageFault,
    }),
    (db) => Effect.try({ try: () => body(db), catch: storageFault }),
    (db) => Effect.sync(() => db.close()),
  ).pipe(Effect.retry({ times: 4, while: (error) => error.code === "LOCAL_STORE_BUSY", schedule: Schedule.spaced("50 millis") }));
  const parse = (row: { data: string }) => Schema.decodeUnknownSync(ReceiptSchema)(JSON.parse(row.data));
  const get = (db: Database, id: string) => {
    const row = db.query<{ data: string }, [string]>("SELECT data FROM receipts WHERE request_id = ?").get(id);
    if (!row) throw new Fault({ code: "NOT_FOUND", message: "Local request receipt not found.", details: { requestId: id } });
    return parse(row);
  };
  const save = (db: Database, receipt: Receipt) => {
    db.query("UPDATE receipts SET state = ?, data = ? WHERE request_id = ?").run(receipt.state, JSON.stringify(receipt), receipt.requestId);
    return receipt;
  };

  return {
    prepare: (receipt) => using((db) => db.transaction(() => {
      db.query("INSERT INTO receipts (request_id, account, fingerprint, state, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").run(receipt.requestId, receipt.account, receipt.fingerprint, receipt.state, JSON.stringify(receipt));
      const existing = get(db, receipt.requestId);
      if (existing.account !== receipt.account || existing.fingerprint !== receipt.fingerprint) {
        throw new Fault({ code: "REQUEST_CONFLICT", message: "This request ID belongs to a different account or task. No cloud operation was sent." });
      }
      return existing;
    }).immediate()),
    get: (id) => using((db) => get(db, id)),
    claim: (id) => using((db) => db.transaction(() => {
      const receipt = get(db, id);
      if (receipt.state !== "prepared") return false;
      save(db, { ...receipt, state: "dispatching", updatedAt: new Date().toISOString() });
      return true;
    }).immediate()),
    update: (id, patch) => using((db) => db.transaction(() => {
      const current = get(db, id);
      // A late timeout or a weaker observation cannot erase an accepted submission.
      if (current.state === "submitted") {
        if (patch.state !== "submitted") return current;
        const rank = (attribution: Receipt["runAttribution"]) => attribution === "latest-observed" ? 1 : attribution === "operator-selected" ? 2 : 3;
        if (patch.runAttribution && rank(patch.runAttribution) < rank(current.runAttribution)) return current;
        if (current.runId && patch.runId && current.runId !== patch.runId) {
          if (rank(current.runAttribution) === 3) throw new Fault({ code: "RECEIPT_CONFLICT", message: "A confirmed run cannot be replaced by a different run." });
          if (rank(patch.runAttribution) <= rank(current.runAttribution)) return current;
        }
      }
      return save(db, { ...current, ...patch, updatedAt: new Date().toISOString() });
    }).immediate()),
    list: () => using((db) => db.query<{ data: string }, []>("SELECT data FROM receipts ORDER BY rowid DESC").all().map(parse)),
    addEnvironment: (name) => using((db) => { db.query("INSERT INTO environments (name, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING").run(name, new Date().toISOString()); }),
    environments: () => using((db) => db.query<{ name: string; createdAt: string }, []>("SELECT name, created_at AS createdAt FROM environments ORDER BY name").all()),
  };
}

export const ReceiptStoreLive = Layer.sync(ReceiptStore, () => makeReceiptStore(
  process.env.CURSOR_USE_STATE_DIR ?? join(homedir(), ".local", "state", "cursor-use"),
));
