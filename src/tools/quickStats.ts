/**
 * 빠른 통계 조회 도구
 * 자연어 질문으로 한 번에 통계 데이터를 조회하고 자연어 응답을 생성
 *
 * 개선: 정적으로 검증된 파라미터 사용 (동적 조회 대신)
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
  resolveRegionFromQuery,
  validateRegionRows,
  validateRequestedRows,
  type RegionResolution,
  type TableDiscovery,
} from "../utils/regionResolver.js";
import { handleToolError } from "../utils/errorHandler.js";

export const quickStatsSchema = {
  name: "quick_stats",
  description: `【수치/데이터 질문 → 이 도구 사용】 한국 통계 수치를 즉시 반환합니다.

■ 사용 시점: "~얼마야?", "~알려줘", "~몇 명이야?", "~수치", "~현황", "~추세", "~감소", "~증가" 등
■ 반환 형식: "2024년 서울의 실업률은 3.2%입니다" 같은 실제 데이터 값
■ 지원 키워드: 인구, 출산율, 실업률, 고용률, GDP, GRDP, 물가, 아파트가격, 전세가격, 미세먼지, 교통사고, 의사수, 범죄율, 초혼연령, 노령화지수, 고령인구 등 90개 이상
■ 지역 조회: 공식 KOSIS 메타데이터가 확인한 시도·시군구·전국 조회

⚠️ 핵심 키워드만 추출하세요:
• "인구감소 추세" → query: "인구" (감소/증가/추세 제외)
• "서울 실업률 현황" → query: "실업률", region: "서울"
• "고령화 문제" → query: "고령인구" 또는 "노령화지수"
• "저출산 현황" → query: "출산율" 또는 "출생아수"`,
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        '통계 키워드만 입력 (감소/증가/추세/현황 등 수식어 제외). 예: "인구", "실업률", "GDP", "출산율", "고령인구"',
      ),
    region: z
      .string()
      .optional()
      .describe(
        '지역명. 예: "서울", "부산", "경기". 질문에 지역이 있으면 추출. "서울 인구" → region: "서울"',
      ),
    year: z
      .number()
      .optional()
      .describe(
        '조회 연도. 질문에 연도가 있으면 반드시 추출. "2020년 GDP" → year: 2020',
      ),
    period: z
      .enum(["Y", "Q", "M"])
      .optional()
      .describe(
        '조회 주기. Y=연간(기본), Q=분기, M=월별. "10월 출생아수" → period: "M"',
      ),
    month: z
      .number()
      .min(1)
      .max(12)
      .optional()
      .describe('월 (period="M"일 때). "10월 출생아수" → month: 10'),
    quarter: z
      .number()
      .min(1)
      .max(4)
      .optional()
      .describe('분기 (period="Q"일 때). "3분기 실업률" → quarter: 3'),
  }),
};

export type QuickStatsInput = z.infer<typeof quickStatsSchema.inputSchema>;

interface QuickStatsResult {
  success: boolean;
  answer: string;
  value?: number | string;
  unit?: string;
  period?: string;
  source?: {
    orgId: string;
    tableId: string;
    tableName: string;
    periodType?: string;
    regionCode?: string;
  };
  validationLevel?: "verified" | "partial" | "unverified";
  tableDiscovery?: TableDiscovery;
  caveats?: string[];
  note?: string;
  error?: string;
  code?: string;
}

type QuickStatsRow = Record<string, unknown>;

interface ScalarValidation {
  ok: boolean;
  reason?: string;
}

interface ObservedUnit {
  unit?: string;
  hasMissing: boolean;
  ambiguous: boolean;
}

export async function quickStats(
  input: QuickStatsInput,
): Promise<QuickStatsResult> {
  const client = getKosisClient();
  const cache = getCacheManager();

  try {
    // 1. 쿼리에서 키워드 추출
    const keyword = extractKeyword(input.query);
    const param = getQuickStatsParam(keyword);

    if (!param) {
      // 매핑이 없으면 카테고리별 지원 키워드 안내
      const keywordGuide = `
📊 지원 키워드 (카테고리별 대표 예시):
• 인구/출산: 인구, 출산율, 출생아수, 사망률, 기대수명
• 고령화: 고령인구, 노인인구, 노령화지수, 65세이상인구
• 고용/노동: 실업률, 고용률, 취업자수, 임금
• 경제: GDP, GRDP, 경제성장률, 물가
• 무역: 수출, 수입, 무역수지
• 혼인/이혼: 혼인율, 이혼율, 초혼연령, 여성초혼연령
• 부동산: 주택가격, 아파트가격, 전세가격
• 교통: 자동차, 교통사고
• 환경: 미세먼지, PM2.5, PM10
• 사회: 범죄율, 의사수, 외래관광객

💡 지역별: 질문의 실제 지역명을 공식 메타데이터로 확인하여 조회합니다.
💡 월별: "2024년 10월 출생아수" (일부 키워드)`.trim();

      return {
        success: false,
        answer: `"${input.query}"에 대한 빠른 조회가 지원되지 않습니다.`,
        note: `${keywordGuide}\n\n🔍 다른 통계는 search_statistics("${input.query}")로 검색해보세요.`,
      };
    }

    // 3. 주기(period) 결정 및 검증은 대체 표 탐색보다 먼저 수행한다.
    const supportedPeriods = param.supportedPeriods || ["Y"];
    const defaultPeriod = supportedPeriods[0];
    const requestedPeriod = input.period || defaultPeriod;
    const periodNames = { Y: "연간", Q: "분기", M: "월별" } as const;
    if (!supportedPeriods.includes(requestedPeriod)) {
      const supportedNames = supportedPeriods
        .map((periodType) => periodNames[periodType])
        .join(", ");
      return {
        success: false,
        answer: `"${input.query}"는 ${periodNames[requestedPeriod]} 조회를 지원하지 않습니다.`,
        note: `지원 주기: ${supportedNames}`,
      };
    }
    // 2. 지역 결정은 공식 ITM 메타데이터와 실제 Cn_OBJ_NM 표본으로 검증한다.
    const resolution: RegionResolution = input.region
      ? await resolveRegion(param, input.region, {
          requestedPeriod,
          ...(requestedPeriod === "Y" && input.year
            ? {
                requestedStartPeriod: String(input.year),
                requestedEndPeriod: String(input.year),
              }
            : {}),
        })
      : await resolveRegionFromQuery(param, input.query, {
          requestedPeriod,
          ...(requestedPeriod === "Y" && input.year
            ? {
                requestedStartPeriod: String(input.year),
                requestedEndPeriod: String(input.year),
              }
            : {}),
        });
    let regionName = "전국";
    const selectedParam = resolution.selectedParam ?? param;
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
          answer: `"${input.query}"의 지역을 공식 메타데이터로 확인하지 못했습니다.`,
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

    // 4. 조회 기간 계산
    let startPrd: string | undefined;
    let endPrd: string | undefined;

    if (input.year) {
      if (requestedPeriod === "Y") {
        startPrd = input.year.toString();
        endPrd = input.year.toString();
      } else if (requestedPeriod === "Q" && input.quarter) {
        const qStr = `${input.year}${input.quarter.toString().padStart(2, "0")}`;
        startPrd = qStr;
        endPrd = qStr;
      } else if (requestedPeriod === "M" && input.month) {
        const mStr = `${input.year}${input.month.toString().padStart(2, "0")}`;
        startPrd = mStr;
        endPrd = mStr;
      } else if (requestedPeriod === "Q") {
        // 해당 연도의 모든 분기
        startPrd = `${input.year}01`;
        endPrd = `${input.year}04`;
      } else if (requestedPeriod === "M") {
        // 해당 연도의 모든 월
        startPrd = `${input.year}01`;
        endPrd = `${input.year}12`;
      }
    }

    // 5. 데이터 조회 (공식 차원 선택과 모든 차원을 캐시 키/요청에 포함)
    const results = await cache.getStatisticsData(
      {
        queryIdentityVersion: "region-v1",
        orgId: selectedParam.orgId,
        tableId: selectedParam.tableId,
        ...dimensions,
        itemId: selectedParam.itemId,
        periodType: requestedPeriod,
        recentCount: startPrd ? undefined : 1,
        year: input.year,
        month: input.month,
        quarter: input.quarter,
      },
      async () => {
        return client.getStatisticsData({
          orgId: selectedParam.orgId,
          tblId: selectedParam.tableId,
          ...dimensions,
          itmId: selectedParam.itemId,
          prdSe: requestedPeriod,
          newEstPrdCnt: startPrd ? undefined : 1,
          startPrdDe: startPrd,
          endPrdDe: endPrd,
        });
      },
    );

    const responseRows = results as unknown as QuickStatsRow[];
    const requestedValidation = validateRequestedRows(
      responseRows,
      selectedParam,
      dimensions,
      requestedPeriod,
    );
    if (!requestedValidation.ok) {
      return {
        success: false,
        answer: `"${input.query}"의 실제 응답이 요청과 일치하지 않아 결과를 반환하지 않았습니다.`,
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
        requestedPeriod,
      );
      if (!validation.ok) {
        return {
          success: false,
          answer: `"${input.query}"의 실제 응답이 요청 지역과 일치하지 않아 결과를 반환하지 않았습니다.`,
          validationLevel: "unverified",
          note: validation.reason,
          ...(resolution.tableDiscovery
            ? { tableDiscovery: resolution.tableDiscovery }
            : {}),
          ...(resolution.caveats ? { caveats: resolution.caveats } : {}),
        };
      }
    }

    if (responseRows.length === 0) {
      return {
        success: false,
        answer: `"${input.query}"에 대한 데이터를 찾을 수 없습니다.`,
        note: `테이블: ${selectedParam.tableName} (${selectedParam.tableId})\n다른 검색어로 시도하거나 search_statistics를 사용해보세요.`,
        ...(resolution.tableDiscovery
          ? { tableDiscovery: resolution.tableDiscovery }
          : {}),
        ...(resolution.caveats ? { caveats: resolution.caveats } : {}),
      };
    }

    const scalarValidation = validateScalarRows(
      responseRows,
      selectedParam,
      dimensions,
      requestedPeriod,
    );
    if (!scalarValidation.ok) {
      return {
        success: false,
        answer: `"${input.query}"의 응답이 단일 통계값 조건을 충족하지 않아 결과를 반환하지 않았습니다.`,
        validationLevel: "unverified",
        note: scalarValidation.reason,
        ...(resolution.tableDiscovery
          ? { tableDiscovery: resolution.tableDiscovery }
          : {}),
        ...(resolution.caveats ? { caveats: resolution.caveats } : {}),
      };
    }

    const observedUnit = getObservedUnit(responseRows);
    if (observedUnit.ambiguous) {
      return {
        success: false,
        answer: `"${input.query}"의 응답 단위가 일관되지 않아 결과를 반환하지 않았습니다.`,
        validationLevel: "unverified",
        note: "UNIT_NM이 서로 다르거나 일부 행에만 있어 단위를 확정할 수 없습니다.",
        ...(resolution.tableDiscovery
          ? { tableDiscovery: resolution.tableDiscovery }
          : {}),
        ...(resolution.caveats ? { caveats: resolution.caveats } : {}),
      };
    }

    // 단일값 조회에서는 결측 최신 행을 이전 값으로 대체하지 않는다.
    const orderedRows = [...responseRows].sort((left, right) =>
      String(right.PRD_DE ?? "").localeCompare(String(left.PRD_DE ?? "")),
    );
    const latestData = orderedRows[0];
    const latestValue = parseObservedNumber(latestData.DT);
    if (latestValue === null) {
      return {
        success: false,
        answer: `"${input.query}"의 최신 관측값이 결측입니다.`,
        validationLevel: "partial",
        note: `결측 행을 0 또는 이전 값으로 변환하지 않았습니다. 원본 관측: ${formatRawRows(responseRows)}`,
        ...(resolution.tableDiscovery
          ? { tableDiscovery: resolution.tableDiscovery }
          : {}),
        ...(resolution.caveats ? { caveats: resolution.caveats } : {}),
      };
    }
    const value = String(latestData.DT);
    const period = String(latestData.PRD_DE ?? "");
    const periodFormatted = formatPeriodWithType(period, requestedPeriod);
    const unit = observedUnit.unit;

    // 자연어 응답 생성
    const baseAnswer = generateNaturalResponse({
      keyword,
      regionName,
      value,
      unit,
      period: periodFormatted,
      description: selectedParam.description,
    });

    // 출처 추가
    const answer = `${baseAnswer}\n\n📊 출처: ${selectedParam.tableName} (KOSIS)`;

    return {
      success: true,
      answer,
      value,
      ...(unit ? { unit } : {}),
      period: periodFormatted,
      source: {
        orgId: selectedParam.orgId,
        tableId: selectedParam.tableId,
        tableName: selectedParam.tableName,
        periodType: requestedPeriod,
        regionCode: resolution.regionCode,
      },
      validationLevel: unit ? "verified" : "partial",
      ...(resolution.caveats ? { caveats: resolution.caveats } : {}),
      ...(resolution.tableDiscovery
        ? { tableDiscovery: resolution.tableDiscovery }
        : {}),
    };
  } catch (error) {
    const safeError = handleToolError(error);
    return {
      answer: `조회 중 오류가 발생했습니다: ${safeError.error}`,
      validationLevel: "unverified",
      note: "search_statistics로 직접 검색해보세요.",
      ...safeError,
    };
  }
}

function rowText(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

function categoryKey(row: QuickStatsRow): string {
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

function getObservedUnit(rows: QuickStatsRow[]): ObservedUnit {
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

function validateScalarRows(
  rows: QuickStatsRow[],
  param: QuickStatsParam,
  dimensions: Record<string, string | undefined>,
  periodType: string,
): ScalarValidation {
  if (rows.length === 0) return { ok: false, reason: "응답 행이 없습니다." };

  const categories = new Set<string>();
  const periods = new Set<string>();
  for (const row of rows) {
    if (
      rowText(row.ORG_ID) !== param.orgId ||
      rowText(row.TBL_ID) !== param.tableId
    ) {
      return { ok: false, reason: "응답 표 식별자가 요청과 다릅니다." };
    }
    if (normalizeStatisticsPeriodType(rowText(row.PRD_SE)) !== periodType) {
      return { ok: false, reason: "응답 주기가 요청과 다릅니다." };
    }
    if (rowText(row.ITM_ID) !== param.itemId) {
      return {
        ok: false,
        reason: "응답 항목 식별자가 없거나 요청과 다릅니다.",
      };
    }
    const period = rowText(row.PRD_DE);
    if (!period) return { ok: false, reason: "응답 시점 식별자가 없습니다." };
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
    categories.add(categoryKey(row));
    if (periods.has(period)) {
      return {
        ok: false,
        reason: `동일한 시점(${period})의 중복 관측이 있어 단일값을 확정할 수 없습니다.`,
      };
    }
    periods.add(period);
  }
  if (categories.size > 1) {
    return { ok: false, reason: "여러 분류가 한 단일값 응답에 섞였습니다." };
  }
  return { ok: true };
}

function formatRawRows(rows: QuickStatsRow[]): string {
  return rows
    .map(
      (row) =>
        `${rowText(row.PRD_DE) || "?"}=${row.DT === undefined || row.DT === null ? "" : String(row.DT)}`,
    )
    .join(", ");
}
/**
 * 쿼리에서 키워드 추출
 */
function extractKeyword(query: string): string {
  // 매핑 키워드와 직접 매칭 (긴 키워드 우선)
  const sortedKeywords = Object.keys(QUICK_STATS_PARAMS).sort(
    (a, b) => b.length - a.length,
  );

  for (const keyword of sortedKeywords) {
    if (query.includes(keyword)) {
      return keyword;
    }
  }

  // 공백으로 분리하여 매칭 시도
  const words = query.split(/\s+/);
  for (const word of words) {
    if (QUICK_STATS_PARAMS[word]) {
      return word;
    }
  }

  return query;
}

/**
 * 기간 형식 포맷팅 (주기 타입 명시)
 */
function formatPeriodWithType(
  period: string,
  periodType: "Y" | "Q" | "M",
): string {
  if (period.length === 4) {
    return `${period}년`;
  } else if (period.length === 6) {
    const year = period.slice(0, 4);
    const num = parseInt(period.slice(4), 10);

    if (periodType === "Q") {
      return `${year}년 ${num}분기`;
    } else if (periodType === "M") {
      return `${year}년 ${num}월`;
    }
  }
  return period;
}

/**
 * 한국어 받침 유무에 따라 조사 선택
 * 받침이 있으면 '은', 없으면 '는'
 */
function getKoreanParticle(text: string): string {
  if (!text || text.length === 0) return "은";

  const lastChar = text.charAt(text.length - 1);
  const code = lastChar.charCodeAt(0);

  // 한글 유니코드 범위: 0xAC00 ~ 0xD7A3
  if (code >= 0xac00 && code <= 0xd7a3) {
    // 종성(받침) 존재 여부 확인
    // (code - 0xAC00) % 28 === 0 이면 받침 없음
    const hasJongseong = (code - 0xac00) % 28 !== 0;
    return hasJongseong ? "은" : "는";
  }

  // 숫자나 영문 등은 기본적으로 '는' 사용
  return "는";
}

/**
 * 자연어 응답 생성
 */
function generateNaturalResponse(data: {
  keyword: string;
  regionName: string;
  value: string;
  unit?: string;
  period: string;
  description: string;
}): string {
  const { regionName, value, unit, period, description } = data;

  // 숫자 포맷팅 (콤마 추가)
  const formattedValue = value.includes(",")
    ? value
    : Number(value).toLocaleString();

  // 단위 포맷팅 (지수 기준연도는 괄호로 감싸기)
  let formattedUnit = unit ?? "";
  if (unit?.includes("=")) {
    // 지수 단위 (예: 2020=100, 2021.6=100)
    formattedUnit = unit.startsWith("(") ? ` ${unit}` : ` (${unit})`;
  }
  if (!formattedUnit) formattedUnit = " (단위 미상)";

  // 한국어 문법: 받침 유무에 따라 은/는 선택
  const suffix = getKoreanParticle(description);

  if (regionName === "전국") {
    return `${period} 한국의 ${description}${suffix} ${formattedValue}${formattedUnit}입니다.`;
  } else {
    return `${period} ${regionName}의 ${description}${suffix} ${formattedValue}${formattedUnit}입니다.`;
  }
}
