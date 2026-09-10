import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export const LIVE_REQUEST_TIMEOUT_MS = 30_000;
export const EXPECTED_CANDIDATE_VERSION = "2.0.0";
export const VERCEL_BYPASS_ENV = "VERCEL_AUTOMATION_BYPASS_SECRET";

const OPERATOR_ENV_NAMES = ["KOSIS_API_KEY", "DATA_GO_KR_SERVICE_KEY"] as const;
const SAFE_STDIO_ENV_NAMES = [
  "HOME",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "USER",
] as const;
const JSON_RPC_PROTOCOL_VERSION = "2025-06-18";

export const CANONICAL_TOOL_NAMES = [
  "quick_stats",
  "quick_trend",
  "search_statistics",
  "get_statistics_list",
  "get_statistics_data",
  "compare_statistics",
  "analyze_time_series",
  "get_recommended_statistics",
  "get_table_info",
  "search_indicators",
  "get_indicator",
  "search_businesses",
  "search_microdata",
  "get_microdata_info",
] as const;

export type LiveTransportKind = "stdio" | "http";

export type CandidateConfig = {
  readonly stdioEntry: string;
  readonly httpUrl: URL;
  readonly version: string;
};

export type ConnectedReleaseClient = {
  readonly client: Client;
  readonly transport: Transport;
  readonly kind: LiveTransportKind;
};

type JsonObject = Record<string, unknown>;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required release environment: ${name}`);
  return value;
}

function validatedHttpUrl(value: string | URL): URL {
  let parsed: URL;
  try {
    parsed = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw new Error("HTTP candidate URL is invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.pathname.replace(/\/+$/, "") !== "/mcp"
  ) {
    throw new Error("HTTP candidate must be an explicit HTTPS /mcp URL");
  }
  if (parsed.username || parsed.password) {
    throw new Error("HTTP candidate URL must not contain credentials");
  }
  if (parsed.search || parsed.hash)
    throw new Error("HTTP candidate URL must not contain query or hash data");
  return parsed;
}

export function candidateConfig(): CandidateConfig {
  const version = requiredEnvironment("KOREA_STATS_CANDIDATE_VERSION");
  if (version !== EXPECTED_CANDIDATE_VERSION) {
    throw new Error("candidate version must explicitly equal 2.0.0");
  }

  const stdioEntry = requiredEnvironment("KOREA_STATS_CANDIDATE_STDIO_ENTRY");
  if (
    !path.isAbsolute(stdioEntry) ||
    !stdioEntry.endsWith(path.join("dist", "index.js"))
  ) {
    throw new Error(
      "stdio candidate must be an absolute installed dist/index.js entry",
    );
  }
  let isFile = false;
  try {
    isFile = fs.statSync(stdioEntry).isFile();
  } catch {
    isFile = false;
  }
  if (!stdioEntry.split(path.sep).includes("node_modules") || !isFile) {
    throw new Error("stdio candidate entry is not an installed file");
  }

  const httpText = requiredEnvironment("KOREA_STATS_CANDIDATE_HTTP_URL");
  const httpUrl = validatedHttpUrl(httpText);
  return { stdioEntry, httpUrl, version };
}

function stdioEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const name of SAFE_STDIO_ENV_NAMES) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  const kosisKey = requiredEnvironment("KOSIS_API_KEY");
  environment.KOSIS_API_KEY = kosisKey;
  for (const name of OPERATOR_ENV_NAMES.slice(1)) {
    const value = process.env[name]?.trim();
    if (value) environment[name] = value;
  }
  return environment;
}

function clientRequestOptions(): { timeout: number; maxTotalTimeout: number } {
  return {
    timeout: LIVE_REQUEST_TIMEOUT_MS,
    maxTotalTimeout: LIVE_REQUEST_TIMEOUT_MS,
  };
}

function bypassHeaders(enabled: boolean): Record<string, string> {
  if (!enabled) return {};
  const secret = process.env[VERCEL_BYPASS_ENV]?.trim();
  return secret ? { "x-vercel-protection-bypass": secret } : {};
}

function candidateFetch(
  config: CandidateConfig,
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  let requestUrl: URL;
  try {
    requestUrl = new URL(input.toString(), config.httpUrl);
  } catch {
    throw new Error("candidate HTTP request URL is invalid");
  }
  if (requestUrl.username || requestUrl.password) {
    throw new Error("candidate HTTP request URL must not contain credentials");
  }
  if (requestUrl.origin !== config.httpUrl.origin) {
    throw new Error("candidate HTTP request crossed the configured origin");
  }

  const controller = new AbortController();
  const parentSignal = init.signal;
  const abortFromParent = (): void => {
    controller.abort(parentSignal?.reason);
  };
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(), LIVE_REQUEST_TIMEOUT_MS);
  return fetch(requestUrl, {
    ...init,
    redirect: "error",
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  });
}
function newClient(): Client {
  return new Client({
    name: "korea-stats-release-live-client",
    version: "1.0.0",
  });
}

function newTransport(
  kind: LiveTransportKind,
  config: CandidateConfig,
): Transport {
  if (kind === "stdio") {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [config.stdioEntry],
      env: stdioEnvironment(),
      stderr: "pipe",
    });
    // The server writes its startup status to stderr. Drain it without making
    // credentials or transport diagnostics part of release evidence.
    transport.stderr?.on("data", () => undefined);
    return transport;
  }
  return new StreamableHTTPClientTransport(config.httpUrl, {
    requestInit: { headers: bypassHeaders(true) },
    fetch: (input, init) => candidateFetch(config, input, init),
    reconnectionOptions: {
      maxReconnectionDelay: LIVE_REQUEST_TIMEOUT_MS,
      initialReconnectionDelay: 250,
      reconnectionDelayGrowFactor: 1,
      maxRetries: 0,
    },
  });
}

async function closeTransport(transport: Transport): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      transport.close(),
      new Promise<void>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("transport close timeout")),
          LIVE_REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    throw new Error(`transport close failed: ${sanitizeLiveError(error)}`);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function connectReleaseClient(
  kind: LiveTransportKind,
  httpUrl?: string | URL,
): Promise<ConnectedReleaseClient> {
  const baseConfig = candidateConfig();
  const config =
    httpUrl !== undefined
      ? { ...baseConfig, httpUrl: validatedHttpUrl(httpUrl) }
      : baseConfig;
  const client = newClient();
  const transport = newTransport(kind, config);
  try {
    await client.connect(transport, clientRequestOptions());
    const serverVersion = client.getServerVersion();
    if (!serverVersion || serverVersion.version !== config.version) {
      throw new Error(
        "candidate server version does not match the explicit candidate version",
      );
    }
    return { client, transport, kind };
  } catch (error) {
    try {
      await closeTransport(transport);
    } catch {
      // Preserve the original connection error.
    }
    throw error;
  }
}

export async function withReleaseClient<T>(
  kind: LiveTransportKind,
  operation: (connection: ConnectedReleaseClient) => Promise<T>,
  httpUrl?: string | URL,
): Promise<T> {
  const connection = await connectReleaseClient(kind, httpUrl);
  let operationFailed = false;
  try {
    return await operation(connection);
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      await closeTransport(connection.transport);
    } catch (closeError) {
      if (!operationFailed) throw closeError;
    }
  }
}

function asJsonObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} did not return a JSON object`);
  }
  return value as JsonObject;
}

export async function callToolJson(
  client: Client,
  name: string,
  args: JsonObject,
): Promise<JsonObject> {
  const result = await client.callTool(
    { name, arguments: args },
    undefined,
    clientRequestOptions(),
  );
  if (result.isError === true) {
    throw new Error("MCP tool returned an error-marked result");
  }
  if (
    !("content" in result) ||
    !Array.isArray(result.content) ||
    result.content.length === 0
  ) {
    throw new Error(`${name} returned no content`);
  }
  const parsed: unknown[] = [];
  for (const item of result.content) {
    if (!item || item.type !== "text" || typeof item.text !== "string") {
      throw new Error(`${name} returned non-JSON content`);
    }
    try {
      parsed.push(JSON.parse(item.text));
    } catch {
      throw new Error(`${name} returned invalid JSON content`);
    }
  }
  const response = asJsonObject(parsed[0], `${name} result`);
  if (response.success === false) {
    const rawCode: unknown = Object.getOwnPropertyDescriptor(
      response,
      "code",
    )?.value;
    const code =
      typeof rawCode === "string" &&
      (/^[0-9]{1,4}$/u.test(rawCode) ||
        [
          "TIMEOUT",
          "NETWORK_ERROR",
          "RESPONSE_TOO_LARGE",
          "INVALID_RESPONSE",
          "RESTART_REQUIRED",
          "INVALID_CURSOR",
          "ATOMIC_PERIOD_TOO_LARGE",
          "METADATA_ERROR",
          "DATA_ERROR",
        ].includes(rawCode))
        ? rawCode
        : "OTHER_FAILURE";
    console.error(
      JSON.stringify({
        event: "live_tool_unsuccessful",
        tool: CANONICAL_TOOL_NAMES.some((tool) => tool === name)
          ? name
          : "unknown",
        code,
      }),
    );
  }
  return response;
}

export async function readResourceJson(
  client: Client,
  uri: string,
): Promise<JsonObject> {
  const result = await client.readResource({ uri }, clientRequestOptions());
  if (!Array.isArray(result.contents) || result.contents.length === 0)
    throw new Error("resource returned no contents");
  const item = result.contents[0];
  if (item.uri !== uri) throw new Error("resource returned an unexpected URI");
  if (!("text" in item) || typeof item.text !== "string")
    throw new Error("resource did not return JSON text");
  try {
    return asJsonObject(JSON.parse(item.text), "resource payload");
  } catch {
    throw new Error("resource returned invalid JSON");
  }
}

export async function getPromptText(
  client: Client,
  name: string,
  question: string,
): Promise<string> {
  const result = await client.getPrompt(
    { name, arguments: { question } },
    clientRequestOptions(),
  );
  const text = result.messages
    .map((message) =>
      message.content.type === "text" ? message.content.text : "",
    )
    .filter(Boolean)
    .join("\n");
  if (!text.trim()) throw new Error("prompt returned empty content");
  return text;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "undefined" : encoded;
}

export function initializeRequest(): JsonObject {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: JSON_RPC_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "korea-stats-release-http-probe", version: "1.0.0" },
    },
  };
}

type RawHttpResponse = {
  readonly status: number;
  readonly allow: string;
  readonly contentType: string;
  readonly body: string;
  readonly parsed?: unknown;
};

const MAX_HTTP_RESPONSE_BYTES = 4 * 1024 * 1024;

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const readAll = async (): Promise<string> => {
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        if (!item.value) continue;
        byteLength += item.value.byteLength;
        if (byteLength > MAX_HTTP_RESPONSE_BYTES) {
          void reader.cancel().catch(() => undefined);
          throw new Error("HTTP response exceeded the bounded body limit");
        }
        chunks.push(item.value);
      }
      const bytes = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(bytes);
    } finally {
      reader.releaseLock();
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readAll(),
      new Promise<string>((_, reject) => {
        timer = setTimeout(() => {
          void reader.cancel().catch(() => undefined);
          reject(new Error("HTTP response timeout"));
        }, LIVE_REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function rawHttpRequest(
  method: string,
  body?: JsonObject,
  withBypass = true,
): Promise<RawHttpResponse> {
  const config = candidateConfig();
  const response = await candidateFetch(config, config.httpUrl, {
    method,
    headers: {
      accept: "application/json, text/event-stream",
      ...(body ? { "content-type": "application/json" } : {}),
      ...bypassHeaders(withBypass),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await readResponseText(response);
  const contentType = response.headers.get("content-type") ?? "";
  let parsed: unknown;
  if (text.trim() && /(?:^|\/)json(?:;|$)/i.test(contentType)) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("HTTP response declared JSON but could not be parsed");
    }
  }
  return {
    status: response.status,
    allow: response.headers.get("allow") ?? "",
    contentType,
    body: text,
    ...(parsed === undefined ? {} : { parsed }),
  };
}

export function assertJsonRpcError(value: unknown): void {
  const object = asJsonObject(value, "HTTP error");
  const error = object.error;
  if (
    object.jsonrpc !== "2.0" ||
    error === null ||
    typeof error !== "object" ||
    Array.isArray(error)
  ) {
    throw new Error("HTTP method rejection was not a JSON-RPC error");
  }
  const errorRecord = error as Record<string, unknown>;
  if (
    typeof errorRecord.code !== "number" ||
    typeof errorRecord.message !== "string" ||
    !errorRecord.message.trim()
  ) {
    throw new Error(
      "HTTP method rejection had incomplete JSON-RPC error fields",
    );
  }
}

export function sanitizeLiveError(error: unknown): string {
  let message =
    error instanceof Error ? error.message : "live assertion failed";
  for (const name of [...OPERATOR_ENV_NAMES, VERCEL_BYPASS_ENV]) {
    const secret = process.env[name]?.trim();
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return message
    .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]")
    .slice(0, 600);
}

export async function runSanitizedLiveCase<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(`${label} failed: ${sanitizeLiveError(error)}`);
  }
}
