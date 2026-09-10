import assert from "node:assert/strict";
import test from "node:test";

process.env.KOSIS_API_KEY = "analysis-integrity-test-key";

const { getCacheManager } = await import("../dist/cache/index.js");
const { compareStatistics } =
  await import("../dist/tools/compareStatistics.js");
const { analyzeTimeSeries } =
  await import("../dist/tools/analyzeTimeSeries.js");
const { collectStatisticsPages, createStatisticsCollectionBudget } =
  await import("../dist/tools/statisticsRetrieval.js");

const baseRow = {
  ORG_ID: "101",
  TBL_ID: "TABLE",
  TBL_NM: "fixture table",
  C1: "L1",
  C1_NM: "분류1",
  C2: "L2",
  C2_NM: "분류2",
  C3: "L3",
  C3_NM: "분류3",
  C4: "L4",
  C4_NM: "분류4",
  C5: "L5",
  C5_NM: "분류5",
  C6: "L6",
  C6_NM: "분류6",
  C7: "L7",
  C7_NM: "분류7",
  C8: "L8",
  C8_NM: "분류8",
  ITM_ID: "ITEM",
  ITM_NM: "항목",
  UNIT_NM: "명",
  PRD_SE: "Y",
};

const calls = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  calls.push(url);
  const tableId = url.searchParams.get("tblId");
  const row = (overrides = {}) => ({
    ...baseRow,
    TBL_ID: tableId,
    PRD_SE: url.searchParams.get("prdSe") ?? "Y",
    ...overrides,
  });
  const period = url.searchParams.get("startPrdDe");
  const objL3 = url.searchParams.get("objL3");

  let rows;
  const calendarPeriods = {
    MONTHLY: ["202312", "202401"],
    QUARTERLY: ["202304", "202401"],
    MONTHLY_GAP: ["202311", "202401"],
    QUARTERLY_GAP: ["202303", "202401"],
    INVALID_MONTH: ["202412", "202413"],
  }[tableId];
  if (tableId === "PAGED_COMPLETE" || tableId === "PAGED_INTERRUPTED") {
    const fetchNumber = calls.filter(
      (candidate) => candidate.searchParams.get("tblId") === tableId,
    ).length;
    const changed = tableId === "PAGED_INTERRUPTED" && fetchNumber > 1;
    rows = Array.from({ length: 51 }, (_, index) =>
      row({
        PRD_DE: period ?? "2022",
        C1: `GROUP_${index}`,
        C1_NM: `분류${index}`,
        DT: changed && index === 0 ? "999" : String(index + 1),
      }),
    );
  } else if (tableId === "PAGED_LIMIT") {
    rows = Array.from({ length: 4000 }, (_, index) =>
      row({
        PRD_DE: period ?? "2022",
        C1: `GROUP_${index}`,
        C1_NM: `분류${index}`,
        DT: String(index + 1),
      }),
    );
  } else if (tableId === "IMPLICIT_SINGLE") {
    rows = [row({ PRD_DE: "2024", DT: "1" })];
  } else if (calendarPeriods) {
    rows = calendarPeriods.map((PRD_DE, index) =>
      row({ PRD_DE, DT: String(index + 1) }),
    );
  } else if (tableId === "MALFORMED") {
    rows = [
      row({ PRD_DE: "2022", DT: "0" }),
      row({ PRD_DE: "2023", DT: "not-a-number" }),
    ];
  } else if (tableId === "GAPPED") {
    rows = [row({ PRD_DE: "2022", DT: "1" }), row({ PRD_DE: "2024", DT: "3" })];
  } else if (tableId === "MIXED_UNITS") {
    rows = [
      row({ PRD_DE: "2022", DT: "1", UNIT_NM: "명" }),
      row({ PRD_DE: "2023", DT: "2", UNIT_NM: "%" }),
    ];
  } else if (tableId === "DUPLICATE") {
    rows = [
      row({ PRD_DE: period ?? "2022", DT: "1" }),
      row({ PRD_DE: period ?? "2022", DT: "2" }),
    ];
  } else if (tableId === "ITEM_COMPARE") {
    rows = [
      row({
        PRD_DE: period ?? "2024",
        ITM_ID: "ITEM_A",
        ITM_NM: "항목A",
        DT: "3",
      }),
      row({
        PRD_DE: period ?? "2024",
        ITM_ID: "ITEM_B",
        ITM_NM: "항목B",
        DT: "-2",
      }),
    ];
  } else if (tableId === "IDENTITY_MISMATCH") {
    rows = [row({ ORG_ID: "999", PRD_DE: period ?? "2022", DT: "1" })];
  } else if (tableId === "MISSING_IDENTITY") {
    rows = [
      row({ ORG_ID: undefined, PRD_DE: "2022", DT: "1" }),
      row({ ORG_ID: undefined, PRD_DE: "2023", DT: "2" }),
    ];
  } else if (tableId === "CACHE_SELECTOR") {
    const selected = objL3 === "B" ? "B" : "A";
    rows = [
      row({
        C3: selected,
        C3_NM: selected,
        PRD_DE: period ?? "2022",
        DT: selected === "A" ? "1" : "9",
      }),
    ];
  } else if (period) {
    const values = { 2022: "-10", 2023: "0", 2024: "20" };
    rows = [row({ PRD_DE: period, DT: values[period] ?? "1" })];
  } else {
    rows = [
      row({ PRD_DE: "2022", DT: "0" }),
      row({ PRD_DE: "2023", DT: "10" }),
      row({ PRD_DE: "2024", DT: "20" }),
    ];
  }

  return {
    ok: true,
    status: 200,
    async json() {
      return rows;
    },
  };
};

function clear() {
  getCacheManager().flush();
  calls.length = 0;
}

const input = (overrides = {}) => ({
  orgId: "101",
  tableId: "TABLE",
  objL1: "L1",
  objL2: "L2",
  objL3: "L3",
  objL4: "L4",
  objL5: "L5",
  objL6: "L6",
  objL7: "L7",
  objL8: "L8",
  itemId: "ITEM",
  periodType: "Y",
  ...overrides,
});

test("period comparison preserves zero and negative values and explains zero baselines", async () => {
  clear();
  const result = await compareStatistics(
    input({ compareType: "period", periods: ["2022", "2023", "2024"] }),
  );
  assert.equal(result.success, true);
  assert.deepEqual(
    result.items.map((item) => item.value),
    [-10, 0, 20],
  );
  assert.equal(result.items[2].change.rate, null);
  assert.equal(result.items[2].change.absolute, 20);
  assert.match(result.items[2].change.formatted, /비율 미정/);
  assert.equal(result.items[0].region, undefined);
  assert.equal(result.items[0].classification[0].name, "분류1");
  assert.ok(
    !result.insights.some((line) => /(?:^|[^\d.])[-+]?0(?:\.0+)?%/.test(line)),
  );
});
test("provenance binds source queries, omits credentials, and keeps tool-observation time scope", async () => {
  clear();
  const result = await compareStatistics(
    input({
      compareType: "period",
      periods: ["2022", "2023", "2024"],
    }),
  );
  assert.equal(result.success, true);
  assert.equal(result.provenance.provider, "kosis");
  assert.equal(result.provenance.orgId, "101");
  assert.equal(result.provenance.tableId, "TABLE");
  assert.equal(result.provenance.sourceUrls.length, 3);
  assert.deepEqual(
    result.provenance.sourceUrls.map((value) =>
      new URL(value).searchParams.get("startPrdDe"),
    ),
    ["2022", "2023", "2024"],
  );
  for (const sourceUrl of result.provenance.sourceUrls) {
    const parsed = new URL(sourceUrl);
    assert.equal(parsed.searchParams.get("orgId"), "101");
    assert.equal(parsed.searchParams.get("tblId"), "TABLE");
    assert.equal(parsed.searchParams.get("objL1"), "L1");
    assert.equal(parsed.searchParams.get("itmId"), "ITEM");
    assert.equal(parsed.searchParams.get("format"), "json");
    assert.equal(parsed.searchParams.get("jsonVD"), "Y");
    assert.equal(parsed.searchParams.has("apiKey"), false);
  }
  assert.deepEqual(result.provenance.observedPeriods, ["2022", "2023", "2024"]);
  assert.equal(result.provenance.requestedQueryCount, 3);
  assert.equal(result.provenance.queryListTruncated, false);
  assert.equal(result.provenance.queryScope, "requested_logical_queries");
  assert.equal(result.provenance.upstreamRequestHistory, "not_recorded");
  assert.equal(result.provenance.rawObservationCount, 3);
  assert.equal(result.provenance.rawObservationIdsTruncated, false);
  assert.equal(result.provenance.calculated, true);
  assert.equal(result.provenance.calculationPolicies.length > 0, true);
  assert.equal(result.provenance.observedUnit, "명");
  assert.equal(result.provenance.timestampScope, "tool_observation");
  assert.equal(
    result.provenance.timestampNote,
    "tool_observation_not_provider_refresh",
  );
  assert.equal(result.provenance.cacheFreshness, "unproven");
  assert.equal(result.provenance.providerUpdatedAt, null);
  assert.equal(result.provenance.definition, null);
  assert.equal(result.provenance.denominator, null);
  assert.equal(result.provenance.boundaryPolicy, "as_published");
  assert.equal(result.provenance.reallocation, "none");
  assert.equal(result.provenance.rescaling, "none");
  assert.match(result.provenance.queriedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(result.provenance.queriedAtISO, undefined);
  assert.equal(result.provenance.readAtISO, undefined);
  assert.match(result.provenance.readAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(
    result.provenance.rawObservationIds.every(
      (identity) =>
        identity.orgId === "101" &&
        identity.tableId === "TABLE" &&
        identity.itemId === "ITEM" &&
        identity.unit === "명",
    ),
  );
});

test("time-series provenance binds recent-count query and documents analysis transform", async () => {
  clear();
  const result = await analyzeTimeSeries(input({ yearCount: 3 }));
  assert.equal(result.success, true);
  assert.equal(result.provenance.sourceUrls.length, 1);
  const query = new URL(result.provenance.sourceUrls[0]).searchParams;
  assert.equal(query.get("orgId"), "101");
  assert.equal(query.get("tblId"), "TABLE");
  assert.equal(query.get("objL1"), "L1");
  assert.equal(query.get("itmId"), "ITEM");
  assert.equal(query.get("newEstPrdCnt"), "3");
  assert.equal(query.has("apiKey"), false);
  assert.deepEqual(result.provenance.observedPeriods, ["2022", "2023", "2024"]);
  assert.equal(result.provenance.requestedQueryCount, 1);
  assert.equal(result.provenance.queryListTruncated, false);
  assert.equal(result.provenance.rawObservationCount, 3);
  assert.equal(result.provenance.rawObservationIdsTruncated, false);
  assert.equal(result.provenance.calculated, true);
  assert.equal(result.provenance.calculationPolicies.length > 0, true);
  assert.equal(result.provenance.timestampScope, "tool_observation");
  assert.equal(result.provenance.cacheFreshness, "unproven");
  assert.ok(
    result.provenance.appliedCalculations.some((line) =>
      line.includes("zero baselines"),
    ),
  );
});
test("provenance bounds logical queries and raw diagnostic identities without claiming request history", async () => {
  clear();
  const manyPeriods = Array.from({ length: 70 }, (_, index) =>
    String(1900 + index),
  );
  const manyQueries = await compareStatistics(
    input({
      compareType: "period",
      periods: manyPeriods,
    }),
  );
  assert.equal(manyQueries.success, false);
  assert.equal(manyQueries.provenance.requestedQueryCount, 70);
  assert.equal(manyQueries.provenance.queryList.length, 64);
  assert.equal(manyQueries.provenance.sourceUrls.length, 64);
  assert.equal(manyQueries.provenance.queryListTruncated, true);
  assert.equal(manyQueries.provenance.queryScope, "requested_logical_queries");
  assert.equal(manyQueries.provenance.upstreamRequestHistory, "not_recorded");
  assert.equal(manyQueries.provenance.calculated, false);
  assert.deepEqual(manyQueries.provenance.appliedCalculations, []);
  assert.equal(manyQueries.provenance.calculationPolicies.length > 0, true);

  clear();
  const diagnosticRows = await compareStatistics(
    input({
      tableId: "PAGED_COMPLETE",
      objL1: "ALL",
      compareType: "period",
      periods: ["2022", "2023", "2024", "2025", "2026"],
    }),
  );
  assert.equal(diagnosticRows.success, false);
  assert.ok(diagnosticRows.provenance.rawObservationCount > 200);
  assert.equal(diagnosticRows.provenance.rawObservationIds.length, 200);
  assert.equal(diagnosticRows.provenance.rawObservationIdsTruncated, true);
  assert.equal(diagnosticRows.provenance.calculated, false);
  assert.deepEqual(diagnosticRows.provenance.appliedCalculations, []);
});

test("failed analysis retains truthful provenance and does not claim provider freshness", async () => {
  clear();
  const result = await analyzeTimeSeries(
    input({ tableId: "MALFORMED", yearCount: 2 }),
  );
  assert.equal(result.success, false);
  assert.equal(result.provenance.provider, "kosis");
  assert.equal(result.provenance.providerUpdatedAt, null);
  assert.equal(result.provenance.cacheFreshness, "unproven");
  assert.equal(result.provenance.calculated, false);
  assert.equal(result.provenance.observedUnit, null);
  assert.deepEqual(result.provenance.appliedCalculations, []);
  assert.equal(result.provenance.calculationPolicies.length > 0, true);
  assert.deepEqual(result.provenance.observedPeriods, ["2022", "2023"]);
  assert.equal(result.provenance.rawObservationIds.length, 2);
});
test("item comparison accepts a coherent provider group without geographic assumptions", async () => {
  clear();
  const result = await compareStatistics(
    input({
      tableId: "ITEM_COMPARE",
      compareType: "item",
      itemId: "ITEM_A,ITEM_B",
    }),
  );
  assert.equal(result.success, true);
  assert.deepEqual(
    result.items.map((item) => item.value),
    [3, -2],
  );
  assert.equal(result.items[0].region, undefined);
  assert.equal(result.validationLevel, "unverified");
  assert.match(result.summary, /^반환된 2개 항목/);
  assert.ok(
    result.insights.some((line) =>
      /전체성·최신성은 입증하지 않았습니다/.test(line),
    ),
  );
});

test("time series rejects malformed observations rather than treating them as zero", async () => {
  clear();
  const result = await analyzeTimeSeries(
    input({ tableId: "MALFORMED", yearCount: 2 }),
  );
  assert.equal(result.success, false);
  assert.match(result.interpretation[0], /결측|숫자/);
  assert.equal(result.dataPoints[1].value, null);
  assert.equal(result.dataPoints[1].rawValue, "not-a-number");
});

test("time series rejects gaps, mixed units, duplicate observations, and identity mismatches", async () => {
  clear();
  const gapped = await analyzeTimeSeries(
    input({ tableId: "GAPPED", yearCount: 2 }),
  );
  assert.equal(gapped.success, false);
  assert.match(gapped.interpretation[0], /이어지지|누락/);

  clear();
  const mixed = await analyzeTimeSeries(
    input({ tableId: "MIXED_UNITS", yearCount: 2 }),
  );
  assert.equal(mixed.success, false);
  assert.match(mixed.interpretation[0], /단위/);

  clear();
  const duplicate = await compareStatistics(
    input({
      tableId: "DUPLICATE",
      compareType: "period",
      periods: ["2022", "2023"],
    }),
  );
  assert.equal(duplicate.success, false);
  assert.equal(duplicate.errorCode, "response_incomplete");
  assert.match(duplicate.insights[0], /Duplicate observation/);

  clear();
  const mismatch = await analyzeTimeSeries(
    input({ tableId: "IDENTITY_MISMATCH", yearCount: 2 }),
  );
  assert.equal(mismatch.success, false);
  assert.equal(mismatch.errorCode, "response_mismatch");
  clear();
  const missing = await analyzeTimeSeries(
    input({ tableId: "MISSING_IDENTITY", yearCount: 2 }),
  );
  assert.equal(missing.success, false);
  assert.equal(missing.errorCode, "response_incomplete");
});

test("comparison cache identity includes selectors and forwards every category axis", async () => {
  clear();
  const first = await compareStatistics(
    input({
      tableId: "CACHE_SELECTOR",
      objL3: "A",
      compareType: "period",
      periods: ["2022", "2023"],
    }),
  );
  const second = await compareStatistics(
    input({
      tableId: "CACHE_SELECTOR",
      objL3: "B",
      compareType: "period",
      periods: ["2022", "2023"],
    }),
  );
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(first.items[0].raw.C3, "A");
  assert.equal(second.items[0].raw.C3, "B");
  assert.equal(calls.length, 4);
  for (const key of [
    "objL1",
    "objL2",
    "objL3",
    "objL4",
    "objL5",
    "objL6",
    "objL7",
    "objL8",
  ]) {
    assert.equal(calls[0].searchParams.get(key), input({ objL3: "A" })[key]);
  }
});
test("implicit period comparison rejects a single returned observation", async () => {
  clear();
  const result = await compareStatistics(
    input({ tableId: "IMPLICIT_SINGLE", compareType: "period" }),
  );
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "response_incomplete");
  assert.match(result.insights[0], /fewer observations than recentCount/);
});

test("monthly and quarterly series distinguish year boundaries from missing or invalid periods", async () => {
  for (const [tableId, periodType, expected] of [
    ["MONTHLY", "M", true],
    ["QUARTERLY", "Q", true],
    ["MONTHLY_GAP", "M", false],
    ["QUARTERLY_GAP", "Q", false],
    ["INVALID_MONTH", "M", false],
  ]) {
    clear();
    const result = await analyzeTimeSeries(
      input({ tableId, periodType, yearCount: 2 }),
    );
    assert.equal(result.success, expected, tableId);
    if (expected) {
      assert.equal(result.analysis.recentChange.rate, 100);
      assert.deepEqual(
        result.dataPoints.map((point) => point.value),
        [1, 2],
      );
    } else {
      assert.equal(result.errorCode, "response_incomplete");
      assert.equal(result.dataPoints.length, 2);
    }
  }
});
test("recent coherent series retains unverified completeness for opaque selectors", async () => {
  clear();
  const result = await analyzeTimeSeries(input({ objL3: "*", yearCount: 3 }));
  assert.equal(result.success, true);
  assert.equal(result.validationLevel, "unverified");
  assert.deepEqual(
    result.dataPoints.map((point) => point.value),
    [0, 10, 20],
  );
  assert.equal(result.analysis.recentChange.rate, 100);
});
test("recent coherent series keeps observed calculations unverified without implying latest completeness", async () => {
  clear();
  const result = await analyzeTimeSeries(input({ yearCount: 3 }));
  assert.equal(result.success, true);
  assert.equal(result.validationLevel, "unverified");
  assert.ok(
    result.interpretation.some((line) => /관측된 마지막 변화/.test(line)),
  );
  assert.ok(
    result.interpretation.some((line) =>
      /최신성은 입증하지 않았습니다/.test(line),
    ),
  );
});

test("comparison consumes every finite page before validating observations", async () => {
  clear();
  const result = await compareStatistics(
    input({
      tableId: "PAGED_COMPLETE",
      objL1: "ALL",
      compareType: "period",
      periods: ["2022", "2023"],
    }),
  );
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "response_incomplete");
  assert.ok(calls.length >= 4);
  assert.equal(result.items.length, 102);
  assert.match(result.insights[0], /분류/);
});

test("comparison never calculates from an interrupted page traversal", async () => {
  clear();
  const result = await compareStatistics(
    input({
      tableId: "PAGED_INTERRUPTED",
      objL1: "ALL",
      compareType: "period",
      periods: ["2022", "2023"],
    }),
  );
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "RESTART_REQUIRED");
  assert.ok(result.items.length > 0 && result.items.length < 51);
  assert.match(result.insights[0], /다시 시작|변경/);
});
test("comparison bounds page traversal and raw error evidence", async () => {
  clear();
  const result = await compareStatistics(
    input({
      tableId: "PAGED_LIMIT",
      objL1: "ALL",
      compareType: "period",
      periods: ["2022", "2023"],
    }),
  );
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "COLLECTION_PAGE_LIMIT");
  assert.equal(result.items.length, 200);
  assert.ok(calls.length <= 64);
});

test("comparison shares one page budget across many successful period queries", async () => {
  clear();
  const result = await compareStatistics(
    input({
      compareType: "period",
      periods: Array.from({ length: 70 }, (_, index) => String(1900 + index)),
    }),
  );
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "COLLECTION_PAGE_LIMIT");
  assert.equal(calls.length, 64);
  assert.equal(result.items.length, 64);
  assert.ok(result.items.every((item) => item.change === undefined));
});

test("shared row budget stops later collections before another provider request", async () => {
  clear();
  const budget = createStatisticsCollectionBudget();
  budget.remainingRows = 1;
  const first = await collectStatisticsPages(
    input({ startPeriod: "2022", endPeriod: "2022" }),
    budget,
  );
  assert.equal(first.success, true);
  const second = await collectStatisticsPages(
    input({ startPeriod: "2023", endPeriod: "2023" }),
    budget,
  );
  assert.equal(second.success, false);
  assert.equal(second.errorCode, "COLLECTION_ROW_LIMIT");
  assert.equal(calls.length, 1);
  assert.equal(budget.remainingRows, 0);
});
test.after(() => {
  globalThis.fetch = originalFetch;
  getCacheManager().flush();
});
