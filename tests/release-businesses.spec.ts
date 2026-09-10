import { expect, test } from "@playwright/test";
const BUSINESS_DOC_URL = "https://www.data.go.kr/data/15012005/openapi.do";
const BUSINESS_REGION_ENDPOINT =
  "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong";
import {
  callToolJson,
  runSanitizedLiveCase,
  withReleaseClient,
  type LiveTransportKind,
} from "./release-live-client";

test.setTimeout(180_000);

type JsonRecord = Record<string, unknown>;
type IndustryType = "indsLclsCd" | "indsMclsCd" | "indsSclsCd";
type BusinessQuery = {
  readonly regionType: "ctprvnCd";
  readonly regionCode: "26";
  readonly industryType?: IndustryType;
  readonly industryCode?: string;
};
type OfficialPage = {
  readonly rows: JsonRecord[];
  readonly pageNo: number;
  readonly numOfRows: number;
  readonly totalCount: number;
  readonly stdrYm?: string;
};
type IndustryQuery = {
  readonly industryType: IndustryType;
  readonly industryCode: string;
};

const RAW_REQUEST_TIMEOUT_MS = 15_000;
const MAX_RAW_RESPONSE_BYTES = 4 * 1024 * 1024;
const REGION_QUERY: BusinessQuery = {
  regionType: "ctprvnCd",
  regionCode: "26",
};
const INDUSTRY_TYPES: readonly IndustryType[] = [
  "indsLclsCd",
  "indsMclsCd",
  "indsSclsCd",
];

class OfficialProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficialProviderError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyProviderValue(value: unknown, label: string): string {
  expect(value, `${label} exists`).not.toBeNull();
  expect(["string", "number"], `${label} scalar type`).toContain(typeof value);
  const text = String(value).trim();
  expect(text.length, `${label} nonempty`).toBeGreaterThan(0);
  return text;
}

function asInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function decodeServiceKey(raw: string): string {
  const trimmed = raw.trim();
  if (!/%[0-9a-f]{2}/i.test(trimmed)) return trimmed;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function operatorServiceKey(): string {
  const configured = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  if (!configured) {
    throw new OfficialProviderError(
      "original business-provider comparison requires DATA_GO_KR_SERVICE_KEY",
    );
  }
  const decoded = decodeServiceKey(configured);
  if (!decoded) {
    throw new OfficialProviderError(
      "original business-provider comparison requires DATA_GO_KR_SERVICE_KEY",
    );
  }
  return decoded;
}

function officialRequestUrl(query: BusinessQuery, serviceKey: string): URL {
  const url = new URL(BUSINESS_REGION_ENDPOINT);
  const params = url.searchParams;
  params.set("divId", query.regionType);
  params.set("key", query.regionCode);
  if (query.industryType !== undefined && query.industryCode !== undefined) {
    params.set(query.industryType, query.industryCode);
  }
  params.set("numOfRows", "20");
  params.set("pageNo", "1");
  params.set("type", "json");
  // URLSearchParams performs the sole URL encoding of the decoded key.
  params.set("serviceKey", serviceKey);
  return url;
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_RAW_RESPONSE_BYTES
  ) {
    throw new OfficialProviderError(
      "official business-provider response exceeded the bounded body limit",
    );
  }
  if (!response.body) {
    throw new OfficialProviderError(
      "official business-provider response had no readable body",
    );
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      if (!item.value) continue;
      byteLength += item.value.byteLength;
      if (byteLength > MAX_RAW_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new OfficialProviderError(
          "official business-provider response exceeded the bounded body limit",
        );
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new OfficialProviderError(
      "official business-provider response was not valid UTF-8",
    );
  }
}

function parseOfficialPage(text: string): OfficialPage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OfficialProviderError(
      "official business-provider response was not valid JSON",
    );
  }
  if (!isRecord(parsed)) {
    throw new OfficialProviderError(
      "official business-provider response shape was unknown",
    );
  }
  const response = parsed;
  if (!isRecord(response.header) || !isRecord(response.body)) {
    throw new OfficialProviderError(
      "official business-provider response shape was unknown",
    );
  }
  const header = response.header;
  const body = response.body;
  if (String(header.resultCode ?? "") !== "00") {
    throw new OfficialProviderError(
      "official business-provider returned a provider error",
    );
  }

  const pageNo = asInteger(body.pageNo);
  const numOfRows = asInteger(body.numOfRows);
  const totalCount = asInteger(body.totalCount);
  if (
    pageNo === undefined ||
    numOfRows === undefined ||
    totalCount === undefined ||
    totalCount < 0
  ) {
    throw new OfficialProviderError(
      "official business-provider pagination metadata was unknown",
    );
  }
  if (pageNo !== 1 || numOfRows !== 20) {
    throw new OfficialProviderError(
      "official business-provider pagination did not echo the request",
    );
  }

  const itemContainer = body.items;
  let rawItems: unknown;
  if (Array.isArray(itemContainer)) {
    rawItems = itemContainer;
  } else if (isRecord(itemContainer) && Object.hasOwn(itemContainer, "item")) {
    rawItems = itemContainer.item;
  } else {
    throw new OfficialProviderError(
      "official business-provider response shape was unknown",
    );
  }
  const rows = Array.isArray(rawItems) ? rawItems : [rawItems];
  if (!rows.every(isRecord)) {
    throw new OfficialProviderError(
      "official business-provider response rows had an unknown shape",
    );
  }
  const providerRows = rows as JsonRecord[];

  const expectedCount = Math.min(20, Math.max(0, totalCount));
  if (providerRows.length !== expectedCount) {
    throw new OfficialProviderError(
      "official business-provider returned an unexpected page count",
    );
  }
  if (providerRows.length === 0 || totalCount <= 0) {
    throw new OfficialProviderError(
      "official business-provider returned no usable business records",
    );
  }

  const stdrYm =
    header.stdrYm === undefined ||
    header.stdrYm === null ||
    String(header.stdrYm).length === 0
      ? undefined
      : String(header.stdrYm);
  return {
    rows: providerRows,
    pageNo,
    numOfRows,
    totalCount,
    ...(stdrYm === undefined ? {} : { stdrYm }),
  };
}

async function fetchOfficialPage(query: BusinessQuery): Promise<OfficialPage> {
  const serviceKey = operatorServiceKey();
  const requestUrl = officialRequestUrl(query, serviceKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RAW_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new OfficialProviderError(
        "official business-provider returned an HTTP error",
      );
    }
    const body = await readBoundedBody(response);
    return parseOfficialPage(body);
  } catch (error) {
    if (error instanceof OfficialProviderError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OfficialProviderError(
        "official business-provider request timed out",
      );
    }
    throw new OfficialProviderError(
      "official business-provider request failed",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function asRows(value: unknown, label: string): JsonRecord[] {
  expect(Array.isArray(value), `${label} rows`).toBe(true);
  const values = value as unknown[];
  expect(values.length, `${label} nonempty rows`).toBeGreaterThan(0);
  return values.map((row, index) => {
    expect(isRecord(row), `${label} row ${index + 1} object`).toBe(true);
    return row as JsonRecord;
  });
}

function assertProviderRows(
  rows: readonly JsonRecord[],
  query: BusinessQuery,
  label: string,
): void {
  for (const [index, row] of rows.entries()) {
    const rowLabel = `${label} row ${index + 1}`;
    nonEmptyProviderValue(row.bizesId, `${rowLabel} provider identity bizesId`);
    nonEmptyProviderValue(row.bizesNm, `${rowLabel} provider identity bizesNm`);
    const regionCode = nonEmptyProviderValue(
      row.ctprvnCd,
      `${rowLabel} provider identity ctprvnCd`,
    );
    expect(regionCode, `${rowLabel} requested Busan code`).toBe("26");
    nonEmptyProviderValue(
      row.ctprvnNm,
      `${rowLabel} provider identity ctprvnNm`,
    );
    const longitude = nonEmptyProviderValue(
      row.lon,
      `${rowLabel} provider longitude`,
    );
    const latitude = nonEmptyProviderValue(
      row.lat,
      `${rowLabel} provider latitude`,
    );
    expect(
      Number.isFinite(Number(longitude)),
      `${rowLabel} longitude number`,
    ).toBe(true);
    expect(
      Number.isFinite(Number(latitude)),
      `${rowLabel} latitude number`,
    ).toBe(true);

    if (query.industryType !== undefined && query.industryCode !== undefined) {
      const industryCode = nonEmptyProviderValue(
        row[query.industryType],
        `${rowLabel} applied ${query.industryType}`,
      );
      expect(industryCode, `${rowLabel} applied industry code`).toBe(
        query.industryCode,
      );
    }
  }
}

function deriveIndustryQuery(rows: readonly JsonRecord[]): IndustryQuery {
  const firstRow = rows[0];
  if (!firstRow) {
    throw new OfficialProviderError(
      "official business-provider returned no record for industry derivation",
    );
  }
  for (const industryType of INDUSTRY_TYPES) {
    const value = firstRow[industryType];
    if (
      (typeof value === "string" || typeof value === "number") &&
      String(value).trim().length > 0
    ) {
      return {
        industryType,
        industryCode: String(value).trim(),
      };
    }
  }
  throw new OfficialProviderError(
    "official business-provider record had no documented industry code",
  );
}

function assertPublicMetadata(
  result: JsonRecord,
  raw: OfficialPage,
  query: BusinessQuery,
  label: string,
): JsonRecord[] {
  expect(result.success, `${label} success`).toBe(true);
  expect(result.page, `${label} page echo`).toBe(raw.pageNo);
  expect(result.pageSize, `${label} page-size echo`).toBe(raw.numOfRows);
  expect(result.providerPageNo, `${label} provider page echo`).toBe(raw.pageNo);
  expect(result.providerNumOfRows, `${label} provider page-size echo`).toBe(
    raw.numOfRows,
  );
  expect(result.providerTotal, `${label} provider total`).toBe(raw.totalCount);

  const rows = asRows(result.rows, `${label} rows`);
  const items = asRows(result.items, `${label} items`);
  const data = asRows(result.data, `${label} data`);
  expect(rows, `${label} rows preserve original provider objects`).toEqual(
    raw.rows,
  );
  expect(items, `${label} items preserve original provider objects`).toEqual(
    raw.rows,
  );
  expect(data, `${label} data preserve original provider objects`).toEqual(
    raw.rows,
  );
  expect(result.returnedCount, `${label} returned count`).toBe(raw.rows.length);
  expect(raw.totalCount, `${label} meaningful provider total`).toBeGreaterThan(
    0,
  );
  expect(
    raw.totalCount,
    `${label} total covers returned page`,
  ).toBeGreaterThanOrEqual(raw.rows.length);
  expect(
    raw.rows.length,
    `${label} page count is min(pageSize, remaining provider records)`,
  ).toBe(Math.min(raw.numOfRows, raw.totalCount));
  expect(result.hasMore, `${label} provider continuation`).toBe(
    raw.numOfRows < raw.totalCount,
  );
  expect(result.nextPage, `${label} next page`).toBe(
    raw.numOfRows < raw.totalCount ? 2 : null,
  );

  expect(result.validationLevel, `${label} validation level`).toBe("verified");
  expect(result.missingFields ?? [], `${label} missing fields`).toEqual([]);
  expect(Object.hasOwn(result, "unit"), `${label} invented numeric unit`).toBe(
    false,
  );

  const source = result.source;
  expect(isRecord(source), `${label} source metadata object`).toBe(true);
  const sourceRecord = source as JsonRecord;
  expect(sourceRecord.provider, `${label} provider metadata`).toBe(
    "소상공인시장진흥공단 상권정보 API",
  );
  expect(sourceRecord.endpoint, `${label} provider endpoint metadata`).toBe(
    BUSINESS_REGION_ENDPOINT,
  );
  expect(sourceRecord.docURL, `${label} provider documentation metadata`).toBe(
    BUSINESS_DOC_URL,
  );

  const sourceUrl = nonEmptyProviderValue(
    result.sourceUrl,
    `${label} sourceUrl`,
  );
  expect(sourceUrl, `${label} public source URL`).toBe(
    BUSINESS_REGION_ENDPOINT,
  );
  const publicUrl = new URL(sourceUrl);
  expect(publicUrl.search, `${label} source URL has no query credentials`).toBe(
    "",
  );
  expect(publicUrl.hash, `${label} source URL has no hash credentials`).toBe(
    "",
  );
  expect(result.docURL, `${label} public documentation URL`).toBe(
    BUSINESS_DOC_URL,
  );
  expect(result.access, `${label} access metadata`).toBe(
    "public_service_operating_key",
  );
  const retrieval = result.retrieval;
  expect(isRecord(retrieval), `${label} retrieval metadata object`).toBe(true);
  expect((retrieval as JsonRecord).status, `${label} retrieval status`).toBe(
    "success",
  );
  expect((retrieval as JsonRecord).access, `${label} retrieval access`).toBe(
    "public_service_operating_key",
  );
  const observedAt = nonEmptyProviderValue(
    result.observedAt,
    `${label} observedAt`,
  );
  expect(Number.isNaN(Date.parse(observedAt)), `${label} observedAt ISO`).toBe(
    false,
  );
  const semantics = nonEmptyProviderValue(
    result.stdrYmSemantics,
    `${label} standard-month semantics`,
  );
  expect(semantics, `${label} snapshot freshness is not asserted`).toContain(
    "안정적인 snapshot",
  );
  if (raw.stdrYm === undefined) {
    expect(result.stdrYm, `${label} absent provider snapshot`).toBeNull();
  } else {
    expect(result.stdrYm, `${label} provider snapshot echo`).toBe(raw.stdrYm);
  }

  const completeness = result.completeness;
  expect(isRecord(completeness), `${label} completeness metadata object`).toBe(
    true,
  );
  const completenessRecord = completeness as JsonRecord;
  expect(completenessRecord.status, `${label} current page scope`).toBe(
    "current_page_only",
  );
  expect(completenessRecord.currentPage, `${label} completeness page`).toBe(1);
  expect(completenessRecord.pageSize, `${label} completeness page-size`).toBe(
    20,
  );
  expect(completenessRecord.returned, `${label} completeness returned`).toBe(
    raw.rows.length,
  );
  expect(completenessRecord.wholeDataset, `${label} whole dataset claim`).toBe(
    "not_retrieved",
  );

  const pages = result.pages;
  expect(isRecord(pages), `${label} page proof object`).toBe(true);
  const pagesRecord = pages as JsonRecord;
  expect(pagesRecord.currentPage, `${label} page proof current page`).toBe(1);
  expect(pagesRecord.pageSize, `${label} page proof page-size`).toBe(20);
  expect(pagesRecord.pageNo, `${label} page proof provider page`).toBe(1);
  expect(pagesRecord.numOfRows, `${label} page proof provider page-size`).toBe(
    20,
  );
  expect(pagesRecord.returned, `${label} page proof returned`).toBe(
    raw.rows.length,
  );
  expect(pagesRecord.hasMore, `${label} page proof continuation`).toBe(
    raw.numOfRows < raw.totalCount,
  );

  assertProviderRows(rows, query, label);
  return rows;
}

async function assertBusinessEvidence(kind: LiveTransportKind): Promise<void> {
  // Resolve the key before opening either transport so a missing key is an
  // admission failure, never a skipped placeholder, and never appears in an error.
  operatorServiceKey();
  await withReleaseClient(kind, async ({ client }) => {
    const regionResult = await callToolJson(client, "search_businesses", {
      regionType: "ctprvnCd",
      regionCode: "26",
      page: 1,
      pageSize: 20,
    });
    const regionRaw = await fetchOfficialPage(REGION_QUERY);
    const regionRows = assertPublicMetadata(
      regionResult,
      regionRaw,
      REGION_QUERY,
      `${kind} Busan province region query`,
    );
    expect(regionRows, `${kind} region rows exact provider comparison`).toEqual(
      regionRaw.rows,
    );

    const derivedIndustry = deriveIndustryQuery(regionRows);
    const combinedQuery: BusinessQuery = {
      ...REGION_QUERY,
      ...derivedIndustry,
    };
    const combinedResult = await callToolJson(client, "search_businesses", {
      ...combinedQuery,
      page: 1,
      pageSize: 20,
    });
    const combinedRaw = await fetchOfficialPage(combinedQuery);
    const combinedRows = assertPublicMetadata(
      combinedResult,
      combinedRaw,
      combinedQuery,
      `${kind} Busan province plus derived industry query`,
    );
    expect(
      combinedRows,
      `${kind} combined rows exact provider comparison`,
    ).toEqual(combinedRaw.rows);
    assertProviderRows(combinedRows, combinedQuery, `${kind} combined query`);
  });
}

const releasePhase = process.env.KOREA_STATS_RELEASE_PHASE?.trim();
const registerR3Cases =
  releasePhase === undefined || releasePhase === "" || releasePhase === "R3";

if (registerR3Cases) {
  test(
    "REQ-D01.stdio live businesses original-provider comparison and derived filter @live @stdio @AC7 @AC8",
    {
      tag: ["@REQ-D01.stdio", "@live", "@stdio", "@AC7", "@AC8"],
    },
    async () =>
      runSanitizedLiveCase("REQ-D01.stdio", () =>
        assertBusinessEvidence("stdio"),
      ),
  );

  test(
    "REQ-D01.http live businesses original-provider comparison and derived filter @live @http @AC7 @AC8",
    {
      tag: ["@REQ-D01.http", "@live", "@http", "@AC7", "@AC8"],
    },
    async () =>
      runSanitizedLiveCase("REQ-D01.http", () =>
        assertBusinessEvidence("http"),
      ),
  );
}
