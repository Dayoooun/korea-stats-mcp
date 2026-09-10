/**
 * 빠른 추세 분석 도구
 * 자연어 키워드로 시계열 추세를 간편하게 분석
 */

import { z } from "zod";
import { getKosisClient } from "../api/client.js";
import { getCacheManager } from "../cache/index.js";
import { normalizeStatisticsPeriodType } from "../utils/dataFormatter.js";
import {
  QUICK_STATS_PARAMS,
  getQuickStatsParam,
  type QuickStatsParam,
} from "../data/quickStatsParams.js";
import {
  parseObservedNumber,
  resolveRegion,
  validateRegionRows,
  validateRequestedRows,
  type RegionResolution,
  type TableDiscovery,
} from "../utils/regionResolver.js";
import { handleToolError } from "../utils/errorHandler.js";

export const quickTrendSchema = {
  name: "quick_trend",
  description: `【추세/변화/증감 질문 → 이 도구 사용】 시계열 추세를 분석합니다.

■ 사용 시점: "~추세", "~변화", "~감소", "~증가", "~추이", "~경향" 등 시간에 따른 변화 질문
■ 반환 형식: 연간 관측과 근거가 충분한 경우의 증감률·추세 요약. 시군구 대체 출생아수는 주석과 원관측을 보존하고 파생 추세를 보류합니다.

⚠️ 핵심 키워드만 추출하세요:
• "인구감소 추세" → keyword: "인구"
• "출산율 감소 원인" → keyword: "출산율"
• "실업률 변화" → keyword: "실업률"
• "고령화 추세" → keyword: "고령인구" 또는 "노령화지수"`,
  inputSchema: z.object({
    keyword: z
      .string()
      .describe(
        '통계 키워드만 입력 (추세/감소/증가/변화 등 수식어 제외). 예: "인구", "출산율", "실업률", "GDP", "고령인구"',
      ),
    region: z
      .string()
      .optional()
      .describe('지역명 (선택, 미지정시 전국). 예: "서울", "부산"'),
    yearCount: z
      .number()
      .int()
      .min(2)
      .max(20)
      .optional()
      .describe("분석 기간 (년 수, 기본: 10)"),
    startYear: z
      .number()
      .int()
      .min(1000)
      .max(9999)
      .optional()
      .describe("분석 시작 연도(종료 연도와 함께 입력)"),
    endYear: z
      .number()
      .int()
      .min(1000)
      .max(9999)
      .optional()
      .describe("분석 종료 연도(2~20개 연속 연도)"),
  }),
};

export type QuickTrendInput = z.infer<typeof quickTrendSchema.inputSchema>;

interface TrendDataPoint {
  year: string;
  value: number | null;
  formatted: string;
  absoluteChange?: number;
  changeRate?: string;
  rawValue?: string;
}
type QuickTrendRow = Record<string, unknown>;

interface SeriesValidation {
  ok: boolean;
  reason?: string;
}
type NumericTrendPoint = Omit<TrendDataPoint, "value"> & { value: number };
interface UnitInfo {
  unit?: string;
  hasMissing: boolean;
  ambiguous: boolean;
}
interface LocalTrendAnalysis {
  trend: QuickTrendResult["trend"];
  avgGrowthRate?: number;
  volatility?: number;
  hasUndefinedRate: boolean;
}

interface QuickTrendResult {
  success: boolean;
  keyword: string;
  region: string;
  trend: "increasing" | "decreasing" | "stable" | "fluctuating" | "deferred";
  trendDescription: string;
  summary: string;
  dataPoints: TrendDataPoint[];
  insights: string[];
  source?: {
    orgId: string;
    tableId: string;
    tableName: string;
    periodType?: string;
    regionCode?: string;
    unit?: string;
  };
  validationLevel?: "verified" | "partial" | "unverified";
  tableDiscovery?: TableDiscovery;
  caveats?: string[];
  note?: string;
  error?: string;
  code?: string;
}

export async function quickTrend(
  input: QuickTrendInput,
): Promise<QuickTrendResult> {
  const client = getKosisClient();
  const cache = getCacheManager();

  try {
    input = quickTrendSchema.inputSchema.parse(input);
    const hasRange =
      input.startYear !== undefined || input.endYear !== undefined;
    const requestedCount = (input.endYear ?? 0) - (input.startYear ?? 0) + 1;
    if (
      hasRange &&
      (input.startYear === undefined ||
        input.endYear === undefined ||
        requestedCount < 2 ||
        requestedCount > 20 ||
        (input.yearCount !== undefined && input.yearCount !== requestedCount))
    ) {
      return {
        success: false,
        keyword: input.keyword,
        region: input.region ?? "전국",
        trend: "deferred",
        trendDescription: "",
        summary:
          "시작·종료 연도는 2~20개 연속 연도를 지정해야 하며 yearCount와 모순되면 안 됩니다.",
        dataPoints: [],
        insights: [],
        validationLevel: "unverified",
      };
    }
    // 1. 키워드에서 파라미터 조회
    const param = getQuickStatsParam(input.keyword);

    if (!param) {
      const supportedKeywords = Object.keys(QUICK_STATS_PARAMS).join(", ");
      return {
        success: false,
        keyword: input.keyword,
        region: "전국",
        trend: "stable",
        trendDescription: "",
        summary: `"${input.keyword}"에 대한 추세 분석이 지원되지 않습니다.`,
        dataPoints: [],
        insights: [],
        note: `지원 키워드: ${supportedKeywords}`,
      };
    }

    // 2. 지역 결정은 공식 ITM 메타데이터와 실제 Cn_OBJ_NM 표본으로 검증한다.
    const resolution: RegionResolution = input.region
      ? await resolveRegion(param, input.region, {
          requestedPeriod: "Y",
          ...(input.startYear !== undefined || input.endYear !== undefined
            ? {
                requestedStartPeriod: String(input.startYear ?? input.endYear),
                requestedEndPeriod: String(input.endYear ?? input.startYear),
              }
            : {}),
        })
      : { status: "none", dimensions: undefined };
    const selectedParam = resolution.selectedParam ?? param;
    let regionName = "전국";
    let dimensions: Record<string, string | undefined> = {};
    for (let axis = 1; axis <= 8; axis += 1) {
      dimensions[`objL${axis}`] = selectedParam[
        `objL${axis}` as keyof typeof selectedParam
      ] as string | undefined;
    }
    if (resolution.status !== "none") {
      if (resolution.status !== "resolved") {
        return {
          success: false,
          keyword: input.keyword,
          region: input.region ?? "전국",
          trend: "stable",
          trendDescription: "",
          summary: "지역을 공식 메타데이터로 확인하지 못했습니다.",
          dataPoints: [],
          insights: [],
          validationLevel: "unverified",
          note: `${resolution.reason ?? "지역 코드가 검증되지 않았습니다."}\n검색 경로:\n${(resolution.searchPath ?? []).join("\n")}\n${resolution.clarification ?? ""}`.trim(),
          ...(resolution.tableDiscovery
            ? { tableDiscovery: resolution.tableDiscovery }
            : {}),
        };
      }
      regionName = resolution.regionName ?? input.region ?? "전국";
      dimensions = resolution.dimensions ?? dimensions;
    }

    // 3. 시계열 데이터 조회
    const yearCount = input.yearCount ?? 10;
    const startPeriod =
      input.startYear !== undefined || input.endYear !== undefined
        ? String(input.startYear ?? input.endYear)
        : undefined;
    const endPeriod =
      input.endYear !== undefined ? String(input.endYear) : startPeriod;
    const results = await cache.getStatisticsData(
      {
        queryIdentityVersion: "region-v1",
        orgId: selectedParam.orgId,
        tableId: selectedParam.tableId,
        ...dimensions,
        itemId: selectedParam.itemId,
        periodType: "Y",
        yearCount: startPeriod ? undefined : yearCount,
        ...(startPeriod ? { startYear: startPeriod, endYear: endPeriod } : {}),
      },
      async () => {
        return client.getStatisticsData({
          orgId: selectedParam.orgId,
          tblId: selectedParam.tableId,
          ...dimensions,
          itmId: selectedParam.itemId,
          prdSe: "Y",
          newEstPrdCnt: startPeriod ? undefined : yearCount,
          ...(startPeriod
            ? { startPrdDe: startPeriod, endPrdDe: endPeriod }
            : {}),
        });
      },
    );

    // 4. 데이터 정렬 및 분석
    const responseRows = results as unknown as QuickTrendRow[];
    const requestedValidation = validateRequestedRows(
      responseRows,
      selectedParam,
      dimensions,
      "Y",
    );
    if (!requestedValidation.ok) {
      return {
        success: false,
        keyword: input.keyword,
        region: regionName,
        trend: "stable",
        trendDescription: "",
        summary: "실제 응답이 요청과 일치하지 않아 추세를 계산하지 않았습니다.",
        dataPoints: [],
        insights: [],
        validationLevel: "unverified",
        note: requestedValidation.reason,
        ...(resolution.tableDiscovery
          ? { tableDiscovery: resolution.tableDiscovery }
          : {}),
        ...(resolution.caveats ? { caveats: resolution.caveats } : {}),
      };
    }
    if (resolution.status === "resolved") {
      const validation = validateRegionRows(
        responseRows,
        selectedParam,
        resolution,
        "Y",
      );
      if (!validation.ok) {
        return {
          success: false,
          keyword: input.keyword,
          region: regionName,
          trend: "stable",
          trendDescription: "",
          summary:
            "실제 응답이 요청 지역과 일치하지 않아 추세를 계산하지 않았습니다.",
          dataPoints: [],
          insights: [],
          validationLevel: "unverified",
          note: validation.reason,
          ...(resolution.tableDiscovery
            ? { tableDiscovery: resolution.tableDiscovery }
            : {}),
          ...(resolution.caveats ? { caveats: resolution.caveats } : {}),
        };
      }
    }
    const seriesValidation = validateAnnualSeriesRows(
      responseRows,
      selectedParam,
      dimensions,
      startPeriod && endPeriod
        ? { start: Number(startPeriod), end: Number(endPeriod) }
        : undefined,
    );
    const rawDataPoints = rawTrendDataPoints(responseRows);
    if (!seriesValidation.ok) {
      return {
        success: false,
        keyword: input.keyword,
        region: regionName,
        trend: "stable",
        trendDescription: "",
        summary: "연간 시계열이 완전하지 않아 추세를 계산하지 않았습니다.",
        dataPoints: rawDataPoints,
        insights: [],
        validationLevel: "unverified",
        note: `${seriesValidation.reason}\n원본 관측: ${formatRawTrendRows(responseRows)}`,
        ...(resolution.tableDiscovery
          ? { tableDiscovery: resolution.tableDiscovery }
          : {}),
        ...(resolution.caveats ? { caveats: resolution.caveats } : {}),
      };
    }

    const unitInfo = getObservedUnit(responseRows);
    if (unitInfo.ambiguous) {
      return {
        success: false,
        keyword: input.keyword,
        region: regionName,
        trend: "stable",
        trendDescription: "",
        summary:
          "여러 단위 또는 미확정 단위가 한 추세 응답에 섞여 있어 계산하지 않았습니다.",
        dataPoints: rawDataPoints,
        insights: [],
        validationLevel: "unverified",
        note: "UNIT_NM이 서로 다르거나 일부 행에만 있어 단위를 확정할 수 없습니다.",
        ...(resolution.tableDiscovery
          ? { tableDiscovery: resolution.tableDiscovery }
          : {}),
        ...(resolution.caveats ? { caveats: resolution.caveats } : {}),
      };
    }
    if (resolution.selectedParam) {
      return {
        success: true,
        keyword: input.keyword,
        region: regionName,
        trend: "deferred",
        trendDescription:
          "경계·잠정성 근거가 충분하지 않아 추세 판정을 보류했습니다.",
        summary:
          `${regionName}의 ${selectedParam.description} 연간 관측값을 검증했지만 ` +
          "시군구 코드 재부호화와 잠정치 반올림 caveat로 파생 추세/변화율은 계산하지 않았습니다.",
        dataPoints: rawDataPoints,
        insights: [],
        validationLevel: "partial",
        ...(resolution.caveats ? { caveats: resolution.caveats } : {}),
        ...(resolution.tableDiscovery
          ? { tableDiscovery: resolution.tableDiscovery }
          : {}),
        source: {
          orgId: selectedParam.orgId,
          tableId: selectedParam.tableId,
          tableName: selectedParam.tableName,
          periodType: "Y",
          regionCode: resolution.regionCode,
        },
      };
    }

    const sortedData: NumericTrendPoint[] = responseRows
      .map((row) => ({
        year: rowText(row.PRD_DE),
        value: parseObservedNumber(row.DT) as number,
        formatted: rowText(row.DT),
        rawValue:
          row.DT === undefined || row.DT === null ? undefined : String(row.DT),
      }))
      .sort((a, b) => Number(a.year) - Number(b.year));
    if (sortedData.length < 2) {
      return {
        success: false,
        keyword: input.keyword,
        region: regionName,
        trend: "stable",
        trendDescription: "",
        summary: "추세 분석에 필요한 충분한 데이터가 없습니다.",
        dataPoints: rawDataPoints,
        insights: [],
        validationLevel: unitInfo.unit ? "verified" : "partial",
        note: "연속된 연간 관측값이 두 개 이상 필요합니다.",
      };
    }

    const values = sortedData.map((d) => d.value);
    const analysis = analyzeTrendLocally(values);
    const { avgGrowthRate, volatility } = analysis;

    // 변화율은 이전 값이 0이면 정의하지 않고 절대 변화만 제공한다.
    const dataPoints: TrendDataPoint[] = sortedData.map((d, index) => {
      if (index === 0) return { ...d };
      const previous = sortedData[index - 1].value;
      const absoluteChange = d.value - previous;
      if (previous === 0) {
        return { ...d, absoluteChange, changeRate: "N/A" };
      }
      const rate = (absoluteChange / Math.abs(previous)) * 100;
      return {
        ...d,
        absoluteChange,
        changeRate: `${rate >= 0 ? "+" : ""}${rate.toFixed(1)}%`,
      };
    });

    const trendDescriptions: Record<string, string> = {
      increasing: analysis.hasUndefinedRate
        ? "관측값 기준 상승 흐름 (일부 변화율 N/A)"
        : "지속적인 상승 추세",
      decreasing: analysis.hasUndefinedRate
        ? "관측값 기준 하락 흐름 (일부 변화율 N/A)"
        : "지속적인 하락 추세",
      stable: "안정적인 흐름",
      fluctuating: analysis.hasUndefinedRate
        ? "상승·하락이 혼재하는 변동 흐름 (일부 변화율 N/A)"
        : "변동이 큰 불안정한 흐름",
    };

    const maxIdx = values.indexOf(Math.max(...values));
    const minIdx = values.indexOf(Math.min(...values));
    const firstValue = values[0];
    const lastValue = values[values.length - 1];
    const totalAbsoluteChange = lastValue - firstValue;
    const totalRate =
      firstValue === 0
        ? undefined
        : (totalAbsoluteChange / Math.abs(firstValue)) * 100;
    const totalRateText =
      totalRate === undefined
        ? "N/A"
        : `${totalRate >= 0 ? "+" : ""}${totalRate.toFixed(1)}%`;
    const unitSuffix = unitInfo.unit ? unitInfo.unit : " (단위 미상)";
    const averageRateText =
      avgGrowthRate === undefined
        ? analysis.hasUndefinedRate
          ? "N/A (0 기준 구간 포함)"
          : "N/A"
        : `${avgGrowthRate >= 0 ? "+" : ""}${avgGrowthRate.toFixed(1)}%/년`;
    const totalDirection =
      totalAbsoluteChange > 0
        ? "증가"
        : totalAbsoluteChange < 0
          ? "감소"
          : "변화가 없습니다";
    const directionSentence =
      totalAbsoluteChange === 0
        ? "변화가 없습니다."
        : `${totalDirection}했습니다`;

    const insights: string[] = [];
    const trendEmoji =
      analysis.trend === "increasing"
        ? "📈"
        : analysis.trend === "decreasing"
          ? "📉"
          : "📊";
    insights.push(
      `${trendEmoji} **추세**: ${trendDescriptions[analysis.trend]}`,
    );
    insights.push(`📊 **평균 변화율**: ${averageRateText}`);
    insights.push(
      `🔝 **최고점**: ${sortedData[maxIdx].year}년 (${sortedData[maxIdx].formatted}${unitSuffix})`,
    );
    insights.push(
      `🔻 **최저점**: ${sortedData[minIdx].year}년 (${sortedData[minIdx].formatted}${unitSuffix})`,
    );
    insights.push(
      `📅 **전체 변화**: ${sortedData[0].year}→${sortedData[sortedData.length - 1].year}년, ` +
        `절대 변화 ${formatSignedNumber(totalAbsoluteChange)}${unitSuffix}, 변화율 ${totalRateText}`,
    );

    if (volatility !== undefined && volatility > 20) {
      insights.push(
        `⚠️ **주의**: 변동성이 높습니다 (${volatility.toFixed(1)}%)`,
      );
    }

    const summary =
      `${regionName}의 ${selectedParam.description} ${sortedData.length}개 연간 관측: ` +
      `${trendDescriptions[analysis.trend]}입니다. ` +
      `${sortedData[0].year}년 ${sortedData[0].formatted}${unitSuffix}에서 ` +
      `${sortedData[sortedData.length - 1].year}년 ${sortedData[sortedData.length - 1].formatted}${unitSuffix}로 ` +
      `${directionSentence} (절대 변화 ${formatSignedNumber(totalAbsoluteChange)}${unitSuffix}; ` +
      `변화율 ${totalRateText}).\n\n` +
      `📊 출처: ${selectedParam.tableName} (KOSIS)`;

    return {
      success: true,
      keyword: input.keyword,
      region: regionName,
      trend: analysis.trend,
      trendDescription: trendDescriptions[analysis.trend],
      summary,
      dataPoints,
      insights,
      source: {
        orgId: selectedParam.orgId,
        tableId: selectedParam.tableId,
        tableName: selectedParam.tableName,
        periodType: "Y",
        regionCode: resolution.regionCode,
        ...(unitInfo.unit ? { unit: unitInfo.unit } : {}),
      },
      validationLevel: unitInfo.unit ? "verified" : "partial",
      ...(resolution.caveats ? { caveats: resolution.caveats } : {}),
      ...(resolution.tableDiscovery
        ? { tableDiscovery: resolution.tableDiscovery }
        : {}),
    };
  } catch (error) {
    const safeError = handleToolError(error);
    let keyword = "알 수 없음";
    let region = "전국";
    try {
      if (input && typeof input === "object") {
        const inputKeyword = (input as { keyword?: unknown }).keyword;
        const inputRegion = (input as { region?: unknown }).region;
        if (typeof inputKeyword === "string") keyword = inputKeyword;
        if (typeof inputRegion === "string") region = inputRegion;
      }
    } catch {
      // Hostile input getters must not escape the error boundary.
    }
    return {
      keyword,
      region,
      trend: "deferred",
      trendDescription: "",
      summary: `추세 분석 중 오류가 발생했습니다: ${safeError.error}`,
      dataPoints: [],
      insights: [],
      validationLevel: "unverified",
      note: `analyze_time_series를 직접 사용해보세요.`,
      ...safeError,
    };
  }
}
function rowText(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function categoryKey(row: QuickTrendRow): string {
  return Array.from({ length: 8 }, (_, index) => {
    const axis = index + 1;
    return rowText(row[`C${axis}`]) || `<missing-C${axis}>`;
  }).join("|");
}

function isUnknownUnit(unit: string): boolean {
  return /^(?:unknown|n\/?a|na|null|미상|단위\s*미상|알\s*수\s*없음|-|…|\.\.\.)$/iu.test(
    unit,
  );
}

function getObservedUnit(rows: QuickTrendRow[]): UnitInfo {
  const units = new Set<string>();
  let hasMissing = false;
  for (const row of rows) {
    const unit = rowText(row.UNIT_NM);
    if (!unit || isUnknownUnit(unit)) {
      hasMissing = true;
    } else {
      units.add(unit);
    }
  }
  return {
    unit: units.size === 1 && !hasMissing ? [...units][0] : undefined,
    hasMissing,
    ambiguous: units.size > 1 || (units.size > 0 && hasMissing),
  };
}

function validateAnnualSeriesRows(
  rows: QuickTrendRow[],
  param: QuickStatsParam,
  dimensions: Record<string, string | undefined>,
  range?: { start: number; end: number },
): SeriesValidation {
  if (rows.length < 2) {
    return { ok: false, reason: "연속된 연간 관측값이 두 개 이상 필요합니다." };
  }

  const categories = new Set<string>();
  const periods = new Set<number>();
  for (const row of rows) {
    if (
      rowText(row.ORG_ID) !== param.orgId ||
      rowText(row.TBL_ID) !== param.tableId
    ) {
      return { ok: false, reason: "응답 표 식별자가 요청과 다릅니다." };
    }
    if (normalizeStatisticsPeriodType(rowText(row.PRD_SE)) !== "Y") {
      return { ok: false, reason: "응답 주기가 연간(Y)이 아닙니다." };
    }
    if (rowText(row.ITM_ID) !== param.itemId) {
      return {
        ok: false,
        reason: "응답 항목 식별자가 없거나 요청과 다릅니다.",
      };
    }

    const period = rowText(row.PRD_DE);
    if (!/^\d{4}$/u.test(period)) {
      return {
        ok: false,
        reason: `연간 시점(${period || "없음"})을 확인할 수 없습니다.`,
      };
    }
    const year = Number(period);
    if (periods.has(year)) {
      return {
        ok: false,
        reason: `동일한 연도(${period})의 중복 관측이 있어 한 연간 시계열을 확정할 수 없습니다.`,
      };
    }
    periods.add(year);

    for (let axis = 1; axis <= 8; axis += 1) {
      const expected = dimensions[`objL${axis}`];
      if (expected === undefined) continue;
      const observed = rowText(row[`C${axis}`]);
      if (!observed || (expected !== "*" && observed !== expected)) {
        return {
          ok: false,
          reason: `C${axis} 응답 분류값이 요청 선택과 다릅니다.`,
        };
      }
    }

    if (parseObservedNumber(row.DT) === null) {
      return {
        ok: false,
        reason: `${period}년 DT가 결측 또는 숫자가 아니어서 연간 시계열이 불완전합니다.`,
      };
    }
    categories.add(categoryKey(row));
  }

  if (categories.size > 1) {
    return {
      ok: false,
      reason: "여러 분류가 한 연간 시계열 응답에 섞였습니다.",
    };
  }

  const years = [...periods].sort((left, right) => left - right);
  if (
    range &&
    (years[0] !== range.start || years[years.length - 1] !== range.end)
  ) {
    return {
      ok: false,
      reason: "응답 연도 범위가 요청 시작·종료 연도와 다릅니다.",
    };
  }
  for (let index = 1; index < years.length; index += 1) {
    if (years[index] - years[index - 1] !== 1) {
      return {
        ok: false,
        reason: `연간 시점이 이어지지 않습니다(${years[index - 1]}년 다음 ${years[index]}년). 누락 연도를 0으로 보정하지 않았습니다.`,
      };
    }
  }
  return { ok: true };
}

function rawTrendDataPoints(rows: QuickTrendRow[]): TrendDataPoint[] {
  return rows
    .map((row) => ({
      year: rowText(row.PRD_DE),
      value: parseObservedNumber(row.DT),
      formatted: row.DT === undefined || row.DT === null ? "" : String(row.DT),
      rawValue:
        row.DT === undefined || row.DT === null ? undefined : String(row.DT),
    }))
    .sort((left, right) => left.year.localeCompare(right.year));
}

function formatRawTrendRows(rows: QuickTrendRow[]): string {
  return rows
    .map(
      (row) =>
        `${rowText(row.PRD_DE) || "?"}=${row.DT === undefined || row.DT === null ? "" : String(row.DT)}`,
    )
    .join(", ");
}

function formatSignedNumber(value: number): string {
  const formatted = value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  return value > 0 ? `+${formatted}` : formatted;
}
function analyzeTrendLocally(values: number[]): LocalTrendAnalysis {
  const rates: number[] = [];
  let hasIncrease = false;
  let hasDecrease = false;
  let hasUndefinedRate = false;

  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    const absoluteChange = current - previous;
    if (absoluteChange > 0) hasIncrease = true;
    if (absoluteChange < 0) hasDecrease = true;

    if (previous === 0) {
      hasUndefinedRate = true;
    } else {
      rates.push((absoluteChange / Math.abs(previous)) * 100);
    }
  }

  const trend: QuickTrendResult["trend"] =
    hasIncrease && hasDecrease
      ? "fluctuating"
      : hasIncrease
        ? "increasing"
        : hasDecrease
          ? "decreasing"
          : "stable";
  const completeRateEvidence =
    !hasUndefinedRate && rates.length === Math.max(0, values.length - 1);
  if (!completeRateEvidence || rates.length === 0) {
    return {
      trend,
      hasUndefinedRate,
      avgGrowthRate: undefined,
      volatility: undefined,
    };
  }

  const avgGrowthRate =
    rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  const variance =
    rates.reduce((sum, rate) => sum + Math.pow(rate - avgGrowthRate, 2), 0) /
    rates.length;
  return {
    trend,
    hasUndefinedRate,
    avgGrowthRate,
    volatility: Math.sqrt(variance),
  };
}
