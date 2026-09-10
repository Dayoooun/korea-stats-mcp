import assert from "node:assert/strict";
import { test } from "node:test";

const {
  MdisClient,
  MDIS_BASE_URL,
  MDIS_CATALOG_PATH,
  MDIS_DETAIL_PATH,
  MDIS_VARIABLE_PATH,
  MDIS_CODEBOOK_PATH,
  MDIS_SERVICE_CATALOG_PATH,
  MDIS_SERVICE_POPUP_PATH,
  resetMdisClientForTests,
} = await import("../dist/api/mdis.js");
const { searchMicrodata, getMicrodataInfo } =
  await import("../dist/tools/mdis.js");

const catalogHtml = `<!doctype html><html><body>
<form action="/oneidsso/ssoItgrAuthRet.do"><input type="hidden" name="SYS_CD" value="public-shell"></form>
<script>function sharedError() { return '오류가 발생'; }</script>
<div class="board_list"><table><tbody>
  <tr class="notice"><td><a class="underline" id="STAT_47"><span>경제활동인구조사</span></a></td><td>공개 조사</td></tr>
  <tr class="notice"><td><a class="underline" id="SURV_88"><span>다른 공개 조사</span></a></td><td>보건</td></tr>
</tbody></table></div></body></html>`;

const detailHtml = `<!doctype html><html><body><div class="board_list"><table><tbody>
  <tr><td>연간자료</td><td><a onclick="trDataArea(this,'MAPP_000000000000092','50149167','1','2026')">선택</a><button onclick="fnExcelDownload('MAPP_000000000000092','2026','50149167','50149711')">코드북</button></td></tr>
  <tr><td>청년층</td><td><a onclick="trDataArea(this,'MAPP_000000000000093','50149168','1','2026')">선택</a><button onclick="fnExcelDownload('MAPP_000000000000093','2026','50149168','50149712')">코드북</button></td></tr>
</tbody></table></div><button onclick="fnOpenDownLoad('2004','47')">일반자료</button><button onclick="fnOpenRAS('2004','47')">RAS</button><button onclick="fnOpenSDC('2004','47')">SDC</button></body></html>`;
const serviceCatalogHtml = `<!doctype html><html><body><table><tbody>
  <tr><td>기업사업체연계정보</td><td>2024</td><td>-</td><td>연간자료(인가용)</td><td>4</td><td>4</td><td><button onclick="fnItemDataList('MAPP_TEST','1','2024  ','기업사업체연계정보','','','PMS_TEST')">선택</button></td></tr>
</tbody></table></body></html>`;
const servicePopupHtml = `<!doctype html><html><body>
<input type="hidden" name="itmDiv" value="1">
<script>function reportFailure() { return '오류가 발생했습니다'; }</script>
<table><thead>
  <tr><th>번호</th><th>항목명</th><th>자료형</th><th>공개</th><th>RAS</th><th>SDC</th></tr>
</thead><tbody>
  <tr><td>1</td><td>조사기준연도</td><td>텍스트</td><td>-</td><td>O</td><td>O</td></tr>
  <tr><td>2</td><td>사업체고유번호</td><td>텍스트</td><td>-</td><td>O</td><td>O</td></tr>
  <tr><td>3</td><td>통계등록부_기업대표여부</td><td>코드</td><td>-</td><td>O</td><td>O</td></tr>
  <tr><td>4</td><td>BR_기업체고유번호</td><td>텍스트</td><td>-</td><td>O</td><td>O</td></tr>
</tbody></table><button onclick="fnExcelDownload('MAPP_TEST','2024','','PMS_TEST')">코드북</button></body></html>`;
const nonblankServiceCatalogHtml = serviceCatalogHtml.replace(
  "</tbody>",
  `<tr><td>비공개자료</td><td>2024</td><td>-</td><td>비공개자료</td><td>4</td><td>4</td><td><button onclick="fnItemDataList('MAPP_NONBLANK','1','2024','비공개자료','SURV_AREA','OFR_AREA','PMS_NONBLANK')">선택</button></td></tr></tbody>`,
);
const nonblankServicePopupHtml = servicePopupHtml
  .replaceAll("MAPP_TEST", "MAPP_NONBLANK")
  .replace("'2024','','PMS_TEST'", "'2024','OFR_AREA','PMS_NONBLANK'");

function response(body, headers = {}) {
  return new Response(body, { status: 200, headers });
}
function cfbXlsHeaderFixture(byteLength = 512) {
  const bytes = new Uint8Array(byteLength);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(24, 0x003b, true);
  view.setUint16(26, 3, true);
  view.setUint16(28, 0xfffe, true);
  view.setUint16(30, 9, true);
  view.setUint16(32, 6, true);
  return bytes;
}

function fixtureFetch(handler) {
  const seen = [];
  const fetchImpl = async (url, options = {}) => {
    seen.push({ url: String(url), options });
    return handler(String(url), options, seen.length);
  };
  return { fetchImpl, seen };
}

test("catalogue is parsed from public rows, filtered locally, and sends anonymous browser headers", async () => {
  const fixture = fixtureFetch((url, options) => {
    const pathname = new URL(url).pathname;
    assert.equal(pathname, MDIS_CATALOG_PATH);
    assert.equal(options.headers["User-Agent"], "Mozilla/5.0");
    assert.equal(options.headers.Accept, "text/html");
    if (fixture.seen.length === 1) {
      assert.equal(options.headers.Cookie, undefined);
      return response(catalogHtml, {
        "set-cookie": "JSESSIONID=anonymous-fixture; Path=/",
      });
    }
    assert.equal(fixture.seen.length, 2);
    assert.equal(options.headers.Cookie, "JSESSIONID=anonymous-fixture");
    return response(catalogHtml);
  });
  const client = new MdisClient({
    fetchImpl: fixture.fetchImpl,
  });
  const result = await client.searchCatalog({
    query: "경제활동",
    pageSize: 20,
  });
  const second = await client.searchCatalog({
    query: "경제활동",
    pageSize: 20,
  });
  assert.equal(result.items.length, 1);
  assert.equal(second.items.length, 1);
  assert.equal(result.items[0].survId, "47");
  assert.equal(result.items[0].itmDiv, "1");
  assert.equal(result.total, 1);
  assert.equal(result.source.includes("공공 웹"), true);
  assert.deepEqual(
    fixture.seen.map(({ url }) => new URL(url).pathname),
    [MDIS_CATALOG_PATH, MDIS_CATALOG_PATH],
  );
  assert.equal(JSON.stringify(result).includes("anonymous-fixture"), false);
  assert.equal(JSON.stringify(second).includes("anonymous-fixture"), false);
});

test("detail preserves every observed dataset and manual access routes without selecting the first dataset", async () => {
  const fixture = fixtureFetch((url) => {
    const pathname = new URL(url).pathname;
    assert.equal(pathname, MDIS_DETAIL_PATH);
    const parsed = new URL(url).searchParams;
    assert.equal(parsed.get("survId"), "47");
    assert.equal(parsed.get("itmDiv"), "1");
    assert.equal(parsed.get("itemId"), "");
    return response(detailHtml);
  });
  const result = await new MdisClient({
    fetchImpl: fixture.fetchImpl,
  }).getDetail({ survId: "47", itmDiv: "1" });
  assert.equal(result.datasets.length, 2);
  assert.deepEqual(
    result.datasets.map((item) => item.mappId),
    ["MAPP_000000000000092", "MAPP_000000000000093"],
  );
  assert.equal(result.datasets[0].survAreaId, "50149167");
  assert.equal(result.datasets[0].pmsSurvAreaId, "50149711");
  assert.equal(
    result.actions.map((item) => item.functionName).join(","),
    "fnOpenDownLoad,fnOpenRAS,fnOpenSDC",
  );
  assert.ok(result.actions[0].url.includes("/dwnlSvc/ofrSurvSearch.do"));
});

test("variables use the selected form, preserve official fields, paginate, and reject a foreign survey", async () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({
    mappId: "MAPP_000000000000092",
    survId: "47",
    survNm: "경제활동인구조사",
    ofrSurvAreaId: "50149167",
    ofrSurvAreaNm: "연간자료",
    pmsSurvAreaId: "50149711",
    pmsSurvAreaNm: "연간자료",
    stdItmId: `ITEM_${index}`,
    rspnUnitNm: "가구",
    stdItmNm: index === 2 ? "성별코드" : `변수 ${index}`,
    ofrSurvYm: "2026",
    itmDiv: "1",
    itmOrdVal: String(index),
    itmCmpstId: "",
    rspnGrpId: "",
    unifCdUseYn: "Y",
    cdShpeRspnYn: "Y",
    ofrItmYn: "Y",
    pmsItmYn: "Y",
    rasPmsItmCd: "",
    rdcPmsItmCd: "",
  }));
  const fixture = fixtureFetch((url, options) => {
    assert.equal(new URL(url).pathname, MDIS_VARIABLE_PATH);
    assert.equal(options.method, "POST");
    assert.equal(
      options.headers["Content-Type"],
      "application/x-www-form-urlencoded",
    );
    const form = new URLSearchParams(options.body);
    assert.equal(form.get("mappId"), "MAPP_000000000000092");
    assert.equal(form.get("survAreaId"), "50149167");
    assert.equal(form.get("itmDiv"), "1");
    assert.equal(form.get("ofrSurvYm"), "2026");
    return response(JSON.stringify({ itmList: rows }), {
      "content-type": "application/json",
    });
  });
  const client = new MdisClient({ fetchImpl: fixture.fetchImpl });
  const result = await client.getVariables({
    mappId: "MAPP_000000000000092",
    survAreaId: "50149167",
    itmDiv: "1",
    ofrSurvYm: "2026",
    survId: "47",
    variablePage: 2,
    pageSize: 2,
  });
  assert.equal(result.variables.length, 1);
  assert.equal(result.variables[0].stdItmNm, "성별코드");
  assert.equal(result.identityStatus, "verified");

  const foreign = new MdisClient({
    fetchImpl: fixtureFetch((url) => {
      return response(
        JSON.stringify({ itmList: [{ ...rows[0], survId: "999" }] }),
      );
    }).fetchImpl,
  });
  await assert.rejects(
    foreign.getVariables({
      mappId: "MAPP_000000000000092",
      survAreaId: "50149167",
      itmDiv: "1",
      ofrSurvYm: "2026",
      survId: "47",
    }),
    { code: "RESPONSE_MISMATCH" },
  );
});

test("codebook request includes itmDiv and returns bounded descriptor rather than file bytes", async () => {
  const bytes = cfbXlsHeaderFixture();
  const fixture = fixtureFetch((url, options) => {
    assert.equal(new URL(url).pathname, MDIS_CODEBOOK_PATH);
    const form = new URLSearchParams(options.body);
    assert.equal(form.get("itmDiv"), "1");
    assert.equal(form.get("curMenuNo"), "");
    return response(bytes, {
      "content-type": "application/vnd.ms-excel; charset=utf8",
      "content-disposition": "attachment; filename=codebook.xls",
    });
  });
  const descriptor = await new MdisClient({
    fetchImpl: fixture.fetchImpl,
  }).downloadCodebook({
    mappId: "MAPP_000000000000092",
    ofrSurvYm: "2026",
    ofrSurvAreaId: "50149167",
    pmsSurvAreaId: "50149711",
    itmDiv: "1",
  });
  assert.equal(descriptor.byteLength, bytes.length);
  assert.equal(
    descriptor.contentType.includes("application/vnd.ms-excel"),
    true,
  );
  assert.equal("base64" in descriptor, false);
  assert.equal(descriptor.source.form.itmDiv, "1");
  assert.deepEqual(descriptor.validation, {
    level: "header-only",
    format: "cfb-xls",
    signature: "d0cf11e0a1b11ae1",
    headerBytes: 512,
    minorVersion: 0x003b,
    majorVersion: 3,
    byteOrder: "little-endian",
    sectorShift: 9,
    sectorSize: 512,
    miniSectorShift: 6,
    aligned: true,
  });
});
test("service counts never mistake the survey year for an unavailable service", async () => {
  const fixture = fixtureFetch((url) =>
    response(
      new URL(url).pathname === MDIS_SERVICE_CATALOG_PATH
        ? serviceCatalogHtml.replace(
            "<td>4</td><td>4</td>",
            "<td>-</td><td>4</td>",
          )
        : "<html><title>MDIS</title></html>",
    ),
  );
  const result = await new MdisClient({
    fetchImpl: fixture.fetchImpl,
  }).getServiceItems({});
  assert.deepEqual(result.items[0].availability, {
    public: "-",
    ras: "-",
    sdc: "4",
  });
});
test("service-items metadata follows the observed catalogue, popup, and blank-area codebook form", async () => {
  const bytes = cfbXlsHeaderFixture();
  const fixture = fixtureFetch((url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === MDIS_SERVICE_CATALOG_PATH)
      return response(serviceCatalogHtml);
    if (parsed.pathname === MDIS_SERVICE_POPUP_PATH) {
      assert.equal(
        options.headers.Referer,
        `${MDIS_BASE_URL}${MDIS_SERVICE_CATALOG_PATH}?curMenuNo=UI_POR_P9230`,
      );
      assert.equal(parsed.searchParams.get("mappId"), "MAPP_TEST");
      assert.equal(parsed.searchParams.get("itmDiv"), "1");
      assert.equal(parsed.searchParams.get("ofrSurvYm"), "2024");
      assert.equal(parsed.searchParams.get("survAreaId"), "");
      assert.equal(parsed.searchParams.get("ofrSurvAreaId"), "");
      assert.equal(parsed.searchParams.get("pmsSurvAreaId"), "PMS_TEST");
      return response(servicePopupHtml);
    }
    assert.equal(parsed.pathname, MDIS_CODEBOOK_PATH);
    const form = new URLSearchParams(options.body);
    assert.equal(form.get("mappId"), "MAPP_TEST");
    assert.equal(form.get("itmDiv"), "1");
    assert.equal(form.get("ofrSurvYm"), "2024");
    assert.equal(form.get("ofrSurvAreaId"), "");
    assert.equal(form.get("pmsSurvAreaId"), "PMS_TEST");
    return response(bytes, { "content-type": "application/vnd.ms-excel" });
  });
  const client = new MdisClient({ fetchImpl: fixture.fetchImpl });
  const listing = await client.getServiceItems({
    query: "기업사업체",
    pageSize: 1,
  });
  assert.equal(listing.items.length, 1);
  assert.equal(listing.items[0].ofrSurvYm, "2024");
  assert.equal(listing.items[0].availability.public, "-");
  assert.equal(listing.items[0].availability.ras, "4");
  assert.equal(listing.items[0].availability.sdc, "4");
  const first = await client.getServiceItems({
    mappId: "MAPP_TEST",
    itmDiv: "1",
    ofrSurvYm: "2024",
    variablePage: 1,
    pageSize: 2,
  });
  assert.equal(first.variableNextPage, 2);
  assert.equal(first.variableHasMore, true);
  assert.deepEqual(
    first.variables.map((row) => row.stdItmNm),
    ["조사기준연도", "사업체고유번호"],
  );
  const selected = await client.getServiceItems({
    mappId: "MAPP_TEST",
    itmDiv: "1",
    ofrSurvYm: "2024",
    variablePage: 2,
    pageSize: 2,
    downloadCodebook: true,
  });
  assert.equal(selected.variables.length, 2);
  assert.equal(selected.variableTotal, 4);
  assert.equal(selected.variableNextPage, null);
  assert.equal(selected.variableHasMore, false);
  assert.deepEqual(
    selected.variables.map((row) => row.stdItmNm),
    ["통계등록부_기업대표여부", "BR_기업체고유번호"],
  );
  assert.equal(selected.codebook.source.form.ofrSurvAreaId, "");
  assert.equal(selected.codebook.validation.format, "cfb-xls");
  assert.equal(selected.codebook.source.form.itmDiv, "1");
  await assert.rejects(
    client.downloadCodebook({
      mappId: "MAPP_TEST",
      ofrSurvYm: "2024",
      ofrSurvAreaId: "",
      pmsSurvAreaId: "PMS_TEST",
      itmDiv: "1",
    }),
    { code: "INVALID_INPUT" },
  );
  await assert.rejects(
    client.getServiceItems({ query: "기업사업체", variablePage: 2 }),
    { code: "SELECTION_REQUIRED" },
  );
  await assert.rejects(
    client.getServiceItems({ query: "기업사업체", downloadCodebook: true }),
    { code: "SELECTION_REQUIRED" },
  );
});

test("service-items preserves nonblank provider area identifiers without inferring geography", async () => {
  const fixture = fixtureFetch((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === MDIS_SERVICE_CATALOG_PATH)
      return response(nonblankServiceCatalogHtml);
    assert.equal(parsed.pathname, MDIS_SERVICE_POPUP_PATH);
    assert.equal(parsed.searchParams.get("survAreaId"), "SURV_AREA");
    assert.equal(parsed.searchParams.get("ofrSurvAreaId"), "OFR_AREA");
    return response(nonblankServicePopupHtml);
  });
  const page = await new MdisClient({
    fetchImpl: fixture.fetchImpl,
  }).getServiceItems({
    mappId: "MAPP_NONBLANK",
    itmDiv: "1",
    ofrSurvYm: "2024",
  });
  assert.equal(page.selection.survAreaId, "SURV_AREA");
  assert.equal(page.selection.ofrSurvAreaId, "OFR_AREA");
  assert.equal(page.popupSource.includes("survAreaId=SURV_AREA"), true);
  assert.equal(page.popupSource.includes("ofrSurvAreaId=OFR_AREA"), true);
  resetMdisClientForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fixture.fetchImpl;
  try {
    const result = await getMicrodataInfo({
      metadataSource: "service_items",
      mappId: "MAPP_NONBLANK",
      itmDiv: "1",
      ofrSurvYm: "2024",
    });
    assert.equal(result.success, true);
    assert.deepEqual(result.space, {
      status: "provider_area_identifiers_only",
      area: { survAreaId: "SURV_AREA", ofrSurvAreaId: "OFR_AREA" },
      spatialResolution: null,
    });
    const listing = await getMicrodataInfo({
      metadataSource: "service_items",
      query: "비공개",
    });
    assert.equal(listing.success, true);
    assert.equal(listing.selectionRequired, true);
    assert.deepEqual(listing.space, {
      status: "selection_required",
      area: "not_resolved",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("service-items rejects altered popup identity and generic controls", async () => {
  const fixture = fixtureFetch((url) => {
    const pathname = new URL(url).pathname;
    if (pathname === MDIS_SERVICE_CATALOG_PATH)
      return response(serviceCatalogHtml);
    return response(servicePopupHtml.replace("MAPP_TEST", "MAPP_OTHER"));
  });
  const client = new MdisClient({ fetchImpl: fixture.fetchImpl });
  await assert.rejects(
    client.getServiceItems({
      mappId: "MAPP_TEST",
      itmDiv: "1",
      ofrSurvYm: "2024",
    }),
    { code: "RESPONSE_MISMATCH" },
  );
  const result = await getMicrodataInfo({
    metadataSource: "service_items",
    survId: "47",
  });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "INVALID_INPUT");
});
test("service-items rejects a rendered popup itmDiv mismatch", async () => {
  const fixture = fixtureFetch((url) => {
    const pathname = new URL(url).pathname;
    if (pathname === MDIS_SERVICE_CATALOG_PATH)
      return response(serviceCatalogHtml);
    return response(servicePopupHtml.replace('value="1"', 'value="2"'));
  });
  const client = new MdisClient({ fetchImpl: fixture.fetchImpl });
  await assert.rejects(
    client.getServiceItems({
      mappId: "MAPP_TEST",
      itmDiv: "1",
      ofrSurvYm: "2024",
    }),
    { code: "RESPONSE_MISMATCH" },
  );
});
test("service-items rejects a final popup URL identity mismatch", async () => {
  const fixture = fixtureFetch((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === MDIS_SERVICE_CATALOG_PATH)
      return response(serviceCatalogHtml);
    if (
      parsed.pathname === MDIS_SERVICE_POPUP_PATH &&
      parsed.searchParams.get("itmDiv") === "1"
    ) {
      parsed.searchParams.set("itmDiv", "2");
      return new Response("", {
        status: 302,
        headers: { location: parsed.toString() },
      });
    }
    return response(servicePopupHtml);
  });
  const client = new MdisClient({ fetchImpl: fixture.fetchImpl });
  await assert.rejects(
    client.getServiceItems({
      mappId: "MAPP_TEST",
      itmDiv: "1",
      ofrSurvYm: "2024",
    }),
    { code: "RESPONSE_MISMATCH" },
  );
});
test("service-items rejects a final codebook URL identity mismatch", async () => {
  const bytes = cfbXlsHeaderFixture();
  const fixture = fixtureFetch((url) => {
    const parsed = new URL(url);
    if (parsed.pathname === MDIS_SERVICE_CATALOG_PATH)
      return response(serviceCatalogHtml);
    if (parsed.pathname === MDIS_SERVICE_POPUP_PATH)
      return response(servicePopupHtml);
    if (parsed.pathname === MDIS_CODEBOOK_PATH) {
      parsed.pathname = "/ofrData/wrongCodebook.do";
      return new Response("", {
        status: 302,
        headers: { location: parsed.toString() },
      });
    }
    return response(bytes, { "content-type": "application/vnd.ms-excel" });
  });
  const client = new MdisClient({ fetchImpl: fixture.fetchImpl });
  await assert.rejects(
    client.getServiceItems({
      mappId: "MAPP_TEST",
      itmDiv: "1",
      ofrSurvYm: "2024",
      downloadCodebook: true,
    }),
    { code: "RESPONSE_MISMATCH" },
  );
});
test("codebook rejects truncated and arbitrary padded CFB headers", async () => {
  for (const bytes of [
    new Uint8Array([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00, 0x00, 0x00,
    ]),
    new Uint8Array([
      0xd0,
      0xcf,
      0x11,
      0xe0,
      0xa1,
      0xb1,
      0x1a,
      0xe1,
      ...new Uint8Array(504),
    ]),
  ]) {
    const client = new MdisClient({
      fetchImpl: fixtureFetch((url) => {
        return response(bytes, { "content-type": "application/vnd.ms-excel" });
      }).fetchImpl,
    });
    await assert.rejects(
      client.downloadCodebook({
        mappId: "M",
        ofrSurvYm: "2026",
        ofrSurvAreaId: "A",
        pmsSurvAreaId: "P",
        itmDiv: "1",
      }),
      { code: "PROVIDER_ERROR" },
    );
  }
});

test("tool output marks manual access and does not auto-select a dataset", async () => {
  resetMdisClientForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response(detailHtml);
  try {
    const result = await getMicrodataInfo({ survId: "47", itmDiv: "1" });
    assert.equal(result.success, true);
    assert.equal(result.selectionRequired, true);
    assert.equal(result.variables.length, 0);
    assert.equal(result.manualAccess.researcherLogin, "not_used");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("error and login pages are explicit failures, not successful empty catalogues", async () => {
  resetMdisClientForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    response(
      "<html><head><title>ERROR</title></head><body>error page</body></html>",
    );
  try {
    const error = await searchMicrodata({ query: "경제활동" });
    assert.equal(error.success, false);
    assert.equal(error.errorCode, "PROVIDER_ERROR");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("diagnostics omit URL-rewritten sessions and unknown redirect paths", async () => {
  for (const [target, pathname] of [
    [
      `${MDIS_SERVICE_CATALOG_PATH};jsessionid=PRIVATE_SESSION?token=PRIVATE_QUERY`,
      MDIS_SERVICE_CATALOG_PATH,
    ],
    ["/ofrData/PRIVATE_ROUTE_TOKEN?token=PRIVATE_QUERY", undefined],
  ]) {
    let calls = 0;
    const client = new MdisClient({
      fetchImpl: async (url) => {
        calls += 1;
        if (calls === 1)
          return new Response(null, {
            status: 302,
            headers: {
              Location: target,
              "Set-Cookie": "JSESSIONID=PRIVATE_COOKIE; Path=/",
            },
          });
        assert.equal(
          new URL(url).pathname,
          new URL(target, MDIS_BASE_URL).pathname,
        );
        throw new DOMException("PRIVATE_RAW_FAILURE", "AbortError");
      },
    });
    await assert.rejects(client.getServiceItems(), (error) => {
      assert.equal(error.code, "TIMEOUT");
      assert.deepEqual(error.diagnostics, {
        ...(pathname === undefined ? {} : { pathname }),
        phase: "request",
        cookiePresent: true,
        refererPresent: false,
      });
      assert.equal(
        JSON.stringify({
          message: error.message,
          diagnostics: error.diagnostics,
        }).includes("PRIVATE_"),
        false,
      );
      return true;
    });
    assert.equal(calls, 2);
  }
});
test("network diagnostics distinguish request and body without exposing raw failures", async () => {
  for (const phase of ["request", "body"]) {
    const client = new MdisClient({
      fetchImpl: async () => {
        const error = new Error(
          "JSESSIONID=network-private; mappId=SECRET_SELECTION",
        );
        if (phase === "request") throw error;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(error);
            },
          }),
        );
      },
    });
    await assert.rejects(client.getServiceItems(), (error) => {
      assert.equal(error.code, "NETWORK_ERROR");
      assert.deepEqual(error.diagnostics, {
        pathname: MDIS_SERVICE_CATALOG_PATH,
        phase,
        cookiePresent: false,
        refererPresent: false,
      });
      const serialized = JSON.stringify({
        message: error.message,
        diagnostics: error.diagnostics,
      });
      assert.equal(serialized.includes("network-private"), false);
      assert.equal(serialized.includes("SECRET_SELECTION"), false);
      return true;
    });
  }
});
test("transport failures expose only bounded request diagnostics", async () => {
  const catalog = new MdisClient({
    fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, MDIS_SERVICE_CATALOG_PATH);
      throw new DOMException(
        "cookie=secret; selector=MAPP_PRIVATE; raw=provider detail",
        "AbortError",
      );
    },
  });
  await assert.rejects(catalog.getServiceItems(), (error) => {
    assert.equal(error.code, "TIMEOUT");
    assert.deepEqual(error.diagnostics, {
      pathname: MDIS_SERVICE_CATALOG_PATH,
      phase: "request",
      cookiePresent: false,
      refererPresent: false,
    });
    assert.equal(JSON.stringify(error).includes("secret"), false);
    assert.equal(JSON.stringify(error).includes("MAPP_PRIVATE"), false);
    assert.equal(JSON.stringify(error).includes("provider detail"), false);
    assert.equal(JSON.stringify(error).includes("cookie="), false);
    assert.equal(JSON.stringify(error).includes("selector="), false);
    return true;
  });

  const originalFetch = globalThis.fetch;
  resetMdisClientForTests();
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === MDIS_SERVICE_CATALOG_PATH)
      return response(serviceCatalogHtml, {
        "set-cookie": "JSESSIONID=popup-fixture",
      });
    assert.equal(parsed.pathname, MDIS_SERVICE_POPUP_PATH);
    throw new DOMException(
      "cookie=secret; selector=MAPP_PRIVATE; raw=provider detail",
      "AbortError",
    );
  };
  try {
    const result = await getMicrodataInfo({
      metadataSource: "service_items",
      mappId: "MAPP_TEST",
      itmDiv: "1",
      ofrSurvYm: "2024",
    });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "TIMEOUT");
    assert.deepEqual(result.diagnostics, {
      pathname: MDIS_SERVICE_POPUP_PATH,
      phase: "request",
      cookiePresent: true,
      refererPresent: true,
    });
    assert.equal(
      result.sourceUrl,
      `${MDIS_BASE_URL}${MDIS_SERVICE_POPUP_PATH}`,
    );
    assert.equal(
      result.source.url,
      `${MDIS_BASE_URL}${MDIS_SERVICE_POPUP_PATH}`,
    );
    assert.equal(JSON.stringify(result).includes("secret"), false);
    assert.equal(JSON.stringify(result).includes("popup-fixture"), false);
    assert.equal(JSON.stringify(result).includes("MAPP_TEST"), false);
    assert.equal(JSON.stringify(result).includes("MAPP_PRIVATE"), false);
    assert.equal(JSON.stringify(result).includes("provider detail"), false);
    assert.equal(JSON.stringify(result).includes("cookie="), false);
    assert.equal(JSON.stringify(result).includes("selector="), false);
  } finally {
    globalThis.fetch = originalFetch;
    resetMdisClientForTests();
  }
});

test("body transport failures identify the body boundary without raw errors", async () => {
  const client = new MdisClient({
    timeoutMs: 1,
    fetchImpl: async (url, options = {}) =>
      new Response(
        new ReadableStream({
          start(controller) {
            options.signal?.addEventListener(
              "abort",
              () => {
                controller.error(
                  new DOMException(
                    "cookie=secret; selector=MAPP_PRIVATE; raw=provider detail",
                    "AbortError",
                  ),
                );
              },
              { once: true },
            );
          },
          pull() {
            return new Promise(() => {});
          },
        }),
      ),
  });
  await assert.rejects(client.searchCatalog(), (error) => {
    assert.equal(error.code, "TIMEOUT");
    assert.deepEqual(error.diagnostics, {
      pathname: MDIS_CATALOG_PATH,
      phase: "body",
      cookiePresent: false,
      refererPresent: false,
    });
    assert.equal(JSON.stringify(error).includes("secret"), false);
    assert.equal(JSON.stringify(error).includes("MAPP_PRIVATE"), false);
    assert.equal(JSON.stringify(error).includes("provider detail"), false);
    assert.equal(JSON.stringify(error).includes("cookie="), false);
    assert.equal(JSON.stringify(error).includes("selector="), false);
    return true;
  });
});
test("schema errors, login redirects, empty catalogues, oversized bodies, and missing identity stay fail-closed", async () => {
  const empty = new MdisClient({
    fetchImpl: async (url) => {
      return response(
        '<div class="board_list"><table><tbody></tbody></table></div>',
      );
    },
  });
  await assert.rejects(empty.searchCatalog(), { code: "INVALID_RESPONSE" });

  const schema = new MdisClient({
    fetchImpl: async (url) => {
      return response(JSON.stringify({ error: "schema error" }), {
        "content-type": "application/json",
      });
    },
  });
  await assert.rejects(
    schema.getVariables({
      mappId: "M",
      survAreaId: "A",
      itmDiv: "1",
      ofrSurvYm: "2026",
    }),
    { code: "INVALID_RESPONSE" },
  );

  const loginRedirect = new MdisClient({
    fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, MDIS_CATALOG_PATH);
      return new Response("", {
        status: 302,
        headers: { location: "https://login.example.invalid/" },
      });
    },
  });
  await assert.rejects(loginRedirect.searchCatalog(), {
    code: "REDIRECT_BLOCKED",
  });

  const oversized = new MdisClient({
    maxResponseBytes: 16,
    fetchImpl: async (url) => {
      return response("<html>" + "x".repeat(64) + "</html>");
    },
  });
  await assert.rejects(oversized.searchCatalog(), {
    code: "RESPONSE_TOO_LARGE",
  });

  const unverified = new MdisClient({
    fetchImpl: async (url) => {
      return response(
        JSON.stringify({
          itmList: [{ mappId: "M", stdItmNm: "공개변수", SECRET: "hidden" }],
        }),
      );
    },
  });
  const variables = await unverified.getVariables({
    mappId: "M",
    survAreaId: "A",
    itmDiv: "1",
    ofrSurvYm: "2026",
  });
  assert.equal(variables.identityStatus, "unverified");
  assert.equal(JSON.stringify(variables).includes("hidden"), false);
});
test("detailPage controls nPage independently from local variablePage slicing", async () => {
  resetMdisClientForTests();
  const originalFetch = globalThis.fetch;
  const detailRequests = [];
  const variableRows = Array.from({ length: 4 }, (_, index) => ({
    mappId: "M",
    survId: "47",
    ofrSurvAreaId: "A",
    ofrSurvYm: "2026",
    itmDiv: "1",
    stdItmId: `ITEM_${index}`,
    stdItmNm: `변수 ${index}`,
    rspnUnitNm: "가구",
  }));
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === MDIS_DETAIL_PATH) {
      detailRequests.push(parsed.searchParams.get("nPage"));
      return response(`<!doctype html><html><body><div class="board_list"><table><tbody>
        <tr><td>자료</td><td><a onclick="trDataArea(this,'M','A','1','2026')">선택</a></td></tr>
      </tbody></table></div></body></html>`);
    }
    assert.equal(parsed.pathname, MDIS_VARIABLE_PATH);
    return response(JSON.stringify({ itmList: variableRows }), {
      "content-type": "application/json",
    });
  };
  try {
    const first = await getMicrodataInfo({
      survId: "47",
      itmDiv: "1",
      mappId: "M",
      survAreaId: "A",
      ofrSurvYm: "2026",
      detailPage: 2,
      variablePage: 1,
      pageSize: 2,
    });
    const second = await getMicrodataInfo({
      survId: "47",
      itmDiv: "1",
      mappId: "M",
      survAreaId: "A",
      ofrSurvYm: "2026",
      detailPage: 2,
      variablePage: 2,
      pageSize: 2,
    });
    assert.deepEqual(detailRequests, ["2", "2"]);
    assert.deepEqual(
      first.variables.map((row) => row.stdItmNm),
      ["변수 0", "변수 1"],
    );
    assert.deepEqual(
      second.variables.map((row) => row.stdItmNm),
      ["변수 2", "변수 3"],
    );
    assert.equal(first.variableIdentityStatus, "verified");
    assert.equal(second.variableIdentityStatus, "verified");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("obsolete MDIS aliases are rejected instead of silently selecting fields", async () => {
  const result = await getMicrodataInfo({
    survId: "47",
    itmDiv: "1",
    surveyId: "47",
    detailPage: 1,
  });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "INVALID_INPUT");
});
test("caller pmsSurvAreaId is rejected in both metadata modes", async () => {
  for (const input of [
    { survId: "47", itmDiv: "1", pmsSurvAreaId: "P" },
    {
      metadataSource: "service_items",
      mappId: "M",
      itmDiv: "1",
      ofrSurvYm: "2024",
      pmsSurvAreaId: "P",
    },
  ]) {
    const result = await getMicrodataInfo(input);
    assert.equal(result.success, false);
    assert.equal(result.errorCode, "INVALID_INPUT");
  }
});
test("survey_detail rejects the service-only page control", async () => {
  const result = await getMicrodataInfo({
    survId: "47",
    itmDiv: "1",
    page: 1,
  });
  assert.equal(result.success, false);
  assert.equal(result.errorCode, "INVALID_INPUT");
});

test("variable identity conflicts in area, year, and item division fail closed", async () => {
  const expected = {
    mappId: "M",
    survId: "47",
    survAreaId: "A",
    ofrSurvYm: "2026",
    itmDiv: "1",
  };
  for (const field of ["ofrSurvAreaId", "ofrSurvYm", "itmDiv"]) {
    const row = {
      mappId: "M",
      survId: "47",
      ofrSurvAreaId: "A",
      ofrSurvYm: "2026",
      itmDiv: "1",
      stdItmNm: "변수",
    };
    row[field] =
      field === "ofrSurvAreaId"
        ? "FOREIGN"
        : field === "ofrSurvYm"
          ? "2025"
          : "2";
    const client = new MdisClient({
      fetchImpl: fixtureFetch((url) => {
        return response(JSON.stringify({ itmList: [row] }), {
          "content-type": "application/json",
        });
      }).fetchImpl,
    });
    await assert.rejects(client.getVariables(expected), {
      code: "RESPONSE_MISMATCH",
    });
  }
});

test("empty variable lists and sparse identity are unverified", async () => {
  const empty = new MdisClient({
    fetchImpl: fixtureFetch((url) => {
      return response(JSON.stringify({ ofrDataVO: { itmList: [] } }), {
        "content-type": "application/json",
      });
    }).fetchImpl,
  });
  const emptyResult = await empty.getVariables({
    mappId: "M",
    survId: "47",
    survAreaId: "A",
    ofrSurvYm: "2026",
    itmDiv: "1",
  });
  assert.equal(emptyResult.identityStatus, "unverified");

  const sparse = new MdisClient({
    fetchImpl: fixtureFetch((url) => {
      return response(
        JSON.stringify({
          ofrDataVO: {
            mappId: "M",
            survId: "47",
            itmList: [{ mappId: "M", stdItmNm: "공개변수" }],
          },
        }),
        { "content-type": "application/json" },
      );
    }).fetchImpl,
  });
  const sparseResult = await sparse.getVariables({
    mappId: "M",
    survId: "47",
    survAreaId: "A",
    ofrSurvYm: "2026",
    itmDiv: "1",
  });
  assert.equal(sparseResult.identityStatus, "unverified");
});

test("codebook text responses are not reported as available", async () => {
  const client = new MdisClient({
    fetchImpl: fixtureFetch((url) => {
      return response("서비스를 일시적으로 사용할 수 없습니다.", {
        "content-type": "text/plain",
      });
    }).fetchImpl,
  });
  await assert.rejects(
    client.downloadCodebook({
      mappId: "M",
      ofrSurvYm: "2026",
      ofrSurvAreaId: "A",
      pmsSurvAreaId: "P",
      itmDiv: "1",
    }),
    { code: "PROVIDER_ERROR" },
  );
});
