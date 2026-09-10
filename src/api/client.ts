/**
 * KOSIS OpenAPI HTTP 클라이언트
 */

import { config } from "../config/index.js";
import {
  elapsedTimeMsSince,
  emitOperationalEvent,
  providerOperationForEndpoint,
  statusCategoryForCode,
  type ProviderOutcome,
} from "../utils/operationalEvents.js";
import type {
  StatisticsListItem,
  StatisticsDataItem,
  SearchResultItem,
  StatisticsExplainItem,
} from "./types.js";

const KOSIS_MAX_RESPONSE_BYTES = 4_194_304 as const;

class KosisApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "KosisApiError";
  }
}

function providerOutcomeForError(
  error: unknown,
  statusCode?: number,
): ProviderOutcome {
  if (error instanceof KosisApiError) {
    if (error.code === "HTTP_ERROR") {
      if (statusCode === 429) return "rate_limited";
      if (statusCode === 401 || statusCode === 403) return "auth_rejected";
    }
    switch (error.code) {
      case "INVALID_API_KEY":
        return "auth_missing";
      case "TIMEOUT":
        return "timeout";
      case "NETWORK_ERROR":
        return "network";
      case "INVALID_RESPONSE":
        return "invalid";
      case "RESPONSE_TOO_LARGE":
      case "METADATA_TOO_LARGE":
        return "too_large";
      default:
        return "provider_error";
    }
  }
  if (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return "timeout";
  }
  if (error instanceof SyntaxError) return "invalid";
  return "network";
}

function emitProviderOutcome(
  endpoint: string,
  metadata: boolean,
  startedAt: number,
  outcome: ProviderOutcome,
  statusCode: number | undefined,
  responseBytes: number | undefined,
): void {
  const measuredResponseBytes =
    responseBytes !== undefined && responseBytes <= KOSIS_MAX_RESPONSE_BYTES
      ? responseBytes
      : undefined;
  const attempts = outcome === "auth_missing" ? 0 : 1;
  emitOperationalEvent({
    kind: "provider_outcome",
    provider: "kosis",
    operation: providerOperationForEndpoint(endpoint, metadata),
    elapsedTimeMs: elapsedTimeMsSince(startedAt),
    ...(measuredResponseBytes === undefined
      ? {}
      : { responseBytes: measuredResponseBytes }),
    statusCategory: statusCategoryForCode(statusCode),
    attempts,
    retryDisposition: "not_attempted",
    outcome,
    sizeLimitBytes: KOSIS_MAX_RESPONSE_BYTES,
  });
}

/**
 * KOSIS API 클라이언트
 */
export type IndicatorSearchRoute = {
  endpoint: string;
  serviceDetail: "indIdList" | "indList" | "prList";
  queryKey: "jipyoId" | "jipyoNm" | "prdSe";
  queryValue: string;
};

const INDICATOR_PERIOD_CODES: Record<string, string> = {
  Y: "Y",
  Y년: "Y",
  년: "Y",
  M: "M",
  M월: "M",
  월: "M",
  Q: "Q",
  Q분기: "Q",
  분기: "Q",
};

export function normalizeIndicatorPeriod(value: string): string | undefined {
  return INDICATOR_PERIOD_CODES[value.trim()];
}

export function resolveIndicatorSearchRoute(params: {
  jipyoId?: string;
  jipyoNm?: string;
  prdSe?: string;
}): IndicatorSearchRoute {
  if (params.jipyoId !== undefined) {
    return {
      endpoint: "/indIdListSearchRequest.do",
      serviceDetail: "indIdList",
      queryKey: "jipyoId",
      queryValue: params.jipyoId,
    };
  }
  if (params.jipyoNm !== undefined) {
    return {
      endpoint: "/indListSearchRequest.do",
      serviceDetail: "indList",
      queryKey: "jipyoNm",
      queryValue: params.jipyoNm,
    };
  }
  if (params.prdSe !== undefined) {
    return {
      endpoint: "/prListSearchRequest.do",
      serviceDetail: "prList",
      queryKey: "prdSe",
      queryValue: normalizeIndicatorPeriod(params.prdSe) ?? params.prdSe,
    };
  }
  throw new KosisApiError(
    "INVALID_INPUT",
    "지표 검색에는 jipyoId, jipyoNm 또는 prdSe가 필요합니다.",
  );
}
export class KosisClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.baseUrl = config.kosis.baseUrl;
    this.apiKey = (apiKey ?? config.kosis.apiKey).trim();
  }

  /**
   * API 요청 실행
   */
  private async request<T>(
    endpoint: string,
    params: Record<string, string | number | undefined>,
    options: {
      maxResponseBytes?: number;
    } = {},
  ): Promise<T[]> {
    const startedAt = Date.now();
    if (!this.apiKey) {
      emitProviderOutcome(
        endpoint,
        false,
        startedAt,
        "auth_missing",
        undefined,
        undefined,
      );
      throw new KosisApiError(
        "INVALID_API_KEY",
        "통계 서비스의 KOSIS_API_KEY가 설정되지 않았습니다. 서버 운영자에게 문의해주세요.",
      );
    }
    let statusCode: number | undefined;
    let responseBytes: number | undefined;
    let outcome: ProviderOutcome = "provider_error";
    // undefined 값 제거 및 문자열 변환
    const cleanParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        cleanParams[key] = String(value);
      }
    }
    cleanParams.apiKey = this.apiKey;
    cleanParams.format = "json";
    cleanParams.jsonVD = "Y";

    const url = new URL(this.baseUrl + endpoint);
    url.search = new URLSearchParams(cleanParams).toString();

    // 8초 타임아웃 (Vercel maxDuration 15초 내에 여유 확보)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
      });
      statusCode = response.status;

      if (!response.ok) {
        throw new KosisApiError(
          "HTTP_ERROR",
          `KOSIS HTTP 오류 (${response.status})`,
        );
      }

      const maxResponseBytes =
        options.maxResponseBytes ?? KOSIS_MAX_RESPONSE_BYTES;

      const contentLength =
        typeof response.headers?.get === "function"
          ? response.headers.get("content-length")
          : ((
              response.headers as unknown as
                Record<string, string | undefined> | undefined
            )?.["content-length"] ??
            (
              response.headers as unknown as
                Record<string, string | undefined> | undefined
            )?.["Content-Length"] ??
            null);
      if (contentLength !== null) {
        const declaredBytes = Number(contentLength);
        if (
          Number.isFinite(declaredBytes) &&
          declaredBytes > maxResponseBytes
        ) {
          await response.body?.cancel().catch(() => undefined);
          throw new KosisApiError(
            "RESPONSE_TOO_LARGE",
            "KOSIS 응답이 허용된 크기를 초과했습니다. 조회 범위를 좁혀 다시 시도해주세요.",
          );
        }
      }

      let text: string;
      if (response.body && typeof response.body.getReader === "function") {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        try {
          let part = await reader.read();
          while (!part.done) {
            const chunk = part.value;
            totalBytes += chunk.byteLength;
            responseBytes = totalBytes;
            if (totalBytes > maxResponseBytes) {
              await reader.cancel().catch(() => undefined);
              throw new KosisApiError(
                "RESPONSE_TOO_LARGE",
                "KOSIS 응답이 허용된 크기를 초과했습니다. 조회 범위를 좁혀 다시 시도해주세요.",
              );
            }
            chunks.push(chunk);
            part = await reader.read();
          }
        } finally {
          reader.releaseLock();
        }
        const bytes = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } else {
        // Small test doubles may expose only json(). Enforce the same
        // budget on their serialized representation.
        const fallback = (await response.json()) as unknown;
        const serializedFallback = JSON.stringify(fallback);
        if (
          serializedFallback === undefined ||
          new TextEncoder().encode(serializedFallback).byteLength >
            maxResponseBytes
        ) {
          throw new KosisApiError(
            "RESPONSE_TOO_LARGE",
            "KOSIS 응답이 허용된 크기를 초과했습니다. 조회 범위를 좁혀 다시 시도해주세요.",
          );
        }
        text = serializedFallback;
      }
      const data: unknown = JSON.parse(text);

      // 에러 응답 처리
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const envelope = data as Record<string, unknown>;
        if (envelope.err || envelope.errMsg) {
          const code = /^\d{1,4}$/.test(String(envelope.err))
            ? String(envelope.err)
            : "API_ERROR";
          throw new KosisApiError(
            code,
            `KOSIS API 오류 (${code}). 조회 조건 또는 서버의 API 키 설정을 확인해주세요.`,
          );
        }

        // Unknown envelopes are provider failures, not successful empty statistics.
        if (Array.isArray(envelope.result)) {
          outcome = "success";
          return envelope.result as T[];
        }
      }

      if (!Array.isArray(data)) {
        throw new KosisApiError(
          "INVALID_RESPONSE",
          "KOSIS 응답 형식이 올바르지 않습니다.",
        );
      }

      outcome = "success";
      return data as T[];
    } catch (error) {
      outcome = providerOutcomeForError(error, statusCode);
      if (error instanceof KosisApiError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new KosisApiError(
          "TIMEOUT",
          "KOSIS API 응답 시간 초과 (8초). 잠시 후 다시 시도해주세요.",
        );
      }
      if (error instanceof SyntaxError) {
        throw new KosisApiError(
          "INVALID_RESPONSE",
          "KOSIS 응답 형식이 올바르지 않습니다.",
        );
      }
      throw new KosisApiError("NETWORK_ERROR", "네트워크 오류가 발생했습니다.");
    } finally {
      clearTimeout(timeoutId);
      emitProviderOutcome(
        endpoint,
        false,
        startedAt,
        outcome,
        statusCode,
        responseBytes,
      );
    }
  }
  /**
   * Metadata requests have their own bounded reader. Core statistics data also
   * uses request() with a finite body budget; metadata keeps its distinct error code.
   */
  private async requestMetadata<T>(
    endpoint: string,
    params: Record<string, string | number | undefined>,
  ): Promise<T[]> {
    const startedAt = Date.now();
    if (!this.apiKey) {
      emitProviderOutcome(
        endpoint,
        true,
        startedAt,
        "auth_missing",
        undefined,
        undefined,
      );
      throw new KosisApiError(
        "INVALID_API_KEY",
        "통계 서비스의 KOSIS_API_KEY가 설정되지 않았습니다. 서버 운영자에게 문의해주세요.",
      );
    }
    let statusCode: number | undefined;
    let responseBytes: number | undefined;
    let outcome: ProviderOutcome = "provider_error";

    const cleanParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) cleanParams[key] = String(value);
    }
    cleanParams.apiKey = this.apiKey;
    cleanParams.format = "json";
    cleanParams.jsonVD = "Y";

    const url = new URL(this.baseUrl + endpoint);
    url.search = new URLSearchParams(cleanParams).toString();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    const maxBytes = KOSIS_MAX_RESPONSE_BYTES;

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
      });
      statusCode = response.status;
      if (!response.ok) {
        throw new KosisApiError(
          "HTTP_ERROR",
          `KOSIS HTTP 오류 (${response.status})`,
        );
      }

      const contentLength =
        typeof response.headers?.get === "function"
          ? response.headers.get("content-length")
          : ((
              response.headers as unknown as
                Record<string, string | undefined> | undefined
            )?.["content-length"] ??
            (
              response.headers as unknown as
                Record<string, string | undefined> | undefined
            )?.["Content-Length"] ??
            null);
      if (contentLength !== null) {
        const declaredBytes = Number(contentLength);
        if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
          throw new KosisApiError(
            "METADATA_TOO_LARGE",
            "KOSIS 메타데이터 응답이 4MiB 제한을 초과했습니다. 필터를 좁혀 다시 시도해주세요.",
          );
        }
      }

      let text: string;
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        try {
          let part = await reader.read();
          while (!part.done) {
            const chunk = part.value;
            totalBytes += chunk.byteLength;
            responseBytes = totalBytes;
            if (totalBytes > maxBytes) {
              await reader.cancel();
              throw new KosisApiError(
                "METADATA_TOO_LARGE",
                "KOSIS 메타데이터 응답이 4MiB 제한을 초과했습니다. 필터를 좁혀 다시 시도해주세요.",
              );
            }
            chunks.push(chunk);
            part = await reader.read();
          }
        } finally {
          reader.releaseLock();
        }
        const bytes = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } else {
        // A body-less response only occurs in small test doubles. Keep the same
        // budget check rather than allowing an oversized fallback value through.
        const fallback = (await response.json()) as unknown;
        text = JSON.stringify(fallback);
        if (new TextEncoder().encode(text).byteLength > maxBytes) {
          throw new KosisApiError(
            "METADATA_TOO_LARGE",
            "KOSIS 메타데이터 응답이 4MiB 제한을 초과했습니다. 필터를 좁혀 다시 시도해주세요.",
          );
        }
      }

      const data = JSON.parse(text) as unknown;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        const envelope = data as Record<string, unknown>;
        if (envelope.err || envelope.errMsg) {
          const code = /^\d{1,4}$/.test(String(envelope.err))
            ? String(envelope.err)
            : "API_ERROR";
          throw new KosisApiError(
            code,
            `KOSIS API 오류 (${code}). 조회 조건 또는 서버의 API 키 설정을 확인해주세요.`,
          );
        }
        if (Array.isArray(envelope.result)) {
          outcome = "success";
          return envelope.result as T[];
        }
      }
      if (Array.isArray(data)) {
        outcome = "success";
        return data as T[];
      }
      throw new KosisApiError(
        "INVALID_RESPONSE",
        "KOSIS 메타데이터 응답 형식이 올바르지 않습니다.",
      );
    } catch (error) {
      outcome = providerOutcomeForError(error, statusCode);
      if (error instanceof KosisApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new KosisApiError(
          "TIMEOUT",
          "KOSIS API 응답 시간 초과 (8초). 잠시 후 다시 시도해주세요.",
        );
      }
      if (error instanceof SyntaxError) {
        throw new KosisApiError(
          "INVALID_RESPONSE",
          "KOSIS 메타데이터 응답 형식이 올바르지 않습니다.",
        );
      }
      throw new KosisApiError("NETWORK_ERROR", "네트워크 오류가 발생했습니다.");
    } finally {
      clearTimeout(timeoutId);
      emitProviderOutcome(
        endpoint,
        true,
        startedAt,
        outcome,
        statusCode,
        responseBytes,
      );
    }
  }

  /**
   * 통계목록 조회
   */
  async getStatisticsList(
    vwCd: string,
    parentListId: string = "",
  ): Promise<StatisticsListItem[]> {
    return this.request<StatisticsListItem>(
      config.kosis.endpoints.statisticsList,
      {
        method: "getList",
        vwCd,
        parentListId,
      },
    );
  }

  /**
   * 통계자료 조회 (통계표 선택 방식)
   */
  async getStatisticsData(params: {
    orgId: string;
    tblId: string;
    objL1?: string;
    objL2?: string;
    objL3?: string;
    objL4?: string;
    objL5?: string;
    objL6?: string;
    objL7?: string;
    objL8?: string;
    itmId?: string;
    prdSe: string;
    startPrdDe?: string;
    endPrdDe?: string;
    newEstPrdCnt?: number;
  }): Promise<StatisticsDataItem[]> {
    return this.request<StatisticsDataItem>(
      config.kosis.endpoints.parameterData,
      {
        method: "getList",
        ...params,
      },
      { maxResponseBytes: KOSIS_MAX_RESPONSE_BYTES },
    );
  }

  /**
   * 통합검색
   * API 문서: https://kosis.kr/openapi/devGuide/devGuide_0701List.do
   */
  async searchStatistics(
    searchNm: string,
    options?: {
      orgId?: string;
      sort?: "RANK" | "DATE";
      startCount?: number;
      resultCount?: number;
    },
  ): Promise<SearchResultItem[]> {
    return this.request<SearchResultItem>(
      config.kosis.endpoints.searchStatistics,
      {
        method: "getList",
        searchNm,
        ...options,
      },
    );
  }

  /**
   * 통계설명 조회
   */
  async getStatisticsExplain(
    statId: string,
    metaItm: string = "ALL",
  ): Promise<StatisticsExplainItem[]> {
    return this.request<StatisticsExplainItem>(
      config.kosis.endpoints.statsExplain,
      {
        method: "getList",
        statId,
        metaItm: metaItm.replace(/\+/g, " "),
        jsonMVD: "Y",
      },
    );
  }

  /**
   * 통계표 메타데이터 조회 (분류/항목 정보)
   * @param orgId 기관 ID
   * @param tblId 통계표 ID
   * @param metaType 메타데이터 유형: TBL(통계표명), ORG(기관명), PRD(수록정보), ITM(분류/항목), UNIT(단위), SOURCE(출처), CMMT(통계표/항목 주석)
   */
  async getTableMeta(
    orgId: string,
    tblId: string,
    metaType:
      "TBL" | "ORG" | "PRD" | "ITM" | "UNIT" | "SOURCE" | "CMMT" = "ITM",
    options?: {
      objId?: string;
      itmId?: string;
    },
  ): Promise<Record<string, string>[]> {
    return this.requestMetadata(config.kosis.endpoints.statisticsData, {
      method: "getMeta",
      type: metaType,
      orgId,
      tblId,
      objId: options?.objId,
      itmId: options?.itmId,
    });
  }
  /**
   * Official KOSIS indicator list, value, and definition endpoints.
   *
   * These methods use the standard jsonVD=Y response projection.
   */
  async searchIndicators(params: {
    jipyoNm?: string;
    jipyoId?: string;
    prdSe?: string;
    pageNo?: number;
    numOfRows?: number;
  }): Promise<Record<string, unknown>[]> {
    const route = resolveIndicatorSearchRoute(params);
    return this.request<Record<string, unknown>>(
      route.endpoint,
      {
        method: "getList",
        service: "4",
        serviceDetail: route.serviceDetail,
        [route.queryKey]: route.queryValue,
        pageNo: params.pageNo,
        numOfRows: params.numOfRows,
      },
      { maxResponseBytes: KOSIS_MAX_RESPONSE_BYTES },
    );
  }

  async getIndicatorValues(params: {
    jipyoId: string;
    strtPrdDe?: string;
    endPrdDe?: string;
    rn?: string;
    srvRn?: number;
    pageNo?: number;
    numOfRows?: number;
  }): Promise<Record<string, unknown>[]> {
    return this.request<Record<string, unknown>>(
      "/indIdDetailSearchRequest.do",
      {
        method: "getList",
        service: "4",
        serviceDetail: "indIdDetail",
        ...params,
      },
      { maxResponseBytes: KOSIS_MAX_RESPONSE_BYTES },
    );
  }

  async getIndicatorDefinition(params: {
    jipyoId: string;
    pageNo?: number;
    numOfRows?: number;
  }): Promise<Record<string, unknown>[]> {
    return this.request<Record<string, unknown>>(
      "/pkNumberService.do",
      {
        method: "getList",
        service: "1",
        serviceDetail: "pkAll",
        ...params,
      },
      { maxResponseBytes: KOSIS_MAX_RESPONSE_BYTES },
    );
  }
}

// 싱글톤 인스턴스
let clientInstance: KosisClient | null = null;

export function getKosisClient(): KosisClient {
  if (!clientInstance) {
    clientInstance = new KosisClient();
  }
  return clientInstance;
}

export { KosisApiError };
