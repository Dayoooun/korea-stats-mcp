/**
 * 통계표 정보 조회 도구
 * 공식 getMeta 응답을 원문 그대로 탐색한다.
 */

import { z } from "zod";
import { getKosisClient } from "../api/client.js";
import { getCacheManager } from "../cache/index.js";
import {
  buildClassificationGroups,
  paginateMetadata,
  METADATA_PAGE_MAX,
  type MetadataRow,
} from "../utils/metadataPage.js";
import { handleToolError } from "../utils/errorHandler.js";

const metaTypes = ["TBL", "ORG", "PRD", "ITM", "UNIT", "SOURCE"] as const;
type MetaType = (typeof metaTypes)[number];

export const getTableInfoSchema = {
  name: "get_table_info",
  description:
    "통계표의 공식 메타데이터를 OBJ_ID 그룹과 원문 필드로 조회합니다. get_statistics_data와의 차원 대응은 공식 데이터 응답과 대조해야 합니다.",
  inputSchema: z.object({
    orgId: z.string().describe("기관 ID"),
    tableId: z.string().describe("통계표 ID"),
    infoType: z
      .enum(["ITM", "TBL", "PRD", "UNIT", "SOURCE"])
      .optional()
      .default("ITM")
      .describe(
        "조회 유형: ITM(분류/항목, 기본값), TBL(통계표명), PRD(수록정보), UNIT(단위), SOURCE(출처)",
      ),
    objId: z.string().optional().describe("ITM 메타데이터의 OBJ_ID로 필터"),
    parentId: z
      .string()
      .optional()
      .describe("ITM 메타데이터의 UP_ITM_ID로 필터"),
    query: z.string().optional().describe("ITM 원문 필드(코드·명칭) 검색어"),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .default(50)
      .describe("페이지 크기 (기본 50, 최대 200)"),
    cursor: z.string().optional().describe("이전 페이지의 서명된 nextCursor"),
  }),
};

export type GetTableInfoInput = z.infer<typeof getTableInfoSchema.inputSchema>;

export interface TableInfoResult {
  success: boolean;
  orgId: string;
  tableId: string;
  infoType?: MetaType;
  tableName?: string;
  periodInfo?: {
    periodType?: string;
    startPeriod?: string;
    endPeriod?: string;
  };
  unit?: string;
  source?: string;
  rawData?: MetadataRow[];
  classificationGroups?: Array<Record<string, unknown>>;
  metadataConfidence?: {
    level: "observed";
    source: "official_getMeta_ITM";
    dimensionMapping: "unverified";
    note: string;
  };
  totalCount?: number;
  returnedCount?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
  snapshot?: string;
  errorCode?: string;
  errorMessage?: string;
  usageHint?: string;
}

const ITM_CONFIDENCE: TableInfoResult["metadataConfidence"] = {
  level: "observed",
  source: "official_getMeta_ITM",
  dimensionMapping: "unverified",
  note: "OBJ_ID별 그룹과 ITM_ID, ITM_NM, UP_ITM_ID, OBJ_ID_SN, UNIT은 공식 getMeta 응답에서 관찰한 값이다. OBJ_ID를 get_statistics_data의 objLn으로 매핑하는 규칙은 확인하지 않았으며 추측하지 않는다.",
};

const ITM_USAGE_HINT =
  "공식 getMeta ITM 원문을 OBJ_ID별로 묶어 제공합니다. OBJ_ID_SN은 분류값 순번이며 차원 번호로 해석하지 않았습니다. get_statistics_data의 Cn_OBJ_NM/Cn/Cn_NM 응답과 대조해 차원 대응을 확인하세요.";

export async function getTableInfo(
  input: GetTableInfoInput,
): Promise<TableInfoResult> {
  const client = getKosisClient();
  const metaType = (input.infoType ?? "ITM") as MetaType;
  const pageSize = input.pageSize ?? 50;
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > METADATA_PAGE_MAX
  ) {
    return {
      success: false,
      orgId: input.orgId,
      tableId: input.tableId,
      infoType: metaType,
      errorCode: "INVALID_PAGE_SIZE",
      errorMessage: `pageSize는 1 이상 ${METADATA_PAGE_MAX} 이하의 정수여야 합니다.`,
      usageHint: `pageSize는 1 이상 ${METADATA_PAGE_MAX} 이하의 정수여야 합니다.`,
    };
  }

  try {
    const cache = getCacheManager();
    const results = (await cache.getTableMeta(
      {
        orgId: input.orgId,
        tableId: input.tableId,
        infoType: metaType,
        objId: input.objId,
        query: input.query,
      },
      async () =>
        client.getTableMeta(input.orgId, input.tableId, metaType, {
          objId: input.objId,
        }),
    )) as MetadataRow[];

    const base: Record<string, unknown> = {
      success: true,
      orgId: input.orgId,
      tableId: input.tableId,
      infoType: metaType,
    };

    // Keep the simple infoType calls useful while the shared paginator supplies
    // the same counters/cursor contract for every metadata type.
    const first = results[0] as Record<string, unknown> | undefined;
    if (metaType === "TBL") {
      base.tableName = first?.TBL_NM;
    } else if (metaType === "PRD") {
      base.periodInfo = {
        periodType: first?.PRD_SE,
        startPeriod: first?.STRT_PRD_DE,
        endPeriod: first?.END_PRD_DE,
      };
    } else if (metaType === "UNIT") {
      base.unit = first?.UNIT_NM;
    } else if (metaType === "SOURCE") {
      base.source = first?.JOSA_NM;
    } else if (metaType === "ITM") {
      base.metadataConfidence = ITM_CONFIDENCE;
      base.usageHint = ITM_USAGE_HINT;
    }

    const page = paginateMetadata(
      results,
      {
        orgId: input.orgId,
        tableId: input.tableId,
        infoType: metaType,
        objId: input.objId,
        parentId: input.parentId,
        query: input.query,
        pageSize,
        cursor: input.cursor,
      },
      {
        base,
        rowKey: "rawData",
        extras:
          metaType === "ITM"
            ? (pageRows) => ({
                classificationGroups: buildClassificationGroups(pageRows),
              })
            : undefined,
      },
    ) as unknown as TableInfoResult;

    if (results.length === 0 && !input.cursor && page.success) {
      return {
        ...page,
        success: false,
        usageHint:
          "메타데이터를 찾을 수 없습니다. orgId와 tableId를 확인해주세요.",
      };
    }
    return page;
  } catch (error) {
    const safeError = handleToolError(error);
    const errorCode =
      safeError.code === "UNKNOWN_ERROR" ? "METADATA_ERROR" : safeError.code;
    const knownError = errorCode !== "METADATA_ERROR";
    return {
      success: false,
      orgId: input.orgId,
      tableId: input.tableId,
      infoType: metaType,
      errorCode,
      errorMessage: safeError.error,
      usageHint: knownError
        ? safeError.error
        : "잠시 후 다시 시도하거나 조회 조건을 확인해주세요.",
    };
  }
}
