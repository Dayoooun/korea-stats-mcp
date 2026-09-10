/**
 * getMeta 결과를 MCP 크기 제한 안에서 탐색하기 위한 무상태 페이지 도구.
 *
 * 페이지 커서는 서버 비밀키를 포함하지 않고, 조회 조건·스냅샷·위치를
 * HMAC으로 서명한다. 따라서 프로세스나 캐시가 바뀌어도 같은 원본 스냅샷이면
 * 이어서 읽을 수 있고, 원본이 바뀌면 처음부터 다시 읽도록 명시한다.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config/index.js";

export const METADATA_PAGE_MAX = 200;
export const METADATA_PAGE_DEFAULT = 50;
export const MCP_CONTENT_MAX_BYTES = 32_768;

export type MetadataRow = Record<string, unknown>;

export interface MetadataPageQuery {
  orgId: string;
  tableId: string;
  infoType: string;
  objId?: string;
  parentId?: string;
  query?: string;
  pageSize?: number;
  cursor?: string;
}

export interface MetadataPageOptions {
  /** Values that are always present in the result (for example orgId/tableId). */
  base?: Record<string, unknown>;
  /** The key under which page rows are returned. Existing callers use rawData. */
  rowKey?: string;
  /** Add a compact page summary without copying a full raw row into each group. */
  extras?: (
    pageRows: MetadataRow[],
    allRows: MetadataRow[],
  ) => Record<string, unknown>;
  /** Server-side cursor key. It is never serialized in a cursor. */
  cursorKey?: string;
}

interface CursorPayload {
  v: 1;
  index: number;
  snapshot: string;
  query: string;
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value))
      result[key] = cloneValue(child);
    return result;
  }
  return value;
}

function cloneRows(rows: MetadataRow[]): MetadataRow[] {
  return rows.map((row) => cloneValue(row) as MetadataRow);
}

function canonical(value: unknown): unknown {
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

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function rowValue(row: MetadataRow, key: string): string {
  const value = row[key];
  return value === undefined || value === null ? "" : String(value);
}

function compareRows(a: MetadataRow, b: MetadataRow): number {
  // Do not parse IDs as numbers: five-digit administrative codes and four-digit
  // classification IDs are opaque source values and must remain lossless.
  for (const key of [
    "OBJ_ID",
    "OBJ_ID_SN",
    "UP_ITM_ID",
    "ITM_ID",
    "ITM_NM",
    "UNIT",
  ]) {
    const comparison = rowValue(a, key).localeCompare(rowValue(b, key));
    if (comparison !== 0) return comparison;
  }
  return canonicalJson(a).localeCompare(canonicalJson(b));
}

function snapshotHash(rows: MetadataRow[]): string {
  return createHash("sha256").update(canonicalJson(rows)).digest("hex");
}

function queryHash(input: MetadataPageQuery): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        orgId: input.orgId,
        tableId: input.tableId,
        infoType: input.infoType,
        objId: input.objId,
        parentId: input.parentId,
        query: input.query,
        pageSize: input.pageSize ?? METADATA_PAGE_DEFAULT,
      }),
    )
    .digest("hex");
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(key: string, encodedPayload: string): string {
  return createHmac("sha256", key).update(encodedPayload).digest("base64url");
}

function encodeCursor(payload: CursorPayload, key: string): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${signature(key, encodedPayload)}`;
}

function decodeCursor(cursor: string, key: string): CursorPayload | null {
  const separator = cursor.lastIndexOf(".");
  if (separator <= 0 || separator === cursor.length - 1) return null;
  const encodedPayload = cursor.slice(0, separator);
  const suppliedSignature = cursor.slice(separator + 1);
  const expectedSignature = signature(key, encodedPayload);
  const supplied = Buffer.from(suppliedSignature, "base64url");
  const expected = Buffer.from(expectedSignature, "base64url");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return null;

  try {
    const parsed = JSON.parse(
      base64UrlDecode(encodedPayload),
    ) as Partial<CursorPayload>;
    if (
      parsed.v !== 1 ||
      typeof parsed.index !== "number" ||
      !Number.isInteger(parsed.index) ||
      parsed.index < 0 ||
      typeof parsed.snapshot !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.snapshot) ||
      typeof parsed.query !== "string" ||
      !/^[a-f0-9]{64}$/.test(parsed.query)
    ) {
      return null;
    }
    return parsed as CursorPayload;
  } catch {
    return null;
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function mcpWireSize(value: Record<string, unknown>): number {
  // server.ts serializes tool results with two-space indentation. Accounting for
  // that form is conservative for compact clients while covering the whole wrapper.
  const text = JSON.stringify(value, null, 2);
  return byteLength(JSON.stringify({ content: [{ type: "text", text }] }));
}

function errorResult(
  base: Record<string, unknown>,
  code: string,
  message: string,
  snapshot: string,
): Record<string, unknown> {
  return {
    ...base,
    success: false,
    errorCode: code,
    errorMessage: message,
    totalCount: 0,
    returnedCount: 0,
    hasMore: false,
    nextCursor: null,
    snapshot,
    usageHint:
      "필터(objId, parentId, query)를 좁히거나 infoType을 조정해 다시 조회하세요. 원문 필드를 잘라서 성공으로 표시하지 않습니다.",
  };
}

/**
 * Stable, signed, byte-aware pagination for official getMeta rows.
 * `rows` is cloned before sorting/filtering, so a cache-owned return value is never
 * mutated by this function or by a caller mutating the returned page.
 */
export function paginateMetadata(
  rows: MetadataRow[],
  input: MetadataPageQuery,
  options: MetadataPageOptions = {},
): Record<string, unknown> {
  const base = { ...(options.base ?? {}) };
  const rowKey = options.rowKey ?? "rawData";
  const pageSize = input.pageSize ?? METADATA_PAGE_DEFAULT;
  const allRows = cloneRows(rows).sort(compareRows);
  const snapshot = snapshotHash(allRows);
  const query = queryHash({ ...input, pageSize });
  const cursorKey = options.cursorKey ?? config.kosis.apiKey;

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > METADATA_PAGE_MAX
  ) {
    return errorResult(
      base,
      "INVALID_PAGE_SIZE",
      `pageSize는 1 이상 ${METADATA_PAGE_MAX} 이하의 정수여야 합니다.`,
      snapshot,
    );
  }

  let filteredRows = allRows;
  if (input.objId !== undefined) {
    filteredRows = filteredRows.filter(
      (row) => rowValue(row, "OBJ_ID") === input.objId,
    );
  }
  if (input.parentId !== undefined) {
    filteredRows = filteredRows.filter(
      (row) => rowValue(row, "UP_ITM_ID") === input.parentId,
    );
  }
  const textQuery = input.query?.trim().toLocaleLowerCase("ko-KR");
  if (textQuery) {
    filteredRows = filteredRows.filter((row) =>
      Object.values(row).some((value) =>
        String(value ?? "")
          .toLocaleLowerCase("ko-KR")
          .includes(textQuery),
      ),
    );
  }

  let start = 0;
  if (input.cursor !== undefined) {
    if (!cursorKey) {
      return errorResult(
        base,
        "CURSOR_KEY_UNAVAILABLE",
        "서버 커서 서명 키가 설정되지 않아 이어보기를 수행할 수 없습니다.",
        snapshot,
      );
    }
    const parsed = decodeCursor(input.cursor, cursorKey);
    if (!parsed || parsed.query !== query) {
      return errorResult(
        base,
        "INVALID_CURSOR",
        "커서가 조회 조건과 일치하지 않거나 서명이 유효하지 않습니다. 첫 페이지부터 다시 조회하세요.",
        snapshot,
      );
    }
    if (parsed.snapshot !== snapshot) {
      return errorResult(
        base,
        "RESTART_REQUIRED",
        "메타데이터 스냅샷이 바뀌었습니다. 처음부터 다시 조회하세요.",
        snapshot,
      );
    }
    start = parsed.index!;
    if (start > filteredRows.length) {
      return errorResult(
        base,
        "INVALID_CURSOR",
        "커서 위치가 현재 결과 범위를 벗어났습니다. 첫 페이지부터 다시 조회하세요.",
        snapshot,
      );
    }
  }

  const totalCount = filteredRows.length;
  const remaining = totalCount - start;
  const candidateRows: MetadataRow[] = [];
  let bestRows: MetadataRow[] | null = null;
  let bestCursor: string | null = null;

  for (let count = 1; count <= Math.min(pageSize, remaining); count += 1) {
    candidateRows.push(filteredRows[start + count - 1]);
    const more = start + count < totalCount;
    let nextCursor: string | null = null;
    if (more) {
      if (!cursorKey) break;
      nextCursor = encodeCursor(
        { v: 1, index: start + count, snapshot, query },
        cursorKey,
      );
    }
    const candidate: Record<string, unknown> = {
      ...base,
      success: true,
      [rowKey]: candidateRows,
      ...(options.extras ? options.extras(candidateRows, allRows) : {}),
      totalCount,
      returnedCount: count,
      hasMore: more,
      nextCursor,
      snapshot,
    };
    if (mcpWireSize(candidate) > MCP_CONTENT_MAX_BYTES) break;
    bestRows = [...candidateRows];
    bestCursor = nextCursor;
  }

  if (remaining > 0 && !bestRows) {
    return errorResult(
      base,
      "SIZE_ERROR",
      "개별 메타데이터 필드가 MCP 32768바이트 제한을 초과했습니다. 필터(objId, parentId, query)를 좁히거나 infoType을 조정하세요.",
      snapshot,
    );
  }

  const returnedCount = bestRows?.length ?? 0;
  const hasMore = start + returnedCount < totalCount;
  return {
    ...base,
    success: true,
    [rowKey]: bestRows ?? [],
    ...(options.extras ? options.extras(bestRows ?? [], allRows) : {}),
    totalCount,
    returnedCount,
    hasMore,
    nextCursor: hasMore ? bestCursor : null,
    snapshot,
  };
}

/** Alias kept for callers that prefer the operation-oriented name. */
export const buildMetadataPage = paginateMetadata;

/** Compact representation of the observed official ITM fields, grouped by OBJ_ID. */
export function buildClassificationGroups(
  rows: MetadataRow[],
): Array<Record<string, unknown>> {
  const groups = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const rawObjId = row.OBJ_ID;
    const key =
      rawObjId === undefined || rawObjId === null ? "" : String(rawObjId);
    let group = groups.get(key);
    if (!group) {
      group = { objId: rawObjId ?? null, items: [] };
      if (Object.prototype.hasOwnProperty.call(row, "OBJ_NM"))
        group.objName = row.OBJ_NM;
      groups.set(key, group);
    }
    const item: Record<string, unknown> = {};
    for (const field of [
      "ITM_ID",
      "ITM_NM",
      "UP_ITM_ID",
      "OBJ_ID_SN",
      "UNIT",
    ]) {
      if (Object.prototype.hasOwnProperty.call(row, field))
        item[field] = row[field];
    }
    (group.items as Record<string, unknown>[]).push(item);
  }
  return [...groups.values()];
}
