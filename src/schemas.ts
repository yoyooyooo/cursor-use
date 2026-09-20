import { Effect, Schema } from "effect";
import { Fault } from "./errors.ts";

export const Me = Schema.Struct({
  userId: Schema.Union([Schema.String, Schema.Number]),
  apiKeyName: Schema.optional(Schema.String),
});

export const Agent = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  latestRunId: Schema.optional(Schema.String),
  repos: Schema.optional(Schema.Array(Schema.Struct({ url: Schema.String, startingRef: Schema.optional(Schema.String) }))),
  env: Schema.optional(Schema.Struct({
    type: Schema.String,
    name: Schema.optional(Schema.String),
  })),
});

export const Run = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  status: Schema.String,
  result: Schema.optional(Schema.String),
});

export const CreatedAgent = Schema.Struct({ agent: Agent, run: Run });
export const CreatedRun = Schema.Struct({ run: Run });
export const AgentPage = Schema.Struct({
  items: Schema.Array(Agent),
  nextCursor: Schema.optional(Schema.String),
});
export const RunPage = Schema.Struct({
  items: Schema.Array(Run),
  nextCursor: Schema.optional(Schema.String),
});
export const ModelParam = Schema.Struct({ id: Schema.String, value: Schema.String });
export const Model = Schema.Struct({
  id: Schema.String,
  parameters: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.String, values: Schema.Array(Schema.Struct({ value: Schema.String })) }))),
  variants: Schema.optional(Schema.Array(Schema.Struct({ params: Schema.Array(ModelParam) }))),
});
export const Models = Schema.Struct({ items: Schema.Array(Model) });
export const Repositories = Schema.Struct({ items: Schema.Array(Schema.Struct({ url: Schema.String })) });
export const ArtifactPage = Schema.Struct({ items: Schema.Array(Schema.Struct({ path: Schema.String, sizeBytes: Schema.optional(Schema.Number) })) });
export const ArtifactUrl = Schema.Struct({ url: Schema.String });
export const ObjectResponse = Schema.Record(Schema.String, Schema.Unknown);

export function decode<A>(schema: Schema.Codec<A>, input: unknown, source: string) {
  return Schema.decodeUnknownEffect(schema, { onExcessProperty: "preserve" })(input).pipe(
    Effect.mapError(() => new Fault({
      code: "PROVIDER_CONTRACT",
      message: `Unexpected response from ${source}.`,
    })),
  );
}
