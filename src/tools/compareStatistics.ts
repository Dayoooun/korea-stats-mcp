/**
 * 통계 비교 도구
 * 여러 지역 또는 시점의 통계를 비교
 */

import { z } from "zod";
import { parseStatisticsPeriod } from "./getStatisticsData.js";
import {
  ANALYSIS_MAX_ERROR_ROWS,
  collectStatisticsPages,
  createStatisticsCollectionBudget,
} from "./statisticsRetrieval.js";
import type { SimplifiedDataItem, StatisticsDataItem } from "../api/types.js";
import {
  comparePeriods,
  formatPeriod,
  normalizeStatisticsPeriodType,
} from "../utils/dataFormatter.js";
import { buildStatisticsProvenance } from "../utils/statisticsProvenance.js";
import { parseObservedNumber } from "../utils/regionResolver.js";
import { handleToolError } from "../utils/errorHandler.js";

export const compareStatisticsSchema = {
  name: "compare_statistics",
  description: "여러 지역, 시점, 또는 항목의 통계 데이터를 비교합니다.",
  inputSchema: z.object({
    orgId: z.string().describe("기관 ID"),
    tableId: z.string().describe("통계표 ID"),
    compareType: z
      .enum(["period", "item"])
      .describe("비교 유형: period(시점 비교), item(항목 비교)"),
    periodType: z.enum(["Y", "M", "Q"]).describe("주기: Y(년), M(월), Q(분기)"),
    periods: z
      .array(z.string())
      .optional()
      .describe('비교할 시점들 (예: ["2022", "2023", "2024"])'),
    objL1: z.string().optional().describe("분류1 코드"),
    objL2: z.string().optional().describe("분류2 코드"),
    objL3: z.string().optional().describe("분류3 코드"),
    objL4: z.string().optional().describe("분류4 코드"),
    objL5: z.string().optional().describe("분류5 코드"),
    objL6: z.string().optional().describe("분류6 코드"),
    objL7: z.string().optional().describe("분류7 코드"),
    objL8: z.string().optional().describe("분류8 코드"),
    itemId: z.string().optional().describe("항목 ID"),
  }),
};

export type CompareStatisticsInput = z.infer<
  typeof compareStatisticsSchema.inputSchema
>;
type ValidationLevel = "verified" | "partial" | "unverified";
type RawRow = StatisticsDataItem;

interface ComparisonChange {
  rate: number | null;
  direction: "up" | "down" | "stable";
  formatted: string;
  absolute: number;
  explanation?: string;
}

interface ComparisonItem {
  name: string;
  /** Provider classification label; it is not assumed to be a geographic region. */
  classification?: Array<{ axis: number; code?: string; name?: string }>;
  region?: string;
  itemName?: string;
  itemId?: string;
  period?: string;
  value: number | null;
  rawValue?: string;
  formattedValue: string;
  unit?: string;
  rank?: number;
  change?: ComparisonChange;
  raw?: RawRow;
}

type Retrieval = {
  rows: SimplifiedDataItem[];
  validationLevel: ValidationLevel;
  errorCode?: string;
  message?: string;
};

type RowValidation = {
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

function selectorValues(
  input: CompareStatisticsInput,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [
      `objL${index + 1}`,
      input[`objL${index + 1}` as keyof CompareStatisticsInput] as
        string | undefined,
    ]),
  );
}

async function retrieveRows(input: CompareStatisticsInput): Promise<Retrieval> {
  const dimensions = selectorValues(input);
  const objL1 = dimensions.objL1 ?? "ALL";
  const itemId = input.itemId ?? "ALL";
  const requestedPeriods =
    input.compareType === "period" ? input.periods : undefined;
  const rows: SimplifiedDataItem[] = [];
  let validationLevel: ValidationLevel = "verified";

  const budget = createStatisticsCollectionBudget();
  const queryCount = requestedPeriods?.length || 1;
  for (let index = 0; index < queryCount; index += 1) {
    const query = requestedPeriods?.length
      ? {
          startPeriod: requestedPeriods[index],
          endPeriod: requestedPeriods[index],
        }
      : { recentCount: input.compareType === "period" ? 2 : 1 };
    const result = await collectStatisticsPages(
      {
        orgId: input.orgId,
        tableId: input.tableId,
        ...dimensions,
        objL1,
        itemId,
        periodType: input.periodType,
        ...query,
      },
      budget,
    );
    if (result.validationLevel === "unverified") validationLevel = "unverified";
    else if (
      result.validationLevel === "partial" &&
      validationLevel !== "unverified"
    )
      validationLevel = "partial";
    if (!result.success) {
      return {
        rows: [...rows, ...result.rows].slice(0, ANALYSIS_MAX_ERROR_ROWS),
        validationLevel: "unverified",
        errorCode: result.errorCode ?? "response_incomplete",
        message: result.message ?? "검증된 통계 응답을 받지 못했습니다.",
      };
    }
    rows.push(...result.rows);
  }

  return { rows, validationLevel };
}

function classificationKey(raw: RawRow): string {
  return Array.from({ length: 8 }, (_, index) => {
    const axis = index + 1;
    return `${text(raw[`C${axis}` as keyof RawRow]) ?? ""}\u0000${text(raw[`C${axis}_NM` as keyof RawRow]) ?? ""}`;
  }).join("\u0001");
}

function classification(
  raw: RawRow,
): Array<{ axis: number; code?: string; name?: string }> {
  return Array.from({ length: 8 }, (_, index) => {
    const axis = index + 1;
    const code = text(raw[`C${axis}` as keyof RawRow]);
    const name = text(raw[`C${axis}_NM` as keyof RawRow]);
    return { axis, code, name };
  }).filter((entry) => entry.code !== undefined || entry.name !== undefined);
}

function periodStep(periodType: "Y" | "M" | "Q"): number {
  return periodType === "Y" ? 1 : periodType === "M" ? 1 : 1;
}

function validateRows(
  input: CompareStatisticsInput,
  rows: SimplifiedDataItem[],
  requestedPeriods: string[] | undefined,
): RowValidation {
  if (rows.length === 0) {
    return { ok: false, message: "비교할 검증된 관측값이 없습니다.", rows };
  }

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
    if (!period || parseStatisticsPeriod(period, input.periodType) === null) {
      return {
        ok: false,
        message: "응답 시점을 해석할 수 없습니다.",
        errorCode: "response_incomplete",
        rows,
      };
    }
    const item = text(raw.ITM_ID);
    if (!item)
      return { ok: false, message: "응답 항목 식별자가 없습니다.", rows };
    const unit = text(raw.UNIT_NM);
    if (!unit)
      return {
        ok: false,
        message: "응답 단위가 없어 수치를 비교할 수 없습니다.",
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
      const requested = input[`objL${axis}` as keyof CompareStatisticsInput] as
        string | undefined;
      if (value) axisValues[index].add(value);
      else axisMissing[index] = true;
      if (requested && !isOpaqueSelector(requested) && !value) {
        return {
          ok: false,
          message: `C${axis} 응답 분류값 증거가 누락되었습니다.`,
          errorCode: "response_incomplete",
          rows,
        };
      }
      if (requested && !isOpaqueSelector(requested) && value !== requested) {
        return {
          ok: false,
          message: `C${axis} 응답 분류값이 요청과 다릅니다.`,
          errorCode: "response_mismatch",
          rows,
        };
      }
    }

    if (
      input.itemId &&
      !isOpaqueSelector(input.itemId) &&
      item !== input.itemId
    ) {
      return {
        ok: false,
        message: "응답 항목이 요청 항목과 다릅니다.",
        errorCode: "response_mismatch",
        rows,
      };
    }
    if (parseObservedNumber(raw.DT) === null) {
      return {
        ok: false,
        message: `${period} 관측값이 결측 또는 숫자가 아닙니다.`,
        errorCode: "response_incomplete",
        rows,
      };
    }

    categories.add(classificationKey(raw));
    itemIds.add(item);
    periods.add(period);
    units.add(unit);
  }

  if (units.size !== 1)
    return { ok: false, message: "여러 단위가 한 비교에 섞였습니다.", rows };
  if (categories.size !== 1)
    return { ok: false, message: "여러 분류가 한 비교에 섞였습니다.", rows };
  for (let index = 0; index < 8; index += 1) {
    if (
      axisValues[index].size > 1 ||
      (axisValues[index].size > 0 && axisMissing[index])
    ) {
      return {
        ok: false,
        message: `C${index + 1} 분류값이 혼합되었거나 일부 누락되었습니다.`,
        rows,
      };
    }
  }

  if (input.compareType === "period" && itemIds.size !== 1) {
    return { ok: false, message: "시점 비교에 여러 항목이 섞였습니다.", rows };
  }
  if (input.compareType === "item" && periods.size !== 1) {
    return { ok: false, message: "항목 비교에 여러 시점이 섞였습니다.", rows };
  }
  if (input.compareType === "item" && itemIds.size < 2) {
    return {
      ok: false,
      message: "항목 비교에는 서로 다른 항목이 두 개 이상 필요합니다.",
      errorCode: "response_incomplete",
      rows,
    };
  }

  const expected = requestedPeriods
    ? [...new Set(requestedPeriods)]
    : undefined;
  if (expected && expected.length < 2) {
    return {
      ok: false,
      message: "시점 비교에는 서로 다른 시점이 두 개 이상 필요합니다.",
      rows,
    };
  }
  if (expected) {
    if (
      expected.some(
        (period) => parseStatisticsPeriod(period, input.periodType) === null,
      )
    ) {
      return {
        ok: false,
        message: "요청 시점 형식이 주기와 맞지 않습니다.",
        rows,
      };
    }
    if (
      periods.size !== expected.length ||
      expected.some((period) => !periods.has(period))
    ) {
      return {
        ok: false,
        message: "응답에 요청한 시점이 모두 포함되지 않았습니다.",
        rows,
      };
    }
  }
  if (
    input.compareType === "period" &&
    requestedPeriods === undefined &&
    periods.size < 2
  ) {
    return {
      ok: false,
      message:
        "암시적 시점 비교에는 서로 다른 검증된 시점이 두 개 이상 필요합니다.",
      errorCode: "response_incomplete",
      rows,
    };
  }

  const orderedPeriods = [...periods].sort((left, right) =>
    comparePeriods(left, right),
  );
  const indexes = orderedPeriods.map(
    (period) => parseStatisticsPeriod(period, input.periodType) as number,
  );
  for (let index = 1; index < indexes.length; index += 1) {
    if (
      !expected &&
      indexes[index] - indexes[index - 1] !== periodStep(input.periodType)
    ) {
      return {
        ok: false,
        message: "시점이 이어지지 않아 누락 기간을 0으로 보정하지 않았습니다.",
        rows,
      };
    }
  }

  const duplicateKeys = new Set<string>();
  for (const row of rows) {
    const raw = row.raw;
    const period = text(raw.PRD_DE) as string;
    const item = text(raw.ITM_ID) as string;
    const key = `${period}\u0000${input.compareType === "item" ? item : ""}`;
    if (duplicateKeys.has(key)) {
      return {
        ok: false,
        message: `중복 관측(${period})이 있어 비교할 한 시리즈를 확정할 수 없습니다.`,
        rows,
      };
    }
    duplicateKeys.add(key);
  }
  return { ok: true, rows };
}

function formatAbsolute(value: number): string {
  const formatted = value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  return value > 0 ? `+${formatted}` : formatted;
}

function changeFor(current: number, previous: number): ComparisonChange {
  const absolute = current - previous;
  if (previous === 0) {
    const direction = absolute > 0 ? "up" : absolute < 0 ? "down" : "stable";
    return {
      rate: null,
      direction,
      absolute,
      formatted: `${formatAbsolute(absolute)} (기준값 0으로 비율 미정)`,
      explanation: "이전 관측값이 0이어서 백분율 변화율은 정의되지 않습니다.",
    };
  }
  const rate = (absolute / Math.abs(previous)) * 100;
  const direction = rate > 0.1 ? "up" : rate < -0.1 ? "down" : "stable";
  return {
    rate,
    direction,
    absolute,
    formatted: `${rate > 0 ? "+" : ""}${rate.toFixed(1)}%`,
  };
}

function providerRegion(raw: RawRow): string | undefined {
  const axisName = text(raw.C1_OBJ_NM);
  if (!axisName || !/(?:지역|시도|시군구|region)/iu.test(axisName))
    return undefined;
  return text(raw.C1_NM);
}
function itemFromRow(
  row: SimplifiedDataItem,
  compareType: CompareStatisticsInput["compareType"],
): ComparisonItem {
  const raw = row.raw;
  const value = parseObservedNumber(raw.DT);
  const period = text(raw.PRD_DE);
  const itemName = text(raw.ITM_NM);
  const unit = text(raw.UNIT_NM);
  const itemId = text(raw.ITM_ID);
  const labels = classification(raw);
  const name =
    compareType === "period"
      ? period
        ? formatPeriod(period, normalizeStatisticsPeriodType(raw.PRD_SE))
        : "N/A"
      : [...labels.map((entry) => entry.name ?? entry.code), itemName ?? itemId]
          .filter(Boolean)
          .join(" - ") || "N/A";
  const formattedValue =
    raw.DT === undefined || raw.DT === null ? "" : String(raw.DT);
  return {
    name,
    classification: labels,
    region: providerRegion(raw),
    itemName,
    itemId,
    period,
    value,
    rawValue:
      raw.DT === undefined || raw.DT === null ? undefined : String(raw.DT),
    formattedValue,
    unit,
    raw,
  };
}

function failedResult(
  input: CompareStatisticsInput,
  message: string,
  rows: SimplifiedDataItem[],
  level: ValidationLevel = "unverified",
  errorCode: string = "response_incomplete",
  queriedAt: string = new Date().toISOString(),
) {
  const readAt = new Date().toISOString();
  const provenanceInput =
    input.periods && input.periods.length > 0
      ? input
      : { ...input, recentCount: input.compareType === "period" ? 2 : 1 };
  return {
    success: false,
    compareType: input.compareType,
    validationLevel: level,
    errorCode,
    provenance: buildStatisticsProvenance(provenanceInput, rows, {
      queryPeriods: input.compareType === "period" ? input.periods : undefined,
      queriedAt,
      readAt,
      calculated: false,
      calculationPolicies: [
        "No comparison is applied unless provider observations pass validation.",
        "Missing observations are never converted to zero.",
      ],
    }),
    items: rows.map((row) => itemFromRow(row, input.compareType)),
    summary: "검증되지 않은 응답은 비교하지 않았습니다.",
    insights: [
      message,
      rows.length > 0
        ? "반환 가능한 원본 provider 관측값은 items[].raw에 보존되어 있습니다."
        : "검증 실패로 반환할 수 있는 원본 관측값이 없습니다.",
    ],
  };
}

export async function compareStatistics(
  input: CompareStatisticsInput,
): Promise<{
  success: boolean;
  compareType: string;
  validationLevel?: ValidationLevel;
  errorCode?: string;
  items: ComparisonItem[];
  summary: string;
  insights: string[];
  provenance?: ReturnType<typeof buildStatisticsProvenance>;
}> {
  const queriedAt = new Date().toISOString();
  const provenanceInput =
    input.periods && input.periods.length > 0
      ? input
      : { ...input, recentCount: input.compareType === "period" ? 2 : 1 };
  try {
    if (input.compareType === "period" && input.periods) {
      const unique = new Set(input.periods);
      if (unique.size !== input.periods.length) {
        return failedResult(
          input,
          "요청 시점에 중복이 있어 변화율을 계산하지 않았습니다.",
          [],
          "unverified",
          "response_incomplete",
          queriedAt,
        );
      }
    }
    const retrieval = await retrieveRows(input);
    if (retrieval.errorCode) {
      return failedResult(
        input,
        retrieval.message ?? "통계 응답 검증에 실패했습니다.",
        retrieval.rows,
        "unverified",
        retrieval.errorCode,
        queriedAt,
      );
    }
    const validation = validateRows(
      input,
      retrieval.rows,
      input.compareType === "period" ? input.periods : undefined,
    );
    if (!validation.ok)
      return failedResult(
        input,
        validation.message ?? "통계 응답이 불완전합니다.",
        validation.rows,
        "unverified",
        validation.errorCode,
        queriedAt,
      );

    const items = validation.rows.map((row) =>
      itemFromRow(row, input.compareType),
    );
    const sortedItems = [...items].sort(
      (a, b) => (b.value as number) - (a.value as number),
    );
    sortedItems.forEach((item, index) => {
      item.rank = index + 1;
    });

    if (input.compareType === "period") {
      const ordered = [...items].sort((a, b) =>
        comparePeriods(a.period, b.period),
      );
      for (let index = 1; index < ordered.length; index += 1) {
        ordered[index].change = changeFor(
          ordered[index].value as number,
          ordered[index - 1].value as number,
        );
      }
      const first = ordered[0].value as number;
      const last = ordered[ordered.length - 1].value as number;
      const absolute = last - first;
      const total =
        first === 0
          ? `${retrieval.validationLevel === "verified" ? "전체 기간" : "반환된 관측 범위"} 절대 변화: ${formatAbsolute(absolute)} (기준값 0으로 비율 미정)`
          : `${retrieval.validationLevel === "verified" ? "전체 기간" : "반환된 관측 범위"} 변화: ${changeFor(last, first).formatted}`;
      const maxChange = ordered
        .slice(1)
        .filter((item) => item.change)
        .sort(
          (a, b) => Math.abs(b.change!.absolute) - Math.abs(a.change!.absolute),
        )[0];
      const insights = [total];
      if (retrieval.validationLevel !== "verified") {
        insights.unshift(
          `검증 수준: ${retrieval.validationLevel} — 반환된 관측을 비교하며 공급자 전체성·최신성은 입증하지 않았습니다.`,
        );
      }
      if (maxChange?.change)
        insights.push(
          `가장 큰 절대 변화: ${maxChange.name} (${maxChange.change.formatted})`,
        );
      return {
        success: true,
        compareType: input.compareType,
        validationLevel: retrieval.validationLevel,
        items,
        summary:
          retrieval.validationLevel === "verified"
            ? `${ordered[0].name}부터 ${ordered[ordered.length - 1].name}까지의 변화를 비교했습니다.`
            : `반환된 관측 범위(${ordered[0].name}~${ordered[ordered.length - 1].name})의 변화를 비교했습니다.`,
        insights,
        provenance: buildStatisticsProvenance(
          provenanceInput,
          items.map((item) => ({
            raw: item.raw!,
          })),
          {
            queryPeriods: input.periods,
            queriedAt,
            readAt: new Date().toISOString(),
            calculated: true,
            appliedCalculations: [
              "Each adjacent period absolute change is current - previous.",
              "Each adjacent percentage change is (current - previous) / abs(previous) * 100; zero baselines retain null rate and absolute change.",
              "The total comparison uses only the explicitly requested provider periods; it does not infer or fill intermediate periods.",
              "Items are ranked by observed numeric value without rescaling or reallocation.",
            ],
            calculationPolicies: [
              "Zero baselines retain a null percentage and their absolute change.",
              "No missing observation is reallocated or rescaled.",
              "Published provider boundaries are preserved.",
            ],
          },
        ),
      };
    }

    const maxItem = sortedItems[0];
    const minItem = sortedItems[sortedItems.length - 1];
    const difference = (maxItem.value as number) - (minItem.value as number);
    const insights =
      minItem.value === 0
        ? [
            `최대-최소 절대 차이: ${formatAbsolute(difference)} (최솟값 0으로 비율 미정)`,
          ]
        : [
            `최대-최소 차이: ${((difference / Math.abs(minItem.value as number)) * 100).toFixed(1)}%`,
            `최대-최소 절대 차이: ${formatAbsolute(difference)}`,
          ];
    if (retrieval.validationLevel !== "verified") {
      insights.unshift(
        `검증 수준: ${retrieval.validationLevel} — 반환된 관측을 비교하며 공급자 전체성·최신성은 입증하지 않았습니다.`,
      );
    }
    return {
      success: true,
      compareType: input.compareType,
      validationLevel: retrieval.validationLevel,
      items,
      summary: `반환된 ${items.length}개 항목 중 "${maxItem.name}"이(가) 가장 높고, "${minItem.name}"이(가) 가장 낮습니다.`,
      insights,
      provenance: buildStatisticsProvenance(
        provenanceInput,
        items.map((item) => ({
          raw: item.raw!,
        })),
        {
          queriedAt,
          readAt: new Date().toISOString(),
          calculated: true,
          appliedCalculations: [
            "Items are ranked by observed numeric value.",
            "The maximum/minimum difference is max - min; percentage is difference / abs(min) * 100 when the minimum is nonzero.",
            "No rescaling or reallocation was applied.",
          ],
          calculationPolicies: [
            "Zero baselines retain a null percentage and their absolute difference.",
            "No missing observation is reallocated or rescaled.",
            "Published provider boundaries are preserved.",
          ],
        },
      ),
    };
  } catch (error) {
    const handled = handleToolError(error);
    const errorCode =
      handled.code === "UNKNOWN_ERROR" ? "response_incomplete" : handled.code;
    return failedResult(
      input,
      `비교 중 오류가 발생했습니다: ${handled.error}`,
      [],
      "unverified",
      errorCode,
      queriedAt,
    );
  }
}
