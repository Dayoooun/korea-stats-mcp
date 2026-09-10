/**
 * 캐시 매니저
 * 메모리 캐시를 사용하여 KOSIS API 호출을 최적화
 */

import NodeCache from "node-cache";
import { config } from "../config/index.js";
import {
  cacheScopeForPrefix,
  emitOperationalEvent,
  type CacheAdmissionRefusalReason,
  type CacheEvictionReason,
  type CacheScope,
} from "../utils/operationalEvents.js";

// 캐시 TTL 설정 (초 단위)
const TTL = {
  STATISTICS_LIST: 24 * 60 * 60, // 목록: 24시간
  STATISTICS_DATA: 6 * 60 * 60, // 데이터: 6시간
  SEARCH_RESULTS: 1 * 60 * 60, // 검색: 1시간
  EXPLANATION: 7 * 24 * 60 * 60, // 설명: 7일
  TABLE_META: 24 * 60 * 60, // 테이블 메타: 24시간
} as const;

const MAX_SERIALIZED_CACHE_BYTES = 32 * 1024 * 1024;

class CacheManager {
  private cache: NodeCache;
  private readonly entrySizes = new Map<string, number>();
  private readonly pendingEntrySizes = new Map<string, number>();
  private readonly pendingEntryAreas = new Map<string, CacheScope>();
  private readonly entryAreas = new Map<string, CacheScope>();
  private cachedBytes = 0;

  constructor() {
    this.cache = new NodeCache({
      stdTTL: config.cache.ttlHours * 60 * 60,
      checkperiod: 600, // 10분마다 만료 체크
      maxKeys: config.cache.maxKeys,
      useClones: false, // 성능을 위해 복제 비활성화
    });

    this.cache.on("set", (key: string | number) => {
      const normalizedKey = String(key);
      const bytes = this.pendingEntrySizes.get(normalizedKey);
      const area = this.pendingEntryAreas.get(normalizedKey);
      if (bytes === undefined || area === undefined) {
        return;
      }

      this.pendingEntrySizes.delete(normalizedKey);
      this.pendingEntryAreas.delete(normalizedKey);
      const previousBytes = this.entrySizes.get(normalizedKey);
      if (previousBytes !== undefined) {
        this.cachedBytes -= previousBytes;
      }
      this.entrySizes.set(normalizedKey, bytes);
      this.entryAreas.set(normalizedKey, area);
      this.cachedBytes += bytes;
    });
    this.cache.on("del", (key: string | number) => {
      this.removeEntry(String(key));
    });
    this.cache.on("expired", (key: string | number) => {
      const normalizedKey = String(key);
      const bytes = this.entrySizes.get(normalizedKey);
      const cache = this.entryAreas.get(normalizedKey) ?? "other";
      this.removeEntry(normalizedKey);
      emitOperationalEvent({
        kind: "cache_expiry",
        cache,
        ...(bytes === undefined ? {} : { approximateBytes: bytes }),
      });
    });
    this.cache.on("flush", () => {
      this.entrySizes.clear();
      this.entryAreas.clear();
      this.pendingEntrySizes.clear();
      this.pendingEntryAreas.clear();
      this.cachedBytes = 0;
    });
  }

  private removeEntry(key: string): void {
    const bytes = this.entrySizes.get(key);
    this.entryAreas.delete(key);
    if (bytes === undefined) {
      return;
    }

    this.entrySizes.delete(key);
    this.cachedBytes -= bytes;
  }

  private touchEntry(key: string): void {
    const bytes = this.entrySizes.get(key);
    if (bytes === undefined) {
      return;
    }

    this.entrySizes.delete(key);
    this.entrySizes.set(key, bytes);
  }

  private serializedEntryBytes(
    key: string,
    value: unknown,
  ): number | undefined {
    try {
      const serializedKey = JSON.stringify(key);
      const serializedValue = JSON.stringify(value);
      if (serializedKey === undefined || serializedValue === undefined) {
        return undefined;
      }

      return (
        Buffer.byteLength(serializedKey, "utf8") +
        Buffer.byteLength(serializedValue, "utf8")
      );
    } catch {
      // Values that cannot be serialized are returned but not cached.
      return undefined;
    }
  }

  private evictOldest(cache: CacheScope, reason: CacheEvictionReason): boolean {
    const oldestKey = this.entrySizes.keys().next().value as string | undefined;
    const key = oldestKey ?? this.cache.keys()[0];
    if (key === undefined) {
      return false;
    }

    const normalizedKey = String(key);
    const bytes = this.entrySizes.get(normalizedKey);
    const evictedCache = this.entryAreas.get(normalizedKey) ?? cache;
    const deleted = this.cache.del(key);
    if (deleted === 0) {
      this.removeEntry(normalizedKey);
    } else {
      emitOperationalEvent({
        cache: evictedCache,
        kind: "cache_eviction",
        reason,
        ...(bytes === undefined ? {} : { approximateBytes: bytes }),
      });
    }
    return true;
  }

  private ensureCapacity(
    key: string,
    bytes: number,
    cache: CacheScope,
  ): true | CacheAdmissionRefusalReason {
    if (bytes > MAX_SERIALIZED_CACHE_BYTES) {
      return "oversized";
    }

    const maxKeys = this.cache.options.maxKeys ?? -1;
    if (maxKeys === 0) {
      return "max_keys";
    }

    // node-cache checks maxKeys before recognizing replacement. Delete the
    // existing entry first so a full cache can still replace a key.
    if (this.cache.has(key)) {
      const previousBytes = this.entrySizes.get(key);
      this.cache.del(key);
      emitOperationalEvent({
        kind: "cache_eviction",
        cache,
        reason: "replacement",
        ...(previousBytes === undefined
          ? {}
          : { approximateBytes: previousBytes }),
      });
    }

    while (maxKeys > -1 && this.cache.getStats().keys >= maxKeys) {
      if (!this.evictOldest(cache, "max_keys")) {
        return "max_keys";
      }
    }

    while (this.cachedBytes + bytes > MAX_SERIALIZED_CACHE_BYTES) {
      if (!this.evictOldest(cache, "byte_budget")) {
        return "byte_budget";
      }
    }

    return true;
  }

  private cacheValue<T>(
    key: string,
    value: T,
    ttl: number,
    bytes: number,
    cache: CacheScope,
  ): void {
    const admission = this.ensureCapacity(key, bytes, cache);
    if (admission !== true) {
      emitOperationalEvent({
        kind: "cache_admission_refused",
        cache,
        reason: admission,
        approximateBytes: bytes,
      });
      return;
    }

    for (;;) {
      this.pendingEntrySizes.set(key, bytes);
      this.pendingEntryAreas.set(key, cache);
      try {
        this.cache.set(key, value, ttl);
        return;
      } catch (error) {
        this.pendingEntrySizes.delete(key);
        this.pendingEntryAreas.delete(key);
        if (!(error instanceof Error) || error.name !== "ECACHEFULL") {
          throw error;
        }

        // Keep capacity failures from escaping even if node-cache's internal
        // count changed between the preflight and set.
        if (!this.evictOldest(cache, "max_keys")) {
          emitOperationalEvent({
            kind: "cache_admission_refused",
            cache,
            reason: "max_keys",
            approximateBytes: bytes,
          });
          return;
        }
      }
    }
  }

  private pruneExpiredEntries(): void {
    for (const key of this.cache.keys()) {
      this.cache.has(key);
    }
  }

  /**
   * 캐시 키 생성
   */
  private generateKey(prefix: string, params: Record<string, unknown>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .map((k) => `${k}=${JSON.stringify(params[k])}`)
      .join("&");
    return `${prefix}:${sortedParams}`;
  }

  /**
   * 캐시에서 데이터 조회 또는 fetcher 실행
   */
  async getOrFetch<T>(
    prefix: string,
    params: Record<string, unknown>,
    fetcher: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    const cache = cacheScopeForPrefix(prefix);
    const key = this.generateKey(prefix, params);

    // 캐시에서 조회
    const cached = this.cache.get<T>(key);
    if (cached !== undefined) {
      this.touchEntry(key);
      const bytes = this.entrySizes.get(key);
      emitOperationalEvent({
        kind: "cache_hit",
        cache,
        ...(bytes === undefined ? {} : { approximateBytes: bytes }),
      });
      return cached;
    }

    // API 호출 및 캐시 저장
    emitOperationalEvent({ kind: "cache_miss", cache });
    const data = await fetcher();
    const bytes = this.serializedEntryBytes(key, data);
    if (bytes !== undefined) {
      this.cacheValue(
        key,
        data,
        ttl ?? config.cache.ttlHours * 60 * 60,
        bytes,
        cache,
      );
    } else {
      emitOperationalEvent({
        kind: "cache_admission_refused",
        cache,
        reason: "unserializable",
      });
    }

    return data;
  }

  /**
   * 통계 목록 캐시
   */
  async getStatisticsList<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    return this.getOrFetch("list", params, fetcher, TTL.STATISTICS_LIST);
  }

  /**
   * 통계 데이터 캐시
   */
  async getStatisticsData<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    return this.getOrFetch("data", params, fetcher, TTL.STATISTICS_DATA);
  }

  invalidateStatisticsData(params: Record<string, unknown>): void {
    this.cache.del(this.generateKey("data", params));
  }

  /**
   * 검색 결과 캐시
   */
  async getSearchResults<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    return this.getOrFetch("search", params, fetcher, TTL.SEARCH_RESULTS);
  }

  /**
   * 통계 설명 캐시
   */
  async getExplanation<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    return this.getOrFetch("explain", params, fetcher, TTL.EXPLANATION);
  }

  /**
   * 테이블 메타데이터 캐시
   */
  async getTableMeta<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    return this.getOrFetch("meta", params, fetcher, TTL.TABLE_META);
  }

  /**
   * 캐시 통계
   */
  getStats() {
    return this.cache.getStats();
  }

  /**
   * 캐시된 직렬화 바이트 수 (키 + 값, UTF-8)
   */
  getCachedBytes(): number {
    this.pruneExpiredEntries();
    return this.cachedBytes;
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
