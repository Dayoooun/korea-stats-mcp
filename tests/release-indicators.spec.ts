import { test, expect } from "@playwright/test";
import { QUICK_STATS_PARAMS } from "../src/data/quickStatsParams";
import {
  callToolJson,
  runSanitizedLiveCase,
  withReleaseClient,
  type LiveTransportKind,
} from "./release-live-client";

test.setTimeout(180_000);

type JsonRecord = Record<string, unknown>;
type IndicatorCase = {
  readonly id: string;
  readonly name: string;
};

const releasePhase = process.env.KOREA_STATS_RELEASE_PHASE?.trim();
const registerR3Cases =
  releasePhase === undefined || releasePhase === "" || releasePhase === "R3";

const TOTAL_FERTILITY_RATE: IndicatorCase = {
  id: "160",
  name: "합계출산율",
};
const GINI_COEFFICIENT: IndicatorCase = {
  id: "478",
  name: "지니계수(전체가구, 처분가능소득)",
};

function asRecord(value: unknown, label: string): JsonRecord {
  expect(value, `${label} object`).not.toBeNull();
  expect(typeof value, `${label} object type`).toBe("object");
  expect(Array.isArray(value), `${label} object is not an array`).toBe(false);
  return value as JsonRecord;
}

function asRows(value: unknown, label: string): JsonRecord[] {
  expect(Array.isArray(value), `${label} rows`).toBe(true);
  return (value as unknown[]).map((row, index) =>
    asRecord(row, `${label} row ${index + 1}`),
  );
}

function expectNonEmptyString(
  value: unknown,
  label: string,
): asserts value is string {
  expect(typeof value, `${label} type`).toBe("string");
  expect((value as string).trim().length, `${label} nonempty`).toBeGreaterThan(
    0,
  );
}

function assertPublicResponseMetadata(
  result: JsonRecord,
  endpoint: string,
  expectedParams: Readonly<Record<string, string>>,
  label: string,
): URL {
  expect(result.success, `${label} success`).toBe(true);
  expectNonEmptyString(result.sourceUrl, `${label} sourceUrl`);
  const sourceUrl = result.sourceUrl as string;
  expect(
    sourceUrl,
    `${label} provenance URL must not expose an API key`,
  ).not.toContain("apiKey");
  const url = new URL(sourceUrl);
  expect(url.protocol, `${label} provenance protocol`).toBe("https:");
  expect(url.pathname.endsWith(endpoint), `${label} provider route`).toBe(true);
  expect(url.searchParams.get("format"), `${label} response format`).toBe(
    "json",
  );
  expect(url.searchParams.get("jsonVD"), `${label} jsonVD`).toBe("Y");
  expect(url.searchParams.has("apiKey"), `${label} API key query field`).toBe(
    false,
  );
  for (const [name, value] of Object.entries(expectedParams)) {
    expect(url.searchParams.get(name), `${label} ${name}`).toBe(value);
  }

  const source = asRecord(result.source, `${label} source`);
  expect(source.provider, `${label} source provider`).toBe("kosis");
  expect(source.endpoint, `${label} source endpoint`).toBe(sourceUrl);
  expectNonEmptyString(result.observedAt, `${label} observedAt`);
  expect(
    Number.isNaN(Date.parse(result.observedAt as string)),
    `${label} observedAt ISO`,
  ).toBe(false);
  const retrieval = asRecord(result.retrieval, `${label} retrieval`);
  expect(retrieval.status, `${label} retrieval status`).toBe("success");
  expect(retrieval.access, `${label} retrieval access`).toBe(
    "public_service_operating_key",
  );
  return url;
}

function assertCurrentPageSnapshot(
  result: JsonRecord,
  rows: readonly JsonRecord[],
  label: string,
): void {
  const completeness = asRecord(result.completeness, `${label} completeness`);
  expect(completeness.currentPage, `${label} current page`).toBe(1);
  expect(completeness.pageSize, `${label} bounded page size`).toBe(20);
  expect(completeness.returned, `${label} current-page returned count`).toBe(
    rows.length,
  );
  expect(completeness.hasMore, `${label} snapshot hasMore`).toBe("unknown");
  expect(completeness.nextPage, `${label} next page`).toBe(2);
  expectNonEmptyString(completeness.nextPageHint, `${label} next-page hint`);
  const pagination = asRecord(result.pagination, `${label} pagination`);
  expect(pagination.currentPage, `${label} pagination current page`).toBe(1);
  expect(pagination.pageSize, `${label} pagination page size`).toBe(20);
  expect(pagination.hasMore, `${label} pagination hasMore`).toBe("unknown");
}

function assertTruthfulUnit(
  result: JsonRecord,
  rows: readonly JsonRecord[],
  label: string,
): void {
  expectNonEmptyString(result.unit, `${label} unit`);
  const units = new Set(
    rows
      .map((row) => row.unit)
      .filter((unit) => unit !== undefined && unit !== null && unit !== "")
      .map((unit) => String(unit)),
  );
  if (units.size === 1) {
    expect(result.unit, `${label} single provider unit`).toBe([...units][0]);
  } else {
    expect(result.unit, `${label} ambiguous provider unit`).toBe("unknown");
  }
}

async function assertIndicatorEvidence(
  kind: LiveTransportKind,
  indicator: IndicatorCase,
): Promise<void> {
  await withReleaseClient(kind, async ({ client }) => {
    if (indicator.id === GINI_COEFFICIENT.id) {
      expect(
        Object.hasOwn(QUICK_STATS_PARAMS, "지니계수"),
        `${kind} ${indicator.id} must remain outside QUICK_STATS_PARAMS`,
      ).toBe(false);
    }
    const search = await callToolJson(client, "search_indicators", {
      filters: { indicatorId: indicator.id, indicatorName: indicator.name },
      page: 1,
      pageSize: 20,
    });
    const searchUrl = assertPublicResponseMetadata(
      search,
      "/indIdListSearchRequest.do",
      {
        method: "getList",
        service: "4",
        serviceDetail: "indIdList",
        jipyoId: indicator.id,
        pageNo: "1",
        numOfRows: "20",
      },
      `${kind} ${indicator.id} search`,
    );
    expect(
      searchUrl.searchParams.has("jipyoNm"),
      `${kind} ${indicator.id} search secondary name parameter`,
    ).toBe(false);
    const searchRows = asRows(
      search.data,
      `${kind} ${indicator.id} search data`,
    );
    expect(
      searchRows.some(
        (row) =>
          String(row.statJipyoId) === indicator.id &&
          row.statJipyoNm === indicator.name,
      ),
      `${kind} ${indicator.id} exact search identity`,
    ).toBe(true);
    const filterScope = asRecord(
      search.filterScope,
      `${kind} ${indicator.id} search filter scope`,
    );
    expect(filterScope.type).toBe("current_provider_page");
    expect(filterScope.primary).toBe("indicatorId");
    expect(filterScope.secondary).toEqual(["indicatorName"]);
    expect(filterScope.providerEndpoint).toBe("/indIdListSearchRequest.do");
    assertCurrentPageSnapshot(
      search,
      searchRows,
      `${kind} ${indicator.id} search`,
    );

    const definition = await callToolJson(client, "get_indicator", {
      indicatorId: indicator.id,
      kind: "definition",
      page: 1,
      pageSize: 20,
    });
    assertPublicResponseMetadata(
      definition,
      "/pkNumberService.do",
      {
        method: "getList",
        service: "1",
        serviceDetail: "pkAll",
        jipyoId: indicator.id,
        pageNo: "1",
        numOfRows: "20",
      },
      `${kind} ${indicator.id} definition`,
    );
    const definitionRows = asRows(
      definition.data,
      `${kind} ${indicator.id} definition data`,
    );
    const definitionRow = definitionRows.find(
      (row) =>
        String(row.jipyoId) === indicator.id && row.jipyoNm === indicator.name,
    );
    expect(
      definitionRow,
      `${kind} ${indicator.id} definition identity`,
    ).toBeDefined();
    expectNonEmptyString(
      definitionRow?.jipyoExplan1,
      `${kind} ${indicator.id} definition concept`,
    );
    expectNonEmptyString(
      definitionRow?.jipyoExplan3,
      `${kind} ${indicator.id} definition source`,
    );
    expect(definitionRow?.jipyoExplan1).not.toBe("unknown");
    expect(definitionRow?.jipyoExplan3).not.toBe("unknown");
    const mappedDefinition = asRecord(
      definition.definition,
      `${kind} ${indicator.id} mapped definition`,
    );
    expect(mappedDefinition.concept).toBe(definitionRow?.jipyoExplan1);
    expect(mappedDefinition.sourceInfo).toBe(definitionRow?.jipyoExplan3);
    assertCurrentPageSnapshot(
      definition,
      definitionRows,
      `${kind} ${indicator.id} definition`,
    );

    const values = await callToolJson(client, "get_indicator", {
      indicatorId: indicator.id,
      indicatorName: indicator.name,
      kind: "values",
      startPeriod: "2023",
      endPeriod: "2024",
      page: 1,
      pageSize: 20,
    });
    const valuesUrl = assertPublicResponseMetadata(
      values,
      "/indIdDetailSearchRequest.do",
      {
        method: "getList",
        service: "4",
        serviceDetail: "indIdDetail",
        jipyoId: indicator.id,
        strtPrdDe: "2023",
        endPrdDe: "2024",
        pageNo: "1",
        numOfRows: "20",
      },
      `${kind} ${indicator.id} values`,
    );
    expect(
      valuesUrl.searchParams.has("startPrdDe"),
      `${kind} ${indicator.id} values legacy start parameter`,
    ).toBe(false);
    const valueRows = asRows(
      values.data,
      `${kind} ${indicator.id} values data`,
    );
    expect(
      valueRows.length,
      `${kind} ${indicator.id} values observations`,
    ).toBeGreaterThanOrEqual(2);
    const periods = new Set<string>();
    for (const [index, row] of valueRows.entries()) {
      expect(
        String(row.statJipyoId),
        `${kind} ${indicator.id} value ${index + 1} ID`,
      ).toBe(indicator.id);
      expect(
        row.statJipyoNm,
        `${kind} ${indicator.id} value ${index + 1} name`,
      ).toBe(indicator.name);
      expect(
        Object.hasOwn(row, "val"),
        `${kind} ${indicator.id} value ${index + 1} raw val field`,
      ).toBe(true);
      expect(
        row.val,
        `${kind} ${indicator.id} value ${index + 1} raw val`,
      ).not.toBeNull();
      expect(
        ["string", "number"].includes(typeof row.val),
        `${kind} ${indicator.id} value ${index + 1} raw val type`,
      ).toBe(true);
      expect(String(row.val).trim(), "nonempty official numeric value").toMatch(
        /^[+-]?(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/,
      );
      expect(
        Number.isFinite(Number(String(row.val).replaceAll(",", ""))),
        `${kind} ${indicator.id} value ${index + 1} numeric official value`,
      ).toBe(true);
      expectNonEmptyString(
        row.prdSe,
        `${kind} ${indicator.id} value ${index + 1} period type`,
      );
      expect(
        ["2023", "2024"],
        `${kind} ${indicator.id} value ${index + 1} requested period`,
      ).toContain(String(row.prdDe));
      periods.add(String(row.prdDe));
    }
    expect(periods).toEqual(new Set(["2023", "2024"]));
    assertTruthfulUnit(values, valueRows, `${kind} ${indicator.id} values`);
    assertCurrentPageSnapshot(
      values,
      valueRows,
      `${kind} ${indicator.id} values`,
    );
  });
}

if (registerR3Cases) {
  test(
    "REQ-I01.stdio live indicator search, definition, and bounded values @live @stdio @AC5 @AC8",
    { tag: ["@REQ-I01.stdio", "@live", "@stdio", "@AC5", "@AC8"] },
    async () =>
      runSanitizedLiveCase("REQ-I01.stdio", () =>
        assertIndicatorEvidence("stdio", TOTAL_FERTILITY_RATE),
      ),
  );

  test(
    "REQ-I01.http live indicator search, definition, and bounded values @live @http @AC5 @AC8",
    { tag: ["@REQ-I01.http", "@live", "@http", "@AC5", "@AC8"] },
    async () =>
      runSanitizedLiveCase("REQ-I01.http", () =>
        assertIndicatorEvidence("http", TOTAL_FERTILITY_RATE),
      ),
  );

  test(
    "REQ-I02.stdio live indicator search, definition, and bounded values @live @stdio @AC5 @AC8",
    { tag: ["@REQ-I02.stdio", "@live", "@stdio", "@AC5", "@AC8"] },
    async () =>
      runSanitizedLiveCase("REQ-I02.stdio", () =>
        assertIndicatorEvidence("stdio", GINI_COEFFICIENT),
      ),
  );

  test(
    "REQ-I02.http live indicator search, definition, and bounded values @live @http @AC5 @AC8",
    { tag: ["@REQ-I02.http", "@live", "@http", "@AC5", "@AC8"] },
    async () =>
      runSanitizedLiveCase("REQ-I02.http", () =>
        assertIndicatorEvidence("http", GINI_COEFFICIENT),
      ),
  );
}
