import type { StatisticsDataItem } from "../api/types.js";

export type ProvenanceInput = {
  readonly orgId: string;
  readonly tableId: string;
  readonly periodType: string;
  readonly objL1?: string;
  readonly objL2?: string;
  readonly objL3?: string;
  readonly objL4?: string;
  readonly objL5?: string;
  readonly objL6?: string;
  readonly objL7?: string;
  readonly objL8?: string;
  readonly itemId?: string;
  readonly startPeriod?: string;
  readonly endPeriod?: string;
  readonly recentCount?: number;
};

type ProvenanceOptions = {
  readonly queryPeriods?: readonly string[];
  readonly queriedAt: string;
  readonly readAt: string;
  readonly calculated: boolean;
  readonly appliedCalculations?: readonly string[];
  readonly calculationPolicies: readonly string[];
};

type RawObservationIdentity = {
  readonly orgId?: string;
  readonly tableId?: string;
  readonly itemId?: string;
  readonly periodType?: string;
  readonly period?: string;
  readonly unit?: string;
  readonly dimensions: Readonly<Record<string, string>>;
};

export type StatisticsProvenance = {
  readonly provider: "kosis";
  readonly orgId: string;
  readonly tableId: string;
  readonly sourceUrl?: string;
  readonly sourceUrls: readonly string[];
  readonly requestedQueryCount: number;
  readonly queryListTruncated: boolean;
  readonly queryScope: "requested_logical_queries";
  readonly upstreamRequestHistory: "not_recorded";
  readonly query: Readonly<Record<string, string | number>>;
  readonly queryList: readonly Readonly<Record<string, string | number>>[];
  readonly observedPeriods: readonly string[];
  readonly observedUnit: string | null;
  readonly rawObservationIds: readonly RawObservationIdentity[];
  readonly rawObservationCount: number;
  readonly rawObservationIdsTruncated: boolean;
  readonly queriedAt: string;
  readonly readAt: string;
  readonly timestampScope: "tool_observation";
  readonly timestampNote: "tool_observation_not_provider_refresh";
  readonly cacheFreshness: "unproven";
  readonly cacheAge: null;
  readonly providerUpdatedAt: null;
  readonly definition: null;
  readonly denominator: null;
  readonly boundary: null;
  readonly boundaryPolicy: "as_published";
  readonly reallocation: "none";
  readonly rescaling: "none";
  readonly calculated: boolean;
  readonly appliedCalculations: readonly string[];
  readonly calculationPolicies: readonly string[];
};

const KOSIS_DATA_URL =
  "https://kosis.kr/openapi/Param/statisticsParameterData.do";
const MAX_QUERY_LIST = 64;
const MAX_RAW_OBSERVATION_IDS = 200;
const UNKNOWN_UNIT =
  /^(?:unknown|n\/?a|na|null|미상|단위\s*미상|알\s*수\s*없음|-|…|\.\.\.)$/iu;

function clean(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function providerQuery(
  input: ProvenanceInput,
  period?: string,
): Readonly<Record<string, string | number>> {
  const query: Record<string, string | number> = {
    method: "getList",
    orgId: input.orgId,
    tblId: input.tableId,
    prdSe: input.periodType,
    format: "json",
    jsonVD: "Y",
  };
  for (let axis = 1; axis <= 8; axis += 1) {
    const value = clean(input[`objL${axis}` as keyof ProvenanceInput]);
    if (value !== undefined) query[`objL${axis}`] = value;
  }
  const itemId = clean(input.itemId);
  if (itemId !== undefined) query.itmId = itemId;
  if (period !== undefined) {
    query.startPrdDe = period;
    query.endPrdDe = period;
  } else if (input.startPeriod !== undefined || input.endPeriod !== undefined) {
    if (input.startPeriod !== undefined) query.startPrdDe = input.startPeriod;
    if (input.endPeriod !== undefined) query.endPrdDe = input.endPeriod;
  } else if (input.recentCount !== undefined) {
    query.newEstPrdCnt = input.recentCount;
  }
  return query;
}

function sourceUrl(query: Readonly<Record<string, string | number>>): string {
  const url = new URL(KOSIS_DATA_URL);
  const params = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    params.set(key, String(query[key]));
  }
  params.set("format", "json");
  params.set("jsonVD", "Y");
  // Deliberately omit apiKey: this is sanitized provenance, not a credential-bearing request URL.
  url.search = params.toString();
  return url.toString();
}

function rawIdentity(row: {
  readonly raw: StatisticsDataItem;
}): RawObservationIdentity {
  const raw = row.raw;
  const dimensions: Record<string, string> = {};
  for (let axis = 1; axis <= 8; axis += 1) {
    const value = clean(raw[`C${axis}` as keyof typeof raw]);
    if (value !== undefined) dimensions[`C${axis}`] = value;
  }
  return {
    orgId: clean(raw.ORG_ID),
    tableId: clean(raw.TBL_ID),
    itemId: clean(raw.ITM_ID),
    periodType: clean(raw.PRD_SE),
    period: clean(raw.PRD_DE),
    unit: clean(raw.UNIT_NM),
    dimensions,
  };
}

export function buildStatisticsProvenance(
  input: ProvenanceInput,
  rows: readonly { readonly raw: StatisticsDataItem }[],
  options: ProvenanceOptions,
): StatisticsProvenance {
  const periods = options.queryPeriods;
  const requestedQueryCount =
    periods && periods.length > 0 ? periods.length : 1;
  const queryList =
    periods && periods.length > 0
      ? periods
          .slice(0, MAX_QUERY_LIST)
          .map((period) => providerQuery(input, period))
      : [providerQuery(input)];
  const sourceUrls = queryList.map(sourceUrl);
  const observedPeriods = [
    ...new Set(
      rows
        .map((row) => clean(row.raw.PRD_DE))
        .filter((period): period is string => period !== undefined),
    ),
  ].sort();
  const units = rows.map((row) => clean(row.raw.UNIT_NM));
  const firstUnit = units[0];
  const observedUnit =
    options.calculated &&
    firstUnit !== undefined &&
    !UNKNOWN_UNIT.test(firstUnit) &&
    units.every((unit) => unit === firstUnit)
      ? firstUnit
      : null;
  const allRawObservationIds = rows
    .map(rawIdentity)
    .sort((left, right) =>
      (left.period ?? "").localeCompare(right.period ?? ""),
    );
  return {
    provider: "kosis",
    orgId: input.orgId,
    tableId: input.tableId,
    sourceUrl: sourceUrls[0],
    sourceUrls,
    requestedQueryCount,
    queryListTruncated: requestedQueryCount > queryList.length,
    queryScope: "requested_logical_queries",
    upstreamRequestHistory: "not_recorded",
    query: queryList[0],
    queryList,
    observedPeriods,
    observedUnit,
    rawObservationIds: allRawObservationIds.slice(0, MAX_RAW_OBSERVATION_IDS),
    rawObservationCount: allRawObservationIds.length,
    rawObservationIdsTruncated:
      allRawObservationIds.length > MAX_RAW_OBSERVATION_IDS,
    queriedAt: options.queriedAt,
    readAt: options.readAt,
    timestampScope: "tool_observation",
    timestampNote: "tool_observation_not_provider_refresh",
    cacheFreshness: "unproven",
    cacheAge: null,
    providerUpdatedAt: null,
    definition: null,
    denominator: null,
    boundary: null,
    boundaryPolicy: "as_published",
    reallocation: "none",
    rescaling: "none",
    calculated: options.calculated,
    appliedCalculations: options.calculated
      ? [...(options.appliedCalculations ?? [])]
      : [],
    calculationPolicies: [...options.calculationPolicies],
  };
}
