import { Fault, redact } from "./errors.ts";

export type Method = "GET" | "POST";
export type ClientOptions = {
  apiKey?: string | undefined;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  maxBytes?: number;
};

export function openCursorResponse(options: ClientOptions, method: Method, path: string, signal: AbortSignal, body?: unknown, lastEventId?: string, accept = "application/json") {
  if (!options.apiKey) throw new Fault({ code: "AUTH_REQUIRED", message: "Set CURSOR_API_KEY in the caller environment.", uncertain: false });
  const url = new URL(path, "https://api.cursor.com");
  if (!path.startsWith("/v1/") || path.includes("\\") || url.origin !== "https://api.cursor.com" || !url.pathname.startsWith("/v1/") || url.hash) throw new Fault({ code: "INVALID_INPUT", message: "Only fixed Cursor v1 API paths are supported.", uncertain: false });
  if (lastEventId !== undefined && (lastEventId.length > 512 || /[\r\n\0]/.test(lastEventId))) throw new Fault({ code: "INVALID_INPUT", message: "Invalid SSE event ID.", uncertain: false });
  return (options.fetch ?? fetch)(url.href, {
    method, redirect: "error", credentials: "omit",
    headers: { Authorization: `Bearer ${options.apiKey}`, Accept: accept, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 120_000)]),
  });
}

export async function readResponseText(response: Response, maxBytes: number, uncertain: boolean) {
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new Fault({ code: "RESPONSE_TOO_LARGE", message: "Cursor response exceeded the configured limit.", uncertain });
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

export function httpFailure(response: Response, method: Method, path: string, text: string, key?: string) {
  let message = response.statusText;
  let providerCode: string | undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null) {
      const fields = value as Record<string, unknown>;
      const nested = typeof fields.error === "object" && fields.error !== null ? fields.error as Record<string, unknown> : fields;
      if (typeof nested.message === "string") message = nested.message;
      else if (typeof fields.error === "string") message = fields.error;
      if (typeof nested.code === "string") providerCode = nested.code;
    }
  } catch { /* HTML and unstructured bodies are never copied into diagnostics. */ }
  const retry = response.headers.get("retry-after");
  const seconds = retry === null ? undefined : /^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry) - Date.now()) / 1000);
  const retryAfterSeconds = seconds !== undefined && Number.isFinite(seconds) ? Math.max(0, seconds) : undefined;
  return new Fault({
    code: response.status === 401 || response.status === 403 ? "AUTH_REJECTED" : response.status === 404 ? "NOT_FOUND" : response.status === 409 ? "CONFLICT" : response.status === 410 ? "STREAM_EXPIRED" : response.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR",
    message: redact(`${response.status} ${method} ${path}: ${message}`, key), status: response.status,
    uncertain: method === "POST" && (response.status >= 500 || response.status === 408 || providerCode === "agent_id_conflict"),
    providerCode, retryAfterSeconds, providerRequestId: response.headers.get("x-request-id") ?? undefined,
    details: { providerCode, retryAfterSeconds, requestId: response.headers.get("x-request-id") ?? undefined },
  });
}

export function networkFailure(error: unknown, method: Method, key?: string) {
  return error instanceof Fault ? error : new Fault({ code: method === "POST" ? "OUTCOME_UNKNOWN" : "NETWORK_ERROR", message: redact(error instanceof Error ? error.message : "Cursor request failed.", key), uncertain: method === "POST" });
}
