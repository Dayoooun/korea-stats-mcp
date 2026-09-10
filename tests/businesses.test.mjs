import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DOTENV_CONFIG_PATH = "/nonexistent-korea-stats-businesses-test-env";
const {
  BusinessesClient,
  BUSINESS_REGION_ENDPOINT,
  BUSINESS_INDUSTRY_ENDPOINT,
  lookupCurrentSignguAffiliation,
} = await import("../dist/api/businesses.js");
const { searchBusinesses } = await import("../dist/tools/businesses.js");

const operatorKey = "businesses-test-key/plus";

function envelope({
  pageNo = 1,
  numOfRows = 2,
  totalCount = 1,
  items = [],
  resultCode = "00",
  stdrYm = "202503",
} = {}) {
  return {
    header: {
      resultCode,
      resultMsg: resultCode === "00" ? "NORMAL SERVICE" : "SERVICE ERROR",
      stdrYm,
    },
    body: { pageNo, numOfRows, totalCount, items },
  };
}

function jsonFetch(value, seen = []) {
  return async (url, options) => {
    seen.push({ url: String(url), options });
    return Response.json(value);
  };
}

function row(id, extra = {}) {
  return {
    bizesId: id,
    bizesNm: "원문 상호",
    ctprvnCd: "11",
    indsLclsCd: "G2",
    lon: "0",
    lat: "0",
    ...extra,
  };
}

test("지역+업종 실제 요청은 storeListInDong 필터와 원문 좌표를 보존한다", async () => {
  process.env.DATA_GO_KR_SERVICE_KEY = operatorKey;
  const seen = [];
  const client = new BusinessesClient({
    fetchImpl: jsonFetch(envelope({ items: [row("A")] }), seen),
  });
  const result = await client.search({
    regionType: "ctprvnCd",
    regionCode: "11",
    industryType: "indsLclsCd",
    industryCode: "G2",
    pageSize: 2,
  });
  const url = new URL(seen[0].url);
  assert.equal(url.origin + url.pathname, BUSINESS_REGION_ENDPOINT);
  assert.equal(url.searchParams.get("serviceKey"), operatorKey);
  assert.equal(url.searchParams.get("divId"), "ctprvnCd");
  assert.equal(url.searchParams.get("key"), "11");
  assert.equal(url.searchParams.get("indsLclsCd"), "G2");
  assert.deepEqual(result.items[0], row("A"));
  assert.equal(result.items[0].lon, "0");
  assert.equal(result.returnedCount, 1);
});

test("업종 단독 요청과 다중 페이지 count는 실제 반환 행과 provider total을 분리한다", async () => {
  process.env.DATA_GO_KR_SERVICE_KEY = operatorKey;
  let call = 0;
  const client = new BusinessesClient({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.origin + parsed.pathname, BUSINESS_INDUSTRY_ENDPOINT);
      assert.equal(parsed.searchParams.get("divId"), "indsMclsCd");
      assert.equal(parsed.searchParams.get("key"), "G203");
      call += 1;
      return Response.json(
        envelope({
          pageNo: call,
          numOfRows: 2,
          totalCount: 3,
          items: call === 1 ? [row("A"), row("B")] : [row("C")],
        }),
      );
    },
  });
  const first = await client.search({
    industryType: "indsMclsCd",
    industryCode: "G203",
    pageSize: 2,
    page: 1,
  });
  const second = await client.search({
    industryType: "indsMclsCd",
    industryCode: "G203",
    pageSize: 2,
    page: 2,
  });
  assert.equal(first.returnedCount, 2);
  assert.equal(first.providerTotal, 3);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextPage, 2);
  assert.equal(second.returnedCount, 1);
  assert.equal(second.hasMore, false);
});

test("percent-encoded operator key is decoded once before URLSearchParams encoding", async () => {
  process.env.DATA_GO_KR_SERVICE_KEY = encodeURIComponent(operatorKey);
  const seen = [];
  const client = new BusinessesClient({
    fetchImpl: jsonFetch(envelope({ items: [row("A")] }), seen),
  });
  await client.search({
    industryType: "indsSclsCd",
    industryCode: "G20301",
    pageSize: 2,
  });
  const rawUrl = seen[0].url;
  assert.equal(seen.length, 1);
  assert.equal(new URL(rawUrl).searchParams.get("serviceKey"), operatorKey);
  assert.ok(!rawUrl.includes("%252F"));
});

test("키가 없으면 network 호출 없이 안전한 INVALID_API_KEY가 된다", async () => {
  delete process.env.DATA_GO_KR_SERVICE_KEY;
  let calls = 0;
  const client = new BusinessesClient({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("unexpected");
    },
  });
  await assert.rejects(
    client.search({ regionType: "ctprvnCd", regionCode: "11" }),
    (error) => {
      assert.equal(error.code, "INVALID_API_KEY");
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("official top-level header/body is required instead of an invented response wrapper", async () => {
  process.env.DATA_GO_KR_SERVICE_KEY = operatorKey;
  const wrapped = new BusinessesClient({
    fetchImpl: jsonFetch({ response: envelope({ items: [row("A")] }) }),
  });
  await assert.rejects(
    wrapped.search({ regionType: "ctprvnCd", regionCode: "11", pageSize: 2 }),
    { code: "INVALID_RESPONSE" },
  );
});

test("timeout, provider error, and unexpected schema are explicit failures", async () => {
  process.env.DATA_GO_KR_SERVICE_KEY = operatorKey;
  const timeout = new BusinessesClient({
    timeoutMs: 5,
    fetchImpl: (_url, options) =>
      new Promise((_, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        ),
      ),
  });
  await assert.rejects(
    timeout.search({ regionType: "ctprvnCd", regionCode: "11" }),
    { code: "TIMEOUT" },
  );

  const providerError = new BusinessesClient({
    fetchImpl: async () => new Response("provider failure", { status: 500 }),
  });
  await assert.rejects(
    providerError.search({ regionType: "ctprvnCd", regionCode: "11" }),
    { code: "PROVIDER_ERROR" },
  );

  const unexpected = new BusinessesClient({
    fetchImpl: jsonFetch({ unexpected: [] }),
  });
  const xml = new BusinessesClient({
    fetchImpl: async () =>
      new Response("<response><error>no</error></response>"),
  });
  await assert.rejects(
    xml.search({ regionType: "ctprvnCd", regionCode: "11" }),
    { code: "PROVIDER_ERROR" },
  );
  await assert.rejects(
    unexpected.search({ regionType: "ctprvnCd", regionCode: "11" }),
    { code: "INVALID_RESPONSE" },
  );
});

test("provider pagination rejects unsafe and overflowed counts", async () => {
  process.env.DATA_GO_KR_SERVICE_KEY = operatorKey;
  for (const field of ["pageNo", "numOfRows", "totalCount"]) {
    for (const value of [
      Number.MAX_SAFE_INTEGER + 1,
      "9007199254740992",
      "9".repeat(400),
    ]) {
      const client = new BusinessesClient({
        fetchImpl: jsonFetch(
          envelope({ [field]: value, items: [row("A"), row("B")] }),
        ),
      });
      await assert.rejects(
        client.search({
          regionType: "ctprvnCd",
          regionCode: "11",
          pageSize: 2,
        }),
        { code: "INVALID_RESPONSE" },
      );
    }
  }
});

test("oversize, mismatch, duplicate IDs, and missing identity fields are handled explicitly", async () => {
  process.env.DATA_GO_KR_SERVICE_KEY = operatorKey;
  const oversizedBody =
    JSON.stringify(envelope({ items: [row("A")] })) +
    "x".repeat(4 * 1024 * 1024);
  const oversized = new BusinessesClient({
    fetchImpl: async () => new Response(oversizedBody),
  });
  await assert.rejects(
    oversized.search({ regionType: "ctprvnCd", regionCode: "11" }),
    { code: "RESPONSE_TOO_LARGE" },
  );

  const mismatch = new BusinessesClient({
    fetchImpl: jsonFetch(envelope({ items: [row("A", { ctprvnCd: "26" })] })),
  });
  await assert.rejects(
    mismatch.search({ regionType: "ctprvnCd", regionCode: "11", pageSize: 2 }),
    { code: "RESPONSE_MISMATCH" },
  );

  const duplicate = new BusinessesClient({
    fetchImpl: jsonFetch(
      envelope({ totalCount: 2, items: [row("A"), row("A")] }),
    ),
  });
  await assert.rejects(
    duplicate.search({ regionType: "ctprvnCd", regionCode: "11", pageSize: 2 }),
    { code: "DUPLICATE_BIZES_ID" },
  );

  const missing = new BusinessesClient({
    fetchImpl: jsonFetch(
      envelope({ items: [row("A", { ctprvnCd: undefined })] }),
    ),
  });
  const partial = await missing.search({
    regionType: "ctprvnCd",
    regionCode: "11",
    pageSize: 2,
  });
  assert.equal(partial.validationLevel, "unverified");
  assert.deepEqual(partial.missingFields, ["ctprvnCd"]);
});

test("short nonempty pages cannot falsely claim completion or skip missing records", async () => {
  process.env.DATA_GO_KR_SERVICE_KEY = operatorKey;
  const client = new BusinessesClient({
    fetchImpl: jsonFetch(
      envelope({ numOfRows: 2, totalCount: 2, items: [row("A")] }),
    ),
  });
  await assert.rejects(
    client.search({ regionType: "ctprvnCd", regionCode: "11", pageSize: 2 }),
    { code: "INCOMPLETE_PAGE" },
  );
});

test("empty middle pages fail and identical pending queries reuse one request", async () => {
  process.env.DATA_GO_KR_SERVICE_KEY = operatorKey;
  const emptyMiddle = new BusinessesClient({
    fetchImpl: jsonFetch(
      envelope({ pageNo: 2, numOfRows: 2, totalCount: 5, items: [] }),
    ),
  });
  await assert.rejects(
    emptyMiddle.search({
      regionType: "ctprvnCd",
      regionCode: "11",
      page: 2,
      pageSize: 2,
    }),
    { code: "EMPTY_PAGE" },
  );

  let calls = 0;
  let release;
  const pending = new BusinessesClient({
    fetchImpl: () => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const first = pending.search({
    regionType: "ctprvnCd",
    regionCode: "11",
    pageSize: 2,
  });
  const second = pending.search({
    regionType: "ctprvnCd",
    regionCode: "11",
    pageSize: 2,
  });
  assert.equal(calls, 1);
  release(Response.json(envelope({ items: [row("A")] })));
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left.returnedCount, 1);
  assert.equal(right.returnedCount, 1);
});

test("tool output distinguishes current page from the not-retrieved whole dataset", async () => {
  process.env.DATA_GO_KR_SERVICE_KEY = operatorKey;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = jsonFetch(envelope({ items: [row("A")], numOfRows: 20 }));
  try {
    const result = await searchBusinesses({
      regionType: "ctprvnCd",
      regionCode: "11",
      page: 1,
      pageSize: 20,
    });
    assert.equal(result.success, true);
    assert.equal(result.completeness.status, "current_page_only");
    assert.equal(result.completeness.wholeDataset, "not_retrieved");
    assert.equal(
      result.source.docURL,
      "https://www.data.go.kr/data/15012005/openapi.do",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("현재 시군구 소속 adapter는 정확히 1페이지 1행 요청과 최소 증거만 반환한다", async () => {
  const calls = [];
  const result = await lookupCurrentSignguAffiliation("41117", {
    search: async (input) => {
      calls.push(input);
      return {
        items: [
          {
            ctprvnCd: "41",
            ctprvnNm: "경기도",
            signguCd: "41117",
            signguNm: "수원시 영통구",
            bizesId: "ignored",
          },
        ],
        observedAt: "2026-09-10T00:00:00.000Z",
        stdrYm: "202507",
      };
    },
  });
  assert.deepEqual(calls, [
    { regionType: "signguCd", regionCode: "41117", page: 1, pageSize: 1 },
  ]);
  assert.deepEqual(result, {
    status: "found",
    ctprvnCd: "41",
    ctprvnNm: "경기도",
    signguCd: "41117",
    signguNm: "수원시 영통구",
    observedAt: "2026-09-10T00:00:00.000Z",
    stdrYm: "202507",
  });
});

test("현재 시군구 소속 adapter는 빈 행·불완전 행과 provider 예외를 보존한다", async () => {
  const noRows = await lookupCurrentSignguAffiliation("41117", {
    search: async () => ({ items: [], observedAt: "2026-09-10T00:00:00.000Z" }),
  });
  assert.deepEqual(noRows, { status: "no_rows" });

  const incomplete = await lookupCurrentSignguAffiliation("41117", {
    search: async () => ({
      items: [{ ctprvnCd: "41", signguCd: "41117", signguNm: "수원시 영통구" }],
      observedAt: "2026-09-10T00:00:00.000Z",
    }),
  });
  assert.deepEqual(incomplete, {
    status: "incomplete_row",
    missingFields: ["ctprvnNm"],
  });

  const providerError = new Error("hostile provider details");
  await assert.rejects(
    lookupCurrentSignguAffiliation("41117", {
      search: async () => {
        throw providerError;
      },
    }),
    (error) => error === providerError,
  );
});
