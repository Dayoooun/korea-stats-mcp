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
const METADATA_PAGE_SIZE = 32;
const DATA_PAGE_SIZE = 2;
const MAX_PAGES = 100;

// Release-live tests own the transport timeout; no release phase gate skips these
// registrations. The live harness reports unavailable credentials separately.
test.setTimeout(180_000);

type JsonObject = Record<string, unknown>;

type MetadataPage = JsonObject & {
  rawData: JsonObject[];
  totalCount: number;
  returnedCount: number;
  hasMore: boolean;
  nextCursor: string | null;
};

function asRecord(value: unknown, label: string): JsonObject {
  expect(value, `${label} must be an object`).not.toBeNull();
  expect(typeof value, `${label} must be an object`).toBe("object");
  expect(Array.isArray(value), `${label} must not be an array`).toBe(false);
  return value as JsonObject;
}

function requiredString(value: unknown, label: string): string {
  expect(typeof value, `${label} must be a string`).toBe("string");
  const text = String(value).trim();
  expect(text.length, `${label} must be non-empty`).toBeGreaterThan(0);
  return text;
}

function metadataPage(result: JsonObject, label: string): MetadataPage {
  expect(result.success, `${label} success`).toBe(true);
  expect(result.orgId, `${label} orgId`).toBe(ORG_ID);
  expect(result.tableId, `${label} tableId`).toBe(TABLE_ID);
  expect(result.infoType, `${label} infoType`).toBe("ITM");
  expect(Array.isArray(result.rawData), `${label} rawData`).toBe(true);
  expect(typeof result.totalCount, `${label} totalCount`).toBe("number");
  expect(typeof result.returnedCount, `${label} returnedCount`).toBe("number");
  expect(typeof result.hasMore, `${label} hasMore`).toBe("boolean");
  expect(
    result.nextCursor === null || typeof result.nextCursor === "string",
    `${label} nextCursor shape`,
  ).toBe(true);
  expect(
    mcpWrapperBytes(result),
    `${label} actual MCP wrapper bytes`,
  ).toBeLessThanOrEqual(32_768);
  return result as unknown as MetadataPage;
}

function mcpWrapperBytes(result: JsonObject): number {
  const text = JSON.stringify(result, null, 2) ?? "";
  const wrapper = {
    content: [{ type: "text", text }],
  };
  return new TextEncoder().encode(JSON.stringify(wrapper)).byteLength;
}
function assertMetadataRowShape(row: JsonObject, label: string): void {
  for (const field of ["OBJ_ID", "OBJ_NM", "ITM_ID", "ITM_NM"]) {
    requiredString(row[field], `${label} ${field}`);
  }
  expect(
    row.UP_ITM_ID === undefined ||
      row.UP_ITM_ID === null ||
      typeof row.UP_ITM_ID === "string",
    `${label} optional parent type`,
  ).toBe(true);
}

function rawMetadataRows(page: MetadataPage, label: string): JsonObject[] {
  return page.rawData.map((row, index) => {
    const record = asRecord(row, `${label} rawData[${index}]`);
    assertMetadataRowShape(record, `${label} rawData[${index}]`);
    return record;
  });
}

async function readAllItmMetadata(
  client: Parameters<typeof callToolJson>[0],
): Promise<{
  rows: JsonObject[];
  pages: MetadataPage[];
}> {
  const rows: JsonObject[] = [];
  const pages: MetadataPage[] = [];
  let cursor: string | undefined;

  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const args: JsonObject = {
      orgId: ORG_ID,
      tableId: TABLE_ID,
      infoType: "ITM",
      pageSize: METADATA_PAGE_SIZE,
    };
    if (cursor !== undefined) args.cursor = cursor;
    const page = metadataPage(
      await callToolJson(client, "get_table_info", args),
      `ITM metadata page ${pageNumber}`,
    );
    expect(page.returnedCount, `ITM page ${pageNumber} row count`).toBe(
      page.rawData.length,
    );
    expect(
      page.returnedCount,
      `ITM page ${pageNumber} page-size bound`,
    ).toBeLessThanOrEqual(METADATA_PAGE_SIZE);
    const pageRows = rawMetadataRows(page, `ITM metadata page ${pageNumber}`);
    rows.push(...pageRows);
    pages.push(page);

    if (!page.hasMore) {
      expect(page.nextCursor, `ITM final page ${pageNumber} cursor`).toBeNull();
      return { rows, pages };
    }
    expect(
      typeof page.nextCursor === "string" && page.nextCursor.length > 0,
      `ITM page ${pageNumber} continuation cursor`,
    ).toBe(true);
    cursor = page.nextCursor as string;
  }

  throw new Error(`ITM metadata pagination exceeded ${MAX_PAGES} pages`);
}

async function assertFirstFilteredMetadataPage(
  kind: LiveTransportKind,
): Promise<void> {
  await withReleaseClient(kind, async ({ client }) => {
    const seed = metadataPage(
      await callToolJson(client, "get_table_info", {
        orgId: ORG_ID,
        tableId: TABLE_ID,
        infoType: "ITM",
        pageSize: DATA_PAGE_SIZE,
      }),
      `${kind} metadata seed`,
    );
    const seedRows = rawMetadataRows(seed, `${kind} metadata seed`);
    expect(
      seedRows.length,
      `${kind} metadata seed is non-empty`,
    ).toBeGreaterThan(0);
    const observedObjId = requiredString(
      seedRows[0].OBJ_ID,
      `${kind} observed OBJ_ID`,
    );
    expect(
      seedRows.some((row) => String(row.OBJ_ID ?? "") === observedObjId),
      `${kind} filter came from an observed metadata OBJ_ID`,
    ).toBe(true);

    const filtered = metadataPage(
      await callToolJson(client, "get_table_info", {
        orgId: ORG_ID,
        tableId: TABLE_ID,
        infoType: "ITM",
        objId: observedObjId,
        pageSize: DATA_PAGE_SIZE,
      }),
      `${kind} filtered metadata`,
    );
    const rows = rawMetadataRows(filtered, `${kind} filtered metadata`);
    expect(rows.length, `${kind} filtered small page`).toBeLessThanOrEqual(2);
    expect(filtered.returnedCount, `${kind} filtered returnedCount`).toBe(
      rows.length,
    );
    expect(
      rows.every((row) => String(row.OBJ_ID ?? "") === observedObjId),
      `${kind} filtered OBJ_ID identity`,
    ).toBe(true);
    expect(
      mcpWrapperBytes(filtered),
      `${kind} actual MCP wrapper bytes`,
    ).toBeLessThanOrEqual(32_768);
  });
}

async function assertCompleteMetadataPagination(
  kind: LiveTransportKind,
): Promise<void> {
  await withReleaseClient(kind, async ({ client }) => {
    const first = metadataPage(
      await callToolJson(client, "get_table_info", {
        orgId: ORG_ID,
        tableId: TABLE_ID,
        infoType: "ITM",
        pageSize: METADATA_PAGE_SIZE,
      }),
      `${kind} ITM first page`,
    );
    const firstRows = rawMetadataRows(first, `${kind} ITM first page`);
    expect(
      firstRows.length,
      `${kind} ITM first page non-empty`,
    ).toBeGreaterThan(0);
    expect(first.returnedCount, `${kind} ITM first returnedCount`).toBe(
      firstRows.length,
    );
    const expectedTotal = first.totalCount;
    expect(Number.isInteger(expectedTotal), `${kind} ITM total integer`).toBe(
      true,
    );
    expect(expectedTotal, `${kind} ITM total positive`).toBeGreaterThan(0);

    const firstCursor = first.nextCursor;
    expect(
      typeof firstCursor === "string" && firstCursor.length > 0,
      `${kind} ITM first continuation cursor`,
    ).toBe(true);
    const alteredQuery = await callToolJson(client, "get_table_info", {
      orgId: ORG_ID,
      tableId: TABLE_ID,
      infoType: "ITM",
      query: "부산",
      pageSize: METADATA_PAGE_SIZE,
      cursor: firstCursor as string,
    });
    // A cursor is bound to its original query; query tampering must fail closed,
    // not silently return a page from a different metadata selection.
    expect(alteredQuery.success, `${kind} altered-query cursor rejection`).toBe(
      false,
    );
    expect(alteredQuery.errorCode, `${kind} altered-query error`).toBe(
      "INVALID_CURSOR",
    );

    const cursorText = firstCursor as string;
    const tamperedCursor = `${cursorText.slice(0, -1)}${
      cursorText.endsWith("a") ? "b" : "a"
    }`;
    const tampered = await callToolJson(client, "get_table_info", {
      orgId: ORG_ID,
      tableId: TABLE_ID,
      infoType: "ITM",
      pageSize: METADATA_PAGE_SIZE,
      cursor: tamperedCursor,
    });
    expect(tampered.success, `${kind} tampered cursor rejection`).toBe(false);
    expect(tampered.errorCode, `${kind} tampered cursor error`).toBe(
      "INVALID_CURSOR",
    );

    const seen = new Set<string>();
    const pages: MetadataPage[] = [first];
    for (const row of firstRows) seen.add(canonicalJson(row));
    let cursor: string | undefined = firstCursor as string;
    while (cursor !== undefined) {
      expect(pages.length, `${kind} ITM page bound`).toBeLessThan(MAX_PAGES);
      const page = metadataPage(
        await callToolJson(client, "get_table_info", {
          orgId: ORG_ID,
          tableId: TABLE_ID,
          infoType: "ITM",
          pageSize: METADATA_PAGE_SIZE,
          cursor,
        }),
        `${kind} ITM page ${pages.length + 1}`,
      );
      const rows = rawMetadataRows(
        page,
        `${kind} ITM page ${pages.length + 1}`,
      );
      expect(page.totalCount, `${kind} ITM page total`).toBe(expectedTotal);
      expect(page.returnedCount, `${kind} ITM page returnedCount`).toBe(
        rows.length,
      );
      for (const row of rows) {
        const identity = canonicalJson(row);
        expect(seen.has(identity), `${kind} duplicate metadata row`).toBe(
          false,
        );
        seen.add(identity);
      }
      pages.push(page);
      if (page.hasMore) {
        expect(
          typeof page.nextCursor === "string" && page.nextCursor.length > 0,
          `${kind} ITM continuation cursor`,
        ).toBe(true);
        cursor = page.nextCursor as string;
      } else {
        expect(page.nextCursor, `${kind} ITM final nextCursor`).toBeNull();
        cursor = undefined;
      }
    }

    expect(pages.length, `${kind} ITM at least two pages`).toBeGreaterThan(1);
    expect(seen.size, `${kind} complete metadata row set`).toBe(expectedTotal);
    expect(pages.at(-1)?.hasMore, `${kind} complete metadata hasMore`).toBe(
      false,
    );
    expect(pages.at(-1)?.nextCursor, `${kind} complete metadata cursor`).toBe(
      null,
    );
  });
}

async function assertMetadataSelectedPopulationSeries(
  kind: LiveTransportKind,
): Promise<void> {
  await withReleaseClient(kind, async ({ client }) => {
    const tablePage = await callToolJson(client, "get_table_info", {
      orgId: ORG_ID,
      tableId: TABLE_ID,
      infoType: "TBL",
      pageSize: 2,
    });
    expect(tablePage.success, `${kind} TBL metadata success`).toBe(true);
    expect(tablePage.orgId, `${kind} TBL metadata orgId`).toBe(ORG_ID);
    expect(tablePage.tableId, `${kind} TBL metadata tableId`).toBe(TABLE_ID);
    expect(tablePage.infoType, `${kind} TBL metadata infoType`).toBe("TBL");
    requiredString(tablePage.tableName, `${kind} official metadata table name`);

    const metadata = await readAllItmMetadata(client);
    expect(
      metadata.pages.length,
      `${kind} M04 metadata pagination`,
    ).toBeGreaterThan(1);
    const rows = metadata.rows;

    const busanCandidates = rows.filter(
      (row) => String(row.ITM_NM ?? "").trim() === "부산광역시",
    );
    expect(busanCandidates.length, `${kind} exact 부산 metadata match`).toBe(1);
    const busan = busanCandidates[0];
    const regionObjId = requiredString(busan.OBJ_ID, `${kind} 부산 OBJ_ID`);
    const axisName = requiredString(busan.OBJ_NM, `${kind} metadata OBJ_NM`);
    const busanId = requiredString(busan.ITM_ID, `${kind} 부산 ITM_ID`);

    const nationalCandidates = rows.filter(
      (row) =>
        String(row.OBJ_ID ?? "") === regionObjId &&
        String(row.ITM_NM ?? "").trim() === "전국",
    );
    expect(
      nationalCandidates.length,
      `${kind} exact national metadata match`,
    ).toBe(1);
    const national = nationalCandidates[0];
    const nationalId = requiredString(
      national.ITM_ID,
      `${kind} national ITM_ID`,
    );
    const nationalName = requiredString(
      national.ITM_NM,
      `${kind} national ITM_NM`,
    );
    expect(busanId, `${kind} 부산 differs from national`).not.toBe(nationalId);

    const districtCandidates = rows.filter(
      (row) =>
        String(row.OBJ_ID ?? "") === regionObjId &&
        String(row.ITM_NM ?? "").trim() === "동래구" &&
        String(row.UP_ITM_ID ?? "") === busanId,
    );
    expect(
      districtCandidates.length,
      `${kind} 동래구 부산 parent-path match`,
    ).toBe(1);
    const district = districtCandidates[0];
    const districtId = requiredString(district.ITM_ID, `${kind} 동래구 ITM_ID`);
    const districtName = requiredString(
      district.ITM_NM,
      `${kind} 동래구 ITM_NM`,
    );
    expect(requiredString(district.UP_ITM_ID, `${kind} 동래구 UP_ITM_ID`)).toBe(
      busanId,
    );
    expect(requiredString(district.OBJ_ID, `${kind} 동래구 OBJ_ID`)).toBe(
      regionObjId,
    );
    expect(requiredString(district.OBJ_NM, `${kind} 동래구 OBJ_NM`)).toBe(
      axisName,
    );

    const populationCandidates = rows.filter(
      (row) =>
        String(row.ITM_ID ?? "") === "T20" &&
        String(row.ITM_NM ?? "").includes("총인구"),
    );
    expect(
      populationCandidates.length,
      `${kind} T20 official ITM metadata evidence`,
    ).toBe(1);
    const populationItem = populationCandidates[0];
    requiredString(populationItem.OBJ_ID, `${kind} population OBJ_ID`);
    requiredString(populationItem.OBJ_NM, `${kind} population OBJ_NM`);
    const metadataUnit = requiredString(
      populationItem.UNIT || populationItem.UNIT_NM,
      `${kind} population metadata unit`,
    );
    expect(metadataUnit).not.toMatch(
      /^(?:unknown|n\/?a|null|미상|단위\s*미상|-|…|\.\.\.)$/iu,
    );
    const itemId = requiredString(
      populationItem.ITM_ID,
      `${kind} population ITM_ID`,
    );
    const itemName = requiredString(
      populationItem.ITM_NM,
      `${kind} population ITM_NM`,
    );
    expect(itemId, `${kind} population item selector`).toBe("T20");

    const dataQuery: JsonObject = {
      orgId: ORG_ID,
      tableId: TABLE_ID,
      objL1: districtId,
      itemId,
      periodType: "Y",
      startPeriod: "2015",
      endPeriod: "2025",
      pageSize: DATA_PAGE_SIZE,
    };
    const rawRows: JsonObject[] = [];
    const periods = new Set<string>();
    let cursor: string | undefined;
    let finalPage: JsonObject | undefined;
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      const args = { ...dataQuery };
      if (cursor !== undefined) args.cursor = cursor;
      const result = await callToolJson(client, "get_statistics_data", args);
      expect(result.success, `${kind} data page ${pageNumber} success`).toBe(
        true,
      );
      expect(
        mcpWrapperBytes(result),
        `${kind} data page ${pageNumber} actual MCP wrapper bytes`,
      ).toBeLessThanOrEqual(32_768);
      expect(
        asRecord(result.metadata, `${kind} data page ${pageNumber} metadata`)
          .orgId,
        `${kind} data metadata orgId`,
      ).toBe(ORG_ID);
      const metadataRecord = asRecord(
        result.metadata,
        `${kind} data page ${pageNumber} metadata`,
      );
      expect(metadataRecord.tableId, `${kind} data metadata tableId`).toBe(
        TABLE_ID,
      );
      expect(
        metadataRecord.periodType,
        `${kind} data metadata periodType`,
      ).toBe("Y");
      expect(Array.isArray(result.data), `${kind} data page array`).toBe(true);
      const data = (result.data as unknown[]).map((row, index) =>
        asRecord(row, `${kind} data page ${pageNumber}[${index}]`),
      );
      expect(result.returnedCount, `${kind} data returnedCount`).toBe(
        data.length,
      );
      expect(data.length, `${kind} data page-size bound`).toBeLessThanOrEqual(
        DATA_PAGE_SIZE,
      );

      for (const item of data) {
        const raw = asRecord(item.raw, `${kind} raw observation`);
        rawRows.push(raw);
        expect(requiredString(raw.ORG_ID, `${kind} raw ORG_ID`)).toBe(ORG_ID);
        expect(requiredString(raw.TBL_ID, `${kind} raw TBL_ID`)).toBe(TABLE_ID);
        expect(requiredString(raw.PRD_SE, `${kind} raw PRD_SE`)).toBe("A");
        const period = requiredString(raw.PRD_DE, `${kind} raw period`);
        expect(/^\d{4}$/u.test(period), `${kind} annual period`).toBe(true);
        periods.add(period);
        expect(requiredString(raw.C1, `${kind} raw C1`)).toBe(districtId);
        expect(requiredString(raw.C1_NM, `${kind} raw C1_NM`)).toBe(
          districtName,
        );
        expect(requiredString(raw.C1_OBJ_NM, `${kind} raw C1_OBJ_NM`)).toBe(
          axisName,
        );
        expect(requiredString(raw.ITM_ID, `${kind} raw ITM_ID`)).toBe(itemId);
        expect(requiredString(raw.ITM_NM, `${kind} raw ITM_NM`)).toBe(itemName);
        const unit = requiredString(raw.UNIT_NM, `${kind} raw UNIT_NM`);
        expect(unit).not.toMatch(
          /^(?:unknown|n\/?a|null|미상|단위\s*미상|-|…|\.\.\.)$/iu,
        );
        const numericValue = Number(String(raw.DT ?? "").replaceAll(",", ""));
        expect(Number.isFinite(numericValue), `${kind} raw DT numeric`).toBe(
          true,
        );
        expect(requiredString(raw.C1_NM, `${kind} raw district name`)).not.toBe(
          nationalName,
        );
        expect(requiredString(raw.C1, `${kind} raw district code`)).not.toBe(
          nationalId,
        );
      }

      const hasMore = result.hasMore;
      expect(typeof hasMore, `${kind} data hasMore shape`).toBe("boolean");
      if (hasMore === true) {
        expect(
          typeof result.nextCursor === "string" && result.nextCursor.length > 0,
          `${kind} data continuation cursor`,
        ).toBe(true);
        cursor = result.nextCursor as string;
      } else {
        expect(result.nextCursor, `${kind} data final cursor`).toBeNull();
        finalPage = result;
        cursor = undefined;
        break;
      }
    }

    expect(finalPage, `${kind} data traversal finished`).toBeDefined();
    expect(finalPage?.completion, `${kind} data completion`).toBe("complete");
    expect(finalPage?.traversalComplete, `${kind} data traversalComplete`).toBe(
      true,
    );
    expect(finalPage?.hasMore, `${kind} data final hasMore`).toBe(false);
    expect(finalPage?.nextCursor, `${kind} data final nextCursor`).toBeNull();
    expect(finalPage?.aggregateRowCount, `${kind} aggregate row count`).toBe(
      11,
    );
    expect(finalPage?.completionScope, `${kind} completion scope`).toBe(
      "requested_period_traversal",
    );
    expect(rawRows.length, `${kind} raw row count`).toBe(11);
    expect(periods.size, `${kind} unique annual periods`).toBe(11);
    expect([...periods].sort(), `${kind} requested annual periods`).toEqual(
      Array.from({ length: 11 }, (_, index) => String(2015 + index)),
    );
    expect(
      new Set(
        rawRows.map((row) => requiredString(row.C1_OBJ_NM, `${kind} axis`)),
      ).size,
      `${kind} one observed C1 axis`,
    ).toBe(1);

    const trend = await callToolJson(client, "quick_trend", {
      keyword: "인구",
      region: districtName,
      yearCount: 11,
    });
    expect(trend.success, `${kind} quick_trend success`).toBe(true);
    expect(
      Array.isArray(trend.dataPoints),
      `${kind} quick_trend dataPoints`,
    ).toBe(true);
    const dataPoints = (trend.dataPoints as unknown[]).map((point, index) =>
      asRecord(point, `${kind} quick_trend dataPoints[${index}]`),
    );
    expect(dataPoints.length, `${kind} quick_trend year count`).toBe(11);
    const source = asRecord(trend.source, `${kind} quick_trend source`);
    expect(requiredString(source.orgId, `${kind} trend source orgId`)).toBe(
      ORG_ID,
    );
    expect(requiredString(source.tableId, `${kind} trend source tableId`)).toBe(
      TABLE_ID,
    );
    // Metadata and data endpoints use different punctuation in this table's name.
    // Identity is established by the exact organization/table IDs above.
    requiredString(source.tableName, `${kind} trend source table name`);
    expect(
      requiredString(source.periodType, `${kind} trend source periodType`),
    ).toBe("Y");
    expect(
      requiredString(source.regionCode, `${kind} trend source regionCode`),
    ).toBe(districtId);
    const directUnit = requiredString(
      rawRows[0].UNIT_NM,
      `${kind} direct unit`,
    );
    expect(requiredString(source.unit, `${kind} trend source unit`)).toBe(
      directUnit,
    );
    const directByYear = new Map(
      rawRows.map((row) => [
        requiredString(row.PRD_DE, `${kind} direct period`),
        Number(String(row.DT ?? "").replaceAll(",", "")),
      ]),
    );
    for (const point of dataPoints) {
      const year = requiredString(point.year, `${kind} trend year`);
      const value = point.value;
      expect(typeof value, `${kind} trend value type`).toBe("number");
      expect(
        Number.isFinite(value as number),
        `${kind} trend value finite`,
      ).toBe(true);
      expect(directByYear.has(year), `${kind} trend year direct match`).toBe(
        true,
      );
      expect(value, `${kind} trend value ${year}`).toBe(directByYear.get(year));
    }
  });
}

if (process.env.KOREA_STATS_RELEASE_PHASE?.trim() !== "R1") {
  test(
    "REQ-M02.stdio first filtered ITM page stays identity- and byte-safe @live @stdio @AC11",
    { tag: ["@REQ-M02.stdio", "@AC11", "@live", "@stdio"] },
    async () =>
      runSanitizedLiveCase("REQ-M02.stdio", () =>
        assertFirstFilteredMetadataPage("stdio"),
      ),
  );

  test(
    "REQ-M02.http first filtered ITM page stays identity- and byte-safe @live @http @AC11",
    { tag: ["@REQ-M02.http", "@AC11", "@live", "@http"] },
    async () =>
      runSanitizedLiveCase("REQ-M02.http", () =>
        assertFirstFilteredMetadataPage("http"),
      ),
  );

  test(
    "REQ-M03.stdio paginates every official ITM row with bound cursors @live @stdio @AC11",
    { tag: ["@REQ-M03.stdio", "@AC11", "@live", "@stdio"] },
    async () =>
      runSanitizedLiveCase("REQ-M03.stdio", () =>
        assertCompleteMetadataPagination("stdio"),
      ),
  );

  test(
    "REQ-M03.http paginates every official ITM row with bound cursors @live @http @AC11",
    { tag: ["@REQ-M03.http", "@AC11", "@live", "@http"] },
    async () =>
      runSanitizedLiveCase("REQ-M03.http", () =>
        assertCompleteMetadataPagination("http"),
      ),
  );

  test(
    "REQ-M04.stdio derives 부산-동래구 selectors and reconciles annual population @live @stdio @AC1 @AC2 @AC8 @AC11",
    {
      tag: [
        "@REQ-M04.stdio",
        "@AC1",
        "@AC2",
        "@AC8",
        "@AC11",
        "@live",
        "@stdio",
      ],
    },
    async () =>
      runSanitizedLiveCase("REQ-M04.stdio", () =>
        assertMetadataSelectedPopulationSeries("stdio"),
      ),
  );

  test(
    "REQ-M04.http derives 부산-동래구 selectors and reconciles annual population @live @http @AC1 @AC2 @AC8 @AC11",
    {
      tag: ["@REQ-M04.http", "@AC1", "@AC2", "@AC8", "@AC11", "@live", "@http"],
    },
    async () =>
      runSanitizedLiveCase("REQ-M04.http", () =>
        assertMetadataSelectedPopulationSeries("http"),
      ),
  );
}
