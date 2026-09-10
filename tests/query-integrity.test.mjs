import assert from "node:assert/strict";
import test from "node:test";

process.env.KOSIS_API_KEY = "query-integrity-test-key";

const { getCacheManager } = await import("../dist/cache/index.js");
const { getStatisticsData } =
  await import("../dist/tools/getStatisticsData.js");
const { formatNumber } = await import("../dist/utils/dataFormatter.js");

const baseRow = {
  ORG_ID: "101",
  TBL_ID: "TABLE",
  TBL_NM: "fixture table",
  C1: "L1",
  C1_NM: "L1",
  C2: "L2",
  C2_NM: "L2",
  C3: "L3A",
  C3_NM: "L3A",
  C4: "L4A",
  C4_NM: "L4A",
  C5: "L5",
  C5_NM: "L5",
  C6: "L6",
  C6_NM: "L6",
  C7: "L7",
  C7_NM: "L7",
  C8: "L8",
  C8_NM: "L8",
  ITM_ID: "ITEM",
  ITM_NM: "Fixture item",
  UNIT_ID: "COUNT",
  PRD_SE: "Y",
};

const makeRow = (overrides = {}) => ({ ...baseRow, ...overrides });

const fixtures = {
  "L3A|L4A": [
    makeRow({ UNIT_NM: "명", PRD_DE: "2024", DT: "0" }),
    makeRow({ UNIT_NM: "비율", PRD_DE: "2022", DT: "-12.50" }),
    makeRow({ UNIT_NM: "명", PRD_DE: "2023", DT: "…" }),
  ],
  "L3B|L4B": [
    makeRow({
      C3: "L3B",
      C3_NM: "L3B",
      C4: "L4B",
      C4_NM: "L4B",
      UNIT_NM: "명",
      PRD_DE: "2024",
      DT: "99",
    }),
  ],
  "L3B|L4A": [makeRow({ C3: "L3B", UNIT_NM: "명", PRD_DE: "2024", DT: "51" })],
  "L3A|L4B": [makeRow({ C4: "L4B", UNIT_NM: "명", PRD_DE: "2024", DT: "52" })],
  "*|L4A": [
    makeRow({ C3: "L3A", UNIT_NM: "명", PRD_DE: "2024", DT: "61" }),
    makeRow({
      C3: "L3B",
      C3_NM: "L3B",
      UNIT_NM: "명",
      PRD_DE: "2023",
      DT: "62",
    }),
  ],
  "L3A,L3B|L4A": [
    makeRow({ C3: "L3A", UNIT_NM: "명", PRD_DE: "2024", DT: "71" }),
    makeRow({
      C3: "L3B",
      C3_NM: "L3B",
      UNIT_NM: "명",
      PRD_DE: "2023",
      DT: "72",
    }),
  ],
  "L3A+L3B|L4A": [
    makeRow({ C3: "L3A", UNIT_NM: "명", PRD_DE: "2024", DT: "81" }),
    makeRow({
      C3: "L3B",
      C3_NM: "L3B",
      UNIT_NM: "명",
      PRD_DE: "2023",
      DT: "82",
    }),
  ],
};

const originalFetch = globalThis.fetch;
const calls = [];

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  calls.push(url);
  const key = `${url.searchParams.get("objL3")}|${url.searchParams.get("objL4")}`;
  let rows = fixtures[key] ?? [];
  const tableId = url.searchParams.get("tblId");
  const orgId = url.searchParams.get("orgId");
  const periodType = url.searchParams.get("prdSe");

  const rangeRow = (overrides) => makeRow({ TBL_ID: tableId, ...overrides });
  if (tableId === "CACHE_IDENTITY") {
    const axisKeys = [
      "objL1",
      "objL2",
      "objL3",
      "objL4",
      "objL5",
      "objL6",
      "objL7",
      "objL8",
    ];
    const dimensions = Object.fromEntries(
      axisKeys.flatMap((key, index) => {
        const value = url.searchParams.get(key) ?? `L${index + 1}`;
        return [
          [`C${index + 1}`, value],
          [`C${index + 1}_NM`, value],
        ];
      }),
    );
    const requestedPeriodType = periodType ?? "Y";
    const period =
      requestedPeriodType === "M"
        ? "202401"
        : requestedPeriodType === "Q"
          ? "2024Q1"
          : "2024";
    rows = [
      rangeRow({
        ...dimensions,
        ITM_ID: url.searchParams.get("itmId") ?? "ITEM",
        ITM_NM: `Fixture ${url.searchParams.get("itmId") ?? "ITEM"}`,
        PRD_SE: requestedPeriodType,
        PRD_DE: period,
        UNIT_NM: "명",
        DT: "1",
      }),
    ];
  } else if (tableId === "RANGE_COMPLETE") {
    rows = [
      rangeRow({ PRD_SE: "M", UNIT_NM: "명", PRD_DE: "202401", DT: "1" }),
      rangeRow({ PRD_SE: "M", UNIT_NM: "명", PRD_DE: "202402", DT: "2" }),
      rangeRow({ PRD_SE: "M", UNIT_NM: "명", PRD_DE: "202403", DT: "3" }),
    ];
  } else if (tableId === "RANGE_MISSING_FEB") {
    rows = [
      rangeRow({ PRD_SE: "M", UNIT_NM: "명", PRD_DE: "202401", DT: "1" }),
      rangeRow({ PRD_SE: "M", UNIT_NM: "명", PRD_DE: "202403", DT: "3" }),
    ];
  } else if (tableId === "RANGE_MISSING_BOUNDARY") {
    rows = [
      rangeRow({ PRD_SE: "M", UNIT_NM: "명", PRD_DE: "202402", DT: "2" }),
      rangeRow({ PRD_SE: "M", UNIT_NM: "명", PRD_DE: "202403", DT: "3" }),
    ];
  } else if (tableId === "RANGE_MALFORMED") {
    rows = [
      rangeRow({ PRD_SE: "M", UNIT_NM: "명", PRD_DE: "202413", DT: "13" }),
    ];
  } else if (tableId === "RANGE_SPLIT_SERIES") {
    rows = [
      rangeRow({
        PRD_SE: "M",
        UNIT_NM: "명",
        C2: "SERIES_A",
        C2_NM: "A",
        PRD_DE: "202401",
        DT: "1",
      }),
      rangeRow({
        PRD_SE: "M",
        UNIT_NM: "명",
        C2: "SERIES_A",
        C2_NM: "A",
        PRD_DE: "202403",
        DT: "3",
      }),
      rangeRow({
        PRD_SE: "M",
        UNIT_NM: "명",
        C2: "SERIES_B",
        C2_NM: "B",
        PRD_DE: "202402",
        DT: "2",
      }),
    ];
  } else if (tableId === "Q_EQUIVALENT") {
    rows = [
      rangeRow({ PRD_SE: "Q", UNIT_NM: "명", PRD_DE: "2024Q1", DT: "1" }),
      rangeRow({ PRD_SE: "Q", UNIT_NM: "명", PRD_DE: "202401", DT: "2" }),
    ];
  } else if (tableId === "UNBOUNDED_DUPLICATE") {
    rows = [
      rangeRow({ PRD_SE: "Y", UNIT_NM: "명", PRD_DE: "2024", DT: "1" }),
      rangeRow({
        PRD_SE: "Y",
        UNIT_NM: "명",
        C3_NM: "renamed label",
        PRD_DE: "2024",
        DT: "2",
      }),
    ];
  } else if (tableId === "RECENT_SHORT") {
    rows = [
      rangeRow({ PRD_SE: "Y", UNIT_NM: "명", PRD_DE: "2023", DT: "1" }),
      rangeRow({ PRD_SE: "Y", UNIT_NM: "명", PRD_DE: "2024", DT: "2" }),
    ];
  } else if (tableId === "TABLE_MISMATCH") {
    rows = [
      makeRow({
        TBL_ID: "OTHER_TABLE",
        UNIT_NM: "명",
        PRD_DE: "2024",
        DT: "81",
      }),
    ];
  } else if (orgId === "999") {
    rows = [
      makeRow({ ORG_ID: "101", UNIT_NM: "명", PRD_DE: "2024", DT: "82" }),
    ];
  } else if (periodType === "M") {
    rows = [makeRow({ PRD_SE: "Q", UNIT_NM: "명", PRD_DE: "2024", DT: "83" })];
  } else if (url.searchParams.get("objL3") === "MISMATCH") {
    rows = [
      makeRow({
        C3: "OTHER_REGION",
        C3_NM: "Other region",
        UNIT_NM: "명",
        PRD_DE: "2024",
        DT: "84",
      }),
    ];
  } else if (url.searchParams.get("objL3") === "MIXED") {
    rows = [
      makeRow({
        C3: "MIXED",
        C3_NM: "Mixed region",
        UNIT_NM: "명",
        PRD_DE: "2024",
        DT: "85",
      }),
      makeRow({
        C3: "OTHER_REGION",
        C3_NM: "Other region",
        UNIT_NM: "명",
        PRD_DE: "2023",
        DT: "86",
      }),
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

function clearQueryCache() {
  getCacheManager().flush();
  calls.length = 0;
}

function query(objL3, objL4, overrides = {}) {
  return getStatisticsData({
    orgId: "101",
    tableId: "TABLE",
    objL1: "L1",
    objL2: "L2",
    objL3,
    objL4,
    objL5: "L5",
    objL6: "L6",
    objL7: "L7",
    objL8: "L8",
    itemId: "ITEM",
    periodType: "Y",
    ...overrides,
  });
}

test("all classification dimensions reach the request and isolate cache entries", async () => {
  clearQueryCache();

  const first = await query("L3A", "L4A");
  const second = await query("L3B", "L4B");
  const thirdOnly = await query("L3B", "L4A");
  const fourthOnly = await query("L3A", "L4B");
  const firstAgain = await query("L3A", "L4A");

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(firstAgain.success, true);
  assert.equal(
    calls.length,
    4,
    "each dimension independently isolates cache entries",
  );
  assert.deepEqual(
    first.data.map((row) => row.rawValue),
    ["-12.50", "…", "0"],
  );
  assert.equal(thirdOnly.data[0].rawValue, "51");
  assert.equal(fourthOnly.data[0].rawValue, "52");
  assert.equal(second.data[0].rawValue, "99");

  const firstRequest = calls[0].searchParams;
  assert.equal(firstRequest.get("objL3"), "L3A");
  assert.equal(firstRequest.get("objL4"), "L4A");
  assert.equal(firstRequest.get("objL5"), "L5");
  assert.equal(firstRequest.get("objL6"), "L6");
  assert.equal(firstRequest.get("objL7"), "L7");
  assert.equal(firstRequest.get("objL8"), "L8");
  assert.equal(firstRequest.has("queryIdentityVersion"), false);
});
test("each L1-L8 selector, item, period, and query option isolates cache identity", async () => {
  clearQueryCache();
  const identityQuery = (overrides = {}) =>
    query("L3A", "L4A", { tableId: "CACHE_IDENTITY", ...overrides });

  const baseline = await identityQuery();
  assert.equal(baseline.success, true);
  assert.equal(baseline.data[0].raw.C1, "L1");

  const axisKeys = [
    "objL1",
    "objL2",
    "objL3",
    "objL4",
    "objL5",
    "objL6",
    "objL7",
    "objL8",
  ];
  for (const [index, key] of axisKeys.entries()) {
    const value = `AXIS_${index + 1}`;
    const result = await identityQuery({ [key]: value });
    assert.equal(result.success, true, key);
    assert.equal(result.data[0].raw[`C${index + 1}`], value, key);
  }

  const item = await identityQuery({ itemId: "ITEM_B" });
  assert.equal(item.success, true);
  assert.equal(item.data[0].raw.ITM_ID, "ITEM_B");

  const monthly = await identityQuery({ periodType: "M" });
  assert.equal(monthly.success, true);
  assert.equal(monthly.data[0].raw.PRD_SE, "M");

  const bounded = await identityQuery({
    startPeriod: "2024",
    endPeriod: "2024",
  });
  assert.equal(bounded.success, true);
  assert.equal(bounded.data[0].raw.PRD_DE, "2024");

  const recent = await identityQuery({ recentCount: 1 });
  assert.equal(recent.success, true);
  assert.equal(recent.data[0].raw.PRD_DE, "2024");

  const paged = await identityQuery({ pageSize: 1 });
  assert.equal(paged.success, true);
  assert.equal(paged.data[0].raw.PRD_DE, "2024");

  const baselineAgain = await identityQuery();
  assert.equal(baselineAgain.success, true);
  assert.equal(baselineAgain.data[0].raw.C1, "L1");
  assert.equal(
    calls.length,
    14,
    "every independent identity variation fetched exactly once",
  );
});

test("cache identity version excludes stale namespace rows", async () => {
  clearQueryCache();
  const cache = getCacheManager();
  const retrieve = cache.getStatisticsData;
  let identity;
  cache.getStatisticsData = async function (params, fetcher) {
    identity = structuredClone(params);
    return retrieve.call(this, params, fetcher);
  };
  try {
    const first = await query("L3A", "L4A", { tableId: "CACHE_IDENTITY" });
    assert.equal(first.success, true);
    assert.equal(identity.queryIdentityVersion, "v3");
    cache.flush();
    await retrieve.call(
      cache,
      { ...identity, queryIdentityVersion: "v2" },
      async () => [{ ...first.data[0].raw, DT: "999999" }],
    );
    const before = calls.length;
    const current = await query("L3A", "L4A", { tableId: "CACHE_IDENTITY" });
    assert.equal(current.success, true);
    assert.equal(calls.length, before + 1);
    assert.notEqual(current.data[0].raw.DT, "999999");
    assert.equal(calls.at(-1).searchParams.has("queryIdentityVersion"), false);
  } finally {
    cache.getStatisticsData = retrieve;
    cache.flush();
  }
});

test("response observations retain signs, missing markers, dimensions, mixed units, and sorted periods", async () => {
  clearQueryCache();

  const result = await query("L3A", "L4A");

  assert.equal(result.success, true);
  assert.equal(result.validationLevel, "unverified");
  assert.deepEqual(
    result.data.map((row) => row.rawPeriod),
    ["2022", "2023", "2024"],
  );
  assert.deepEqual(
    result.data.map((row) => row.rawValue),
    ["-12.50", "…", "0"],
  );
  assert.equal(result.data[0].raw.C8, "L8");
  assert.equal(result.data[0].raw.ITM_NM, "Fixture item");
  assert.equal(result.data[0].raw.UNIT_NM, "비율");
  assert.equal(result.unit, undefined);
  assert.equal(result.metadata.periodRange, "2022 ~ 2024");
});
test("unbounded duplicate observation identities fail closed with raw evidence", async () => {
  clearQueryCache();

  const result = await query("L3A", "L4A", {
    tableId: "UNBOUNDED_DUPLICATE",
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "response_incomplete");
  assert.equal(result.validationLevel, "unverified");
  assert.deepEqual(
    result.data.map((row) => row.rawPeriod),
    ["2024", "2024"],
  );
  assert.deepEqual(
    result.data.map((row) => row.rawValue),
    ["1", "2"],
  );
});

test("short recentCount responses fail closed without discarding observations", async () => {
  clearQueryCache();

  const result = await query("L3A", "L4A", {
    tableId: "RECENT_SHORT",
    recentCount: 3,
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "response_incomplete");
  assert.equal(result.validationLevel, "unverified");
  assert.deepEqual(
    result.data.map((row) => row.rawPeriod),
    ["2023", "2024"],
  );
  assert.deepEqual(
    result.data.map((row) => row.rawValue),
    ["1", "2"],
  );
});

test("cache hits isolate returned raw rows and order from cache-owned observations", async () => {
  clearQueryCache();

  const first = await query("L3A", "L4A");
  assert.equal(first.success, true);
  first.data.reverse();
  first.data[0].raw.PRD_DE = "MUTATED";
  first.data[0].raw.C1 = "MUTATED";
  first.data.push({ rawPeriod: "MUTATED" });

  const second = await query("L3A", "L4A");
  assert.equal(second.success, true);
  assert.deepEqual(
    second.data.map((row) => row.rawPeriod),
    ["2022", "2023", "2024"],
  );
  assert.equal(second.data[0].raw.C1, "L1");
  assert.equal(calls.length, 1);
});
test("wildcard and list selections retain all returned observations without scalar rejection", async () => {
  clearQueryCache();

  const wildcard = await query("*", "L4A");
  const list = await query("L3A,L3B", "L4A");

  assert.equal(wildcard.success, true);
  assert.equal(wildcard.validationLevel, "unverified");
  assert.equal(list.validationLevel, "unverified");
  assert.equal(list.success, true);
  const wildcardItem = await query("L3A", "L4A", { itemId: "*" });
  const listItem = await query("L3A", "L4A", { itemId: "ITEM,OTHER" });
  assert.deepEqual(
    wildcard.data.map((row) => row.raw.C3),
    ["L3B", "L3A"],
  );
  assert.deepEqual(
    list.data.map((row) => row.rawValue),
    ["72", "71"],
  );
  assert.equal(wildcardItem.success, true);
  assert.equal(listItem.success, true);
  assert.equal(wildcardItem.validationLevel, "unverified");
  assert.equal(listItem.validationLevel, "unverified");
});
test("plus-separated provider selectors are not mistaken for scalar codes", async () => {
  clearQueryCache();
  const dimensions = await query("L3A+L3B", "L4A");
  assert.equal(dimensions.success, true);
  assert.equal(dimensions.validationLevel, "unverified");
  assert.deepEqual(
    dimensions.data.map((row) => row.raw.C3),
    ["L3B", "L3A"],
  );
  assert.deepEqual(
    dimensions.data.map((row) => row.rawValue),
    ["82", "81"],
  );
  assert.equal(calls[0].searchParams.get("objL3"), "L3A+L3B");
  const items = await query("L3A", "L4A", { itemId: "ITEM+OTHER" });
  assert.equal(items.success, true);
  assert.equal(items.validationLevel, "unverified");
  assert.equal(calls.at(-1).searchParams.get("itmId"), "ITEM+OTHER");
  const scalar = await query("L3A", "L4A", { itemId: "OTHER" });
  assert.equal(scalar.success, false);
  assert.equal(scalar.errorCode, "response_mismatch");
});
test("empty bounded responses are incomplete and unverified", async () => {
  clearQueryCache();

  const result = await query("NO_ROWS", "L4A", {
    startPeriod: "2024",
    endPeriod: "2024",
  });

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "response_incomplete");
  assert.equal(result.validationLevel, "unverified");
  assert.deepEqual(result.data, []);
});
test("bounded monthly ranges require boundaries and contiguous observations per series", async () => {
  clearQueryCache();

  const complete = await query("L3A", "L4A", {
    tableId: "RANGE_COMPLETE",
    periodType: "M",
    startPeriod: "202401",
    endPeriod: "202403",
  });
  assert.equal(complete.success, true);
  assert.equal(complete.validationLevel, "verified");
  assert.equal(complete.metadata.validationLevel, "verified");
  assert.deepEqual(
    complete.data.map((row) => row.rawPeriod),
    ["202401", "202402", "202403"],
  );
  assert.equal(complete.unit, "명");

  for (const tableId of [
    "RANGE_MISSING_FEB",
    "RANGE_MISSING_BOUNDARY",
    "RANGE_SPLIT_SERIES",
  ]) {
    clearQueryCache();
    const result = await query("L3A", "L4A", {
      tableId,
      periodType: "M",
      objL2: tableId === "RANGE_SPLIT_SERIES" ? undefined : "L2",
      startPeriod: "202401",
      endPeriod: "202403",
    });
    assert.equal(result.success, false, tableId);
    assert.equal(result.errorCode, "response_incomplete", tableId);
    assert.equal(result.validationLevel, "unverified", tableId);
    assert.ok(result.data.length > 0, `${tableId} preserves returned evidence`);
  }

  clearQueryCache();
  const malformed = await query("L3A", "L4A", {
    tableId: "RANGE_MALFORMED",
    periodType: "M",
    recentCount: 1,
  });
  assert.equal(malformed.success, false);
  assert.equal(malformed.errorCode, "response_incomplete");
  assert.equal(malformed.validationLevel, "unverified");
  assert.equal(malformed.data[0].rawPeriod, "202413");
});

test("confirmed identity, scalar selection, and bounded-period mismatches fail closed", async () => {
  clearQueryCache();

  const tableMismatch = await query("L3A", "L4A", {
    tableId: "TABLE_MISMATCH",
  });
  const orgMismatch = await query("L3A", "L4A", { orgId: "999" });
  const periodMismatch = await query("L3A", "L4A", { periodType: "M" });
  const regionMismatch = await query("MISMATCH", "L4A");
  const mixedRegionMismatch = await query("MIXED", "L4A");
  const rangeMismatch = await query("L3A", "L4A", {
    startPeriod: "2023",
    endPeriod: "2024",
  });

  for (const result of [
    tableMismatch,
    orgMismatch,
    periodMismatch,
    regionMismatch,
    rangeMismatch,
    mixedRegionMismatch,
  ]) {
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "response_mismatch");
    assert.deepEqual(result.data, []);
    assert.equal(result.validationLevel, "unverified");
  }
});

test("missing output fields in unbounded responses remain unverified rather than fabricated", async () => {
  clearQueryCache();

  const original = fixtures["L3A|L4A"];
  fixtures["L3A|L4A"] = [
    makeRow({ UNIT_NM: "명", PRD_DE: "2024", DT: undefined }),
  ];
  const result = await query("L3A", "L4A");

  assert.equal(result.success, true);
  assert.equal(result.validationLevel, "unverified");
  assert.equal(result.data[0].rawValue, undefined);
  fixtures["L3A|L4A"] = original;
});

test("malformed and non-finite numeric values remain unchanged", () => {
  assert.equal(formatNumber("12abc"), "12abc");
  assert.equal(formatNumber("Infinity"), "Infinity");
  assert.equal(formatNumber("1e309"), "1e309");
  assert.equal(formatNumber("-12.50"), "-12.5");
});

test("one-sided period bounds remain observed but unproven and cannot continue", async () => {
  clearQueryCache();
  const result = await query("L3A", "L4A", {
    tableId: "RANGE_COMPLETE",
    periodType: "M",
    startPeriod: "202401",
  });
  assert.equal(result.success, true);
  assert.equal(result.completion, "unproven");
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
  assert.equal(result.aggregateRowCount, null);
});

test("finite cursor rejects tampering and a different original query", async () => {
  clearQueryCache();
  const first = await query("L3A", "L4A", {
    tableId: "RANGE_COMPLETE",
    periodType: "M",
    startPeriod: "202401",
    endPeriod: "202403",
    pageSize: 1,
  });
  assert.equal(first.success, true);
  assert.equal(first.hasMore, true);
  const tampered = await query("L3A", "L4A", {
    tableId: "RANGE_COMPLETE",
    periodType: "M",
    startPeriod: "202401",
    endPeriod: "202403",
    pageSize: 1,
    cursor: `${first.nextCursor}x`,
  });
  assert.equal(tampered.success, false);
  assert.equal(tampered.errorCode, "INVALID_CURSOR");
});
test("equivalent quarterly period spellings are one observation identity", async () => {
  clearQueryCache();
  const result = await query("L3A", "L4A", {
    tableId: "Q_EQUIVALENT",
    periodType: "Q",
    startPeriod: "2024Q1",
    endPeriod: "2024Q1",
  });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "response_incomplete");
  assert.equal(result.data.length, 2);
});
test.after(() => {
  globalThis.fetch = originalFetch;
  getCacheManager().flush();
});
