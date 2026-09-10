import assert from "node:assert/strict";
import test from "node:test";
const {
  resolveRegion,
  resolveRegionFromQuery,
  validateRegionRows,
  validateRequestedRows,
} = await import("../dist/utils/regionResolver.js");
const { QUICK_STATS_PARAMS } = await import("../dist/data/quickStatsParams.js");

const param = {
  orgId: "101",
  tableId: "FIXTURE_REGION",
  tableName: "공식 지역 분류 fixture",
  description: "인구",
  objL1: "SEX_TOTAL",
  objL2: "REGION_DEFAULT",
  objL3: "1234",
  itemId: "ITEM_TOTAL",
  unit: "명",
  supportedPeriods: ["Y"],
};

const metadataRows = [
  { OBJ_ID: "A", OBJ_NM: "행정구역", ITM_ID: "00", ITM_NM: "전국" },
  { OBJ_ID: "A", OBJ_NM: "행정구역", ITM_ID: "26", ITM_NM: "부산광역시" },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26140",
    ITM_NM: "서구",
    UP_ITM_ID: "26",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26170",
    ITM_NM: "동구",
    UP_ITM_ID: "26",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26200",
    ITM_NM: "영도구",
    UP_ITM_ID: "26",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26230",
    ITM_NM: "부산진구",
    UP_ITM_ID: "26",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26290",
    ITM_NM: "남구",
    UP_ITM_ID: "26",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26320",
    ITM_NM: "북구",
    UP_ITM_ID: "26",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26350",
    ITM_NM: "해운대구",
    UP_ITM_ID: "26",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26380",
    ITM_NM: "사하구",
    UP_ITM_ID: "26",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26410",
    ITM_NM: "금정구",
    UP_ITM_ID: "26",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26440",
    ITM_NM: "강서구",
    UP_ITM_ID: "26",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26470",
    ITM_NM: "연제구",
    UP_ITM_ID: "26",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26500",
    ITM_NM: "수영구",
    UP_ITM_ID: "26",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26530",
    ITM_NM: "사상구",
    UP_ITM_ID: "26",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26260",
    ITM_NM: "동래구",
    UP_ITM_ID: "26",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26710",
    ITM_NM: "기장군",
    UP_ITM_ID: "26",
  },
  { OBJ_ID: "A", OBJ_NM: "행정구역", ITM_ID: "31", ITM_NM: "경기도" },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "31090",
    ITM_NM: "수원시",
    UP_ITM_ID: "31",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "27110",
    ITM_NM: "중구",
    UP_ITM_ID: "27",
  },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "26110",
    ITM_NM: "중구",
    UP_ITM_ID: "26",
  },
  { OBJ_ID: "A", OBJ_NM: "행정구역", ITM_ID: "27", ITM_NM: "대구광역시" },
  { OBJ_ID: "A", OBJ_NM: "행정구역", ITM_ID: "11", ITM_NM: "서울특별시" },
  {
    OBJ_ID: "A",
    OBJ_NM: "행정구역",
    ITM_ID: "11500",
    ITM_NM: "강서구",
    UP_ITM_ID: "11",
  },
  { OBJ_ID: "B", OBJ_NM: "분류값", ITM_ID: "0000", ITM_NM: "전체" },
  { OBJ_ID: "B", OBJ_NM: "분류값", ITM_ID: "1000", ITM_NM: "분류" },
];

const sampleRows = [
  {
    ORG_ID: "101",
    TBL_ID: "FIXTURE_REGION",
    PRD_SE: "Y",
    PRD_DE: "2024",
    C1: "SEX_TOTAL",
    C1_OBJ_NM: "성별",
    C1_NM: "전체",
    C2: "REGION_DEFAULT",
    C2_OBJ_NM: "행정구역",
    C2_NM: "전국",
    C3: "1234",
    C3_OBJ_NM: "분류값",
    C3_NM: "전체",
    ITM_ID: "ITEM_TOTAL",
    ITM_NM: "인구",
    UNIT_NM: "명",
    DT: "100",
  },
];

const options = { metadataRows, sampleRows, useCache: false };
const noSuwonMetadata = metadataRows.filter((row) => row.ITM_NM !== "수원시");
const noSuwonOptions = {
  metadataRows: noSuwonMetadata,
  sampleRows,
  useCache: false,
};
const keywordMetadataRows = [
  ...metadataRows,
  // These are classification items, not geographic rows, despite ending in 구.
  {
    OBJ_ID: "B",
    OBJ_NM: "분류값",
    ITM_ID: "KW_ACTIVITY",
    ITM_NM: "경제활동인구",
  },
  {
    OBJ_ID: "B",
    OBJ_NM: "분류값",
    ITM_ID: "KW_INACTIVE",
    ITM_NM: "비경제활동인구",
  },
];
const keywordOptions = {
  metadataRows: keywordMetadataRows,
  sampleRows,
  useCache: false,
};
function createProvinceAliasFixture() {
  const provinces = [
    { full: "충청북도", aliases: ["충북"], code: "synthetic-province-cb" },
    { full: "충청남도", aliases: ["충남"], code: "synthetic-province-cn" },
    {
      full: "전라북도",
      aliases: ["전북특별자치도", "전북"],
      code: "synthetic-province-jb",
    },
    { full: "전라남도", aliases: ["전남"], code: "synthetic-province-jn" },
    { full: "경상북도", aliases: ["경북"], code: "synthetic-province-gb" },
    { full: "경상남도", aliases: ["경남"], code: "synthetic-province-gn" },
  ];
  const metadataRows = [
    {
      OBJ_ID: "SYNTHETIC_REGION",
      OBJ_NM: "행정구역",
      ITM_ID: "synthetic-national",
      ITM_NM: "전국",
    },
  ];
  for (const province of provinces) {
    metadataRows.push({
      OBJ_ID: "SYNTHETIC_REGION",
      OBJ_NM: "행정구역",
      ITM_ID: province.code,
      ITM_NM: province.full,
      UP_ITM_ID: "synthetic-national",
    });
    metadataRows.push({
      OBJ_ID: "SYNTHETIC_REGION",
      OBJ_NM: "행정구역",
      ITM_ID: `${province.code}-sinan`,
      ITM_NM: "신안군",
      UP_ITM_ID: province.code,
    });
    if (province.full === "전라남도") {
      metadataRows.push({
        OBJ_ID: "SYNTHETIC_REGION",
        OBJ_NM: "행정구역",
        ITM_ID: `${province.code}-haenam`,
        ITM_NM: "해남군",
        UP_ITM_ID: province.code,
      });
    }
  }
  const aliasParam = {
    ...param,
    orgId: "SYNTHETIC_ALIAS_ORG",
    tableId: "SYNTHETIC_ALIAS_TABLE",
  };
  const sampleRows = [
    {
      ORG_ID: aliasParam.orgId,
      TBL_ID: aliasParam.tableId,
      PRD_SE: "Y",
      C1: "SEX_TOTAL",
      C1_OBJ_NM: "성별",
      C1_NM: "전체",
      C2: "synthetic-national",
      C2_OBJ_NM: "행정구역",
      C2_NM: "전국",
      C3: "1234",
      C3_OBJ_NM: "분류값",
      C3_NM: "전체",
      ITM_ID: "ITEM_TOTAL",
      ITM_NM: "인구",
      UNIT_NM: "명",
      DT: "100",
    },
  ];
  return {
    param: aliasParam,
    options: {
      metadataRows,
      sampleRows,
      useCache: false,
      disableAlternativeDiscovery: true,
    },
    provinces,
  };
}

function jejuMetadata(objId, parentId, childId) {
  return [
    {
      OBJ_ID: objId,
      OBJ_NM: "구분",
      ITM_ID: parentId,
      ITM_NM: "제주특별자치도",
    },
    {
      OBJ_ID: objId,
      OBJ_NM: "구분",
      ITM_ID: childId,
      ITM_NM: "제주",
      UP_ITM_ID: parentId,
    },
  ];
}

function jejuSample(orgId, tableId, childId, value) {
  return [
    {
      ORG_ID: orgId,
      TBL_ID: tableId,
      PRD_SE: "M",
      PRD_DE: "202508",
      C1: childId,
      C1_OBJ_NM: "구분",
      C1_NM: "제주",
      DT: value,
      UNIT_NM: "μg/m³",
    },
  ];
}

const pm25MetadataRows = jejuMetadata(
  "13101128219A",
  "13102128219A.4100189",
  "13102128219A.4200190",
);
const pm25SampleRows = jejuSample(
  "106",
  "DT_106N_03_0200145",
  "13102128219A.4200190",
  "9",
);
const pm10MetadataRows = jejuMetadata(
  "13101128237A",
  "13102128237A.4100189",
  "13102128237A.4200190",
);
const pm10SampleRows = jejuSample(
  "106",
  "DT_106N_03_0200045",
  "13102128237A.4200190",
  "19",
);
const validationRow = {
  ORG_ID: "101",
  TBL_ID: "FIXTURE_REGION",
  PRD_SE: "Y",
  C1: "SEX_TOTAL",
  C3: "1234",
  ITM_ID: "ITEM_TOTAL",
  UNIT_NM: "명",
};

function resolved(region) {
  return resolveRegion(param, region, options);
}

test("공식 부모 경로를 사용해 동래구·기장군·수원시를 구분한다", async () => {
  const dongnae = await resolved("부산 동래구");
  const gijang = await resolved("기장군");
  const suwon = await resolved("경기도 수원시");
  assert.equal(dongnae.status, "resolved");
  assert.equal(dongnae.regionCode, "26260");
  assert.equal(gijang.regionCode, "26710");
  assert.equal(suwon.regionCode, "31090");
  assert.equal(dongnae.axis, 2);
  assert.equal(dongnae.dimensions.objL1, "SEX_TOTAL");
  assert.equal(dongnae.dimensions.objL2, "26260");
  assert.equal(dongnae.dimensions.objL3, "1234");
});
test("all sixteen 부산 districts resolve through their official 부산 parent", async () => {
  const names = [
    "중구",
    "서구",
    "동구",
    "영도구",
    "부산진구",
    "동래구",
    "남구",
    "북구",
    "해운대구",
    "사하구",
    "금정구",
    "강서구",
    "연제구",
    "수영구",
    "사상구",
    "기장군",
  ];
  for (const name of names) {
    const result = await resolved(`부산 ${name}`);
    assert.equal(result.status, "resolved", name);
    assert.equal(result.regionName, `부산광역시 ${name}`);
  }
});

test("parent-qualified 강서구 resolves while bare 강서구 remains ambiguous", async () => {
  const bare = await resolved("강서구");
  const busan = await resolved("부산 강서구");
  const seoul = await resolved("서울 강서구");
  assert.equal(bare.status, "ambiguous");
  assert.match(bare.clarification, /부산광역시.*강서구/);
  assert.match(bare.clarification, /서울특별시.*강서구/);
  assert.equal(busan.status, "resolved");
  assert.equal(busan.regionName, "부산광역시 강서구");
  assert.equal(seoul.status, "resolved");
  assert.equal(seoul.regionName, "서울특별시 강서구");
});

test("embedded province names in Busan district names do not create false components", async () => {
  const haeundae = await resolveRegionFromQuery(
    param,
    "부산 해운대구 인구",
    options,
  );
  const gangseo = await resolveRegionFromQuery(
    param,
    "부산 강서구 인구",
    options,
  );
  assert.equal(haeundae.status, "resolved");
  assert.equal(haeundae.regionName, "부산광역시 해운대구");
  assert.equal(gangseo.status, "resolved");
  assert.equal(gangseo.regionName, "부산광역시 강서구");
});

test("동명이인 중구는 전국이나 첫 행으로 대체하지 않고 clarification을 반환한다", async () => {
  const result = await resolved("중구");
  assert.equal(result.status, "ambiguous");
  assert.equal(result.regionCode, undefined);
  assert.match(result.clarification, /부산|대구/);
});

test("province와 county가 모두 있는 자연어에서는 county를 우선한다", async () => {
  const result = await resolveRegionFromQuery(
    param,
    "경기도 수원시 인구",
    options,
  );
  assert.equal(result.status, "resolved");
  assert.equal(result.regionCode, "31090");
});
test("province-only matches do not absorb an explicitly unmatched county", async () => {
  const result = await resolved("부산 없는군");
  assert.notEqual(result.status, "resolved");
  assert.equal(result.regionCode, undefined);
});

test("unknown shorthand plus a known keyword is not treated as a national default", async () => {
  const result = await resolveRegionFromQuery(
    param,
    "수원 인구",
    noSuwonOptions,
  );
  assert.equal(result.status, "not_found");
  assert.equal(result.regionCode, undefined);
});

test("a known city shorthand resolves through its official parent path", async () => {
  const direct = await resolved("수원");
  const natural = await resolveRegionFromQuery(param, "수원 인구", options);
  assert.equal(direct.status, "resolved");
  assert.equal(direct.regionCode, "31090");
  assert.equal(natural.status, "resolved");
  assert.equal(natural.regionCode, "31090");
});
test("polite request phrasing preserves known and unknown locality boundaries", async () => {
  const known = await resolveRegionFromQuery(
    param,
    "수원 알려주실래요",
    options,
  );
  const unknown = await resolveRegionFromQuery(
    param,
    "없는군 알려주실래요",
    options,
  );
  assert.equal(known.status, "resolved");
  assert.equal(known.regionCode, "31090");
  assert.equal(unknown.status, "not_found");
  assert.equal(unknown.regionCode, undefined);
});
test("bare witnessed locality shorthand resolves, but incompatible explicit suffixes fail closed", async () => {
  const gijang = await resolved("기장");
  const dongnae = await resolved("동래");
  const wrongGijang = await resolved("기장동");
  const wrongDongnae = await resolved("동래군");
  assert.equal(gijang.status, "resolved");
  assert.equal(gijang.regionCode, "26710");
  assert.equal(dongnae.status, "resolved");
  assert.equal(dongnae.regionCode, "26260");
  assert.notEqual(wrongGijang.status, "resolved");
  assert.equal(wrongGijang.regionCode, undefined);
  assert.notEqual(wrongDongnae.status, "resolved");
  assert.equal(wrongDongnae.regionCode, undefined);
});
test("conventional province abbreviations resolve through official metadata with synthetic codes", async () => {
  const fixture = createProvinceAliasFixture();
  for (const province of fixture.provinces) {
    for (const name of [province.full, ...province.aliases]) {
      const result = await resolveRegion(fixture.param, name, fixture.options);
      assert.equal(result.status, "resolved", name);
      assert.equal(result.regionCode, province.code, name);
      assert.equal(result.regionName, `전국 ${province.full}`, name);
    }
  }
});

test("province aliases qualify same-name counties and reject wrong parents or suffixes", async () => {
  const fixture = createProvinceAliasFixture();
  for (const province of fixture.provinces) {
    for (const name of [province.full, ...province.aliases]) {
      const result = await resolveRegion(
        fixture.param,
        `${name} 신안군`,
        fixture.options,
      );
      assert.equal(result.status, "resolved", name);
      assert.equal(result.regionCode, `${province.code}-sinan`, name);
      assert.equal(result.regionName, `전국 ${province.full} 신안군`, name);
    }
  }
  const query = await resolveRegionFromQuery(
    fixture.param,
    "전남 신안군 인구",
    fixture.options,
  );
  assert.equal(query.status, "resolved");
  assert.equal(query.regionCode, "synthetic-province-jn-sinan");
  assert.equal(query.regionName, "전국 전라남도 신안군");

  const bare = await resolveRegion(fixture.param, "신안군", fixture.options);
  assert.equal(bare.status, "ambiguous");
  assert.equal(bare.regionCode, undefined);

  const wrongParent = await resolveRegion(
    fixture.param,
    "충북 해남군",
    fixture.options,
  );
  assert.notEqual(wrongParent.status, "resolved");
  assert.equal(wrongParent.regionCode, undefined);

  const wrongSuffix = await resolveRegion(
    fixture.param,
    "전남 신안시",
    fixture.options,
  );
  assert.notEqual(wrongSuffix.status, "resolved");
  assert.equal(wrongSuffix.regionCode, undefined);
});

test("plain keywords and ordinary nonregional questions keep the national default", async () => {
  const keyword = await resolveRegionFromQuery(param, "인구", options);
  const question = await resolveRegionFromQuery(
    param,
    "인구가 어떻게 되나요?",
    options,
  );
  const politeQuestion = await resolveRegionFromQuery(
    param,
    "인구 알려주실래요",
    options,
  );
  const generic = await resolveRegionFromQuery(param, "인구 자료", options);
  assert.equal(keyword.status, "none");
  assert.equal(question.status, "none");
  assert.equal(politeQuestion.status, "none");
  assert.equal(generic.status, "none");
});
test("registered aliases stay national when metadata has nonregional items ending in 구", async () => {
  const keywords = [
    "평균수명",
    "경제성장률",
    "경제활동인구",
    "비경제활동인구",
    "월급",
    "의료인력",
  ];
  for (const keyword of keywords) {
    const selectedParam = QUICK_STATS_PARAMS[keyword];
    assert.ok(selectedParam, keyword);
    const result = await resolveRegionFromQuery(
      selectedParam,
      keyword,
      keywordOptions,
    );
    assert.equal(result.status, "none", keyword);
    assert.equal(result.regionCode, undefined, keyword);
  }
});

test("an unknown locality remains fail-closed when joined to a registered alias", async () => {
  const keywords = [
    "평균수명",
    "경제성장률",
    "경제활동인구",
    "비경제활동인구",
    "월급",
    "의료인력",
  ];
  for (const keyword of keywords) {
    const selectedParam = QUICK_STATS_PARAMS[keyword];
    const result = await resolveRegionFromQuery(
      selectedParam,
      `부산없는군${keyword}`,
      options,
    );
    assert.notEqual(result.status, "resolved", keyword);
    assert.equal(result.regionCode, undefined, keyword);
  }
});

test("an exact 제주 item outranks its administrative alias for PM2.5 and PM10", async () => {
  const cases = [
    [
      QUICK_STATS_PARAMS["PM2.5"],
      pm25MetadataRows,
      pm25SampleRows,
      "13102128219A.4200190",
      "13102128219A.4100189",
    ],
    [
      QUICK_STATS_PARAMS.PM10,
      pm10MetadataRows,
      pm10SampleRows,
      "13102128237A.4200190",
      "13102128237A.4100189",
    ],
  ];
  for (const [selectedParam, metadata, sample, childId, parentId] of cases) {
    const shorthand = await resolveRegion(selectedParam, "제주", {
      metadataRows: metadata,
      sampleRows: sample,
      useCache: false,
    });
    assert.equal(shorthand.status, "resolved");
    assert.equal(shorthand.regionCode, childId);
    assert.equal(shorthand.regionName, "제주특별자치도 제주");

    const explicitProvince = await resolveRegion(
      selectedParam,
      "제주특별자치도",
      {
        metadataRows: metadata,
        sampleRows: sample,
        useCache: false,
      },
    );
    assert.equal(explicitProvince.status, "resolved");
    assert.equal(explicitProvince.regionCode, parentId);
    assert.equal(explicitProvince.regionName, "제주특별자치도");
  }
});

test("unknown region is fail-closed and does not return the national default code", async () => {
  const result = await resolved("없는군");
  assert.equal(result.status, "not_found");
  assert.equal(result.regionCode, undefined);
  assert.ok(
    result.searchPath?.some((entry) => entry.includes("get_table_info")),
  );
});

test("dimension mapping is unverified when official group cannot be observed on Cn_OBJ_NM", async () => {
  const result = await resolveRegion(param, "동래구", {
    metadataRows,
    sampleRows: [{ ...sampleRows[0], C2_OBJ_NM: "관측되지 않은 축" }],
    useCache: false,
  });
  assert.equal(result.status, "unverified");
  assert.equal(result.regionCode, undefined);
});

test("final rows reject a wrong region and accept zero/negative observations", async () => {
  const result = await resolved("동래구");
  assert.equal(result.status, "resolved");
  const good = validateRegionRows(
    [
      {
        ORG_ID: "101",
        TBL_ID: "FIXTURE_REGION",
        PRD_SE: "Y",
        C2: "26260",
        ITM_ID: "ITEM_TOTAL",
        DT: "0",
      },
    ],
    param,
    result,
    "Y",
  );
  assert.equal(good.ok, true);
  const wrong = validateRegionRows(
    [
      {
        ORG_ID: "101",
        TBL_ID: "FIXTURE_REGION",
        PRD_SE: "Y",
        C2: "00",
        ITM_ID: "ITEM_TOTAL",
        DT: "100",
      },
    ],
    param,
    result,
    "Y",
  );
  assert.equal(wrong.ok, false);
});
test("missing scalar ITM_ID is unverified rather than accepted", async () => {
  const result = await resolved("동래구");
  const validation = validateRegionRows(
    [
      {
        ORG_ID: "101",
        TBL_ID: "FIXTURE_REGION",
        PRD_SE: "Y",
        C2: "26260",
        DT: "0",
      },
    ],
    param,
    result,
    "Y",
  );
  assert.equal(validation.ok, false);
  assert.equal(validation.validationLevel, "unverified");
});

test("wildcard selectors are validated by observed identities, not literal wildcard codes", () => {
  const dimensions = { objL1: "SEX_TOTAL", objL2: "*", objL3: "1234" };
  const single = validateRequestedRows(
    [{ ...validationRow, C2: "26350" }],
    { ...param, objL2: "*" },
    dimensions,
    "Y",
  );
  const multiple = validateRequestedRows(
    [
      { ...validationRow, C2: "26350" },
      { ...validationRow, C2: "26710" },
    ],
    { ...param, objL2: "*" },
    dimensions,
    "Y",
  );
  const unidentified = validateRequestedRows(
    [
      { ...validationRow, C2: undefined },
      { ...validationRow, C2: undefined },
    ],
    { ...param, objL2: "*" },
    dimensions,
    "Y",
  );
  const scalarAmbiguous = validateRequestedRows(
    [
      { ...validationRow, C2: "26350" },
      { ...validationRow, C2: "26710" },
    ],
    param,
    { ...dimensions, objL2: "26350" },
    "Y",
  );
  for (const selector of ["ALL", "SUM", "26350,26710"]) {
    const validation = validateRequestedRows(
      [
        { ...validationRow, C2: "26350" },
        { ...validationRow, C2: "26710" },
      ],
      { ...param, objL2: selector },
      { ...dimensions, objL2: selector },
      "Y",
    );
    assert.equal(validation.ok, true);
  }
  assert.equal(single.ok, true);
  assert.equal(multiple.ok, true);
  assert.equal(unidentified.ok, false);
  assert.equal(scalarAmbiguous.ok, false);
});
test("period validation normalizes witnessed annual A to public Y but rejects M", () => {
  const annual = validateRegionRows(
    [
      {
        ORG_ID: "101",
        TBL_ID: "FIXTURE_REGION",
        PRD_SE: " A ",
        C2: "26350",
        ITM_ID: "ITEM_TOTAL",
        DT: "0",
      },
    ],
    param,
    {
      status: "resolved",
      axis: 2,
      regionCode: "26350",
    },
    "Y",
  );
  const monthly = validateRegionRows(
    [
      {
        ORG_ID: "101",
        TBL_ID: "FIXTURE_REGION",
        PRD_SE: "M",
        C2: "26350",
        ITM_ID: "ITEM_TOTAL",
        DT: "0",
      },
    ],
    param,
    {
      status: "resolved",
      axis: 2,
      regionCode: "26350",
    },
    "Y",
  );
  assert.equal(annual.ok, true);
  assert.equal(monthly.ok, false);
});
function nestedAffiliationFixture(axis = 1, { duplicateLeaves = false } = {}) {
  const root = "root-synthetic-z9";
  const province = "41";
  const leaf = "41117";
  const metadataRows = [
    {
      OBJ_ID: "geo-synthetic-x7",
      OBJ_NM: "행정구역",
      ITM_ID: root,
      ITM_NM: "전국",
    },
    {
      OBJ_ID: "geo-synthetic-x7",
      OBJ_NM: "행정구역",
      ITM_ID: province,
      ITM_NM: "경기도",
      UP_ITM_ID: root,
    },
    {
      OBJ_ID: "geo-synthetic-x7",
      OBJ_NM: "행정구역",
      ITM_ID: leaf,
      ITM_NM: "영통구",
      UP_ITM_ID: province,
    },
    ...(duplicateLeaves
      ? [
          {
            OBJ_ID: "geo-synthetic-x7",
            OBJ_NM: "행정구역",
            ITM_ID: "leaf-second",
            ITM_NM: "영통구",
            UP_ITM_ID: province,
          },
        ]
      : []),
  ];
  const sampleRows = [
    {
      [`C${axis}`]: leaf,
      [`C${axis}_OBJ_NM`]: "행정구역",
      [`C${axis}_NM`]: "영통구",
      ITM_ID: "ITEM_TOTAL",
      ORG_ID: "nested-org",
      TBL_ID: "nested-table",
      PRD_SE: "Y",
    },
  ];
  const param = {
    orgId: "nested-org",
    tableId: "nested-table",
    tableName: "공식 지역 분류 fixture",
    description: "인구",
    objL1: "SEX_TOTAL",
    objL2: "REGION_DEFAULT",
    itemId: "ITEM_TOTAL",
    unit: "명",
    supportedPeriods: ["Y"],
  };
  return { param, metadataRows, sampleRows, leaf };
}

test("province-only KOSIS ancestry resolves B02 through one exact current affiliation", async () => {
  const fixture = nestedAffiliationFixture();
  const calls = [];
  const result = await resolveRegion(fixture.param, "경기 수원시 영통구", {
    ...fixture,
    useCache: false,
    signguAffiliationLookup: async (signguCode) => {
      calls.push(signguCode);
      return {
        status: "found",
        ctprvnCd: "41",
        ctprvnNm: "경기도",
        signguCd: "41117",
        signguNm: "수원시 영통구",
        observedAt: "2026-09-10T00:00:00.000Z",
        stdrYm: "202507",
      };
    },
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.regionCode, "41117");
  assert.equal(result.regionName, "경기도 수원시 영통구");
  assert.equal(result.axis, 1);
  assert.equal(result.dimensions.objL1, "41117");
  assert.deepEqual(calls, ["41117"]);
  assert.ok(
    result.caveats?.some(
      (caveat) =>
        caveat.includes("current_name_affiliation_not_historical_boundary") &&
        caveat.includes("수원시 영통구") &&
        caveat.includes("2026-09-10T00:00:00.000Z") &&
        caveat.includes("202507"),
    ),
  );
});

test("complete KOSIS ancestry resolves without current affiliation lookup and preserves C2 axis", async () => {
  const complete = nestedAffiliationFixture(2);
  complete.metadataRows.splice(2, 0, {
    OBJ_ID: "geo-synthetic-x7",
    OBJ_NM: "행정구역",
    ITM_ID: "city-synthetic",
    ITM_NM: "수원시",
    UP_ITM_ID: "41",
  });
  complete.metadataRows[3].UP_ITM_ID = "city-synthetic";
  let calls = 0;
  const result = await resolveRegion(complete.param, "경기 수원시 영통구", {
    ...complete,
    useCache: false,
    signguAffiliationLookup: async () => {
      calls += 1;
      throw new Error("complete path must not call provider");
    },
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.regionCode, "41117");
  assert.equal(result.axis, 2);
  assert.equal(result.dimensions.objL2, "41117");
  assert.equal(calls, 0);
});

test("current affiliation failures and mismatches remain unverified, while unsafe candidates make no call", async () => {
  const outcomes = [
    { status: "no_rows" },
    { status: "incomplete_row", missingFields: ["ctprvnNm"] },
    new Error("hostile provider URL?serviceKey=secret"),
    {
      status: "found",
      ctprvnCd: "99",
      ctprvnNm: "경기도",
      signguCd: "41117",
      signguNm: "수원시 영통구",
      observedAt: "2026-09-10T00:00:00.000Z",
    },
    {
      status: "found",
      ctprvnCd: "41",
      ctprvnNm: "충청남도",
      signguCd: "41117",
      signguNm: "수원시 영통구",
      observedAt: "2026-09-10T00:00:00.000Z",
    },
    {
      status: "found",
      ctprvnCd: "41",
      ctprvnNm: "경기",
      signguCd: "41117",
      signguNm: "수원시 영통구",
      observedAt: "2026-09-10T00:00:00.000Z",
    },
    {
      status: "found",
      ctprvnCd: "41",
      ctprvnNm: "경기도",
      signguCd: "41118",
      signguNm: "수원시 영통구",
      observedAt: "2026-09-10T00:00:00.000Z",
    },
    {
      status: "found",
      ctprvnCd: "41",
      ctprvnNm: "경기도",
      signguCd: "41117",
      signguNm: "영통구",
      observedAt: "2026-09-10T00:00:00.000Z",
    },
  ];
  for (const outcome of outcomes) {
    const fixture = nestedAffiliationFixture();
    let calls = 0;
    const result = await resolveRegion(fixture.param, "경기 수원시 영통구", {
      ...fixture,
      useCache: false,
      signguAffiliationLookup: async () => {
        calls += 1;
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    });
    assert.equal(result.status, "unverified");
    assert.equal(result.regionCode, undefined);
    assert.equal(calls, 1);
    assert.doesNotMatch(result.reason ?? "", /serviceKey=secret/);
  }

  for (const requested of [
    "충남 수원시 영통구",
    "경기 수원시 영통동",
    "경기 수원시 영통구 엉뚱한시",
  ]) {
    const fixture = nestedAffiliationFixture();
    let calls = 0;
    const result = await resolveRegion(fixture.param, requested, {
      ...fixture,
      useCache: false,
      signguAffiliationLookup: async () => {
        calls += 1;
        return {
          status: "found",
          ctprvnCd: "41",
          ctprvnNm: "경기도",
          signguCd: "41117",
          signguNm: "수원시 영통구",
          observedAt: "2026-09-10T00:00:00.000Z",
        };
      },
    });
    assert.notEqual(result.status, "resolved", requested);
    assert.equal(calls, 0, requested);
  }

  const duplicate = nestedAffiliationFixture(1, { duplicateLeaves: true });
  let duplicateCalls = 0;
  const duplicateResult = await resolveRegion(
    duplicate.param,
    "경기 수원시 영통구",
    {
      ...duplicate,
      useCache: false,
      signguAffiliationLookup: async () => {
        duplicateCalls += 1;
        return { status: "no_rows" };
      },
    },
  );
  assert.equal(duplicateResult.status, "ambiguous");
  assert.equal(duplicateCalls, 0);
});

test("missing business-affiliation credentials identify the business key without reflecting raw errors", async () => {
  const { BusinessesApiError } = await import("../dist/api/businesses.js");
  const fixture = nestedAffiliationFixture();
  let calls = 0;
  const result = await resolveRegion(fixture.param, "경기 수원시 영통구", {
    ...fixture,
    useCache: false,
    signguAffiliationLookup: async () => {
      calls += 1;
      throw new BusinessesApiError("INVALID_API_KEY", "SENTINEL_CREDENTIAL");
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, "unverified");
  assert.equal(result.regionCode, undefined);
  assert.match(result.reason, /DATA_GO_KR_SERVICE_KEY/);
  assert.doesNotMatch(result.reason, /KOSIS_API_KEY|SENTINEL_CREDENTIAL/);
});
