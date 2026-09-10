/**
 * Official KOSIS indicator search and retrieval tools.
 *
 * This module intentionally keeps indicator requests separate from the core
 * statistics projections. The client supplies the provider response unchanged;
 * this layer adds only provenance, page status, and explicit identity checks.
 */
import { z } from "zod";
import { config } from "../config/index.js";
import {
  KosisApiError,
  getKosisClient,
  normalizeIndicatorPeriod,
  resolveIndicatorSearchRoute,
} from "../api/client.js";
import { comparePeriods } from "../utils/dataFormatter.js";

const INDICATOR_VALUES_ENDPOINT = "/indIdDetailSearchRequest.do";
const INDICATOR_DEFINITION_ENDPOINT = "/pkNumberService.do";
const MAX_PAGE_SIZE = 100;

type RawRow = Record<string, unknown>;
type HasMore = true | false | "unknown";

const filterSchema = z
  .object({
    indicatorName: z.string().trim().min(1).optional(),
    indicatorId: z.string().trim().min(1).optional(),
    period: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (filters) => Object.values(filters).some((value) => value !== undefined),
    "filters must contain at least one filter",
  );

export const searchIndicatorsSchema = {
  name: "search_indicators",
  description:
    "공식 KOSIS 지표를 이름, ID, 수록주기로 검색합니다. 검색 필터를 하나 이상 명시해야 합니다.",
  inputSchema: z
    .object({
      filters: filterSchema,
      pageSize: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_SIZE)
        .optional()
        .default(10),
      page: z.number().int().min(1).optional().default(1),
    })
    .strict(),
};

export type SearchIndicatorsInput = z.infer<
  typeof searchIndicatorsSchema.inputSchema
>;

const getIndicatorInputSchema = z
  .object({
    indicatorId: z.string().trim().min(1),
    indicatorName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("values 전용: 검색 결과의 공식 지표 이름"),
    kind: z.enum(["definition", "values"]),
    startPeriod: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("values 전용: 시작 시점"),
    endPeriod: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("values 전용: 종료 시점"),
    recentReference: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("values 전용: 공급자 최근 시점 기준"),
    recentCount: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
    pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).optional().default(10),
    page: z.number().int().min(1).optional().default(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "values" && value.indicatorName === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["indicatorName"],
        message: "values 조회에는 indicatorName이 필요합니다.",
      });
    }
    if (value.kind === "definition") {
      for (const field of [
        "indicatorName",
        "startPeriod",
        "endPeriod",
        "recentReference",
        "recentCount",
      ] as const) {
        if (value[field] !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field}는 values 조회에서만 사용할 수 있습니다.`,
          });
        }
      }
    }
  });

export const getIndicatorSchema = {
  name: "get_indicator",
  description:
    "공식 KOSIS 지표의 정의 또는 원자료 값을 조회합니다. values 조회에는 indicatorName이 필요합니다.",
  inputSchema: getIndicatorInputSchema,
};

export type GetIndicatorInput = z.infer<typeof getIndicatorSchema.inputSchema>;

function readString(row: RawRow, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return undefined;
}

function valueOrUnknown(value: unknown): unknown {
  return value === undefined || value === null || value === ""
    ? "unknown"
    : value;
}

function publicSourceUrl(
  endpoint: string,
  params: Record<string, string | number | undefined>,
): string {
  const url = new URL(config.kosis.baseUrl + endpoint);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && key !== "apiKey" && key !== "jsonVD") {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set("format", "json");
  url.searchParams.set("jsonVD", "Y");
  return url.toString();
}

function pageState(page: number, pageSize: number) {
  const state = {
    currentPage: page,
    pageSize,
    returned: 0,
    hasMore: "unknown" as HasMore,
    nextPage: page + 1,
    nextPageHint: `hasMore를 확인할 수 없어 다음 페이지(${page + 1})를 별도로 요청해야 합니다.`,
  };
  return state;
}

function withPageState<T extends RawRow>(
  rows: T[],
  page: number,
  pageSize: number,
) {
  const state = pageState(page, pageSize);
  state.returned = rows.length;
  return state;
}

function retrievalSuccess() {
  return {
    status: "success" as const,
    access: "public_service_operating_key" as const,
  };
}

function observedAt(): string {
  return new Date().toISOString();
}

function errorResult(
  error: unknown,
  sourceUrl: string,
  page: number,
  pageSize: number,
): Record<string, unknown> {
  if (error instanceof KosisApiError) {
    return {
      success: false,
      errorCode: error.code,
      error: error.message,
      source: { provider: "kosis", endpoint: sourceUrl },
      sourceUrl,
      observedAt: observedAt(),
      retrieval: { status: "error", access: "public_service_operating_key" },
      completeness: pageState(page, pageSize),
    };
  }
  return {
    success: false,
    errorCode: "NETWORK_ERROR",
    error: "KOSIS 요청을 처리하지 못했습니다.",
    source: { provider: "kosis", endpoint: sourceUrl },
    sourceUrl,
    observedAt: observedAt(),
    retrieval: { status: "error", access: "public_service_operating_key" },
    completeness: pageState(page, pageSize),
  };
}

function invalidInputResult(message: string): Record<string, unknown> {
  return {
    success: false,
    errorCode: "INVALID_INPUT",
    error: message,
    retrieval: { status: "error", access: "public_service_operating_key" },
    observedAt: observedAt(),
  };
}

function indicatorFilterValue(
  filters: SearchIndicatorsInput["filters"],
  key: keyof SearchIndicatorsInput["filters"],
): string | undefined {
  return filters[key];
}

function unitFromRows(rows: RawRow[]): unknown {
  const units = new Set(
    rows
      .map((row) => row.unit)
      .filter((value) => value !== undefined && value !== null && value !== "")
      .map((value) => String(value)),
  );
  return units.size === 1 ? [...units][0] : "unknown";
}
function normalizeDocumentedPeriod(value: string): string | undefined {
  return normalizeIndicatorPeriod(value);
}

function rowPeriod(row: RawRow): string | undefined {
  const raw = readString(row, "prdSe", "prdSeName");
  return raw === undefined ? undefined : normalizeDocumentedPeriod(raw);
}

function applySearchFilters(
  rows: RawRow[],
  filters: SearchIndicatorsInput["filters"],
  route: ReturnType<typeof resolveIndicatorSearchRoute>,
): {
  rows: RawRow[];
  providerCount: number;
  appliedFilters: Record<string, string>;
  filterScope: Record<string, unknown>;
  errorCode?: "response_mismatch" | "response_incomplete";
  error?: string;
} {
  const appliedFilters = Object.fromEntries(
    Object.entries(filters).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const primaryFilter =
    route.queryKey === "jipyoId"
      ? "indicatorId"
      : route.queryKey === "jipyoNm"
        ? "indicatorName"
        : "period";
  const secondaryFilters = Object.keys(appliedFilters).filter(
    (key) => key !== primaryFilter,
  );
  const filterScope = {
    type: "current_provider_page",
    primary: primaryFilter,
    secondary: secondaryFilters,
  };
  if (
    route.queryKey === "jipyoId" &&
    rows.some((row) => readString(row, "statJipyoId") === undefined)
  ) {
    return {
      rows: [],
      providerCount: rows.length,
      appliedFilters,
      filterScope,
      errorCode: "response_incomplete",
      error: "KOSIS 응답에서 지표 ID를 확인할 수 없습니다.",
    };
  }
  if (
    route.queryKey === "jipyoId" &&
    rows.some((row) => readString(row, "statJipyoId") !== route.queryValue)
  ) {
    return {
      rows: [],
      providerCount: rows.length,
      appliedFilters,
      filterScope,
      errorCode: "response_mismatch",
      error: "KOSIS 응답의 지표 ID가 요청과 일치하지 않습니다.",
    };
  }
  if (
    route.queryKey === "jipyoNm" &&
    rows.some((row) => readString(row, "statJipyoNm") === undefined)
  ) {
    return {
      rows: [],
      providerCount: rows.length,
      appliedFilters,
      filterScope,
      errorCode: "response_incomplete",
      error: "KOSIS 응답에서 지표 이름을 확인할 수 없습니다.",
    };
  }
  if (
    route.queryKey === "jipyoNm" &&
    rows.some((row) => {
      const name = readString(row, "statJipyoNm");
      return name !== undefined && !name.includes(route.queryValue);
    })
  ) {
    return {
      rows: [],
      providerCount: rows.length,
      appliedFilters,
      filterScope,
      errorCode: "response_mismatch",
      error: "KOSIS 응답의 지표 이름이 검색어와 일치하지 않습니다.",
    };
  }

  const filtered = rows.filter((row) => {
    if (
      appliedFilters.indicatorId !== undefined &&
      readString(row, "statJipyoId") !== appliedFilters.indicatorId
    ) {
      return false;
    }
    if (
      appliedFilters.indicatorName !== undefined &&
      !(
        readString(row, "statJipyoNm")?.includes(
          appliedFilters.indicatorName,
        ) ?? false
      )
    ) {
      return false;
    }
    if (appliedFilters.period !== undefined) {
      const requested = normalizeDocumentedPeriod(appliedFilters.period);
      if (requested === undefined || rowPeriod(row) !== requested) return false;
    }
    return true;
  });
  return {
    rows: filtered,
    providerCount: rows.length,
    appliedFilters,
    filterScope,
  };
}

function identityMismatch(
  rows: RawRow[],
  indicatorId: string,
): "response_mismatch" | "response_incomplete" | undefined {
  let missingIdentity = false;
  for (const row of rows) {
    const returnedId = readString(row, "jipyoId");
    const returnedName = readString(row, "jipyoNm");
    const legacyId = readString(row, "statJipyoId");
    const legacyName = readString(row, "statJipyoNm");

    if (returnedId === undefined || returnedName === undefined) {
      missingIdentity = true;
    }
    if (returnedId !== undefined && returnedId !== indicatorId) {
      return "response_mismatch";
    }
    if (legacyId !== undefined && legacyId !== indicatorId) {
      return "response_mismatch";
    }
    if (
      returnedId !== undefined &&
      legacyId !== undefined &&
      returnedId !== legacyId
    ) {
      return "response_mismatch";
    }
    if (
      returnedName !== undefined &&
      legacyName !== undefined &&
      returnedName !== legacyName
    ) {
      return "response_mismatch";
    }
  }
  return missingIdentity ? "response_incomplete" : undefined;
}

type ValueValidation =
  | {
      status: "ok";
      validationLevel: "verified" | "unverified";
      uncertainty?: string;
    }
  | {
      status: "error";
      errorCode: "response_mismatch" | "response_incomplete";
      message: string;
    };

function validateValueRows(
  rows: RawRow[],
  indicatorId: string,
  indicatorName: string,
  startPeriod?: string,
  endPeriod?: string,
  recentMode = false,
): ValueValidation {
  if (
    (startPeriod !== undefined || endPeriod !== undefined) &&
    rows.length === 0
  ) {
    return {
      status: "error",
      errorCode: "response_incomplete",
      message: "기간 범위를 검증할 수 있는 응답 행이 없습니다.",
    };
  }

  let missingFields = false;
  for (const row of rows) {
    const returnedId = readString(row, "statJipyoId");
    const returnedName = readString(row, "statJipyoNm");
    if (returnedId !== undefined && returnedId !== indicatorId) {
      return {
        status: "error",
        errorCode: "response_mismatch",
        message: "KOSIS 응답의 지표 ID가 요청과 일치하지 않습니다.",
      };
    }
    if (returnedName !== undefined && returnedName !== indicatorName) {
      return {
        status: "error",
        errorCode: "response_mismatch",
        message: "KOSIS 응답의 지표 이름이 요청과 일치하지 않습니다.",
      };
    }

    const periodType = readString(row, "prdSe");
    const period = readString(row, "prdDe");
    const itemName = readString(row, "itmNm");
    const hasValue = row.val !== undefined && row.val !== null;
    missingFields ||=
      returnedId === undefined ||
      returnedName === undefined ||
      periodType === undefined ||
      period === undefined ||
      itemName === undefined ||
      !hasValue;

    if (startPeriod !== undefined || endPeriod !== undefined) {
      if (period === undefined) continue;
      const beforeStart =
        startPeriod !== undefined && comparePeriods(period, startPeriod) < 0;
      const afterEnd =
        endPeriod !== undefined && comparePeriods(period, endPeriod) > 0;
      if (beforeStart || afterEnd) {
        return {
          status: "error",
          errorCode: "response_mismatch",
          message:
            "응답에 요청한 기간 범위를 벗어난 관측값이 포함되어 있습니다.",
        };
      }
    }
  }

  if (missingFields) {
    return {
      status: "error",
      errorCode: "response_incomplete",
      message:
        "KOSIS 응답에서 지표 식별자 또는 원자료 행 필드를 확인할 수 없습니다.",
    };
  }

  const bounded = startPeriod !== undefined || endPeriod !== undefined;
  return {
    status: "ok",
    validationLevel: bounded && !recentMode ? "verified" : "unverified",
    uncertainty: recentMode
      ? "recentReference/recentCount로 선택된 시점은 제공자 최신성 근거가 없어 검증되지 않았습니다."
      : !bounded
        ? "응답 행의 지표 식별자와 원자료 필드는 확인했지만 요청 시점의 최신성은 검증하지 않았습니다."
        : undefined,
  };
}

function definitionFromRow(
  row: RawRow | undefined,
): Record<string, unknown> | null {
  if (!row) return null;
  return {
    title: valueOrUnknown(row.jipyoExplan),
    concept: valueOrUnknown(row.jipyoExplan1),
    selectionMethod: valueOrUnknown(row.jipyoExplan2),
    sourceInfo: valueOrUnknown(row.jipyoExplan3),
    // Keep the provider's original strings and mark them as text. Consumers
    // must not render these values as HTML.
    original: {
      jipyoExplan: row.jipyoExplan,
      jipyoExplan1: row.jipyoExplan1,
      jipyoExplan2: row.jipyoExplan2,
      jipyoExplan3: row.jipyoExplan3,
    },
    contentType: "text",
    renderAs: "text",
  };
}

export async function searchIndicators(
  input: SearchIndicatorsInput,
): Promise<Record<string, unknown>> {
  const parsed = searchIndicatorsSchema.inputSchema.safeParse(input);
  if (!parsed.success)
    return invalidInputResult(
      parsed.error.issues[0]?.message ?? "잘못된 검색 조건입니다.",
    );

  const { filters, page, pageSize } = parsed.data;
  const indicatorName = indicatorFilterValue(filters, "indicatorName");
  const indicatorId = indicatorFilterValue(filters, "indicatorId");
  const period = indicatorFilterValue(filters, "period");
  const route = resolveIndicatorSearchRoute({
    jipyoId: indicatorId,
    jipyoNm: indicatorName,
    prdSe: period,
  });
  const params = {
    method: "getList",
    service: "4",
    serviceDetail: route.serviceDetail,
    [route.queryKey]: route.queryValue,
    pageNo: page,
    numOfRows: pageSize,
  };
  const sourceUrl = publicSourceUrl(route.endpoint, params);
  const appliedFilters = Object.fromEntries(
    Object.entries(filters).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

  try {
    const rows = await getKosisClient().searchIndicators({
      jipyoNm: indicatorName,
      jipyoId: indicatorId,
      prdSe: period,
      pageNo: page,
      numOfRows: pageSize,
    });
    const filtered = applySearchFilters(rows, filters, route);
    const filterScope = {
      ...filtered.filterScope,
      providerEndpoint: route.endpoint,
      providerCount: filtered.providerCount,
      returnedCount: filtered.rows.length,
    };
    const completeness = withPageState(filtered.rows, page, pageSize);
    if (filtered.errorCode !== undefined) {
      return {
        success: false,
        errorCode: filtered.errorCode,
        error: filtered.error,
        data: [],
        appliedFilters,
        filterScope,
        providerCount: filtered.providerCount,
        source: { provider: "kosis", endpoint: sourceUrl },
        sourceUrl,
        observedAt: observedAt(),
        retrieval: { status: "error", access: "public_service_operating_key" },
        completeness,
      };
    }
    return {
      success: true,
      data: filtered.rows,
      unit: unitFromRows(filtered.rows),
      appliedFilters,
      filterScope,
      providerCount: filtered.providerCount,
      source: { provider: "kosis", endpoint: sourceUrl },
      sourceUrl,
      observedAt: observedAt(),
      retrieval: retrievalSuccess(),
      completeness,
      pagination: completeness,
    };
  } catch (error) {
    return errorResult(error, sourceUrl, page, pageSize);
  }
}

export async function getIndicator(
  input: GetIndicatorInput,
): Promise<Record<string, unknown>> {
  const parsed = getIndicatorSchema.inputSchema.safeParse(input);
  if (!parsed.success)
    return invalidInputResult(
      parsed.error.issues[0]?.message ?? "잘못된 지표 조회 조건입니다.",
    );

  const {
    indicatorId,
    indicatorName,
    kind,
    startPeriod,
    endPeriod,
    recentReference,
    recentCount,
    page,
    pageSize,
  } = parsed.data;
  const actualStart = startPeriod;
  const actualEnd = endPeriod;
  const actualRecentReference = recentReference;
  const actualRecentCount = recentCount;

  if (kind === "values" && indicatorName === undefined) {
    return invalidInputResult("values 조회에는 indicatorName이 필요합니다.");
  }
  if (
    actualStart !== undefined &&
    actualEnd !== undefined &&
    comparePeriods(actualStart, actualEnd) > 0
  ) {
    return {
      ...invalidInputResult("startPeriod가 endPeriod보다 클 수 없습니다."),
      errorCode: "INVALID_PERIOD",
    };
  }

  if (kind === "definition") {
    const params = {
      method: "getList",
      service: "1",
      serviceDetail: "pkAll",
      jipyoId: indicatorId,
      pageNo: page,
      numOfRows: pageSize,
    };
    const sourceUrl = publicSourceUrl(INDICATOR_DEFINITION_ENDPOINT, params);
    try {
      const rows = await getKosisClient().getIndicatorDefinition({
        jipyoId: indicatorId,
        pageNo: page,
        numOfRows: pageSize,
      });
      const mismatch = identityMismatch(rows, indicatorId);
      if (mismatch !== undefined) {
        return {
          success: false,
          errorCode: mismatch,
          error:
            mismatch === "response_mismatch"
              ? "KOSIS 응답의 지표 ID가 요청과 일치하지 않습니다."
              : "KOSIS 응답에서 요청 지표의 식별 필드를 확인할 수 없습니다.",
          data: [],
          source: { provider: "kosis", endpoint: sourceUrl },
          sourceUrl,
          observedAt: observedAt(),
          retrieval: {
            status: "error",
            access: "public_service_operating_key",
          },
          completeness: pageState(page, pageSize),
        };
      }
      const data = rows;
      const completeness = withPageState(data, page, pageSize);
      return {
        success: true,
        data,
        definition: definitionFromRow(rows[0]),
        unit: "unknown",
        source: { provider: "kosis", endpoint: sourceUrl },
        sourceUrl,
        observedAt: observedAt(),
        retrieval: retrievalSuccess(),
        completeness,
        pagination: completeness,
      };
    } catch (error) {
      return errorResult(error, sourceUrl, page, pageSize);
    }
  }
  if (indicatorName === undefined) {
    return invalidInputResult("values 조회에는 indicatorName이 필요합니다.");
  }

  const valueParams = {
    method: "getList",
    service: "4",
    serviceDetail: "indIdDetail",
    jipyoId: indicatorId,
    strtPrdDe: actualStart,
    endPrdDe: actualEnd,
    rn: actualRecentReference,
    srvRn: actualRecentCount,
    pageNo: page,
    numOfRows: pageSize,
  };
  const sourceUrl = publicSourceUrl(INDICATOR_VALUES_ENDPOINT, valueParams);

  try {
    const rows = await getKosisClient().getIndicatorValues({
      jipyoId: indicatorId,
      strtPrdDe: actualStart,
      endPrdDe: actualEnd,
      rn: actualRecentReference,
      srvRn: actualRecentCount,
      pageNo: page,
      numOfRows: pageSize,
    });
    const validation = validateValueRows(
      rows,
      indicatorId,
      indicatorName,
      actualStart,
      actualEnd,
      actualRecentReference !== undefined || actualRecentCount !== undefined,
    );
    if (validation.status === "error") {
      return {
        success: false,
        errorCode: validation.errorCode,
        validationLevel: "unverified",
        error: validation.message,
        data: [],
        source: { provider: "kosis", endpoint: sourceUrl },
        sourceUrl,
        observedAt: observedAt(),
        retrieval: { status: "error", access: "public_service_operating_key" },
        completeness: pageState(page, pageSize),
      };
    }

    const data = rows;
    const completeness = withPageState(data, page, pageSize);
    return {
      success: true,
      data,
      unit: unitFromRows(rows),
      source: { provider: "kosis", endpoint: sourceUrl },
      sourceUrl,
      observedAt: observedAt(),
      retrieval: retrievalSuccess(),
      completeness,
      pagination: completeness,
      validationLevel: validation.validationLevel,
      ...(validation.uncertainty === undefined
        ? {}
        : { uncertainty: validation.uncertainty }),
    };
  } catch (error) {
    return errorResult(error, sourceUrl, page, pageSize);
  }
}
