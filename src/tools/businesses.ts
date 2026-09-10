/**
 * 소상공인시장진흥공단 상가업소 검색 MCP 도구.
 * 운영자 DATA_GO_KR_SERVICE_KEY만 사용하며, 호출 인자에는 자격증명이 없다.
 */

import { z } from "zod";
import {
  BUSINESS_DOC_URL,
  BUSINESS_INDUSTRY_ENDPOINT,
  BUSINESS_REGION_ENDPOINT,
  BusinessesApiError,
  getBusinessesClient,
  type BusinessSearchInput,
  type BusinessIndustryType,
  type BusinessRegionType,
} from "../api/businesses.js";

const STDR_YM_SEMANTICS =
  "stdrYm는 제공기관 기준월이며 안정적인 snapshot을 보장하지 않습니다.";

const sourceInfo = {
  provider: "소상공인시장진흥공단 상권정보 API",
  endpoint: BUSINESS_REGION_ENDPOINT,
  docURL: BUSINESS_DOC_URL,
  licenseStatus:
    "공개 카탈로그에 별도 이용제한 고지가 없으나 법률·운영자 승인은 별도 확인이 필요합니다.",
  stdrYmSemantics: STDR_YM_SEMANTICS,
  operatorApproval: "운영자 키 승인 상태는 이 도구에서 확인하지 않았습니다.",
} as const;

export const searchBusinessesSchema = {
  name: "search_businesses",
  description:
    "공공데이터포털 소상공인시장진흥공단 상권정보 API에서 지역 또는 업종별 상가업소를 페이지 단위로 조회합니다. 지역 조회에는 regionType/regionCode, 업종 조회에는 industryType/industryCode 한 쌍이 필요하며, 두 조건을 함께 주면 지역 API의 업종 필터로 결합합니다. DATA_GO_KR_SERVICE_KEY는 서버 운영자 환경변수에서만 읽습니다. 현재 페이지의 결과만 반환하며 전체 자료를 취득했다고 간주하지 않습니다.",
  inputSchema: z
    .object({
      regionType: z.enum(["ctprvnCd", "signguCd", "adongCd"]).optional(),
      regionCode: z.string().trim().min(1).optional(),
      industryType: z
        .enum(["indsLclsCd", "indsMclsCd", "indsSclsCd"])
        .optional(),
      industryCode: z.string().trim().min(1).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(1000).default(20),
    })
    .strict()
    .superRefine((value, context) => {
      const regionType = value.regionType !== undefined;
      const regionCode = value.regionCode !== undefined;
      const industryType = value.industryType !== undefined;
      const industryCode = value.industryCode !== undefined;
      if (regionType !== regionCode) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["regionCode"],
          message: "regionType과 regionCode는 함께 입력해야 합니다.",
        });
      }
      if (industryType !== industryCode) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["industryCode"],
          message: "industryType과 industryCode는 함께 입력해야 합니다.",
        });
      }
      if (!regionType && !industryType) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["regionType"],
          message: "지역 또는 업종 조회 조건이 필요합니다.",
        });
      }
    }),
};

export type SearchBusinessesInput = z.infer<
  typeof searchBusinessesSchema.inputSchema
>;

type PageState = {
  currentPage: number;
  pageSize: number;
  pageNo: number;
  numOfRows: number;
  returned: number;
  hasMore: boolean | "unknown";
  nextPage: number | null;
};

function observedAt(): string {
  return new Date().toISOString();
}

function pageState(
  input: Pick<SearchBusinessesInput, "page" | "pageSize">,
  overrides: Partial<PageState> = {},
): PageState {
  return {
    currentPage: input.page,
    pageSize: input.pageSize,
    pageNo: input.page,
    numOfRows: input.pageSize,
    returned: 0,
    hasMore: "unknown",
    nextPage: input.page + 1,
    ...overrides,
  };
}

function endpointFor(input: Pick<SearchBusinessesInput, "regionType">): string {
  return input.regionType !== undefined
    ? BUSINESS_REGION_ENDPOINT
    : BUSINESS_INDUSTRY_ENDPOINT;
}

function baseResult(input: SearchBusinessesInput): Record<string, unknown> {
  const endpoint = endpointFor(input);
  return {
    source: { ...sourceInfo, endpoint },
    sourceUrl: endpoint,
    docURL: BUSINESS_DOC_URL,
    access: "public_service_operating_key",
    retrieval: { status: "unknown", access: "public_service_operating_key" },
    observedAt: observedAt(),
    completeness: pageState(input),
  };
}

function safeError(error: unknown): { errorCode: string; error: string } {
  if (error instanceof BusinessesApiError) {
    const errorCode =
      error.code === "RESPONSE_MISMATCH" ? "response_mismatch" : error.code;
    return { errorCode, error: error.message };
  }
  return {
    errorCode: "NETWORK_ERROR",
    error: "공공데이터 조회를 처리하지 못했습니다.",
  };
}

function toApiInput(input: SearchBusinessesInput): BusinessSearchInput {
  return {
    regionType: input.regionType as BusinessRegionType | undefined,
    regionCode: input.regionCode,
    industryType: input.industryType as BusinessIndustryType | undefined,
    industryCode: input.industryCode,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function searchBusinesses(
  input: SearchBusinessesInput,
): Promise<Record<string, unknown>> {
  const normalizedInput = {
    ...input,
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 20,
  } as SearchBusinessesInput;
  const base = baseResult(normalizedInput);
  try {
    const page = await getBusinessesClient().search(
      toApiInput(normalizedInput),
    );
    const pages = pageState(normalizedInput, {
      pageNo: page.providerPageNo,
      numOfRows: page.providerNumOfRows,
      returned: page.returnedCount,
      hasMore: page.hasMore,
      nextPage: page.nextPage,
    });
    return {
      success: true,
      page: page.page,
      pageSize: page.pageSize,
      providerPageNo: page.providerPageNo,
      providerNumOfRows: page.providerNumOfRows,
      items: page.items,
      data: page.items,
      rows: page.items,
      returnedCount: page.returnedCount,
      providerTotal: page.providerTotal,
      hasMore: page.hasMore,
      nextPage: page.nextPage,
      pages,
      completeness: {
        status: "current_page_only",
        currentPage: page.page,
        pageSize: page.pageSize,
        returned: page.returnedCount,
        wholeDataset: "not_retrieved",
      },
      validationLevel: page.validationLevel,
      ...(page.missingFields.length === 0
        ? {}
        : { missingFields: page.missingFields }),
      ...(page.stdrYm === undefined
        ? { stdrYm: null }
        : { stdrYm: page.stdrYm }),
      stdrYmSemantics: STDR_YM_SEMANTICS,
      source: base.source,
      sourceUrl: base.sourceUrl,
      docURL: base.docURL,
      access: base.access,
      retrieval: { status: "success", access: "public_service_operating_key" },
      observedAt: page.observedAt,
    };
  } catch (error) {
    const safe = safeError(error);
    return {
      success: false,
      items: [],
      page: normalizedInput.page,
      pageSize: normalizedInput.pageSize,
      rows: [],
      data: [],
      returnedCount: 0,
      providerTotal: null,
      stdrYm: null,
      hasMore: "unknown",
      nextPage: null,
      pages: pageState(normalizedInput),
      completeness: {
        status: "current_page_unavailable",
        currentPage: normalizedInput.page,
        pageSize: normalizedInput.pageSize,
        wholeDataset: "not_retrieved",
      },
      stdrYmSemantics: STDR_YM_SEMANTICS,
      ...safe,
      source: base.source,
      sourceUrl: base.sourceUrl,
      docURL: base.docURL,
      access: base.access,
      retrieval: { status: "error", access: "public_service_operating_key" },
      observedAt: observedAt(),
    };
  }
}
