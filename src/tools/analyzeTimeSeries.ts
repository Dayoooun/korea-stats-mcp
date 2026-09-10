/**
 * 시계열 분석 도구
 * 통계 데이터의 시계열 추세를 분석
 */

import { z } from "zod";
import { parseStatisticsPeriod } from "./getStatisticsData.js";
import { collectStatisticsPages } from "./statisticsRetrieval.js";
import type { SimplifiedDataItem, StatisticsDataItem } from "../api/types.js";
import {
  comparePeriods,
  formatPeriod,
  normalizeStatisticsPeriodType,
} from "../utils/dataFormatter.js";
import { buildStatisticsProvenance } from "../utils/statisticsProvenance.js";
import { parseObservedNumber } from "../utils/regionResolver.js";
import { handleToolError } from "../utils/errorHandler.js";

export const analyzeTimeSeriesSchema = {
  name: "analyze_time_series",
  description:
    "통계 데이터의 시계열 추세를 분석합니다. 증가/감소/안정/변동 추세와 성장률을 계산합니다. 중요: 먼저 get_table_info로 유효한 objL1, objL2, itemId 값을 확인한 후 호출하세요.",
  inputSchema: z.object({
    orgId: z.string().describe("기관 ID"),
    tableId: z.string().describe("통계표 ID"),
    objL1: z.string().describe("분류1 코드 (필수)"),
    objL2: z.string().optional().describe("분류2 코드 (선택)"),
    objL3: z.string().optional().describe("분류3 코드 (선택)"),
    objL4: z.string().optional().describe("분류4 코드 (선택)"),
    objL5: z.string().optional().describe("분류5 코드 (선택)"),
    objL6: z.string().optional().describe("분류6 코드 (선택)"),
    objL7: z.string().optional().describe("분류7 코드 (선택)"),
    objL8: z.string().optional().describe("분류8 코드 (선택)"),
    itemId: z.string().describe("항목 ID (필수)"),
    periodType: z.enum(["Y", "M", "Q"]).describe("주기: Y(년), M(월), Q(분기)"),
    yearCount: z
      .number()
      .min(2)
      .max(30)
      .optional()
      .default(10)
      .describe("분석할 기간 수 (기본: 10)"),
  }),
};

export type AnalyzeTimeSeriesInput = z.infer<
  typeof analyzeTimeSeriesSchema.inputSchema
>;
type ValidationLevel = "verified" | "partial" | "unverified";
type RawRow = StatisticsDataItem;

interface ChangeResult {
  rate: number | null;
  direction: "up" | "down" | "stable";
  formatted: string;
  absolute: number;
  explanation?: string;
}

interface TimeSeriesAnalysis {
  trend: "increasing" | "decreasing" | "stable" | "fluctuating";
  trendDescription: string;
  averageGrowthRate: number | null;
  volatility: number | null;
  maxValue: { period: string; value: number; formatted: string };
  minValue: { period: string; value: number; formatted: string };
  recentChange: ChangeResult;
  forecast?: string;
  explanation?: string;
}

type Retrieval = {
  rows: SimplifiedDataItem[];
  validationLevel: ValidationLevel;
  errorCode?: string;
  message?: string;
};

type SeriesValidation = {
  ok: boolean;
  message?: string;
  errorCode?: string;
  rows: SimplifiedDataItem[];
};

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function isOpaqueSelector(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim();
  return (
    normalized === "*" ||
    normalized.toUpperCase() === "ALL" ||
    normalized.toUpperCase() === "SUM" ||
    normalized.includes(",")
  );
}
function isUnknownUnit(value: string | undefined): boolean {
  return (
    !value ||
    /^(?:unknown|n\/?a|na|null|미상|단위\s*미상|알\s*수\s*없음|-|…|\.\.\.)$/iu.test(
      value,
    )
  );
}

function dimensions(
  input: AnalyzeTimeSeriesInput,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `objL${index + 1}`,
      input[`objL${index + 1}` as keyof AnalyzeTimeSeriesInput] as
        string | undefined,
    ]),
  );
}

async function retrieveRows(input: AnalyzeTimeSeriesInput): Promise<Retrieval> {
  const result = await collectStatisticsPages({
    orgId: input.orgId,
    tableId: input.tableId,
    ...dimensions(input),
    objL1: input.objL1,
    itemId: input.itemId,
    periodType: input.periodType,
    recentCount: input.yearCount,
  });
  if (!result.success) {
    return {
      rows: result.rows,
      validationLevel: "unverified",
      errorCode: result.errorCode ?? "response_incomplete",
      message: result.message ?? "검증된 통계 응답을 받지 못했습니다.",
    };
  }
  return { rows: result.rows, validationLevel: result.validationLevel };
}

function classificationKey(raw: RawRow): string {
  return Array.from({ length: 8 }, (_, index) => {
    const axis = index + 1;
    return `${text(raw[`C${axis}` as keyof RawRow]) ?? ""}\u0000${text(raw[`C${axis}_NM` as keyof RawRow]) ?? ""}`;
  }).join("\u0001");
}

function validateSeries(
  input: AnalyzeTimeSeriesInput,
  rows: SimplifiedDataItem[],
): SeriesValidation {
  if (rows.length < 2)
    return {
      ok: false,
      message: "분석에 필요한 검증된 시점이 두 개 이상 필요합니다.",
      rows,
    };
  const categories = new Set<string>();
  const itemIds = new Set<string>();
  const periods = new Set<string>();
  const units = new Set<string>();
  const axisValues = Array.from({ length: 8 }, () => new Set<string>());
  const axisMissing = Array.from({ length: 8 }, () => false);

  for (const row of rows) {
    const raw = row.raw;
    if (!raw)
      return {
        ok: false,
        message: "provider raw observation evidence is missing.",
        rows,
      };
    const orgId = text(raw.ORG_ID);
    const tableId = text(raw.TBL_ID);
    if (!orgId || !tableId) {
      return {
        ok: false,
        message: "응답 통계표 식별자 증거가 누락되었습니다.",
        errorCode: "response_incomplete",
        rows,
      };
    }
    if (orgId !== input.orgId || tableId !== input.tableId) {
      return {
        ok: false,
        message: "응답 통계표 식별자가 요청과 다릅니다.",
        errorCode: "response_mismatch",
        rows,
      };
    }
    const periodType = normalizeStatisticsPeriodType(text(raw.PRD_SE));
    if (!periodType) {
      return {
        ok: false,
        message: "응답 주기 증거가 누락되었습니다.",
        errorCode: "response_incomplete",
        rows,
      };
    }
    if (periodType !== input.periodType) {
      return {
        ok: false,
        message: "응답 주기가 요청과 다릅니다.",
        errorCode: "response_mismatch",
        rows,
      };
    }
    const period = text(raw.PRD_DE);
    if (!period || parseStatisticsPeriod(period, input.periodType) === null)
      return {
        ok: false,
        message: "응답 시점을 해석할 수 없습니다.",
        errorCode: "response_incomplete",
        rows,
      };
    const item = text(raw.ITM_ID);
    if (!item)
      return { ok: false, message: "응답 항목 식별자가 없습니다.", rows };
    if (!isOpaqueSelector(input.itemId) && item !== input.itemId)
      return {
        ok: false,
        message: "응답 항목이 요청 항목과 다릅니다.",
        errorCode: "response_mismatch",
        rows,
      };
    const unit = text(raw.UNIT_NM);
    if (!unit)
      return {
        ok: false,
        message: "응답 단위가 없어 시계열을 분석할 수 없습니다.",
        rows,
      };
    if (isUnknownUnit(unit))
      return {
        ok: false,
        message: "응답 단위 증거가 누락되었거나 미상입니다.",
        errorCode: "response_incomplete",
        rows,
      };
    for (let index = 0; index < 8; index += 1) {
      const axis = index + 1;
      const value = text(raw[`C${axis}` as keyof RawRow]);
      const requested = input[`objL${axis}` as keyof AnalyzeTimeSeriesInput] as
        string | undefined;
      if (value) axisValues[index].add(value);
      else axisMissing[index] = true;
      if (requested && !isOpaqueSelector(requested) && !value)
        return {
          ok: false,
          message: `C${axis} 응답 분류값 증거가 누락되었습니다.`,
          errorCode: "response_incomplete",
          rows,
        };
      if (requested && !isOpaqueSelector(requested) && value !== requested)
        return {
          ok: false,
          message: `C${axis} 응답 분류값이 요청과 다릅니다.`,
          errorCode: "response_mismatch",
          rows,
        };
    }
    if (parseObservedNumber(raw.DT) === null)
      return {
        ok: false,
        message: `${period} 관측값이 결측 또는 숫자가 아니어서 시계열이 불완전합니다.`,
        errorCode: "response_incomplete",
        rows,
      };
    categories.add(classificationKey(raw));
    itemIds.add(item);
    periods.add(period);
    units.add(unit);
  }

  if (categories.size !== 1)
    return {
      ok: false,
      message: "여러 분류가 한 시계열 응답에 섞였습니다.",
      rows,
    };
  if (itemIds.size !== 1)
    return {
      ok: false,
      message: "여러 항목이 한 시계열 응답에 섞였습니다.",
      rows,
    };
  if (units.size !== 1)
    return { ok: false, message: "여러 단위가 한 시계열에 섞였습니다.", rows };
  for (let index = 0; index < 8; index += 1) {
    if (
      axisValues[index].size > 1 ||
      (axisValues[index].size > 0 && axisMissing[index])
    )
      return {
        ok: false,
        message: `C${index + 1} 분류값이 혼합되었거나 일부 누락되었습니다.`,
        rows,
      };
  }
  if (periods.size !== rows.length)
    return {
      ok: false,
      message: "동일 시점의 중복 관측이 있어 한 시계열을 확정할 수 없습니다.",
      rows,
    };

  const ordered = [...periods].sort((left, right) =>
    comparePeriods(left, right),
  );
  const indexes = ordered.map(
    (period) => parseStatisticsPeriod(period, input.periodType) as number,
  );
  for (let index = 1; index < indexes.length; index += 1) {
    if (indexes[index] - indexes[index - 1] !== 1)
      return {
        ok: false,
        message: "시점이 이어지지 않아 누락 기간을 0으로 보정하지 않았습니다.",
        rows,
      };
  }
  return { ok: true, rows };
}

function changeFor(current: number, previous: number): ChangeResult {
  const absolute = current - previous;
  if (previous === 0) {
    return {
      rate: null,
      absolute,
      direction: absolute > 0 ? "up" : absolute < 0 ? "down" : "stable",
      formatted: `${absolute > 0 ? "+" : ""}${absolute.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} (기준값 0으로 비율 미정)`,
      explanation: "이전 관측값이 0이어서 백분율 변화율은 정의되지 않습니다.",
    };
  }
  const rate = (absolute / Math.abs(previous)) * 100;
  return {
    rate,
    absolute,
    direction: rate > 0.1 ? "up" : rate < -0.1 ? "down" : "stable",
    formatted: `${rate > 0 ? "+" : ""}${rate.toFixed(1)}%`,
  };
}

function calculateTrend(values: number[]): {
  trend: TimeSeriesAnalysis["trend"];
  averageGrowthRate: number | null;
  volatility: number | null;
  explanation?: string;
} {
  const deltas = values.slice(1).map((value, index) => value - values[index]);
  const nonZeroDeltas = deltas.filter((value) => value !== 0);
  let trend: TimeSeriesAnalysis["trend"] = "stable";
  if (nonZeroDeltas.length > 0 && nonZeroDeltas.every((value) => value > 0))
    trend = "increasing";
  else if (
    nonZeroDeltas.length > 0 &&
    nonZeroDeltas.every((value) => value < 0)
  )
    trend = "decreasing";
  else if (
    nonZeroDeltas.some((value) => value > 0) &&
    nonZeroDeltas.some((value) => value < 0)
  )
    trend = "fluctuating";

  const rates: number[] = [];
  let hasUndefinedRate = false;
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] === 0) {
      hasUndefinedRate = true;
    } else {
      rates.push(
        ((values[index] - values[index - 1]) / Math.abs(values[index - 1])) *
          100,
      );
    }
  }
  if (hasUndefinedRate) {
    return {
      trend,
      averageGrowthRate: null,
      volatility: null,
      explanation:
        "0을 기준으로 한 변화율이 포함되어 전체 성장률과 변동성을 산출하지 않았습니다.",
    };
  }
  if (rates.length === 0) {
    return {
      trend,
      averageGrowthRate: null,
      volatility: null,
      explanation: "변화율을 산출할 수 있는 비제로 기준값이 없습니다.",
    };
  }
  const averageGrowthRate =
    rates.reduce((sum, value) => sum + value, 0) / rates.length;
  const variance =
    rates.reduce((sum, value) => sum + (value - averageGrowthRate) ** 2, 0) /
    rates.length;
  return { trend, averageGrowthRate, volatility: Math.sqrt(variance) };
}

function getTrendDescription(trend: TimeSeriesAnalysis["trend"]): string {
  switch (trend) {
    case "increasing":
      return "지속적인 상승 추세를 보이고 있습니다.";
    case "decreasing":
      return "지속적인 하락 추세를 보이고 있습니다.";
    case "stable":
      return "안정적인 흐름을 유지하고 있습니다.";
    default:
      return "변동이 큰 불안정한 흐름을 보이고 있습니다.";
  }
}

function failedResult(
  input: AnalyzeTimeSeriesInput,
  message: string,
  rows: SimplifiedDataItem[],
  level: ValidationLevel = "unverified",
  errorCode: string = "response_incomplete",
  queriedAt: string = new Date().toISOString(),
) {
  const readAt = new Date().toISOString();
  return {
    success: false,
    validationLevel: level,
    errorCode,
    provenance: buildStatisticsProvenance(
      { ...input, recentCount: input.yearCount },
      rows,
      {
        queriedAt,
        readAt,
        calculated: false,
        calculationPolicies: [
          "No analysis is applied unless provider observations pass validation.",
          "Missing observations are never converted to zero.",
        ],
      },
    ),
    dataPoints: rows.map((row) => ({
      period: text(row.raw?.PRD_DE) ?? "-",
      value: parseObservedNumber(row.raw?.DT),
      rawValue:
        row.raw?.DT === undefined || row.raw?.DT === null
          ? undefined
          : String(row.raw.DT),
      raw: row.raw,
    })),
    interpretation: [
      message,
      rows.length > 0
        ? "반환 가능한 원본 provider 관측값은 dataPoints[].raw에 보존되어 있습니다."
        : "검증 실패로 반환할 수 있는 원본 관측값이 없습니다.",
    ],
  };
}

export async function analyzeTimeSeries(
  input: AnalyzeTimeSeriesInput,
): Promise<{
  success: boolean;
  validationLevel?: ValidationLevel;
  errorCode?: string;
  tableName?: string;
  unit?: string;
  analysis?: TimeSeriesAnalysis;
  dataPoints: Array<{
    period: string;
    value: number | null;
    rawValue?: string;
    raw?: RawRow;
  }>;
  interpretation: string[];
  provenance?: ReturnType<typeof buildStatisticsProvenance>;
}> {
  const queriedAt = new Date().toISOString();
  try {
    const retrieval = await retrieveRows(input);
    if (retrieval.errorCode)
      return failedResult(
        input,
        retrieval.message ?? "통계 응답 검증에 실패했습니다.",
        retrieval.rows,
        "unverified",
        retrieval.errorCode,
        queriedAt,
      );
    const validation = validateSeries(input, retrieval.rows);
    if (!validation.ok)
      return failedResult(
        input,
        validation.message ?? "시계열 응답이 불완전합니다.",
        validation.rows,
        "unverified",
        validation.errorCode,
        queriedAt,
      );

    const orderedRows = [...validation.rows].sort((left, right) =>
      comparePeriods(left.raw.PRD_DE, right.raw.PRD_DE),
    );
    const values = orderedRows.map(
      (row) => parseObservedNumber(row.raw.DT) as number,
    );
    const periods = orderedRows.map((row) => text(row.raw.PRD_DE) as string);
    const trendResult = calculateTrend(values);
    const maxIndex = values.indexOf(Math.max(...values));
    const minIndex = values.indexOf(Math.min(...values));
    const recentChange = changeFor(
      values[values.length - 1],
      values[values.length - 2],
    );
    const analysis: TimeSeriesAnalysis = {
      trend: trendResult.trend,
      trendDescription: getTrendDescription(trendResult.trend),
      averageGrowthRate:
        trendResult.averageGrowthRate === null
          ? null
          : Math.round(trendResult.averageGrowthRate * 100) / 100,
      volatility:
        trendResult.volatility === null
          ? null
          : Math.round(trendResult.volatility * 100) / 100,
      maxValue: {
        period: formatPeriod(periods[maxIndex], input.periodType),
        value: values[maxIndex],
        formatted: String(orderedRows[maxIndex].raw.DT),
      },
      minValue: {
        period: formatPeriod(periods[minIndex], input.periodType),
        value: values[minIndex],
        formatted: String(orderedRows[minIndex].raw.DT),
      },
      recentChange,
      explanation: trendResult.explanation,
    };
    if (trendResult.trend === "increasing") {
      analysis.forecast =
        retrieval.validationLevel === "verified"
          ? "현재 추세가 지속된다면 향후 지속적인 증가가 예상됩니다."
          : "반환된 관측 범위의 추세가 이어진다면 향후 증가가 예상됩니다.";
    } else if (trendResult.trend === "decreasing") {
      analysis.forecast =
        retrieval.validationLevel === "verified"
          ? "현재 추세가 지속된다면 향후 지속적인 감소가 예상됩니다."
          : "반환된 관측 범위의 추세가 이어진다면 향후 감소가 예상됩니다.";
    }

    const interpretation = [
      `**추세**: ${analysis.trendDescription}`,
      `**평균 성장률**: ${analysis.averageGrowthRate === null ? "산출 불가(0 기준 변화율 포함)" : `${analysis.averageGrowthRate > 0 ? "+" : ""}${analysis.averageGrowthRate}%`}`,
      `**최고점**: ${analysis.maxValue.period} (${analysis.maxValue.formatted})`,
      `**최저점**: ${analysis.minValue.period} (${analysis.minValue.formatted})`,
      `**${retrieval.validationLevel === "verified" ? "최근 변화" : "관측된 마지막 변화"}**: ${analysis.recentChange.formatted}`,
    ];
    if (retrieval.validationLevel !== "verified") {
      interpretation.push(
        `**검증 수준**: ${retrieval.validationLevel} — 반환된 관측을 분석하며 공급자 전체성·최신성은 입증하지 않았습니다.`,
      );
    }
    if (analysis.explanation)
      interpretation.push(`**산출 한계**: ${analysis.explanation}`);
    if (analysis.volatility !== null && analysis.volatility > 20)
      interpretation.push(
        `**주의**: 변동성이 높습니다 (${analysis.volatility.toFixed(1)}%). 데이터 해석에 주의가 필요합니다.`,
      );
    if (analysis.forecast)
      interpretation.push(`**전망**: ${analysis.forecast}`);

    return {
      success: true,
      validationLevel: retrieval.validationLevel,
      tableName: text(orderedRows[0].raw.TBL_NM),
      unit: text(orderedRows[0].raw.UNIT_NM),
      analysis,
      dataPoints: orderedRows.map((row) => ({
        period: formatPeriod(text(row.raw.PRD_DE), input.periodType),
        value: parseObservedNumber(row.raw.DT),
        rawValue:
          row.raw.DT === undefined || row.raw.DT === null
            ? undefined
            : String(row.raw.DT),
        raw: row.raw,
      })),
      provenance: buildStatisticsProvenance(
        { ...input, recentCount: input.yearCount },
        orderedRows,
        {
          queriedAt,
          readAt: new Date().toISOString(),
          calculated: true,
          appliedCalculations: [
            "Values were parsed from provider DT without missing-to-zero coercion.",
            "Trend is classified from adjacent signed differences: increasing, decreasing, stable, or fluctuating.",
            "Each rate is (current - previous) / abs(previous) * 100; zero baselines make rate, average growth, and volatility undefined.",
            "Average growth rate is the arithmetic mean of defined adjacent rates, rounded to two decimal places.",
            "Max/min are selected from observed values; periods are formatted as requested Y/M/Q labels.",
          ],
          calculationPolicies: [
            "A zero baseline never becomes a numeric percentage rate.",
            "No missing observation is reallocated or rescaled.",
            "Published provider boundaries are preserved.",
          ],
        },
      ),
      interpretation,
    };
  } catch (error) {
    const handled = handleToolError(error);
    const errorCode =
      handled.code === "UNKNOWN_ERROR" ? "response_incomplete" : handled.code;
    return failedResult(
      input,
      `시계열 분석 중 오류가 발생했습니다: ${handled.error}`,
      [],
      "unverified",
      errorCode,
      queriedAt,
    );
  }
}
