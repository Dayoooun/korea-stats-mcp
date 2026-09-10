/**
 * 소상공인시장진흥공단 상권정보 OpenAPI client.
 *
 * This provider is intentionally independent from the core statistics client. The operator's
 * DATA_GO_KR_SERVICE_KEY is read only when a request is made; callers cannot
 * provide credentials through the business-search input.
 */

import { createHash } from "node:crypto";
import NodeCache from "node-cache";

export const BUSINESS_REGION_ENDPOINT =
  "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong";
export const BUSINESS_INDUSTRY_ENDPOINT =
  "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInUpjong";
export const BUSINESS_DOC_URL =
  "https://www.data.go.kr/data/15012005/openapi.do";
export const BUSINESS_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const BUSINESS_REQUEST_TIMEOUT_MS = 8_000;

export type BusinessRegionType = "ctprvnCd" | "signguCd" | "adongCd";
export type BusinessIndustryType = "indsLclsCd" | "indsMclsCd" | "indsSclsCd";
export type BusinessRow = Record<string, unknown>;

export interface BusinessSearchInput {
  regionType?: BusinessRegionType;
  regionCode?: string;
  industryType?: BusinessIndustryType;
  industryCode?: string;
  page?: number;
  pageSize?: number;
}

export interface BusinessPage {
  items: BusinessRow[];
  page: number;
  pageSize: number;
  providerPageNo: number;
  providerNumOfRows: number;
  providerTotal: number;
  returnedCount: number;
  hasMore: boolean;
  nextPage: number | null;
  stdrYm?: string;
  validationLevel: "verified" | "unverified";
  missingFields: string[];
  observedAt: string;
}
export interface SignguAffiliationFound {
  status: "found";
  ctprvnCd: string;
  ctprvnNm: string;
  signguCd: string;
  signguNm: string;
  observedAt: string;
  stdrYm?: string;
}

export interface SignguAffiliationNoRows {
  status: "no_rows";
}

export interface SignguAffiliationIncompleteRow {
  status: "incomplete_row";
  missingFields: string[];
}

export type SignguAffiliationResult =
  | SignguAffiliationFound
  | SignguAffiliationNoRows
  | SignguAffiliationIncompleteRow;

export type SignguAffiliationClient = Pick<BusinessesClient, "search">;
export type SignguAffiliationLookup = (
  signguCode: string,
) => Promise<SignguAffiliationResult>;

export class BusinessesApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BusinessesApiError";
  }
}

type FetchLike = typeof fetch;

interface BusinessesClientOptions {
  /** Test seam; production calls use globalThis.fetch. This is not a credential. */
  fetchImpl?: FetchLike;
  /** Test seam only; production remains bounded to eight seconds. */
  timeoutMs?: number;
  cache?: NodeCache;
}

interface ProviderEnvelope {
  header: Record<string, unknown>;
  body: Record<string, unknown>;
}

const REGION_TYPES: readonly BusinessRegionType[] = [
  "ctprvnCd",
  "signguCd",
  "adongCd",
];
const INDUSTRY_TYPES: readonly BusinessIndustryType[] = [
  "indsLclsCd",
  "indsMclsCd",
  "indsSclsCd",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function decodeServiceKey(raw: string): string {
  const trimmed = raw.trim();
  if (!/%[0-9a-f]{2}/i.test(trimmed)) return trimmed;
  try {
    // DATA_GO_KR_SERVICE_KEY may be copied from either the issued key or its
    // URL-encoded form. Decode exactly once, then URLSearchParams encodes it.
    return decodeURIComponent(trimmed);
  } catch {
    // A malformed percent sequence is passed through as entered. It is still
    // encoded safely by URLSearchParams and never appears in an error message.
    return trimmed;
  }
}

function keyFingerprint(serviceKey: string): string {
  return createHash("sha256").update(serviceKey).digest("hex");
}

function queryFingerprint(
  input: Required<Pick<BusinessSearchInput, "page" | "pageSize">> &
    BusinessSearchInput,
  serviceKey: string,
): string {
  const normalized = {
    regionType: input.regionType ?? null,
    regionCode: input.regionCode ?? null,
    industryType: input.industryType ?? null,
    industryCode: input.industryCode ?? null,
    page: input.page,
    pageSize: input.pageSize,
    serviceKey: keyFingerprint(serviceKey),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function validateInput(
  input: BusinessSearchInput,
): Required<Pick<BusinessSearchInput, "page" | "pageSize">> &
  BusinessSearchInput {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  if (!Number.isInteger(page) || page < 1) {
    throw new BusinessesApiError(
      "INVALID_INPUT",
      "페이지 번호는 1 이상이어야 합니다.",
    );
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new BusinessesApiError(
      "INVALID_INPUT",
      "페이지 크기는 1~1000 범위여야 합니다.",
    );
  }

  const hasRegionType = input.regionType !== undefined;
  const hasRegionCode = nonEmptyString(input.regionCode);
  const hasIndustryType = input.industryType !== undefined;
  const hasIndustryCode = nonEmptyString(input.industryCode);
  if (hasRegionType !== hasRegionCode || hasIndustryType !== hasIndustryCode) {
    throw new BusinessesApiError(
      "INVALID_INPUT",
      "지역/업종 유형과 코드는 함께 입력해야 합니다.",
    );
  }
  if (!hasRegionType && !hasIndustryType) {
    throw new BusinessesApiError(
      "INVALID_INPUT",
      "지역 또는 업종 조회 조건이 필요합니다.",
    );
  }
  if (
    hasRegionType &&
    !REGION_TYPES.includes(input.regionType as BusinessRegionType)
  ) {
    throw new BusinessesApiError(
      "INVALID_INPUT",
      "지원하지 않는 지역 구분입니다.",
    );
  }
  if (
    hasIndustryType &&
    !INDUSTRY_TYPES.includes(input.industryType as BusinessIndustryType)
  ) {
    throw new BusinessesApiError(
      "INVALID_INPUT",
      "지원하지 않는 업종 구분입니다.",
    );
  }

  return {
    ...input,
    regionCode: hasRegionCode ? input.regionCode!.trim() : undefined,
    industryCode: hasIndustryCode ? input.industryCode!.trim() : undefined,
    page,
    pageSize,
  };
}

function requestParams(
  input: Required<Pick<BusinessSearchInput, "page" | "pageSize">> &
    BusinessSearchInput,
  serviceKey: string,
): {
  endpoint: string;
  params: URLSearchParams;
} {
  const regionQuery = input.regionType !== undefined;
  const endpoint = regionQuery
    ? BUSINESS_REGION_ENDPOINT
    : BUSINESS_INDUSTRY_ENDPOINT;
  const params = new URLSearchParams();
  if (regionQuery) {
    params.set("divId", input.regionType!);
    params.set("key", input.regionCode!);
    if (
      input.industryType === "indsLclsCd" ||
      input.industryType === "indsMclsCd" ||
      input.industryType === "indsSclsCd"
    ) {
      params.set(input.industryType, input.industryCode!);
    }
  } else {
    params.set("divId", input.industryType!);
    params.set("key", input.industryCode!);
  }
  params.set("numOfRows", String(input.pageSize));
  params.set("pageNo", String(input.page));
  params.set("type", "json");
  params.set("serviceKey", serviceKey);
  return { endpoint, params };
}

function responseHeaderAndBody(value: unknown): ProviderEnvelope {
  if (!isRecord(value)) {
    throw new BusinessesApiError(
      "INVALID_RESPONSE",
      "공공데이터 응답 형식이 올바르지 않습니다.",
    );
  }
  const response = value;
  if (!isRecord(response.header) || !isRecord(response.body)) {
    throw new BusinessesApiError(
      "INVALID_RESPONSE",
      "공공데이터 응답 형식이 올바르지 않습니다.",
    );
  }
  return { header: response.header, body: response.body };
}

function parseItems(body: Record<string, unknown>): BusinessRow[] {
  if (!Object.prototype.hasOwnProperty.call(body, "items")) {
    throw new BusinessesApiError(
      "INVALID_RESPONSE",
      "공공데이터 응답의 업소 목록이 없습니다.",
    );
  }
  const items = body.items;
  let rawItems: unknown;
  if (Array.isArray(items)) {
    rawItems = items;
  } else if (
    isRecord(items) &&
    Object.prototype.hasOwnProperty.call(items, "item")
  ) {
    rawItems = items.item;
  } else {
    throw new BusinessesApiError(
      "INVALID_RESPONSE",
      "공공데이터 응답의 업소 목록 형식이 올바르지 않습니다.",
    );
  }

  const rows = Array.isArray(rawItems) ? rawItems : [rawItems];
  if (rows.some((row) => !isRecord(row))) {
    throw new BusinessesApiError(
      "INVALID_RESPONSE",
      "공공데이터 응답 행 형식이 올바르지 않습니다.",
    );
  }
  return rows as BusinessRow[];
}

function parseEnvelope(
  value: unknown,
  input: Required<Pick<BusinessSearchInput, "page" | "pageSize">> &
    BusinessSearchInput,
): Omit<BusinessPage, "observedAt"> {
  const { header, body } = responseHeaderAndBody(value);
  if (String(header.resultCode ?? "") !== "00") {
    throw new BusinessesApiError(
      "PROVIDER_ERROR",
      "공공데이터 제공기관이 요청을 처리하지 못했습니다.",
    );
  }

  const providerPageNo = asInteger(body.pageNo);
  const providerNumOfRows = asInteger(body.numOfRows);
  const providerTotal = asInteger(body.totalCount);
  if (
    providerPageNo === undefined ||
    providerNumOfRows === undefined ||
    providerTotal === undefined ||
    providerTotal < 0
  ) {
    throw new BusinessesApiError(
      "INVALID_RESPONSE",
      "공공데이터 응답의 페이지 정보가 올바르지 않습니다.",
    );
  }
  if (providerPageNo !== input.page || providerNumOfRows !== input.pageSize) {
    throw new BusinessesApiError(
      "RESPONSE_MISMATCH",
      "공공데이터 응답의 페이지 정보가 요청과 다릅니다.",
    );
  }

  const items = parseItems(body);
  if (items.length > input.pageSize || providerTotal < items.length) {
    throw new BusinessesApiError(
      "INVALID_RESPONSE",
      "공공데이터 응답의 건수가 올바르지 않습니다.",
    );
  }
  if (
    items.length === 0 &&
    input.page > 1 &&
    (input.page - 1) * input.pageSize < providerTotal
  ) {
    throw new BusinessesApiError(
      "EMPTY_PAGE",
      "공공데이터 중간 페이지가 비어 있습니다. 다음 요청을 중단해주세요.",
    );
  }
  const expectedCount = Math.min(
    input.pageSize,
    Math.max(0, providerTotal - (input.page - 1) * input.pageSize),
  );
  if (items.length !== expectedCount) {
    throw new BusinessesApiError(
      "INCOMPLETE_PAGE",
      "공공데이터 응답 건수가 전체 건수와 페이지 범위에 맞지 않습니다. 다음 페이지로 건너뛰지 말고 다시 조회해주세요.",
    );
  }

  const missingFields = new Set<string>();
  for (const row of items) {
    const bizesId = row.bizesId;
    if (
      bizesId === undefined ||
      bizesId === null ||
      String(bizesId).trim() === ""
    ) {
      missingFields.add("bizesId");
    }
  }
  const requestedFields: Array<[string, string]> = [];
  if (input.regionType && input.regionCode)
    requestedFields.push([input.regionType, input.regionCode]);
  if (input.industryType && input.industryCode)
    requestedFields.push([input.industryType, input.industryCode]);
  for (const [field, expected] of requestedFields) {
    for (const row of items) {
      const observed = row[field];
      if (
        observed === undefined ||
        observed === null ||
        String(observed).trim() === ""
      ) {
        missingFields.add(field);
      } else if (String(observed) !== expected) {
        throw new BusinessesApiError(
          "RESPONSE_MISMATCH",
          `공공데이터 응답의 ${field} 값이 요청과 다릅니다.`,
        );
      }
    }
  }

  const ids = new Set<string>();
  for (const row of items) {
    const id = row.bizesId;
    const idValue = id === undefined || id === null ? "" : String(id).trim();
    if (idValue.length > 0) {
      if (ids.has(idValue)) {
        throw new BusinessesApiError(
          "DUPLICATE_BIZES_ID",
          "공공데이터 응답에 중복 업소 식별자가 있습니다.",
        );
      }
      ids.add(idValue);
    }
  }

  const stdrYm =
    header.stdrYm === undefined ||
    header.stdrYm === null ||
    String(header.stdrYm).length === 0
      ? undefined
      : String(header.stdrYm);
  const returnedCount = items.length;
  const hasMore = input.page * input.pageSize < providerTotal;
  return {
    items,
    page: input.page,
    pageSize: input.pageSize,
    providerPageNo,
    providerNumOfRows,
    providerTotal,
    returnedCount,
    hasMore,
    nextPage: hasMore ? input.page + 1 : null,
    ...(stdrYm === undefined ? {} : { stdrYm }),
    validationLevel:
      missingFields.size === 0 &&
      (items.length > 0 || requestedFields.length === 0)
        ? "verified"
        : "unverified",
    missingFields: [...missingFields],
  };
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = response.headers?.get?.("content-length");
  if (
    declared !== null &&
    declared !== undefined &&
    /^\d+$/.test(declared) &&
    Number(declared) > maxBytes
  ) {
    throw new BusinessesApiError(
      "RESPONSE_TOO_LARGE",
      "공공데이터 응답이 4MiB 한도를 초과했습니다. 페이지 크기를 줄여 다시 시도해주세요.",
    );
  }

  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        const chunk =
          next.value instanceof Uint8Array
            ? next.value
            : new Uint8Array(next.value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // Keep the explicit size error even if a test/provider stream rejects cancellation.
          }
          throw new BusinessesApiError(
            "RESPONSE_TOO_LARGE",
            "공공데이터 응답이 4MiB 한도를 초과했습니다. 페이지 크기를 줄여 다시 시도해주세요.",
          );
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock?.();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  if (typeof response.arrayBuffer === "function") {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new BusinessesApiError(
        "RESPONSE_TOO_LARGE",
        "공공데이터 응답이 4MiB 한도를 초과했습니다. 페이지 크기를 줄여 다시 시도해주세요.",
      );
    }
    return bytes;
  }
  if (typeof response.text === "function") {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > maxBytes) {
      throw new BusinessesApiError(
        "RESPONSE_TOO_LARGE",
        "공공데이터 응답이 4MiB 한도를 초과했습니다. 페이지 크기를 줄여 다시 시도해주세요.",
      );
    }
    return bytes;
  }
  if (typeof response.json === "function") {
    const data = (await response.json()) as unknown;
    const serialized = JSON.stringify(data);
    if (serialized === undefined) {
      throw new BusinessesApiError(
        "INVALID_RESPONSE",
        "공공데이터 응답 본문을 읽을 수 없습니다.",
      );
    }
    const bytes = new TextEncoder().encode(serialized);
    if (bytes.byteLength > maxBytes) {
      throw new BusinessesApiError(
        "RESPONSE_TOO_LARGE",
        "공공데이터 응답이 4MiB 한도를 초과했습니다. 페이지 크기를 줄여 다시 시도해주세요.",
      );
    }
    return bytes;
  }
  throw new BusinessesApiError(
    "INVALID_RESPONSE",
    "공공데이터 응답 본문을 읽을 수 없습니다.",
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export class BusinessesClient {
  private readonly fetchImpl?: FetchLike;
  private readonly timeoutMs: number;
  private readonly cache: NodeCache;
  private readonly pending = new Map<string, Promise<BusinessPage>>();

  constructor(options: BusinessesClientOptions = {}) {
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs ?? BUSINESS_REQUEST_TIMEOUT_MS;
    this.cache =
      options.cache ??
      new NodeCache({
        stdTTL: 15,
        checkperiod: 5,
        maxKeys: 100,
        useClones: true,
      });
  }

  async searchBusinesses(input: BusinessSearchInput): Promise<BusinessPage> {
    return this.search(input);
  }
  async search(input: BusinessSearchInput): Promise<BusinessPage> {
    const normalized = validateInput(input);
    const configuredKey = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
    if (!configuredKey) {
      throw new BusinessesApiError(
        "INVALID_API_KEY",
        "상권정보 서비스의 DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다. 서버 운영자에게 문의해주세요.",
      );
    }
    const serviceKey = decodeServiceKey(configuredKey);
    if (!serviceKey) {
      throw new BusinessesApiError(
        "INVALID_API_KEY",
        "상권정보 서비스의 DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다. 서버 운영자에게 문의해주세요.",
      );
    }
    const cacheKey = queryFingerprint(normalized, serviceKey);
    const cached = this.cache.get<BusinessPage>(cacheKey);
    if (cached !== undefined) return cached;
    const pendingRequest = this.pending.get(cacheKey);
    if (pendingRequest) return pendingRequest;

    const request = this.fetchPage(normalized, serviceKey)
      .then((result) => {
        this.cache.set(cacheKey, result, 15);
        return result;
      })
      .finally(() => {
        this.pending.delete(cacheKey);
      });
    this.pending.set(cacheKey, request);
    return request;
  }

  private async fetchPage(
    input: Required<Pick<BusinessSearchInput, "page" | "pageSize">> &
      BusinessSearchInput,
    serviceKey: string,
  ): Promise<BusinessPage> {
    const { endpoint, params } = requestParams(input, serviceKey);
    const url = `${endpoint}?${params.toString()}`;
    const controller = new AbortController();
    const startedAt = Date.now();
    const abortTimer = setTimeout(() => controller.abort(), this.timeoutMs);
    let timedOut = false;
    try {
      const fetchCall = (this.fetchImpl ?? globalThis.fetch)(url, {
        signal: controller.signal,
      });
      const response = await this.withDeadline(
        fetchCall,
        controller,
        startedAt,
        () => {
          timedOut = true;
        },
      );
      if (
        (typeof response.ok === "boolean" && !response.ok) ||
        (typeof response.ok !== "boolean" &&
          typeof response.status === "number" &&
          (response.status < 200 || response.status >= 300))
      ) {
        throw new BusinessesApiError(
          "PROVIDER_ERROR",
          "공공데이터 제공기관이 요청을 처리하지 못했습니다.",
        );
      }
      const bytes = await this.withDeadline(
        readResponseBytes(response, BUSINESS_MAX_RESPONSE_BYTES),
        controller,
        startedAt,
        () => {
          timedOut = true;
        },
      );
      let parsed: unknown;
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (text.trimStart().startsWith("<")) {
          throw new BusinessesApiError(
            "PROVIDER_ERROR",
            "공공데이터 제공기관이 JSON이 아닌 오류를 반환했습니다.",
          );
        }
        parsed = JSON.parse(text) as unknown;
      } catch (error) {
        if (error instanceof BusinessesApiError) throw error;
        throw new BusinessesApiError(
          "INVALID_RESPONSE",
          "공공데이터 응답 JSON을 해석할 수 없습니다.",
        );
      }
      if (typeof parsed === "string") {
        throw new BusinessesApiError(
          "PROVIDER_ERROR",
          "공공데이터 제공기관이 오류를 반환했습니다.",
        );
      }
      const page = parseEnvelope(parsed, input);
      return { ...page, observedAt: new Date().toISOString() };
    } catch (error) {
      if (error instanceof BusinessesApiError) throw error;
      if (timedOut || isTimeoutError(error)) {
        throw new BusinessesApiError(
          "TIMEOUT",
          "공공데이터 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.",
        );
      }
      // Never propagate fetch's URL-bearing error; it may contain the operator key.
      throw new BusinessesApiError(
        "NETWORK_ERROR",
        "공공데이터 네트워크 요청에 실패했습니다.",
      );
    } finally {
      clearTimeout(abortTimer);
    }
  }

  private async withDeadline<T>(
    operation: Promise<T>,
    controller: AbortController,
    startedAt: number,
    markTimeout: () => void,
  ): Promise<T> {
    const remaining = this.timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      markTimeout();
      controller.abort();
      throw new BusinessesApiError(
        "TIMEOUT",
        "공공데이터 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.",
      );
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        markTimeout();
        controller.abort();
        reject(
          new BusinessesApiError(
            "TIMEOUT",
            "공공데이터 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.",
          ),
        );
      }, remaining);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

export async function lookupCurrentSignguAffiliation(
  signguCode: string,
  client: SignguAffiliationClient = getBusinessesClient(),
): Promise<SignguAffiliationResult> {
  const page = await client.search({
    regionType: "signguCd",
    regionCode: signguCode,
    page: 1,
    pageSize: 1,
  });
  if (!Array.isArray(page.items) || page.items.length === 0) {
    return !Array.isArray(page.items)
      ? { status: "incomplete_row", missingFields: ["items"] }
      : { status: "no_rows" };
  }
  if (page.items.length !== 1) {
    return {
      status: "incomplete_row",
      missingFields: ["single_row"],
    };
  }

  const row = page.items[0];
  if (!isRecord(row)) {
    return { status: "incomplete_row", missingFields: ["row"] };
  }
  const requiredFields = [
    "ctprvnCd",
    "ctprvnNm",
    "signguCd",
    "signguNm",
  ] as const;
  const missingFields = requiredFields.filter((field) => {
    const value = row[field];
    return value === undefined || value === null || String(value).trim() === "";
  });
  const observedAt =
    typeof page.observedAt === "string" ? page.observedAt.trim() : "";
  if (!observedAt || missingFields.length > 0) {
    return {
      status: "incomplete_row",
      missingFields: [...missingFields, ...(!observedAt ? ["observedAt"] : [])],
    };
  }

  const result: SignguAffiliationFound = {
    status: "found",
    ctprvnCd: String(row.ctprvnCd).trim(),
    ctprvnNm: String(row.ctprvnNm).trim(),
    signguCd: String(row.signguCd).trim(),
    signguNm: String(row.signguNm).trim(),
    observedAt,
  };
  const stdrYm =
    page.stdrYm === undefined || page.stdrYm === null
      ? ""
      : String(page.stdrYm).trim();
  if (stdrYm) result.stdrYm = stdrYm;
  return result;
}
let clientInstance: BusinessesClient | null = null;

export function getBusinessesClient(): BusinessesClient {
  if (!clientInstance) clientInstance = new BusinessesClient();
  return clientInstance;
}

/** Only useful to isolated fixture tests; it does not accept credentials. */
export function resetBusinessesClientForTests(): void {
  clientInstance = null;
}
