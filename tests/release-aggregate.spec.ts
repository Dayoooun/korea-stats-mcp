import { test, expect } from "@playwright/test";
import {
  callToolJson,
  canonicalJson,
  runSanitizedLiveCase,
  withReleaseClient,
  type LiveTransportKind,
} from "./release-live-client";

const ORG_ID = "101";
const TABLE_ID = "DT_1B040A3";
const ITEM_ID = "T20";
const START_PERIOD = "2015";
const END_PERIOD = "2025";
const YEARS = Array.from({ length: 11 }, (_, index) => String(2015 + index));
const METADATA_PAGE_SIZE = 32;
const DATA_PAGE_SIZE = 200;
const MAX_PAGES = 64;
const SOURCE_TIMEOUT_MS = 15_000;
const SOURCE_MAX_BYTES = 4 * 1024 * 1024;
const MCP_MAX_BYTES = 32_768;
const EXPECTED_OBSERVATIONS = 19 * YEARS.length;

const BUSAN_DISTRICT_NAMES = [
  "중구",
  "서구",
  "동구",
  "영도구",
  "부산진구",
  "동래구",
  "남구",
  "북구",
  "해운대구",
  "사하구",
  "금정구",
  "강서구",
  "연제구",
  "수영구",
  "사상구",
  "기장군",
] as const;

const releasePhase = process.env.KOREA_STATS_RELEASE_PHASE?.trim();
const registerR3Cases =
  releasePhase === undefined || releasePhase === "" || releasePhase === "R3";

test.setTimeout(300_000);

type JsonRecord = Record<string, unknown>;
type MetadataRegion = {
  readonly code: string;
  readonly name: string;
  readonly path: readonly string[];
};
type MetadataWitness = {
  readonly itemId: string;
  readonly itemName: string;
  readonly axisName: string;
  readonly regions: readonly MetadataRegion[];
};
type SourceObservation = {
  readonly itemId: string;
  readonly code: string;
  readonly name: string;
  readonly period: string;
  readonly value: string;
  readonly unit: string;
};
type SourceFixture = {
  readonly metadata: MetadataWitness;
  readonly observations: ReadonlyMap<string, SourceObservation>;
  readonly selectors: readonly MetadataRegion[];
  readonly compoundSelector: string;
};

let metadataBaseline: MetadataWitness | undefined;
let sourceFixture: SourceFixture | undefined;

function requiredString(value: unknown, label: string): string {
  expect(typeof value, `${label} type`).toBe("string");
  const text = String(value).trim();
  expect(text.length, `${label} nonempty`).toBeGreaterThan(0);
  return text;
}

function optionalString(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function asRecord(value: unknown, label: string): JsonRecord {
  expect(value, `${label} object`).not.toBeNull();
  expect(typeof value, `${label} object type`).toBe("object");
  expect(Array.isArray(value), `${label} array`).toBe(false);
  return value as JsonRecord;
}

function mcpWireBytes(value: JsonRecord): number {
  return Buffer.byteLength(
    JSON.stringify({
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    }),
  );
}

function canonicalName(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, "").toLocaleLowerCase("ko-KR");
}

function pathFor(row: JsonRecord, rowsById: Map<string, JsonRecord>): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current: JsonRecord | undefined = row;
  while (current) {
    const id = requiredString(current.ITM_ID, "metadata ITM_ID");
    expect(seen.has(id), "official metadata parent path cycle").toBe(false);
    seen.add(id);
    path.unshift(requiredString(current.ITM_NM, "metadata ITM_NM"));
    const parentId = optionalString(current.UP_ITM_ID);
    current = parentId ? rowsById.get(parentId) : undefined;
  }
  return path;
}

function pathHasParent(path: readonly string[], parentName: string): boolean {
  const expected = canonicalName(parentName);
  return path.slice(0, -1).some((name) => canonicalName(name) === expected);
}

async function readAllMetadata(
  client: Parameters<typeof callToolJson>[0],
): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = [];
  const identities = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let totalCount: number | undefined;

  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const page = await callToolJson(client, "get_table_info", {
      orgId: ORG_ID,
      tableId: TABLE_ID,
      infoType: "ITM",
      pageSize: METADATA_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    expect(page.success, `metadata page ${pageNumber} success`).toBe(true);
    expect(page.orgId, `metadata page ${pageNumber} orgId`).toBe(ORG_ID);
    expect(page.tableId, `metadata page ${pageNumber} tableId`).toBe(TABLE_ID);
    expect(page.infoType, `metadata page ${pageNumber} infoType`).toBe("ITM");
    expect(
      mcpWireBytes(page),
      `metadata page ${pageNumber} MCP bytes`,
    ).toBeLessThanOrEqual(MCP_MAX_BYTES);
    expect(
      Array.isArray(page.rawData),
      `metadata page ${pageNumber} rawData`,
    ).toBe(true);
    const pageRows = (page.rawData as unknown[]).map((row, index) =>
      asRecord(row, `metadata page ${pageNumber} row ${index + 1}`),
    );
    expect(
      page.returnedCount,
      `metadata page ${pageNumber} returnedCount`,
    ).toBe(pageRows.length);
    expect(
      pageRows.length,
      `metadata page ${pageNumber} page-size bound`,
    ).toBeLessThanOrEqual(METADATA_PAGE_SIZE);
    expect(
      Number.isInteger(page.totalCount),
      `metadata page ${pageNumber} totalCount`,
    ).toBe(true);
    if (totalCount === undefined) totalCount = Number(page.totalCount);
    expect(
      page.totalCount,
      `metadata page ${pageNumber} stable totalCount`,
    ).toBe(totalCount);

    for (const [index, row] of pageRows.entries()) {
      for (const field of ["OBJ_ID", "OBJ_NM", "ITM_ID", "ITM_NM"]) {
        requiredString(
          row[field],
          `metadata page ${pageNumber} row ${index + 1} ${field}`,
        );
      }
      const identity = canonicalJson(row);
      expect(
        identities.has(identity),
        `duplicate metadata row ${identity}`,
      ).toBe(false);
      identities.add(identity);
      rows.push(row);
    }

    if (page.hasMore === true) {
      const nextCursor = requiredString(
        page.nextCursor,
        `metadata page ${pageNumber} nextCursor`,
      );
      expect(
        cursors.has(nextCursor),
        `repeated metadata cursor ${nextCursor}`,
      ).toBe(false);
      cursors.add(nextCursor);
      cursor = nextCursor;
      continue;
    }
    expect(page.hasMore, `metadata page ${pageNumber} completion`).toBe(false);
    expect(
      page.nextCursor,
      `metadata page ${pageNumber} terminal cursor`,
    ).toBeNull();
    expect(rows.length, "complete metadata count").toBe(totalCount);
    return rows;
  }
  throw new Error(`get_table_info exceeded ${MAX_PAGES} pages`);
}

function deriveMetadata(rows: readonly JsonRecord[]): MetadataWitness {
  const busanCandidates = rows.filter(
    (row) => optionalString(row.ITM_NM) === "부산광역시",
  );
  expect(
    busanCandidates,
    "official 부산광역시 metadata candidates",
  ).toHaveLength(1);
  const busan = busanCandidates[0];
  const regionObjId = requiredString(busan.OBJ_ID, "region metadata OBJ_ID");
  const axisName = requiredString(busan.OBJ_NM, "region metadata OBJ_NM");
  const regionRows = rows.filter(
    (row) => optionalString(row.OBJ_ID) === regionObjId,
  );
  expect(regionRows.length, "region metadata rows").toBeGreaterThan(0);
  const rowsById = new Map<string, JsonRecord>();
  for (const row of regionRows) {
    const id = requiredString(row.ITM_ID, "region metadata ITM_ID");
    expect(rowsById.has(id), `duplicate region metadata ITM_ID ${id}`).toBe(
      false,
    );
    rowsById.set(id, row);
  }

  const findRegion = (name: string, parentName?: string): MetadataRegion => {
    const candidates = regionRows
      .filter((row) => optionalString(row.ITM_NM) === name)
      .map((row) => ({
        row,
        path: pathFor(row, rowsById),
      }))
      .filter(({ path }) =>
        parentName === undefined ? true : pathHasParent(path, parentName),
      );
    expect(
      candidates,
      `official metadata exact region ${parentName ?? ""} ${name}`,
    ).toHaveLength(1);
    const selected = candidates[0];
    return {
      code: requiredString(selected.row.ITM_ID, `${name} region code`),
      name: requiredString(selected.row.ITM_NM, `${name} region name`),
      path: selected.path,
    };
  };

  const national = findRegion("전국");
  const busanProvince = findRegion("부산광역시");
  const districts = BUSAN_DISTRICT_NAMES.map((name) => {
    const region = findRegion(name, "부산광역시");
    expect(region.path.at(-2), `${name} direct 부산광역시 parent`).toBe(
      "부산광역시",
    );
    return region;
  });
  const suwon = findRegion("수원시", "경기도");
  const selectedRegions = [national, busanProvince, ...districts, suwon];
  expect(selectedRegions, "requested region count").toHaveLength(19);
  expect(
    new Set(selectedRegions.map((region) => region.code)).size,
    "requested region code identity",
  ).toBe(19);

  const itemCandidates = rows.filter(
    (row) =>
      optionalString(row.ITM_ID) === ITEM_ID &&
      optionalString(row.ITM_NM).includes("총인구"),
  );
  expect(itemCandidates, "official T20 item metadata").toHaveLength(1);
  const item = itemCandidates[0];
  const itemName = requiredString(item.ITM_NM, "official T20 item name");
  const metadataUnit =
    optionalString(item.UNIT) || optionalString(item.UNIT_NM);
  expect(metadataUnit, "official T20 metadata unit").not.toMatch(
    /^(?:unknown|n\/?a|null|미상|단위\s*미상|-|…|\.\.\.)$/iu,
  );

  return {
    itemId: requiredString(item.ITM_ID, "official T20 item ID"),
    itemName,
    axisName,
    regions: selectedRegions,
  };
}

function metadataIdentity(metadata: MetadataWitness): string {
  return canonicalJson({
    itemId: metadata.itemId,
    itemName: metadata.itemName,
    axisName: metadata.axisName,
    regions: metadata.regions.map((region) => ({
      code: region.code,
      name: region.name,
      path: region.path,
    })),
  });
}

async function readBoundedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (!part.value) continue;
      totalBytes += part.value.byteLength;
      if (totalBytes > SOURCE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("official source response exceeded 4MiB");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function officialSourceGet(
  objL1: string,
  itemId: string,
): Promise<JsonRecord[]> {
  const apiKey = process.env.KOSIS_API_KEY?.trim();
  if (!apiKey)
    throw new Error("KOSIS_API_KEY is required for official source evidence");
  const url = new URL(
    "https://kosis.kr/openapi/Param/statisticsParameterData.do",
  );
  const params = {
    method: "getList",
    orgId: ORG_ID,
    tblId: TABLE_ID,
    objL1,
    itmId: itemId,
    prdSe: "Y",
    startPrdDe: START_PERIOD,
    endPrdDe: END_PERIOD,
    apiKey,
    format: "json",
    jsonVD: "Y",
  };
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok)
      throw new Error(`official source HTTP ${response.status}`);
    const text = await readBoundedText(response);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("official source returned invalid JSON");
    }
    expect(Array.isArray(parsed), "official source JSON array").toBe(true);
    return (parsed as unknown[]).map((row, index) =>
      asRecord(row, `official source row ${index + 1}`),
    );
  } finally {
    clearTimeout(timeout);
  }
}

function sourceObservationKey(
  itemId: string,
  code: string,
  period: string,
): string {
  return `${itemId}\u001f${code}\u001f${period}`;
}

function sourceRowObservation(
  row: JsonRecord,
  regionByCode: ReadonlyMap<string, MetadataRegion>,
  axisName: string,
  itemId: string,
  label: string,
): SourceObservation {
  const code = requiredString(row.C1, `${label} C1`);
  const region = regionByCode.get(code);
  expect(region, `${label} known official C1 code`).toBeDefined();
  const period = requiredString(row.PRD_DE, `${label} PRD_DE`);
  expect(YEARS, `${label} requested period`).toContain(period);
  expect(requiredString(row.ORG_ID, `${label} ORG_ID`)).toBe(ORG_ID);
  expect(requiredString(row.TBL_ID, `${label} TBL_ID`)).toBe(TABLE_ID);
  expect(requiredString(row.ITM_ID, `${label} ITM_ID`)).toBe(itemId);
  expect(requiredString(row.C1_NM, `${label} C1_NM`)).toBe(region!.name);
  expect(requiredString(row.C1_OBJ_NM, `${label} C1_OBJ_NM`)).toBe(axisName);
  expect(requiredString(row.PRD_SE, `${label} PRD_SE`)).toBe("A");
  const unit = requiredString(row.UNIT_NM, `${label} UNIT_NM`);
  expect(unit, `${label} known unit`).not.toMatch(
    /^(?:unknown|n\/?a|null|미상|단위\s*미상|-|…|\.\.\.)$/iu,
  );
  const value = requiredString(row.DT, `${label} DT`);
  expect(
    Number.isFinite(Number(value.replaceAll(",", ""))),
    `${label} numeric DT`,
  ).toBe(true);
  return { itemId, code, name: region!.name, period, value, unit };
}

async function buildSourceFixture(
  metadata: MetadataWitness,
): Promise<SourceFixture> {
  const regionByCode = new Map(
    metadata.regions.map((region) => [region.code, region] as const),
  );
  const observations = new Map<string, SourceObservation>();

  for (const region of metadata.regions) {
    const rows = await officialSourceGet(region.code, metadata.itemId);
    expect(rows, `official source ${region.name} exact 11 rows`).toHaveLength(
      YEARS.length,
    );
    const periods = new Set<string>();
    for (const [index, row] of rows.entries()) {
      const observation = sourceRowObservation(
        row,
        regionByCode,
        metadata.axisName,
        metadata.itemId,
        `official source ${region.name} row ${index + 1}`,
      );
      expect(
        periods.has(observation.period),
        `duplicate source period ${observation.period}`,
      ).toBe(false);
      periods.add(observation.period);
      const key = sourceObservationKey(
        observation.itemId,
        observation.code,
        observation.period,
      );
      expect(observations.has(key), `duplicate source identity ${key}`).toBe(
        false,
      );
      observations.set(key, observation);
    }
    expect(
      [...periods].sort(),
      `official source ${region.name} exact years`,
    ).toEqual(YEARS);
  }
  expect(observations.size, "independent official source observations").toBe(
    EXPECTED_OBSERVATIONS,
  );

  const compoundSelector = metadata.regions
    .map((region) => region.code)
    .join("+");
  const compoundRows = await officialSourceGet(
    compoundSelector,
    metadata.itemId,
  );
  expect(
    compoundRows,
    "official plus selector list response size",
  ).toHaveLength(EXPECTED_OBSERVATIONS);
  const compoundIdentities = new Set<string>();
  for (const [index, row] of compoundRows.entries()) {
    const observation = sourceRowObservation(
      row,
      regionByCode,
      metadata.axisName,
      metadata.itemId,
      `official plus selector row ${index + 1}`,
    );
    const key = sourceObservationKey(
      observation.itemId,
      observation.code,
      observation.period,
    );
    expect(
      compoundIdentities.has(key),
      `duplicate plus-selector identity ${key}`,
    ).toBe(false);
    compoundIdentities.add(key);
    const independent = observations.get(key);
    expect(independent, `plus-selector expected identity ${key}`).toBeDefined();
    expect(observation.value, `plus-selector raw value ${key}`).toBe(
      independent!.value,
    );
    expect(observation.unit, `plus-selector raw unit ${key}`).toBe(
      independent!.unit,
    );
  }
  expect(
    compoundIdentities.size,
    "official plus selector exact identity set",
  ).toBe(EXPECTED_OBSERVATIONS);

  return {
    metadata,
    observations,
    selectors: metadata.regions,
    compoundSelector,
  };
}

function assertMetadataStable(metadata: MetadataWitness): void {
  const identity = metadataIdentity(metadata);
  if (metadataBaseline === undefined) {
    metadataBaseline = metadata;
    return;
  }
  expect(identity, "normalized metadata stable across transports").toBe(
    metadataIdentity(metadataBaseline),
  );
}

async function assertAggregate(kind: LiveTransportKind): Promise<void> {
  await withReleaseClient(kind, async ({ client }) => {
    const metadata = deriveMetadata(await readAllMetadata(client));
    assertMetadataStable(metadata);
    if (sourceFixture === undefined) {
      sourceFixture = await buildSourceFixture(metadata);
    } else {
      expect(
        metadataIdentity(metadata),
        "source metadata identity stable",
      ).toBe(metadataIdentity(sourceFixture.metadata));
    }
    const fixture = sourceFixture;
    expect(fixture, "official source fixture initialized").toBeDefined();

    const query: JsonRecord = {
      orgId: ORG_ID,
      tableId: TABLE_ID,
      objL1: fixture!.compoundSelector,
      itemId: fixture!.metadata.itemId,
      periodType: "Y",
      startPeriod: START_PERIOD,
      endPeriod: END_PERIOD,
      pageSize: DATA_PAGE_SIZE,
    };
    const rows = new Map<string, JsonRecord>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let nonEmptyPages = 0;
    let emittedBefore = 0;
    let finalPage: JsonRecord | undefined;

    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      const args: JsonRecord = { ...query, ...(cursor ? { cursor } : {}) };
      for (const field of [
        "orgId",
        "tableId",
        "objL1",
        "itemId",
        "periodType",
        "startPeriod",
        "endPeriod",
        "pageSize",
      ]) {
        expect(
          args[field],
          `${kind} aggregate page ${pageNumber} cursor-bound ${field}`,
        ).toBe(query[field]);
      }
      const page = await callToolJson(client, "get_statistics_data", args);
      expect(
        page.providerTotalCount,
        `${kind} aggregate page ${pageNumber} provider total honesty`,
      ).toBeNull();
      expect(
        page.providerSnapshot,
        `${kind} aggregate page ${pageNumber} provider snapshot honesty`,
      ).toBe("unproven");
      expect(
        page.completionScope,
        `${kind} aggregate page ${pageNumber} completion scope`,
      ).toBe("requested_period_traversal");
      expect(
        mcpWireBytes(page),
        `${kind} aggregate page ${pageNumber} MCP bytes`,
      ).toBeLessThanOrEqual(MCP_MAX_BYTES);
      expect(page.success, `${kind} aggregate page ${pageNumber} success`).toBe(
        true,
      );
      expect(
        Array.isArray(page.data),
        `${kind} aggregate page ${pageNumber} data`,
      ).toBe(true);
      const pageRows = (page.data as unknown[]).map((row, index) =>
        asRecord(row, `${kind} aggregate page ${pageNumber} row ${index + 1}`),
      );
      expect(
        page.returnedCount,
        `${kind} aggregate page ${pageNumber} returnedCount`,
      ).toBe(pageRows.length);
      expect(
        pageRows.length,
        `${kind} aggregate page ${pageNumber} page-size bound`,
      ).toBeLessThanOrEqual(DATA_PAGE_SIZE);
      expect(
        Number.isInteger(page.emittedCount),
        `${kind} emittedCount integer`,
      ).toBe(true);
      expect(Number(page.emittedCount), `${kind} emittedCount monotonic`).toBe(
        emittedBefore + pageRows.length,
      );
      emittedBefore = Number(page.emittedCount);
      if (pageRows.length > 0) nonEmptyPages += 1;

      for (const [index, item] of pageRows.entries()) {
        const raw = asRecord(
          item.raw,
          `${kind} aggregate raw row ${index + 1}`,
        );
        const code = requiredString(raw.C1, `${kind} aggregate raw C1`);
        const period = requiredString(
          raw.PRD_DE,
          `${kind} aggregate raw PRD_DE`,
        );
        const itemId = requiredString(
          raw.ITM_ID,
          `${kind} aggregate raw ITM_ID`,
        );
        const key = sourceObservationKey(itemId, code, period);
        const expected = fixture!.observations.get(key);
        expect(
          expected,
          `${kind} aggregate expected identity ${key}`,
        ).toBeDefined();
        expect(requiredString(raw.C1_NM, `${kind} aggregate raw C1_NM`)).toBe(
          expected!.name,
        );
        expect(
          requiredString(raw.C1_OBJ_NM, `${kind} aggregate raw C1_OBJ_NM`),
        ).toBe(fixture!.metadata.axisName);
        expect(itemId, `${kind} aggregate raw ITM_ID`).toBe(
          fixture!.metadata.itemId,
        );
        expect(requiredString(raw.PRD_SE, `${kind} aggregate raw PRD_SE`)).toBe(
          "A",
        );
        expect(
          requiredString(raw.UNIT_NM, `${kind} aggregate raw UNIT_NM`),
        ).toBe(expected!.unit);
        expect(requiredString(raw.DT, `${kind} aggregate raw DT`)).toBe(
          expected!.value,
        );
        expect(item.periodType, `${kind} aggregate normalized periodType`).toBe(
          "Y",
        );
        expect(
          requiredString(item.rawPeriod, `${kind} aggregate rawPeriod`),
        ).toBe(period);
        expect(
          requiredString(item.rawValue, `${kind} aggregate rawValue`),
        ).toBe(expected!.value);
        expect(requiredString(item.unit, `${kind} aggregate unit`)).toBe(
          expected!.unit,
        );
        expect(
          rows.has(key),
          `${kind} duplicate aggregate identity ${key}`,
        ).toBe(false);
        rows.set(key, raw);
      }

      if (page.hasMore === true) {
        const nextCursor = requiredString(
          page.nextCursor,
          `${kind} aggregate page ${pageNumber} nextCursor`,
        );
        expect(
          cursors.has(nextCursor),
          `${kind} repeated aggregate cursor`,
        ).toBe(false);
        cursors.add(nextCursor);
        if (pageRows.length === 0) {
          expect(
            page.continuationReason,
            `${kind} zero-row continuation reason`,
          ).toBe("partition_split");
        }
        cursor = nextCursor;
        continue;
      }
      expect(page.hasMore, `${kind} aggregate final hasMore`).toBe(false);
      expect(page.nextCursor, `${kind} aggregate final cursor`).toBeNull();
      finalPage = page;
      break;
    }

    expect(finalPage, `${kind} aggregate traversal finished`).toBeDefined();
    expect(
      nonEmptyPages,
      `${kind} aggregate at least two non-empty pages`,
    ).toBeGreaterThanOrEqual(2);
    expect(rows.size, `${kind} aggregate exact observation count`).toBe(
      EXPECTED_OBSERVATIONS,
    );
    expect(finalPage!.completion, `${kind} aggregate completion`).toBe(
      "complete",
    );
    expect(
      finalPage!.traversalComplete,
      `${kind} aggregate traversalComplete`,
    ).toBe(true);
    expect(
      finalPage!.completionScope,
      `${kind} aggregate completion scope`,
    ).toBe("requested_period_traversal");
    expect(finalPage!.aggregateRowCount, `${kind} aggregate row count`).toBe(
      EXPECTED_OBSERVATIONS,
    );
    expect(
      finalPage!.providerTotalCount,
      `${kind} provider total honesty`,
    ).toBeNull();
    expect(
      finalPage!.providerSnapshot,
      `${kind} provider snapshot honesty`,
    ).toBe("unproven");
    expect(
      ["verified", "partition_local"],
      `${kind} aggregate period completeness marker`,
    ).toContain(finalPage!.periodCompleteness);
    expect(
      [...rows.keys()].sort(),
      `${kind} aggregate exact source identity set`,
    ).toEqual([...fixture!.observations.keys()].sort());
  });
}

if (registerR3Cases) {
  test(
    "REQ-D02.stdio finite compound aggregate over official 19-region cohort @live @stdio @transport @AC7 @AC8",
    {
      tag: ["@REQ-D02.stdio", "@live", "@stdio", "@transport", "@AC7", "@AC8"],
    },
    async () =>
      runSanitizedLiveCase("REQ-D02.stdio", () => assertAggregate("stdio")),
  );

  test(
    "REQ-D02.http finite compound aggregate over official 19-region cohort @live @http @transport @AC7 @AC8",
    {
      tag: ["@REQ-D02.http", "@live", "@http", "@transport", "@AC7", "@AC8"],
    },
    async () =>
      runSanitizedLiveCase("REQ-D02.http", () => assertAggregate("http")),
  );
}
