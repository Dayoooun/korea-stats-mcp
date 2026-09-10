import assert from "node:assert/strict";
import test from "node:test";

const { getKosisClient } = await import("../dist/api/client.js");
const { getCacheManager } = await import("../dist/cache/index.js");
const { searchStatistics } = await import("../dist/tools/searchStatistics.js");
const { getRecommendedStats } =
  await import("../dist/tools/getRecommendedStats.js");
const { ErrorCode, getErrorMessage, handleToolError } =
  await import("../dist/utils/errorHandler.js");

const SENTINEL =
  "apiKey Authorization cookie authURL private-data research-query";

function discoveryRow(overrides = {}) {
  return {
    ORG_ID: "101",
    ORG_NM: "통계청",
    TBL_ID: "DT_1B04005",
    TBL_NM: "시도별 주민등록인구",
    STAT_NM: "주민등록인구현황",
    STRT_PRD_DE: "2020",
    END_PRD_DE: "2024",
    VW_CD: "MT_ZTITLE",
    ...overrides,
  };
}

function replaceMethod(object, name, replacement) {
  const original = object[name];
  object[name] = replacement;
  return () => {
    object[name] = original;
  };
}

function captureConsoleErrors() {
  const calls = [];
  const original = console.error;
  console.error = (...args) => calls.push(args);
  return {
    calls,
    restore: () => {
      console.error = original;
    },
  };
}

test("search discovery treats VW_CD view IDs as unknown period type", async () => {
  const client = getKosisClient();
  const cache = getCacheManager();
  cache.flush();
  let calls = 0;
  const restoreSearch = replaceMethod(client, "searchStatistics", async () => {
    calls += 1;
    return [discoveryRow()];
  });
  try {
    const result = await searchStatistics({
      query: "인구",
      limit: 1,
      sort: "RANK",
    });
    assert.equal(result.success, true);
    assert.equal(calls, 1);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].tableId, "DT_1B04005");
    assert.equal(result.results[0].period, "2020~2024");
    assert.equal(result.results[0].periodType, "");
    assert.equal("lastUpdated" in result.results[0], false);
  } finally {
    restoreSearch();
    cache.flush();
  }
});

test("recommendation fallback retains coverage and does not fetch PRD data", async () => {
  const client = getKosisClient();
  const cache = getCacheManager();
  cache.flush();
  let searchCalls = 0;
  let dataCalls = 0;
  const restoreSearch = replaceMethod(client, "searchStatistics", async () => {
    searchCalls += 1;
    return [
      discoveryRow({
        TBL_ID: `DISCOVERY_${searchCalls}`,
        TBL_NM: `보충 통계 ${searchCalls}`,
      }),
    ];
  });
  const restoreData = replaceMethod(client, "getStatisticsData", async () => {
    dataCalls += 1;
    throw new Error("recommendation must not fetch data");
  });
  let metadataCalls = 0;
  const restoreMetadata = replaceMethod(client, "getTableMeta", async () => {
    metadataCalls += 1;
    throw new Error("recommendation must not fetch PRD metadata");
  });
  try {
    const result = await getRecommendedStats({ topic: "population", limit: 6 });
    assert.equal(result.success, true);
    assert.equal(result.recommendations.length, 6);
    assert.equal(searchCalls, 2);
    assert.equal(dataCalls, 0);
    assert.equal(metadataCalls, 0);
    const fallback = result.recommendations.slice(5);
    assert.equal(fallback.length, 1);
    assert.equal(fallback[0].period, "2020~2024");
    assert.equal(fallback[0].periodType, "");
    assert.equal("lastUpdated" in fallback[0], false);
    assert.equal(fallback[0].tableId, "DISCOVERY_1");
  } finally {
    restoreData();
    restoreSearch();
    restoreMetadata();
    cache.flush();
  }
});

test("discovery catches return safe projected failures without raw logging", async () => {
  const client = getKosisClient();
  const cache = getCacheManager();
  cache.flush();
  const captured = captureConsoleErrors();
  const error = Object.assign(new Error(SENTINEL), { code: "NETWORK_ERROR" });
  const restoreSearch = replaceMethod(client, "searchStatistics", async () => {
    throw error;
  });
  try {
    const searchResult = await searchStatistics({
      query: "인구",
      limit: 1,
      sort: "RANK",
    });
    assert.equal(searchResult.success, false);
    assert.equal(searchResult.code, ErrorCode.NETWORK_ERROR);
    assert.equal(searchResult.error, getErrorMessage(ErrorCode.NETWORK_ERROR));
    assert.equal(JSON.stringify(searchResult).includes(SENTINEL), false);

    const recommendationResult = await getRecommendedStats({
      topic: "population",
      limit: 6,
    });
    assert.equal(recommendationResult.success, false);
    assert.equal(recommendationResult.code, ErrorCode.NETWORK_ERROR);
    assert.equal(
      JSON.stringify(recommendationResult).includes(SENTINEL),
      false,
    );
    assert.deepEqual(captured.calls, []);
  } finally {
    restoreSearch();
    captured.restore();
    cache.flush();
  }
});

test("handleToolError bounds codes and survives hostile inputs", () => {
  const captured = captureConsoleErrors();
  try {
    const known = handleToolError(
      Object.assign(new Error(SENTINEL), { code: "NETWORK_ERROR" }),
    );
    assert.deepEqual(known, {
      success: false,
      error: getErrorMessage(ErrorCode.NETWORK_ERROR),
      code: ErrorCode.NETWORK_ERROR,
    });
    for (const code of [
      ErrorCode.TIMEOUT,
      ErrorCode.HTTP_ERROR,
      ErrorCode.RESPONSE_TOO_LARGE,
      ErrorCode.METADATA_TOO_LARGE,
      ErrorCode.INVALID_RESPONSE,
      ErrorCode.INVALID_INPUT,
      ErrorCode.API_ERROR,
    ]) {
      assert.notEqual(
        getErrorMessage(code),
        getErrorMessage(ErrorCode.UNKNOWN_ERROR),
      );
    }

    const numeric = handleToolError(
      Object.assign(new Error(SENTINEL), { code: 20 }),
    );
    assert.equal(numeric.code, "20");
    assert.equal(numeric.error, getErrorMessage(ErrorCode.UNKNOWN_ERROR));

    const unknown = handleToolError(
      Object.assign(new Error(SENTINEL), { code: SENTINEL }),
    );
    assert.equal(unknown.code, ErrorCode.UNKNOWN_ERROR);
    assert.equal(unknown.error, getErrorMessage(ErrorCode.UNKNOWN_ERROR));

    let getterCalls = 0;
    const getterError = {};
    Object.defineProperty(getterError, "code", {
      configurable: true,
      get() {
        getterCalls += 1;
        return "NETWORK_ERROR";
      },
    });
    const getterResult = handleToolError(getterError);
    assert.equal(getterCalls, 0);
    assert.equal(getterResult.code, ErrorCode.UNKNOWN_ERROR);
    assert.doesNotThrow(() =>
      handleToolError({
        get code() {
          throw new Error(SENTINEL);
        },
        message: SENTINEL,
      }),
    );
    assert.doesNotThrow(() =>
      handleToolError(
        new Proxy(
          {},
          {
            get() {
              throw new Error(SENTINEL);
            },
          },
        ),
      ),
    );
    assert.equal(
      getErrorMessage("toString"),
      getErrorMessage(ErrorCode.UNKNOWN_ERROR),
    );
    assert.equal(getErrorMessage(20), getErrorMessage(ErrorCode.UNKNOWN_ERROR));
    assert.equal(JSON.stringify(known).includes(SENTINEL), false);
    assert.deepEqual(captured.calls, []);
  } finally {
    captured.restore();
  }
});
