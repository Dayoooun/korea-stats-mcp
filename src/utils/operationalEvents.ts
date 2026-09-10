/**
 * Safe, bounded operational events for cache and MCP lifecycle diagnostics.
 *
 * Event values are deliberately limited to enums, booleans, and bounded numbers.
 * No request, provider, cache-key, or error data belongs in this contract.
 */

const OPERATIONAL_EVENT_KINDS = [
  "cache_hit",
  "cache_miss",
  "cache_admission_refused",
  "cache_eviction",
  "cache_expiry",
  "mcp_initialize",
  "mcp_request_complete",
  "mcp_transport_close",
  "credentials_configured",
  "provider_outcome",
] as const;
const PROVIDER_NAMES = ["kosis"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

const PROVIDER_OPERATIONS = [
  "statistics_list",
  "statistics_data",
  "search_statistics",
  "statistics_explain",
  "table_metadata",
  "indicator_search",
  "indicator_values",
  "indicator_definition",
  "other",
] as const;
export type ProviderOperation = (typeof PROVIDER_OPERATIONS)[number];

const PROVIDER_OUTCOMES = [
  "success",
  "timeout",
  "network",
  "invalid",
  "too_large",
  "rate_limited",
  "auth_rejected",
  "provider_error",
  "auth_missing",
] as const;
export type ProviderOutcome = (typeof PROVIDER_OUTCOMES)[number];

const RETRY_DISPOSITIONS = ["not_attempted"] as const;
export type RetryDisposition = (typeof RETRY_DISPOSITIONS)[number];

export type OperationalEventKind = (typeof OPERATIONAL_EVENT_KINDS)[number];

const CACHE_SCOPES = [
  "statistics_list",
  "statistics_data",
  "search_results",
  "explanation",
  "table_meta",
  "other",
] as const;

export type CacheScope = (typeof CACHE_SCOPES)[number];

const STATUS_CATEGORIES = [
  "success",
  "client_error",
  "server_error",
  "unknown",
] as const;

export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

const CACHE_ADMISSION_REFUSAL_REASONS = [
  "oversized",
  "max_keys",
  "byte_budget",
  "unserializable",
] as const;

export type CacheAdmissionRefusalReason =
  (typeof CACHE_ADMISSION_REFUSAL_REASONS)[number];

const CACHE_EVICTION_REASONS = [
  "max_keys",
  "byte_budget",
  "replacement",
] as const;

export type CacheEvictionReason = (typeof CACHE_EVICTION_REASONS)[number];

export type OperationalEvent =
  | {
      readonly kind: "cache_hit";
      readonly cache: CacheScope;
      readonly approximateBytes?: number;
    }
  | {
      readonly kind: "cache_miss";
      readonly cache: CacheScope;
    }
  | {
      readonly kind: "cache_admission_refused";
      readonly cache: CacheScope;
      readonly reason: CacheAdmissionRefusalReason;
      readonly approximateBytes?: number;
    }
  | {
      readonly kind: "cache_eviction";
      readonly cache: CacheScope;
      readonly reason: CacheEvictionReason;
      readonly approximateBytes?: number;
    }
  | {
      readonly kind: "cache_expiry";
      readonly cache: CacheScope;
      readonly approximateBytes?: number;
    }
  | {
      readonly kind: "mcp_initialize";
      readonly elapsedTimeMs: number;
      readonly statusCategory: StatusCategory;
    }
  | {
      readonly kind: "mcp_request_complete";
      readonly elapsedTimeMs: number;
      readonly statusCategory: StatusCategory;
    }
  | {
      readonly kind: "mcp_transport_close";
      readonly elapsedTimeMs: number;
      readonly statusCategory: StatusCategory;
    }
  | {
      readonly kind: "credentials_configured";
      readonly configured: boolean;
    }
  | {
      readonly kind: "provider_outcome";
      readonly provider: ProviderName;
      readonly operation: ProviderOperation;
      readonly elapsedTimeMs: number;
      readonly responseBytes?: number;
      readonly statusCategory: StatusCategory;
      /**
       * Number of upstream attempts made. Missing local credentials means no
       * upstream attempt (0); every actual fetch path uses exactly one attempt.
       */
      readonly attempts: 0 | 1;
      readonly retryDisposition: RetryDisposition;
      readonly outcome: ProviderOutcome;
      readonly sizeLimitBytes: 4_194_304;
    };

export type OperationalEventSink = (event: OperationalEvent) => void;

const MAX_EVENT_NUMBER = 2_147_483_647;
const MAX_EVENT_LINE_BYTES = 2_048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function enumValue<T extends readonly string[]>(
  values: T,
  value: unknown,
): T[number] | undefined {
  return typeof value === "string" && values.includes(value as T[number])
    ? (value as T[number])
    : undefined;
}

function boundedNumber(value: unknown): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_EVENT_NUMBER
  ) {
    return undefined;
  }
  return Math.floor(value);
}

function optionalApproximateBytes(
  value: unknown,
): number | undefined | "invalid" {
  if (value === undefined) return undefined;
  const bytes = boundedNumber(value);
  return bytes === undefined ? "invalid" : bytes;
}

function sanitizeOperationalEvent(
  value: unknown,
): OperationalEvent | undefined {
  if (!isRecord(value)) return undefined;

  try {
    switch (value.kind) {
      case "cache_hit": {
        const cache = enumValue(CACHE_SCOPES, value.cache);
        const bytes = optionalApproximateBytes(value.approximateBytes);
        if (!cache || bytes === "invalid") return undefined;
        return bytes === undefined
          ? { kind: "cache_hit", cache }
          : { kind: "cache_hit", cache, approximateBytes: bytes };
      }
      case "cache_miss": {
        const cache = enumValue(CACHE_SCOPES, value.cache);
        return cache === undefined ? undefined : { kind: "cache_miss", cache };
      }
      case "cache_admission_refused": {
        const cache = enumValue(CACHE_SCOPES, value.cache);
        const reason = enumValue(CACHE_ADMISSION_REFUSAL_REASONS, value.reason);
        const bytes = optionalApproximateBytes(value.approximateBytes);
        if (!cache || !reason || bytes === "invalid") return undefined;
        return bytes === undefined
          ? { kind: "cache_admission_refused", cache, reason }
          : {
              kind: "cache_admission_refused",
              cache,
              reason,
              approximateBytes: bytes,
            };
      }
      case "cache_eviction": {
        const cache = enumValue(CACHE_SCOPES, value.cache);
        const reason = enumValue(CACHE_EVICTION_REASONS, value.reason);
        const bytes = optionalApproximateBytes(value.approximateBytes);
        if (!cache || !reason || bytes === "invalid") return undefined;
        return bytes === undefined
          ? { kind: "cache_eviction", cache, reason }
          : {
              kind: "cache_eviction",
              cache,
              reason,
              approximateBytes: bytes,
            };
      }
      case "cache_expiry": {
        const cache = enumValue(CACHE_SCOPES, value.cache);
        const bytes = optionalApproximateBytes(value.approximateBytes);
        if (!cache || bytes === "invalid") return undefined;
        return bytes === undefined
          ? { kind: "cache_expiry", cache }
          : { kind: "cache_expiry", cache, approximateBytes: bytes };
      }
      case "mcp_initialize":
      case "mcp_request_complete":
      case "mcp_transport_close": {
        const elapsedTimeMs = boundedNumber(value.elapsedTimeMs);
        const statusCategory = enumValue(
          STATUS_CATEGORIES,
          value.statusCategory,
        );
        if (elapsedTimeMs === undefined || statusCategory === undefined) {
          return undefined;
        }
        return {
          kind: value.kind,
          elapsedTimeMs,
          statusCategory,
        };
      }
      case "credentials_configured":
        return typeof value.configured === "boolean"
          ? { kind: "credentials_configured", configured: value.configured }
          : undefined;
      case "provider_outcome": {
        const provider = enumValue(PROVIDER_NAMES, value.provider);
        const operation = enumValue(PROVIDER_OPERATIONS, value.operation);
        const elapsedTimeMs = boundedNumber(value.elapsedTimeMs);
        const responseBytes = optionalApproximateBytes(value.responseBytes);
        const statusCategory = enumValue(
          STATUS_CATEGORIES,
          value.statusCategory,
        );
        const retryDisposition = enumValue(
          RETRY_DISPOSITIONS,
          value.retryDisposition,
        );
        const outcome = enumValue(PROVIDER_OUTCOMES, value.outcome);
        const attempts = outcome === "auth_missing" ? 0 : 1;
        if (
          provider === undefined ||
          operation === undefined ||
          elapsedTimeMs === undefined ||
          responseBytes === "invalid" ||
          statusCategory === undefined ||
          retryDisposition === undefined ||
          outcome === undefined ||
          value.attempts !== attempts ||
          value.sizeLimitBytes !== 4_194_304
        ) {
          return undefined;
        }
        return responseBytes === undefined
          ? {
              kind: "provider_outcome",
              provider,
              operation,
              elapsedTimeMs,
              statusCategory,
              attempts,
              retryDisposition,
              outcome,
              sizeLimitBytes: 4_194_304,
            }
          : {
              kind: "provider_outcome",
              provider,
              operation,
              elapsedTimeMs,
              responseBytes,
              statusCategory,
              attempts,
              retryDisposition,
              outcome,
              sizeLimitBytes: 4_194_304,
            };
      }
      default:
        return undefined;
    }
  } catch {
    // Malformed objects, including throwing getters, are ignored.
    return undefined;
  }
}

function writeOperationalEvent(event: OperationalEvent): void {
  try {
    const line = JSON.stringify(event);
    if (Buffer.byteLength(line, "utf8") > MAX_EVENT_LINE_BYTES) return;
    process.stderr.write(`${line}\n`);
  } catch {
    // Diagnostics must never affect serving.
  }
}

let operationalEventSink: OperationalEventSink = writeOperationalEvent;

/**
 * Emit one redacted operational event. Sink and serialization failures are
 * intentionally swallowed so observability cannot change request behavior.
 */
export function emitOperationalEvent(event: OperationalEvent): void {
  const safeEvent = sanitizeOperationalEvent(event);
  if (safeEvent === undefined) return;

  try {
    operationalEventSink(safeEvent);
  } catch {
    // A custom sink is an optional diagnostic side effect.
  }
}

/**
 * Install a process-local sink, primarily for embedding and tests. The
 * returned function restores the previous sink.
 */
export function setOperationalEventSink(
  sink?: OperationalEventSink | null,
): () => void {
  const previous = operationalEventSink;
  operationalEventSink = sink ?? writeOperationalEvent;
  return () => {
    operationalEventSink = previous;
  };
}
export function providerOperationForEndpoint(
  endpoint: string,
  metadata = false,
): ProviderOperation {
  if (metadata) return "table_metadata";
  switch (endpoint) {
    case "/statisticsList.do":
      return "statistics_list";
    case "/Param/statisticsParameterData.do":
      return "statistics_data";
    case "/statisticsSearch.do":
      return "search_statistics";
    case "/statsExplain.do":
    case "/statisticsExplData.do":
      return "statistics_explain";
    case "/indIdDetailSearchRequest.do":
      return "indicator_values";
    case "/pkNumberService.do":
      return "indicator_definition";
    case "/indIdListSearchRequest.do":
    case "/indListSearchRequest.do":
    case "/prListSearchRequest.do":
      return "indicator_search";
    default:
      return "other";
  }
}

export function cacheScopeForPrefix(prefix: string): CacheScope {
  switch (prefix) {
    case "list":
      return "statistics_list";
    case "data":
      return "statistics_data";
    case "search":
      return "search_results";
    case "explain":
      return "explanation";
    case "meta":
      return "table_meta";
    default:
      return "other";
  }
}

export function statusCategoryForCode(statusCode: unknown): StatusCategory {
  if (typeof statusCode !== "number" || !Number.isInteger(statusCode)) {
    return "unknown";
  }
  if (statusCode >= 200 && statusCode < 400) return "success";
  if (statusCode >= 400 && statusCode < 500) return "client_error";
  if (statusCode >= 500 && statusCode < 600) return "server_error";
  return "unknown";
}

export function elapsedTimeMsSince(startedAt: number): number {
  const elapsed = Date.now() - startedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) return 0;
  return Math.min(Math.floor(elapsed), MAX_EVENT_NUMBER);
}
