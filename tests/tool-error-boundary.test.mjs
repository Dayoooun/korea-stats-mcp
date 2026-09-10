import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";

const originalApiKey = process.env.KOSIS_API_KEY;
process.env.KOSIS_API_KEY = "tool-error-boundary-test-key";

const { getKosisClient } = await import("../dist/api/client.js");
const { getCacheManager } = await import("../dist/cache/index.js");
const { getStatisticsList } =
  await import("../dist/tools/getStatisticsList.js");
const { getTableInfo } = await import("../dist/tools/getTableInfo.js");
const { quickStats } = await import("../dist/tools/quickStats.js");
const { quickTrend } = await import("../dist/tools/quickTrend.js");
if (originalApiKey === undefined) delete process.env.KOSIS_API_KEY;
else process.env.KOSIS_API_KEY = originalApiKey;

const markers = [
  "apiKey=tool-boundary-api-key",
  "Authorization: Bearer tool-boundary-token",
  "cookie=tool-boundary-cookie",
  "https://auth.example.invalid/tool-boundary",
  "private-data=tool-boundary-private",
  "query=tool-boundary-query",
];
const markerText = markers.join(" | ");

function hostileError(code = "NETWORK_ERROR") {
  const error = new Error(`unexpected provider failure: ${markerText}`);
  error.code = code;
  error.cause = {
    message: markerText,
    stack: `Error: ${markerText}`,
    code: `cause-${markerText}`,
  };
  return error;
}

function proxyError(onRead) {
  const target = { code: "NETWORK_ERROR" };
  return new Proxy(target, {
    get(object, property, receiver) {
      if (property === "code") {
        onRead();
        throw new Error(`getter failure: ${markerText}`);
      }
      return Reflect.get(object, property, receiver);
    },
  });
}

async function withClientFailure(method, invoke, makeError = hostileError) {
  const client = getKosisClient();
  const cache = getCacheManager();
  const originalMethod = client[method];
  const hadOwnMethod = Object.prototype.hasOwnProperty.call(client, method);
  const originalFetch = globalThis.fetch;
  const capturedConsole = [];
  const originalConsole = {
    error: console.error,
    warn: console.warn,
    log: console.log,
    info: console.info,
    debug: console.debug,
  };
  for (const name of Object.keys(originalConsole)) {
    console[name] = (...args) => capturedConsole.push(args);
  }

  let methodCalls = 0;
  try {
    globalThis.fetch = async () => {
      throw new Error(
        "Unmocked metadata fetch is blocked in this offline fixture",
      );
    };
    client[method] = async () => {
      methodCalls += 1;
      throw makeError();
    };
    cache.flush();
    const result = await invoke();
    return { result, capturedConsole, methodCalls };
  } finally {
    if (hadOwnMethod) client[method] = originalMethod;
    else delete client[method];
    globalThis.fetch = originalFetch;
    cache.flush();
    for (const [name, original] of Object.entries(originalConsole)) {
      console[name] = original;
    }
  }
}

function assertClean(result, capturedConsole) {
  const serializedResult = JSON.stringify(result);
  const serializedConsole = inspect(capturedConsole, {
    depth: 8,
    getters: false,
    customInspect: false,
  });
  assert.ok(serializedResult);
  for (const marker of markers) {
    assert.equal(
      serializedResult.includes(marker),
      false,
      `result leaked ${marker}`,
    );
    assert.equal(
      serializedConsole.includes(marker),
      false,
      `console leaked ${marker}`,
    );
  }
}

test("each catalogue/locality tool catch fails closed with a stable network error", async () => {
  const cases = [
    {
      method: "getStatisticsList",
      invoke: () =>
        getStatisticsList({ viewCode: "MT_ZTITLE", parentId: "boundary-list" }),
      expected: (result) => {
        assert.equal(result.success, false);
        assert.equal(result.code, "NETWORK_ERROR");
        assert.equal(result.error, "네트워크 연결을 확인해주세요.");
      },
    },
    {
      method: "getTableMeta",
      invoke: () =>
        getTableInfo({
          orgId: "101",
          tableId: "boundary-table",
          infoType: "ITM",
        }),
      expected: (result) => {
        assert.equal(result.success, false);
        assert.equal(result.errorCode, "NETWORK_ERROR");
        assert.equal(result.errorMessage, "네트워크 연결을 확인해주세요.");
      },
    },
    {
      method: "getStatisticsData",
      invoke: () => quickStats({ query: "실업률" }),
      expected: (result) => {
        assert.equal(result.success, false);
        assert.equal(result.code, "NETWORK_ERROR");
        assert.equal(result.error, "네트워크 연결을 확인해주세요.");
        assert.match(result.answer, /네트워크 연결/);
      },
    },
    {
      method: "getStatisticsData",
      invoke: () => quickTrend({ keyword: "실업률", yearCount: 2 }),
      expected: (result) => {
        assert.equal(result.success, false);
        assert.equal(result.code, "NETWORK_ERROR");
        assert.equal(result.error, "네트워크 연결을 확인해주세요.");
        assert.match(result.summary, /네트워크 연결/);
        assert.equal(result.trend, "deferred");
        assert.deepEqual(result.dataPoints, []);
        assert.deepEqual(result.insights, []);
      },
    },
  ];

  for (const { method, invoke, expected } of cases) {
    const { result, capturedConsole, methodCalls } = await withClientFailure(
      method,
      invoke,
    );
    expected(result);
    assertClean(result, capturedConsole);
    assert.equal(methodCalls, 1, "failed tool request must not be retried");
  }
});

test("descriptor lookup bypasses a throwing proxy getter and retains a safe code", async () => {
  let getterCalls = 0;
  const { result, capturedConsole } = await withClientFailure(
    "getStatisticsData",
    () => quickStats({ query: "실업률" }),
    () =>
      proxyError(() => {
        getterCalls += 1;
      }),
  );
  assert.equal(result.success, false);
  assert.equal(result.code, "NETWORK_ERROR");
  assert.equal(result.error, "네트워크 연결을 확인해주세요.");
  assert.equal(getterCalls, 0);
  assertClean(result, capturedConsole);
});
test("unknown error codes are replaced with the bounded fallback", async () => {
  const { result, capturedConsole } = await withClientFailure(
    "getStatisticsList",
    () =>
      getStatisticsList({ viewCode: "MT_ZTITLE", parentId: "boundary-list" }),
    () => hostileError(markerText),
  );
  assert.equal(result.success, false);
  assert.equal(result.code, "UNKNOWN_ERROR");
  assert.equal(result.error, "알 수 없는 오류가 발생했습니다.");
  assertClean(result, capturedConsole);
});
test("known missing-key guidance stays bounded and does not expose the key", async () => {
  const { result, capturedConsole } = await withClientFailure(
    "getTableMeta",
    () =>
      getTableInfo({
        orgId: "101",
        tableId: "boundary-table",
        infoType: "ITM",
      }),
    () => hostileError("INVALID_API_KEY"),
  );
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "INVALID_API_KEY");
  assert.match(result.errorMessage, /서버 운영자/);
  assert.match(result.usageHint, /KOSIS_API_KEY 설정/);
  assertClean(result, capturedConsole);
});

test("explicit region metadata failure stays unverified without a national fallback", async () => {
  const { result, capturedConsole } = await withClientFailure(
    "getTableMeta",
    () => quickStats({ query: "인구", region: "부산 동래구" }),
  );
  assert.equal(result.success, false);
  assert.equal(result.validationLevel, "unverified");
  assert.equal(result.source, undefined);
  assert.match(result.note, /지역/);
  assertClean(result, capturedConsole);
});

test("region text in a query stays unverified when metadata cannot be observed", async () => {
  const { result, capturedConsole } = await withClientFailure(
    "getTableMeta",
    () => quickStats({ query: "부산 동래구 인구" }),
  );
  assert.equal(result.success, false);
  assert.equal(result.validationLevel, "unverified");
  assert.equal(result.source, undefined);
  assert.match(result.note, /지역/);
  assertClean(result, capturedConsole);
});

test("catalogue success remains unchanged when the client returns a normal row", async () => {
  const client = getKosisClient();
  const cache = getCacheManager();
  const originalMethod = client.getStatisticsList;
  const hadOwnMethod = Object.prototype.hasOwnProperty.call(
    client,
    "getStatisticsList",
  );
  const originalFetch = globalThis.fetch;
  try {
    client.getStatisticsList = async () => [
      { ORG_ID: "101", TBL_ID: "T-OK", TBL_NM: "공개 통계" },
    ];
    globalThis.fetch = originalFetch;
    cache.flush();
    const result = await getStatisticsList({
      viewCode: "MT_ZTITLE",
      parentId: "",
    });
    assert.equal(result.success, true);
    assert.equal(result.items[0].id, "T-OK");
    assert.equal(result.items[0].name, "공개 통계");
  } finally {
    if (hadOwnMethod) client.getStatisticsList = originalMethod;
    else delete client.getStatisticsList;
    globalThis.fetch = originalFetch;
    cache.flush();
  }
});
