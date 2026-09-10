import assert from "node:assert/strict";
import test from "node:test";
const originalKosisApiKey = process.env.KOSIS_API_KEY;
process.env.KOSIS_API_KEY =
  originalKosisApiKey || "alternative-discovery-fixture-key";

const { resolveRegion, resolveRegionFromQuery } =
  await import("../dist/utils/regionResolver.js");
const { BIRTHS_MUNICIPAL_ANNUAL_ALTERNATIVE } =
  await import("../dist/data/quickStatsParams.js");
const { quickStats } = await import("../dist/tools/quickStats.js");
const { quickTrend } = await import("../dist/tools/quickTrend.js");
const { getCacheManager } = await import("../dist/cache/index.js");

const param = {
  orgId: "101",
  tableId: "DT_1DA7004S",
  tableName: "행정구역(시도)별 경제활동인구",
  description: "실업률",
  objL1: "00",
  itemId: "T80",
  unit: "%",
  supportedPeriods: ["Y", "Q", "M"],
};
const metadataRows = [
  { OBJ_ID: "A", OBJ_NM: "행정구역", ITM_ID: "00", ITM_NM: "전국" },
];
const sampleRows = [
  {
    ORG_ID: "101",
    TBL_ID: "DT_1DA7004S",
    PRD_SE: "Y",
    PRD_DE: "2024",
    C1: "00",
    C1_OBJ_NM: "행정구역",
    C1_NM: "전국",
    ITM_ID: "T80",
    ITM_NM: "실업률",
    UNIT_NM: "%",
    DT: "2.1",
  },
];
function makeClient({
  searchRows = [],
  candidate = {},
  explainRows = [],
} = {}) {
  const calls = { search: [], meta: [], data: [], explain: [] };
  const client = {
    calls,
    async searchStatistics(query, options) {
      calls.search.push({ query, options });
      return searchRows;
    },
    async getTableMeta(orgId, tableId, type) {
      calls.meta.push({ orgId, tableId, type });
      if (tableId === param.tableId && type === "SOURCE") {
        return [{ STAT_ID: "1962002", STAT_NM: "경제활동인구조사" }];
      }
      if (tableId === param.tableId && type === "PRD") {
        return [
          { PRD_SE: "Y", PRD_NM: "년" },
          { PRD_SE: "Q", PRD_NM: "분기" },
          { PRD_SE: "M", PRD_NM: "월" },
        ];
      }
      if (type === "SOURCE") return candidate.source ?? [];
      if (type === "PRD") return candidate.period ?? [];
      if (type === "ITM") return candidate.item ?? [];
      return [];
    },
    async getStatisticsExplain(statId, metaItm) {
      calls.explain.push({ statId, metaItm });
      return explainRows;
    },
    async getStatisticsData(params) {
      calls.data.push(params);
      return [];
    },
  };
  return client;
}
const candidateRow = {
  ORG_ID: "101",
  TBL_ID: "DT_1ES3A01S",
  TBL_NM: "시군구 경제활동인구 총괄",
  STAT_ID: "2006081",
  STAT_NM: "지역별고용조사",
};
const mismatchingCandidate = {
  source: [{ STAT_ID: "2006081", STAT_NM: "지역별고용조사" }],
  period: [{ PRD_SE: "H", PRD_NM: "반기" }],
  item: [
    { OBJ_ID: "A", OBJ_NM: "행정구역", ITM_ID: "T8", ITM_NM: "실업률(％)" },
  ],
};
const optionsFor = (client) => ({
  client,
  metadataRows,
  sampleRows,
  useCache: false,
  requestedPeriod: "Y",
});

test("actual bounded official search returns source/period evidence without candidate data", async () => {
  const client = makeClient({
    searchRows: [candidateRow, { ...candidateRow, TBL_NM: "duplicate result" }],
    candidate: mismatchingCandidate,
    explainRows: [{ statsNm: "지역별고용조사" }],
  });
  const result = await resolveRegion(param, "없는군", optionsFor(client));
  assert.equal(result.status, "not_found");
  assert.equal(client.calls.search.length, 1);
  assert.equal(client.calls.search[0].query, "실업률 시군구");
  assert.equal(client.calls.search[0].options.resultCount, 5);
  assert.equal(client.calls.data.length, 0);
  assert.equal(result.tableDiscovery.status, "searched");
  assert.equal(result.tableDiscovery.searchedCount, 1);
  assert.equal(result.tableDiscovery.candidateLimit, 5);
  assert.equal(result.tableDiscovery.metadataCallBudget, 16);
  const discovered = result.tableDiscovery.candidates[0];
  assert.deepEqual(
    {
      orgId: discovered.orgId,
      tableId: discovered.tableId,
      tableName: discovered.tableName,
    },
    {
      orgId: "101",
      tableId: "DT_1ES3A01S",
      tableName: "시군구 경제활동인구 총괄",
    },
  );
  assert.equal(discovered.status, "definition_mismatch");
  assert.ok(
    discovered.differences.some((difference) => difference.field === "source"),
  );
  assert.ok(
    discovered.differences.some((difference) => difference.field === "period"),
  );
  assert.ok(
    !discovered.differences.some((difference) => difference.field === "item"),
  );
  assert.ok(!discovered.missingEvidence.includes("population"));
  assert.ok(
    !client.calls.meta.some((call) => ["ITM", "CMMT"].includes(call.type)),
  );
  assert.equal(client.calls.explain.length, 0);
});

test("distinct candidates are capped at five and metadata work is reported incomplete", async () => {
  const client = makeClient({
    searchRows: Array.from({ length: 7 }, (_, index) => ({
      ...candidateRow,
      TBL_ID: `DT_CAND_${index}`,
    })),
    candidate: {
      source: [{ STAT_ID: "1962002", STAT_NM: "경제활동인구조사" }],
      period: [{ PRD_SE: "Y", PRD_NM: "년" }],
      item: [
        { OBJ_ID: "A", OBJ_NM: "행정구역", ITM_ID: "T80", ITM_NM: "실업률" },
      ],
    },
  });
  const result = await resolveRegion(param, "없는군", optionsFor(client));
  assert.equal(result.tableDiscovery.candidates.length, 5);
  assert.equal(result.tableDiscovery.searchedCount, 5);
  assert.equal(result.tableDiscovery.metadataCalls, 15);
  assert.equal(result.tableDiscovery.metadataComplete, false);
  assert.equal(client.calls.data.length, 0);
});

test("no candidate and provider failures are distinct and bounded", async () => {
  const noCandidateClient = makeClient();
  const noCandidate = await resolveRegion(
    param,
    "없는군",
    optionsFor(noCandidateClient),
  );
  assert.equal(noCandidate.tableDiscovery.status, "candidate_not_found");
  assert.deepEqual(noCandidate.tableDiscovery.candidates, []);
  const providerClient = makeClient();
  providerClient.searchStatistics = async () => {
    throw new Error("provider unavailable");
  };
  const providerFailure = await resolveRegion(
    param,
    "없는군",
    optionsFor(providerClient),
  );
  assert.equal(providerFailure.tableDiscovery.status, "provider_error");
  assert.deepEqual(providerFailure.tableDiscovery.candidates, []);
});

test("metadata insufficiency is not a positive candidate profile", async () => {
  const client = makeClient({
    searchRows: [candidateRow],
    candidate: {
      source: [{ STAT_ID: "1962002", STAT_NM: "경제활동인구조사" }],
      period: [{ PRD_SE: "Y", PRD_NM: "년" }],
      item: [
        { OBJ_ID: "A", OBJ_NM: "행정구역", ITM_ID: "T80", ITM_NM: "실업률" },
      ],
    },
  });
  const result = await resolveRegion(param, "없는군", optionsFor(client));
  const discovered = result.tableDiscovery.candidates[0];
  assert.equal(discovered.status, "metadata_insufficient");
  assert.ok(discovered.missingEvidence.includes("definition"));
  assert.ok(discovered.missingEvidence.includes("compatibility_not_verified"));
  assert.equal(client.calls.explain[0].statId, "1962002");
  assert.equal(discovered.matched, undefined);
  assert.equal(client.calls.data.length, 0);
});

test("ambiguous and omitted regions do not trigger alternative discovery", async () => {
  const client = makeClient({
    searchRows: [candidateRow],
    candidate: mismatchingCandidate,
  });
  const ambiguousMetadata = [
    { OBJ_ID: "A", OBJ_NM: "행정구역", ITM_ID: "11", ITM_NM: "서울특별시" },
    {
      OBJ_ID: "A",
      OBJ_NM: "행정구역",
      ITM_ID: "111",
      ITM_NM: "중구",
      UP_ITM_ID: "11",
    },
    { OBJ_ID: "A", OBJ_NM: "행정구역", ITM_ID: "26", ITM_NM: "부산광역시" },
    {
      OBJ_ID: "A",
      OBJ_NM: "행정구역",
      ITM_ID: "261",
      ITM_NM: "중구",
      UP_ITM_ID: "26",
    },
  ];
  const ambiguous = await resolveRegion(param, "중구", {
    ...optionsFor(client),
    metadataRows: ambiguousMetadata,
  });
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(client.calls.search.length, 0);
  const omitted = await resolveRegionFromQuery(
    param,
    "실업률",
    optionsFor(client),
  );
  assert.equal(omitted.status, "none");
  assert.equal(client.calls.search.length, 0);
});

const birthParam = {
  orgId: "101",
  tableId: "DT_1B8000G",
  tableName: "월.분기.연간 인구동향",
  description: "출생아수",
  objL1: "00",
  objL2: "10",
  itemId: "T1",
  unit: "명 건",
  supportedPeriods: ["Y", "Q", "M"],
  alternativeProfile: BIRTHS_MUNICIPAL_ANNUAL_ALTERNATIVE,
};
const birthSourceMetadata = [
  { OBJ_ID: "B", OBJ_NM: "행정구역별", ITM_ID: "00", ITM_NM: "전국" },
  {
    OBJ_ID: "ITEM",
    OBJ_NM: "항목",
    ITM_ID: "T1",
    ITM_NM: "출생사망혼인이혼",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "종류별",
    ITM_ID: "10",
    ITM_NM: "출생아수(명)",
  },
];
const birthSourceSample = [
  {
    ORG_ID: "101",
    TBL_ID: "DT_1B8000G",
    PRD_SE: "A",
    PRD_DE: "2024",
    C1: "00",
    C1_OBJ_NM: "행정구역별",
    C1_NM: "전국",
    C2: "10",
    C2_OBJ_NM: "종류별",
    C2_NM: "출생아수(명)",
    ITM_ID: "T1",
    DT: "13063",
    UNIT_NM: "명 건",
  },
];
const birthCandidateMetadata = [
  { OBJ_ID: "A", OBJ_NM: "시군구별", ITM_ID: "21", ITM_NM: "부산" },
  {
    OBJ_ID: "A",
    OBJ_NM: "시군구별",
    ITM_ID: "21060",
    ITM_NM: "동래구",
    UP_ITM_ID: "21",
  },
  {
    OBJ_ID: "ITEM",
    OBJ_NM: "항목",
    ITM_ID: "T1",
    ITM_NM: "출생아수",
  },
];
const birthDefinition = [
  {
    statsNm: "인구동향조사",
    statsPeriod: "월",
    examinTrgetPd: "매월 1일~말일",
    goalPoplExmnPopl:
      "ㅇ작성연도별 인구동태 사항 출생 : 출생인구 - 사망 : 현재인구 - 혼인 : 미혼자 인구 - 이혼 : 기혼자 인구",
  },
];
const birthProbeRows = [
  {
    ORG_ID: "101",
    TBL_ID: "DT_1B81A23",
    PRD_SE: "A",
    PRD_DE: "2024",
    C1: "21060",
    C1_OBJ_NM: "시군구별",
    C1_NM: "동래구",
    ITM_ID: "T1",
    DT: "1208",
  },
];
const birthTrendRows = [
  { ...birthProbeRows[0], PRD_DE: "2023", DT: "1100" },
  { ...birthProbeRows[0], PRD_DE: "2024", DT: "1208" },
];
function makeBirthClient({
  probeRows = birthProbeRows,
  definition = birthDefinition,
  candidateMetadata = birthCandidateMetadata,
  sourceMetadata = birthSourceMetadata,
  sourcePeriods = [
    { PRD_SE: "Y", PRD_NM: "년", STRT_PRD_DE: "2000", END_PRD_DE: "2025" },
    { PRD_SE: "Q", PRD_NM: "분기" },
    { PRD_SE: "M", PRD_NM: "월" },
  ],
  candidatePeriods = [
    { PRD_SE: "Y", PRD_NM: "년", STRT_PRD_DE: "2000", END_PRD_DE: "2025" },
  ],
  sourceComments = [
    {
      CMMT_DC: "출생은 발생월 기준이며 출생아수는 다음 해 8월에 확정됩니다.",
    },
  ],
  candidateComments = [
    {
      CMMT_DC:
        "후보 잠정 출생아 수는 백단위 반올림 값이며 2026년 8월 개정된 군지역 코드가 과거 시점에도 소급 적용됩니다.",
    },
  ],
} = {}) {
  const calls = { search: [], meta: [], data: [], explain: [] };
  const source = [{ STAT_ID: "1962004", STAT_NM: "인구동향조사" }];
  const periods = sourcePeriods;
  const client = {
    calls,
    async searchStatistics(query, options) {
      calls.search.push({ query, options });
      return [
        {
          ORG_ID: "101",
          TBL_ID: "DT_1B81A23",
          TBL_NM: "시군구/출생아수 합계출산율",
          STAT_ID: "1962004",
        },
      ];
    },
    async getTableMeta(orgId, tableId, type) {
      calls.meta.push({ orgId, tableId, type });
      if (tableId === birthParam.tableId && type === "SOURCE") return source;
      if (tableId === birthParam.tableId && type === "PRD") return periods;
      if (tableId === birthParam.tableId && type === "ITM")
        return sourceMetadata;
      if (tableId === birthParam.tableId && type === "CMMT")
        return sourceComments;
      if (tableId === "DT_1B81A23" && type === "SOURCE") return source;
      if (tableId === "DT_1B81A23" && type === "PRD") return candidatePeriods;
      if (tableId === "DT_1B81A23" && type === "ITM") return candidateMetadata;
      if (tableId === "DT_1B81A23" && type === "CMMT") return candidateComments;
      return [];
    },
    async getStatisticsExplain(statId, metaItm) {
      calls.explain.push({ statId, metaItm });
      return definition;
    },
    async getStatisticsData(params) {
      calls.data.push(params);
      return probeRows;
    },
  };
  return client;
}
function birthResolveOptions(client, extra = {}) {
  return {
    client,
    metadataRows: birthSourceMetadata,
    sampleRows: birthSourceSample,
    requestedPeriod: "Y",
    useCache: false,
    ...extra,
  };
}

test("birth annual alternative is selected only after exact runtime proof", async () => {
  const client = makeBirthClient();
  const result = await resolveRegion(birthParam, "동래구", {
    client,
    metadataRows: birthSourceMetadata,
    sampleRows: birthSourceSample,
    requestedPeriod: "Y",
    requestedStartPeriod: "2024",
    requestedEndPeriod: "2024",
    useCache: false,
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.regionCode, "21060");
  assert.equal(result.axis, 1);
  assert.equal(result.selectedParam.tableId, "DT_1B81A23");
  assert.equal(result.selectedParam.itemId, "T1");
  assert.equal(result.selectedParam.unit, "");
  assert.equal(result.tableDiscovery.candidates[0].status, "matched");
  assert.equal(result.tableDiscovery.selectedParam.tableId, "DT_1B81A23");
  assert.ok(result.caveats.some((caveat) => caveat.includes("발생월")));
  assert.ok(result.caveats.some((caveat) => caveat.includes("반올림")));
  assert.ok(
    result.tableDiscovery.candidates[0].evidence.sourceComments.some(
      (comment) => comment.includes("발생월"),
    ),
  );
  assert.ok(
    result.tableDiscovery.candidates[0].evidence.candidateComments.some(
      (comment) => comment.includes("반올림"),
    ),
  );
  assert.equal(client.calls.search.length, 1);
  assert.ok(client.calls.data.some((params) => params.tblId === "DT_1B81A23"));
  assert.ok(client.calls.explain.every((call) => call.statId === "1962004"));
  const probe = client.calls.data[0];
  assert.equal(probe.objL1, "ALL");
  assert.equal(probe.itmId, "T1");
  assert.equal(probe.prdSe, "Y");
  assert.equal(probe.newEstPrdCnt, undefined);
  assert.equal(probe.startPrdDe, "2024");
  assert.equal(probe.endPrdDe, "2024");
  assert.ok(
    client.calls.meta.some(
      (call) => call.tableId === birthParam.tableId && call.type === "CMMT",
    ),
  );
});

test("birth alternative rejects out-of-coverage year and changed definition without national fallback", async () => {
  const outsideClient = makeBirthClient();
  const outside = await resolveRegion(birthParam, "동래구", {
    client: outsideClient,
    metadataRows: birthSourceMetadata,
    sampleRows: birthSourceSample,
    requestedPeriod: "Y",
    requestedStartPeriod: "2026",
    requestedEndPeriod: "2026",
    useCache: false,
  });
  assert.notEqual(outside.status, "resolved");
  assert.equal(outside.regionCode, undefined);
  assert.equal(outsideClient.calls.data.length, 0);
  const changedClient = makeBirthClient({
    definition: [{ ...birthDefinition[0], statsPeriod: "분기" }],
  });
  const changed = await resolveRegion(birthParam, "동래구", {
    client: changedClient,
    metadataRows: birthSourceMetadata,
    sampleRows: birthSourceSample,
    requestedPeriod: "Y",
    requestedStartPeriod: "2024",
    requestedEndPeriod: "2024",
    useCache: false,
  });
  assert.notEqual(changed.status, "resolved");
  assert.equal(changed.regionCode, undefined);
});
test("positive profile resolves a newly listed municipality dynamically", async () => {
  const candidateMetadata = [
    { OBJ_ID: "A", OBJ_NM: "시군구별", ITM_ID: "99", ITM_NM: "가상도" },
    {
      OBJ_ID: "A",
      OBJ_NM: "시군구별",
      ITM_ID: "99001",
      ITM_NM: "새군",
      UP_ITM_ID: "99",
    },
    {
      OBJ_ID: "ITEM",
      OBJ_NM: "항목",
      ITM_ID: "T1",
      ITM_NM: "출생아수",
    },
  ];
  const probeRows = [{ ...birthProbeRows[0], C1: "99001", C1_NM: "새군" }];
  const result = await resolveRegion(
    birthParam,
    "새군",
    birthResolveOptions(makeBirthClient({ candidateMetadata, probeRows })),
  );
  assert.equal(result.status, "resolved");
  assert.equal(result.regionCode, "99001");
  assert.equal(result.selectedParam.tableId, "DT_1B81A23");
  assert.equal(result.selectedParam.unit, "");
});

test("birth candidate probe identity and period failures select nothing", async () => {
  const badProbeClient = makeBirthClient({
    probeRows: [{ ...birthProbeRows[0], C1: "21" }],
  });
  const badProbe = await resolveRegion(birthParam, "동래구", {
    client: badProbeClient,
    metadataRows: birthSourceMetadata,
    sampleRows: birthSourceSample,
    requestedPeriod: "Y",
    useCache: false,
  });
  assert.notEqual(badProbe.status, "resolved");
  assert.equal(badProbe.regionCode, undefined);
  const quarter = await resolveRegion(birthParam, "동래구", {
    client: makeBirthClient(),
    metadataRows: birthSourceMetadata,
    sampleRows: birthSourceSample,
    requestedPeriod: "Q",
    useCache: false,
  });
  assert.notEqual(quarter.status, "resolved");
  assert.equal(quarter.regionCode, undefined);
});
test("missing candidate year and unlisted municipality remain fail-closed", async () => {
  const missingYear = await resolveRegion(birthParam, "동래구", {
    client: makeBirthClient({
      probeRows: [{ ...birthProbeRows[0], PRD_DE: "2023" }],
    }),
    metadataRows: birthSourceMetadata,
    sampleRows: birthSourceSample,
    requestedPeriod: "Y",
    requestedStartPeriod: "2024",
    requestedEndPeriod: "2024",
    useCache: false,
  });
  assert.notEqual(missingYear.status, "resolved");
  assert.equal(missingYear.regionCode, undefined);

  const unlisted = await resolveRegion(birthParam, "해운대구", {
    client: makeBirthClient(),
    metadataRows: birthSourceMetadata,
    sampleRows: birthSourceSample,
    requestedPeriod: "Y",
    useCache: false,
  });
  assert.notEqual(unlisted.status, "resolved");
  assert.equal(unlisted.regionCode, undefined);
});
function installOfficialFixtureFetch(
  calls,
  {
    candidateRows = birthProbeRows,
    candidateMetadata = birthCandidateMetadata,
  } = {},
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const params = Object.fromEntries(url.searchParams.entries());
    calls.push({ path: url.pathname, params });
    const method = params.method;
    const type = params.type;
    let body = [];
    if (url.pathname.endsWith("/statisticsSearch.do")) {
      body = [
        {
          ORG_ID: "101",
          TBL_ID: "DT_1B81A23",
          TBL_NM: "시군구/출생아수 합계출산율",
          STAT_ID: "1962004",
        },
      ];
    } else if (url.pathname.endsWith("/statisticsExplData.do")) {
      body = birthDefinition;
    } else if (method === "getMeta" && params.tblId === "DT_1B8000G") {
      if (type === "ITM") body = birthSourceMetadata;
      else if (type === "SOURCE")
        body = [{ STAT_ID: "1962004", STAT_NM: "인구동향조사" }];
      else if (type === "PRD")
        body = [
          {
            PRD_SE: "Y",
            PRD_NM: "년",
            STRT_PRD_DE: "1990",
            END_PRD_DE: "2025",
          },
          { PRD_SE: "Q", PRD_NM: "분기" },
          { PRD_SE: "M", PRD_NM: "월" },
        ];
      else if (type === "CMMT")
        body = [
          {
            CMMT_DC:
              "출생은 발생월 기준이며 출생아수는 다음 해 8월에 확정됩니다.",
          },
        ];
    } else if (method === "getMeta" && params.tblId === "DT_1B81A23") {
      if (type === "SOURCE")
        body = [{ STAT_ID: "1962004", STAT_NM: "인구동향조사" }];
      else if (type === "PRD")
        body = [
          {
            PRD_SE: "Y",
            PRD_NM: "년",
            STRT_PRD_DE: "2000",
            END_PRD_DE: "2025",
          },
        ];
      else if (type === "ITM") body = candidateMetadata;
      else if (type === "CMMT")
        body = [
          {
            CMMT_DC:
              "후보 잠정 출생아 수는 백단위 반올림 값이며 2026년 8월 개정된 군지역 코드가 과거 시점에도 소급 적용됩니다.",
          },
        ];
    } else if (url.pathname.endsWith("/Param/statisticsParameterData.do")) {
      if (params.tblId === "DT_1B81A23") {
        const isProbe = params.objL1 === "ALL" || params.itmId === undefined;
        body = isProbe
          ? candidateRows
          : params.startPrdDe && params.startPrdDe !== params.endPrdDe
            ? birthTrendRows
            : candidateRows;
      } else if (params.tblId === "DT_1B8000G") {
        body = birthSourceSample;
      }
    }
    return {
      ok: true,
      status: 200,
      headers: {
        get() {
          return null;
        },
      },
      async json() {
        return body;
      },
    };
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function withOfficialFixture(run, options = {}) {
  const calls = [];
  const restoreFetch = installOfficialFixtureFetch(calls, options);
  const priorKey = process.env.KOSIS_API_KEY;
  process.env.KOSIS_API_KEY = priorKey || "alternative-discovery-fixture-key";
  getCacheManager().flush();
  try {
    return await run(calls);
  } finally {
    getCacheManager().flush();
    restoreFetch();
    if (priorKey === undefined) delete process.env.KOSIS_API_KEY;
    else process.env.KOSIS_API_KEY = priorKey;
  }
}

test("quickStats selected candidate owns final wire request/cache identity and keeps missing unit partial", async () => {
  await withOfficialFixture(async (calls) => {
    const first = await quickStats({
      query: "출생아수",
      region: "동래구",
      year: 2024,
    });
    assert.equal(first.success, true);
    assert.equal(first.source.tableId, "DT_1B81A23");
    assert.equal(first.source.regionCode, "21060");
    assert.equal(first.unit, undefined);
    assert.equal(first.validationLevel, "partial");
    assert.ok(first.caveats.some((caveat) => caveat.includes("반올림")));

    const candidateDataCalls = calls.filter(
      (call) =>
        call.path.endsWith("/Param/statisticsParameterData.do") &&
        call.params.tblId === "DT_1B81A23",
    );
    const probe = candidateDataCalls.find(
      (call) => call.params.objL1 === "ALL" || call.params.itmId === undefined,
    );
    const final = candidateDataCalls.find(
      (call) => call.params.objL1 === "21060" && call.params.itmId === "T1",
    );
    assert.ok(probe);
    assert.equal(probe.params.objL1, "ALL");
    assert.equal(probe.params.itmId, "T1");
    assert.equal(probe.params.newEstPrdCnt, undefined);
    assert.equal(probe.params.startPrdDe, "2024");
    assert.equal(probe.params.endPrdDe, "2024");
    assert.ok(final);
    assert.equal(final.params.objL2, undefined);
    assert.equal(final.params.itmId, "T1");
    const explainCalls = calls.filter((call) =>
      call.path.endsWith("/statisticsExplData.do"),
    );
    assert.ok(explainCalls.length >= 1);
    assert.ok(
      explainCalls.every(
        (call) =>
          call.params.statId === "1962004" && call.params.metaItm === "ALL",
      ),
    );

    const beforeFinalCount = candidateDataCalls.length;
    const second = await quickStats({
      query: "출생아수",
      region: "동래구",
      year: 2024,
    });
    assert.equal(second.source.tableId, "DT_1B81A23");
    const afterFinalCount = calls.filter(
      (call) =>
        call.path.endsWith("/Param/statisticsParameterData.do") &&
        call.params.tblId === "DT_1B81A23" &&
        call.params.objL1 === "21060" &&
        call.params.itmId === "T1",
    ).length;
    assert.equal(afterFinalCount, 1);
    assert.ok(beforeFinalCount >= 2);
  });
});

test("quickTrend selected candidate propagates range/provenance and defers derived trend", async () => {
  await withOfficialFixture(async (calls) => {
    const result = await quickTrend({
      keyword: "출생아수",
      region: "동래구",
      yearCount: 2,
      startYear: 2023,
      endYear: 2024,
    });
    assert.equal(result.success, true);
    assert.equal(result.source.tableId, "DT_1B81A23");
    assert.equal(result.source.regionCode, "21060");
    assert.equal(result.trend, "deferred");
    assert.equal(result.validationLevel, "partial");
    assert.ok(result.caveats.some((caveat) => caveat.includes("소급")));
    assert.equal(result.source.unit, undefined);
    assert.equal(result.dataPoints.length, 2);
    assert.ok(
      result.dataPoints.every((point) => point.absoluteChange === undefined),
    );
    assert.ok(
      result.dataPoints.every((point) => point.changeRate === undefined),
    );
    const candidateDataCalls = calls.filter(
      (call) =>
        call.path.endsWith("/Param/statisticsParameterData.do") &&
        call.params.tblId === "DT_1B81A23",
    );
    const probe = candidateDataCalls.find(
      (call) => call.params.objL1 === "ALL" || call.params.itmId === undefined,
    );
    assert.ok(probe);
    assert.equal(probe.params.objL1, "ALL");
    assert.equal(probe.params.itmId, "T1");
    assert.equal(probe.params.newEstPrdCnt, undefined);
    assert.equal(probe.params.startPrdDe, "2024");
    assert.equal(probe.params.endPrdDe, "2024");
    const finalCalls = candidateDataCalls.filter(
      (call) => call.params.objL1 === "21060" && call.params.itmId === "T1",
    );
    assert.equal(finalCalls.length, 1);
    assert.equal(finalCalls[0].params.startPrdDe, "2023");
    assert.equal(finalCalls[0].params.endPrdDe, "2024");
    assert.equal(finalCalls[0].params.objL2, undefined);
    assert.equal(finalCalls[0].params.newEstPrdCnt, undefined);
  });
});

test("quickStats source-table valid flow remains unchanged and preserves official source unit", async () => {
  await withOfficialFixture(async (calls) => {
    const result = await quickStats({ query: "출생아수", year: 2024 });
    assert.equal(result.success, true);
    assert.equal(result.source.tableId, "DT_1B8000G");
    assert.equal(result.source.regionCode, undefined);
    assert.equal(result.unit, "명 건");
    assert.equal(result.validationLevel, "verified");
    const sourceFinal = calls.find(
      (call) =>
        call.path.endsWith("/Param/statisticsParameterData.do") &&
        call.params.tblId === "DT_1B8000G" &&
        call.params.itmId === "T1" &&
        call.params.objL1 === "00" &&
        call.params.startPrdDe === "2024",
    );
    assert.ok(sourceFinal);
    assert.equal(sourceFinal.params.objL2, "10");
    assert.equal(sourceFinal.params.startPrdDe, "2024");
    assert.equal(sourceFinal.params.endPrdDe, "2024");
  });
});
test("quickStats refuses Q/M birth requests rather than substituting annual candidate", async () => {
  await withOfficialFixture(async (calls) => {
    for (const period of ["Q", "M"]) {
      getCacheManager().flush();
      calls.length = 0;
      const result = await quickStats({
        query: "출생아수",
        region: "동래구",
        year: 2024,
        period,
      });
      assert.equal(result.success, false);
      assert.equal(result.source, undefined);
      assert.equal(
        calls.some(
          (call) =>
            call.path.endsWith("/Param/statisticsParameterData.do") &&
            call.params.tblId === "DT_1B81A23" &&
            call.params.itmId === "T1",
        ),
        false,
      );
    }
  });
});
test("search SOURCE identity disagreement blocks positive selection", async () => {
  const client = makeBirthClient();
  client.searchStatistics = async () => [
    {
      ORG_ID: "101",
      TBL_ID: "DT_1B81A23",
      TBL_NM: "시군구/출생아수 합계출산율",
      STAT_ID: "9999999",
    },
  ];
  const result = await resolveRegion(birthParam, "동래구", {
    client,
    metadataRows: birthSourceMetadata,
    sampleRows: birthSourceSample,
    requestedPeriod: "Y",
    useCache: false,
  });
  assert.notEqual(result.status, "resolved");
  assert.equal(result.regionCode, undefined);
  assert.ok(
    result.tableDiscovery.candidates[0].missingEvidence.includes(
      "search_source_identity_unverified",
    ),
  );
});
test("quickTrend rejects invalid year ranges before metadata/search/data", async () => {
  await withOfficialFixture(async (calls) => {
    const invalidInputs = [
      { startYear: 2024, endYear: 2023, yearCount: 2 },
      { startYear: 2024, endYear: 2024, yearCount: 1 },
      { startYear: 2000, endYear: 2021, yearCount: 22 },
      { startYear: 2023, endYear: 2024, yearCount: 3 },
    ];
    for (const range of invalidInputs) {
      getCacheManager().flush();
      calls.length = 0;
      const result = await quickTrend({
        keyword: "출생아수",
        region: "동래구",
        ...range,
      });
      assert.equal(result.success, false);
      assert.equal(calls.length, 0);
    }
  });
});

test("quickTrend rejects a truncated provider range at requested endpoints", async () => {
  await withOfficialFixture(async (calls) => {
    const result = await quickTrend({
      keyword: "출생아수",
      region: "동래구",
      startYear: 2022,
      endYear: 2024,
      yearCount: 3,
    });
    assert.equal(result.success, false);
    assert.equal(result.validationLevel, "unverified");
    assert.match(
      result.note,
      /응답 연도 범위가 요청 시작·종료 연도와 다릅니다/u,
    );
    assert.ok(result.dataPoints.some((point) => point.year === "2023"));
    assert.ok(result.dataPoints.some((point) => point.year === "2024"));
    assert.ok(
      calls.some(
        (call) =>
          call.path.endsWith("/Param/statisticsParameterData.do") &&
          call.params.tblId === "DT_1B81A23",
      ),
    );
  });
});
test("birth profile rejects binding drift, unknown objects, missing annual bounds, and label-only caveats", async () => {
  const changedSource = birthSourceMetadata.map((row) =>
    row.OBJ_ID === "A" && row.ITM_ID === "10"
      ? { ...row, ITM_NM: "출생아수(변경)" }
      : row,
  );
  const sourceDrift = await resolveRegion(
    birthParam,
    "동래구",
    birthResolveOptions(makeBirthClient(), { metadataRows: changedSource }),
  );
  assert.notEqual(sourceDrift.status, "resolved");

  const wrongItem = birthCandidateMetadata.map((row) =>
    row.ITM_ID === "T1" ? { ...row, OBJ_ID: "A" } : row,
  );
  const wrongItemResult = await resolveRegion(
    birthParam,
    "동래구",
    birthResolveOptions(makeBirthClient({ candidateMetadata: wrongItem })),
  );
  assert.notEqual(wrongItemResult.status, "resolved");

  const unknownObject = [
    ...birthCandidateMetadata,
    { OBJ_ID: "UNKNOWN", OBJ_NM: "기타", ITM_ID: "X", ITM_NM: "기타" },
  ];
  const unknownObjectResult = await resolveRegion(
    birthParam,
    "동래구",
    birthResolveOptions(makeBirthClient({ candidateMetadata: unknownObject })),
  );
  assert.notEqual(unknownObjectResult.status, "resolved");

  const missingBounds = await resolveRegion(
    birthParam,
    "동래구",
    birthResolveOptions(
      makeBirthClient({
        sourcePeriods: [{ PRD_SE: "Y", PRD_NM: "년" }],
        candidatePeriods: [
          {
            PRD_SE: "Y",
            PRD_NM: "년",
            STRT_PRD_DE: "2000",
            END_PRD_DE: "2025",
          },
        ],
      }),
      { requestedStartPeriod: "2024", requestedEndPeriod: "2024" },
    ),
  );
  assert.notEqual(missingBounds.status, "resolved");

  const missingCandidateYear = await resolveRegion(
    birthParam,
    "동래구",
    birthResolveOptions(
      makeBirthClient({
        candidatePeriods: [
          {
            PRD_SE: "M",
            PRD_NM: "월",
            STRT_PRD_DE: "2000",
            END_PRD_DE: "2025",
          },
        ],
      }),
    ),
  );
  assert.notEqual(missingCandidateYear.status, "resolved");

  const labelOnlyComments = await resolveRegion(
    birthParam,
    "동래구",
    birthResolveOptions(
      makeBirthClient({
        sourceComments: [{ CMMT_NM: "출생 발생월 확정" }],
        candidateComments: [{ CMMT_NM: "백단위 반올림 코드 소급" }],
      }),
    ),
  );
  assert.notEqual(labelOnlyComments.status, "resolved");
});

test("birth definition fingerprint is not truncated and caveat terms are required", async () => {
  const appendedDefinition = {
    ...birthDefinition[0],
    goalPoplExmnPopl: `${birthDefinition[0].goalPoplExmnPopl}${" ".repeat(400)}추가`,
  };
  const definitionDrift = await resolveRegion(
    birthParam,
    "동래구",
    birthResolveOptions(makeBirthClient({ definition: [appendedDefinition] })),
  );
  assert.notEqual(definitionDrift.status, "resolved");

  const missingCaveat = await resolveRegion(
    birthParam,
    "동래구",
    birthResolveOptions(
      makeBirthClient({ candidateComments: [{ CMMT_DC: "잠정 출생 통계" }] }),
    ),
  );
  assert.notEqual(missingCaveat.status, "resolved");
});
test.after(() => {
  if (originalKosisApiKey === undefined) delete process.env.KOSIS_API_KEY;
  else process.env.KOSIS_API_KEY = originalKosisApiKey;
});
