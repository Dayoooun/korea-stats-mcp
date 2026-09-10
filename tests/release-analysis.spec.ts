import { test, expect } from "@playwright/test";
import {
  callToolJson,
  runSanitizedLiveCase,
  withReleaseClient,
  type LiveTransportKind,
} from "./release-live-client";

const ORG_ID = "101";
const TABLE_ID = "DT_1B040A3";
const ITEM_ID = "T20";
const YEARS = Array.from({ length: 11 }, (_, index) => String(2015 + index));
const METADATA_PAGE_SIZE = 32;
const DATA_PAGE_SIZE = 2;
const MAX_PAGES = 64;
const ORACLE_TIMEOUT_MS = 15_000;
const ORACLE_MAX_BYTES = 4 * 1024 * 1024;
const KOSIS_ORIGIN = "https://kosis.kr";

// R2/R3 registration is ordinary and positive. R1 intentionally registers no
// Q03 cases; this is a registration boundary, never a skip/refusal path.
test.setTimeout(180_000);

type JsonRecord = Record<string, unknown>;
type AnnualObservation = {
  readonly period: string;
  readonly rawValue: string;
  readonly value: number;
  readonly raw: JsonRecord;
  readonly unit: string;
};
type RegionEvidence = {
  readonly code: string;
  readonly name: string;
  readonly axisName: string;
  readonly path: string[];
};
type AnalysisContext = {
  readonly region: RegionEvidence;
  readonly itemName: string;
  readonly unit: string;
  readonly tableName: string;
  readonly metadataRows: JsonRecord[];
  readonly annualRows: AnnualObservation[];
  readonly oracleRows: AnnualObservation[];
};

test.beforeEach(async () => {
  // Keep the assertion matrix visible in the release reporter without adding a
  // separate manifest or changing the candidate/runtime configuration.
  test.info().annotations.push({
    type: "assertion-matrix",
    description:
      "REQ-Q03: official metadata selectors, independent KOSIS annual values, compare_statistics, analyze_time_series, provenance, units, periods, signs, and change-rate semantics",
  });
});

function asRecord(value: unknown, label: string): JsonRecord {
  expect(value, `${label} object`).not.toBeNull();
  expect(typeof value, `${label} object type`).toBe("object");
  expect(Array.isArray(value), `${label} object is not an array`).toBe(false);
  return value as JsonRecord;
}

function requiredString(value: unknown, label: string): string {
  expect(typeof value, `${label} type`).toBe("string");
  const text = String(value).trim();
  expect(text.length, `${label} nonempty`).toBeGreaterThan(0);
  return text;
}
function requiredArray(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), `${label} array`).toBe(true);
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function optionalString(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function parseProviderNumber(value: unknown, label: string): number {
  if (typeof value === "number") {
    expect(Number.isFinite(value), `${label} finite`).toBe(true);
    return value;
  }
  const text = requiredString(value, `${label} raw value`);
  expect(text, `${label} provider numeric text`).toMatch(
    /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+(?:\.\d*)?)|(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u,
  );
  const number = Number(text.replaceAll(",", ""));
  expect(Number.isFinite(number), `${label} finite`).toBe(true);
  return number;
}

function canonicalName(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, "").toLocaleLowerCase("ko-KR");
}

function pathFor(
  row: JsonRecord,
  rowsById: Map<string, JsonRecord>,
): JsonRecord[] {
  const path: JsonRecord[] = [];
  const seen = new Set<string>();
  let current: JsonRecord | undefined = row;
  while (current) {
    const id = requiredString(current.ITM_ID, "official metadata ITM_ID");
    expect(seen.has(id), "official metadata parent path cycle").toBe(false);
    seen.add(id);
    path.unshift(current);
    const parent = optionalString(current.UP_ITM_ID);
    current = parent ? rowsById.get(parent) : undefined;
  }
  return path;
}

function readMetadataRows(result: JsonRecord, label: string): JsonRecord[] {
  expect(result.success, `${label} success`).toBe(true);
  expect(result.orgId, `${label} orgId`).toBe(ORG_ID);
  expect(result.tableId, `${label} tableId`).toBe(TABLE_ID);
  const rows = requiredArray(result.rawData, `${label} rawData`).map(
    (row, index) => asRecord(row, `${label} rawData[${index}]`),
  );
  expect(result.returnedCount, `${label} returnedCount`).toBe(rows.length);
  expect(typeof result.hasMore, `${label} hasMore type`).toBe("boolean");
  expect(
    result.nextCursor === null ||
      result.nextCursor === undefined ||
      typeof result.nextCursor === "string",
    `${label} nextCursor type`,
  ).toBe(true);
  return rows;
}

async function readAllOfficialMetadata(
  client: Parameters<typeof callToolJson>[0],
): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const result = await callToolJson(client, "get_table_info", {
      orgId: ORG_ID,
      tableId: TABLE_ID,
      infoType: "ITM",
      pageSize: METADATA_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    const pageRows = readMetadataRows(
      result,
      `ITM metadata page ${pageNumber}`,
    );
    for (const row of pageRows) {
      for (const field of ["OBJ_ID", "OBJ_NM", "ITM_ID", "ITM_NM"]) {
        requiredString(row[field], `ITM metadata ${field}`);
      }
      const identity = ["OBJ_ID", "ITM_ID", "UP_ITM_ID", "ITM_NM"]
        .map((field) => optionalString(row[field]))
        .join("\u001f");
      expect(identity, "official metadata row identity").not.toBe(
        "\u001f\u001f\u001f",
      );
      expect(
        seen.has(identity),
        `duplicate official metadata row ${identity}`,
      ).toBe(false);
      seen.add(identity);
      rows.push(row);
    }
    if (result.hasMore === false) {
      expect(
        result.nextCursor === null || result.nextCursor === undefined,
        `ITM metadata page ${pageNumber} terminal cursor`,
      ).toBe(true);
      expect(rows.length, "complete official ITM metadata count").toBe(
        result.totalCount,
      );
      return rows;
    }
    const nextCursor = requiredString(
      result.nextCursor,
      `ITM metadata page ${pageNumber} nextCursor`,
    );
    expect(nextCursor, "metadata cursor must advance").not.toBe(cursor ?? "");
    cursor = nextCursor;
  }
  throw new Error(
    "official ITM metadata pagination exceeded the bounded page limit",
  );
}

function findDongnaeRegion(rows: readonly JsonRecord[]): RegionEvidence {
  const groups = new Set(
    rows.map((row) => requiredString(row.OBJ_ID, "metadata OBJ_ID")),
  );
  const candidates: RegionEvidence[] = [];
  for (const groupId of groups) {
    const groupRows = rows.filter(
      (row) => optionalString(row.OBJ_ID) === groupId,
    );
    const byId = new Map(
      groupRows.map((row) => [
        requiredString(row.ITM_ID, "metadata ITM_ID"),
        row,
      ]),
    );
    for (const row of groupRows) {
      if (requiredString(row.ITM_NM, "metadata ITM_NM") !== "동래구") continue;
      const path = pathFor(row, byId);
      const parentFound = path.slice(0, -1).some((item) => {
        const name = canonicalName(
          requiredString(item.ITM_NM, "metadata parent name"),
        );
        const expected = canonicalName("부산");
        return name === expected || name.startsWith(expected);
      });
      if (!parentFound) continue;
      candidates.push({
        code: requiredString(row.ITM_ID, "official Dongnae code"),
        name: requiredString(row.ITM_NM, "official Dongnae name"),
        axisName: requiredString(row.OBJ_NM, "official region axis name"),
        path: path.map((item) =>
          requiredString(item.ITM_NM, "official region path name"),
        ),
      });
    }
  }
  expect(candidates, "exact official 부산→동래구 metadata path").toHaveLength(
    1,
  );
  const selected = candidates[0];
  expect(selected.path.at(-1), "official region path leaf").toBe("동래구");
  expect(
    selected.path.map(canonicalName).join("/"),
    "official parent path witness",
  ).toContain(canonicalName("부산"));
  expect(
    selected.code,
    "metadata-derived region code must be non-empty",
  ).toMatch(/^\d+$/u);
  return selected;
}

function findPopulationMetadata(rows: readonly JsonRecord[]): {
  itemName: string;
  unit: string;
} {
  const candidates = rows.filter(
    (row) =>
      optionalString(row.ITM_ID) === ITEM_ID &&
      optionalString(row.ITM_NM).includes("총인구"),
  );
  expect(candidates, "official T20 population metadata").toHaveLength(1);
  const item = candidates[0];
  const itemName = requiredString(item.ITM_NM, "official T20 item name");
  const unit = requiredString(
    optionalString(item.UNIT) || optionalString(item.UNIT_NM),
    "official T20 unit metadata",
  );
  expect(unit, "official T20 unit must be truthful").not.toMatch(
    /^(?:unknown|n\/?a|null|미상|단위\s*미상|-|…|\.\.\.)$/iu,
  );
  return { itemName, unit };
}

function assertRawIdentity(
  raw: JsonRecord,
  region: RegionEvidence,
  unit: string,
  label: string,
): void {
  expect(requiredString(raw.ORG_ID, `${label} raw ORG_ID`)).toBe(ORG_ID);
  expect(requiredString(raw.TBL_ID, `${label} raw TBL_ID`)).toBe(TABLE_ID);
  expect(requiredString(raw.ITM_ID, `${label} raw ITM_ID`)).toBe(ITEM_ID);
  expect(requiredString(raw.C1, `${label} raw C1 region code`)).toBe(
    region.code,
  );
  expect(requiredString(raw.C1_NM, `${label} raw C1 region name`)).toBe(
    region.name,
  );
  expect(requiredString(raw.C1_OBJ_NM, `${label} raw C1 axis name`)).toBe(
    region.axisName,
  );
  expect(requiredString(raw.UNIT_NM, `${label} raw UNIT_NM`)).toBe(unit);
  requiredString(raw.TBL_NM, `${label} raw TBL_NM`);
  expect(requiredString(raw.PRD_SE, `${label} raw PRD_SE`)).toBe("A");
  requiredString(raw.ITM_NM, `${label} raw ITM_NM`);
}

function observationFromRow(
  row: JsonRecord,
  region: RegionEvidence,
  unit: string,
  label: string,
): AnnualObservation {
  const raw = asRecord(row.raw, `${label} raw observation`);
  assertRawIdentity(raw, region, unit, label);
  const period = requiredString(row.rawPeriod, `${label} rawPeriod`);
  expect(YEARS, `${label} requested annual period`).toContain(period);
  expect(requiredString(row.periodType, `${label} normalized periodType`)).toBe(
    "Y",
  );
  const rawValue = requiredString(row.rawValue, `${label} rawValue`);
  const rawDt = requiredString(raw.DT, `${label} raw DT`);
  expect(rawValue, `${label} rawValue preservation`).toBe(rawDt);
  const value = parseProviderNumber(rawValue, `${label} value`);
  expect(
    parseProviderNumber(row.value, `${label} displayed value`),
    `${label} displayed numeric value`,
  ).toBe(value);
  expect(requiredString(row.unit, `${label} normalized unit`)).toBe(unit);
  return { period, rawValue, value, raw, unit };
}

async function readAllAnnualMcpData(
  client: Parameters<typeof callToolJson>[0],
  region: RegionEvidence,
  unit: string,
): Promise<AnnualObservation[]> {
  const rows: AnnualObservation[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const result = await callToolJson(client, "get_statistics_data", {
      orgId: ORG_ID,
      tableId: TABLE_ID,
      objL1: region.code,
      itemId: ITEM_ID,
      periodType: "Y",
      startPeriod: "2015",
      endPeriod: "2025",
      pageSize: DATA_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    expect(result.success, `MCP annual page ${pageNumber} success`).toBe(true);
    const pageRows = requiredArray(
      result.data,
      `MCP annual page ${pageNumber} data`,
    ).map((row, index) =>
      observationFromRow(
        asRecord(row, `MCP annual page ${pageNumber}[${index}]`),
        region,
        unit,
        `MCP annual ${pageNumber}.${index + 1}`,
      ),
    );
    expect(
      result.returnedCount,
      `MCP annual page ${pageNumber} returnedCount`,
    ).toBe(pageRows.length);
    expect(
      pageRows.length,
      `MCP annual page ${pageNumber} page bound`,
    ).toBeLessThanOrEqual(DATA_PAGE_SIZE);
    for (const row of pageRows) {
      const identity = `${row.period}\u001f${row.raw.ITM_ID}\u001f${row.raw.C1}`;
      expect(
        seen.has(identity),
        `duplicate MCP annual observation ${identity}`,
      ).toBe(false);
      seen.add(identity);
      rows.push(row);
    }
    if (result.hasMore === false) {
      expect(
        result.nextCursor === null || result.nextCursor === undefined,
        "MCP annual terminal cursor",
      ).toBe(true);
      expect(result.traversalComplete, "MCP annual traversalComplete").toBe(
        true,
      );
      expect(result.completion, "MCP annual completion").toBe("complete");
      expect(result.completionScope, "MCP annual completion scope").toBe(
        "requested_period_traversal",
      );
      expect(result.aggregateRowCount, "MCP annual aggregate count").toBe(
        YEARS.length,
      );
      expect(rows, "MCP annual exact 2015-2025 observations").toHaveLength(
        YEARS.length,
      );
      return rows.sort((left, right) =>
        left.period.localeCompare(right.period),
      );
    }
    cursor = requiredString(
      result.nextCursor,
      `MCP annual page ${pageNumber} nextCursor`,
    );
  }
  throw new Error("MCP annual pagination exceeded the bounded page limit");
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  expect(
    !Number.isFinite(declared) || declared <= ORACLE_MAX_BYTES,
    "independent KOSIS response declared size bound",
  ).toBe(true);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (!part.value) continue;
      total += part.value.byteLength;
      if (total > ORACLE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error(
          "independent KOSIS response exceeded the bounded body limit",
        );
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readIndependentKosisRows(
  region: RegionEvidence,
): Promise<AnnualObservation[]> {
  const apiKey = process.env.KOSIS_API_KEY?.trim();
  if (!apiKey)
    throw new Error("independent KOSIS oracle credential is unavailable");
  const url = new URL(
    "/openapi/Param/statisticsParameterData.do",
    KOSIS_ORIGIN,
  );
  url.search = new URLSearchParams({
    method: "getList",
    orgId: ORG_ID,
    tblId: TABLE_ID,
    objL1: region.code,
    itmId: ITEM_ID,
    prdSe: "Y",
    startPrdDe: "2015",
    endPrdDe: "2025",
    apiKey,
    format: "json",
    jsonVD: "Y",
  }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ORACLE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "error",
      signal: controller.signal,
    });
    expect(
      new URL(response.url).origin,
      "independent KOSIS response origin",
    ).toBe(KOSIS_ORIGIN);
    expect(response.ok, "independent KOSIS response status").toBe(true);
    const body = await readBoundedResponse(response);
    expect(body.trim(), "independent KOSIS response body").not.toBe("");
    const parsed: unknown = JSON.parse(body);
    const rows = requiredArray(parsed, "independent KOSIS annual response").map(
      (row, index) =>
        asRecord(row, `independent KOSIS annual row ${index + 1}`),
    );
    expect(rows, "independent KOSIS exact annual row count").toHaveLength(
      YEARS.length,
    );
    return rows
      .map((raw, index) => {
        expect(requiredString(raw.ORG_ID, `oracle ${index + 1} ORG_ID`)).toBe(
          ORG_ID,
        );
        expect(requiredString(raw.TBL_ID, `oracle ${index + 1} TBL_ID`)).toBe(
          TABLE_ID,
        );
        expect(requiredString(raw.ITM_ID, `oracle ${index + 1} ITM_ID`)).toBe(
          ITEM_ID,
        );
        expect(requiredString(raw.C1, `oracle ${index + 1} C1`)).toBe(
          region.code,
        );
        expect(requiredString(raw.C1_NM, `oracle ${index + 1} C1_NM`)).toBe(
          region.name,
        );
        expect(
          requiredString(raw.C1_OBJ_NM, `oracle ${index + 1} C1_OBJ_NM`),
        ).toBe(region.axisName);
        expect(
          requiredString(raw.TBL_NM, `oracle ${index + 1} TBL_NM`),
        ).not.toBe("");
        expect(requiredString(raw.PRD_SE, `oracle ${index + 1} PRD_SE`)).toBe(
          "A",
        );
        const period = requiredString(raw.PRD_DE, `oracle ${index + 1} period`);
        expect(YEARS, `oracle ${index + 1} requested period`).toContain(period);
        const rawValue = requiredString(raw.DT, `oracle ${index + 1} DT`);
        const value = parseProviderNumber(rawValue, `oracle ${index + 1} DT`);
        const unit = requiredString(raw.UNIT_NM, `oracle ${index + 1} UNIT_NM`);
        return { period, rawValue, value, raw, unit };
      })
      .sort((left, right) => left.period.localeCompare(right.period));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("independent KOSIS"))
      throw error;
    throw new Error("independent KOSIS oracle request failed");
  } finally {
    clearTimeout(timer);
  }
}

function assertSameAnnualSeries(
  mcpRows: readonly AnnualObservation[],
  oracleRows: readonly AnnualObservation[],
  unit: string,
  label: string,
): void {
  expect(
    mcpRows.map((row) => row.period),
    `${label} MCP periods`,
  ).toEqual(YEARS);
  expect(
    oracleRows.map((row) => row.period),
    `${label} oracle periods`,
  ).toEqual(YEARS);
  expect(
    new Set(mcpRows.map((row) => row.unit)),
    `${label} MCP unit identity`,
  ).toEqual(new Set([unit]));
  expect(
    new Set(oracleRows.map((row) => row.unit)),
    `${label} oracle unit identity`,
  ).toEqual(new Set([unit]));
  for (let index = 0; index < YEARS.length; index += 1) {
    expect(mcpRows[index].rawValue, `${label} raw value ${YEARS[index]}`).toBe(
      oracleRows[index].rawValue,
    );
    expect(mcpRows[index].value, `${label} numeric value ${YEARS[index]}`).toBe(
      oracleRows[index].value,
    );
    const normalizedRaw = mcpRows[index].rawValue.replaceAll(",", "").trim();
    if (normalizedRaw.startsWith("-")) {
      expect(
        mcpRows[index].value,
        `${label} negative sign ${YEARS[index]}`,
      ).toBeLessThanOrEqual(0);
    } else if (/^\+?0+(?:\.0*)?(?:[eE][+-]?0+)?$/u.test(normalizedRaw)) {
      expect(mcpRows[index].value, `${label} zero sign ${YEARS[index]}`).toBe(
        0,
      );
    } else {
      expect(
        mcpRows[index].value,
        `${label} positive sign ${YEARS[index]}`,
      ).toBeGreaterThanOrEqual(0);
    }
  }
}

function endpointRate(first: number, last: number): number | null {
  if (first === 0) return null;
  return ((last - first) / Math.abs(first)) * 100;
}

function annualRate(values: readonly number[]): number | null {
  const rates: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] === 0) return null;
    rates.push(
      ((values[index] - values[index - 1]) / Math.abs(values[index - 1])) * 100,
    );
  }
  if (rates.length === 0) return null;
  return (
    Math.round(
      (rates.reduce((sum, rate) => sum + rate, 0) / rates.length) * 100,
    ) / 100
  );
}

function assertRate(
  value: unknown,
  expected: number | null,
  label: string,
): void {
  if (expected === null) {
    expect(value, `${label} zero-baseline rate`).toBeNull();
  } else {
    expect(typeof value, `${label} finite rate type`).toBe("number");
    expect(Number.isFinite(value), `${label} finite rate`).toBe(true);
    expect(value as number, `${label} exact rate`).toBeCloseTo(expected, 10);
  }
}

function assertRawResultIdentity(
  raw: JsonRecord,
  context: AnalysisContext,
  label: string,
): void {
  assertRawIdentity(raw, context.region, context.unit, label);
  const period = requiredString(raw.PRD_DE, `${label} raw period`);
  expect(YEARS, `${label} raw requested period`).toContain(period);
}

function assertProvenance(
  result: JsonRecord,
  context: AnalysisContext,
  label: string,
  expectedObservedPeriods: readonly string[],
  expectedQueryPeriods?: readonly string[],
  expectedRecentCount?: number,
): void {
  const provenance = asRecord(result.provenance, `${label} provenance`);
  expect(provenance.provider, `${label} provider`).toBe("kosis");
  expect(provenance.orgId, `${label} provenance orgId`).toBe(ORG_ID);
  expect(provenance.tableId, `${label} provenance tableId`).toBe(TABLE_ID);
  const sourceUrls = requiredArray(
    provenance.sourceUrls,
    `${label} sourceUrls`,
  );
  expect(sourceUrls.length, `${label} sourceUrls non-empty`).toBeGreaterThan(0);
  expect(sourceUrls.length, `${label} query count`).toBe(
    expectedQueryPeriods ? expectedQueryPeriods.length : 1,
  );
  for (const [index, value] of sourceUrls.entries()) {
    const url = new URL(
      requiredString(value, `${label} source URL ${index + 1}`),
    );
    expect(url.protocol, `${label} source URL protocol`).toBe("https:");
    expect(url.origin, `${label} source URL origin`).toBe("https://kosis.kr");
    expect(url.pathname, `${label} source URL route`).toBe(
      "/openapi/Param/statisticsParameterData.do",
    );
    expect(
      url.searchParams.has("apiKey"),
      `${label} source URL credential omission`,
    ).toBe(false);
    expect(url.searchParams.get("orgId"), `${label} source URL orgId`).toBe(
      ORG_ID,
    );
    expect(url.searchParams.get("tblId"), `${label} source URL tableId`).toBe(
      TABLE_ID,
    );
    expect(url.searchParams.get("objL1"), `${label} source URL selector`).toBe(
      context.region.code,
    );
    expect(url.searchParams.get("itmId"), `${label} source URL item`).toBe(
      ITEM_ID,
    );
    expect(
      url.searchParams.get("prdSe"),
      `${label} source URL period type`,
    ).toBe("Y");
    if (expectedQueryPeriods) {
      expect(
        url.searchParams.get("startPrdDe"),
        `${label} explicit query start`,
      ).toBe(expectedQueryPeriods[index]);
      expect(
        url.searchParams.get("endPrdDe"),
        `${label} explicit query end`,
      ).toBe(expectedQueryPeriods[index]);
    } else {
      expect(
        url.searchParams.has("startPrdDe"),
        `${label} no inferred start`,
      ).toBe(false);
      expect(url.searchParams.has("endPrdDe"), `${label} no inferred end`).toBe(
        false,
      );
      expect(
        url.searchParams.get("newEstPrdCnt"),
        `${label} recent-count query`,
      ).toBe(String(expectedRecentCount));
    }
  }
  expect(provenance.sourceUrl, `${label} primary source URL`).toBe(
    sourceUrls[0],
  );
  expect(
    provenance.requestedQueryCount,
    `${label} requested logical query count`,
  ).toBe(expectedQueryPeriods ? expectedQueryPeriods.length : 1);
  expect(
    provenance.queryListTruncated,
    `${label} logical query truncation`,
  ).toBe(false);
  expect(provenance.queryScope, `${label} query scope`).toBe(
    "requested_logical_queries",
  );
  expect(
    provenance.upstreamRequestHistory,
    `${label} upstream request history`,
  ).toBe("not_recorded");
  expect(provenance.observedPeriods, `${label} observed periods`).toEqual(
    expectedObservedPeriods,
  );
  expect(provenance.observedUnit, `${label} observed unit`).toBe(context.unit);
  const rawIds = requiredArray(
    provenance.rawObservationIds,
    `${label} raw observation IDs`,
  );
  expect(provenance.rawObservationCount, `${label} raw observation count`).toBe(
    expectedObservedPeriods.length,
  );
  expect(
    provenance.rawObservationIdsTruncated,
    `${label} raw observation ID truncation`,
  ).toBe(false);
  expect(rawIds.length, `${label} raw observation ID count`).toBe(
    expectedObservedPeriods.length,
  );
  for (const [index, value] of rawIds.entries()) {
    const identity = asRecord(value, `${label} raw identity ${index + 1}`);
    expect(identity.orgId, `${label} raw identity orgId`).toBe(ORG_ID);
    expect(identity.tableId, `${label} raw identity tableId`).toBe(TABLE_ID);
    expect(identity.itemId, `${label} raw identity itemId`).toBe(ITEM_ID);
    expect(identity.period, `${label} raw identity period`).toBe(
      expectedObservedPeriods[index],
    );
    expect(identity.unit, `${label} raw identity unit`).toBe(context.unit);
  }
  expect(
    Number.isNaN(
      Date.parse(requiredString(provenance.queriedAt, `${label} queriedAt`)),
    ),
  ).toBe(false);
  expect(
    Number.isNaN(
      Date.parse(requiredString(provenance.readAt, `${label} readAt`)),
    ),
  ).toBe(false);
  expect(provenance.timestampScope, `${label} timestamp scope`).toBe(
    "tool_observation",
  );
  expect(provenance.cacheFreshness, `${label} cache freshness`).toBe(
    "unproven",
  );
  expect(provenance.timestampNote, `${label} timestamp scope note`).toBe(
    "tool_observation_not_provider_refresh",
  );
  expect(provenance.cacheAge, `${label} cache age`).toBeNull();
  expect(
    provenance.providerUpdatedAt,
    `${label} provider freshness`,
  ).toBeNull();
  expect(provenance.definition, `${label} definition disclosure`).toBeNull();
  expect(provenance.boundary, `${label} boundary disclosure`).toBeNull();
  expect(provenance.denominator, `${label} denominator disclosure`).toBeNull();
  expect(provenance.boundaryPolicy, `${label} boundary policy`).toBe(
    "as_published",
  );
  expect(provenance.reallocation, `${label} reallocation policy`).toBe("none");
  expect(provenance.rescaling, `${label} rescaling policy`).toBe("none");
  expect(provenance.calculated, `${label} calculation status`).toBe(true);
  const appliedCalculations = requiredArray(
    provenance.appliedCalculations,
    `${label} applied calculations`,
  );
  const calculationPolicies = requiredArray(
    provenance.calculationPolicies,
    `${label} calculation policies`,
  );
  expect(
    calculationPolicies.length,
    `${label} calculation policies nonempty`,
  ).toBeGreaterThan(0);
  expect(
    appliedCalculations.length,
    `${label} applied calculations nonempty`,
  ).toBeGreaterThan(0);
}
function reportMetadataDefinitionGaps(rows: readonly JsonRecord[]): void {
  const populationRows = rows.filter(
    (row) => optionalString(row.ITM_ID) === ITEM_ID,
  );
  const definitionKeys = [
    ...new Set(
      rows.flatMap((row) =>
        Object.keys(row).filter((key) =>
          /definition|denominator|scope|boundary|정의|분모|범위|설명/iu.test(
            key,
          ),
        ),
      ),
    ),
  ];
  const observedKeys = definitionKeys.filter((key) =>
    populationRows.some((row) => optionalString(row[key]).length > 0),
  );
  if (observedKeys.length === 0) {
    test.info().annotations.push({
      type: "product-gap",
      description:
        "official ITM metadata exposes no population definition/denominator field for T20; no expected definition was invented",
    });
    return;
  }
  for (const key of observedKeys) {
    const values = populationRows
      .map((row) => optionalString(row[key]))
      .filter((value) => value.length > 0);
    expect(
      values.length,
      `official T20 metadata ${key} evidence`,
    ).toBeGreaterThan(0);
  }
}

async function reportOfficialSource(
  client: Parameters<typeof callToolJson>[0],
): Promise<void> {
  const sourceResult = await callToolJson(client, "get_table_info", {
    orgId: ORG_ID,
    tableId: TABLE_ID,
    infoType: "SOURCE",
    pageSize: 1,
  });
  if (!sourceResult.success) {
    test.info().annotations.push({
      type: "product-gap",
      description:
        "official SOURCE metadata was unavailable; ORG_ID/TBL_ID/raw provider identity remain the asserted source evidence",
    });
    return;
  }
  const source = optionalString(sourceResult.source);
  if (!source) {
    test.info().annotations.push({
      type: "product-gap",
      description:
        "official SOURCE metadata returned no source text; ORG_ID/TBL_ID/raw provider identity remain the asserted source evidence",
    });
    return;
  }
  expect(source, "official source metadata text").not.toBe("");
}

function normalizeSemantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSemantic);
  if (value !== null && typeof value === "object") {
    const record = value as JsonRecord;
    return Object.fromEntries(
      Object.keys(record)
        .filter(
          (key) =>
            !/(?:timestamp|queriedAt|readAt|observedAt|retrievedAt|generatedAt|fetchedAt|requestTime)/iu.test(
              key,
            ),
        )
        .sort()
        .map((key) => [key, normalizeSemantic(record[key])]),
    );
  }
  return value;
}

async function buildContext(
  client: Parameters<typeof callToolJson>[0],
): Promise<AnalysisContext> {
  const metadataRows = await readAllOfficialMetadata(client);
  const region = findDongnaeRegion(metadataRows);
  const population = findPopulationMetadata(metadataRows);
  reportMetadataDefinitionGaps(metadataRows);
  await reportOfficialSource(client);
  const table = await callToolJson(client, "get_table_info", {
    orgId: ORG_ID,
    tableId: TABLE_ID,
    infoType: "TBL",
    pageSize: 1,
  });
  expect(table.success, "official TBL metadata success").toBe(true);
  const tableName = requiredString(table.tableName, "official table name");
  const unitResult = await callToolJson(client, "get_table_info", {
    orgId: ORG_ID,
    tableId: TABLE_ID,
    infoType: "UNIT",
    pageSize: 1,
  });
  if (unitResult.success && unitResult.unit !== undefined) {
    expect(
      requiredString(unitResult.unit, "official UNIT metadata"),
      "official UNIT metadata identity",
    ).toBe(population.unit);
  } else {
    test.info().annotations.push({
      type: "product-gap",
      description:
        "official UNIT metadata did not expose a unit field; item-level UNIT evidence remains required",
    });
  }
  const periodResult = await callToolJson(client, "get_table_info", {
    orgId: ORG_ID,
    tableId: TABLE_ID,
    infoType: "PRD",
    pageSize: 1,
  });
  if (periodResult.success && periodResult.periodInfo !== undefined) {
    const periodInfo = asRecord(
      periodResult.periodInfo,
      "official period metadata",
    );
    if (periodInfo.startPeriod !== undefined)
      requiredString(periodInfo.startPeriod, "official historical boundary");
    if (periodInfo.endPeriod !== undefined)
      requiredString(periodInfo.endPeriod, "official current boundary");
  } else {
    test.info().annotations.push({
      type: "product-gap",
      description:
        "official PRD metadata did not expose period boundaries; requested 2015-2025 bounds are asserted from raw observations only",
    });
  }
  const annualRows = await readAllAnnualMcpData(
    client,
    region,
    population.unit,
  );
  const oracleRows = await readIndependentKosisRows(region);
  expect(
    oracleRows.map((row) => row.unit),
    "oracle unit agrees with metadata",
  ).toEqual(Array.from({ length: YEARS.length }, () => population.unit));
  assertSameAnnualSeries(
    annualRows,
    oracleRows,
    population.unit,
    "official annual series",
  );
  return {
    region,
    itemName: population.itemName,
    unit: population.unit,
    tableName,
    metadataRows: [...metadataRows],
    annualRows,
    oracleRows,
  };
}

async function assertAnalysisCase(kind: LiveTransportKind): Promise<void> {
  await withReleaseClient(kind, async ({ client }) => {
    const context = await buildContext(client);
    const input = {
      orgId: ORG_ID,
      tableId: TABLE_ID,
      objL1: context.region.code,
      itemId: ITEM_ID,
      periodType: "Y",
      yearCount: YEARS.length,
    };
    const analysis = await callToolJson(client, "analyze_time_series", input);
    expect(analysis.success, `${kind} analyze_time_series success`).toBe(true);
    expect(analysis.validationLevel, `${kind} analyze validation level`).toBe(
      "unverified",
    );
    const observedTableName = requiredString(
      analysis.tableName,
      `${kind} analyze tableName`,
    );
    expect(observedTableName).toBe(
      requiredString(
        context.annualRows[0].raw.TBL_NM,
        `${kind} statistics-row table name`,
      ),
    );
    expect(canonicalName(observedTableName).replaceAll(",", "")).toBe(
      canonicalName(context.tableName).replaceAll(",", ""),
    );
    expect(requiredString(analysis.unit, `${kind} analyze unit`)).toBe(
      context.unit,
    );
    const points = requiredArray(
      analysis.dataPoints,
      `${kind} analyze dataPoints`,
    ).map((point, index) =>
      asRecord(point, `${kind} analyze dataPoints[${index}]`),
    );
    expect(points, `${kind} analyze exact annual point count`).toHaveLength(
      YEARS.length,
    );
    const pointValues: number[] = [];
    for (const [index, point] of points.entries()) {
      const year = YEARS[index];
      expect(
        requiredString(point.period, `${kind} analyze period ${year}`),
      ).toBe(`${year}년`);
      const value = parseProviderNumber(
        point.value,
        `${kind} analyze value ${year}`,
      );
      const rawValue = requiredString(
        point.rawValue,
        `${kind} analyze rawValue ${year}`,
      );
      const raw = asRecord(point.raw, `${kind} analyze raw ${year}`);
      assertRawResultIdentity(raw, context, `${kind} analyze ${year}`);
      expect(
        requiredString(raw.PRD_DE, `${kind} analyze raw period ${year}`),
      ).toBe(year);
      expect(rawValue, `${kind} analyze rawValue preservation ${year}`).toBe(
        requiredString(raw.DT, `${kind} analyze DT ${year}`),
      );
      expect(value, `${kind} analyze value/oracle ${year}`).toBe(
        context.oracleRows[index].value,
      );
      pointValues.push(value);
    }
    const analysisBody = asRecord(analysis.analysis, `${kind} analysis body`);
    expect(
      ["increasing", "decreasing", "stable", "fluctuating"],
      `${kind} trend enum`,
    ).toContain(analysisBody.trend);
    const maxValue = asRecord(analysisBody.maxValue, `${kind} maxValue`);
    const minValue = asRecord(analysisBody.minValue, `${kind} minValue`);
    const maxIndex = pointValues.indexOf(Math.max(...pointValues));
    const minIndex = pointValues.indexOf(Math.min(...pointValues));
    expect(requiredString(maxValue.period, `${kind} max period`)).toBe(
      `${YEARS[maxIndex]}년`,
    );
    expect(
      parseProviderNumber(maxValue.value, `${kind} max numeric value`),
    ).toBe(pointValues[maxIndex]);
    expect(requiredString(minValue.period, `${kind} min period`)).toBe(
      `${YEARS[minIndex]}년`,
    );
    expect(
      parseProviderNumber(minValue.value, `${kind} min numeric value`),
    ).toBe(pointValues[minIndex]);
    const recentChange = asRecord(
      analysisBody.recentChange,
      `${kind} recentChange`,
    );
    expect(
      parseProviderNumber(recentChange.absolute, `${kind} recent absolute`),
    ).toBe(pointValues.at(-1)! - pointValues.at(-2)!);
    assertRate(
      recentChange.rate,
      endpointRate(pointValues.at(-2)!, pointValues.at(-1)!),
      `${kind} recent change`,
    );
    expect(
      analysisBody.averageGrowthRate,
      `${kind} independent 11-year annual rate`,
    ).toBe(annualRate(pointValues));
    const interpretation = requiredArray(
      analysis.interpretation,
      `${kind} analysis interpretation`,
    );
    expect(
      interpretation.length,
      `${kind} analysis interpretation nonempty`,
    ).toBeGreaterThan(0);
    assertProvenance(
      analysis,
      context,
      `${kind} analyze_time_series`,
      YEARS,
      undefined,
      YEARS.length,
    );
    const repeatedAnalysis = await callToolJson(
      client,
      "analyze_time_series",
      input,
    );
    expect(
      normalizeSemantic(repeatedAnalysis),
      `${kind} repeated analyze semantic equality`,
    ).toEqual(normalizeSemantic(analysis));

    const comparison = await callToolJson(client, "compare_statistics", {
      orgId: ORG_ID,
      tableId: TABLE_ID,
      compareType: "period",
      periodType: "Y",
      periods: ["2015", "2025"],
      objL1: context.region.code,
      itemId: ITEM_ID,
    });
    expect(comparison.success, `${kind} compare_statistics success`).toBe(true);
    expect(comparison.validationLevel, `${kind} compare validation level`).toBe(
      "verified",
    );
    const items = requiredArray(comparison.items, `${kind} compare items`).map(
      (item, index) => asRecord(item, `${kind} compare item ${index + 1}`),
    );
    expect(items, `${kind} compare explicit endpoint item count`).toHaveLength(
      2,
    );
    const byYear = new Map<string, JsonRecord>();
    for (const item of items) {
      const period = requiredString(item.period, `${kind} compare period`);
      expect(["2015", "2025"], `${kind} compare requested period`).toContain(
        period,
      );
      expect(
        byYear.has(period),
        `${kind} compare duplicate period ${period}`,
      ).toBe(false);
      byYear.set(period, item);
      const value = parseProviderNumber(
        item.value,
        `${kind} compare value ${period}`,
      );
      const rawValue = requiredString(
        item.rawValue,
        `${kind} compare rawValue ${period}`,
      );
      const raw = asRecord(item.raw, `${kind} compare raw ${period}`);
      assertRawResultIdentity(raw, context, `${kind} compare ${period}`);
      expect(rawValue, `${kind} compare rawValue preservation ${period}`).toBe(
        requiredString(raw.DT, `${kind} compare DT ${period}`),
      );
      expect(value, `${kind} compare value/oracle ${period}`).toBe(
        context.oracleRows[YEARS.indexOf(period)].value,
      );
      expect(requiredString(item.unit, `${kind} compare unit ${period}`)).toBe(
        context.unit,
      );
      expect(
        requiredString(item.itemId, `${kind} compare itemId ${period}`),
      ).toBe(ITEM_ID);
      requiredString(item.itemName, `${kind} compare itemName ${period}`);
    }
    expect(byYear.size, `${kind} compare endpoint periods`).toBe(2);
    const firstItem = byYear.get("2015")!;
    const lastItem = byYear.get("2025")!;
    expect(
      firstItem.change,
      `${kind} first endpoint has no prior change`,
    ).toBeUndefined();
    const endpointChange = asRecord(lastItem.change, `${kind} endpoint change`);
    const firstValue = parseProviderNumber(
      firstItem.value,
      `${kind} first endpoint numeric value`,
    );
    const lastValue = parseProviderNumber(
      lastItem.value,
      `${kind} last endpoint numeric value`,
    );
    expect(
      parseProviderNumber(
        endpointChange.absolute,
        `${kind} endpoint absolute change`,
      ),
    ).toBe(lastValue - firstValue);
    assertRate(
      endpointChange.rate,
      endpointRate(firstValue, lastValue),
      `${kind} endpoint percent change`,
    );
    assertProvenance(
      comparison,
      context,
      `${kind} compare_statistics`,
      ["2015", "2025"],
      ["2015", "2025"],
    );
    const repeatedComparison = await callToolJson(
      client,
      "compare_statistics",
      {
        orgId: ORG_ID,
        tableId: TABLE_ID,
        compareType: "period",
        periodType: "Y",
        periods: ["2015", "2025"],
        objL1: context.region.code,
        itemId: ITEM_ID,
      },
    );
    expect(
      normalizeSemantic(repeatedComparison),
      `${kind} repeated compare semantic equality`,
    ).toEqual(normalizeSemantic(comparison));
  });
}

const releasePhase = process.env.KOREA_STATS_RELEASE_PHASE?.trim();
const registerR2R3Cases = releasePhase !== "R1";

if (registerR2R3Cases) {
  test(
    "REQ-Q03.stdio official annual analysis and endpoint comparison @live @stdio @AC8 @AC9",
    { tag: ["@REQ-Q03.stdio", "@live", "@stdio", "@AC8", "@AC9"] },
    async () =>
      runSanitizedLiveCase("REQ-Q03.stdio", () => assertAnalysisCase("stdio")),
  );

  test(
    "REQ-Q03.http official annual analysis and endpoint comparison @live @http @AC8 @AC9",
    { tag: ["@REQ-Q03.http", "@live", "@http", "@AC8", "@AC9"] },
    async () =>
      runSanitizedLiveCase("REQ-Q03.http", () => assertAnalysisCase("http")),
  );
}
