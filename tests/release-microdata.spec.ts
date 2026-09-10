import { createHash } from "node:crypto";
import { test, expect } from "@playwright/test";
import { parseHTML } from "linkedom";
import {
  callToolJson,
  runSanitizedLiveCase,
  withReleaseClient,
  type LiveTransportKind,
} from "./release-live-client";

const MDIS_ORIGIN = "https://mdis.mods.go.kr";
const MDIS_DOWNLOAD_PATH = "/dwnlSvc/ofrSurvSearch.do";
const MDIS_RAS_PATH = "/remote/remoteRasRequestList.do";
const MDIS_SDC_PATH = "/remote/remoteSdcRequestList.do";
const MDIS_VARIABLE_PATH = "/ofrData/selectOfrDataItmDetail.do";
const MDIS_SERVICE_CATALOG_PATH = "/ofrData/selectSvcBytOfrItmList.do";
const MDIS_SERVICE_POPUP_PATH = "/ofrData/selectSvcBytOfrItmPop.do";
const MDIS_CODEBOOK_PATH = "/ofrData/selectOfrPmsItmExcelList.do";
const MAX_PUBLIC_RESPONSE_BYTES = 4 * 1024 * 1024;
const PUBLIC_QUERY = "경제활동인구조사";
const RESTRICTED_QUERY = "기업사업체연계정보";
const KNOWN_DATASET = {
  mappId: "MAPP_000000000000092",
  survAreaId: "50149167",
  ofrSurvYm: "2026",
};
const RESTRICTED_SERVICE = {
  mappId: "MAPP_000000000000552",
  itmDiv: "1",
  ofrSurvYm: "2024",
  pmsSurvAreaId: "99990562",
  label: "기업사업체연계정보",
};

test.setTimeout(180_000);

type JsonObject = Record<string, unknown>;

type OfficialResponse = {
  readonly response: Response;
  readonly bytes: Uint8Array;
};

function asRecord(value: unknown, label: string): JsonObject {
  expect(value, `${label} must be an object`).not.toBeNull();
  expect(typeof value, `${label} must be an object`).toBe("object");
  expect(Array.isArray(value), `${label} must not be an array`).toBe(false);
  return value as JsonObject;
}

function requiredString(value: unknown, label: string): string {
  expect(typeof value, `${label} must be a string`).toBe("string");
  const text = String(value).trim();
  expect(text.length, `${label} must be non-empty`).toBeGreaterThan(0);
  return text;
}

function requiredNumber(value: unknown, label: string): number {
  expect(typeof value, `${label} must be a number`).toBe("number");
  expect(Number.isFinite(value as number), `${label} must be finite`).toBe(
    true,
  );
  return value as number;
}

function officialUrl(value: unknown, label: string): URL {
  const url =
    value instanceof URL ? value : new URL(requiredString(value, label));
  expect(url.protocol, `${label} protocol`).toBe("https:");
  expect(url.origin, `${label} origin`).toBe(MDIS_ORIGIN);
  return url;
}

function diagnosticFailureText(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return "";
  const diagnostics = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  if (diagnostics.phase === "request" || diagnostics.phase === "body")
    safe.phase = diagnostics.phase;
  if (
    typeof diagnostics.pathname === "string" &&
    [
      "/ofrData/selectOrgOfrData.do",
      "/ofrData/selectOfrDataDetail.do",
      MDIS_VARIABLE_PATH,
      MDIS_CODEBOOK_PATH,
      MDIS_SERVICE_CATALOG_PATH,
      MDIS_SERVICE_POPUP_PATH,
    ].includes(diagnostics.pathname)
  )
    safe.pathname = diagnostics.pathname;
  if (typeof diagnostics.cookiePresent === "boolean")
    safe.cookiePresent = diagnostics.cookiePresent;
  if (typeof diagnostics.refererPresent === "boolean")
    safe.refererPresent = diagnostics.refererPresent;
  return Object.keys(safe).length === 0
    ? ""
    : ` diagnostics=${JSON.stringify(safe)}`;
}
function assertSuccess(result: JsonObject, label: string): void {
  if (result.success !== true) {
    const code =
      typeof result.errorCode === "string" &&
      /^[A-Z_]{1,64}$/.test(result.errorCode)
        ? result.errorCode
        : "UNCLASSIFIED";
    throw new Error(
      `${label} failed: ${code}${diagnosticFailureText(result.diagnostics)}`,
    );
  }
  expect(result.success, `${label} success`).toBe(true);
  expect(result.errorCode, `${label} must not expose an error`).toBeUndefined();
}

function assertAnonymousMetadata(result: JsonObject, label: string): void {
  const source = asRecord(result.source, `${label} source`);
  expect(source.provider, `${label} provider`).toBe("MDIS");
  expect(source.publicMetadataOnly, `${label} public metadata`).toBe(true);
  expect(source.researcherLogin, `${label} researcher login`).toBe("not_used");
  expect(source.callerCookies, `${label} caller cookies`).toBe("not_accepted");
  officialUrl(source.url, `${label} source URL`);
}

function assertPageCompleteness(
  value: unknown,
  label: string,
  expectedPage: number,
  expectedPageSize: number,
): JsonObject {
  const page = asRecord(value, label);
  expect(page.status, `${label} status`).toBe("current_page_only");
  expect(page.currentPage, `${label} current page`).toBe(expectedPage);
  expect(page.pageSize, `${label} page size`).toBe(expectedPageSize);
  expect(page.wholeDataset, `${label} whole dataset`).toBe("not_retrieved");
  return page;
}

function assertManualAccess(result: JsonObject, label: string): void {
  const manual = asRecord(result.manualAccess, `${label} manualAccess`);
  expect(Object.keys(manual).sort(), `${label} manualAccess fields`).toEqual(
    [
      "download",
      "researcherLogin",
      "restrictedAccess",
      "status",
      "userCookieStorage",
    ].sort(),
  );
  expect(manual.status, `${label} manual status`).toBe(
    "manual_user_action_required",
  );
  expect(manual.researcherLogin, `${label} manual researcher login`).toBe(
    "not_used",
  );
  expect(manual.userCookieStorage, `${label} manual user cookies`).toBe(
    "not_used",
  );
  expect(manual).not.toHaveProperty("accessType");
  expect(manual).not.toHaveProperty("license");
}
function assertObservedActions(actions: JsonObject[], label: string): void {
  const allowed = new Set(["fnOpenDownLoad", "fnOpenRAS", "fnOpenSDC"]);
  for (const [index, action] of actions.entries()) {
    expect(
      allowed.has(String(action.functionName)),
      `${label} ${index} function`,
    ).toBe(true);
    expect(Array.isArray(action.arguments), `${label} ${index} arguments`).toBe(
      true,
    );
    requiredString(action.source, `${label} ${index} source`);
    officialUrl(action.url, `${label} ${index} URL`);
  }
}

function parseRows(payload: JsonObject, label: string): JsonObject[] {
  const root =
    payload.ofrDataVO !== null && typeof payload.ofrDataVO === "object"
      ? asRecord(payload.ofrDataVO, `${label} ofrDataVO`)
      : undefined;
  const candidates = [
    root?.itmList,
    root?.itmList64,
    payload.itmList,
    payload.itmList64,
  ];
  const rows = candidates.find((value) => Array.isArray(value));
  expect(rows, `${label} official variable rows`).toBeDefined();
  return (rows as unknown[]).map((row, index) =>
    asRecord(row, `${label} row ${index}`),
  );
}

async function readBounded(
  response: Response,
  label: string,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  expect(
    !Number.isFinite(declared) || declared <= MAX_PUBLIC_RESPONSE_BYTES,
    `${label} declared response bound`,
  ).toBe(true);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength, `${label} response bound`).toBeLessThanOrEqual(
      MAX_PUBLIC_RESPONSE_BYTES,
    );
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      length += chunk.byteLength;
      expect(length, `${label} response bound`).toBeLessThanOrEqual(
        MAX_PUBLIC_RESPONSE_BYTES,
      );
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchOfficial(
  url: URL,
  init: RequestInit,
  label: string,
): Promise<OfficialResponse> {
  expect(url.origin, `${label} origin`).toBe(MDIS_ORIGIN);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      headers: {
        "User-Agent": "Mozilla/5.0",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const bytes = await readBounded(response, label);
    return { response, bytes };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOfficialHtml(
  urlValue: unknown,
  label: string,
): Promise<string> {
  const url = officialUrl(urlValue, `${label} action URL`);
  const result = await fetchOfficial(
    url,
    { headers: { Accept: "text/html" } },
    label,
  );
  expect(result.response.status, `${label} HTTP status`).toBe(200);
  expect(
    result.response.headers.get("content-type")?.toLowerCase(),
    `${label} content type`,
  ).toContain("text/html");
  return new TextDecoder().decode(result.bytes);
}

async function fetchOfficialJson(
  path: string,
  form: Record<string, string>,
  label: string,
): Promise<{
  readonly payload: JsonObject;
  readonly form: Record<string, string>;
}> {
  const url = new URL(path, MDIS_ORIGIN);
  const body = new URLSearchParams(form);
  const result = await fetchOfficial(
    url,
    {
      method: "POST",
      headers: {
        Accept: "application/json,text/plain,*/*",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
    label,
  );
  expect(result.response.status, `${label} HTTP status`).toBe(200);
  const text = new TextDecoder().decode(result.bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} official response was not JSON`);
  }
  return { payload: asRecord(parsed, `${label} payload`), form };
}

async function fetchOfficialCodebook(source: JsonObject): Promise<{
  readonly bytes: Uint8Array;
  readonly form: Record<string, string>;
}> {
  expect(source.method, "codebook source method").toBe("POST");
  const url = officialUrl(source.url, "codebook source URL");
  expect(url.pathname, "codebook source path").toBe(MDIS_CODEBOOK_PATH);
  const form = asRecord(source.form, "codebook source form");
  const stringForm: Record<string, string> = {};
  for (const [key, value] of Object.entries(form)) {
    expect(typeof value, `codebook form ${key}`).toBe("string");
    stringForm[key] = String(value);
  }
  const result = await fetchOfficial(
    url,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.ms-excel,application/octet-stream,*/*",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(stringForm),
    },
    "independent public codebook POST",
  );
  expect(result.response.status, "independent codebook HTTP status").toBe(200);
  expect(
    result.response.headers.get("content-type")?.toLowerCase(),
    "independent codebook content type",
  ).toContain("application/vnd.ms-excel");
  return { bytes: result.bytes, form: stringForm };
}

function assertCfbHeader(
  bytes: Uint8Array,
  validation: JsonObject,
  label: string,
): void {
  expect(bytes.byteLength, `${label} non-empty`).toBeGreaterThanOrEqual(512);
  expect([...bytes.slice(0, 8)], `${label} CFB signature`).toEqual([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
  ]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = view.getUint16(26, true);
  const sectorSize = major === 3 ? 512 : major === 4 ? 4096 : 0;
  expect([3, 4], `${label} CFB major version`).toContain(major);
  expect(view.getUint16(24, true), `${label} minor version`).toBe(
    requiredNumber(
      validation.minorVersion,
      `${label} descriptor minor version`,
    ),
  );
  expect(view.getUint16(28, true), `${label} byte order`).toBe(0xfffe);
  expect(view.getUint16(30, true), `${label} sector shift`).toBe(
    major === 3 ? 9 : 12,
  );
  expect(view.getUint16(32, true), `${label} mini-sector shift`).toBe(6);
  expect(bytes.byteLength % sectorSize, `${label} sector alignment`).toBe(0);
  expect(validation.level, `${label} validation level`).toBe("header-only");
  expect(validation.format, `${label} validation format`).toBe("cfb-xls");
  expect(validation.signature, `${label} validation signature`).toBe(
    "d0cf11e0a1b11ae1",
  );
  expect(validation.headerBytes, `${label} validation header bytes`).toBe(512);
  expect(validation.majorVersion, `${label} descriptor major version`).toBe(
    major,
  );
  expect(validation.byteOrder, `${label} descriptor byte order`).toBe(
    "little-endian",
  );
  expect(validation.sectorShift, `${label} descriptor sector shift`).toBe(
    major === 3 ? 9 : 12,
  );
  expect(validation.sectorSize, `${label} descriptor sector size`).toBe(
    sectorSize,
  );
  expect(
    validation.miniSectorShift,
    `${label} descriptor mini-sector shift`,
  ).toBe(6);
  expect(validation.aligned, `${label} descriptor alignment`).toBe(true);
}

async function observeEconomySurvey(
  client: Parameters<typeof callToolJson>[0],
  label: string,
): Promise<{ readonly item: JsonObject; readonly detail: JsonObject }> {
  const catalogue = await callToolJson(client, "search_microdata", {
    query: PUBLIC_QUERY,
    page: 1,
    pageSize: 20,
  });
  assertSuccess(catalogue, `${label} search_microdata`);
  expect(catalogue.page, `${label} catalogue page`).toBe(1);
  expect(catalogue.pageSize, `${label} catalogue page size`).toBe(20);
  const total = requiredNumber(catalogue.total, `${label} catalogue total`);
  const returnedCount = requiredNumber(
    catalogue.returnedCount,
    `${label} catalogue returnedCount`,
  );
  expect(
    total,
    `${label} catalogue total fits bounded discovery`,
  ).toBeLessThanOrEqual(20);
  expect(returnedCount, `${label} catalogue bounded page`).toBeLessThanOrEqual(
    20,
  );
  expect(total, `${label} catalogue total covers page`).toBeGreaterThanOrEqual(
    returnedCount,
  );
  expect(catalogue.hasMore, `${label} catalogue hasMore`).toBe(false);
  expect(catalogue.nextPage, `${label} catalogue final page`).toBeNull();
  expect(returnedCount, `${label} catalogue all observed matches`).toBe(total);
  assertPageCompleteness(
    catalogue.completeness,
    `${label} catalogue completeness`,
    1,
    20,
  );
  assertAnonymousMetadata(catalogue, `${label} catalogue`);

  expect(Array.isArray(catalogue.items), `${label} catalogue items`).toBe(true);
  const item = (catalogue.items as unknown[])
    .map((value, index) => asRecord(value, `${label} catalogue item ${index}`))
    .find((candidate) => candidate.name === PUBLIC_QUERY);
  expect(item, `${label} exact observed survey`).toBeDefined();
  const surveyId = requiredString(item?.survId, `${label} observed survId`);
  const itmDiv = requiredString(item?.itmDiv, `${label} observed itmDiv`);
  const prefix = requiredString(
    item?.prefix,
    `${label} observed catalog prefix`,
  );
  // itmDiv is the selector emitted by the catalogue anchor prefix, not an
  // access label. This only checks the observed catalogue encoding.
  expect(itmDiv, `${label} anchor-prefix selector`).toBe(
    prefix === "STAT" ? "1" : "2",
  );
  expect(surveyId, `${label} known historical survey`).toBe("47");
  expect(itmDiv, `${label} known historical catalogue selector`).toBe("1");

  const detail = await callToolJson(client, "get_microdata_info", {
    survId: surveyId,
    itmDiv,
    detailPage: 1,
    variablePage: 1,
    pageSize: 20,
  });
  assertSuccess(detail, `${label} detail without dataset selection`);
  expect(detail.survId, `${label} detail survey identity`).toBe(surveyId);
  expect(detail.itmDiv, `${label} detail catalogue selector`).toBe(itmDiv);
  expect(detail.selectionRequired, `${label} no first-dataset fallback`).toBe(
    true,
  );
  expect(Array.isArray(detail.variables), `${label} unselected variables`).toBe(
    true,
  );
  expect(
    (detail.variables as unknown[]).length,
    `${label} unselected variables`,
  ).toBe(0);
  assertPageCompleteness(
    detail.variablePage,
    `${label} unselected variable page`,
    1,
    20,
  );
  assertManualAccess(detail, `${label} unselected detail`);
  assertAnonymousMetadata(detail, `${label} detail`);
  return { item: item as JsonObject, detail };
}

async function assertPublicMicrodata(kind: LiveTransportKind): Promise<void> {
  await withReleaseClient(kind, async ({ client }) => {
    const { item, detail } = await observeEconomySurvey(
      client,
      `${kind} public`,
    );
    const surveyId = requiredString(item.survId, `${kind} public survId`);
    const itmDiv = requiredString(item.itmDiv, `${kind} public itmDiv`);
    const detailUrl = officialUrl(
      detail.sourceUrl,
      `${kind} public detail URL`,
    );
    expect(detailUrl.pathname, `${kind} public detail route`).toBe(
      "/ofrData/selectOfrDataDetail.do",
    );
    expect(
      detailUrl.searchParams.get("survId"),
      `${kind} detail URL survey`,
    ).toBe(surveyId);
    expect(
      detailUrl.searchParams.get("itmDiv"),
      `${kind} detail URL itmDiv`,
    ).toBe(itmDiv);
    const datasets = (detail.datasets as unknown[]).map((value, index) =>
      asRecord(value, `${kind} public dataset ${index}`),
    );
    expect(datasets.length, `${kind} public observed datasets`).toBeGreaterThan(
      0,
    );
    const dataset = datasets.find(
      (candidate) =>
        candidate.mappId === KNOWN_DATASET.mappId &&
        candidate.survAreaId === KNOWN_DATASET.survAreaId &&
        candidate.ofrSurvYm === KNOWN_DATASET.ofrSurvYm,
    );
    expect(dataset, `${kind} known dataset observed in detail`).toBeDefined();
    const selected = dataset as JsonObject;
    const mappId = requiredString(selected.mappId, `${kind} selected mappId`);
    const survAreaId = requiredString(
      selected.survAreaId,
      `${kind} selected survAreaId`,
    );
    const ofrSurvYm = requiredString(
      selected.ofrSurvYm,
      `${kind} selected ofrSurvYm`,
    );
    const ofrSurvAreaId = requiredString(
      selected.ofrSurvAreaId,
      `${kind} selected ofrSurvAreaId`,
    );
    const pmsSurvAreaId = requiredString(
      selected.pmsSurvAreaId,
      `${kind} selected pmsSurvAreaId`,
    );
    expect(selected.itmDiv, `${kind} selected dataset itmDiv`).toBe(itmDiv);
    expect(
      (selected.sourceActions as unknown[]).map(String),
      `${kind} selected dataset detail evidence`,
    ).toContain("trDataArea");
    const rawActions = asRecord(
      selected.rawActionArguments,
      `${kind} selected dataset raw actions`,
    );
    expect(
      rawActions.trDataArea,
      `${kind} selected dataset identity action`,
    ).toEqual([mappId, survAreaId, itmDiv, ofrSurvYm]);

    const actions = (detail.actions as unknown[]).map((value, index) =>
      asRecord(value, `${kind} public action ${index}`),
    );
    assertObservedActions(actions, `${kind} public detail actions`);
    const publicAction = actions.find(
      (action) => action.functionName === "fnOpenDownLoad",
    );
    expect(publicAction, `${kind} observed public-use action`).toBeDefined();
    const action = publicAction as JsonObject;
    const argumentsList = (action.arguments as unknown[]).map(String);
    expect(argumentsList, `${kind} public action survey linkage`).toContain(
      surveyId,
    );
    expect(
      requiredString(action.source, `${kind} public action source`),
    ).toContain("fnOpenDownLoad");
    expect(
      requiredString(action.source, `${kind} public action source survey`),
    ).toContain(surveyId);
    const actionUrl = officialUrl(action.url, `${kind} public action URL`);
    expect(actionUrl.pathname, `${kind} public action route`).toBe(
      MDIS_DOWNLOAD_PATH,
    );
    const publicRoute = await fetchOfficialHtml(
      actionUrl,
      `${kind} public-use route`,
    );
    expect(publicRoute, `${kind} public-use route label`).toContain(
      "공공용 자료를 다운로드",
    );
    // The detail page supplies the survey action and the selected dataset's
    // trDataArea identity together; no guessed action argument is treated as a
    // dataset entitlement.

    const selectedInfo = await callToolJson(client, "get_microdata_info", {
      survId: surveyId,
      itmDiv,
      mappId,
      survAreaId,
      ofrSurvYm,
      variablePage: 1,
      pageSize: 20,
      downloadCodebook: true,
    });
    assertSuccess(selectedInfo, `${kind} selected microdata info`);
    assertManualAccess(selectedInfo, `${kind} selected detail`);
    assertAnonymousMetadata(selectedInfo, `${kind} selected detail`);
    const selection = asRecord(
      selectedInfo.selection,
      `${kind} selected selection`,
    );
    expect(selection.mappId, `${kind} selection mappId`).toBe(mappId);
    expect(selection.survAreaId, `${kind} selection survAreaId`).toBe(
      survAreaId,
    );
    expect(selection.ofrSurvYm, `${kind} selection ofrSurvYm`).toBe(ofrSurvYm);
    expect(selection.pmsSurvAreaId, `${kind} selection pmsSurvAreaId`).toBe(
      pmsSurvAreaId,
    );
    expect(selection.itmDiv, `${kind} selection itmDiv`).toBe(itmDiv);

    const variables = (selectedInfo.variables as unknown[]).map(
      (value, index) => asRecord(value, `${kind} variable ${index}`),
    );
    expect(
      variables.length,
      `${kind} independent variables page`,
    ).toBeGreaterThan(0);
    const variablePage = assertPageCompleteness(
      selectedInfo.variablePage,
      `${kind} variable page`,
      1,
      20,
    );
    expect(variablePage.returned, `${kind} variable page returned`).toBe(
      variables.length,
    );
    const variableTotal = requiredNumber(
      variablePage.total,
      `${kind} variable total`,
    );
    expect(
      variableTotal,
      `${kind} variable total covers page`,
    ).toBeGreaterThanOrEqual(variables.length);
    expect(variablePage.hasMore, `${kind} variable hasMore type`).toBe(
      typeof variablePage.hasMore === "boolean" ? variablePage.hasMore : false,
    );
    if (variablePage.hasMore === true)
      expect(variablePage.nextPage, `${kind} variable next page`).toBe(2);
    else
      expect(variablePage.nextPage, `${kind} variable final page`).toBeNull();

    const identityStatus = requiredString(
      selectedInfo.variableIdentityStatus,
      `${kind} variable identity status`,
    );
    expect(
      ["verified", "unverified"],
      `${kind} variable identity status`,
    ).toContain(identityStatus);
    let rowsMissingItmDiv = 0;
    for (const [index, variable] of variables.entries()) {
      expect(
        requiredString(variable.mappId, `${kind} variable ${index} mappId`),
      ).toBe(mappId);
      expect(
        requiredString(variable.survId, `${kind} variable ${index} survId`),
      ).toBe(surveyId);
      expect(
        requiredString(
          variable.ofrSurvAreaId,
          `${kind} variable ${index} area`,
        ),
      ).toBe(survAreaId);
      if (variable.ofrSurvYm === undefined || variable.ofrSurvYm === null) {
        expect(
          identityStatus,
          `${kind} missing row year remains unverified`,
        ).toBe("unverified");
      } else {
        expect(
          requiredString(variable.ofrSurvYm, `${kind} variable ${index} year`),
        ).toBe(ofrSurvYm);
      }
      if (variable.itmDiv === undefined || variable.itmDiv === null)
        rowsMissingItmDiv += 1;
    }
    // Row-level year and itmDiv are absent in current public observations.
    // The independent response root carries these; preserve the row-level gap.
    if (identityStatus === "unverified")
      expect(
        rowsMissingItmDiv,
        `${kind} explicit identity gap`,
      ).toBeGreaterThan(0);

    const variableForm = {
      mappId,
      survAreaId,
      itmDiv,
      ofrSurvYm,
    };
    const independentVariables = await fetchOfficialJson(
      MDIS_VARIABLE_PATH,
      variableForm,
      `${kind} independent public variables POST`,
    );
    expect(
      independentVariables.form,
      `${kind} independent variable form`,
    ).toEqual(variableForm);
    const officialIdentity = asRecord(
      independentVariables.payload.ofrDataVO,
      `${kind} official variable response identity`,
    );
    expect(officialIdentity.mappId).toBe(mappId);
    expect(officialIdentity.ofrSurvYm).toBe(ofrSurvYm);
    expect(officialIdentity.itmDiv).toBe(itmDiv);
    const officialRows = parseRows(
      independentVariables.payload,
      `${kind} independent public variables`,
    );
    expect(
      officialRows.length,
      `${kind} official variable rows`,
    ).toBeGreaterThanOrEqual(variables.length);
    for (const [index, variable] of variables.entries()) {
      const official = officialRows[index];
      expect(variable, `${kind} complete variable row ${index}`).toEqual(
        official,
      );
    }

    const codebook = asRecord(selectedInfo.codebook, `${kind} codebook`);
    expect(codebook.available, `${kind} codebook available`).toBe(true);
    const codebookBytes = requiredNumber(
      codebook.byteLength,
      `${kind} codebook byteLength`,
    );
    expect(
      codebookBytes,
      `${kind} codebook bounded bytes`,
    ).toBeGreaterThanOrEqual(512);
    expect(codebookBytes, `${kind} codebook bounded bytes`).toBeLessThanOrEqual(
      MAX_PUBLIC_RESPONSE_BYTES,
    );
    const codebookSha = requiredString(
      codebook.sha256,
      `${kind} codebook sha256`,
    );
    expect(codebookSha, `${kind} codebook sha256 syntax`).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(codebook.hashSnapshot, `${kind} codebook hash snapshot`).toBe(
      codebookSha,
    );
    const validation = asRecord(
      codebook.validation,
      `${kind} codebook validation`,
    );
    const codebookSource = asRecord(codebook.source, `${kind} codebook source`);
    const independentCodebook = await fetchOfficialCodebook(codebookSource);
    expect(
      independentCodebook.form,
      `${kind} independent codebook form`,
    ).toEqual(
      Object.fromEntries(
        Object.entries({
          mappId,
          ofrSurvYm,
          ofrSurvAreaId,
          pmsSurvAreaId,
          itmDiv,
          curMenuNo: "",
        }).sort(([left], [right]) => left.localeCompare(right)),
      ),
    );
    expect(
      independentCodebook.bytes.byteLength,
      `${kind} codebook byte count`,
    ).toBe(codebookBytes);
    expect(
      createHash("sha256").update(independentCodebook.bytes).digest("hex"),
      `${kind} independent codebook sha256`,
    ).toBe(codebookSha);
    assertCfbHeader(independentCodebook.bytes, validation, `${kind} codebook`);
    expect(codebookSource.method, `${kind} codebook source method`).toBe(
      "POST",
    );
    expect(codebookSource.form, `${kind} observed codebook form`).toBeDefined();
    expect(codebook).not.toHaveProperty("base64");
    expect(selectedInfo).not.toHaveProperty("rawMicrodata");
    expect(selectedInfo).not.toHaveProperty("operatorCredentials");
  });
}

async function assertRestrictedMicrodata(
  kind: LiveTransportKind,
): Promise<void> {
  await withReleaseClient(kind, async ({ client }) => {
    await observeEconomySurvey(client, `${kind} restricted baseline`);

    const listing = await callToolJson(client, "get_microdata_info", {
      metadataSource: "service_items",
      query: RESTRICTED_QUERY,
      page: 1,
      variablePage: 1,
      pageSize: 20,
    });
    assertSuccess(listing, `${kind} service-items listing`);
    expect(listing.metadataSource, `${kind} metadata source`).toBe(
      "service_items",
    );
    expect(
      listing.selectionRequired,
      `${kind} no automatic service selection`,
    ).toBe(true);
    expect(listing.variables, `${kind} unselected service variables`).toEqual(
      [],
    );
    assertManualAccess(listing, `${kind} service-items listing`);
    assertAnonymousMetadata(listing, `${kind} service-items listing`);
    const items = (listing.items as unknown[]).map((value, index) =>
      asRecord(value, `${kind} service item ${index}`),
    );
    const observed = items.find(
      (item) =>
        item.mappId === RESTRICTED_SERVICE.mappId &&
        item.itmDiv === RESTRICTED_SERVICE.itmDiv &&
        item.ofrSurvYm === RESTRICTED_SERVICE.ofrSurvYm &&
        item.dataSetLabel === RESTRICTED_SERVICE.label,
    );
    expect(observed, `${kind} observed restricted service row`).toBeDefined();
    if (observed === undefined) throw new Error("service row not observed");
    const availability = asRecord(
      observed.availability,
      `${kind} service availability`,
    );
    expect(availability.public, `${kind} public availability`).toBe("-");
    expect(availability.ras, `${kind} RAS availability`).toBe("4");
    expect(availability.sdc, `${kind} SDC availability`).toBe("4");
    expect(
      observed.sourceArguments,
      `${kind} observed service arguments`,
    ).toEqual([
      RESTRICTED_SERVICE.mappId,
      RESTRICTED_SERVICE.itmDiv,
      "2024  ",
      RESTRICTED_SERVICE.label,
      "",
      "",
      RESTRICTED_SERVICE.pmsSurvAreaId,
    ]);
    const catalogueSource = asRecord(
      listing.source,
      `${kind} service catalogue source`,
    );
    const catalogueUrl = officialUrl(
      catalogueSource.url,
      `${kind} service catalogue URL`,
    );
    expect(catalogueUrl.pathname, `${kind} service catalogue route`).toBe(
      MDIS_SERVICE_CATALOG_PATH,
    );
    const catalogueHtml = await fetchOfficialHtml(
      catalogueUrl,
      `${kind} independent service catalogue`,
    );
    const catalogueDocument = parseHTML(catalogueHtml).document;
    const controls = Array.from(
      catalogueDocument.querySelectorAll("[onclick]"),
    ).filter((element) =>
      (element.getAttribute("onclick") ?? "").startsWith(
        `fnItemDataList('${RESTRICTED_SERVICE.mappId}','${RESTRICTED_SERVICE.itmDiv}'`,
      ),
    );
    const officialRows = [
      ...new Set(controls.map((element) => element.closest("tr"))),
    ];
    expect(officialRows, "unique official restricted row").toHaveLength(1);
    const officialRow = officialRows[0];
    if (!officialRow) throw new Error("Official restricted row is missing");
    const officialCells = Array.from(officialRow.querySelectorAll("td")).map(
      (cell) => cell.textContent.replace(/\s+/g, " ").trim(),
    );
    expect(officialCells, "official year and distinct service columns").toEqual(
      ["2024", "", "-", "연간자료(인가용)", "4", "4", "항목보기"],
    );

    const selectedVariables = await callToolJson(client, "get_microdata_info", {
      metadataSource: "service_items",
      mappId: RESTRICTED_SERVICE.mappId,
      itmDiv: RESTRICTED_SERVICE.itmDiv,
      ofrSurvYm: RESTRICTED_SERVICE.ofrSurvYm,
      variablePage: 1,
      pageSize: 20,
      downloadCodebook: false,
    });
    assertSuccess(
      selectedVariables,
      `${kind} selected service variables without codebook`,
    );
    const selectedInfo = await callToolJson(client, "get_microdata_info", {
      metadataSource: "service_items",
      mappId: RESTRICTED_SERVICE.mappId,
      itmDiv: RESTRICTED_SERVICE.itmDiv,
      ofrSurvYm: RESTRICTED_SERVICE.ofrSurvYm,
      variablePage: 1,
      pageSize: 20,
      downloadCodebook: true,
    });
    assertSuccess(selectedInfo, `${kind} selected service metadata`);
    expect(
      selectedInfo.variables,
      `${kind} codebook does not change metadata`,
    ).toEqual(selectedVariables.variables);
    assertManualAccess(selectedInfo, `${kind} selected service metadata`);
    assertAnonymousMetadata(selectedInfo, `${kind} selected service metadata`);
    expect(selectedInfo.metadataSource).toBe("service_items");
    expect(selectedInfo).not.toHaveProperty("survId");
    expect(selectedInfo).not.toHaveProperty("rawMicrodata");
    expect(selectedInfo).not.toHaveProperty("operatorCredentials");
    const space = asRecord(selectedInfo.space, `${kind} service space`);
    expect(space.status, `${kind} blank area status`).toBe(
      "not_published_by_source",
    );
    const selection = asRecord(
      selectedInfo.selection,
      `${kind} selected service identity`,
    );
    expect(selection.mappId).toBe(RESTRICTED_SERVICE.mappId);
    expect(selection.itmDiv).toBe(RESTRICTED_SERVICE.itmDiv);
    expect(selection.ofrSurvYm).toBe(RESTRICTED_SERVICE.ofrSurvYm);
    expect(selection.pmsSurvAreaId).toBe(RESTRICTED_SERVICE.pmsSurvAreaId);
    expect(selection.sourceArguments).toEqual(observed.sourceArguments);

    const popupSource = asRecord(
      selectedInfo.popupSource,
      `${kind} selected popup source`,
    );
    const popupUrl = officialUrl(popupSource.url, `${kind} popup URL`);
    expect(popupUrl.pathname, `${kind} popup route`).toBe(
      MDIS_SERVICE_POPUP_PATH,
    );
    expect(popupUrl.searchParams.get("mappId")).toBe(RESTRICTED_SERVICE.mappId);
    expect(popupUrl.searchParams.get("itmDiv")).toBe(RESTRICTED_SERVICE.itmDiv);
    expect(popupUrl.searchParams.get("ofrSurvYm")).toBe(
      RESTRICTED_SERVICE.ofrSurvYm,
    );
    expect(popupUrl.searchParams.get("survAreaId")).toBe("");
    expect(popupUrl.searchParams.get("ofrSurvAreaId")).toBe("");
    expect(popupUrl.searchParams.get("pmsSurvAreaId")).toBe(
      RESTRICTED_SERVICE.pmsSurvAreaId,
    );
    const popupHtml = await fetchOfficialHtml(
      popupUrl,
      `${kind} independent service popup`,
    );
    expect(popupHtml).toContain("번호");
    expect(popupHtml).toContain('name="itmDiv"');
    for (const variableName of [
      "조사기준연도",
      "사업체고유번호",
      "통계등록부_기업대표여부",
      "BR_기업체고유번호",
    ])
      expect(popupHtml, `${kind} popup variable ${variableName}`).toContain(
        variableName,
      );
    const variables = (selectedInfo.variables as unknown[]).map(
      (value, index) => asRecord(value, `${kind} service variable ${index}`),
    );
    expect(variables.length, `${kind} exact service variables`).toBe(4);
    expect(variables.map((row) => row.stdItmNm)).toEqual([
      "조사기준연도",
      "사업체고유번호",
      "통계등록부_기업대표여부",
      "BR_기업체고유번호",
    ]);
    for (const [index, variable] of variables.entries()) {
      expect(
        variable.publicAvailability,
        `${kind} variable ${index} public`,
      ).toBe("-");
      expect(variable.rasAvailability, `${kind} variable ${index} RAS`).toBe(
        "O",
      );
      expect(variable.sdcAvailability, `${kind} variable ${index} SDC`).toBe(
        "O",
      );
    }
    assertPageCompleteness(
      selectedInfo.variablePage,
      `${kind} service variable page`,
      1,
      20,
    );

    const codebook = asRecord(
      selectedInfo.codebook,
      `${kind} service codebook`,
    );
    expect(codebook.available).toBe(true);
    const codebookBytes = requiredNumber(
      codebook.byteLength,
      `${kind} service codebook bytes`,
    );
    const codebookSha = requiredString(
      codebook.sha256,
      `${kind} service codebook hash`,
    );
    expect(codebookSha).toMatch(/^[0-9a-f]{64}$/u);
    expect(codebook.hashSnapshot).toBe(codebookSha);
    const validation = asRecord(
      codebook.validation,
      `${kind} service codebook validation`,
    );
    const codebookSource = asRecord(
      codebook.source,
      `${kind} service codebook source`,
    );
    expect(codebookSource.method).toBe("POST");
    const independentCodebook = await fetchOfficialCodebook(codebookSource);
    expect(independentCodebook.form).toEqual(
      Object.fromEntries(
        Object.entries({
          mappId: RESTRICTED_SERVICE.mappId,
          itmDiv: RESTRICTED_SERVICE.itmDiv,
          ofrSurvYm: RESTRICTED_SERVICE.ofrSurvYm,
          ofrSurvAreaId: "",
          pmsSurvAreaId: RESTRICTED_SERVICE.pmsSurvAreaId,
          curMenuNo: "",
        }).sort(([left], [right]) => left.localeCompare(right)),
      ),
    );
    expect(independentCodebook.bytes.byteLength).toBe(codebookBytes);
    expect(
      createHash("sha256").update(independentCodebook.bytes).digest("hex"),
    ).toBe(codebookSha);
    assertCfbHeader(
      independentCodebook.bytes,
      validation,
      `${kind} service codebook`,
    );
    expect(codebook).not.toHaveProperty("base64");

    const rasUrl = officialUrl(
      new URL(`${MDIS_RAS_PATH}?curMenuNo=UI_POR_P9014_1`, MDIS_ORIGIN),
      `${kind} RAS route`,
    );
    const rasHtml = await fetchOfficialHtml(rasUrl, `${kind} RAS route`);
    for (const condition of [
      "신청 전 확인사항",
      "이용할 자료와 항목을 결정하였나요?",
      "책임연구자 및 공동이용자의 MDIS ID",
      "연구계획서_결과표설계서",
      "반출 결과물 형태",
      "요금제",
    ])
      expect(rasHtml, `${kind} RAS condition ${condition}`).toContain(
        condition,
      );
    const manual = asRecord(
      selectedInfo.manualAccess,
      `${kind} selected manual access`,
    );
    expect(manual.researcherLogin).toBe("not_used");
    expect(manual.userCookieStorage).toBe("not_used");
  });
}

const releasePhase = process.env.KOREA_STATS_RELEASE_PHASE?.trim();
const registerR3Cases =
  releasePhase === undefined || releasePhase === "" || releasePhase === "R3";

if (registerR3Cases) {
  test(
    "REQ-D03.stdio public-use microdata metadata and codebook @live @stdio @transport @AC6 @AC8",
    {
      tag: ["@REQ-D03.stdio", "@live", "@stdio", "@transport", "@AC6", "@AC8"],
    },
    async () =>
      runSanitizedLiveCase("REQ-D03.stdio", () =>
        assertPublicMicrodata("stdio"),
      ),
  );

  test(
    "REQ-D03.http public-use microdata metadata and codebook @live @http @transport @AC6 @AC8",
    { tag: ["@REQ-D03.http", "@live", "@http", "@transport", "@AC6", "@AC8"] },
    async () =>
      runSanitizedLiveCase("REQ-D03.http", () => assertPublicMicrodata("http")),
  );

  test(
    "REQ-D04.stdio restricted-use RAS/SDC public conditions @live @stdio @transport @AC6 @AC10",
    {
      tag: ["@REQ-D04.stdio", "@live", "@stdio", "@transport", "@AC6", "@AC10"],
    },
    async () =>
      runSanitizedLiveCase("REQ-D04.stdio", () =>
        assertRestrictedMicrodata("stdio"),
      ),
  );

  test(
    "REQ-D04.http restricted-use RAS/SDC public conditions @live @http @transport @AC6 @AC10",
    { tag: ["@REQ-D04.http", "@live", "@http", "@transport", "@AC6", "@AC10"] },
    async () =>
      runSanitizedLiveCase("REQ-D04.http", () =>
        assertRestrictedMicrodata("http"),
      ),
  );
}
