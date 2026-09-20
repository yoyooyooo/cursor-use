import { Effect } from "effect";
import { Fault, redact } from "./errors.ts";

export function writeJson(value: unknown, stream: "stdout" | "stderr" = "stdout") {
  return Effect.tryPromise({
    try: () => new Promise<void>((resolve, reject) => {
      const target = stream === "stdout" ? process.stdout : process.stderr;
      const onError = (error: Error) => reject(error);
      target.once("error", onError);
      target.write(`${redact(JSON.stringify(value))}\n`, (error) => {
        if (error) reject(error);
        else {
          target.off("error", onError);
          resolve();
        }
      });
    }),
    catch: () => new Fault({ code: "OUTPUT_ERROR", message: `Unable to write ${stream}. Preserve the request ID before retrying any cloud operation.` }),
  }).pipe(Effect.asVoid);
}

export const respond = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(
  Effect.flatMap((data) => writeJson({ ok: true, data })),
);
