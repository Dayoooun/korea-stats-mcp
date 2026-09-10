import assert from "node:assert/strict";
import test from "node:test";

process.env.KOSIS_API_KEY = "statistics-transport-test-key";

const { KosisApiError, KosisClient } = await import("../dist/api/client.js");
const { setOperationalEventSink } =
  await import("../dist/utils/operationalEvents.js");

const originalFetch = globalThis.fetch;
const encoder = new TextEncoder();
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function streamedResponse(chunks, contentLength) {
  let index = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  const headers = new Headers();
  if (contentLength !== undefined)
    headers.set("content-length", String(contentLength));
  return {
    ok: true,
    status: 200,
    headers,
    body,
    wasCancelled: () => cancelled,
  };
}

function statisticsParams() {
  return {
    orgId: "ORG",
    tblId: "TABLE",
    objL1: "L1",
    objL2: "L2",
    objL3: "L3",
    objL4: "L4",
    objL5: "L5",
    objL6: "L6",
    objL7: "L7",
    objL8: "L8",
    itmId: "ITEM",
    prdSe: "Y",
    startPrdDe: "2020",
    endPrdDe: "2024",
    newEstPrdCnt: 5,
  };
}
const transportOperations = [
  {
    name: "getStatisticsList",
    invoke: (client) => client.getStatisticsList("VIEW", "PARENT"),
  },
  {
    name: "searchStatistics",
    invoke: (client) =>
      client.searchStatistics("search-term", { orgId: "ORG" }),
  },
  {
    name: "getStatisticsExplain",
    invoke: (client) => client.getStatisticsExplain("STAT", "statsNm+josaItm"),
  },
];

function advertisedOverflowResponse() {
  let bodyRead = false;
  let bodyCancelled = false;
  return {
    response: {
      ok: true,
      status: 200,
      headers: new Headers({
        "content-length": String(MAX_RESPONSE_BYTES + 1),
      }),
      body: {
        async cancel() {
          bodyCancelled = true;
        },
        getReader() {
          bodyRead = true;
          throw new Error("body must not be read after advertised overflow");
        },
      },
      async json() {
        throw new Error("json must not be used after advertised overflow");
      },
    },
    wasRead: () => bodyRead,
    wasCancelled: () => bodyCancelled,
  };
}

function assertSafeTransportError(error, code, message) {
  assert.ok(error instanceof KosisApiError);
  assert.equal(error.code, code);
  assert.equal(error.message, message);
  assert.doesNotMatch(
    error.message,
    /statistics-transport-test-key|apiKey|ORG|TABLE|STAT/,
  );
}

test.after(() => {
  globalThis.fetch = originalFetch;
});
test("getStatisticsExplain sends the documented survey-definition request", async () => {
  const rows = [
    {
      statsNm: "조사명",
      josaItm: "조사항목",
      goalPoplExmnPopl: "목표모집단 및 조사모집단",
      estEqua: "추정산식",
      examinObjrange: "조사 대상범위",
      examinObjArea: "조사 대상지역",
      examinTrgetPd: "조사대상기간",
      statsPeriod: "조사주기",
      pubPeriod: "공표주기",
      mainTermExpl: "주요용어해설",
      dataUserNote: "자료이용시 유의사항",
    },
  ];
  let requestedUrl;
  globalThis.fetch = async (input) => {
    requestedUrl = new URL(String(input));
    const payload = encoder.encode(JSON.stringify(rows));
    return streamedResponse([payload], payload.byteLength);
  };

  const result = await new KosisClient(
    "statistics-transport-test-key",
  ).getStatisticsExplain("STAT", "statsNm+josaItm");

  assert.deepEqual(result, rows);
  assert.equal(requestedUrl.pathname, "/openapi/statisticsExplData.do");
  assert.equal(requestedUrl.searchParams.get("method"), "getList");
  assert.equal(requestedUrl.searchParams.get("statId"), "STAT");
  assert.equal(requestedUrl.searchParams.get("metaItm"), "statsNm josaItm");
  assert.equal(requestedUrl.searchParams.get("jsonVD"), "Y");
  assert.equal(requestedUrl.searchParams.get("jsonMVD"), "Y");
  assert.equal(requestedUrl.searchParams.has("orgId"), false);
  assert.equal(requestedUrl.searchParams.has("tblId"), false);
});
test("getStatisticsExplain preserves the all-caps selection", async () => {
  let requestedUrl;
  globalThis.fetch = async (input) => {
    requestedUrl = new URL(String(input));
    const payload = encoder.encode("[]");
    return streamedResponse([payload], payload.byteLength);
  };

  try {
    await new KosisClient("statistics-transport-test-key").getStatisticsExplain(
      "STAT",
      "ALL",
    );
    assert.equal(requestedUrl.searchParams.get("metaItm"), "ALL");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getTableMeta accepts the documented CMMT table/item-note type", async () => {
  const rows = [{ CMMT: "통계표 주석" }];
  let requestedUrl;
  globalThis.fetch = async (input) => {
    requestedUrl = new URL(String(input));
    const payload = encoder.encode(JSON.stringify(rows));
    return streamedResponse([payload], payload.byteLength);
  };

  const result = await new KosisClient(
    "statistics-transport-test-key",
  ).getTableMeta("ORG", "TABLE", "CMMT");

  assert.deepEqual(result, rows);
  assert.equal(requestedUrl.pathname, "/openapi/statisticsData.do");
  assert.equal(requestedUrl.searchParams.get("method"), "getMeta");
  assert.equal(requestedUrl.searchParams.get("type"), "CMMT");
  assert.equal(requestedUrl.searchParams.get("orgId"), "ORG");
  assert.equal(requestedUrl.searchParams.get("tblId"), "TABLE");
});

test("getStatisticsExplain rejects an unknown response envelope", async () => {
  const payload = encoder.encode(JSON.stringify({ unexpected: [] }));
  globalThis.fetch = async () =>
    streamedResponse([payload], payload.byteLength);

  await assert.rejects(
    () =>
      new KosisClient("statistics-transport-test-key").getStatisticsExplain(
        "STAT",
        "ALL",
      ),
    (error) => {
      assertSafeTransportError(
        error,
        "INVALID_RESPONSE",
        "KOSIS 응답 형식이 올바르지 않습니다.",
      );
      return true;
    },
  );
});

test("getStatisticsData returns valid streamed rows and preserves every selector", async () => {
  const rows = [
    { C1: "2024", D1: "100" },
    { C1: "2023", D1: "90" },
  ];
  let requestedUrl;
  globalThis.fetch = async (input) => {
    requestedUrl = new URL(String(input));
    const encoded = encoder.encode(JSON.stringify(rows));
    return streamedResponse([encoded], encoded.byteLength);
  };

  const result = await new KosisClient(
    "statistics-transport-test-key",
  ).getStatisticsData(statisticsParams());

  assert.deepEqual(result, rows);
  for (const [key, value] of Object.entries(statisticsParams())) {
    assert.equal(requestedUrl.searchParams.get(key), String(value));
  }
  assert.equal(requestedUrl.searchParams.get("method"), "getList");
  assert.equal(requestedUrl.searchParams.get("jsonVD"), "Y");
  assert.equal(
    requestedUrl.searchParams.get("apiKey"),
    "statistics-transport-test-key",
  );
});

test("getStatisticsData rejects an advertised response larger than 4MiB before reading it", async () => {
  let bodyRead = false;
  let bodyCancelled = false;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-length": String(MAX_RESPONSE_BYTES + 1) }),
    body: {
      async cancel() {
        bodyCancelled = true;
      },
      getReader() {
        bodyRead = true;
        throw new Error("body must not be read after advertised overflow");
      },
    },
    async json() {
      throw new Error("json must not be used after advertised overflow");
    },
  });

  await assert.rejects(
    () =>
      new KosisClient("statistics-transport-test-key").getStatisticsData(
        statisticsParams(),
      ),
    (error) => {
      assertSafeTransportError(
        error,
        "RESPONSE_TOO_LARGE",
        "KOSIS 응답이 허용된 크기를 초과했습니다. 조회 범위를 좁혀 다시 시도해주세요.",
      );
      return true;
    },
  );
  assert.equal(bodyRead, false);
  assert.equal(bodyCancelled, true);
});

test("getStatisticsData rejects streamed overflow without returning partial rows", async () => {
  const first = new Uint8Array(MAX_RESPONSE_BYTES);
  first.fill(0x20);
  const response = streamedResponse([
    first,
    Uint8Array.of(0x20),
    Uint8Array.of(0x20),
  ]);
  globalThis.fetch = async () => response;

  await assert.rejects(
    () =>
      new KosisClient("statistics-transport-test-key").getStatisticsData(
        statisticsParams(),
      ),
    (error) => {
      assertSafeTransportError(
        error,
        "RESPONSE_TOO_LARGE",
        "KOSIS 응답이 허용된 크기를 초과했습니다. 조회 범위를 좁혀 다시 시도해주세요.",
      );
      return true;
    },
  );
  assert.equal(response.wasCancelled(), true);
});

test("getStatisticsData maps bounded malformed JSON to a nonsecret invalid-response error", async () => {
  const malformed = encoder.encode('{"rows": [');
  globalThis.fetch = async () => streamedResponse([malformed]);

  await assert.rejects(
    () =>
      new KosisClient("statistics-transport-test-key").getStatisticsData(
        statisticsParams(),
      ),
    (error) => {
      assertSafeTransportError(
        error,
        "INVALID_RESPONSE",
        "KOSIS 응답 형식이 올바르지 않습니다.",
      );
      return true;
    },
  );
});
test("list, search, and explanation reject malformed bounded JSON without leaking credentials", async () => {
  const malformed = encoder.encode('{"result": [');
  try {
    for (const operation of transportOperations) {
      globalThis.fetch = async () => streamedResponse([malformed]);
      await assert.rejects(
        () =>
          operation.invoke(new KosisClient("statistics-transport-test-key")),
        (error) => {
          assertSafeTransportError(
            error,
            "INVALID_RESPONSE",
            "KOSIS 응답 형식이 올바르지 않습니다.",
          );
          return true;
        },
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("list, search, and explanation return recognized structured envelopes", async () => {
  const rowsByOperation = [
    [{ VW_CD: "VIEW", LIST_ID: "TABLE" }],
    [{ TBL_ID: "TABLE", TBL_NM: "검색 결과" }],
    [{ statsNm: "설명", josaItm: "조사항목" }],
  ];
  try {
    for (const [index, operation] of transportOperations.entries()) {
      const payload = encoder.encode(
        JSON.stringify({ result: rowsByOperation[index] }),
      );
      globalThis.fetch = async () =>
        streamedResponse([payload], payload.byteLength);
      const result = await operation.invoke(
        new KosisClient("statistics-transport-test-key"),
      );
      assert.deepEqual(result, rowsByOperation[index]);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("list, search, and explanation reject advertised overflows before reading bodies", async () => {
  try {
    for (const operation of transportOperations) {
      const fixture = advertisedOverflowResponse();
      globalThis.fetch = async () => fixture.response;
      await assert.rejects(
        () =>
          operation.invoke(new KosisClient("statistics-transport-test-key")),
        (error) => {
          assertSafeTransportError(
            error,
            "RESPONSE_TOO_LARGE",
            "KOSIS 응답이 허용된 크기를 초과했습니다. 조회 범위를 좁혀 다시 시도해주세요.",
          );
          return true;
        },
      );
      assert.equal(fixture.wasRead(), false);
      assert.equal(fixture.wasCancelled(), true);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("list, search, and explanation cancel streamed overflows without returning partial rows", async () => {
  const first = new Uint8Array(MAX_RESPONSE_BYTES);
  first.fill(0x20);
  try {
    for (const operation of transportOperations) {
      const response = streamedResponse(
        [first, Uint8Array.of(0x20), Uint8Array.of(0x20)],
        undefined,
      );
      globalThis.fetch = async () => response;
      await assert.rejects(
        () =>
          operation.invoke(new KosisClient("statistics-transport-test-key")),
        (error) => {
          assertSafeTransportError(
            error,
            "RESPONSE_TOO_LARGE",
            "KOSIS 응답이 허용된 크기를 초과했습니다. 조회 범위를 좁혀 다시 시도해주세요.",
          );
          return true;
        },
      );
      assert.equal(response.wasCancelled(), true);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
function captureOperationalEvents() {
  const events = [];
  const restore = setOperationalEventSink((event) => events.push(event));
  return { events, restore };
}

function assertProviderOutcomeEvent(event, expected) {
  assert.deepEqual(
    Object.keys(event).sort(),
    [
      "attempts",
      "elapsedTimeMs",
      "kind",
      "operation",
      "outcome",
      "provider",
      "retryDisposition",
      "sizeLimitBytes",
      "statusCategory",
      ...(expected.responseBytes === undefined ? [] : ["responseBytes"]),
    ].sort(),
  );
  assert.equal(event.kind, "provider_outcome");
  assert.equal(event.provider, "kosis");
  assert.equal(event.operation, expected.operation);
  assert.equal(typeof event.elapsedTimeMs, "number");
  assert.ok(event.elapsedTimeMs >= 0);
  if (expected.responseBytes === undefined) {
    assert.equal("responseBytes" in event, false);
  } else {
    assert.equal(event.responseBytes, expected.responseBytes);
  }
  assert.equal(event.statusCategory, expected.statusCategory);
  assert.equal(
    event.attempts,
    expected.attempts ?? (expected.outcome === "auth_missing" ? 0 : 1),
  );
  assert.equal(event.retryDisposition, "not_attempted");
  assert.equal(event.outcome, expected.outcome);
  assert.equal(event.sizeLimitBytes, MAX_RESPONSE_BYTES);
}

test("provider success outcome is bounded and includes measured response bytes", async () => {
  const { events, restore } = captureOperationalEvents();
  const rows = [{ C1: "2024", D1: "100" }];
  const payload = encoder.encode(JSON.stringify(rows));
  globalThis.fetch = async () =>
    streamedResponse([payload], payload.byteLength);
  try {
    assert.deepEqual(
      await new KosisClient("statistics-transport-test-key").getStatisticsData(
        statisticsParams(),
      ),
      rows,
    );
    assert.equal(events.length, 1);
    assertProviderOutcomeEvent(events[0], {
      operation: "statistics_data",
      outcome: "success",
      statusCategory: "success",
      responseBytes: payload.byteLength,
    });
  } finally {
    restore();
    globalThis.fetch = originalFetch;
  }
});

test("metadata provider success uses a distinct safe operation", async () => {
  const { events, restore } = captureOperationalEvents();
  const rows = [{ OBJ_ID: "L1" }];
  const payload = encoder.encode(JSON.stringify(rows));
  globalThis.fetch = async () =>
    streamedResponse([payload], payload.byteLength);
  try {
    assert.deepEqual(
      await new KosisClient("statistics-transport-test-key").getTableMeta(
        "ORG",
        "TABLE",
        "ITM",
      ),
      rows,
    );
    assert.equal(events.length, 1);
    assertProviderOutcomeEvent(events[0], {
      operation: "table_metadata",
      outcome: "success",
      statusCategory: "success",
      responseBytes: payload.byteLength,
    });
  } finally {
    restore();
    globalThis.fetch = originalFetch;
  }
});

test("provider oversized response emits once without reading an advertised body", async () => {
  const { events, restore } = captureOperationalEvents();
  const fixture = advertisedOverflowResponse();
  globalThis.fetch = async () => fixture.response;
  try {
    await assert.rejects(
      () =>
        new KosisClient("statistics-transport-test-key").getStatisticsData(
          statisticsParams(),
        ),
      (error) => error.code === "RESPONSE_TOO_LARGE",
    );
    assert.equal(events.length, 1);
    assertProviderOutcomeEvent(events[0], {
      operation: "statistics_data",
      outcome: "too_large",
      statusCategory: "success",
    });
    assert.equal(fixture.wasRead(), false);
  } finally {
    restore();
    globalThis.fetch = originalFetch;
  }
});

test("provider HTTP auth and rate-limit outcomes are classified without payloads", async () => {
  for (const [status, outcome] of [
    [429, "rate_limited"],
    [401, "auth_rejected"],
    [403, "auth_rejected"],
  ]) {
    const { events, restore } = captureOperationalEvents();
    globalThis.fetch = async () => ({
      ok: false,
      status,
      headers: new Headers(),
      body: null,
    });
    try {
      await assert.rejects(
        () =>
          new KosisClient("statistics-transport-test-key").getStatisticsList(
            "VIEW",
            "PARENT",
          ),
        (error) => error.code === "HTTP_ERROR",
      );
      assert.equal(events.length, 1);
      assertProviderOutcomeEvent(events[0], {
        operation: "statistics_list",
        outcome,
        statusCategory: "client_error",
      });
    } finally {
      restore();
      globalThis.fetch = originalFetch;
    }
  }
});

test("provider missing credentials emit auth_missing without making a request", async () => {
  const { events, restore } = captureOperationalEvents();
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("fetch must not run");
  };
  try {
    await assert.rejects(
      () => new KosisClient("").getStatisticsData(statisticsParams()),
      (error) => error.code === "INVALID_API_KEY",
    );
    assert.equal(fetches, 0);
    assert.equal(events.length, 1);
    assertProviderOutcomeEvent(events[0], {
      operation: "statistics_data",
      outcome: "auth_missing",
      statusCategory: "unknown",
    });
  } finally {
    restore();
    globalThis.fetch = originalFetch;
  }
});

test("provider timeout emits a single bounded timeout outcome", async () => {
  const { events, restore } = captureOperationalEvents();
  globalThis.fetch = async () => {
    throw new DOMException("synthetic timeout", "AbortError");
  };
  try {
    await assert.rejects(
      () =>
        new KosisClient("statistics-transport-test-key").getStatisticsList(
          "VIEW",
          "PARENT",
        ),
      (error) => error.code === "TIMEOUT",
    );
    assert.equal(events.length, 1);
    assertProviderOutcomeEvent(events[0], {
      operation: "statistics_list",
      outcome: "timeout",
      statusCategory: "unknown",
    });
  } finally {
    restore();
    globalThis.fetch = originalFetch;
  }
});

test("bodyless test responses never claim measured provider bytes", async () => {
  const events = [];
  const restore = setOperationalEventSink((event) => events.push(event));
  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => [{ value: "한글" }],
    });
    const client = new KosisClient("statistics-transport-test-key");
    await client.searchStatistics("ignored");
    await client.getTableMeta("ORG", "TABLE", "SOURCE");
    assert.equal(events.length, 2);
    for (const event of events) {
      assert.equal(event.kind, "provider_outcome");
      assert.equal(event.outcome, "success");
      assert.equal(Object.hasOwn(event, "responseBytes"), false);
    }
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
