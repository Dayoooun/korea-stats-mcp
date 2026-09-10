import { test, expect } from "@playwright/test";
import {
  callToolJson,
  runSanitizedLiveCase,
  withReleaseClient,
  type LiveTransportKind,
} from "./release-live-client";

const releasePhase = process.env.KOREA_STATS_RELEASE_PHASE?.trim();
const includeR2Cases = releasePhase !== "R1";
const YEARS = Array.from({ length: 11 }, (_, index) => String(2015 + index));
const METADATA_PAGE_SIZE = 32;
const DATA_PAGE_SIZE = 2;
const MAX_PAGES = 64;

test.setTimeout(180_000);

type JsonRecord = Record<string, unknown>;
type MetadataRow = JsonRecord;
type SimplifiedDataRow = JsonRecord;

type RegionCase = {
  readonly parent: string;
  readonly locality: string;
  readonly region: string;
};

const POSITIVE_CASES = {
  dongnae: {
    parent: "부산",
    locality: "동래구",
    region: "부산 동래구",
  },
  gijang: {
    parent: "부산",
    locality: "기장군",
    region: "부산 기장군",
  },
  suwon: {
    parent: "경기도",
    locality: "수원시",
    region: "경기도 수원시",
  },
} as const satisfies Record<string, RegionCase>;

const NEGATIVE_REGIONS = [
  "부산 없는군",
  "부산 기장동",
  "중구",
  "강서구",
  "서울부산동래구",
] as const;

function requiredString(value: unknown, label: string): string {
  expect(typeof value, `${label} type`).toBe("string");
  const result = String(value).trim();
  expect(result.length, `${label} nonempty`).toBeGreaterThan(0);
  return result;
}

function optionalString(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function metadataIdentity(row: MetadataRow): string {
  return ["OBJ_ID", "ITM_ID", "UP_ITM_ID", "OBJ_ID_SN", "ITM_NM"]
    .map((field) => optionalString(row[field]))
    .join("\u001f");
}

function canonicalName(value: string): string {
  return value
    .normalize("NFC")
    .replace(/\s+/gu, "")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

function pathFor(
  row: MetadataRow,
  byId: Map<string, MetadataRow>,
): MetadataRow[] {
  const path: MetadataRow[] = [];
  const seen = new Set<string>();
  let current: MetadataRow | undefined = row;
  while (current) {
    const id = requiredString(current.ITM_ID, "metadata ITM_ID");
    if (seen.has(id))
      throw new Error("official metadata parent path contains a cycle");
    seen.add(id);
    path.unshift(current);
    const parentId = optionalString(current.UP_ITM_ID);
    current = parentId ? byId.get(parentId) : undefined;
  }
  return path;
}

function pathHasParent(path: MetadataRow[], parent: string): boolean {
  const expected = canonicalName(parent);
  return path.slice(0, -1).some((item) => {
    const name = canonicalName(
      requiredString(item.ITM_NM, "metadata parent ITM_NM"),
    );
    return name === expected || name.startsWith(expected);
  });
}

function findOfficialRegion(
  rows: readonly MetadataRow[],
  regionCase: RegionCase,
): { code: string; path: string[]; groupId: string; groupName: string } {
  const groupIds = new Set(
    rows.map((row) => requiredString(row.OBJ_ID, "metadata OBJ_ID")),
  );
  const candidates: Array<{
    code: string;
    path: string[];
    groupId: string;
    groupName: string;
  }> = [];
  for (const groupId of groupIds) {
    const groupRows = rows.filter(
      (row) => optionalString(row.OBJ_ID) === groupId,
    );
    const byId = new Map(
      groupRows.map((row) => [
        requiredString(row.ITM_ID, "metadata ITM_ID"),
        row,
      ]),
    );
    const groupName = requiredString(groupRows[0]?.OBJ_NM, "metadata OBJ_NM");
    for (const row of groupRows) {
      const leafName = requiredString(row.ITM_NM, "metadata ITM_NM");
      if (
        leafName !== regionCase.locality ||
        !pathHasParent(pathFor(row, byId), regionCase.parent)
      ) {
        continue;
      }
      const path = pathFor(row, byId);
      candidates.push({
        code: requiredString(row.ITM_ID, "official region ITM_ID"),
        path: path.map((item) =>
          requiredString(item.ITM_NM, "official path ITM_NM"),
        ),
        groupId,
        groupName,
      });
    }
  }
  expect(
    candidates.length,
    `${regionCase.region} exact official parent path`,
  ).toBe(1);
  const selected = candidates[0];
  expect(selected.path.at(-1), `${regionCase.region} official leaf`).toBe(
    regionCase.locality,
  );
  expect(
    selected.path.slice(0, -1).some((name) => {
      const normalized = canonicalName(name);
      const expected = canonicalName(regionCase.parent);
      return normalized === expected || normalized.startsWith(expected);
    }),
    `${regionCase.region} official parent witness`,
  ).toBe(true);
  return selected;
}

function assertMetadataFields(rows: readonly MetadataRow[]): void {
  expect(rows.length, "official ITM metadata rows").toBeGreaterThan(0);
  for (const row of rows) {
    for (const field of ["OBJ_ID", "OBJ_NM", "ITM_ID", "ITM_NM"]) {
      requiredString(row[field], `metadata ${field}`);
    }
    expect(
      row.UP_ITM_ID === undefined ||
        row.UP_ITM_ID === null ||
        typeof row.UP_ITM_ID === "string",
      "optional metadata parent type",
    ).toBe(true);
  }
}

async function readAllOfficialMetadata(
  client: Parameters<typeof callToolJson>[0],
  orgId: string,
  tableId: string,
): Promise<MetadataRow[]> {
  const rows: MetadataRow[] = [];
  const identities = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let totalCount: number | undefined;
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const page = await callToolJson(client, "get_table_info", {
      orgId,
      tableId,
      infoType: "ITM",
      pageSize: METADATA_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    expect(page.success, `get_table_info page ${pageNumber} success`).toBe(
      true,
    );
    expect(page.orgId, `get_table_info page ${pageNumber} orgId`).toBe(orgId);
    expect(page.tableId, `get_table_info page ${pageNumber} tableId`).toBe(
      tableId,
    );
    const pageRows = Array.isArray(page.rawData) ? page.rawData : [];
    expect(
      Array.isArray(page.rawData),
      `get_table_info page ${pageNumber} rawData`,
    ).toBe(true);
    expect(
      Buffer.byteLength(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(page, null, 2) }],
        }),
      ),
      `get_table_info page ${pageNumber} MCP bytes`,
    ).toBeLessThanOrEqual(32_768);
    expect(
      page.returnedCount,
      `get_table_info page ${pageNumber} returnedCount`,
    ).toBe(pageRows.length);
    if (totalCount === undefined) {
      expect(
        Number.isInteger(page.totalCount),
        "get_table_info totalCount",
      ).toBe(true);
      expect(
        Number(page.totalCount),
        "get_table_info totalCount positive",
      ).toBeGreaterThan(0);
      totalCount = Number(page.totalCount);
    } else {
      expect(
        page.totalCount,
        `get_table_info page ${pageNumber} stable totalCount`,
      ).toBe(totalCount);
    }
    for (const row of pageRows as unknown[]) {
      expect(
        row !== null && typeof row === "object" && !Array.isArray(row),
        "metadata row object",
      ).toBe(true);
      const record = row as MetadataRow;
      const identity = metadataIdentity(record);
      expect(identity, "metadata row identity").not.toBe(
        "\u001f\u001f\u001f\u001f",
      );
      expect(
        identities.has(identity),
        `duplicate official metadata identity ${identity}`,
      ).toBe(false);
      identities.add(identity);
      rows.push(record);
    }
    if (page.hasMore === true) {
      const nextCursor = requiredString(
        page.nextCursor,
        `get_table_info page ${pageNumber} nextCursor`,
      );
      expect(
        cursors.has(nextCursor),
        `repeated get_table_info cursor page ${pageNumber}`,
      ).toBe(false);
      cursors.add(nextCursor);
      cursor = nextCursor;
      continue;
    }
    expect(page.hasMore, `get_table_info page ${pageNumber} completion`).toBe(
      false,
    );
    expect(
      page.nextCursor === undefined || page.nextCursor === null,
      "get_table_info terminal cursor",
    ).toBe(true);
    expect(rows.length, "complete official metadata count").toBe(totalCount);
    return rows;
  }
  throw new Error(`get_table_info exceeded ${MAX_PAGES} pages`);
}

function assertT20Metadata(rows: readonly MetadataRow[]): string {
  const items = rows.filter((row) => optionalString(row.ITM_ID) === "T20");
  expect(items.length, "official metadata T20 item").toBeGreaterThan(0);
  for (const item of items) {
    requiredString(item.OBJ_ID, "T20 OBJ_ID");
    requiredString(item.OBJ_NM, "T20 OBJ_NM");
    requiredString(item.ITM_NM, "T20 ITM_NM");
    const unit = optionalString(item.UNIT) || optionalString(item.UNIT_NM);
    expect(unit.length, "T20 official unit metadata").toBeGreaterThan(0);
  }
  const itemId = requiredString(items[0].ITM_ID, "official T20 ITM_ID");
  expect(itemId, "official metadata item identity").toBe("T20");
  return itemId;
}

async function readAllAnnualData(
  client: Parameters<typeof callToolJson>[0],
  query: JsonRecord,
  regionCode: string,
  axisGroupName: string,
): Promise<SimplifiedDataRow[]> {
  const rows: SimplifiedDataRow[] = [];
  const identities = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
    const page = await callToolJson(client, "get_statistics_data", {
      ...query,
      pageSize: DATA_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
    });
    expect(page.success, `get_statistics_data page ${pageNumber} success`).toBe(
      true,
    );
    expect(
      Buffer.byteLength(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(page, null, 2) }],
        }),
      ),
      `get_statistics_data page ${pageNumber} MCP bytes`,
    ).toBeLessThanOrEqual(32_768);
    const pageRows = Array.isArray(page.data) ? page.data : [];
    expect(
      Array.isArray(page.data),
      `get_statistics_data page ${pageNumber} data`,
    ).toBe(true);
    expect(
      page.returnedCount,
      `get_statistics_data page ${pageNumber} returnedCount`,
    ).toBe(pageRows.length);
    for (const row of pageRows as unknown[]) {
      expect(
        row !== null && typeof row === "object" && !Array.isArray(row),
        "statistics row object",
      ).toBe(true);
      const record = row as SimplifiedDataRow;
      const raw = record.raw;
      expect(
        raw !== null && typeof raw === "object" && !Array.isArray(raw),
        "statistics raw row",
      ).toBe(true);
      const rawRecord = raw as JsonRecord;
      expect(record.periodType, "annual normalized period type").toBe("Y");
      const rawPeriod = requiredString(record.rawPeriod, "annual rawPeriod");
      expect(YEARS, "annual rawPeriod range").toContain(rawPeriod);
      const rawValue = requiredString(record.rawValue, "annual rawValue");
      expect(
        Number.isFinite(Number(rawValue.replaceAll(",", ""))),
        `finite annual rawValue ${rawPeriod}`,
      ).toBe(true);
      expect(requiredString(record.unit, "annual unit").length).toBeGreaterThan(
        0,
      );
      expect(requiredString(rawRecord.ORG_ID, "annual raw ORG_ID")).toBe(
        query.orgId,
      );
      expect(requiredString(rawRecord.TBL_ID, "annual raw TBL_ID")).toBe(
        query.tableId,
      );
      expect(requiredString(rawRecord.ITM_ID, "annual raw ITM_ID")).toBe(
        requiredString(query.itemId, "official query itemId"),
      );
      expect(requiredString(rawRecord.C1, "annual raw C1 region code")).toBe(
        regionCode,
      );
      expect(requiredString(rawRecord.C1_OBJ_NM, "annual raw C1_OBJ_NM")).toBe(
        axisGroupName,
      );
      expect(requiredString(rawRecord.UNIT_NM, "annual raw UNIT_NM")).toBe(
        record.unit,
      );
      expect(requiredString(rawRecord.PRD_SE, "annual raw PRD_SE")).toBe("A");
      expect(requiredString(rawRecord.PRD_DE, "annual raw PRD_DE")).toBe(
        rawPeriod,
      );
      const identity = [
        rawRecord.ITM_ID,
        ...Array.from({ length: 8 }, (_, index) => rawRecord[`C${index + 1}`]),
        rawRecord.PRD_DE,
      ]
        .map(optionalString)
        .join("\u001f");
      expect(
        identities.has(identity),
        `duplicate annual observation identity ${identity}`,
      ).toBe(false);
      identities.add(identity);
      rows.push(record);
    }
    if (page.hasMore === true) {
      const nextCursor = requiredString(
        page.nextCursor,
        `get_statistics_data page ${pageNumber} nextCursor`,
      );
      expect(
        cursors.has(nextCursor),
        `repeated get_statistics_data cursor page ${pageNumber}`,
      ).toBe(false);
      cursors.add(nextCursor);
      cursor = nextCursor;
      continue;
    }
    expect(
      page.hasMore,
      `get_statistics_data page ${pageNumber} completion`,
    ).toBe(false);
    expect(
      page.nextCursor === undefined || page.nextCursor === null,
      "get_statistics_data terminal cursor",
    ).toBe(true);
    expect(
      page.traversalComplete,
      "get_statistics_data traversalComplete",
    ).toBe(true);
    expect(
      page.aggregateRowCount,
      "get_statistics_data aggregateRowCount",
    ).toBe(YEARS.length);
    expect(page.completion, "get_statistics_data completion").toBe("complete");
    expect(page.completionScope, "get_statistics_data completion scope").toBe(
      "requested_period_traversal",
    );
    expect(rows.length, "complete annual row count").toBe(YEARS.length);
    return rows;
  }
  throw new Error(`get_statistics_data exceeded ${MAX_PAGES} pages`);
}

async function assertPositiveLocality(
  kind: LiveTransportKind,
  regionCase: RegionCase,
): Promise<void> {
  await withReleaseClient(kind, async ({ client }) => {
    const trend = await callToolJson(client, "quick_trend", {
      keyword: "인구",
      region: regionCase.region,
      yearCount: 11,
    });
    expect(
      trend.success,
      `${kind} ${regionCase.region} quick_trend success`,
    ).toBe(true);
    const source = trend.source;
    expect(
      source !== null && typeof source === "object" && !Array.isArray(source),
      "quick_trend source",
    ).toBe(true);
    const sourceRecord = source as JsonRecord;
    const orgId = requiredString(
      sourceRecord.orgId,
      "quick_trend source orgId",
    );
    const tableId = requiredString(
      sourceRecord.tableId,
      "quick_trend source tableId",
    );
    const trendPoints = trend.dataPoints;
    expect(
      Array.isArray(trendPoints),
      `${kind} ${regionCase.region} quick_trend dataPoints`,
    ).toBe(true);
    expect(
      trendPoints,
      `${kind} ${regionCase.region} quick_trend observation count`,
    ).toHaveLength(YEARS.length);
    expect(sourceRecord.periodType, "quick_trend source periodType").toBe("Y");
    expect(
      requiredString(sourceRecord.tableName, "quick_trend source tableName")
        .length,
    ).toBeGreaterThan(0);
    const trendByYear = new Map<string, number>();
    for (const point of trendPoints as unknown[]) {
      expect(
        point !== null && typeof point === "object" && !Array.isArray(point),
        "quick_trend point object",
      ).toBe(true);
      const pointRecord = point as JsonRecord;
      const year = requiredString(pointRecord.year, "quick_trend year");
      expect(YEARS, "quick_trend explicit 2015-2025 years").toContain(year);
      const value = pointRecord.value;
      expect(typeof value, `quick_trend ${year} value type`).toBe("number");
      expect(
        Number.isFinite(value as number),
        `quick_trend ${year} finite value`,
      ).toBe(true);
      expect(trendByYear.has(year), `duplicate quick_trend year ${year}`).toBe(
        false,
      );
      trendByYear.set(year, value as number);
    }
    expect(
      [...trendByYear.keys()].sort(),
      "quick_trend exact annual years",
    ).toEqual(YEARS);

    const metadataRows = await readAllOfficialMetadata(client, orgId, tableId);
    assertMetadataFields(metadataRows);
    const itemId = assertT20Metadata(metadataRows);
    const region = findOfficialRegion(metadataRows, regionCase);
    expect(region.path.at(-1), `${regionCase.region} exact path leaf`).toBe(
      regionCase.locality,
    );
    expect(
      region.path.join(" "),
      `${regionCase.region} exact official path`,
    ).toContain(regionCase.locality);

    const dataQuery = {
      orgId,
      tableId,
      objL1: region.code,
      itemId,
      periodType: "Y",
      startPeriod: "2015",
      endPeriod: "2025",
    };
    const annualRows = await readAllAnnualData(
      client,
      dataQuery,
      region.code,
      region.groupName,
    );
    const firstRaw = annualRows[0].raw as JsonRecord;
    expect(requiredString(firstRaw.C1_OBJ_NM, "witnessed C1_OBJ_NM")).toBe(
      region.groupName,
    );
    expect(
      metadataRows.some(
        (row) =>
          optionalString(row.OBJ_ID) === region.groupId &&
          optionalString(row.OBJ_NM) === region.groupName,
      ),
      "witnessed C1 metadata OBJ group",
    ).toBe(true);

    const dataByYear = new Map<string, SimplifiedDataRow>();
    for (const row of annualRows) {
      const year = requiredString(row.rawPeriod, "annual comparison rawPeriod");
      expect(
        dataByYear.has(year),
        `duplicate annual comparison year ${year}`,
      ).toBe(false);
      dataByYear.set(year, row);
      const trendValue = trendByYear.get(year);
      expect(trendValue, `quick_trend value for ${year}`).toBeDefined();
      expect(
        Number(String(row.rawValue).replaceAll(",", "")),
        `annual value matches quick_trend ${year}`,
      ).toBe(trendValue);
      expect(
        Number(String(row.value).replaceAll(",", "")),
        `annual display value matches quick_trend ${year}`,
      ).toBe(trendValue);
    }
    expect(
      [...dataByYear.keys()].sort(),
      "annual data exact 2015-2025 years",
    ).toEqual(YEARS);
    expect(sourceRecord.regionCode, "quick_trend official region code").toBe(
      region.code,
    );
    expect(requiredString(sourceRecord.unit, "quick_trend source unit")).toBe(
      requiredString(annualRows[0].unit, "annual official unit"),
    );
  });
}

async function assertNegativeLocality(kind: LiveTransportKind): Promise<void> {
  await withReleaseClient(kind, async ({ client }) => {
    for (const region of NEGATIVE_REGIONS) {
      const result = await callToolJson(client, "quick_stats", {
        query: "인구",
        region,
        year: 2025,
      });
      expect(result.success, `${kind} ${region} rejection`).toBe(false);
      expect(
        result.value,
        `${kind} ${region} must not expose a national value`,
      ).toBeUndefined();
      expect(
        result.source,
        `${kind} ${region} must not expose a national source`,
      ).toBeUndefined();
      expect(
        result.validationLevel,
        `${kind} ${region} geographic validation status`,
      ).toBe("unverified");
      const note = requiredString(
        result.note,
        `${kind} ${region} geographic reason`,
      );
      expect(note, `${kind} ${region} geographic reason marker`).toMatch(
        /공식|지역|메타데이터|찾지|확인하지|동일한|부모/iu,
      );
      expect(
        note,
        `${kind} ${region} is not a generic upstream failure`,
      ).not.toMatch(
        /조회\s*실패|네트워크|network|timeout|fetch|오류|error|KOSIS\s*API/iu,
      );
      expect(
        requiredString(result.answer, `${kind} ${region} rejection answer`),
      ).toContain("지역");
    }
  });
}

if (includeR2Cases) {
  test(
    "REQ-G01.stdio Dongnae official locality admission @live @stdio @AC1 @AC8",
    { tag: ["@REQ-G01.stdio", "@AC1", "@AC8", "@live", "@stdio"] },
    async () =>
      runSanitizedLiveCase("REQ-G01.stdio", () =>
        assertPositiveLocality("stdio", POSITIVE_CASES.dongnae),
      ),
  );
  test(
    "REQ-G01.http Dongnae official locality admission @live @http @AC1 @AC8",
    { tag: ["@REQ-G01.http", "@AC1", "@AC8", "@live", "@http"] },
    async () =>
      runSanitizedLiveCase("REQ-G01.http", () =>
        assertPositiveLocality("http", POSITIVE_CASES.dongnae),
      ),
  );
  test(
    "REQ-G02.stdio Gijang official locality admission @live @stdio @AC1 @AC8",
    { tag: ["@REQ-G02.stdio", "@AC1", "@AC8", "@live", "@stdio"] },
    async () =>
      runSanitizedLiveCase("REQ-G02.stdio", () =>
        assertPositiveLocality("stdio", POSITIVE_CASES.gijang),
      ),
  );
  test(
    "REQ-G02.http Gijang official locality admission @live @http @AC1 @AC8",
    { tag: ["@REQ-G02.http", "@AC1", "@AC8", "@live", "@http"] },
    async () =>
      runSanitizedLiveCase("REQ-G02.http", () =>
        assertPositiveLocality("http", POSITIVE_CASES.gijang),
      ),
  );
  test(
    "REQ-G03.stdio Suwon official parent-path locality admission @live @stdio @AC1 @AC8",
    { tag: ["@REQ-G03.stdio", "@AC1", "@AC8", "@live", "@stdio"] },
    async () =>
      runSanitizedLiveCase("REQ-G03.stdio", () =>
        assertPositiveLocality("stdio", POSITIVE_CASES.suwon),
      ),
  );
  test(
    "REQ-G03.http Suwon official parent-path locality admission @live @http @AC1 @AC8",
    { tag: ["@REQ-G03.http", "@AC1", "@AC8", "@live", "@http"] },
    async () =>
      runSanitizedLiveCase("REQ-G03.http", () =>
        assertPositiveLocality("http", POSITIVE_CASES.suwon),
      ),
  );
  test(
    "REQ-G04.stdio invalid localities reject without national fallback @live @stdio @AC1 @AC9",
    { tag: ["@REQ-G04.stdio", "@AC1", "@AC9", "@live", "@stdio"] },
    async () =>
      runSanitizedLiveCase("REQ-G04.stdio", () =>
        assertNegativeLocality("stdio"),
      ),
  );
  test(
    "REQ-G04.http invalid localities reject without national fallback @live @http @AC1 @AC9",
    { tag: ["@REQ-G04.http", "@AC1", "@AC9", "@live", "@http"] },
    async () =>
      runSanitizedLiveCase("REQ-G04.http", () =>
        assertNegativeLocality("http"),
      ),
  );
}
