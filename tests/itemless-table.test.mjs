import assert from "node:assert/strict";
import test from "node:test";

process.env.KOSIS_API_KEY = "itemless-table-test-key";

const { getCacheManager } = await import("../dist/cache/index.js");
const { getStatisticsData, getStatisticsDataSchema } =
  await import("../dist/tools/getStatisticsData.js");

// Some published KOSIS tables expose no ITEM classification group at all.
// INH_DT_1K52F01_21 (Busan business counts by industry) is one: its getMeta
// ITM response only carries OBJ_ID "A" (region) and "B" (industry) rows.
// For those tables the caller has no valid itemId to send, and KOSIS itself
// accepts the request without itmId.
const ITEMLESS_ROW = {
  ORG_ID: "101",
  TBL_ID: "ITEMLESS",
  TBL_NM: "행정구역·산업별 사업체수",
  C1: "21",
  C1_NM: "부산",
  C1_OBJ_NM: "행정구역별",
  C2: "I",
  C2_NM: "숙박 및 음식점업",
  C2_OBJ_NM: "산업별",
  UNIT_NM: "개",
  PRD_SE: "Y",
  PRD_DE: "2024",
  DT: "45678",
};

const calls = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  calls.push(url);
  return new Response(JSON.stringify([ITEMLESS_ROW]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

test.after(() => {
  globalThis.fetch = originalFetch;
});

test("itemId is optional so item-less tables stay reachable", () => {
  const parsed = getStatisticsDataSchema.inputSchema.safeParse({
    orgId: "101",
    tableId: "ITEMLESS",
    objL1: "21",
    objL2: "I",
    periodType: "Y",
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.itemId, undefined);
});

test("omitting itemId sends no itmId parameter to KOSIS", async () => {
  getCacheManager().flush();
  calls.length = 0;

  const result = await getStatisticsData({
    orgId: "101",
    tableId: "ITEMLESS",
    objL1: "21",
    objL2: "I",
    periodType: "Y",
    startPeriod: "2024",
    endPeriod: "2024",
  });

  assert.equal(result.success, true);
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].rawValue, "45678");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.has("itmId"), false);
  assert.equal(calls[0].searchParams.get("objL1"), "21");
  assert.equal(calls[0].searchParams.get("objL2"), "I");
});

test("an explicit itemId is still forwarded unchanged", async () => {
  getCacheManager().flush();
  calls.length = 0;

  const result = await getStatisticsData({
    orgId: "101",
    tableId: "ITEMLESS",
    objL1: "21",
    objL2: "I",
    itemId: "T10",
    periodType: "Y",
    startPeriod: "2024",
    endPeriod: "2024",
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("itmId"), "T10");
});

test("presence and absence of itemId are separate cache identities", async () => {
  getCacheManager().flush();
  calls.length = 0;

  const base = {
    orgId: "101",
    tableId: "ITEMLESS",
    objL1: "21",
    objL2: "I",
    periodType: "Y",
    startPeriod: "2024",
    endPeriod: "2024",
  };

  await getStatisticsData(base);
  await getStatisticsData({ ...base, itemId: "T10" });
  await getStatisticsData(base);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].searchParams.has("itmId"), false);
  assert.equal(calls[1].searchParams.get("itmId"), "T10");
});

test("analyze_time_series also accepts item-less tables", async () => {
  const { analyzeTimeSeriesSchema } =
    await import("../dist/tools/analyzeTimeSeries.js");

  const parsed = analyzeTimeSeriesSchema.inputSchema.safeParse({
    orgId: "101",
    tableId: "ITEMLESS",
    objL1: "21",
    objL2: "I",
    periodType: "Y",
  });

  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.itemId, undefined);
});

// 스키마만 통과하고 실행에서 막히는 경우를 잡으려면 analyzeTimeSeries 를 실제로 돌려야 한다.
const seriesRows = (rows) => {
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    calls.push(url);
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
};
const itemlessYear = (year, value) => ({
  ...ITEMLESS_ROW,
  PRD_DE: year,
  DT: value,
});
const seriesQuery = {
  orgId: "101",
  tableId: "ITEMLESS",
  objL1: "21",
  objL2: "I",
  periodType: "Y",
  startPeriod: "2022",
  endPeriod: "2024",
};

test("analyze_time_series analyses an item-less table when itemId is omitted", async () => {
  const { analyzeTimeSeries } =
    await import("../dist/tools/analyzeTimeSeries.js");
  getCacheManager().flush();
  calls.length = 0;
  seriesRows([
    itemlessYear("2022", "40000"),
    itemlessYear("2023", "42000"),
    itemlessYear("2024", "45678"),
  ]);

  const result = await analyzeTimeSeries(seriesQuery);

  assert.equal(result.success, true, JSON.stringify(result.errorCode));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.has("itmId"), false);
});

test("analyze_time_series still rejects a missing item identity when itemId was requested", async () => {
  const { analyzeTimeSeries } =
    await import("../dist/tools/analyzeTimeSeries.js");
  getCacheManager().flush();
  seriesRows([
    itemlessYear("2022", "40000"),
    itemlessYear("2023", "42000"),
    itemlessYear("2024", "45678"),
  ]);

  const result = await analyzeTimeSeries({ ...seriesQuery, itemId: "T10" });

  assert.equal(result.success, false);
});

test("analyze_time_series rejects item-less rows mixed with itemised rows", async () => {
  const { analyzeTimeSeries } =
    await import("../dist/tools/analyzeTimeSeries.js");
  getCacheManager().flush();
  seriesRows([
    itemlessYear("2022", "40000"),
    { ...itemlessYear("2023", "42000"), ITM_ID: "T10", ITM_NM: "사업체수" },
    itemlessYear("2024", "45678"),
  ]);

  const result = await analyzeTimeSeries(seriesQuery);

  assert.equal(result.success, false);
});
