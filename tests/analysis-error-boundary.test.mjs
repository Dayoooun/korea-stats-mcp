import assert from "node:assert/strict";
import test, { beforeEach, afterEach } from "node:test";
import { inspect } from "node:util";

const originalApiKey = process.env.KOSIS_API_KEY;
process.env.KOSIS_API_KEY = "analysis-error-boundary-test-key";

const { getKosisClient } = await import("../dist/api/client.js");
const { getCacheManager } = await import("../dist/cache/index.js");
const { analyzeTimeSeries } =
  await import("../dist/tools/analyzeTimeSeries.js");
const { compareStatistics } =
  await import("../dist/tools/compareStatistics.js");
const { collectStatisticsPages } =
  await import("../dist/tools/statisticsRetrieval.js");
const { getStatisticsData } =
  await import("../dist/tools/getStatisticsData.js");
if (originalApiKey === undefined) delete process.env.KOSIS_API_KEY;
else process.env.KOSIS_API_KEY = originalApiKey;

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error("Upstream network is disabled in this offline fixture");
  };
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function capturedText(calls) {
  return inspect(calls, { depth: 8, getters: false, customInspect: false });
}

const SENTINEL =
  "credential header cookie auth-URL authURL private-data query research-query apiKey Authorization";

function input(overrides = {}) {
  return {
    orgId: "101",
    tableId: "ERROR_BOUNDARY",
    objL1: "ALL",
    itemId: "ALL",
    periodType: "Y",
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

function hostileCodeError(code = "UNKNOWN_PRIVATE_CODE") {
  return {
    get code() {
      if (code === "THROWING_CODE") throw new Error(SENTINEL);
      return code;
    },
    message: SENTINEL,
    toString() {
      throw new Error(SENTINEL);
    },
  };
}

function captureConsole() {
  const calls = [];
  const originals = new Map();
  for (const name of ["error", "warn", "log"]) {
    originals.set(name, console[name]);
    console[name] = (...args) => calls.push(args);
  }
  return {
    calls,
    restore() {
      for (const [name, original] of originals) console[name] = original;
    },
  };
}

function assertSafe(value) {
  assert.equal(JSON.stringify(value).includes(SENTINEL), false);
}

test("get_statistics_data projects hostile unknown errors without retries or leakage", async () => {
  const client = getKosisClient();
  const cache = getCacheManager();
  const captured = captureConsole();
  let calls = 0;
  const restore = replaceMethod(client, "getStatisticsData", async () => {
    calls += 1;
    throw hostileCodeError("THROWING_CODE");
  });
  cache.flush();
  try {
    const result = await getStatisticsData(
      input({ startPeriod: "2022", endPeriod: "2024" }),
    );
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "DATA_ERROR");
    assert.equal(result.data.length, 0);
    assert.equal(calls, 1);
    assertSafe(result);
    assert.equal(capturedText(captured.calls).includes(SENTINEL), false);
  } finally {
    restore();
    cache.flush();
    captured.restore();
  }
});

test("recognized provider codes remain bounded and meaningful", async () => {
  const client = getKosisClient();
  const cache = getCacheManager();
  const captured = captureConsole();
  let calls = 0;
  const restore = replaceMethod(client, "getStatisticsData", async () => {
    calls += 1;
    throw Object.assign(new Error(SENTINEL), { code: "NETWORK_ERROR" });
  });
  cache.flush();
  try {
    const result = await getStatisticsData(input({ recentCount: 2 }));
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "NETWORK_ERROR");
    assert.equal(result.errorMessage, "네트워크 연결을 확인해주세요.");
    assert.equal(calls, 1);
    assertSafe(result);
    assert.equal(capturedText(captured.calls).includes(SENTINEL), false);
  } finally {
    restore();
    cache.flush();
    captured.restore();
  }
});

test("analysis and comparison preserve collection fallback codes and do not calculate", async () => {
  const client = getKosisClient();
  const cache = getCacheManager();
  const captured = captureConsole();
  let calls = 0;
  const restore = replaceMethod(client, "getStatisticsData", async () => {
    calls += 1;
    throw hostileCodeError("THROWING_CODE");
  });
  cache.flush();
  try {
    const series = await analyzeTimeSeries(input({ yearCount: 2 }));
    assert.equal(series.success, false);
    assert.equal(series.errorCode, "DATA_ERROR");
    assert.equal(series.analysis, undefined);
    assert.equal(series.dataPoints.length, 0);
    assertSafe(series);
    assert.equal(calls, 1);

    cache.flush();
    const comparison = await compareStatistics(
      input({ compareType: "period", periods: ["2022", "2023"] }),
    );
    assert.equal(comparison.success, false);
    assert.equal(comparison.errorCode, "DATA_ERROR");
    assert.equal(comparison.items.length, 0);
    assertSafe(comparison);
    assert.equal(calls, 2);

    cache.flush();
    const collected = await collectStatisticsPages(
      input({ startPeriod: "2022", endPeriod: "2022" }),
    );
    assert.equal(collected.success, false);
    assert.equal(collected.errorCode, "DATA_ERROR");
    assert.equal(collected.rows.length, 0);
    assert.equal(calls, 3);
    assertSafe(collected);
    assert.equal(capturedText(captured.calls).includes(SENTINEL), false);
  } finally {
    restore();
    cache.flush();
    captured.restore();
  }
});

test("response-too-large keeps bounded finite traversal behavior", async () => {
  const client = getKosisClient();
  const cache = getCacheManager();
  const captured = captureConsole();
  let calls = 0;
  const restore = replaceMethod(client, "getStatisticsData", async () => {
    calls += 1;
    throw Object.assign(new Error(SENTINEL), {
      code: "RESPONSE_TOO_LARGE",
    });
  });
  cache.flush();
  try {
    let result = await getStatisticsData(
      input({ startPeriod: "2022", endPeriod: "2024" }),
    );
    assert.equal(result.success, true);
    assert.equal(result.hasMore, true);
    assert.equal(typeof result.nextCursor, "string");
    while (result.hasMore) {
      result = await getStatisticsData(
        input({
          startPeriod: "2022",
          endPeriod: "2024",
          cursor: result.nextCursor,
        }),
      );
    }
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "ATOMIC_PERIOD_TOO_LARGE");
    assert.match(result.errorMessage, /원자적 기간/);
    assert.equal(calls, 3);
    assertSafe(result);
    assert.equal(capturedText(captured.calls).includes(SENTINEL), false);
  } finally {
    restore();
    cache.flush();
    captured.restore();
  }
});
