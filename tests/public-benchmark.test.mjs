import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  CATEGORY_WEIGHTS,
  CANONICAL_TOOL_NAMES,
  officialPathCandidates,
  resolveOfficialPath,
  normalizeObservedPeriodType,
  hasPrimaryTechnicalFailure,
  validateBusinessQueryGroups,
  selectActiveOfficialCandidate,
  EXPECTED_MANIFEST_ID,
  EXPECTED_MANIFEST_VERSION,
  EXPECTED_MANIFEST_SHA256,
  validateManifest,
  validateTrendChanges,
  rejectHasDataOrNumericClaim,
  fillMissingChecks,
  hasDerivedTrendClaims,
  validateCandidateUnit,
  oracleUnitStatus,
  validateSupplementalAffiliation,
  boundedBody,
  boundedFetch,
  hasUnsupportedCausalClaim,
  validateBusinessPage,
  validateBusinessPages,
  validateOfficialObservation,
  validatePopulationObservations,
  validateRejectResponse,
  scoreBenchmark,
  scoreCase,
  sanitizeValue,
} from "./public-benchmark.mjs";

const manifest = JSON.parse(
  await readFile(new URL("./public-benchmark.json", import.meta.url), "utf8"),
);
const row = (code, name, year = "2025", value = "123") => ({
  C1: code,
  C1_NM: name,
  ITM_ID: "T20",
  PRD_SE: "Y",
  PRD_DE: year,
  UNIT_NM: "명",
  DT: value,
});
const checks = () => ({
  identity: [
    { name: "a", pass: true, explanation: "" },
    { name: "b", pass: true, explanation: "" },
    { name: "c", pass: true, explanation: "" },
  ],
  value: [
    { name: "a", pass: true, explanation: "" },
    { name: "b", pass: true, explanation: "" },
    { name: "c", pass: true, explanation: "" },
  ],
  completeness: [
    { name: "a", pass: true, explanation: "" },
    { name: "b", pass: true, explanation: "" },
  ],
  honesty: [
    { name: "a", pass: true, explanation: "" },
    { name: "b", pass: true, explanation: "" },
  ],
});
const baseCase = (overrides = {}) => ({
  id: "B01",
  mode: "answer",
  status: "PASS",
  outputsSuccessful: true,
  checks: checks(),
  failureExplanations: [],
  ...overrides,
});

test("frozen manifest contains ten cases and the exact 100-point weights", () => {
  assert.equal(manifest.cases.length, 10);
  assert.deepEqual(manifest.weightsPerCase, CATEGORY_WEIGHTS);
  assert.equal(manifest.maximumScore, 100);
  assert.equal(manifest.passScore, 100);
  assert.equal(CANONICAL_TOOL_NAMES.length, 14);
});
test("manifest identity, version, hash, and case ids are pinned before connection", () => {
  assert.equal(manifest.id, EXPECTED_MANIFEST_ID);
  assert.equal(manifest.version, EXPECTED_MANIFEST_VERSION);
  assert.doesNotThrow(() =>
    validateManifest(manifest, EXPECTED_MANIFEST_SHA256),
  );
  assert.throws(
    () =>
      validateManifest(
        { ...manifest, cases: manifest.cases.slice(0, 9) },
        EXPECTED_MANIFEST_SHA256,
      ),
    /exactly 10/,
  );
  assert.throws(() => validateManifest(manifest, "bad-hash"), /SHA-256/);
  assert.throws(
    () =>
      validateManifest(
        {
          ...manifest,
          cases: manifest.cases.map((item, index) =>
            index === 9 ? { ...item, id: "B01" } : item,
          ),
        },
        EXPECTED_MANIFEST_SHA256,
      ),
    /frozen B01-B10/,
  );
});

test("missing or not-run checks can never pass and score is not renormalized", () => {
  assert.equal(scoreCase(baseCase({ status: "BLOCKED" })).passed, false);
  assert.equal(
    scoreCase(baseCase({ checks: { ...checks(), honesty: [] } })).passed,
    false,
  );
  assert.equal(
    scoreCase({ ...baseCase(), outputsSuccessful: undefined }).passed,
    false,
  );
  const score = scoreBenchmark(
    [baseCase({ id: "B01" }), baseCase({ id: "B02", status: "BLOCKED" })],
    [],
  );
  assert.equal(score.passed, false);
  assert.equal(score.total, 10);
});
test("integrity violations fail the complete benchmark without a false 100", () => {
  const cases = Array.from({ length: 10 }, (_, index) =>
    baseCase({ id: `B${String(index + 1).padStart(2, "0")}` }),
  );
  const score = scoreBenchmark(cases, ["runner cleanup failed"]);
  assert.equal(score.total, 0);
  assert.equal(score.passed, false);
});

test("positive unsuccessful response receives zero points", () => {
  const scored = scoreCase(
    baseCase({ status: "FAIL", outputsSuccessful: false }),
  );
  assert.equal(scored.points, 0);
  assert.equal(scored.passed, false);
  assert.deepEqual(scored.categoryPoints, {
    identity: 0,
    value: 0,
    completeness: 0,
    honesty: 0,
  });
});
test("positive not-found wording still scores zero for an answer case", () => {
  const scored = scoreCase(
    baseCase({
      status: "PASS",
      outputsSuccessful: true,
      sanitizedOutputs: [
        { success: false, answer: "데이터를 찾을 수 없습니다." },
      ],
    }),
  );
  assert.equal(scored.points, 0);
  assert.equal(scored.passed, false);
});

test("provider/auth/timeout errors are not accepted as negative refusals", () => {
  const providerError = {
    success: false,
    validationLevel: "unverified",
    answer: "조회 중 오류가 발생했습니다: provider error",
  };
  assert.equal(
    validateRejectResponse(providerError, "nonexistent-region").ok,
    false,
  );
  const timeout = {
    success: false,
    validationLevel: "unverified",
    answer: "TIMEOUT",
  };
  assert.equal(validateRejectResponse(timeout, "ambiguous-region").ok, false);
});
test("secondary provider warnings do not turn a valid primary refusal into a technical failure", () => {
  const primaryRefusal = {
    success: false,
    validationLevel: "unverified",
    answer: "지역을 공식 메타데이터로 확인하지 못했습니다.",
    note: "부산 없는군 지역을 찾을 수 없습니다.",
    tableDiscovery: { status: "provider_error", error: "provider failed" },
  };
  assert.equal(hasPrimaryTechnicalFailure(primaryRefusal), false);
  assert.equal(
    validateRejectResponse(primaryRefusal, "nonexistent-region").ok,
    true,
  );
  assert.equal(
    hasPrimaryTechnicalFailure({ ...primaryRefusal, code: "TIMEOUT" }),
    true,
  );
  assert.equal(
    sanitizeValue(primaryRefusal).tableDiscovery.status,
    "provider_error",
  );
  assert.equal(
    hasPrimaryTechnicalFailure({ ...primaryRefusal, code: "METADATA_ERROR" }),
    true,
  );
  assert.equal(
    rejectHasDataOrNumericClaim({
      ...primaryRefusal,
      insights: ["인구는 41858명"],
    }),
    true,
  );
  assert.equal(
    rejectHasDataOrNumericClaim({ ...primaryRefusal, data: [{ DT: 41858 }] }),
    true,
  );
  assert.equal(
    rejectHasDataOrNumericClaim({
      ...primaryRefusal,
      answer: "2025년 인구는 41858명입니다.",
    }),
    true,
  );
  assert.equal(
    rejectHasDataOrNumericClaim({
      ...primaryRefusal,
      answer: "2025년 공식 코드 ITM_ID=46910의 지역은 확인되지 않았습니다.",
    }),
    false,
  );
  assert.equal(
    rejectHasDataOrNumericClaim({
      ...primaryRefusal,
      answer: "인구 regionCode=46910 지역은 확인되지 않았습니다.",
    }),
    false,
  );
});
test("causal denials are honest limitations, while unsupported assertions fail", () => {
  assert.equal(
    hasUnsupportedCausalClaim({
      summary: "관측값만으로 청년 유출 원인을 단정할 수 없다.",
    }),
    false,
  );
  assert.equal(
    hasUnsupportedCausalClaim({ summary: "인구 감소의 원인은 청년 유출이다." }),
    true,
  );
});
test("annual KOSIS A period normalizes only to annual Y", () => {
  assert.equal(normalizeObservedPeriodType("A", "Y"), "Y");
  assert.equal(normalizeObservedPeriodType("A", "M"), "A");
  assert.equal(
    validateOfficialObservation(
      { ...row("26000", "부산"), PRD_SE: "A" },
      {
        code: "26000",
        name: "부산",
        itemId: "T20",
        periodType: "Y",
        period: "2025",
      },
    ).ok,
    true,
  );
  assert.equal(
    validateOfficialObservation(
      { ...row("26000", "부산"), PRD_SE: "A" },
      {
        code: "26000",
        name: "부산",
        itemId: "T20",
        periodType: "M",
        period: "2025",
      },
    ).ok,
    false,
  );
  assert.equal(
    validatePopulationObservations([{ ...row("26000", "부산"), PRD_SE: "A" }], {
      code: "26000",
      name: "부산",
      itemId: "T20",
      periodType: "Y",
      year: 2025,
    }).ok,
    true,
  );
  assert.equal(
    validatePopulationObservations(
      [{ ...row("26000", "부산"), PRD_SE: "A", PRD_DE: "202501" }],
      {
        code: "26000",
        name: "부산",
        itemId: "T20",
        periodType: "Y",
        year: 2025,
      },
    ).ok,
    false,
  );
});
test("population trend requires post-baseline absoluteChange and changeRate", () => {
  const expected = { 2015: 100, 2016: 110, 2017: 105 };
  const years = [2015, 2016, 2017];
  const valid = [
    { year: "2015", value: 100, rawValue: "100" },
    {
      year: "2016",
      value: 110,
      rawValue: "110",
      absoluteChange: 10,
      changeRate: "+10.0%",
    },
    {
      year: "2017",
      value: 105,
      rawValue: "105",
      absoluteChange: -5,
      changeRate: "-4.5%",
    },
  ];
  assert.equal(
    validateTrendChanges(valid, expected, years, {
      requireDerivedChanges: true,
    }).ok,
    true,
  );
  assert.equal(
    validateTrendChanges(valid, expected, years, {
      requireDerivedChanges: true,
      requirePublicContract: true,
    }).ok,
    true,
  );
  assert.equal(
    validateTrendChanges(
      valid.map((point) => ({
        ...point,
        ...(point.year === "2017" ? { changeRate: undefined } : {}),
      })),
      expected,
      years,
      { requireDerivedChanges: true },
    ).ok,
    false,
  );
  assert.equal(
    validateTrendChanges(
      valid.map((point) => ({ ...point, value: undefined })),
      expected,
      years,
      { requireDerivedChanges: true, requirePublicContract: true },
    ).ok,
    false,
  );
  assert.equal(
    validateTrendChanges(
      valid.map((point) => ({
        ...point,
        ...(point.year === "2016" ? { absoluteChange: "10" } : {}),
      })),
      expected,
      years,
      { requireDerivedChanges: true, requirePublicContract: true },
    ).ok,
    false,
  );
  assert.equal(
    validateTrendChanges(
      valid.map((point) => ({
        ...point,
        ...(point.year === "2016" ? { absoluteChange: 11 } : {}),
      })),
      expected,
      years,
      { requireDerivedChanges: true },
    ).ok,
    false,
  );
});
test("B06/B07 rawValue must preserve the official DT representation", () => {
  const points = [
    { year: "2023", value: 123, rawValue: "00123" },
    { year: "2024", value: 456, rawValue: "456" },
  ];
  const expected = { 2023: 123, 2024: 456 };
  const official = validatePopulationObservations(
    [
      row("26260", "동래구", "2023", "00123"),
      row("26260", "동래구", "2024", "456"),
    ],
    {
      code: "26260",
      name: "동래구",
      itemId: "T20",
      periodType: "Y",
      startYear: 2023,
      endYear: 2024,
    },
  );
  assert.equal(official.ok, true);
  assert.deepEqual(official.rawValues, { 2023: "00123", 2024: "456" });
  assert.equal(
    validateTrendChanges(points, expected, [2023, 2024], {
      requirePublicContract: true,
      expectedRawValues: { 2023: "00123", 2024: "456" },
    }).ok,
    true,
  );
  assert.equal(
    validateTrendChanges(points, expected, [2023, 2024], {
      requirePublicContract: true,
      expectedRawValues: { 2023: "123", 2024: "456" },
    }).ok,
    false,
  );
});
test("candidate units must match known oracle units and cannot be invented", () => {
  assert.equal(validateCandidateUnit({ unit: "명" }, "명").ok, true);
  assert.equal(validateCandidateUnit({ unit: "%" }, "명").ok, false);
  assert.equal(
    validateCandidateUnit({}, undefined, { allowMissing: true }).ok,
    true,
  );
  assert.equal(
    validateCandidateUnit({ unit: "명" }, undefined, { allowMissing: true }).ok,
    false,
  );
  assert.equal(
    validateCandidateUnit({ source: { unit: "명" } }, undefined, {
      allowMissing: true,
    }).ok,
    false,
  );
});

test("wrong region identity is rejected even when the numeric value is equal", () => {
  const observation = validateOfficialObservation(row("11000", "중구"), {
    code: "26000",
    name: "중구",
    itemId: "T20",
    periodType: "Y",
    period: "2025",
  });
  assert.equal(observation.ok, false);
  const refusalWithNumber = {
    success: false,
    validationLevel: "unverified",
    value: 0,
    answer: "지역이 모호합니다. 상위 지역을 지정하세요.",
  };
  assert.equal(
    validateRejectResponse(refusalWithNumber, "ambiguous-region").ok,
    false,
  );
});
test("birth observations may preserve a missing official unit only as raw partial evidence", () => {
  const missingUnit = { ...row("26260", "동래구", "2023", "12"), ITM_ID: "T1" };
  delete missingUnit.UNIT_NM;
  const expected = {
    code: "26260",
    name: "동래구",
    itemId: "T1",
    periodType: "Y",
    year: 2023,
  };
  assert.equal(
    validatePopulationObservations([missingUnit], expected).ok,
    false,
  );
  assert.equal(
    validatePopulationObservations([missingUnit], {
      ...expected,
      allowMissingUnit: true,
    }).ok,
    true,
  );
});
test("unknown or invented units are rejected by the official observation validator", () => {
  const expected = {
    code: "26000",
    name: "부산",
    itemId: "T20",
    periodType: "Y",
    year: 2025,
  };
  assert.equal(
    validateOfficialObservation(row("26000", "부산"), expected).ok,
    true,
  );
  assert.equal(
    validateOfficialObservation(
      { ...row("26000", "부산"), UNIT_NM: "단위 미상" },
      expected,
    ).ok,
    false,
  );
  assert.deepEqual(oracleUnitStatus([{ UNIT_NM: "" }, { UNIT_NM: "" }]), {
    unit: undefined,
    known: false,
    missing: true,
  });
  assert.deepEqual(oracleUnitStatus([{ UNIT_NM: "명" }, { UNIT_NM: "" }]), {
    unit: undefined,
    known: false,
    missing: false,
  });
});

test("numeric zero is accepted only as an observed official zero", () => {
  assert.equal(
    validatePopulationObservations([row("26000", "부산", "2025", "0")], {
      code: "26000",
      name: "부산",
      itemId: "T20",
      periodType: "Y",
      year: 2025,
    }).ok,
    true,
  );
  assert.equal(
    validatePopulationObservations([row("26000", "부산", "2025", "-")], {
      code: "26000",
      name: "부산",
      itemId: "T20",
      periodType: "Y",
      year: 2025,
    }).ok,
    false,
  );
  assert.equal(
    validatePopulationObservations(
      [row("26000", "부산", "2025", "not-a-number")],
      {
        code: "26000",
        name: "부산",
        itemId: "T20",
        periodType: "Y",
        year: 2025,
      },
    ).ok,
    false,
  );
});

test("missing year and duplicate observations fail exact range validation", () => {
  const expected = {
    code: "26000",
    name: "부산",
    itemId: "T20",
    periodType: "Y",
    startYear: 2023,
    endYear: 2025,
  };
  assert.equal(
    validatePopulationObservations(
      [row("26000", "부산", "2023"), row("26000", "부산", "2025")],
      expected,
    ).ok,
    false,
  );
  assert.equal(
    validatePopulationObservations(
      [
        row("26000", "부산", "2023"),
        row("26000", "부산", "2024"),
        row("26000", "부산", "2024"),
      ],
      expected,
    ).ok,
    false,
  );
});

test("hierarchy resolution requires the nested municipality and rejects ambiguous historical paths", () => {
  const metadata = [
    { ITM_ID: "41", UP_ITM_ID: "", ITM_NM: "경기도" },
    { ITM_ID: "4111", UP_ITM_ID: "41", ITM_NM: "수원시" },
    { ITM_ID: "41117", UP_ITM_ID: "41", ITM_NM: "영통구" },
    { ITM_ID: "46910", UP_ITM_ID: "41", ITM_NM: "신안군" },
    { ITM_ID: "12870", UP_ITM_ID: "12", ITM_NM: "신안군" },
  ];
  assert.throws(
    () => resolveOfficialPath(metadata, ["경기도", "수원시", "영통구"]),
    /not found|ambiguous/,
  );
  assert.equal(
    officialPathCandidates(metadata, ["경기도", "영통구"])[0].code,
    "41117",
  );
  assert.throws(
    () => resolveOfficialPath(metadata, ["신안군"]),
    /not found|ambiguous/,
  );
});

test("historical metadata candidates are resolved by active-year C1 observations", () => {
  const metadata = [
    { ITM_ID: "36", UP_ITM_ID: "", ITM_NM: "전라남도" },
    { ITM_ID: "12", UP_ITM_ID: "", ITM_NM: "전라남도" },
    { ITM_ID: "46910", UP_ITM_ID: "36", ITM_NM: "신안군" },
    { ITM_ID: "12870", UP_ITM_ID: "12", ITM_NM: "신안군" },
  ];
  const candidates = officialPathCandidates(metadata, ["전남", "신안군"]);
  assert.equal(candidates.length, 2);
  const active = selectActiveOfficialCandidate(candidates, [
    row("46910", "신안군"),
  ]);
  assert.equal(active.candidate.code, "46910");
});
test("supplemental affiliation requires exact current code, province, and full municipality name", () => {
  const expected = {
    signguCode: "41117",
    provinceCode: "41",
    provinceName: "경기도",
    fullName: "수원시 영통구",
  };
  const row = {
    signguCd: "41117",
    ctprvnCd: "41",
    ctprvnNm: "경기도",
    signguNm: "수원시 영통구",
  };
  assert.equal(validateSupplementalAffiliation(row, expected).ok, true);
  assert.equal(
    validateSupplementalAffiliation(
      { ...row, ctprvnNm: "  경기도  " },
      expected,
    ).ok,
    true,
  );
  assert.equal(
    validateSupplementalAffiliation({ ...row, ctprvnNm: "경기" }, expected).ok,
    false,
  );
  assert.equal(
    validateSupplementalAffiliation({ ...row, signguNm: "영통구" }, expected)
      .ok,
    false,
  );
  assert.equal(
    validateSupplementalAffiliation({ ...row, ctprvnCd: "11" }, expected).ok,
    false,
  );
});
const businessPayload = (page, items, total = 6) => ({
  header: { resultCode: "00", resultMsg: "NORMAL", stdrYm: "202508" },
  body: { pageNo: page, numOfRows: 5, totalCount: total, items },
});
const businessItem = (id, code = "A001") => ({
  bizesId: id,
  signguCd: "26260",
  signguNm: "동래구",
  indsSclsCd: code,
  rdnmAdr: `부산 동래구 주소 ${id}`,
});

test("business page cardinality and duplicate IDs are enforced", () => {
  const expected = {
    page: 1,
    pageSize: 5,
    regionCode: "26260",
    regionField: "signguCd",
    regionName: "동래구",
    industryType: "indsSclsCd",
    industryCode: "A001",
  };
  assert.equal(
    validateBusinessPage(businessPayload(1, [businessItem("1")], 6), expected)
      .ok,
    false,
  );
  assert.equal(
    validateBusinessPage(
      businessPayload(
        1,
        Array.from({ length: 5 }, (_, i) => businessItem(String(i))),
        6,
      ),
      expected,
    ).ok,
    true,
  );
  const duplicate = [
    businessItem("1"),
    businessItem("1"),
    businessItem("2"),
    businessItem("3"),
    businessItem("4"),
  ];
  assert.equal(
    validateBusinessPage(businessPayload(1, duplicate, 5), expected).ok,
    false,
  );
  const pages = validateBusinessPages(
    [
      {
        payload: businessPayload(
          1,
          Array.from({ length: 5 }, (_, i) => businessItem(String(i))),
          6,
        ),
      },
      { payload: businessPayload(2, [businessItem("4")], 6) },
    ],
    expected,
  );
  assert.equal(pages.ok, false);
});

test("business query groups isolate duplicate checks while allowing legitimate cross-query overlap", () => {
  const unfilteredExpected = {
    page: 1,
    pageSize: 5,
    regionCode: "26260",
    regionField: "signguCd",
    regionName: "동래구",
  };
  const filteredExpected = {
    ...unfilteredExpected,
    industryType: "indsSclsCd",
    industryCode: "A001",
  };
  const unfiltered = [
    {
      payload: businessPayload(
        1,
        Array.from({ length: 5 }, (_, i) => businessItem(String(i))),
        5,
      ),
    },
  ];
  const filtered = [
    {
      payload: businessPayload(
        1,
        Array.from({ length: 5 }, (_, i) => businessItem(String(i))),
        5,
      ),
    },
  ];
  const grouped = validateBusinessQueryGroups(
    [unfiltered, filtered],
    [unfilteredExpected, filteredExpected],
  );
  assert.equal(grouped.ok, true);
});
test("sanitization removes credentials without changing ordinary observations", () => {
  const safe = sanitizeValue({
    value: 4,
    apiKey: "secret",
    endpoint: "https://example.test/x?apiKey=secret",
    nested: { serviceKey: "other" },
  });
  assert.equal(safe.value, 4);
  assert.equal("apiKey" in safe, false);
  assert.equal("serviceKey" in safe.nested, false);
  assert.match(safe.endpoint, /redacted/);
  assert.doesNotMatch(safe.endpoint, /\$1/);
  const ordinarySelector = sanitizeValue(
    "https://apis.data.go.kr/x?divId=signguCd&key=26260",
  );
  assert.match(ordinarySelector, /key=26260/);
  assert.match(
    sanitizeValue("https://example.test/x?serviceKey=secret"),
    /serviceKey=\[redacted\]/,
  );
});
test("bounded body aborts and cancels a nonterminating stream at one hard deadline", async () => {
  let cancelled = false;
  const oldFetch = globalThis.fetch;
  const stream = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      cancelled = true;
    },
  });
  globalThis.fetch = async () => new Response(stream, { status: 200 });
  try {
    await assert.rejects(
      boundedFetch(
        "https://example.test/mcp",
        {},
        { timeoutMs: 20, maxBytes: 1024, label: "fixture" },
      ),
      /timeout/i,
    );
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("category weights do not invent missing checks when an executed check covers the category", () => {
  const result = baseCase({
    checks: Object.fromEntries(
      Object.keys(CATEGORY_WEIGHTS).map((key) => [
        key,
        [
          {
            name: "complete-contract",
            pass: true,
            explanation: "all required fields checked",
          },
        ],
      ]),
    ),
  });
  fillMissingChecks(result);
  assert.equal(scoreCase(result).points, 10);
  assert.deepEqual(result.failureExplanations, []);
  result.checks.value = [];
  fillMissingChecks(result);
  assert.equal(scoreCase(result).passed, false);
  assert.match(result.failureExplanations[0], /value.not-run/);
});

test("business page identity comes from the requested ordered sequence, not provider echoes", () => {
  const pages = [
    businessPayload(
      1,
      Array.from({ length: 5 }, (_, i) => businessItem(String(i))),
      6,
    ),
    businessPayload(2, [businessItem("5")], 6),
  ];
  const expected = {
    pages: [1, 2],
    pageSize: 5,
    regionCode: "26260",
    regionName: "동래구",
  };
  assert.equal(validateBusinessPages(pages, expected).ok, true);
  assert.equal(validateBusinessPages([...pages].reverse(), expected).ok, false);
  assert.equal(validateBusinessPages(pages.slice(0, 1), expected).ok, false);
  assert.equal(validateBusinessPages([], expected).ok, false);
  const duplicate = [pages[0], businessPayload(2, [businessItem("4")], 6)];
  assert.match(
    validateBusinessPages(duplicate, expected).reason,
    /duplicate bizesId/,
  );
});

test("refusal diagnostics preserve encoded locality queries but never erase year-valued statistics", () => {
  const refusal = {
    success: false,
    validationLevel: "unverified",
    answer: '"인구"의 지역을 공식 메타데이터로 확인하지 못했습니다.',
    note: '공식 ITM 분류에서 요청 지역을 찾지 못했습니다. 국가 기본값으로 대체하지 않았습니다.\n검색 경로:\nget_table_info({"orgId":"101","tableId":"DT_1B040A3","infoType":"ITM","query":"부산 없는군"})\nsearch_statistics("부산 없는군")\nKOSIS official metadata: orgId=101, tableId=DT_1B040A3, query=%EB%B6%80%EC%82%B0%20%EC%97%86%EB%8A%94%EA%B5%B0',
  };
  assert.equal(
    validateRejectResponse(refusal, "nonexistent-region", 2025).ok,
    true,
  );
  assert.equal(
    rejectHasDataOrNumericClaim(
      { ...refusal, answer: "2025년 자료의 지역을 확인하지 못했습니다." },
      2025,
    ),
    false,
  );
  for (const answer of [
    "2025년 인구는 2025명입니다.",
    "이 지역은 2025명입니다.",
    "주민은 1234입니다.",
  ]) {
    assert.equal(
      rejectHasDataOrNumericClaim({ ...refusal, answer }, 2025),
      true,
      answer,
    );
  }
  assert.equal(
    rejectHasDataOrNumericClaim(
      { ...refusal, rawData: [{ DT: "2025" }] },
      2025,
    ),
    true,
  );
});
test("missing-unit birth narratives reject derived conclusions but allow explicit deferral", () => {
  const rawOnly = {
    dataPoints: [
      { year: "2023", value: 12, rawValue: "12" },
      { year: "2024", value: 10, rawValue: "10" },
    ],
    insights: [],
  };
  for (const [field, value] of [
    ["summary", "2024년 출생아수는 10명으로 감소했다."],
    ["trendDescription", "2023년에서 2024년으로 감소 추세다."],
    ["note", "전년 대비 출생아수가 줄었다."],
    ["answer", "출생아수는 10명이다."],
    ["caveats", ["출생아수는 10명으로 감소했다."]],
  ]) {
    assert.equal(
      hasDerivedTrendClaims({ ...rawOnly, [field]: value }),
      true,
      field,
    );
  }
  assert.equal(
    hasDerivedTrendClaims({
      ...rawOnly,
      summary: "단위가 확인되지 않아 추세 비교를 보류합니다.",
    }),
    false,
  );
  assert.equal(
    hasDerivedTrendClaims({
      ...rawOnly,
      caveats: ["정의와 단위를 확인할 수 없어 방향성 판단을 유보합니다."],
    }),
    false,
  );
  assert.equal(
    hasDerivedTrendClaims({
      ...rawOnly,
      summary:
        "원표 관측값은 확인했지만 파생 추세/변화율은 계산하지 않았습니다.",
    }),
    false,
  );
  assert.equal(
    hasDerivedTrendClaims({
      ...rawOnly,
      caveats: ["출생아수는 다음 해 8월에 확정됩니다."],
    }),
    false,
  );
});

test("trend validation rejects numeric prefix garbage and conflicting birth values", () => {
  const points = [
    { year: "2023", value: 100, rawValue: "100" },
    {
      year: "2024",
      value: 110,
      rawValue: "110",
      absoluteChange: 10,
      changeRate: "10.0%",
    },
  ];
  const expected = { 2023: 100, 2024: 110 };
  const options = { requireDerivedChanges: true, requirePublicContract: true };
  assert.equal(
    validateTrendChanges(points, expected, [2023, 2024], options).ok,
    true,
  );
  for (const changeRate of ["10.0garbage%", "10.0", "10.0%%"]) {
    assert.equal(
      validateTrendChanges(
        [points[0], { ...points[1], changeRate }],
        expected,
        [2023, 2024],
        options,
      ).ok,
      false,
    );
  }
  assert.equal(
    validateTrendChanges(
      [{ ...points[0], value: 999 }, points[1]],
      expected,
      [2023, 2024],
      { requirePublicContract: true },
    ).ok,
    false,
  );
  assert.equal(
    hasDerivedTrendClaims({ dataPoints: [points[0]], insights: [] }),
    false,
  );
  assert.equal(
    hasDerivedTrendClaims({ dataPoints: points, insights: [] }),
    true,
  );
  assert.equal(
    hasDerivedTrendClaims({ dataPoints: [points[0]], insights: ["증가 추세"] }),
    true,
  );
});
test("refusal diagnostics reject nonempty unknown payload fields", () => {
  const refusal = {
    success: false,
    validationLevel: "unverified",
    answer: "지역을 공식 메타데이터로 확인하지 못했습니다.",
    note: "상위 지역을 지정하세요.",
  };
  for (const key of ["payload", "result"]) {
    const withUnknown = { ...refusal, [key]: { value: 123 } };
    assert.equal(rejectHasDataOrNumericClaim(withUnknown, 2025), true, key);
    assert.equal(
      validateRejectResponse(withUnknown, "ambiguous-region", 2025).ok,
      false,
      key,
    );
  }
  assert.equal(
    validateRejectResponse(
      { ...refusal, payload: null },
      "ambiguous-region",
      2025,
    ).ok,
    true,
  );
});
