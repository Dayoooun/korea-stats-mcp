import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config/index.js";

export const STATISTICS_DATA_PAGE_DEFAULT = 50;
export const STATISTICS_DATA_PAGE_MAX = 200;
export const MCP_CONTENT_MAX_BYTES = 32_768;
export const DATA_CURSOR_VERSION = 1 as const;

export type StatisticsDataPageQuery = {
  orgId: string;
  tableId: string;
  objL1?: string;
  objL2?: string;
  objL3?: string;
  objL4?: string;
  objL5?: string;
  objL6?: string;
  objL7?: string;
  objL8?: string;
  itemId: string;
  periodType: string;
  startPeriod?: string;
  endPeriod?: string;
  pageSize: number;
};

export type DataInterval = { startOrdinal: number; endOrdinal: number };
export type ActiveDataInterval = DataInterval & {
  rowIndex: number;
  partitionSnapshot: string;
};

export type DataCursorState = {
  v: typeof DATA_CURSOR_VERSION;
  query: string;
  pending: DataInterval[];
  active?: ActiveDataInterval;
  emittedCount: number;
  aggregateRowCount: number;
  splitOccurred: boolean;
};

export type DataCursorDecode =
  | { ok: true; state: DataCursorState }
  | { ok: false; reason: "invalid" | "key_unavailable" };

function canonical(value: unknown): unknown {
  if (value === undefined) return { __undefined__: true };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function queryHash(query: StatisticsDataPageQuery): string {
  // Arrays preserve every selector verbatim, including an omitted selector.
  const selectors = Array.from({ length: 8 }, (_, index) => [
    `objL${index + 1}`,
    query[`objL${index + 1}` as keyof StatisticsDataPageQuery],
  ]);
  return createHash("sha256")
    .update(
      canonicalJson({
        version: DATA_CURSOR_VERSION,
        orgId: query.orgId,
        tableId: query.tableId,
        selectors,
        itemId: query.itemId,
        periodType: query.periodType,
        startPeriod: query.startPeriod,
        endPeriod: query.endPeriod,
        pageSize: query.pageSize,
      }),
    )
    .digest("hex");
}

export function periodLabel(
  periodType: "Y" | "M" | "Q",
  ordinal: number,
  referencePeriod: string,
): string {
  if (periodType === "Y") return String(ordinal).padStart(4, "0");
  if (periodType === "M") {
    const year = Math.floor(ordinal / 12);
    const month = (ordinal % 12) + 1;
    return `${String(year).padStart(4, "0")}${String(month).padStart(2, "0")}`;
  }
  const year = Math.floor(ordinal / 4);
  const quarter = (ordinal % 4) + 1;
  const notation = referencePeriod.trim().match(/^\d{4}(Q|0)?[1-4]$/u);
  if (!notation) throw new Error("Invalid quarterly period notation");
  return `${String(year).padStart(4, "0")}${notation[1] ?? ""}${quarter}`;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(encodedPayload: string, key: string): string {
  return createHmac("sha256", key).update(encodedPayload).digest("base64url");
}

function validInterval(value: unknown): value is DataInterval {
  return Boolean(
    value &&
    typeof value === "object" &&
    Number.isInteger((value as DataInterval).startOrdinal) &&
    Number.isInteger((value as DataInterval).endOrdinal) &&
    (value as DataInterval).startOrdinal >= 0 &&
    (value as DataInterval).startOrdinal <= (value as DataInterval).endOrdinal,
  );
}

function validState(value: unknown): value is DataCursorState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<DataCursorState>;
  if (
    state.v !== DATA_CURSOR_VERSION ||
    typeof state.query !== "string" ||
    !/^[a-f0-9]{64}$/u.test(state.query)
  )
    return false;
  if (!Array.isArray(state.pending) || !state.pending.every(validInterval))
    return false;
  for (let index = 1; index < state.pending.length; index += 1) {
    if (
      state.pending[index - 1].endOrdinal >= state.pending[index].startOrdinal
    )
      return false;
  }
  if (
    typeof state.emittedCount !== "number" ||
    !Number.isSafeInteger(state.emittedCount) ||
    state.emittedCount < 0
  )
    return false;
  if (
    typeof state.aggregateRowCount !== "number" ||
    !Number.isSafeInteger(state.aggregateRowCount) ||
    state.aggregateRowCount < 0
  )
    return false;
  if (
    state.emittedCount > state.aggregateRowCount ||
    typeof state.splitOccurred !== "boolean"
  )
    return false;
  if (!state.pending.length && state.active === undefined) return false;
  if (!state.active && (!state.splitOccurred || !state.pending.length))
    return false;
  if (!state.splitOccurred && state.pending.length > 1) return false;
  if (state.active !== undefined) {
    const active = state.active;
    if (
      !validInterval(active) ||
      !Number.isInteger(active.rowIndex) ||
      active.rowIndex < 0 ||
      typeof active.partitionSnapshot !== "string" ||
      !/^[a-f0-9]{64}$/u.test(active.partitionSnapshot)
    )
      return false;
  }
  return true;
}

export function encodeDataCursor(
  state: DataCursorState,
  key = config.kosis.apiKey,
): string | null {
  if (!key) return null;
  const encoded = base64UrlEncode(JSON.stringify(state));
  return `${encoded}.${sign(encoded, key)}`;
}

export function decodeDataCursor(
  cursor: string,
  query: StatisticsDataPageQuery,
  key = config.kosis.apiKey,
): DataCursorDecode {
  if (!key) return { ok: false, reason: "key_unavailable" };
  if (typeof cursor !== "string") return { ok: false, reason: "invalid" };
  const separator = cursor.lastIndexOf(".");
  if (separator <= 0 || separator === cursor.length - 1)
    return { ok: false, reason: "invalid" };
  const encoded = cursor.slice(0, separator);
  const provided = Buffer.from(cursor.slice(separator + 1), "base64url");
  const expectedText = sign(encoded, key);
  const expected = Buffer.from(expectedText, "base64url");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  )
    return { ok: false, reason: "invalid" };
  try {
    const parsed = JSON.parse(base64UrlDecode(encoded)) as unknown;
    if (!validState(parsed) || parsed.query !== queryHash(query))
      return { ok: false, reason: "invalid" };
    return { ok: true, state: parsed };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export function snapshotHash(rows: Array<Record<string, unknown>>): string {
  const canonicalRows = [...rows].sort((left, right) =>
    canonicalJson(left).localeCompare(canonicalJson(right)),
  );
  return createHash("sha256")
    .update(canonicalJson(canonicalRows))
    .digest("hex");
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function mcpWireSize(value: Record<string, unknown>): number {
  const text = JSON.stringify(value, null, 2);
  return byteLength(JSON.stringify({ content: [{ type: "text", text }] }));
}

/**
 * Return the largest prefix of rows that fits the whole MCP text wrapper.
 * A complete row is never sliced. `makeCursor` is called only for candidates
 * that fit, so callers can bind the exact emitted count into their cursor.
 */
export function fitStatisticsDataPage<T>(
  base: Record<string, unknown>,
  rows: T[],
  pageSize: number,
  hasMoreAfterPage: (count: number) => boolean,
  makeCursor: (count: number) => string | null,
): { rows: T[]; nextCursor: string | null; tooLarge: boolean } {
  let best: T[] = [];
  let bestCursor: string | null = null;
  const limit = Math.min(pageSize, rows.length);
  for (let count = 1; count <= limit; count += 1) {
    const candidateRows = rows.slice(0, count);
    const more = hasMoreAfterPage(count);
    const cursor = more ? makeCursor(count) : null;
    const candidate = {
      ...base,
      data: candidateRows,
      returnedCount: count,
      hasMore: more,
      nextCursor: cursor,
    };
    if (mcpWireSize(candidate) > MCP_CONTENT_MAX_BYTES) break;
    best = candidateRows;
    bestCursor = cursor;
  }
  return {
    rows: best,
    nextCursor: bestCursor,
    tooLarge: rows.length > 0 && best.length === 0,
  };
}

/**
 * Bound error evidence without pretending the complete raw response was
 * returned. Small incomplete evidence keeps the original row array intact.
 */
export function boundedStatisticsDataError(
  base: Record<string, unknown>,
  code: string,
  message: string,
  evidence: unknown[] = [],
): Record<string, unknown> {
  let sample = evidence.slice();
  const make = (
    rows: unknown[],
    errorMessage: string,
  ): Record<string, unknown> => ({
    ...base,
    success: false,
    errorCode: code,
    errorMessage,
    data: rows,
    returnedCount: rows.length,
    observedEvidenceCount: evidence.length,
    ...(rows.length < evidence.length
      ? { evidenceTruncated: true, returnedEvidenceCount: rows.length }
      : {}),
    hasMore: false,
    nextCursor: null,
    completion: "unproven",
  });
  let result = make(sample, message);
  while (sample.length > 0 && mcpWireSize(result) > MCP_CONTENT_MAX_BYTES) {
    sample = sample.slice(
      0,
      Math.max(0, sample.length - Math.max(1, Math.ceil(sample.length / 10))),
    );
    result = make(sample, message);
  }
  if (mcpWireSize(result) <= MCP_CONTENT_MAX_BYTES) return result;

  // Keep explicit bounded evidence counts even when the error text itself is huge.
  let low = 0;
  let high = message.length;
  let fitting = "";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = make(sample, message.slice(0, middle));
    if (mcpWireSize(candidate) <= MCP_CONTENT_MAX_BYTES) {
      fitting = message.slice(0, middle);
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  result = make(sample, fitting);
  if (mcpWireSize(result) <= MCP_CONTENT_MAX_BYTES) return result;
  return {
    success: false,
    errorCode: "OUTPUT_TOO_LARGE",
    validationLevel: "unverified",
    errorMessage: "bounded error evidence",
    data: [],
    returnedCount: 0,
    observedEvidenceCount: evidence.length,
    returnedEvidenceCount: 0,
    evidenceTruncated: evidence.length > 0,
    providerTotalCount: null,
    providerSnapshot: "unproven",
    snapshotScope: "active_partition",
    completionScope: "requested_period_traversal",
    hasMore: false,
    nextCursor: null,
    completion: "unproven",
  };
}
