/**
 * MDIS public-web adapter.
 *
 * MDIS does not expose an API contract for these pages. This client observes
 * the public catalogue/detail forms with an anonymous, in-memory cookie jar;
 * it is deliberately not an API-key client and never accepts researcher
 * credentials or user cookies.
 */

import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";

export const MDIS_BASE_URL = "https://mdis.mods.go.kr";
export const MDIS_CATALOG_PATH = "/ofrData/selectOrgOfrData.do";
export const MDIS_DETAIL_PATH = "/ofrData/selectOfrDataDetail.do";
export const MDIS_VARIABLE_PATH = "/ofrData/selectOfrDataItmDetail.do";
export const MDIS_CODEBOOK_PATH = "/ofrData/selectOfrPmsItmExcelList.do";
export const MDIS_SERVICE_CATALOG_PATH = "/ofrData/selectSvcBytOfrItmList.do";
export const MDIS_SERVICE_POPUP_PATH = "/ofrData/selectSvcBytOfrItmPop.do";
export const MDIS_SERVICE_CATALOG_SOURCE = `${MDIS_BASE_URL}${MDIS_SERVICE_CATALOG_PATH}?curMenuNo=UI_POR_P9230`;
export const MDIS_CATALOG_SOURCE = `${MDIS_BASE_URL}${MDIS_CATALOG_PATH}?curMenuNo=UI_POR_P9220`;
export const MDIS_DOWNLOAD_URL = `${MDIS_BASE_URL}/dwnlSvc/ofrSurvSearch.do?curMenuNo=UI_POR_P9240`;
export const MDIS_RAS_URL = `${MDIS_BASE_URL}/remote/remoteRasRequestList.do?curMenuNo=UI_POR_P9014_1`;
export const MDIS_SDC_URL = `${MDIS_BASE_URL}/remote/remoteSdcRequestList.do?curMenuNo=UI_POR_P9014_4`;
export const MDIS_REQUEST_TIMEOUT_MS = 8_000;
export const MDIS_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MDIS_PARSER_VERSION = "mdis-public-web-1";

const USER_AGENT = "Mozilla/5.0";
const SOURCE_NAME = "MDIS 공개 마이크로데이터 카탈로그 (공공 웹 adapter)";
const PUBLIC_HOST = new URL(MDIS_BASE_URL).host;

type FetchLike = typeof fetch;
type RawRow = Record<string, unknown>;
interface MdisElement {
  getAttribute(name: string): string | null;
  querySelector(selector: string): MdisElement | null;
  querySelectorAll(selector: string): ArrayLike<unknown>;
  closest(selector: string): MdisElement | null;
  textContent: string | null;
  cloneNode(deep: boolean): MdisElement;
  remove(): void;
}
interface MdisDocument {
  querySelector(selector: string): MdisElement | null;
  querySelectorAll(selector: string): ArrayLike<unknown>;
}

export interface MdisClientOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface MdisCatalogInput {
  query?: string;
  page?: number;
  pageSize?: number;
}

export interface MdisCatalogEntry {
  survId: string;
  name: string;
  anchorId: string;
  prefix: string;
  itmDiv: string;
  rowText: string;
}

export interface MdisCatalogPage {
  items: MdisCatalogEntry[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  nextPage: number | null;
  srcobservedAt: string;
  parserVersion: string;
  hashSnapshot: string;
  source: string;
}

export interface MdisDetailInput {
  survId: string;
  itmDiv: string;
  detailPage?: number;
}

export interface MdisDataset {
  mappId: string;
  survAreaId?: string;
  ofrSurvYm?: string;
  itmDiv?: string;
  dataSetLabel: string;
  pmsSurvAreaId?: string;
  ofrSurvAreaId?: string;
  sourceActions: string[];
  rawActionArguments: Record<string, string[]>;
}

export interface MdisObservedAction {
  functionName: "fnOpenDownLoad" | "fnOpenRAS" | "fnOpenSDC";
  arguments: string[];
  source: string;
  url: string;
}

export interface MdisDetailPage {
  survId: string;
  itmDiv: string;
  detailPage: number;
  datasets: MdisDataset[];
  actions: MdisObservedAction[];
  srcobservedAt: string;
  parserVersion: string;
  hashSnapshot: string;
  source: string;
}

export interface MdisServiceItemsInput {
  mappId?: string;
  itmDiv?: string;
  ofrSurvYm?: string;
  query?: string;
  page?: number;
  variablePage?: number;
  pageSize?: number;
  downloadCodebook?: boolean;
}

export interface MdisServiceItem {
  mappId: string;
  itmDiv: string;
  ofrSurvYm: string;
  dataSetLabel: string;
  survAreaId?: string;
  ofrSurvAreaId?: string;
  pmsSurvAreaId: string;
  sourceArguments: string[];
  sourceAction: string;
  rowText: string;
  availability: {
    public: string;
    ras: string;
    sdc: string;
  };
}

export interface MdisServiceItemsPage {
  metadataSource: "service_items";
  items: MdisServiceItem[];
  query: string;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  nextPage: number | null;
  selection?: MdisServiceItem;
  variables: RawRow[];
  variablePage: number;
  variableTotal: number;
  variableHasMore: boolean;
  variableNextPage: number | null;
  codebook?: MdisCodebookDescriptor;
  popupSource?: string;
  popupHashSnapshot?: string;
  sourceActions: string[];
  srcobservedAt: string;
  parserVersion: string;
  hashSnapshot: string;
  source: string;
}

export interface MdisVariablesInput {
  mappId: string;
  survAreaId: string;
  itmDiv: string;
  ofrSurvYm: string;
  survId?: string;
  query?: string;
  variablePage?: number;
  pageSize?: number;
}

export interface MdisVariablesPage {
  variables: RawRow[];
  variablePage: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  nextPage: number | null;
  identityStatus: "verified" | "unverified" | "foreign_survey";
  srcobservedAt: string;
  parserVersion: string;
  hashSnapshot: string;
  source: string;
}

export interface MdisCodebookInput {
  mappId: string;
  ofrSurvYm: string;
  ofrSurvAreaId: string;
  pmsSurvAreaId: string;
  itmDiv: string;
  metadataSource?: "survey_detail" | "service_items";
  sourceWitness?: readonly string[];
}

export interface MdisCodebookDescriptor {
  available: true;
  byteLength: number;
  sha256: string;
  contentType: string;
  headers: Record<string, string>;
  validation: MdisCodebookValidation;
  source: {
    method: "POST";
    url: string;
    form: Record<string, string>;
  };
  srcobservedAt: string;
  parserVersion: string;
  hashSnapshot: string;
}

type MdisTransportDiagnostics = Readonly<{
  pathname?: string;
  phase: "request" | "body";
  cookiePresent: boolean;
  refererPresent: boolean;
}>;

export class MdisApiError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly diagnostics?: MdisTransportDiagnostics;

  constructor(
    code: string,
    message: string,
    status?: number,
    diagnostics?: MdisTransportDiagnostics,
  ) {
    super(message);
    this.name = "MdisApiError";
    this.code = code;
    this.status = status;
    this.diagnostics = diagnostics;
  }
}

function isRecord(value: unknown): value is RawRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function observedAt(): string {
  return new Date().toISOString();
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
type MdisCodebookValidation = {
  level: "header-only";
  format: "cfb-xls";
  signature: "d0cf11e0a1b11ae1";
  headerBytes: 512;
  minorVersion: number;
  majorVersion: 3 | 4;
  byteOrder: "little-endian";
  sectorShift: 9 | 12;
  sectorSize: 512 | 4096;
  miniSectorShift: 6;
  aligned: true;
};

function littleEndian16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function validateCfbXlsHeader(bytes: Uint8Array): MdisCodebookValidation {
  const signature = Uint8Array.from([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
  ]);
  if (
    bytes.byteLength < 512 ||
    !signature.every((value, index) => bytes[index] === value)
  ) {
    throw new MdisApiError(
      "PROVIDER_ERROR",
      "MDIS 코드북 응답이 인식된 XLS 헤더가 아닙니다.",
    );
  }
  // MS-CFB §2.2 recommends (SHOULD), not requires, minor 0x003e.
  // MDIS currently emits 0x003b; retain the observed version as evidence.
  const minorVersion = littleEndian16(bytes, 24);
  const majorVersion = littleEndian16(bytes, 26);
  const byteOrder = littleEndian16(bytes, 28);
  const sectorShift = littleEndian16(bytes, 30);
  const miniSectorShift = littleEndian16(bytes, 32);
  if (majorVersion !== 3 && majorVersion !== 4) {
    throw new MdisApiError(
      "PROVIDER_ERROR",
      "MDIS 코드북 응답의 CFB 버전이 유효하지 않습니다.",
    );
  }
  const expectedSectorShift = majorVersion === 3 ? 9 : 12;
  const sectorSize = majorVersion === 3 ? 512 : 4096;
  if (
    byteOrder !== 0xfffe ||
    sectorShift !== expectedSectorShift ||
    miniSectorShift !== 6 ||
    bytes.byteLength % sectorSize !== 0
  ) {
    throw new MdisApiError(
      "PROVIDER_ERROR",
      "MDIS 코드북 응답의 CFB 헤더 구조가 유효하지 않습니다.",
    );
  }
  return {
    level: "header-only",
    format: "cfb-xls",
    signature: "d0cf11e0a1b11ae1",
    headerBytes: 512,
    minorVersion,
    majorVersion,
    byteOrder: "little-endian",
    sectorShift,
    sectorSize,
    miniSectorShift,
    aligned: true,
  };
}

function pageValues(
  page = 1,
  pageSize = 20,
): { page: number; pageSize: number } {
  if (!Number.isInteger(page) || page < 1)
    throw new MdisApiError("INVALID_INPUT", "page는 1 이상의 정수여야 합니다.");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new MdisApiError(
      "INVALID_INPUT",
      "pageSize는 1에서 100 사이여야 합니다.",
    );
  }
  return { page, pageSize };
}

function publicUrl(
  path: string,
  params?: Record<string, string | undefined>,
): string {
  const url = new URL(path, MDIS_BASE_URL);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value ?? "");
  }
  return url.toString();
}

function classifyDocument(
  document: MdisDocument,
): "login" | "error" | undefined {
  const title =
    document
      .querySelector("title")
      ?.textContent?.replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase() ?? "";
  const forms = Array.from(
    document.querySelectorAll("form"),
  ) as unknown as MdisElement[];
  const hasPublicContent =
    document.querySelector(
      '.board_list table a.underline[id], [onclick^="trDataArea("]',
    ) !== null;
  const loginMarkers = ["login", "sso", "auth", "로그인"];
  const loginForm = forms.some((form) => {
    const action = (form.getAttribute("action") ?? "").toLocaleLowerCase();
    return (
      loginMarkers.some((marker) => action.includes(marker)) &&
      form.querySelector('input[type="password"]') !== null
    );
  });
  if (
    title.includes("login") ||
    title.includes("로그인") ||
    title.includes("sign in") ||
    (!hasPublicContent && loginForm)
  )
    return "login";
  const bodyNode = document.querySelector("body")?.cloneNode(true);
  if (bodyNode) {
    for (const node of Array.from(
      bodyNode.querySelectorAll("script, style, template, noscript"),
    ) as MdisElement[]) {
      node.remove();
    }
  }
  const body =
    bodyNode?.textContent?.replace(/\s+/g, " ").trim().toLocaleLowerCase() ??
    "";
  if (
    title.includes("error") ||
    title.includes("오류") ||
    title.includes("에러") ||
    (!hasPublicContent &&
      (body.includes("error page") ||
        body.includes("error occurred") ||
        body.includes("오류가 발생") ||
        body.includes("error 2065")))
  ) {
    return "error";
  }
  return undefined;
}

function cookieValues(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie;
  if (typeof getSetCookie === "function") return getSetCookie.call(headers);
  const one = headers.get("set-cookie");
  return one ? [one] : [];
}

function cookiePair(header: string): string | undefined {
  const first = header.split(";", 1)[0]?.trim();
  return first && first.includes("=") ? first : undefined;
}

async function readBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new MdisApiError(
      "RESPONSE_TOO_LARGE",
      "MDIS 응답이 허용된 크기를 초과했습니다.",
    );
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes)
      throw new MdisApiError(
        "RESPONSE_TOO_LARGE",
        "MDIS 응답이 허용된 크기를 초과했습니다.",
      );
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      total += chunk.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new MdisApiError(
          "RESPONSE_TOO_LARGE",
          "MDIS 응답이 허용된 크기를 초과했습니다.",
        );
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function parseQuotedArguments(
  raw: string,
  allowThis = false,
): string[] | undefined {
  const value = raw.trim();
  if (value === "") return [];
  const pieces = value.split(",").map((piece) => piece.trim());
  const result: string[] = [];
  for (const [index, piece] of pieces.entries()) {
    if (allowThis && index === 0 && piece === "this") {
      result.push(piece);
      continue;
    }
    const match = /^(?:'([^']*)'|"([^"]*)")$/.exec(piece);
    if (!match) return undefined;
    result.push(match[1] ?? match[2] ?? "");
  }
  return result;
}

function parseOnclick(
  value: string,
  functionName: string,
  allowThis = false,
): string[] | undefined {
  const match = new RegExp(
    `^\\s*${functionName}\\s*\\((.*)\\)\\s*;?\\s*$`,
  ).exec(value);
  return match ? parseQuotedArguments(match[1] ?? "", allowThis) : undefined;
}

function closestRow(element: MdisElement): MdisElement | null {
  return element.closest("tr");
}

function rowLabel(row: MdisElement | null): string {
  return row?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function datasetLabel(row: MdisElement | null): string {
  const firstCell = row?.querySelector("td");
  return firstCell?.textContent?.replace(/\s+/g, " ").trim() || rowLabel(row);
}
function cellTexts(row: MdisElement | null): string[] {
  if (!row) return [];
  return Array.from(row.querySelectorAll("td,th") as unknown as MdisElement[])
    .map((cell) => cell.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter((value) => value !== "");
}

function serviceAvailability(row: MdisElement | null): {
  public: string;
  ras: string;
  sdc: string;
} {
  const cells = row
    ? (Array.from(row.querySelectorAll("td")) as MdisElement[]).map(
        (cell) => cell.textContent?.replace(/\s+/g, " ").trim() ?? "",
      )
    : [];
  const publicValue = cells.at(-5);
  const ras = cells.at(-3);
  const sdc = cells.at(-2);
  if (
    publicValue === undefined ||
    ras === undefined ||
    sdc === undefined ||
    ![publicValue, ras, sdc].every((value) => /^(?:\d+|[-OX])$/i.test(value))
  ) {
    throw new MdisApiError(
      "INVALID_RESPONSE",
      "MDIS 서비스 카탈로그의 제공 항목 수 열을 확인할 수 없습니다.",
    );
  }
  return { public: publicValue, ras, sdc };
}

function serviceCatalogItems(document: MdisDocument): MdisServiceItem[] {
  const items: MdisServiceItem[] = [];
  const seen = new Set<string>();
  for (const element of Array.from(
    document.querySelectorAll("[onclick]"),
  ) as unknown as MdisElement[]) {
    const sourceAction = element.getAttribute("onclick") ?? "";
    const args = parseOnclick(sourceAction, "fnItemDataList");
    if (!args || args.length !== 7) continue;
    const [
      mappId,
      itmDiv,
      rawOfrSurvYm,
      label,
      rawSurvAreaId,
      rawOfrSurvAreaId,
      pmsSurvAreaId,
    ] = args;
    const ofrSurvYm = rawOfrSurvYm.trim();
    if (!mappId || !itmDiv || !ofrSurvYm || !pmsSurvAreaId) continue;
    const survAreaId = rawSurvAreaId.trim();
    const ofrSurvAreaId = rawOfrSurvAreaId.trim();
    const row = closestRow(element);
    const key = `${mappId}:${itmDiv}:${ofrSurvYm}:${survAreaId}:${ofrSurvAreaId}:${pmsSurvAreaId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      mappId,
      itmDiv,
      ofrSurvYm,
      dataSetLabel: label || datasetLabel(row),
      ...(survAreaId ? { survAreaId } : {}),
      ...(ofrSurvAreaId ? { ofrSurvAreaId } : {}),
      pmsSurvAreaId,
      sourceArguments: args,
      sourceAction,
      rowText: rowLabel(row),
      availability: serviceAvailability(row),
    });
  }
  return items;
}

function servicePopupVariables(document: MdisDocument): RawRow[] {
  const variables: RawRow[] = [];
  for (const row of Array.from(
    document.querySelectorAll("tbody tr"),
  ) as unknown as MdisElement[]) {
    const cells = cellTexts(row);
    if (cells.length < 6 || !/^\d+$/.test(cells[0] ?? "")) continue;
    const markers = cells.slice(-3);
    if (!markers.every((value) => /^[-OX]$/i.test(value))) continue;
    const name = cells[1] ?? "";
    const type = cells[2] ?? "";
    if (!name || !type) continue;
    variables.push({
      ordinal: cells[0],
      name,
      type,
      stdItmNm: name,
      rspnUnitNm: type,
      publicAvailability: markers[0],
      rasAvailability: markers[1],
      sdcAvailability: markers[2],
      rawCells: cells,
    });
  }
  return variables;
}

function formObject(entries: Record<string, string>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
}

const OFFICIAL_VARIABLE_FIELDS = [
  "mappId",
  "survId",
  "survNm",
  "ofrSurvAreaId",
  "ofrSurvAreaNm",
  "pmsSurvAreaId",
  "pmsSurvAreaNm",
  "ofrSurvYm",
  "itmDiv",
  "stdItmId",
  "rspnUnitNm",
  "stdItmNm",
  "itmOrdVal",
  "itmCmpstId",
  "rspnGrpId",
  "unifCdUseYn",
  "cdShpeRspnYn",
  "ofrItmYn",
  "pmsItmYn",
  "rasPmsItmCd",
  "rdcPmsItmCd",
] as const;

function publicVariableRows(rows: RawRow[]): RawRow[] {
  return rows.map((row) => {
    const publicRow: RawRow = {};
    for (const key of OFFICIAL_VARIABLE_FIELDS) {
      if (key in row) publicRow[key] = row[key];
    }
    return publicRow;
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new MdisApiError(
      "INVALID_RESPONSE",
      "MDIS 변수 응답이 JSON 형식이 아닙니다.",
    );
  }
}

type VariableIdentity = {
  mappId: string;
  survId?: string;
  survAreaId: string;
  ofrSurvYm: string;
  itmDiv: string;
};

type VariablePayload = {
  rows: RawRow[];
  root?: RawRow;
};

function variablePayload(body: unknown): VariablePayload | undefined {
  if (!isRecord(body)) return undefined;
  const root = isRecord(body.ofrDataVO) ? body.ofrDataVO : undefined;
  if (root !== undefined) {
    if (Array.isArray(root.itmList) && root.itmList.every(isRecord))
      return { rows: root.itmList, root };
    if (Array.isArray(root.itmList64) && root.itmList64.every(isRecord))
      return { rows: root.itmList64, root };
  }
  if (Array.isArray(body.itmList) && body.itmList.every(isRecord))
    return { rows: body.itmList, ...(root === undefined ? {} : { root }) };
  if (Array.isArray(body.itmList64) && body.itmList64.every(isRecord))
    return { rows: body.itmList64, ...(root === undefined ? {} : { root }) };
  return undefined;
}

function identityStatus(
  rows: RawRow[],
  root: RawRow | undefined,
  expected: VariableIdentity,
): "verified" | "unverified" | "foreign_survey" {
  const expectedValues: Record<string, string | undefined> = {
    mappId: expected.mappId,
    survId: expected.survId,
    ofrSurvAreaId: expected.survAreaId,
    ofrSurvYm: expected.ofrSurvYm,
    itmDiv: expected.itmDiv,
  };
  const observed = new Map<string, string>();
  let unverified = false;

  const check = (record: RawRow, requireComplete: boolean): boolean => {
    for (const field of [
      "mappId",
      "survId",
      "ofrSurvAreaId",
      "ofrSurvYm",
      "itmDiv",
    ]) {
      const value = asText(record[field]);
      if (value === undefined) {
        if (requireComplete) unverified = true;
        continue;
      }
      const expectedValue = expectedValues[field];
      if (expectedValue !== undefined && value !== expectedValue) return false;
      const previous = observed.get(field);
      if (previous !== undefined && previous !== value) return false;
      observed.set(field, value);
    }
    return true;
  };

  if (root !== undefined && !check(root, false)) return "foreign_survey";
  if (rows.length === 0) return "unverified";
  for (const row of rows) {
    if (!check(row, true)) return "foreign_survey";
  }
  return unverified ? "unverified" : "verified";
}

function transportDiagnostics(
  url: URL,
  phase: MdisTransportDiagnostics["phase"],
  headers: Readonly<Record<string, unknown>>,
): MdisTransportDiagnostics {
  const hasHeader = (name: string): boolean =>
    Object.keys(headers).some((key) => key.toLocaleLowerCase() === name);
  const pathname = url.pathname.split(";", 1)[0];
  const publicPath = [
    MDIS_CATALOG_PATH,
    MDIS_DETAIL_PATH,
    MDIS_VARIABLE_PATH,
    MDIS_CODEBOOK_PATH,
    MDIS_SERVICE_CATALOG_PATH,
    MDIS_SERVICE_POPUP_PATH,
  ].find((candidate) => candidate === pathname);
  return {
    ...(publicPath === undefined ? {} : { pathname: publicPath }),
    phase,
    cookiePresent: hasHeader("cookie"),
    refererPresent: hasHeader("referer"),
  };
}
export class MdisClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly cookies = new Map<string, string>();

  constructor(options: MdisClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? MDIS_REQUEST_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? MDIS_MAX_RESPONSE_BYTES;
  }

  private requestHeaders(accept: string): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: accept,
    };
    if (this.cookies.size > 0)
      headers.Cookie = [...this.cookies.entries()]
        .map(([key, value]) => `${key}=${value}`)
        .join("; ");
    return headers;
  }

  private rememberCookies(response: Response): void {
    for (const header of cookieValues(response.headers)) {
      const pair = cookiePair(header);
      if (!pair) continue;
      const equal = pair.indexOf("=");
      this.cookies.set(pair.slice(0, equal), pair.slice(equal + 1));
    }
  }

  private async request(
    pathOrUrl: string,
    init: RequestInit = {},
    accept = "text/html",
  ): Promise<{ response: Response; bytes: Uint8Array; url: string }> {
    let url = new URL(pathOrUrl, MDIS_BASE_URL);
    if (url.host !== PUBLIC_HOST || url.protocol !== "https:")
      throw new MdisApiError(
        "REDIRECT_BLOCKED",
        "MDIS 외부 호스트 요청은 차단됩니다.",
      );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const headers = {
        ...this.requestHeaders(accept),
        ...(init.headers ?? {}),
      };
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          ...init,
          headers,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        const diagnostics = transportDiagnostics(url, "request", headers);
        if (error instanceof DOMException && error.name === "AbortError")
          throw new MdisApiError(
            "TIMEOUT",
            "MDIS 요청 시간이 초과되었습니다.",
            undefined,
            diagnostics,
          );
        throw new MdisApiError(
          "NETWORK_ERROR",
          "MDIS 공개 웹 요청을 처리하지 못했습니다.",
          undefined,
          diagnostics,
        );
      }
      this.rememberCookies(response);
      if (response.status >= 300 && response.status < 400) {
        clearTimeout(timer);
        const location = response.headers.get("location");
        if (!location)
          throw new MdisApiError(
            "REDIRECT_BLOCKED",
            "MDIS 리디렉션 위치가 없습니다.",
            response.status,
          );
        const next = new URL(location, url);
        const redirectText =
          `${next.pathname}${next.search}`.toLocaleLowerCase();
        const loginRedirect = ["login", "sso", "auth"].some((marker) =>
          redirectText.includes(marker),
        );
        if (
          next.host !== PUBLIC_HOST ||
          next.protocol !== "https:" ||
          loginRedirect
        ) {
          throw new MdisApiError(
            "REDIRECT_BLOCKED",
            "로그인 또는 외부 호스트 리디렉션은 자동으로 따라가지 않습니다.",
            response.status,
          );
        }
        url = next;
        continue;
      }
      if (!response.ok) {
        clearTimeout(timer);
        throw new MdisApiError(
          "PROVIDER_ERROR",
          `MDIS 공개 웹 요청이 HTTP ${response.status}로 실패했습니다.`,
          response.status,
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = await readBytes(response, this.maxResponseBytes);
      } catch (error) {
        if (error instanceof MdisApiError) throw error;
        const diagnostics = transportDiagnostics(url, "body", headers);
        if (error instanceof DOMException && error.name === "AbortError")
          throw new MdisApiError(
            "TIMEOUT",
            "MDIS 응답 본문 읽기 시간이 초과되었습니다.",
            undefined,
            diagnostics,
          );
        throw new MdisApiError(
          "NETWORK_ERROR",
          "MDIS 응답 본문을 읽지 못했습니다.",
          undefined,
          diagnostics,
        );
      } finally {
        clearTimeout(timer);
      }
      return { response, bytes, url: url.toString() };
    }
    throw new MdisApiError(
      "REDIRECT_BLOCKED",
      "MDIS 리디렉션 횟수가 허용 한도를 초과했습니다.",
    );
  }

  async searchCatalog(input: MdisCatalogInput = {}): Promise<MdisCatalogPage> {
    const { page, pageSize } = pageValues(input.page, input.pageSize);
    const query = input.query?.trim() ?? "";
    const request = await this.request(
      `${MDIS_CATALOG_PATH}?curMenuNo=UI_POR_P9220`,
      {},
      "text/html",
    );
    const html = new TextDecoder().decode(request.bytes);
    const parsedHtml = parseHTML(html);
    const pageKind = classifyDocument(
      parsedHtml.document as unknown as MdisDocument,
    );
    if (pageKind)
      throw new MdisApiError(
        pageKind === "login" ? "LOGIN_REQUIRED" : "PROVIDER_ERROR",
        `MDIS ${pageKind} 페이지를 카탈로그로 사용할 수 없습니다.`,
      );
    const document = parsedHtml.document as unknown as MdisDocument;
    const table = document.querySelector(".board_list table");
    if (!table)
      throw new MdisApiError(
        "INVALID_RESPONSE",
        "MDIS 카탈로그 표 구조를 확인할 수 없습니다.",
      );
    const seen = new Set<string>();
    const candidates: MdisCatalogEntry[] = [];
    for (const anchor of Array.from(
      document.querySelectorAll(
        ".board_list table tbody tr.notice a.underline[id]",
      ),
    ) as unknown as MdisElement[]) {
      const anchorId = anchor.getAttribute("id")?.trim() ?? "";
      const separator = anchorId.indexOf("_");
      if (separator <= 0 || separator === anchorId.length - 1) continue;
      const prefix = anchorId.slice(0, separator);
      const survId = anchorId.slice(separator + 1);
      if (
        !survId
          .split("")
          .every((character) => character >= "0" && character <= "9")
      )
        continue;
      const itmDiv = prefix === "STAT" ? "1" : "2";
      const key = `${survId}:${itmDiv}`;
      if (seen.has(key)) continue;
      const row = closestRow(anchor);
      const rowText = rowLabel(row);
      const surveyName =
        anchor
          .querySelector("span")
          ?.textContent?.replace(/\s+/g, " ")
          .trim() ||
        anchor.textContent?.replace(/\s+/g, " ").trim() ||
        "";
      if (!surveyName) continue;
      seen.add(key);
      candidates.push({
        survId,
        name: surveyName,
        anchorId,
        prefix,
        itmDiv,
        rowText,
      });
    }
    if (candidates.length === 0)
      throw new MdisApiError(
        "INVALID_RESPONSE",
        "MDIS 카탈로그에서 공개 조사 항목을 확인할 수 없습니다.",
      );
    const loweredQuery = query.toLocaleLowerCase();
    const all =
      query === ""
        ? candidates
        : candidates.filter((item) =>
            `${item.name} ${item.rowText}`
              .toLocaleLowerCase()
              .includes(loweredQuery),
          );
    const start = (page - 1) * pageSize;
    const items = all.slice(start, start + pageSize);
    return {
      items,
      page,
      pageSize,
      total: all.length,
      hasMore: start + items.length < all.length,
      nextPage: start + items.length < all.length ? page + 1 : null,
      srcobservedAt: observedAt(),
      parserVersion: MDIS_PARSER_VERSION,
      hashSnapshot: sha256(request.bytes),
      source: SOURCE_NAME,
    };
  }

  async getServiceItems(
    input: MdisServiceItemsInput = {},
  ): Promise<MdisServiceItemsPage> {
    const { page, pageSize } = pageValues(input.page, input.pageSize);
    const variablePage = input.variablePage ?? 1;
    if (!Number.isInteger(variablePage) || variablePage < 1)
      throw new MdisApiError(
        "INVALID_INPUT",
        "variablePage는 1 이상의 정수여야 합니다.",
      );
    const query = input.query?.trim() ?? "";
    const selectionFields = [
      input.mappId,
      input.itmDiv,
      input.ofrSurvYm,
    ].filter((value) => value !== undefined);
    if (
      selectionFields.length !== 3 &&
      (input.downloadCodebook === true || (input.variablePage ?? 1) > 1)
    )
      throw new MdisApiError(
        "SELECTION_REQUIRED",
        "변수 페이지와 코드북은 명시적 service_items 선택과 함께 사용해야 합니다.",
      );
    const catalogueRequest = await this.request(
      `${MDIS_SERVICE_CATALOG_PATH}?curMenuNo=UI_POR_P9230`,
      {},
      "text/html",
    );
    const catalogueParsed = parseHTML(
      new TextDecoder().decode(catalogueRequest.bytes),
    );
    const catalogueDocument =
      catalogueParsed.document as unknown as MdisDocument;
    const catalogueKind = classifyDocument(catalogueDocument);
    if (catalogueKind)
      throw new MdisApiError(
        catalogueKind === "login" ? "LOGIN_REQUIRED" : "PROVIDER_ERROR",
        `MDIS 서비스 자료 페이지를 사용할 수 없습니다.`,
      );
    const allItems = serviceCatalogItems(catalogueDocument);
    if (allItems.length === 0)
      throw new MdisApiError(
        "INVALID_RESPONSE",
        "MDIS 서비스 자료에서 선택 가능한 항목을 확인할 수 없습니다.",
      );
    const loweredQuery = query.toLocaleLowerCase();
    const filtered = query
      ? allItems.filter((item) =>
          `${item.dataSetLabel} ${item.rowText}`
            .toLocaleLowerCase()
            .includes(loweredQuery),
        )
      : allItems;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);
    const baseResult: MdisServiceItemsPage = {
      metadataSource: "service_items",
      items,
      query,
      page,
      pageSize,
      total: filtered.length,
      hasMore: start + items.length < filtered.length,
      nextPage: start + items.length < filtered.length ? page + 1 : null,
      variables: [],
      variablePage,
      variableTotal: 0,
      variableHasMore: false,
      variableNextPage: null,
      sourceActions: [],
      srcobservedAt: observedAt(),
      parserVersion: MDIS_PARSER_VERSION,
      hashSnapshot: sha256(catalogueRequest.bytes),
      source: `${MDIS_BASE_URL}${MDIS_SERVICE_CATALOG_PATH}?curMenuNo=UI_POR_P9230`,
    };
    const selectedFields = [input.mappId, input.itmDiv, input.ofrSurvYm].filter(
      (value) => value !== undefined,
    );
    if (selectedFields.length > 0 && selectedFields.length < 3)
      throw new MdisApiError(
        "INVALID_INPUT",
        "service_items 선택에는 mappId, itmDiv, ofrSurvYm가 모두 필요합니다.",
      );
    if (selectedFields.length === 0) return baseResult;
    const mappId = input.mappId as string;
    const itmDiv = input.itmDiv as string;
    const ofrSurvYm = input.ofrSurvYm as string;
    const matches = allItems.filter(
      (item) =>
        item.mappId === mappId &&
        item.itmDiv === itmDiv &&
        item.ofrSurvYm === ofrSurvYm,
    );
    if (matches.length !== 1)
      throw new MdisApiError(
        "RESPONSE_MISMATCH",
        matches.length === 0
          ? "요청한 service_items 선택자가 공개 서비스 카탈로그의 실제 행과 일치하지 않습니다."
          : "요청한 service_items 선택자가 공개 서비스 카탈로그에서 모호합니다.",
      );
    const selected = matches[0] as MdisServiceItem;
    const popupUrl = publicUrl(MDIS_SERVICE_POPUP_PATH, {
      mappId,
      itmDiv,
      ofrSurvYm,
      survAreaId: selected.survAreaId ?? "",
      ofrSurvAreaId: selected.ofrSurvAreaId ?? "",
      pmsSurvAreaId: selected.pmsSurvAreaId,
    });
    const popupRequest = await this.request(
      popupUrl,
      { headers: { Referer: catalogueRequest.url } },
      "text/html",
    );
    const popupParsed = parseHTML(new TextDecoder().decode(popupRequest.bytes));
    const popupDocument = popupParsed.document as unknown as MdisDocument;
    const popupKind = classifyDocument(popupDocument);
    if (popupKind)
      throw new MdisApiError(
        popupKind === "login" ? "LOGIN_REQUIRED" : "PROVIDER_ERROR",
        "MDIS service_items popup을 사용할 수 없습니다.",
      );
    const popupResponseUrl = new URL(popupRequest.url);
    const expectedPopupUrl = new URL(popupUrl);
    for (const key of [
      "mappId",
      "itmDiv",
      "ofrSurvYm",
      "survAreaId",
      "ofrSurvAreaId",
      "pmsSurvAreaId",
    ]) {
      if (
        popupResponseUrl.origin !== expectedPopupUrl.origin ||
        popupResponseUrl.pathname !== expectedPopupUrl.pathname ||
        popupResponseUrl.searchParams.get(key) !==
          expectedPopupUrl.searchParams.get(key)
      )
        throw new MdisApiError(
          "RESPONSE_MISMATCH",
          "MDIS service_items popup 응답 URL이 선택 identity와 일치하지 않습니다.",
        );
    }
    const renderedItmDiv =
      popupDocument
        .querySelector('input[name="itmDiv"], input#itmDiv')
        ?.getAttribute("value")
        ?.trim() ?? "";
    if (renderedItmDiv !== itmDiv)
      throw new MdisApiError(
        "RESPONSE_MISMATCH",
        "MDIS service_items popup의 rendered itmDiv가 선택 identity와 일치하지 않습니다.",
      );
    const variables = servicePopupVariables(popupDocument);
    if (variables.length === 0)
      throw new MdisApiError(
        "INVALID_RESPONSE",
        "MDIS service_items popup에서 변수 행을 확인할 수 없습니다.",
      );
    const expectedCodebookArgs = [
      mappId,
      ofrSurvYm,
      selected.ofrSurvAreaId ?? "",
      selected.pmsSurvAreaId,
    ];
    const codebookActions: string[] = [];
    for (const element of Array.from(
      popupDocument.querySelectorAll("[onclick]"),
    ) as unknown as MdisElement[]) {
      const sourceAction = element.getAttribute("onclick") ?? "";
      const args = parseOnclick(sourceAction, "fnExcelDownload");
      if (
        args &&
        args.length === expectedCodebookArgs.length &&
        args.every((value, index) => value === expectedCodebookArgs[index])
      )
        codebookActions.push(sourceAction);
    }
    if (codebookActions.length === 0)
      throw new MdisApiError(
        "RESPONSE_MISMATCH",
        "MDIS popup의 코드북 form이 선택한 service_items identity와 일치하지 않습니다.",
      );
    const result: MdisServiceItemsPage = {
      ...baseResult,
      selection: selected,
      variables: variables.slice(
        (variablePage - 1) * pageSize,
        (variablePage - 1) * pageSize + pageSize,
      ),
      variablePage,
      variableTotal: variables.length,
      variableHasMore: variablePage * pageSize < variables.length,
      variableNextPage:
        variablePage * pageSize < variables.length ? variablePage + 1 : null,
      popupSource: popupRequest.url,
      popupHashSnapshot: sha256(popupRequest.bytes),
      sourceActions: [selected.sourceAction, ...codebookActions],
    };
    if (input.downloadCodebook) {
      result.codebook = await this.downloadCodebook({
        metadataSource: "service_items",
        mappId,
        ofrSurvYm,
        ofrSurvAreaId: selected.ofrSurvAreaId ?? "",
        pmsSurvAreaId: selected.pmsSurvAreaId,
        itmDiv: renderedItmDiv,
        sourceWitness: expectedCodebookArgs,
      });
    }
    return result;
  }
  async getDetail(input: MdisDetailInput): Promise<MdisDetailPage> {
    const detailPage = input.detailPage ?? 1;
    if (!Number.isInteger(detailPage) || detailPage < 1)
      throw new MdisApiError(
        "INVALID_INPUT",
        "detailPage는 1 이상의 정수여야 합니다.",
      );
    const survId = asText(input.survId);
    const itmDiv = asText(input.itmDiv);
    if (!survId || !itmDiv)
      throw new MdisApiError("INVALID_INPUT", "survId와 itmDiv가 필요합니다.");
    const url = publicUrl(MDIS_DETAIL_PATH, {
      survId,
      itmDiv,
      nPage: String(detailPage),
      itemId: "",
      itemNm: "",
    });
    const request = await this.request(url, {}, "text/html");
    const html = new TextDecoder().decode(request.bytes);
    const parsedHtml = parseHTML(html);
    const pageKind = classifyDocument(
      parsedHtml.document as unknown as MdisDocument,
    );
    if (pageKind)
      throw new MdisApiError(
        pageKind === "login" ? "LOGIN_REQUIRED" : "PROVIDER_ERROR",
        `MDIS ${pageKind} 페이지를 조사 상세로 사용할 수 없습니다.`,
      );
    const document = parsedHtml.document as unknown as MdisDocument;
    const datasets = new Map<string, MdisDataset>();
    const ensureDataset = (
      mappId: string,
      row: MdisElement | null,
      identity?: { survAreaId?: string; ofrSurvYm?: string },
    ): MdisDataset => {
      const existing = [...datasets.values()].find(
        (dataset) =>
          dataset.mappId === mappId &&
          (identity?.survAreaId === undefined ||
            dataset.survAreaId === identity.survAreaId) &&
          (identity?.ofrSurvYm === undefined ||
            dataset.ofrSurvYm === identity.ofrSurvYm),
      );
      if (existing) return existing;
      const key = `${mappId}:${identity?.survAreaId ?? ""}:${identity?.ofrSurvYm ?? ""}:${datasets.size}`;
      const created: MdisDataset = {
        mappId,
        dataSetLabel: datasetLabel(row),
        ...(identity?.survAreaId === undefined
          ? {}
          : { survAreaId: identity.survAreaId }),
        ...(identity?.ofrSurvYm === undefined
          ? {}
          : { ofrSurvYm: identity.ofrSurvYm }),
        sourceActions: [],
        rawActionArguments: {},
      };
      datasets.set(key, created);
      return created;
    };
    for (const element of Array.from(
      document.querySelectorAll("[onclick]"),
    ) as unknown as MdisElement[]) {
      const onclick = element.getAttribute("onclick") ?? "";
      const trData = parseOnclick(onclick, "trDataArea", true);
      if (trData && trData.length === 5) {
        const [, mappId, survAreaId, datasetItmDiv, ofrSurvYm] = trData;
        if (mappId && survAreaId && datasetItmDiv && ofrSurvYm) {
          const dataset = ensureDataset(mappId, closestRow(element), {
            survAreaId,
            ofrSurvYm,
          });
          dataset.survAreaId = survAreaId;
          dataset.itmDiv = datasetItmDiv;
          dataset.ofrSurvYm = ofrSurvYm;
          dataset.sourceActions.push("trDataArea");
          dataset.rawActionArguments.trDataArea = trData.slice(1);
        }
      }
      const excel = parseOnclick(onclick, "fnExcelDownload");
      if (excel && excel.length === 4) {
        const [mappId, ofrSurvYm, ofrSurvAreaId, pmsSurvAreaId] = excel;
        if (mappId && ofrSurvYm && ofrSurvAreaId && pmsSurvAreaId) {
          const dataset = ensureDataset(mappId, closestRow(element), {
            survAreaId: ofrSurvAreaId,
            ofrSurvYm,
          });
          dataset.ofrSurvYm = dataset.ofrSurvYm ?? ofrSurvYm;
          dataset.survAreaId = dataset.survAreaId ?? ofrSurvAreaId;
          dataset.pmsSurvAreaId = pmsSurvAreaId;
          dataset.ofrSurvAreaId = ofrSurvAreaId;
          dataset.sourceActions.push("fnExcelDownload");
          dataset.rawActionArguments.fnExcelDownload = excel;
        }
      }
    }
    const actions: MdisObservedAction[] = [];
    const knownActions: Array<{
      name: MdisObservedAction["functionName"];
      url: string;
    }> = [
      { name: "fnOpenDownLoad", url: MDIS_DOWNLOAD_URL },
      { name: "fnOpenRAS", url: MDIS_RAS_URL },
      { name: "fnOpenSDC", url: MDIS_SDC_URL },
    ];
    for (const element of Array.from(
      document.querySelectorAll("[onclick]"),
    ) as unknown as MdisElement[]) {
      const onclick = element.getAttribute("onclick") ?? "";
      for (const known of knownActions) {
        const args = parseOnclick(onclick, known.name);
        if (!args || args.length < 1) continue;
        actions.push({
          functionName: known.name,
          arguments: args,
          source: onclick,
          url: known.url,
        });
      }
    }
    if (datasets.size === 0 && actions.length === 0)
      throw new MdisApiError(
        "INVALID_RESPONSE",
        "MDIS 조사 상세에서 공개 dataset 또는 신청 경로를 확인할 수 없습니다.",
      );
    return {
      detailPage,
      survId,
      itmDiv,
      datasets: [...datasets.values()],
      actions,
      srcobservedAt: observedAt(),
      parserVersion: MDIS_PARSER_VERSION,
      hashSnapshot: sha256(request.bytes),
      source: SOURCE_NAME,
    };
  }

  async getVariables(input: MdisVariablesInput): Promise<MdisVariablesPage> {
    const variablePage = input.variablePage ?? 1;
    const { pageSize } = pageValues(variablePage, input.pageSize);
    if (!input.mappId || !input.survAreaId || !input.itmDiv || !input.ofrSurvYm)
      throw new MdisApiError(
        "INVALID_INPUT",
        "변수 조회에는 mappId, survAreaId, itmDiv, ofrSurvYm가 필요합니다.",
      );
    const body = formObject({
      mappId: input.mappId,
      survAreaId: input.survAreaId,
      itmDiv: input.itmDiv,
      ofrSurvYm: input.ofrSurvYm,
    });
    const request = await this.request(
      MDIS_VARIABLE_PATH,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      "application/json,text/plain,*/*",
    );
    const text = new TextDecoder().decode(request.bytes);
    const parsed = parseJson(text);
    const payload = variablePayload(parsed);
    if (!payload)
      throw new MdisApiError(
        "INVALID_RESPONSE",
        "MDIS 변수 응답의 itmList 구조를 확인할 수 없습니다.",
      );
    const { rows } = payload;
    const status = identityStatus(rows, payload.root, {
      mappId: input.mappId,
      survId: input.survId,
      survAreaId: input.survAreaId,
      ofrSurvYm: input.ofrSurvYm,
      itmDiv: input.itmDiv,
    });
    if (status === "foreign_survey")
      throw new MdisApiError(
        "RESPONSE_MISMATCH",
        "MDIS 변수 응답이 요청한 조사 또는 dataset과 일치하지 않습니다.",
      );
    const query = input.query?.trim().toLocaleLowerCase() ?? "";
    const filtered =
      query === ""
        ? rows
        : rows.filter((row) =>
            `${asText(row.stdItmNm) ?? ""} ${asText(row.rspnUnitNm) ?? ""}`
              .toLocaleLowerCase()
              .includes(query),
          );
    const publicRows = publicVariableRows(filtered);
    const start = (variablePage - 1) * pageSize;
    const variables = publicRows.slice(start, start + pageSize);
    return {
      variables,
      variablePage,
      pageSize,
      total: filtered.length,
      hasMore: start + variables.length < filtered.length,
      nextPage:
        start + variables.length < filtered.length ? variablePage + 1 : null,
      identityStatus: status,
      srcobservedAt: observedAt(),
      parserVersion: MDIS_PARSER_VERSION,
      hashSnapshot: sha256(request.bytes),
      source: SOURCE_NAME,
    };
  }

  async downloadCodebook(
    input: MdisCodebookInput,
  ): Promise<MdisCodebookDescriptor> {
    const serviceItems = input.metadataSource === "service_items";
    const expectedWitness = [
      input.mappId,
      input.ofrSurvYm,
      input.ofrSurvAreaId,
      input.pmsSurvAreaId,
    ];
    const witnessMatches =
      input.sourceWitness?.length === expectedWitness.length &&
      input.sourceWitness.every(
        (value, index) => value === expectedWitness[index],
      );
    if (
      !input.mappId ||
      !input.ofrSurvYm ||
      (!serviceItems && !input.ofrSurvAreaId) ||
      !input.pmsSurvAreaId ||
      !input.itmDiv ||
      (serviceItems && !witnessMatches)
    )
      throw new MdisApiError(
        "INVALID_INPUT",
        "코드북에는 source-witnessed dataset 식별 필드가 필요합니다.",
      );
    const formValues: Record<string, string> = {
      mappId: input.mappId,
      ofrSurvYm: input.ofrSurvYm,
      ofrSurvAreaId: input.ofrSurvAreaId,
      pmsSurvAreaId: input.pmsSurvAreaId,
      curMenuNo: "",
      itmDiv: input.itmDiv,
    };
    const request = await this.request(
      MDIS_CODEBOOK_PATH,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formObject(formValues),
      },
      "application/vnd.ms-excel,application/octet-stream,*/*",
    );
    const finalCodebookUrl = new URL(request.url);
    if (
      finalCodebookUrl.origin !== MDIS_BASE_URL ||
      finalCodebookUrl.pathname !== MDIS_CODEBOOK_PATH
    )
      throw new MdisApiError(
        "RESPONSE_MISMATCH",
        "MDIS 코드북 응답 URL이 공식 코드북 경로와 일치하지 않습니다.",
      );
    const bytes = request.bytes;
    if (bytes.byteLength === 0)
      throw new MdisApiError(
        "INVALID_RESPONSE",
        "MDIS 코드북 응답이 비어 있습니다.",
      );
    const contentType = request.response.headers.get("content-type") ?? "";
    const mime = contentType.split(";", 1)[0]?.trim().toLocaleLowerCase() ?? "";
    if (mime !== "application/vnd.ms-excel")
      throw new MdisApiError(
        "PROVIDER_ERROR",
        "MDIS 코드북 응답이 지원되는 XLS 형식이 아닙니다.",
      );
    const prefix = new TextDecoder()
      .decode(bytes.slice(0, 64))
      .trimStart()
      .toLocaleLowerCase();
    if (
      prefix.startsWith("<!doctype") ||
      prefix.startsWith("<html") ||
      prefix.startsWith("<title")
    ) {
      throw new MdisApiError(
        "PROVIDER_ERROR",
        "MDIS 코드북 요청이 HTML 오류 페이지를 반환했습니다.",
      );
    }
    if (prefix.startsWith("{") || prefix.startsWith("[")) {
      throw new MdisApiError(
        "PROVIDER_ERROR",
        "MDIS 코드북 요청이 구조화된 오류 응답을 반환했습니다.",
      );
    }
    const OLE_XLS_SIGNATURE = Uint8Array.from([
      0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
    ]);
    if (
      bytes.length < OLE_XLS_SIGNATURE.length ||
      !OLE_XLS_SIGNATURE.every((value, index) => bytes[index] === value)
    ) {
      throw new MdisApiError(
        "PROVIDER_ERROR",
        "MDIS 코드북 응답이 인식된 XLS 서명이 아닙니다.",
      );
    }
    const headers: Record<string, string> = {};
    for (const key of [
      "content-type",
      "content-disposition",
      "content-length",
    ]) {
      const value = request.response.headers.get(key);
      if (value) headers[key] = value;
    }
    return {
      available: true,
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
      contentType,
      validation: validateCfbXlsHeader(bytes),
      headers,
      source: {
        method: "POST",
        url: request.url,
        form: formValues,
      },
      srcobservedAt: observedAt(),
      parserVersion: MDIS_PARSER_VERSION,
      hashSnapshot: sha256(bytes),
    };
  }
}

let clientInstance: MdisClient | null = null;

export function getMdisClient(): MdisClient {
  return (clientInstance ??= new MdisClient());
}

/** Test-only reset; it cannot install credentials or caller cookies. */
export function resetMdisClientForTests(): void {
  clientInstance = null;
}
