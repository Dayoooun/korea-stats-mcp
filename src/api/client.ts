/**
 * KOSIS OpenAPI HTTP 클라이언트
 */

import { config } from '../config/index.js';
import type {
  StatisticsListItem,
  StatisticsDataItem,
  SearchResultItem,
  StatisticsListParams,
  StatisticsDataParams,
  SearchStatisticsParams,
} from './types.js';

class KosisApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'KosisApiError';
  }
}

/**
 * KOSIS API 클라이언트
 */
export class KosisClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.baseUrl = config.kosis.baseUrl;
    this.apiKey = apiKey || config.kosis.apiKey;
  }

  /**
   * API 요청 실행
   */
  private async request<T>(
    endpoint: string,
    params: Record<string, string | number | undefined>
  ): Promise<T[]> {
    // undefined 값 제거 및 문자열 변환
    const cleanParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        cleanParams[key] = String(value);
      }
    }
    cleanParams.apiKey = this.apiKey;
    cleanParams.format = 'json';
    cleanParams.jsonVD = 'Y';

    const url = new URL(this.baseUrl + endpoint);
    url.search = new URLSearchParams(cleanParams).toString();

    // 8초 타임아웃 (Vercel maxDuration 15초 내에 여유 확보)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new KosisApiError(
          'HTTP_ERROR',
          `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const data = await response.json() as Record<string, unknown>;

      // 에러 응답 처리
      if (data.err || data.errMsg) {
        throw new KosisApiError(
          (data.err as string) || 'API_ERROR',
          (data.errMsg as string) || '알 수 없는 API 오류'
        );
      }

      // 결과가 배열이 아닌 경우 빈 배열 반환
      if (!Array.isArray(data)) {
        if (data.result && Array.isArray(data.result)) {
          return data.result as T[];
        }
        return [];
      }

      return data as T[];
    } catch (error) {
      if (error instanceof KosisApiError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new KosisApiError(
          'TIMEOUT',
          'KOSIS API 응답 시간 초과 (8초). 잠시 후 다시 시도해주세요.'
        );
      }
      throw new KosisApiError(
        'NETWORK_ERROR',
        '네트워크 오류가 발생했습니다.',
        error as Error
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 통계목록 조회
   */
  async getStatisticsList(
    vwCd: string,
    parentListId: string = ''
  ): Promise<StatisticsListItem[]> {
    return this.request<StatisticsListItem>(
      config.kosis.endpoints.statisticsList,
      {
        method: 'getList',
        vwCd,
        parentListId,
      }
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
    itmId?: string;
    prdSe: string;
    startPrdDe?: string;
    endPrdDe?: string;
    newEstPrdCnt?: number;
  }): Promise<StatisticsDataItem[]> {
    return this.request<StatisticsDataItem>(
      config.kosis.endpoints.parameterData,
      {
        method: 'getList',
        ...params,
      }
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
      sort?: 'RANK' | 'DATE';
      startCount?: number;
      resultCount?: number;
    }
  ): Promise<SearchResultItem[]> {
    return this.request<SearchResultItem>(
      config.kosis.endpoints.searchStatistics,
      {
        method: 'getList',
        searchNm,
        ...options,
      }
    );
  }

  /**
   * 통계설명 조회
   */
  async getStatisticsExplain(
    orgId: string,
    tblId: string
  ): Promise<Record<string, string>[]> {
    return this.request(config.kosis.endpoints.statsExplain, {
      method: 'getMeta',
      type: 'TBL',
      orgId,
      tblId,
    });
  }

  /**
   * 통계표 메타데이터 조회 (분류/항목 정보)
   * @param orgId 기관 ID
   * @param tblId 통계표 ID
   * @param metaType 메타데이터 유형: TBL(통계표명), ORG(기관명), PRD(수록정보), ITM(분류/항목), UNIT(단위), SOURCE(출처)
   */
  async getTableMeta(
    orgId: string,
    tblId: string,
    metaType: 'TBL' | 'ORG' | 'PRD' | 'ITM' | 'UNIT' | 'SOURCE' = 'ITM'
  ): Promise<Record<string, string>[]> {
    return this.request(config.kosis.endpoints.statisticsData, {
      method: 'getMeta',
      type: metaType,
      orgId,
      tblId,
    });
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
