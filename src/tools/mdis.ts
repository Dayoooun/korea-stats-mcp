/**
 * MDIS public metadata tools.
 *
 * These tools are a public-web adapter, not an official MDIS API client. They
 * inspect anonymous catalogue/detail pages and expose only public metadata.
 * Researcher login, caller cookies, raw-data downloads, and authorization
 * submission are intentionally outside this adapter.
 */

import { z } from "zod";
import {
  MDIS_BASE_URL,
  MDIS_CATALOG_SOURCE,
  MDIS_CODEBOOK_PATH,
  MDIS_DETAIL_PATH,
  MDIS_PARSER_VERSION,
  MDIS_SERVICE_CATALOG_SOURCE,
  MDIS_SERVICE_POPUP_PATH,
  MdisApiError,
  getMdisClient,
  type MdisCatalogInput,
  type MdisCodebookInput,
  type MdisDataset,
  type MdisDetailPage,
  type MdisServiceItem,
  type MdisServiceItemsInput,
  type MdisVariablesInput,
} from "../api/mdis.js";

const PAGE_MAX = 100;

const baseSource = {
  provider: "MDIS",
  sourceName: "MDIS 공개 마이크로데이터 카탈로그",
  adapter: "public_web_adapter",
  officialApi: false,
  publicMetadataOnly: true,
  researcherLogin: "not_used",
  callerCookies: "not_accepted",
};

export const searchMicrodataSchema = {
  name: "search_microdata",
  description:
    "MDIS 공개기관별 카탈로그를 익명 공개 웹 세션으로 검색합니다. 공식 API가 아닌 public-web adapter이며 공개 조사 메타데이터만 반환합니다. 조사 원자료 다운로드·연구자 로그인·사용자 쿠키는 수행하지 않습니다.",
  inputSchema: z
    .object({
      query: z.string().optional(),
      page: z.number().int().min(1).optional().default(1),
      pageSize: z.number().int().min(1).max(PAGE_MAX).optional().default(20),
    })
    .strict(),
};

export type SearchMicrodataInput = z.infer<
  typeof searchMicrodataSchema.inputSchema
>;

export const getMicrodataInfoSchema = {
  name: "get_microdata_info",
  description:
    "MDIS 익명 공개 메타데이터를 조사합니다. metadataSource=survey_detail(기본값)는 조사 detail 경로를, metadataSource=service_items는 실제 서비스 카탈로그와 선택한 popup 경로를 사용합니다. 원자료·연구자 로그인·사용자 쿠키는 처리하지 않습니다.",
  inputSchema: z
    .object({
      metadataSource: z
        .enum(["survey_detail", "service_items"])
        .optional()
        .default("survey_detail"),
      survId: z.string().trim().min(1).optional(),
      itmDiv: z.string().trim().min(1).optional(),
      mappId: z.string().trim().min(1).optional(),
      survAreaId: z.string().trim().min(1).optional(),
      ofrSurvYm: z.string().trim().min(1).optional(),
      query: z.string().optional(),
      page: z.number().int().min(1).optional(),
      detailPage: z.number().int().min(1).optional(),
      variablePage: z.number().int().min(1).optional().default(1),
      pageSize: z.number().int().min(1).max(PAGE_MAX).optional().default(20),
      downloadCodebook: z.boolean().optional().default(false),
    })
    .strict()
    .superRefine((value, context) => {
      const selected = [value.mappId, value.survAreaId, value.ofrSurvYm].filter(
        (item) => item !== undefined,
      ).length;
      if (value.metadataSource === "survey_detail") {
        if (!value.survId || !value.itmDiv) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["survId"],
            message: "survey_detail에는 survId와 itmDiv가 필요합니다.",
          });
        }
        if (selected > 0 && selected < 3) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["mappId"],
            message:
              "dataset 선택에는 mappId, survAreaId, ofrSurvYm가 모두 필요합니다.",
          });
        }
        if (value.page !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["page"],
            message: "survey_detail에서는 page를 사용할 수 없습니다.",
          });
        }
      } else {
        if (value.survId !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["survId"],
            message: "service_items에서는 survId를 사용할 수 없습니다.",
          });
        }
        if (value.survAreaId !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["survAreaId"],
            message: "service_items에서는 survAreaId를 사용할 수 없습니다.",
          });
        }
        if (value.detailPage !== undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["detailPage"],
            message: "service_items에서는 detailPage를 사용할 수 없습니다.",
          });
        }
        const serviceSelection = [
          value.mappId,
          value.itmDiv,
          value.ofrSurvYm,
        ].filter((item) => item !== undefined).length;
        if (serviceSelection > 0 && serviceSelection < 3) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["mappId"],
            message:
              "service_items 선택에는 mappId, itmDiv, ofrSurvYm가 필요합니다.",
          });
        }
      }
    }),
};

export type GetMicrodataInfoInput = z.infer<
  typeof getMicrodataInfoSchema.inputSchema
>;

function observedAt(): string {
  return new Date().toISOString();
}

function sourceFor(endpoint: string, url: string) {
  return { ...baseSource, endpoint, url };
}

function diagnosticSourceUrl(
  error: MdisApiError,
  fallback: string | undefined,
): string | undefined {
  const pathname = error.diagnostics?.pathname;
  if (
    pathname === undefined ||
    !pathname.startsWith("/") ||
    pathname.includes("?") ||
    pathname.includes("#")
  )
    return fallback;
  try {
    const url = new URL(pathname, MDIS_BASE_URL);
    if (url.origin !== MDIS_BASE_URL) return fallback;
    return `${url.origin}${url.pathname}`;
  } catch {
    return fallback;
  }
}

function errorPayload(error: unknown, url?: string): Record<string, unknown> {
  if (error instanceof MdisApiError) {
    const sourceUrl = diagnosticSourceUrl(error, url);
    return {
      success: false,
      errorCode: error.code,
      error: error.message,
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.diagnostics === undefined
        ? {}
        : { diagnostics: error.diagnostics }),
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
      source: sourceFor(sourceUrl ?? MDIS_BASE_URL, sourceUrl ?? MDIS_BASE_URL),
      observedAt: observedAt(),
      retrieval: { status: "error", access: "anonymous_public_web" },
    };
  }
  return {
    success: false,
    errorCode: "NETWORK_ERROR",
    error: "MDIS 공개 메타데이터 요청을 처리하지 못했습니다.",
    ...(url === undefined ? {} : { sourceUrl: url }),
    source: sourceFor(url ?? MDIS_BASE_URL, url ?? MDIS_BASE_URL),
    observedAt: observedAt(),
    retrieval: { status: "error", access: "anonymous_public_web" },
  };
}

function pageCompleteness(
  page: number,
  pageSize: number,
  returned: number,
  total: number,
  hasMore: boolean,
  nextPage: number | null,
) {
  return {
    status: "current_page_only",
    currentPage: page,
    pageSize,
    returned,
    total,
    hasMore,
    nextPage,
    wholeDataset: "not_retrieved",
  };
}

function publicDetailUrl(
  survId: string,
  itmDiv: string,
  detailPage: number,
): string {
  const url = new URL(MDIS_DETAIL_PATH, MDIS_BASE_URL);
  for (const [key, value] of Object.entries({
    survId,
    itmDiv,
    nPage: String(detailPage),
    itemId: "",
    itemNm: "",
  }))
    url.searchParams.set(key, value);
  return url.toString();
}

function publicCodebookUrl(): string {
  return new URL(MDIS_CODEBOOK_PATH, MDIS_BASE_URL).toString();
}

function normalizedSurveyId(input: GetMicrodataInfoInput): string {
  return input.survId ?? "";
}

function datasetSelection(input: GetMicrodataInfoInput):
  | {
      mappId: string;
      survAreaId: string;
      ofrSurvYm: string;
    }
  | undefined {
  if (!input.mappId || !input.survAreaId || !input.ofrSurvYm) return undefined;
  return {
    mappId: input.mappId,
    survAreaId: input.survAreaId,
    ofrSurvYm: input.ofrSurvYm,
  };
}

function matchingDataset(
  dataset: MdisDataset,
  selection: NonNullable<ReturnType<typeof datasetSelection>>,
  itmDiv: string,
): boolean {
  if (dataset.mappId !== selection.mappId) return false;
  if (dataset.survAreaId !== selection.survAreaId) return false;
  if (dataset.ofrSurvYm !== selection.ofrSurvYm) return false;
  if (dataset.itmDiv !== undefined && dataset.itmDiv !== itmDiv) return false;
  return true;
}

function detailData(
  detail: MdisDetailPage,
  detailUrl: string,
): Record<string, unknown> {
  return {
    metadataSource: "survey_detail",
    survId: detail.survId,
    itmDiv: detail.itmDiv,
    detailPage: detail.detailPage,
    datasets: detail.datasets,
    actions: detail.actions,
    manualAccess: {
      status: "manual_user_action_required",
      download:
        "일반자료 다운로드는 사용자가 MDIS 공식 페이지에서 직접 진행해야 합니다.",
      restrictedAccess:
        "RAS/SDC 인가 신청은 사용자가 MDIS 공식 페이지에서 직접 진행해야 합니다.",
      researcherLogin: "not_used",
      userCookieStorage: "not_used",
    },
    source: sourceFor(detailUrl, detailUrl),
    sourceUrl: detailUrl,
    srcobservedAt: detail.srcobservedAt,
    observedAt: detail.srcobservedAt,
    parserVersion: detail.parserVersion,
    hashSnapshot: detail.hashSnapshot,
  };
}
function serviceSpace(
  selection: MdisServiceItem | undefined,
): Record<string, unknown> {
  if (selection === undefined)
    return { status: "selection_required", area: "not_resolved" };
  const survAreaId = selection.survAreaId ?? "";
  const ofrSurvAreaId = selection.ofrSurvAreaId ?? "";
  if (survAreaId === "" && ofrSurvAreaId === "")
    return {
      status: "not_published_by_source",
      area: "blank_in_observed_popup_and_codebook_form",
    };
  return {
    status: "provider_area_identifiers_only",
    area: {
      survAreaId,
      ofrSurvAreaId,
    },
    spatialResolution: null,
  };
}

export async function searchMicrodata(
  input: SearchMicrodataInput,
): Promise<Record<string, unknown>> {
  const parsed = searchMicrodataSchema.inputSchema.safeParse(input);
  if (!parsed.success)
    return {
      ...errorPayload(
        new MdisApiError(
          "INVALID_INPUT",
          parsed.error.issues[0]?.message ?? "잘못된 검색 조건입니다.",
        ),
      ),
      items: [],
      data: [],
    };
  const value = parsed.data as Required<
    Pick<SearchMicrodataInput, "page" | "pageSize">
  > &
    SearchMicrodataInput;
  try {
    const page = await getMdisClient().searchCatalog(value as MdisCatalogInput);
    const source = sourceFor(MDIS_CATALOG_SOURCE, MDIS_CATALOG_SOURCE);
    return {
      success: true,
      items: page.items,
      data: page.items,
      page: page.page,
      pageSize: page.pageSize,
      returnedCount: page.items.length,
      total: page.total,
      hasMore: page.hasMore,
      nextPage: page.nextPage,
      completeness: pageCompleteness(
        page.page,
        page.pageSize,
        page.items.length,
        page.total,
        page.hasMore,
        page.nextPage,
      ),
      source,
      sourceUrl: MDIS_CATALOG_SOURCE,
      srcobservedAt: page.srcobservedAt,
      observedAt: page.srcobservedAt,
      parserVersion: page.parserVersion,
      hashSnapshot: page.hashSnapshot,
      retrieval: { status: "success", access: "anonymous_public_web" },
      access: "anonymous_public_web",
      limitations: [
        "공개 카탈로그 페이지에서 관찰한 조사만 반환합니다.",
        "조사 원자료와 개인 연구자 계정 데이터는 저장·다운로드하지 않습니다.",
      ],
    };
  } catch (error) {
    return {
      ...errorPayload(error, MDIS_CATALOG_SOURCE),
      items: [],
      data: [],
      page: value.page,
      pageSize: value.pageSize,
      returnedCount: 0,
      total: null,
      hasMore: false,
      nextPage: null,
      completeness: pageCompleteness(
        value.page,
        value.pageSize,
        0,
        0,
        false,
        null,
      ),
    };
  }
}

export async function getMicrodataInfo(
  input: GetMicrodataInfoInput,
): Promise<Record<string, unknown>> {
  const parsed = getMicrodataInfoSchema.inputSchema.safeParse(input);
  if (!parsed.success)
    return errorPayload(
      new MdisApiError(
        "INVALID_INPUT",
        parsed.error.issues[0]?.message ?? "잘못된 조사 조회 조건입니다.",
      ),
    );
  const value = parsed.data as GetMicrodataInfoInput & {
    detailPage?: number;
    variablePage: number;
    pageSize: number;
    page: number;
  };
  if (value.metadataSource === "service_items") {
    try {
      const page = await getMdisClient().getServiceItems({
        mappId: value.mappId,
        itmDiv: value.itmDiv,
        ofrSurvYm: value.ofrSurvYm,
        query: value.query,
        page: value.page,
        variablePage: value.variablePage,
        pageSize: value.pageSize,
        downloadCodebook: value.downloadCodebook,
      } as MdisServiceItemsInput);
      const source = sourceFor(MDIS_SERVICE_CATALOG_SOURCE, page.source);
      const result: Record<string, unknown> = {
        success: true,
        metadataSource: "service_items",
        items: page.items,
        data: page.items,
        serviceItems: page.items,
        query: page.query,
        page: page.page,
        pageSize: page.pageSize,
        returnedCount: page.items.length,
        total: page.total,
        hasMore: page.hasMore,
        nextPage: page.nextPage,
        completeness: pageCompleteness(
          page.page,
          page.pageSize,
          page.items.length,
          page.total,
          page.hasMore,
          page.nextPage,
        ),
        selection: page.selection ?? null,
        variables: page.variables,
        variablePage: pageCompleteness(
          page.variablePage,
          page.pageSize,
          page.variables.length,
          page.variableTotal,
          page.variableHasMore,
          page.variableNextPage,
        ),
        codebook: page.codebook ?? null,
        source,
        sourceUrl: page.source,
        serviceCatalogSource: source,
        popupSource: page.popupSource
          ? sourceFor(MDIS_SERVICE_POPUP_PATH, page.popupSource)
          : null,
        srcobservedAt: page.srcobservedAt,
        observedAt: page.srcobservedAt,
        parserVersion: page.parserVersion,
        hashSnapshot: page.hashSnapshot,
        popupHashSnapshot: page.popupHashSnapshot ?? null,
        sourceActions: page.sourceActions,
        space: serviceSpace(page.selection),
        manualAccess: {
          status: "manual_user_action_required",
          download:
            "service_items metadata is public; restricted records require the user's official MDIS route.",
          restrictedAccess:
            "RAS/SDC approval and restricted microdata access require the user to apply on the official MDIS page.",
          researcherLogin: "not_used",
          userCookieStorage: "not_used",
        },
        retrieval: { status: "success", access: "anonymous_public_web" },
        access: "anonymous_public_web",
      };
      if (!page.selection) {
        result.selectionRequired = true;
        result.selectionHint =
          "자동으로 첫 service item을 고르지 않습니다. items에서 mappId, itmDiv, ofrSurvYm를 선택해 다시 요청하세요.";
      }
      if (page.codebook)
        result.codebookSource = sourceFor(
          publicCodebookUrl(),
          publicCodebookUrl(),
        );
      return result;
    } catch (error) {
      return {
        ...errorPayload(error, MDIS_SERVICE_CATALOG_SOURCE),
        metadataSource: "service_items",
        items: [],
        data: [],
        serviceItems: [],
        variables: [],
      };
    }
  }
  const detailPage = value.detailPage ?? 1;
  const survId = normalizedSurveyId(value);
  const itmDiv = value.itmDiv ?? "";
  const detailUrl = publicDetailUrl(survId, itmDiv, detailPage);
  try {
    const detail = await getMdisClient().getDetail({
      survId,
      itmDiv,
      detailPage,
    });
    const result: Record<string, unknown> = {
      success: true,
      ...detailData(detail, detailUrl),
      variables: [],
      variablePage: pageCompleteness(
        value.variablePage,
        value.pageSize,
        0,
        0,
        false,
        null,
      ),
      codebook: null,
    };
    const selection = datasetSelection(value);
    const wantsVariables =
      selection !== undefined ||
      value.query !== undefined ||
      value.downloadCodebook;
    if (!wantsVariables) {
      result.selectionRequired = true;
      result.selectionHint =
        "자동으로 첫 dataset을 고르지 않습니다. datasets에서 mappId, survAreaId, ofrSurvYm를 선택해 다시 요청하세요.";
      return result;
    }
    if (!selection) {
      return {
        ...result,
        success: false,
        errorCode: "SELECTION_REQUIRED",
        error:
          "변수·코드북 조회에는 실제 detail에서 선택한 mappId, survAreaId, ofrSurvYm가 모두 필요합니다.",
      };
    }
    const selectedDataset = detail.datasets.find((dataset) =>
      matchingDataset(dataset, selection, itmDiv),
    );
    if (!selectedDataset) {
      return {
        ...result,
        success: false,
        errorCode: "DATASET_MISMATCH",
        error:
          "요청한 dataset 식별자가 조사 detail에서 관찰한 선택지와 일치하지 않습니다.",
        selection,
      };
    }
    const variablesInput: MdisVariablesInput = {
      ...selection,
      itmDiv,
      survId,
      query: value.query,
      variablePage: value.variablePage,
      pageSize: value.pageSize,
    };
    const variables = await getMdisClient().getVariables(variablesInput);
    const variableUrl = new URL(
      "/ofrData/selectOfrDataItmDetail.do",
      MDIS_BASE_URL,
    ).toString();
    result.variables = variables.variables;
    result.variablePage = pageCompleteness(
      value.variablePage,
      value.pageSize,
      variables.variables.length,
      variables.total,
      variables.hasMore,
      variables.nextPage,
    );
    result.variableIdentityStatus = variables.identityStatus;
    result.variableSource = sourceFor(variableUrl, variableUrl);
    result.variableSnapshot = {
      srcobservedAt: variables.srcobservedAt,
      parserVersion: variables.parserVersion,
      hashSnapshot: variables.hashSnapshot,
    };
    result.selection = selectedDataset;
    if (value.downloadCodebook) {
      if (!selectedDataset.pmsSurvAreaId) {
        return {
          ...result,
          success: false,
          errorCode: "CODEBOOK_SELECTION_REQUIRED",
          error:
            "선택한 detail dataset에 공개 코드북의 pmsSurvAreaId가 없습니다.",
        };
      }
      const codebookInput: MdisCodebookInput = {
        mappId: selection.mappId,
        ofrSurvYm: selection.ofrSurvYm,
        ofrSurvAreaId: selectedDataset.ofrSurvAreaId ?? selection.survAreaId,
        pmsSurvAreaId: selectedDataset.pmsSurvAreaId,
        itmDiv,
      };
      const codebook = await getMdisClient().downloadCodebook(codebookInput);
      result.codebook = codebook;
      result.codebookSource = sourceFor(
        publicCodebookUrl(),
        publicCodebookUrl(),
      );
    }
    return result;
  } catch (error) {
    return {
      metadataSource: "survey_detail",
      ...errorPayload(error, detailUrl),
      survId,
      itmDiv,
      datasets: [],
      variables: [],
      selection: datasetSelection(value) ?? null,
    };
  }
}

export const MDIS_TOOL_PARSER_VERSION = MDIS_PARSER_VERSION;
