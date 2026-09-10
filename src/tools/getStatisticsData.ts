/**
 * 통계 데이터 조회 도구
 * 특정 통계표의 실제 데이터를 조회
 */

import { z } from "zod";
import { getKosisClient } from "../api/client.js";
import { getCacheManager } from "../cache/index.js";
import {
  simplifyStatisticsData,
  sortStatisticsData,
  comparePeriods,
  recommendVisualization,
  normalizeStatisticsPeriodType,
} from "../utils/dataFormatter.js";
import {
  STATISTICS_DATA_PAGE_DEFAULT,
  STATISTICS_DATA_PAGE_MAX,
  type StatisticsDataPageQuery,
  type DataCursorState,
  type DataInterval,
  decodeDataCursor,
  encodeDataCursor,
  fitStatisticsDataPage,
  boundedStatisticsDataError,
  mcpWireSize,
  periodLabel,
  queryHash,
  snapshotHash,
  canonicalJson,
} from "../utils/statisticsDataPage.js";
import { handleToolError } from "../utils/errorHandler.js";
import type { SimplifiedDataItem } from "../api/types.js";

export const getStatisticsDataSchema = {
  name: "get_statistics_data",
  description:
    "특정 통계표의 실제 데이터를 조회합니다. 중요: 먼저 get_table_info로 유효한 objL1, itemId 값을 확인한 후 호출하세요.",
  inputSchema: z.object({
    orgId: z.string().describe("기관 ID (예: 101)"),
    tableId: z.string().describe("통계표 ID (예: DT_1B04005)"),
    objL1: z
      .string()
      .describe("분류1 코드 (필수) - get_table_info로 유효한 값 조회 필요"),
    objL2: z.string().optional().describe("분류2 코드 (선택)"),
    objL3: z.string().optional().describe("분류3 코드 (선택)"),
    objL4: z.string().optional().describe("분류4 코드 (선택)"),
    objL5: z.string().optional().describe("분류5 코드 (선택)"),
    objL6: z.string().optional().describe("분류6 코드 (선택)"),
    objL7: z.string().optional().describe("분류7 코드 (선택)"),
    objL8: z.string().optional().describe("분류8 코드 (선택)"),
    itemId: z
      .string()
      .describe("항목 ID (필수) - get_table_info로 유효한 값 조회 필요"),
    periodType: z
      .enum(["Y", "M", "Q", "S", "D", "F", "IR"])
      .describe(
        "주기: Y(년), M(월), Q(분기), S(반기), D(일), F(다년), IR(부정기)",
      ),
    startPeriod: z.string().optional().describe("시작 시점 (예: 2020, 202001)"),
    endPeriod: z.string().optional().describe("종료 시점 (예: 2024, 202412)"),
    recentCount: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("최근 N개 시점 (startPeriod/endPeriod 대신 사용)"),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(STATISTICS_DATA_PAGE_MAX)
      .optional()
      .describe(
        `페이지 크기 (기본 ${STATISTICS_DATA_PAGE_DEFAULT}, 최대 ${STATISTICS_DATA_PAGE_MAX})`,
      ),
    cursor: z
      .string()
      .optional()
      .describe("이전 페이지의 서명된 이어보기 커서"),
  }),
};

export type GetStatisticsDataInput = z.infer<
  typeof getStatisticsDataSchema.inputSchema
>;
const QUERY_IDENTITY_VERSION = "v3";
type ValidationLevel = "verified" | "partial" | "unverified";
type Completion = "in_progress" | "complete" | "unproven";
export interface GetStatisticsDataResult {
  success: boolean;
  data: SimplifiedDataItem[];
  errorCode?: string;
  errorMessage?: string;
  validationLevel?: ValidationLevel;
  tableName?: string;
  unit?: string;
  returnedCount?: number;
  emittedCount?: number;
  aggregateRowCount?: number | null;
  providerTotalCount?: null;
  providerSnapshot?: "unproven";
  snapshotScope?: "active_partition";
  periodCompleteness?: "verified" | "partition_local" | "unproven";
  completion?: Completion;
  traversalComplete?: boolean;
  completionScope?: "requested_period_traversal";
  hasMore?: boolean;
  nextCursor?: string | null;
  requestedPeriodRange?: string;
  pagePeriodRange?: string | null;
  metadata?: {
    validationLevel?: ValidationLevel;
    orgId: string;
    tableId: string;
    periodType: string;
    periodRange?: string;
  };
  usageHint?: string;
  visualization?: { recommendedType: string; reason: string };
  [key: string]: unknown;
}

type ResponseValidation =
  | { ok: true; validationLevel: ValidationLevel }
  | {
      ok: false;
      errorCode: "response_mismatch" | "response_incomplete";
      message: string;
    };

function valuesForField(
  rows: Array<Record<string, unknown>>,
  field: string,
): { values: Set<string>; missing: boolean } {
  const values = new Set<string>();
  let missing = false;

  for (const row of rows) {
    const value = row[field];
    if (typeof value === "string" && value.length > 0) {
      values.add(value);
    } else {
      missing = true;
    }
  }

  return { values, missing };
}
function isUnambiguousScalarSelection(value: string): boolean {
  const normalized = value.trim();
  // Do not parse selection syntax. These explicit multi-selection markers are
  // passed through without scalar validation; their provider semantics remain
  // authoritative.
  return (
    normalized.length > 0 &&
    normalized !== "*" &&
    normalized.toUpperCase() !== "ALL" &&
    normalized.toUpperCase() !== "SUM" &&
    !normalized.includes(",") &&
    !normalized.includes("+")
  );
}
function isUnknownUnit(value: unknown): boolean {
  const normalized = typeof value === "string" ? value.trim() : "";
  return (
    !normalized ||
    /^(?:unknown|n\/?a|na|null|미상|단위\s*미상|알\s*수\s*없음|-|…|\.\.\.)$/iu.test(
      normalized,
    )
  );
}
/**
 * Return a comparable ordinal for provider periods when the frequency grammar
 * is defined by KOSIS. Unsupported frequencies intentionally return null.
 */
export function parseStatisticsPeriod(
  period: unknown,
  periodType: string,
): number | null {
  if (typeof period !== "string") return null;
  const normalized = period.trim();
  if (periodType === "Y") {
    return /^\d{4}$/u.test(normalized) ? Number(normalized) : null;
  }
  if (periodType === "M") {
    if (!/^\d{6}$/u.test(normalized)) return null;
    const month = Number(normalized.slice(4));
    return month >= 1 && month <= 12
      ? Number(normalized.slice(0, 4)) * 12 + month - 1
      : null;
  }
  if (periodType === "Q") {
    const match = normalized.match(/^(\d{4})(?:Q|0)?([1-4])$/u);
    if (!match) return null;
    return Number(match[1]) * 4 + Number(match[2]) - 1;
  }
  return null;
}
function observationIdentityPart(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function periodSeriesKey(row: Record<string, unknown>): string {
  return JSON.stringify([
    observationIdentityPart(row.ITM_ID),
    ...Array.from({ length: 8 }, (_, index) =>
      observationIdentityPart(row[`C${index + 1}`]),
    ),
  ]);
}

function periodObservationKey(
  row: Record<string, unknown>,
  periodType?: string,
): string {
  const rawPeriod = observationIdentityPart(row.PRD_DE);
  const parsedPeriod =
    periodType !== undefined && isCadencedPeriodType(periodType)
      ? parseStatisticsPeriod(rawPeriod, periodType)
      : null;
  return JSON.stringify([periodSeriesKey(row), parsedPeriod ?? rawPeriod]);
}

function isCadencedPeriodType(periodType: string): boolean {
  return periodType === "Y" || periodType === "M" || periodType === "Q";
}

function validatePeriodObservations(
  input: GetStatisticsDataInput,
  results: Array<Record<string, unknown>>,
  periods: { values: Set<string>; missing: boolean },
): ResponseValidation {
  const seenObservationIdentities = new Set<string>();
  const rowsPerSeries = new Map<string, number>();

  for (const row of results) {
    const observationKey = periodObservationKey(row, input.periodType);
    if (seenObservationIdentities.has(observationKey)) {
      const period = typeof row.PRD_DE === "string" ? row.PRD_DE : "";
      return {
        ok: false,
        errorCode: "response_incomplete",
        message: `Duplicate observation identity at PRD_DE "${period}"`,
      };
    }
    seenObservationIdentities.add(observationKey);

    const seriesKey = periodSeriesKey(row);
    rowsPerSeries.set(seriesKey, (rowsPerSeries.get(seriesKey) ?? 0) + 1);
  }

  const bounded =
    input.startPeriod !== undefined && input.endPeriod !== undefined;
  const recentMode = input.recentCount !== undefined;

  if (!isCadencedPeriodType(input.periodType)) {
    // S/D/F/IR have provider-specific period semantics; preserve rows but do
    // not claim cadence or range completeness that cannot be demonstrated.
    if (recentMode) {
      for (const rowCount of rowsPerSeries.values()) {
        if (rowCount < input.recentCount!) {
          return {
            ok: false,
            errorCode: "response_incomplete",
            message:
              "The response contains fewer observations than recentCount for one series",
          };
        }
      }
    }
    return { ok: true, validationLevel: "unverified" };
  }

  const ordinals = new Map<string, number>();
  for (const period of periods.values) {
    const ordinal = parseStatisticsPeriod(period, input.periodType);
    if (ordinal === null) {
      return {
        ok: false,
        errorCode: "response_incomplete",
        message: `PRD_DE "${period}" is not valid for ${input.periodType} frequency`,
      };
    }
    ordinals.set(period, ordinal);
  }

  const start =
    input.startPeriod === undefined
      ? undefined
      : parseStatisticsPeriod(input.startPeriod, input.periodType);
  const end =
    input.endPeriod === undefined
      ? undefined
      : parseStatisticsPeriod(input.endPeriod, input.periodType);
  if (start === null || end === null) {
    return {
      ok: false,
      errorCode: "response_incomplete",
      message:
        "The requested period boundary does not match the supported period grammar",
    };
  }
  if (start !== undefined && end !== undefined && start > end) {
    return {
      ok: false,
      errorCode: "response_mismatch",
      message: "The requested period range is reversed",
    };
  }

  const series = new Map<string, Map<number, string>>();
  for (const row of results) {
    const period = typeof row.PRD_DE === "string" ? row.PRD_DE : "";
    const ordinal = ordinals.get(period);
    if (ordinal === undefined) {
      return {
        ok: false,
        errorCode: "response_incomplete",
        message:
          "The response does not expose a verifiable period for every observation",
      };
    }
    if (
      (start !== undefined && ordinal < start) ||
      (end !== undefined && ordinal > end)
    ) {
      return {
        ok: false,
        errorCode: "response_mismatch",
        message:
          "The response contains observations outside the requested period range",
      };
    }
    const key = periodSeriesKey(row);
    const observations = series.get(key) ?? new Map<number, string>();
    if (observations.has(ordinal)) {
      return {
        ok: false,
        errorCode: "response_incomplete",
        message: `Duplicate observation for one series at PRD_DE "${period}"`,
      };
    }
    observations.set(ordinal, period);
    series.set(key, observations);
  }

  if (series.size === 0) {
    return {
      ok: false,
      errorCode: "response_incomplete",
      message: "The response contains no observations for the requested range",
    };
  }

  if (recentMode) {
    for (const observations of series.values()) {
      if (observations.size < input.recentCount!) {
        return {
          ok: false,
          errorCode: "response_incomplete",
          message:
            "The response contains fewer observations than recentCount for one series",
        };
      }
    }
  }
  if (!bounded) {
    return { ok: true, validationLevel: "unverified" };
  }

  for (const observations of series.values()) {
    const ordered = [...observations.keys()].sort(
      (left, right) => left - right,
    );
    if (start !== undefined && !observations.has(start)) {
      return {
        ok: false,
        errorCode: "response_incomplete",
        message:
          "The response is missing the requested start boundary for one series",
      };
    }
    if (end !== undefined && !observations.has(end)) {
      return {
        ok: false,
        errorCode: "response_incomplete",
        message:
          "The response is missing the requested end boundary for one series",
      };
    }
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index] - ordered[index - 1] !== 1) {
        return {
          ok: false,
          errorCode: "response_incomplete",
          message:
            "The response has a missing period within one returned series",
        };
      }
    }
    if (
      start !== undefined &&
      end !== undefined &&
      observations.size !== end - start + 1
    ) {
      return {
        ok: false,
        errorCode: "response_incomplete",
        message:
          "The response does not contain every period in the requested range for one series",
      };
    }
  }

  return {
    ok: true,
    validationLevel: recentMode || !bounded ? "unverified" : "verified",
  };
}

function validateResponse(
  input: GetStatisticsDataInput,
  results: Array<Record<string, unknown>>,
): ResponseValidation {
  let hasMissingFields = false;
  let hasOpaqueSelection = false;

  const identityFields: Array<[string, string]> = [
    ["ORG_ID", input.orgId],
    ["TBL_ID", input.tableId],
    ["PRD_SE", input.periodType],
  ];

  for (const [field, expected] of identityFields) {
    const observed = valuesForField(results, field);
    hasMissingFields ||= observed.missing;
    if (
      [...observed.values].some(
        (value) =>
          (field === "PRD_SE"
            ? normalizeStatisticsPeriodType(value)
            : value) !== expected,
      )
    ) {
      return {
        ok: false,
        errorCode: "response_mismatch",
        message: `${field} does not match the requested query`,
      };
    }
  }

  const selectionFields: Array<[string, string | undefined, string]> = [];
  for (let level = 1; level <= 8; level++) {
    selectionFields.push([
      `C${level}`,
      input[`objL${level}` as keyof GetStatisticsDataInput] as
        string | undefined,
      `objL${level}`,
    ]);
  }
  selectionFields.push(["ITM_ID", input.itemId, "itemId"]);

  for (const [field, requested] of selectionFields) {
    if (!requested) continue;

    const observed = valuesForField(results, field);
    hasMissingFields ||= observed.missing;
    if (!isUnambiguousScalarSelection(requested)) {
      hasOpaqueSelection = true;
    }
    // A scalar request must be echoed by every returned row. Multiple values
    // are accepted only for selections whose syntax is intentionally left
    // uninterpreted (wildcard/list/sum).
    if (
      isUnambiguousScalarSelection(requested) &&
      observed.values.size > 0 &&
      [...observed.values].some((value) => value !== requested)
    ) {
      return {
        ok: false,
        errorCode: "response_mismatch",
        message: `${field} does not match the requested selection`,
      };
    }
  }

  const periods = valuesForField(results, "PRD_DE");
  hasMissingFields ||= periods.missing;
  if (input.startPeriod || input.endPeriod) {
    if (periods.missing || periods.values.size === 0) {
      return {
        ok: false,
        errorCode: "response_incomplete",
        message:
          "The response does not expose periods needed to verify the requested range",
      };
    }

    // Cadenced Y/M/Q periods are checked by validatePeriodObservations below;
    // unsupported frequencies retain only conservative containment checks.
    if (!isCadencedPeriodType(input.periodType)) {
      const outsideRange = [...periods.values].some((period) => {
        const beforeStart =
          input.startPeriod !== undefined &&
          comparePeriods(period, input.startPeriod) < 0;
        const afterEnd =
          input.endPeriod !== undefined &&
          comparePeriods(period, input.endPeriod) > 0;
        return beforeStart || afterEnd;
      });
      if (outsideRange) {
        return {
          ok: false,
          errorCode: "response_mismatch",
          message:
            "The response contains observations outside the requested period range",
        };
      }
    }
  }

  const outputFields = ["TBL_NM", "ITM_NM", "UNIT_NM", "DT"];
  for (const field of outputFields) {
    hasMissingFields ||= valuesForField(results, field).missing;
  }
  const units = valuesForField(results, "UNIT_NM");
  if ([...units.values].some((unit) => isUnknownUnit(unit))) {
    hasMissingFields = true;
  }
  if (units.values.size > 1) {
    hasMissingFields = true;
  }

  const periodValidation = validatePeriodObservations(input, results, periods);
  if (!periodValidation.ok) {
    return periodValidation;
  }

  const validationLevel =
    periodValidation.validationLevel === "unverified"
      ? "unverified"
      : hasOpaqueSelection || hasMissingFields
        ? "partial"
        : "verified";
  return {
    ok: true,
    validationLevel,
  };
}

export async function getStatisticsData(
  input: GetStatisticsDataInput,
): Promise<GetStatisticsDataResult> {
  const client = getKosisClient();
  const cache = getCacheManager();
  const pageSize = input.pageSize ?? STATISTICS_DATA_PAGE_DEFAULT;
  const isFiniteQuery =
    isCadencedPeriodType(input.periodType) &&
    input.startPeriod !== undefined &&
    input.endPeriod !== undefined &&
    input.recentCount === undefined;

  const requestedPeriodRange =
    input.startPeriod !== undefined || input.endPeriod !== undefined
      ? `${input.startPeriod ?? ""} ~ ${input.endPeriod ?? ""}`
      : undefined;
  const outputBase = (
    extra: Pick<GetStatisticsDataResult, "success" | "data"> &
      Record<string, unknown>,
  ): GetStatisticsDataResult => ({
    providerTotalCount: null,
    providerSnapshot: "unproven",
    snapshotScope: "active_partition",
    requestedPeriodRange,
    completionScope: "requested_period_traversal",
    ...extra,
  });

  const query: StatisticsDataPageQuery = {
    orgId: input.orgId,
    tableId: input.tableId,
    objL1: input.objL1,
    objL2: input.objL2,
    objL3: input.objL3,
    objL4: input.objL4,
    objL5: input.objL5,
    objL6: input.objL6,
    objL7: input.objL7,
    objL8: input.objL8,
    itemId: input.itemId,
    periodType: input.periodType,
    startPeriod: input.startPeriod,
    endPeriod: input.endPeriod,
    pageSize,
  };
  const baseMetadata = {
    orgId: input.orgId,
    tableId: input.tableId,
    periodType: input.periodType,
  };

  const errorResult = (
    code: string,
    message: string,
    evidence: SimplifiedDataItem[] = [],
    extra: Record<string, unknown> = {},
  ): GetStatisticsDataResult =>
    boundedStatisticsDataError(
      outputBase({
        ...extra,
        success: false,
        data: [],
        validationLevel: "unverified",
        metadata: { ...baseMetadata, validationLevel: "unverified" },
        usageHint: `${message}\n\n유한 Y/M/Q 조회라면 startPeriod와 endPeriod를 함께 지정해 범위를 좁혀 다시 시도하세요.`,
      }),
      code,
      message,
      evidence,
    ) as GetStatisticsDataResult;

  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > STATISTICS_DATA_PAGE_MAX
  ) {
    return errorResult(
      "INVALID_PAGE_SIZE",
      `pageSize는 1 이상 ${STATISTICS_DATA_PAGE_MAX} 이하의 정수여야 합니다.`,
    );
  }

  if (input.cursor !== undefined && !isFiniteQuery) {
    return errorResult(
      "INVALID_CURSOR",
      "커서는 양 끝점이 있는 유한 Y/M/Q 조회에서만 사용할 수 있습니다.",
    );
  }

  const startOrdinal = isFiniteQuery
    ? parseStatisticsPeriod(input.startPeriod, input.periodType)
    : null;
  const endOrdinal = isFiniteQuery
    ? parseStatisticsPeriod(input.endPeriod, input.periodType)
    : null;
  if (
    isFiniteQuery &&
    (startOrdinal === null || endOrdinal === null || startOrdinal > endOrdinal)
  ) {
    return errorResult(
      startOrdinal !== null && endOrdinal !== null && startOrdinal > endOrdinal
        ? "response_mismatch"
        : "response_incomplete",
      "요청한 기간 경계가 지원되는 Y/M/Q 기간 형식과 맞지 않거나 역순입니다.",
    );
  }

  let state: DataCursorState | undefined;
  if (isFiniteQuery && input.cursor !== undefined) {
    const decoded = decodeDataCursor(input.cursor, query);
    if (!decoded.ok) {
      return errorResult(
        decoded.reason === "key_unavailable"
          ? "CURSOR_KEY_UNAVAILABLE"
          : "INVALID_CURSOR",
        "커서가 유효하지 않거나 조회 조건·서명과 일치하지 않습니다. 첫 페이지부터 다시 조회하세요.",
      );
    }
    state = decoded.state;
  } else if (isFiniteQuery) {
    state = {
      v: 1,
      query: queryHash(query),
      pending: [{ startOrdinal: startOrdinal!, endOrdinal: endOrdinal! }],
      emittedCount: 0,
      aggregateRowCount: 0,
      splitOccurred: false,
    };
  }

  const periodFor = (ordinal: number): string => {
    if (ordinal === startOrdinal && input.startPeriod !== undefined) {
      return input.startPeriod.trim();
    }
    if (ordinal === endOrdinal && input.endPeriod !== undefined) {
      return input.endPeriod.trim();
    }
    if (input.startPeriod === undefined)
      throw new Error("Finite period bounds required");
    return periodLabel(
      input.periodType as "Y" | "M" | "Q",
      ordinal,
      input.startPeriod,
    );
  };
  const providerParams = (interval?: DataInterval) => ({
    orgId: input.orgId,
    tblId: input.tableId,
    objL1: input.objL1,
    objL2: input.objL2,
    objL3: input.objL3,
    objL4: input.objL4,
    objL5: input.objL5,
    objL6: input.objL6,
    objL7: input.objL7,
    objL8: input.objL8,
    itmId: input.itemId,
    prdSe: input.periodType,
    ...(interval
      ? {
          startPrdDe: periodFor(interval.startOrdinal),
          endPrdDe: periodFor(interval.endOrdinal),
        }
      : {
          startPrdDe: input.startPeriod,
          endPrdDe: input.endPeriod,
          newEstPrdCnt: input.recentCount,
        }),
  });
  const cacheParams = (interval?: DataInterval): Record<string, unknown> => ({
    queryIdentityVersion: QUERY_IDENTITY_VERSION,
    ...query,
    ...(interval
      ? {
          startPeriod: periodFor(interval.startOrdinal),
          endPeriod: periodFor(interval.endOrdinal),
          recentCount: undefined,
        }
      : { recentCount: input.recentCount }),
  });

  const fetchRows = async (
    interval: DataInterval | undefined,
    bypassCache: boolean,
  ): Promise<Array<Record<string, unknown>>> => {
    const fetcher = async () =>
      client.getStatisticsData(providerParams(interval)) as unknown as Array<
        Record<string, unknown>
      >;
    const parameters = cacheParams(interval);
    if (bypassCache) cache.invalidateStatisticsData(parameters);
    const result = await cache.getStatisticsData(parameters, fetcher);
    return structuredClone(result);
  };

  const sortPartitionRows = (rows: Array<Record<string, unknown>>) =>
    [...rows].sort(
      (left, right) =>
        comparePeriods(
          left.PRD_DE as string | undefined,
          right.PRD_DE as string | undefined,
        ) || canonicalJson(left).localeCompare(canonicalJson(right)),
    );
  const summarize = (
    rows: Array<Record<string, unknown>>,
    validationLevel: ValidationLevel,
    extra: Record<string, unknown> = {},
  ) => {
    const ordered = sortStatisticsData(rows as never[]);
    const simplified = simplifyStatisticsData(ordered as never[]);
    const tableNames = [
      ...new Set(
        ordered
          .map((item) => item.TBL_NM)
          .filter((name): name is string => Boolean(name)),
      ),
    ];
    const units = [
      ...new Set(
        ordered
          .map((item) => item.UNIT_NM)
          .filter(
            (unit): unit is string => Boolean(unit) && !isUnknownUnit(unit),
          ),
      ),
    ];
    const periods = [
      ...new Set(
        ordered
          .map((item) => item.PRD_DE)
          .filter((period): period is string => Boolean(period)),
      ),
    ];
    const pagePeriodRange =
      periods.length > 1
        ? `${periods[0]} ~ ${periods[periods.length - 1]}`
        : periods[0];
    return {
      success: true,
      tableName: tableNames.length > 1 ? tableNames.join(" / ") : tableNames[0],
      unit:
        units.length === 1 &&
        ordered.every((item) => !isUnknownUnit(item.UNIT_NM))
          ? units[0]
          : undefined,
      data: simplified,
      pagePeriodRange,
      validationLevel,
      ...extra,
    };
  };

  const buildCursor = (nextState: DataCursorState): string | null =>
    encodeDataCursor(nextState);
  const progressResult = (
    currentState: DataCursorState,
    reason?: string,
  ): GetStatisticsDataResult => {
    const nextCursor = buildCursor(currentState);
    if (!nextCursor) {
      return errorResult(
        "CURSOR_KEY_UNAVAILABLE",
        "서버 커서 서명 키가 설정되지 않아 이어보기를 수행할 수 없습니다.",
      );
    }
    const result = outputBase({
      success: true,
      data: [],
      returnedCount: 0,
      emittedCount: currentState.emittedCount,
      aggregateRowCount: null,
      completion: "in_progress",
      traversalComplete: false,
      hasMore: true,
      nextCursor,
      continuationReason: reason,
      pagePeriodRange: null,
      periodCompleteness: currentState.splitOccurred
        ? "partition_local"
        : "verified",
      currentPageScope: "active_partition",
      metadata: baseMetadata,
    });
    if (mcpWireSize(result) > 32_768) {
      return errorResult(
        "CURSOR_TOO_LARGE",
        "이어보기 커서가 MCP 32768바이트 제한을 초과했습니다. 더 좁은 유한 기간 범위를 사용하세요.",
      );
    }
    return result;
  };

  try {
    if (!isFiniteQuery) {
      const results = await fetchRows(undefined, false);
      if (results.length === 0) {
        return errorResult("response_incomplete", "응답에 관측값이 없습니다.");
      }
      const validation = validateResponse(input, results);
      const preservedData =
        !validation.ok && validation.errorCode === "response_incomplete"
          ? simplifyStatisticsData(sortStatisticsData(results as never[]))
          : [];
      if (!validation.ok) {
        return errorResult(
          validation.errorCode,
          validation.message,
          preservedData,
        );
      }
      const validationLevel = validation.validationLevel;
      const summary = summarize(results, validationLevel, {
        periodCompleteness: "unproven",
      });
      const allRows = summary.data as SimplifiedDataItem[];
      const fullBase = outputBase({
        ...summary,
        metadata: {
          ...baseMetadata,
          periodRange: summary.pagePeriodRange,
          validationLevel,
        },
        returnedCount: allRows.length,
        emittedCount: allRows.length,
        aggregateRowCount: null,
        completion: "unproven" as Completion,
        traversalComplete: false,
        hasMore: false,
        nextCursor: null,
        currentPageScope: "complete_observed_response",
      });
      if (mcpWireSize(fullBase) > 32_768) {
        return errorResult(
          "OUTPUT_TOO_LARGE",
          "관측 범위 결과가 MCP 32768바이트 제한을 초과했습니다. startPeriod와 endPeriod를 지정한 더 좁은 유한 조회를 사용하세요.",
          allRows,
        );
      }
      return fullBase;
    }

    for (;;) {
      const active = state!.active;
      const interval = active
        ? { startOrdinal: active.startOrdinal, endOrdinal: active.endOrdinal }
        : state!.pending.shift();
      if (!interval) {
        return outputBase({
          success: true,
          data: [],
          returnedCount: 0,
          emittedCount: state!.emittedCount,
          aggregateRowCount: state!.aggregateRowCount,
          completion: "complete",
          traversalComplete: true,
          hasMore: false,
          nextCursor: null,
          periodCompleteness: state!.splitOccurred
            ? "partition_local"
            : "verified",
          currentPageScope: "aggregate_traversal",
          pagePeriodRange: null,
          metadata: baseMetadata,
        });
      }

      const replayingActive = Boolean(active);
      let results: Array<Record<string, unknown>>;
      try {
        results = await fetchRows(interval, replayingActive);
      } catch (error) {
        const handled = handleToolError(error);
        if (handled.code === "RESPONSE_TOO_LARGE") {
          if (replayingActive) {
            return errorResult(
              "RESTART_REQUIRED",
              "이어보는 중 활성 파티션 크기가 바뀌어 다시 시작해야 합니다.",
            );
          }
          if (interval.startOrdinal === interval.endOrdinal) {
            return errorResult(
              "ATOMIC_PERIOD_TOO_LARGE",
              "하나의 원자적 기간이 4MiB 제한을 초과했습니다. 분류·항목 선택을 좁혀 다시 조회하세요.",
            );
          }
          const midpoint = Math.floor(
            (interval.startOrdinal + interval.endOrdinal) / 2,
          );
          state!.pending.unshift(
            { startOrdinal: interval.startOrdinal, endOrdinal: midpoint },
            { startOrdinal: midpoint + 1, endOrdinal: interval.endOrdinal },
          );
          state!.splitOccurred = true;
          return progressResult(state!, "partition_split");
        }
        throw error;
      }

      const sortedResults = sortPartitionRows(results);
      if (
        replayingActive &&
        snapshotHash(sortedResults) !== active!.partitionSnapshot
      ) {
        return errorResult(
          "RESTART_REQUIRED",
          "이어보는 중 활성 파티션의 제공자 응답이 바뀌어 다시 시작해야 합니다.",
        );
      }

      if (results.length === 0) {
        if (replayingActive) {
          return errorResult(
            "RESTART_REQUIRED",
            "활성 파티션 응답이 바뀌어 다시 시작해야 합니다.",
          );
        }
        return errorResult("response_incomplete", "응답에 관측값이 없습니다.");
      }

      const childInput: GetStatisticsDataInput = {
        ...input,
        startPeriod: periodFor(interval.startOrdinal),
        endPeriod: periodFor(interval.endOrdinal),
      };
      const validation = validateResponse(childInput, results);
      if (!validation.ok) {
        const evidence =
          validation.errorCode === "response_incomplete"
            ? simplifyStatisticsData(sortStatisticsData(results as never[]))
            : [];
        return errorResult(validation.errorCode, validation.message, evidence);
      }
      for (const row of results) {
        const ordinal = parseStatisticsPeriod(row.PRD_DE, input.periodType);
        if (
          ordinal === null ||
          ordinal < interval.startOrdinal ||
          ordinal > interval.endOrdinal
        ) {
          return errorResult(
            ordinal === null ? "response_incomplete" : "response_mismatch",
            "응답 관측값이 요청한 활성 기간 파티션과 일치하지 않습니다.",
          );
        }
      }

      const initialIndex = replayingActive ? active!.rowIndex : 0;
      if (!replayingActive) state!.aggregateRowCount += results.length;
      const sortedSimplified = simplifyStatisticsData(sortedResults as never[]);
      const remainingRows = sortedSimplified.slice(initialIndex);
      const validationLevel = validation.validationLevel;
      const partitionSnapshot = replayingActive
        ? active!.partitionSnapshot
        : snapshotHash(sortedResults);
      const summary = summarize(sortedResults, validationLevel);
      const pageBase = outputBase({
        ...summary,
        metadata: {
          ...baseMetadata,
          periodRange: summary.pagePeriodRange,
          validationLevel,
        },
        periodCompleteness: state!.splitOccurred
          ? "partition_local"
          : "verified",
        currentPageScope: "current_partition",
      });

      const rowsRemainAfter = (count: number) =>
        initialIndex + count < sortedSimplified.length ||
        state!.pending.length > 0;
      const cursorFor = (count: number): string | null => {
        const nextState: DataCursorState = {
          ...state!,
          active:
            initialIndex + count < sortedSimplified.length
              ? {
                  startOrdinal: interval.startOrdinal,
                  endOrdinal: interval.endOrdinal,
                  rowIndex: initialIndex + count,
                  partitionSnapshot,
                }
              : undefined,
        };
        nextState.emittedCount += count;
        return buildCursor(nextState);
      };
      const page = fitStatisticsDataPage(
        pageBase,
        remainingRows,
        pageSize,
        rowsRemainAfter,
        cursorFor,
      );
      if (page.tooLarge) {
        return errorResult(
          "OUTPUT_ROW_TOO_LARGE",
          "하나의 원시 관측값이 MCP 32768바이트 제한을 초과했습니다. 선택 조건을 좁혀 다시 조회하세요.",
        );
      }
      for (let emitted = page.rows.length; emitted > 0; emitted -= 1) {
        const pageRows = page.rows.slice(0, emitted);
        const nextState: DataCursorState = {
          ...state!,
          active:
            initialIndex + emitted < sortedSimplified.length
              ? {
                  startOrdinal: interval.startOrdinal,
                  endOrdinal: interval.endOrdinal,
                  rowIndex: initialIndex + emitted,
                  partitionSnapshot,
                }
              : undefined,
        };
        nextState.emittedCount += emitted;
        const hasMore = rowsRemainAfter(emitted);
        const pagePeriods = [
          ...new Set(
            pageRows
              .map((row) => (row as SimplifiedDataItem).rawPeriod)
              .filter((period): period is string => Boolean(period)),
          ),
        ];
        const currentPagePeriodRange =
          pagePeriods.length > 1
            ? `${pagePeriods[0]} ~ ${pagePeriods[pagePeriods.length - 1]}`
            : pagePeriods[0];
        const completion: Completion = hasMore ? "in_progress" : "complete";
        const nextCursor = hasMore ? buildCursor(nextState) : null;
        if (hasMore && !nextCursor) {
          return errorResult(
            "CURSOR_KEY_UNAVAILABLE",
            "서버 커서 서명 키가 설정되지 않아 이어보기를 수행할 수 없습니다.",
          );
        }
        const visualization =
          !hasMore && !input.cursor && !nextState.splitOccurred
            ? recommendVisualization(
                nextState.emittedCount,
                new Set(
                  pageRows.map(
                    (row) => (row as SimplifiedDataItem).classification,
                  ),
                ).size > 1,
                true,
              )
            : undefined;
        const final = outputBase({
          ...pageBase,
          pagePeriodRange: currentPagePeriodRange,
          metadata: {
            ...(pageBase.metadata as Record<string, unknown>),
            periodRange: currentPagePeriodRange,
          },
          data: pageRows,
          returnedCount: emitted,
          emittedCount: nextState.emittedCount,
          aggregateRowCount: hasMore ? null : nextState.aggregateRowCount,
          completion,
          traversalComplete: !hasMore,
          hasMore,
          nextCursor,
          currentPageScope: "current_page",
          ...(visualization
            ? {
                visualization: {
                  recommendedType: visualization.type,
                  reason: visualization.reason,
                },
              }
            : {}),
        });
        if (mcpWireSize(final) <= 32_768) return final;
      }
      return errorResult(
        "OUTPUT_ROW_TOO_LARGE",
        "하나의 원시 관측값과 결과 래퍼가 MCP 32768바이트 제한을 초과했습니다. 선택 조건을 좁혀 다시 조회하세요.",
      );
    }
  } catch (error) {
    const handled = handleToolError(error);
    if (handled.code === "RESPONSE_TOO_LARGE") {
      return errorResult(
        "RESPONSE_TOO_LARGE",
        "관측 범위 결과가 4MiB 제한을 초과했습니다. startPeriod와 endPeriod를 지정한 더 좁은 유한 조회를 사용하세요.",
      );
    }
    return errorResult(
      handled.code === "UNKNOWN_ERROR" ? "DATA_ERROR" : handled.code,
      handled.error,
    );
  }
}
