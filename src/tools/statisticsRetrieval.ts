import {
  getStatisticsData,
  type GetStatisticsDataInput,
  type GetStatisticsDataResult,
} from "./getStatisticsData.js";
import type { SimplifiedDataItem } from "../api/types.js";
import { handleToolError } from "../utils/errorHandler.js";

type ValidationLevel = "verified" | "partial" | "unverified";

/** Fixed safety bounds for analysis traversals. These are deliberately not configurable. */
export const ANALYSIS_MAX_PAGES = 64;
export const ANALYSIS_MAX_ROWS = 10_000;
export const ANALYSIS_MAX_ERROR_ROWS = 200;

export interface StatisticsCollectionBudget {
  remainingPages: number;
  remainingRows: number;
}

export function createStatisticsCollectionBudget(): StatisticsCollectionBudget {
  return {
    remainingPages: ANALYSIS_MAX_PAGES,
    remainingRows: ANALYSIS_MAX_ROWS,
  };
}

type CollectorErrorCode =
  | "COLLECTION_PAGE_LIMIT"
  | "COLLECTION_ROW_LIMIT"
  | "CURSOR_MISSING"
  | "CURSOR_REPEATED"
  | "CURSOR_UNEXPECTED"
  | "COUNT_INCONSISTENT"
  | "REQUEST_RANGE_MISMATCH"
  | "UNSUCCESSFUL_PAGE"
  | "response_mismatch"
  | "response_incomplete"
  | string;

export interface StatisticsRetrieval {
  success: boolean;
  rows: SimplifiedDataItem[];
  validationLevel: ValidationLevel;
  errorCode?: CollectorErrorCode;
  message?: string;
  pages: number;
}

function mergeValidation(
  left: ValidationLevel,
  right: ValidationLevel,
): ValidationLevel {
  if (left === "unverified" || right === "unverified") return "unverified";
  if (left === "partial" || right === "partial") return "partial";
  return "verified";
}

function boundedEvidence(rows: SimplifiedDataItem[]): SimplifiedDataItem[] {
  return rows.slice(0, ANALYSIS_MAX_ERROR_ROWS);
}

function resultMessage(result: GetStatisticsDataResult): string {
  return (
    result.usageHint ?? result.errorMessage ?? "통계 응답을 받지 못했습니다."
  );
}

function expectedRange(input: GetStatisticsDataInput): string | undefined {
  return input.startPeriod !== undefined || input.endPeriod !== undefined
    ? `${input.startPeriod ?? ""} ~ ${input.endPeriod ?? ""}`
    : undefined;
}

function failed(
  rows: SimplifiedDataItem[],
  validationLevel: ValidationLevel,
  pages: number,
  errorCode: CollectorErrorCode,
  message: string,
): StatisticsRetrieval {
  return {
    success: false,
    rows: boundedEvidence(rows),
    validationLevel: "unverified",
    errorCode,
    message,
    pages,
  };
}

function countIsValid(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Collect every page needed by an analytical tool before any calculation runs.
 * The first request always starts a new traversal; only subsequent requests carry
 * the cursor returned by the preceding successful page.
 */
export async function collectStatisticsPages(
  input: GetStatisticsDataInput,
  budget: StatisticsCollectionBudget = createStatisticsCollectionBudget(),
): Promise<StatisticsRetrieval> {
  const request: GetStatisticsDataInput = { ...input, cursor: undefined };
  const requestedRange = expectedRange(request);
  const finiteQuery = requestedRange !== undefined;
  const rows: SimplifiedDataItem[] = [];
  const seenCursors = new Set<string>();
  let validationLevel: ValidationLevel = "verified";
  let emittedBefore = 0;
  let pageCount = 0;
  let cursor: string | undefined;

  for (;;) {
    if (pageCount >= ANALYSIS_MAX_PAGES || budget.remainingPages <= 0) {
      return failed(
        rows,
        validationLevel,
        pageCount,
        "COLLECTION_PAGE_LIMIT",
        `분석용 통계 페이지 수가 안전 한도(${ANALYSIS_MAX_PAGES})를 초과했습니다.`,
      );
    }
    if (budget.remainingRows <= 0) {
      return failed(
        rows,
        validationLevel,
        pageCount,
        "COLLECTION_ROW_LIMIT",
        `분석용 통계 관측값 수가 안전 한도(${ANALYSIS_MAX_ROWS})에 도달했습니다.`,
      );
    }
    budget.remainingPages -= 1;

    let result: GetStatisticsDataResult;
    try {
      result = await getStatisticsData(
        cursor === undefined ? request : { ...request, cursor },
      );
    } catch (error) {
      const handled = handleToolError(error);
      const errorCode =
        handled.code === "UNKNOWN_ERROR" ? "UNSUCCESSFUL_PAGE" : handled.code;
      return failed(
        rows,
        validationLevel,
        pageCount,
        errorCode,
        `통계 페이지 조회 중 오류가 발생했습니다: ${handled.error}`,
      );
    }
    pageCount += 1;

    if (!result.success) {
      const code = result.errorCode ?? "UNSUCCESSFUL_PAGE";
      return failed(
        rows.concat(result.data ?? []),
        validationLevel,
        pageCount,
        code,
        resultMessage(result),
      );
    }

    const pageRows = Array.isArray(result.data) ? result.data : [];
    const availableRows = Math.min(
      ANALYSIS_MAX_ROWS - rows.length,
      budget.remainingRows,
    );
    if (pageRows.length > availableRows) {
      rows.push(...pageRows.slice(0, Math.max(0, availableRows)));
      budget.remainingRows = 0;
      return failed(
        rows,
        validationLevel,
        pageCount,
        "COLLECTION_ROW_LIMIT",
        `분석용 통계 관측값 수가 안전 한도(${ANALYSIS_MAX_ROWS})를 초과했습니다.`,
      );
    }
    rows.push(...pageRows);
    budget.remainingRows -= pageRows.length;

    if (result.requestedPeriodRange !== requestedRange) {
      return failed(
        rows,
        validationLevel,
        pageCount,
        "REQUEST_RANGE_MISMATCH",
        "통계 페이지의 요청 기간 범위가 최초 요청과 달라 수집을 중단했습니다.",
      );
    }

    if (
      !countIsValid(result.returnedCount) ||
      result.returnedCount !== pageRows.length
    ) {
      return failed(
        rows,
        validationLevel,
        pageCount,
        "COUNT_INCONSISTENT",
        "통계 페이지의 returnedCount와 실제 관측값 수가 일치하지 않습니다.",
      );
    }

    if (
      !countIsValid(result.emittedCount) ||
      result.emittedCount !== emittedBefore + pageRows.length
    ) {
      return failed(
        rows,
        validationLevel,
        pageCount,
        "COUNT_INCONSISTENT",
        "통계 페이지의 emittedCount 누적값이 관측값 수와 일치하지 않습니다.",
      );
    }

    const pageValidation = result.validationLevel ?? "verified";
    if (
      pageValidation !== "verified" &&
      pageValidation !== "partial" &&
      pageValidation !== "unverified"
    ) {
      return failed(
        rows,
        validationLevel,
        pageCount,
        "COUNT_INCONSISTENT",
        "통계 페이지의 검증 수준이 유효하지 않습니다.",
      );
    }
    validationLevel = mergeValidation(validationLevel, pageValidation);
    if (
      result.completion === "unproven" ||
      result.periodCompleteness === "partition_local"
    ) {
      validationLevel = "unverified";
    }

    const hasMore = result.hasMore;
    if (typeof hasMore !== "boolean") {
      return failed(
        rows,
        validationLevel,
        pageCount,
        "COUNT_INCONSISTENT",
        "통계 페이지의 hasMore 값이 없습니다.",
      );
    }
    if (
      hasMore &&
      result.aggregateRowCount !== undefined &&
      result.aggregateRowCount !== null
    ) {
      return failed(
        rows,
        validationLevel,
        pageCount,
        "COUNT_INCONSISTENT",
        "진행 중인 통계 페이지에 완료 aggregateRowCount가 있습니다.",
      );
    }
    if (hasMore) {
      if (
        typeof result.nextCursor !== "string" ||
        result.nextCursor.length === 0
      ) {
        return failed(
          rows,
          validationLevel,
          pageCount,
          "CURSOR_MISSING",
          "통계 페이지가 다음 커서를 반환하지 않았습니다.",
        );
      }
      if (seenCursors.has(result.nextCursor)) {
        return failed(
          rows,
          validationLevel,
          pageCount,
          "CURSOR_REPEATED",
          "통계 페이지가 이미 사용한 커서를 반복 반환했습니다.",
        );
      }
      if (
        result.completion !== undefined &&
        result.completion !== "in_progress"
      ) {
        return failed(
          rows,
          validationLevel,
          pageCount,
          "COUNT_INCONSISTENT",
          "추가 페이지가 있는데 완료 상태로 표시되었습니다.",
        );
      }
      seenCursors.add(result.nextCursor);
      cursor = result.nextCursor;
    } else {
      if (result.nextCursor !== undefined && result.nextCursor !== null) {
        return failed(
          rows,
          validationLevel,
          pageCount,
          "CURSOR_UNEXPECTED",
          "완료된 통계 페이지가 다음 커서를 반환했습니다.",
        );
      }
      if (result.completion === "in_progress") {
        return failed(
          rows,
          validationLevel,
          pageCount,
          "COUNT_INCONSISTENT",
          "통계 페이지가 추가 페이지 없이 진행 중으로 표시되었습니다.",
        );
      }
      if (finiteQuery && result.completion !== "complete") {
        return failed(
          rows,
          validationLevel,
          pageCount,
          "COUNT_INCONSISTENT",
          "유한 통계 범위가 완료 상태로 증명되지 않았습니다.",
        );
      }
      if (
        result.aggregateRowCount !== undefined &&
        result.aggregateRowCount !== null
      ) {
        if (
          !countIsValid(result.aggregateRowCount) ||
          result.aggregateRowCount !== result.emittedCount
        ) {
          return failed(
            rows,
            validationLevel,
            pageCount,
            "COUNT_INCONSISTENT",
            "완료된 통계 페이지의 aggregateRowCount가 누적값과 다릅니다.",
          );
        }
      } else if (finiteQuery) {
        return failed(
          rows,
          validationLevel,
          pageCount,
          "COUNT_INCONSISTENT",
          "유한 통계 범위의 aggregateRowCount가 없습니다.",
        );
      }
    }

    emittedBefore = result.emittedCount;
    if (!hasMore) {
      if (rows.length !== emittedBefore) {
        return failed(
          rows,
          validationLevel,
          pageCount,
          "COUNT_INCONSISTENT",
          "완료된 통계 페이지의 누적 관측값 수가 emittedCount와 다릅니다.",
        );
      }
      return {
        success: true,
        rows,
        validationLevel,
        pages: pageCount,
      };
    }
  }
}
