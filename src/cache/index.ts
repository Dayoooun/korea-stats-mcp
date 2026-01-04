/**
 * 캐시 매니저
 * 메모리 캐시를 사용하여 KOSIS API 호출을 최적화
 */

import NodeCache from 'node-cache';
import { config } from '../config/index.js';

// 캐시 TTL 설정 (초 단위)
const TTL = {
  STATISTICS_LIST: 24 * 60 * 60,      // 목록: 24시간
  STATISTICS_DATA: 6 * 60 * 60,        // 데이터: 6시간
  SEARCH_RESULTS: 1 * 60 * 60,         // 검색: 1시간
  EXPLANATION: 7 * 24 * 60 * 60,       // 설명: 7일
  TABLE_META: 24 * 60 * 60,            // 테이블 메타: 24시간
} as const;

class CacheManager {
  private cache: NodeCache;

  constructor() {
    this.cache = new NodeCache({
      stdTTL: config.cache.ttlHours * 60 * 60,
      checkperiod: 600, // 10분마다 만료 체크
      maxKeys: config.cache.maxKeys,
      useClones: false, // 성능을 위해 복제 비활성화
    });
  }

  /**
   * 캐시 키 생성
   */
  private generateKey(prefix: string, params: Record<string, unknown>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .map((k) => `${k}=${JSON.stringify(params[k])}`)
      .join('&');
    return `${prefix}:${sortedParams}`;
  }

  /**
   * 캐시에서 데이터 조회 또는 fetcher 실행
   */
  async getOrFetch<T>(
    prefix: string,
    params: Record<string, unknown>,
    fetcher: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const key = this.generateKey(prefix, params);

    // 캐시에서 조회
    const cached = this.cache.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    // API 호출 및 캐시 저장
    const data = await fetcher();
    this.cache.set(key, data, ttl ?? config.cache.ttlHours * 60 * 60);

    return data;
  }

  /**
   * 통계 목록 캐시
   */
  async getStatisticsList<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>
  ): Promise<T> {
    return this.getOrFetch('list', params, fetcher, TTL.STATISTICS_LIST);
  }

  /**
   * 통계 데이터 캐시
   */
  async getStatisticsData<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>
  ): Promise<T> {
    return this.getOrFetch('data', params, fetcher, TTL.STATISTICS_DATA);
  }

  /**
   * 검색 결과 캐시
   */
  async getSearchResults<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>
  ): Promise<T> {
    return this.getOrFetch('search', params, fetcher, TTL.SEARCH_RESULTS);
  }

  /**
   * 통계 설명 캐시
   */
  async getExplanation<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>
  ): Promise<T> {
    return this.getOrFetch('explain', params, fetcher, TTL.EXPLANATION);
  }

  /**
   * 테이블 메타데이터 캐시
   */
  async getTableMeta<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>
  ): Promise<T> {
    return this.getOrFetch('meta', params, fetcher, TTL.TABLE_META);
  }

  /**
   * 캐시 통계
   */
  getStats() {
    return this.cache.getStats();
  }

  /**
   * 캐시 초기화
   */
  flush() {
    this.cache.flushAll();
  }
}

// 싱글톤 인스턴스
let cacheInstance: CacheManager | null = null;

export function getCacheManager(): CacheManager {
  if (!cacheInstance) {
    cacheInstance = new CacheManager();
  }
  return cacheInstance;
}

export { CacheManager, TTL };
