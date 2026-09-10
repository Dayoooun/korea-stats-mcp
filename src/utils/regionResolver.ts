import type { StatisticsDataItem } from "../api/types.js";
import { normalizeStatisticsPeriodType } from "./dataFormatter.js";
import {
  lookupCurrentSignguAffiliation,
  type SignguAffiliationFound,
  type SignguAffiliationLookup,
} from "../api/businesses.js";
import { getKosisClient } from "../api/client.js";
import { getCacheManager } from "../cache/index.js";
import { handleToolError } from "./errorHandler.js";
import {
  QUICK_STATS_PARAMS,
  type AlternativeTableProfile,
  type QuickStatsParam,
} from "../data/quickStatsParams.js";

type UnknownRecord = Record<string, unknown>;
type DimensionNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type RegionResolutionStatus =
  "none" | "resolved" | "ambiguous" | "not_found" | "unverified";

export interface RegionResolution {
  status: RegionResolutionStatus;
  requestedRegion?: string;
  regionName?: string;
  regionCode?: string;
  axis?: DimensionNumber;
  dimensions?: Record<string, string | undefined>;
  candidates?: string[];
  clarification?: string;
  reason?: string;
  searchPath?: string[];
  metadataRows?: UnknownRecord[];
  sampleRows?: StatisticsDataItem[];
  selectedParam?: QuickStatsParam;
  caveats?: string[];
  tableDiscovery?: TableDiscovery;
}

export type TableDiscoveryStatus =
  "not_triggered" | "searched" | "candidate_not_found" | "provider_error";
export type TableDiscoveryCandidateStatus =
  | "definition_mismatch"
  | "metadata_insufficient"
  | "matched"
  | "provider_error";
export interface TableDiscoveryDifference {
  field:
    | "source"
    | "period"
    | "item"
    | "definition"
    | "population"
    | "fixedDimensions";
  source?: string;
  candidate?: string;
}
export interface TableDiscoveryCandidate {
  orgId: string;
  tableId: string;
  tableName: string;
  status: TableDiscoveryCandidateStatus;
  differences: TableDiscoveryDifference[];
  missingEvidence: string[];
  caveats?: string[];
  evidence?: {
    sourceStatId?: string;
    candidateStatId?: string;
    sourceComments?: string[];
    candidateComments?: string[];
  };
}
export interface TableDiscovery {
  status: TableDiscoveryStatus;
  candidates: TableDiscoveryCandidate[];
  searchedCount: number;
  candidateLimit: 5;
  metadataCallBudget: number;
  metadataCalls: number;
  metadataComplete: boolean;
  selectedParam?: QuickStatsParam;
  selectedRegionName?: string;
  selectedRegionCode?: string;
  selectedAxis?: DimensionNumber;
  selectedDimensions?: Record<string, string | undefined>;
  caveats?: string[];
}

export interface RegionResolverOptions {
  requestedPeriod?: string;
  client?: {
    getTableMeta: (
      orgId: string,
      tableId: string,
      metaType?: "TBL" | "ORG" | "PRD" | "ITM" | "UNIT" | "SOURCE" | "CMMT",
      options?: { objId?: string; itmId?: string },
    ) => Promise<UnknownRecord[]>;
    getStatisticsData: (params: {
      orgId: string;
      tblId: string;
      objL1?: string;
      objL2?: string;
      objL3?: string;
      objL4?: string;
      objL5?: string;
      objL6?: string;
      objL7?: string;
      objL8?: string;
      itmId?: string;
      prdSe: string;
      newEstPrdCnt?: number;
      startPrdDe?: string;
      endPrdDe?: string;
    }) => Promise<StatisticsDataItem[]>;
    searchStatistics?: (
      searchNm: string,
      options?: {
        orgId?: string;
        sort?: "RANK" | "DATE";
        startCount?: number;
        resultCount?: number;
      },
    ) => Promise<UnknownRecord[]>;
    getStatisticsExplain?: (
      statId: string,
      metaItm?: string,
    ) => Promise<UnknownRecord[]>;
  };
  signguAffiliationLookup?: SignguAffiliationLookup;
  metadataRows?: UnknownRecord[];
  sampleRows?: StatisticsDataItem[];
  useCache?: boolean;
  requestedStartPeriod?: string;
  requestedEndPeriod?: string;
  disableAlternativeDiscovery?: boolean;
}

interface MetadataItem {
  row: UnknownRecord;
  id: string;
  name: string;
  parentId?: string;
}

interface AxisObservation {
  axis: DimensionNumber;
  groupId: string;
  groupName: string;
  observedNames: Set<string>;
}

const AXES: DimensionNumber[] = [1, 2, 3, 4, 5, 6, 7, 8];
const ADMINISTRATIVE_SUFFIX = /(특별자치도|특별자치시|광역시|특별시|도)$/;

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

/** NFC and whitespace normalization is deliberately limited to input matching. */
export function normalizeRegionName(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function compact(value: string): string {
  return normalizeRegionName(value).replace(/\s+/gu, "");
}

function canonicalText(value: string): string {
  return compact(value).toLocaleLowerCase("ko-KR");
}

// Conventional province abbreviations are exact name-only aliases.
const PROVINCE_NAME_EQUIVALENCES: readonly (readonly string[])[] = [
  ["충청북도", "충북"],
  ["충청남도", "충남"],
  ["전라북도", "전북특별자치도", "전북"],
  ["전라남도", "전남"],
  ["경상북도", "경북"],
  ["경상남도", "경남"],
];

const PROVINCE_ALIAS_GROUP_BY_NAME = new Map(
  PROVINCE_NAME_EQUIVALENCES.flatMap((group) =>
    group.map((value) => [canonicalText(value), group] as const),
  ),
);

function dimensionsFromParam(
  param: QuickStatsParam,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const axis of AXES) {
    result[`objL${axis}`] = param[`objL${axis}` as keyof QuickStatsParam] as
      string | undefined;
  }
  return result;
}

function metadataGroupName(row: UnknownRecord): string {
  return text(row.OBJ_NM) || text(row.OBJ_NAME) || text(row.OBJ_NM_KOR);
}

function metadataId(row: UnknownRecord): string {
  return text(row.ITM_ID) || text(row.ITM_CD) || text(row.CD);
}

function metadataName(row: UnknownRecord): string {
  return text(row.ITM_NM) || text(row.ITM_NAME) || text(row.CN_NM);
}

function officialAliases(name: string): Set<string> {
  const result = new Set<string>([canonicalText(name)]);
  const provinceAliases = PROVINCE_ALIAS_GROUP_BY_NAME.get(canonicalText(name));
  if (provinceAliases) {
    for (const alias of provinceAliases) result.add(canonicalText(alias));
  }
  const suffix = name.match(ADMINISTRATIVE_SUFFIX)?.[0];
  if (suffix) {
    const withoutSuffix = name.slice(0, -suffix.length);
    result.add(canonicalText(withoutSuffix));
  }
  return result;
}

function aliasesMatch(left: string, right: string): boolean {
  const leftAliases = officialAliases(left);
  const rightAliases = officialAliases(right);
  return [...leftAliases].some((value) => rightAliases.has(value));
}
function bareLocalityAliasMatches(
  requested: string,
  official: string,
): boolean {
  const requestedKey = canonicalText(requested);
  const officialKey = canonicalText(official);
  if (requestedKey.length < 2 || /[시군구]$/u.test(requestedKey)) return false;
  if (!/[시군구]$/u.test(officialKey)) return false;
  return requestedKey === officialKey.slice(0, -1);
}

function localityNamesMatch(requested: string, official: string): boolean {
  return (
    aliasesMatch(requested, official) ||
    bareLocalityAliasMatches(requested, official)
  );
}

function groupRows(rows: UnknownRecord[]): Map<string, UnknownRecord[]> {
  const groups = new Map<string, UnknownRecord[]>();
  for (const row of rows) {
    const id = text(row.OBJ_ID);
    if (!id) continue;
    const group = groups.get(id) ?? [];
    group.push(row);
    groups.set(id, group);
  }
  return groups;
}

function observeAxes(
  rows: UnknownRecord[],
  metadataRows: UnknownRecord[],
): AxisObservation[] {
  const groups = groupRows(metadataRows);
  const groupNames = [...groups.entries()]
    .map(([groupId, group]) => ({
      groupId,
      groupName: metadataGroupName(group[0] ?? {}),
    }))
    .filter((group) => group.groupName.length > 0);
  const observations: AxisObservation[] = [];

  for (const axis of AXES) {
    const observedNames = new Set<string>();
    for (const row of rows) {
      const name = text(row[`C${axis}_OBJ_NM`]);
      if (name) observedNames.add(name);
    }
    if (observedNames.size === 0) continue;
    for (const group of groupNames) {
      if (
        [...observedNames].some((name) => aliasesMatch(group.groupName, name))
      ) {
        observations.push({ ...group, axis, observedNames });
      }
    }
  }
  return observations;
}

function buildItems(rows: UnknownRecord[], groupId: string): MetadataItem[] {
  return rows
    .filter((row) => text(row.OBJ_ID) === groupId)
    .map((row) => ({
      row,
      id: metadataId(row),
      name: metadataName(row),
      parentId: text(row.UP_ITM_ID) || undefined,
    }))
    .filter((item) => item.id.length > 0 && item.name.length > 0);
}

function pathFor(
  item: MetadataItem,
  byId: Map<string, MetadataItem>,
): MetadataItem[] {
  const path: MetadataItem[] = [];
  const seen = new Set<string>();
  let current: MetadataItem | undefined = item;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

function pathText(path: MetadataItem[]): string {
  return path.map((item) => item.name).join(" ");
}

function candidateScore(
  requested: string,
  item: MetadataItem,
  path: MetadataItem[],
): number {
  const requestedKey = canonicalText(requested);
  const fullKey = canonicalText(pathText(path));
  const requestedCompact = compact(requested);
  const pathCompact = compact(pathText(path));
  let score = -1;
  const requestedTokens = (
    normalizeRegionName(requested).match(/[가-힣A-Za-z0-9]+/gu) ?? []
  )
    .map(canonicalText)
    .map(stripTrailingParticles);
  const itemKey = canonicalText(item.name);
  const itemAliases = officialAliases(item.name);
  if (requestedTokens.includes(itemKey)) {
    // An exact official item token outranks a province's shorthand alias
    // (e.g. 제주 -> 제주특별자치도 제주, not its parent).
    score = Math.max(score, 500 + path.length * 10);
  } else if (requestedTokens.some((token) => itemAliases.has(token))) {
    score = Math.max(score, 450 + path.length * 10);
  }
  if (aliasesMatch(requested, item.name))
    score = Math.max(score, 100 + item.name.length);
  if (
    /[시군구]$/u.test(item.name) &&
    requestedCompact.includes(canonicalText(item.name).slice(0, -1))
  ) {
    score = Math.max(score, 100 + item.name.length);
  }
  if (bareLocalityAliasMatches(requested, item.name))
    score = Math.max(score, 100 + item.name.length);
  const administrativeItem =
    ADMINISTRATIVE_SUFFIX.test(item.name) ||
    /[시군구]$/u.test(item.name) ||
    canonicalText(item.name) === canonicalText("전국");
  if (administrativeItem) {
    const aliases = officialAliases(item.name);
    if (
      [...aliases].some(
        (alias) => alias.length > 1 && requestedCompact.includes(alias),
      )
    ) {
      score = Math.max(score, 220 + path.length * 10);
    }
  }
  if (
    requestedKey === fullKey ||
    canonicalText(pathText(path)) === requestedKey
  )
    score = Math.max(score, 300 + path.length * 10);
  if (pathCompact && requestedCompact === pathCompact)
    score = Math.max(score, 400 + path.length * 10);
  if (requestedCompact.includes(pathCompact) && path.length > 1)
    score = Math.max(score, 350 + path.length * 10);
  return score;
}
const QUESTION_WORDS = new Set([
  "알려줘",
  "알려",
  "주세요",
  "보여줘",
  "보여",
  "조회",
  "조회해줘",
  "확인",
  "확인해줘",
  "검색",
  "찾아줘",
  "궁금해",
  "궁금",
  "알고싶어",
  "알고싶어요",
  "얼마",
  "얼마야",
  "얼마인가",
  "어때",
  "어떤",
  "뭐",
  "무엇",
  "통계",
  "데이터",
  "수치",
  "현황",
  "추세",
  "추이",
  "변화",
  "비교",
  "대해",
  "대한",
  "관련",
  "기준",
  "현재",
  "최근",
  "올해",
  "금년",
  "작년",
  "전년",
  "지난해",
  "우리나라",
  "대한민국",
  "한국",
  "국내",
  "지역별",
  "지역",
  "별",
  "수",
  "알려주세요",
  "말해줘",
  "말해주세요",
  "보고싶어",
  "얼마나",
  "어떻게",
  "돼",
  "되나요",
  "되나",
  "됩니까",
  "인가",
  "인가요",
  "있어",
  "있나요",
  "있습니까",
  "궁금합니다",
  "궁금한",
  "알",
  "어느",
  "어디",
  "무슨",
  "조회해",
  "해줘",
  "알려드려",
  "알려드리",
  "설명",
  "좀",
  "뭐야",
  "뭐지",
  "일까요",
  "할까요",
  "알려줄래",
  "알려줄래요",
  "몇명",
  "어느정도",
  "자료",
  "정보",
  "내용",
  "결과",
  "값",
  "숫자",
]);
function isRequestPredicateToken(value: string): boolean {
  const token = canonicalText(value);
  const stems = [
    "알려주",
    "보여주",
    "말해주",
    "설명해",
    "조회해",
    "확인해",
    "검색해",
    "찾아주",
    "찾아",
    "알고싶",
    "궁금하",
  ];
  const endings =
    /(실래요|실래|주세요|주실까요|줄래요|줄래|줘요|줘|할까요|할래요|할래)$/u;
  return stems.some((stem) => token.startsWith(stem)) && endings.test(token);
}

function sameQuickStatsSelection(
  left: QuickStatsParam,
  right: QuickStatsParam,
): boolean {
  return (
    left.orgId === right.orgId &&
    left.tableId === right.tableId &&
    left.itemId === right.itemId &&
    AXES.every(
      (axis) =>
        left[`objL${axis}` as keyof QuickStatsParam] ===
        right[`objL${axis}` as keyof QuickStatsParam],
    )
  );
}

function quickStatsAliases(param: QuickStatsParam): string[] {
  return Object.entries(QUICK_STATS_PARAMS)
    .filter(([, candidate]) => sameQuickStatsSelection(param, candidate))
    .map(([alias]) => canonicalText(alias))
    .filter((alias) => alias.length > 1);
}
function contextTerms(param: QuickStatsParam): string[] {
  const terms = new Set<string>();
  for (const field of [param.tableName, param.description]) {
    for (const token of field.match(/[가-힣A-Za-z0-9]+/gu) ?? []) {
      const key = canonicalText(token);
      if (key.length < 2) continue;
      terms.add(key);
      for (let start = 0; start < key.length - 1; start += 1) {
        for (let end = start + 2; end <= key.length; end += 1) {
          terms.add(key.slice(start, end));
        }
      }
    }
  }
  // Only aliases registered for this parameter count as query vocabulary.
  // Unmatched words remain locality candidates and therefore fail closed.
  for (const alias of quickStatsAliases(param)) terms.add(alias);
  return [...terms].sort((left, right) => right.length - left.length);
}

function stripTrailingParticles(value: string): string {
  let result = value;
  while (
    result.length > 1 &&
    !ADMINISTRATIVE_SUFFIX.test(result) &&
    !/[시군구]$/u.test(result) &&
    /[은는이가을를의에에서로와과랑부터까지만요]$/u.test(result)
  ) {
    result = result.slice(0, -1);
  }
  return result;
}
function stripQuestionSuffix(value: string): string {
  const suffixes = [
    "인가요",
    "입니까",
    "습니까",
    "되나요",
    "되나",
    "돼요",
    "해요",
    "합니까",
    "인가",
    "이야",
    "이죠",
    "나요",
    "어요",
    "에요",
    "까요",
    "겠어",
    "합니다",
    "해",
    "야",
    "죠",
  ];
  for (const suffix of suffixes) {
    if (value.endsWith(suffix) && value.length > suffix.length + 1) {
      return value.slice(0, -suffix.length);
    }
  }
  return value;
}

function queryRemainderTokens(param: QuickStatsParam, query: string): string[] {
  const terms = contextTerms(param);
  const tokens: string[] = [];
  for (const rawToken of normalizeRegionName(query).match(
    /[가-힣A-Za-z0-9]+/gu,
  ) ?? []) {
    let token = canonicalText(rawToken);
    if (isRequestPredicateToken(token)) continue;
    if (/^\d{4}(?:년)?$/u.test(token)) continue;
    token = stripTrailingParticles(token);
    for (const term of terms) {
      token = token.split(term).join("");
      if (!token) break;
    }
    if (!token) continue;
    token = stripQuestionSuffix(token);
    token = stripTrailingParticles(token);
    if (!token || QUESTION_WORDS.has(token)) continue;
    if (token.length > 1 && !QUESTION_WORDS.has(token)) tokens.push(token);
  }
  return [...new Set(tokens)];
}

function metadataRegionRow(row: UnknownRecord): boolean {
  const name = metadataName(row);
  return (
    canonicalText(name) === canonicalText("전국") ||
    Boolean(text(row.UP_ITM_ID)) ||
    ADMINISTRATIVE_SUFFIX.test(name) ||
    /[시군구]$/u.test(name)
  );
}
function ancestorMetadataAliases(
  item: MetadataItem,
  items: MetadataItem[],
): string[] {
  const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
  const aliases: string[] = [];
  const seen = new Set<string>();
  let parent = item.parentId ? byId.get(item.parentId) : undefined;
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    aliases.push(
      ...[...officialAliases(parent.name)].filter((alias) => alias.length > 1),
    );
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return aliases;
}

/**
 * Match an official alias only as a region token. A substring such as 대구 in
 * 해운대구 or 서구 in 강서구 is not a token; a contiguous parent/child path
 * (부산해운대구) is accepted through the ancestor check.
 */
function requestedAliasMatches(
  requested: string,
  alias: string,
  item: MetadataItem,
  items: MetadataItem[],
): boolean {
  const requestedKey = canonicalText(requested);
  const aliasKey = canonicalText(alias);
  if (aliasKey.length < 2) return false;
  const tokenKeys = (
    normalizeRegionName(requested).match(/[가-힣A-Za-z0-9]+/gu) ?? []
  )
    .map(canonicalText)
    .map(stripTrailingParticles);
  if (tokenKeys.includes(aliasKey)) return true;
  const ancestors = ancestorMetadataAliases(item, items).map(canonicalText);
  let index = requestedKey.indexOf(aliasKey);
  while (index >= 0) {
    if (index === 0) {
      const remainder = requestedKey.slice(aliasKey.length);
      if (!remainder || !ADMINISTRATIVE_SUFFIX.test(remainder)) return true;
    }
    const prefix = requestedKey.slice(0, index);
    if (ancestors.some((ancestor) => prefix.endsWith(ancestor))) return true;
    index = requestedKey.indexOf(aliasKey, index + 1);
  }
  return false;
}

function queryMetadataNames(rows: UnknownRecord[], query: string): string[] {
  const names: string[] = [];
  for (const [groupId] of groupRows(rows)) {
    const items = buildItems(rows, groupId);
    for (const item of items) {
      if (
        metadataRegionRow(item.row) &&
        [...officialAliases(item.name)].some((alias) =>
          requestedAliasMatches(query, alias, item, items),
        )
      ) {
        names.push(item.name);
      }
    }
  }
  return [...new Set(names)];
}

function requestComponents(
  param: QuickStatsParam,
  requested: string,
  items: MetadataItem[],
): string[] {
  const remainder = queryRemainderTokens(param, requested);
  const requestedRegion = remainder.join(" ") || requested;
  const aliases = [
    ...new Set(
      items.flatMap((item) =>
        [...officialAliases(item.name)]
          .filter(
            (alias) =>
              alias.length > 1 &&
              requestedAliasMatches(requestedRegion, alias, item, items),
          )
          .map(canonicalText),
      ),
    ),
  ].sort((left, right) => right.length - left.length);
  const components = new Set<string>();
  for (const item of items) {
    if (
      [...officialAliases(item.name)].some(
        (alias) =>
          alias.length > 1 &&
          requestedAliasMatches(requestedRegion, alias, item, items),
      )
    ) {
      components.add(item.name);
    }
  }
  for (const token of remainder) {
    let covered = token;
    for (const alias of aliases) {
      covered = covered.split(alias).join("");
      if (!covered) break;
    }
    if (covered) components.add(token);
  }
  return [...components];
}

function pathAccountsComponents(
  components: string[],
  path: MetadataItem[],
): boolean {
  return components.every((component) =>
    path.some((item) => localityNamesMatch(component, item.name)),
  );
}

function candidateMatchesRequest(
  param: QuickStatsParam,
  requested: string,
  item: MetadataItem,
  path: MetadataItem[],
  items: MetadataItem[],
): boolean {
  if (candidateScore(requested, item, path) < 0) return false;
  return pathAccountsComponents(
    requestComponents(param, requested, items),
    path,
  );
}
interface PartialRegionCandidate {
  observation: AxisObservation;
  item: MetadataItem;
  path: MetadataItem[];
  missingComponent: string;
}

function isMetadataRoot(item: MetadataItem): boolean {
  return canonicalText(item.name) === canonicalText("전국");
}

function pathMatchesRequestedContext(
  requested: string,
  path: MetadataItem[],
  items: MetadataItem[],
): boolean {
  return path.every(
    (item) =>
      isMetadataRoot(item) ||
      [...officialAliases(item.name)].some((alias) =>
        requestedAliasMatches(requested, alias, item, items),
      ),
  );
}
function partialRequestHasNoExtraTokens(
  param: QuickStatsParam,
  requested: string,
  path: MetadataItem[],
  missingComponent: string,
): boolean {
  const aliases = new Set<string>([
    ...path.flatMap((item) => [...officialAliases(item.name)]),
    ...officialAliases(missingComponent),
  ]);
  const terms = new Set(contextTerms(param));
  for (const rawToken of normalizeRegionName(requested).match(
    /[가-힣A-Za-z0-9]+/gu,
  ) ?? []) {
    const rawKey = canonicalText(rawToken);
    if (rawKey.length <= 1) {
      if (/^[은는이가을를의에에서로와과랑부터까지만요]$/u.test(rawKey)) {
        continue;
      }
      return false;
    }
    const stripped = stripTrailingParticles(stripQuestionSuffix(rawKey));
    if (
      QUESTION_WORDS.has(rawKey) ||
      QUESTION_WORDS.has(stripped) ||
      terms.has(rawKey) ||
      terms.has(stripped) ||
      aliases.has(rawKey) ||
      aliases.has(stripped)
    ) {
      continue;
    }
    if (/^\d{4}(?:년)?$/u.test(rawKey)) continue;
    return false;
  }
  return true;
}

function isObservedLeaf(item: MetadataItem, items: MetadataItem[]): boolean {
  return !items.some(
    (candidate) => candidate.id !== item.id && candidate.parentId === item.id,
  );
}

function partialRegionCandidates(
  param: QuickStatsParam,
  requested: string,
  observation: AxisObservation,
  items: MetadataItem[],
): PartialRegionCandidate[] {
  const components = requestComponents(param, requested, items);
  if (components.length === 0) return [];
  const byId = new Map(items.map((item) => [item.id, item]));
  return items
    .map((item) => {
      const path = pathFor(item, byId);
      const missing = components.filter(
        (component) =>
          !path.some((pathItem) =>
            localityNamesMatch(component, pathItem.name),
          ),
      );
      return { item, path, missing };
    })
    .filter(
      ({ item, path, missing }) =>
        metadataRegionRow(item.row) &&
        isObservedLeaf(item, items) &&
        candidateScore(requested, item, path) >= 0 &&
        pathMatchesRequestedContext(requested, path, items) &&
        missing.length === 1 &&
        /시$/u.test(canonicalText(missing[0])) &&
        partialRequestHasNoExtraTokens(param, requested, path, missing[0]),
    )
    .map(({ item, path, missing }) => ({
      observation,
      item,
      path,
      missingComponent: missing[0],
    }));
}

function isProviderMultiSelector(value: unknown): boolean {
  const normalized = text(value);
  return (
    normalized === "*" ||
    normalized.toUpperCase() === "ALL" ||
    normalized.toUpperCase() === "SUM" ||
    normalized.includes(",")
  );
}

function looksLikeRegionRequest(value: string): boolean {
  const normalized = normalizeRegionName(value);
  return /(특별자치도|특별자치시|광역시|특별시|[시도군구])(?:\s|$|의|별)/u.test(
    normalized,
  );
}

function searchPath(param: QuickStatsParam, requested: string): string[] {
  const query = encodeURIComponent(requested);
  return [
    `get_table_info({"orgId":"${param.orgId}","tableId":"${param.tableId}","infoType":"ITM","query":"${requested}"})`,
    `search_statistics("${requested}")`,
    `KOSIS official metadata: orgId=${param.orgId}, tableId=${param.tableId}, query=${query}`,
  ];
}

function boundedDiscoveryText(value: unknown, limit = 120): string {
  return text(value)
    .replace(/\p{Cc}+/gu, " ")
    .slice(0, limit);
}

function metadataField(row: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const value = boundedDiscoveryText(row[key]);
    if (value) return value;
  }
  return "";
}

function distinctEvidence(rows: UnknownRecord[], keys: string[]): string[] {
  return [
    ...new Set(
      rows
        .map((row) => metadataField(row, keys))
        .filter((value) => value.length > 0),
    ),
  ].slice(0, 4);
}

function sourceEvidence(rows: UnknownRecord[]): {
  id?: string;
  name?: string;
  text?: string;
} {
  const id = distinctEvidence(rows, [
    "STAT_ID",
    "STATID",
    "SOURCE_ID",
    "SOURCE_STAT_ID",
  ])[0];
  const name = distinctEvidence(rows, [
    "STAT_NM",
    "STAT_NAME",
    "SOURCE_NM",
    "SOURCE_NAME",
    "SOURCE_STAT_NM",
  ])[0];
  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(id || name ? { text: [id, name].filter(Boolean).join(" ") } : {}),
  };
}

function periodEvidence(rows: UnknownRecord[]): string[] {
  return distinctEvidence(rows, [
    "PRD_NM",
    "PRD_NAME",
    "PRD_SE_NM",
    "수록주기",
    "PERIOD",
    "PERIOD_NM",
    "CYCLE",
    "CYCLE_NM",
    "PRD_SE",
  ]);
}

function periodMatchesRequested(values: string[], requested?: string): boolean {
  if (!requested || values.length === 0) return false;
  const key = canonicalText(requested);
  const expected =
    key === "y" || key === "년" || key === "연간"
      ? "Y"
      : key === "m" || key === "월" || key === "월별"
        ? "M"
        : key === "q" || key === "분기" || key === "분기별"
          ? "Q"
          : key === "h" || key === "반기" || key === "반기별"
            ? "H"
            : undefined;
  if (!expected) return false;
  return values.some((value) => {
    const normalized = canonicalText(value);
    if (expected === "Y")
      return (
        normalized === "y" ||
        normalized === "년" ||
        normalized === "연간" ||
        normalized.includes("년") ||
        normalized.includes("연간") ||
        /(?:^|[/,|])y(?:$|[/,|])/u.test(normalized)
      );
    if (expected === "M")
      return (
        normalized === "m" ||
        normalized === "월" ||
        normalized === "월별" ||
        normalized.includes("월") ||
        /(?:^|[/,|])m(?:$|[/,|])/u.test(normalized)
      );
    if (expected === "Q")
      return (
        normalized === "q" ||
        normalized === "분기" ||
        normalized === "분기별" ||
        normalized.includes("분기") ||
        /(?:^|[/,|])q(?:$|[/,|])/u.test(normalized)
      );
    return (
      normalized === "h" ||
      normalized === "반기" ||
      normalized === "반기별" ||
      normalized.includes("반기") ||
      /(?:^|[/,|])h(?:$|[/,|])/u.test(normalized)
    );
  });
}

interface PositiveDiscoveryProof {
  selectedParam: QuickStatsParam;
  regionName: string;
  regionCode: string;
  axis: DimensionNumber;
  dimensions: Record<string, string | undefined>;
  caveats: string[];
  evidence: {
    sourceStatId: string;
    candidateStatId: string;
    sourceComments: string[];
    candidateComments: string[];
  };
}
function candidateItemEvidence(
  rows: UnknownRecord[],
  param: QuickStatsParam,
): { id?: string; text?: string } {
  const itemRows = rows.filter((row) => metadataId(row).length > 0);
  const selected =
    itemRows.find((row) => metadataId(row) === param.itemId) ??
    itemRows.find((row) =>
      canonicalText(metadataName(row)).includes(
        canonicalText(param.description),
      ),
    ) ??
    itemRows.find((row) => metadataName(row).length > 0);
  if (!selected) return {};
  const id = metadataId(selected);
  const name = metadataName(selected);
  const unit = metadataField(selected, ["UNIT_NM", "UNIT_NAME", "UNIT"]);
  return {
    ...(id ? { id } : {}),
    ...(id || name || unit
      ? { text: [id, name, unit ? `(${unit})` : ""].filter(Boolean).join(" ") }
      : {}),
  };
}

function hasDefinitionEvidence(rows: UnknownRecord[]): boolean {
  return rows.some((row) =>
    [
      "mainTermExpl",
      "goalPoplExmnPopl",
      "examinObjrange",
      "examinObjArea",
      "examinTrgetPd",
      "statsPeriod",
      "pubPeriod",
    ].some((key) => boundedDiscoveryText(row[key]).length > 0),
  );
}

function definitionField(
  row: UnknownRecord,
  name: "statsNm" | "statsPeriod" | "examinTrgetPd" | "goalPoplExmnPopl",
): unknown {
  const uppercase: Record<string, string> = {
    statsNm: "STATS_NM",
    statsPeriod: "STATS_PERIOD",
    examinTrgetPd: "EXAMIN_TRGET_PD",
    goalPoplExmnPopl: "GOAL_POPL_EXMN_POPL",
  };
  return row[name] ?? row[uppercase[name]];
}
function normalizeDefinitionValue(value: unknown): string {
  if (typeof value !== "string" || value.length > 1024) return "";
  return value
    .normalize("NFC")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function definitionMatchesProfile(
  rows: UnknownRecord[],
  profile: AlternativeTableProfile,
): boolean {
  return rows.some(
    (row) =>
      normalizeDefinitionValue(definitionField(row, "statsNm")) ===
        normalizeDefinitionValue(profile.definition.statsNm) &&
      normalizeDefinitionValue(definitionField(row, "statsPeriod")) ===
        normalizeDefinitionValue(profile.definition.statsPeriod) &&
      normalizeDefinitionValue(definitionField(row, "examinTrgetPd")) ===
        normalizeDefinitionValue(profile.definition.examinTrgetPd) &&
      normalizeDefinitionValue(definitionField(row, "goalPoplExmnPopl")) ===
        normalizeDefinitionValue(profile.definition.goalPoplExmnPopl),
  );
}

function commentEvidence(rows: UnknownRecord[]): string[] {
  const fields = [
    "CMMT_DC",
    "CMMT",
    "CMMT_CN",
    "COMMENT",
    "COMMENT_NM",
    "NOTE",
    "NOTE_NM",
    "CNTN",
    "CN",
    "dataUserNote",
    "DATA_USER_NOTE",
  ];
  return [
    ...new Set(
      rows
        .map((row) => metadataField(row, fields))
        .filter((value) => /발생월|확정|반올림|소급|코드/u.test(value))
        .map((value) => boundedDiscoveryText(value, 180)),
    ),
  ].slice(0, 4);
}

function profileExactParam(
  param: QuickStatsParam,
  profile: AlternativeTableProfile,
): boolean {
  return (
    param.orgId === profile.source.orgId &&
    param.tableId === profile.source.tableId &&
    param.itemId === profile.source.itemId &&
    Object.entries(profile.source.fixedDimensions).every(
      ([key, value]) => param[key as keyof QuickStatsParam] === value,
    )
  );
}
function periodRange(rows: UnknownRecord[]): { start?: string; end?: string } {
  const first = (keys: string[]): string | undefined =>
    rows
      .flatMap((row) => keys.map((key) => boundedDiscoveryText(row[key])))
      .find(Boolean);
  return {
    start: first(["STRT_PRD_DE", "START_PRD_DE", "START_PERIOD", "STRT_PRD"]),
    end: first(["END_PRD_DE", "END_PERIOD", "END_PRD"]),
  };
}
function periodCoverageIncludes(
  rows: UnknownRecord[],
  start?: string,
  end?: string,
): boolean {
  if (!start && !end) return true;
  const coverage = periodRange(rows);
  if (!coverage.start || !coverage.end) return false;
  return (!start || coverage.start <= start) && (!end || coverage.end >= end);
}

function profileCandidateParam(
  profile: AlternativeTableProfile,
  base: QuickStatsParam,
  tableName: string,
  dimensions: Record<string, string | undefined>,
): QuickStatsParam {
  return {
    orgId: profile.candidate.orgId,
    tableId: profile.candidate.tableId,
    tableName,
    description: base.description,
    ...dimensions,
    objL1: dimensions.objL1 ?? "ALL",
    itemId: profile.candidate.itemId,
    unit: "",
    supportedPeriods: ["Y"],
  };
}
async function proveBirthAlternative(
  param: QuickStatsParam,
  requested: string,
  profile: AlternativeTableProfile,
  work: {
    orgId: string;
    tableId: string;
    tableName: string;
    searchStatId?: string;
    sourceRows: UnknownRecord[];
    periodRows: UnknownRecord[];
    itemRows: UnknownRecord[];
    commentRows: UnknownRecord[];
    explainRows: UnknownRecord[];
  },
  sourcePrdRows: UnknownRecord[],
  sourceStatId: string | undefined,
  options: RegionResolverOptions,
  reserveMetadataCall: () => boolean,
): Promise<PositiveDiscoveryProof | undefined> {
  const inProfileCoverage =
    (!options.requestedStartPeriod ||
      options.requestedStartPeriod >= profile.candidate.coverage.start) &&
    (!options.requestedEndPeriod ||
      options.requestedEndPeriod <= profile.candidate.coverage.end);
  const candidateSource = sourceEvidence(work.sourceRows);
  if (
    !inProfileCoverage ||
    !profileExactParam(param, profile) ||
    work.orgId !== profile.candidate.orgId ||
    !options.metadataRows ||
    !profile.source.metadataBindings.every((binding) =>
      options.metadataRows!.some(
        (row) =>
          text(row.OBJ_ID) === binding.objectId &&
          metadataId(row) === binding.itemId &&
          normalizeDefinitionValue(metadataName(row)) ===
            normalizeDefinitionValue(binding.itemName),
      ),
    ) ||
    options.metadataRows.some(
      (row) => !profile.source.allowedObjectIds.includes(text(row.OBJ_ID)),
    ) ||
    !periodMatchesRequested(
      periodEvidence(sourcePrdRows),
      profile.requiredPeriod,
    ) ||
    work.tableId !== profile.candidate.tableId ||
    sourceStatId !== profile.source.sourceStatId ||
    candidateSource.id !== profile.source.sourceStatId ||
    work.searchStatId !== profile.source.sourceStatId ||
    !periodMatchesRequested(
      periodEvidence(work.periodRows),
      profile.requiredPeriod,
    ) ||
    !periodCoverageIncludes(
      work.periodRows.filter((row) =>
        periodMatchesRequested(periodEvidence([row]), "Y"),
      ),
      options.requestedStartPeriod,
      options.requestedEndPeriod,
    ) ||
    !periodCoverageIncludes(
      sourcePrdRows.filter((row) =>
        periodMatchesRequested(periodEvidence([row]), "Y"),
      ),
      options.requestedStartPeriod,
      options.requestedEndPeriod,
    ) ||
    !definitionMatchesProfile(work.explainRows, profile)
  ) {
    return undefined;
  }

  const item = work.itemRows.find(
    (row) =>
      text(row.OBJ_ID) === profile.candidate.itemObjectId &&
      metadataId(row) === profile.candidate.itemId &&
      profile.aliases.some(
        (alias) => canonicalText(metadataName(row)) === canonicalText(alias),
      ),
  );
  const geographyRows = work.itemRows.filter(
    (row) => text(row.OBJ_ID) === profile.candidate.objectId,
  );
  if (
    !item ||
    work.itemRows.some(
      (row) => !profile.candidate.allowedObjectIds.includes(text(row.OBJ_ID)),
    ) ||
    !geographyRows.some((row) =>
      localityNamesMatch(metadataGroupName(row), profile.candidate.objectName),
    )
  ) {
    return undefined;
  }

  const candidateClient = options.client ?? getKosisClient();
  if (!reserveMetadataCall()) return undefined;
  let sourceCommentRows: UnknownRecord[];
  try {
    sourceCommentRows = asUnknownRecords(
      await invokeMetadata(() =>
        candidateClient.getTableMeta(
          profile.source.orgId,
          profile.source.tableId,
          "CMMT",
        ),
      ),
    );
  } catch {
    return undefined;
  }

  let probeRows: StatisticsDataItem[];
  try {
    const rows = await invokeMetadata(() =>
      candidateClient.getStatisticsData({
        orgId: profile.candidate.orgId,
        tblId: profile.candidate.tableId,
        itmId: profile.candidate.itemId,
        prdSe: profile.requiredPeriod,
        objL1: "ALL",
        ...(options.requestedStartPeriod
          ? {
              startPrdDe:
                options.requestedEndPeriod ?? options.requestedStartPeriod,
              endPrdDe:
                options.requestedEndPeriod ?? options.requestedStartPeriod,
            }
          : { newEstPrdCnt: 1 }),
      }),
    );
    probeRows = Array.isArray(rows) ? rows : [];
  } catch {
    return undefined;
  }
  if (
    probeRows.length === 0 ||
    probeRows.some(
      (row) =>
        text(row.ORG_ID) !== profile.candidate.orgId ||
        text(row.TBL_ID) !== profile.candidate.tableId ||
        text(row.ITM_ID) !== profile.candidate.itemId ||
        normalizeStatisticsPeriodType(text(row.PRD_SE)) !== "Y" ||
        !/^\d{4}$/u.test(text(row.PRD_DE)) ||
        text(row.PRD_DE) < profile.candidate.coverage.start ||
        text(row.PRD_DE) > profile.candidate.coverage.end,
    )
  ) {
    return undefined;
  }
  const requestedProbePeriod =
    options.requestedEndPeriod ?? options.requestedStartPeriod;
  if (
    new Set(probeRows.map((row) => text(row.PRD_DE))).size !== 1 ||
    (requestedProbePeriod &&
      probeRows.some((row) => text(row.PRD_DE) !== requestedProbePeriod))
  ) {
    return undefined;
  }

  const candidateParam = profileCandidateParam(
    profile,
    param,
    work.tableName,
    {},
  );
  const candidateResolution = await resolveRegion(candidateParam, requested, {
    ...options,
    metadataRows: work.itemRows,
    sampleRows: probeRows,
    useCache: false,
    disableAlternativeDiscovery: true,
    requestedPeriod: "Y",
  });
  if (
    candidateResolution.status !== "resolved" ||
    !candidateResolution.regionCode ||
    candidateResolution.axis === undefined ||
    !candidateResolution.dimensions
  ) {
    return undefined;
  }
  const candidateAxis = candidateResolution.axis;
  if (
    probeRows.some((row) =>
      AXES.some(
        (axis) =>
          axis !== candidateAxis &&
          (text(row[`C${axis}`]) ||
            text(row[`C${axis}_NM`]) ||
            text(row[`C${axis}_OBJ_NM`])),
      ),
    )
  )
    return undefined;
  const observedRegion = probeRows.some((row) => {
    const code = text(row[`C${candidateAxis}`]);
    const name = text(row[`C${candidateAxis}_NM`]);
    const objectName = text(row[`C${candidateAxis}_OBJ_NM`]);
    const nameMatches =
      localityNamesMatch(name, requested) ||
      canonicalText(name).includes(canonicalText(requested)) ||
      (candidateResolution.regionName ?? "")
        .split(/\s+/u)
        .some((part) => localityNamesMatch(name, part));
    return (
      code === candidateResolution.regionCode &&
      localityNamesMatch(objectName, profile.candidate.objectName) &&
      nameMatches
    );
  });
  if (!observedRegion) return undefined;
  if (sourceCommentRows.length === 0 || work.commentRows.length === 0) {
    return undefined;
  }
  const sourceComments = commentEvidence(sourceCommentRows);
  const candidateComments = commentEvidence(work.commentRows);
  const sourceCommentText = sourceComments.join(" ").replace(/\s+/gu, "");
  const candidateCommentText = candidateComments.join(" ").replace(/\s+/gu, "");
  if (
    !["출생", "발생월", "8월", "확정"].every((marker) =>
      sourceCommentText.includes(marker),
    )
  )
    return undefined;
  if (
    !["백단위", "반올림", "코드", "소급"].every((marker) =>
      candidateCommentText.includes(marker),
    )
  )
    return undefined;
  return {
    selectedParam: profileCandidateParam(
      profile,
      param,
      work.tableName,
      candidateResolution.dimensions,
    ),
    regionName: candidateResolution.regionName ?? requested,
    regionCode: candidateResolution.regionCode,
    axis: candidateResolution.axis,
    dimensions: candidateResolution.dimensions,
    caveats: [
      ...profile.caveats,
      ...sourceComments,
      ...candidateComments,
    ].slice(0, 8),
    evidence: {
      sourceStatId: profile.source.sourceStatId,
      candidateStatId: candidateSource.id ?? "",
      sourceComments,
      candidateComments,
    },
  };
}
function discoveryDifference(
  field: TableDiscoveryDifference["field"],
  sourceValue: string,
  candidateValue: string,
): TableDiscoveryDifference {
  return {
    field,
    ...(sourceValue ? { source: boundedDiscoveryText(sourceValue) } : {}),
    ...(candidateValue
      ? { candidate: boundedDiscoveryText(candidateValue) }
      : {}),
  };
}

function isExplicitMunicipality(
  param: QuickStatsParam,
  requested: string,
): boolean {
  const remainder = queryRemainderTokens(param, requested);
  return (
    looksLikeRegionRequest(requested) ||
    remainder.some(
      (token) => !quickStatsAliases(param).includes(canonicalText(token)),
    )
  );
}

const DISCOVERY_METADATA_BUDGET = 16;
function emptyDiscovery(
  status: TableDiscoveryStatus,
  metadataCalls = 0,
): TableDiscovery {
  return {
    status,
    candidates: [],
    searchedCount: 0,
    candidateLimit: 5,
    metadataCallBudget: DISCOVERY_METADATA_BUDGET,
    metadataCalls,
    metadataComplete: status !== "provider_error",
  };
}

async function boundedMap<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await worker(values[index], index);
    }
  }
  const workers = Math.min(Math.max(concurrency, 1), values.length);
  await Promise.all(Array.from({ length: workers }, () => run()));
  return output;
}
function asUnknownRecords(rows: unknown): UnknownRecord[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is UnknownRecord =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );
}
function invokeMetadata<T>(operation: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(operation);
}
async function discoverAlternativeTables(
  param: QuickStatsParam,
  requested: string,
  options: RegionResolverOptions,
): Promise<TableDiscovery> {
  const client = options.client ?? getKosisClient();
  const candidateLimit = 5 as const;
  if (typeof client.searchStatistics !== "function") {
    return emptyDiscovery("provider_error");
  }

  const searchTerm = `${param.description} 시군구`;
  let searchRows: UnknownRecord[];
  try {
    const rows = await client.searchStatistics(searchTerm, {
      orgId: param.orgId,
      sort: "RANK",
      startCount: 1,
      resultCount: candidateLimit,
    });
    if (!Array.isArray(rows)) return emptyDiscovery("provider_error");
    searchRows = asUnknownRecords(rows);
  } catch {
    return emptyDiscovery("provider_error");
  }

  const distinct = new Map<string, UnknownRecord>();
  for (const row of searchRows) {
    const orgId = boundedDiscoveryText(row.ORG_ID);
    const tableId = boundedDiscoveryText(row.TBL_ID);
    if (!orgId || !tableId) continue;
    const key = `${orgId}:${tableId}`;
    if (!distinct.has(key)) distinct.set(key, row);
    if (distinct.size >= candidateLimit) break;
  }
  if (distinct.size === 0) return emptyDiscovery("candidate_not_found");

  const metadataCallBudget = DISCOVERY_METADATA_BUDGET;
  let metadataCalls = 0;
  let originalSource: UnknownRecord[] = [];
  let originalPrd: UnknownRecord[] = [];
  let originalProviderFailed = false;
  try {
    metadataCalls += 2;
    const [sourceResult, periodResult] = await Promise.allSettled([
      invokeMetadata(() =>
        client.getTableMeta(param.orgId, param.tableId, "SOURCE"),
      ),
      invokeMetadata(() =>
        client.getTableMeta(param.orgId, param.tableId, "PRD"),
      ),
    ]);
    if (sourceResult.status === "fulfilled") {
      originalSource = asUnknownRecords(sourceResult.value);
    } else {
      originalProviderFailed = true;
    }
    if (periodResult.status === "fulfilled") {
      originalPrd = asUnknownRecords(periodResult.value);
    } else {
      originalProviderFailed = true;
    }
  } catch {
    originalProviderFailed = true;
  }
  const source = sourceEvidence(originalSource);
  const requestedPeriod =
    options.requestedPeriod ?? param.supportedPeriods?.[0];
  const sourcePeriods = periodEvidence(originalPrd);
  if (originalProviderFailed) {
    return {
      status: "provider_error",
      candidates: [...distinct.values()].map((row) => ({
        orgId: boundedDiscoveryText(row.ORG_ID),
        tableId: boundedDiscoveryText(row.TBL_ID),
        tableName:
          boundedDiscoveryText(row.TBL_NM) ||
          boundedDiscoveryText(row.TBL_NAME),
        status: "provider_error" as const,
        differences: [],
        missingEvidence: ["source", "period", "compatibility_not_verified"],
      })),
      searchedCount: distinct.size,
      candidateLimit,
      metadataCallBudget,
      metadataCalls,
      metadataComplete: false,
    };
  }

  type CandidateWork = {
    orgId: string;
    tableId: string;
    tableName: string;
    searchStatId?: string;
    sourceRows: UnknownRecord[];
    periodRows: UnknownRecord[];
    itemRows: UnknownRecord[];
    commentRows: UnknownRecord[];
    explainRows: UnknownRecord[];
    differences: TableDiscoveryDifference[];
    missingEvidence: string[];
    providerFailed: boolean;
    extrasLoaded: boolean;
    positive?: PositiveDiscoveryProof;
  };

  const works = await boundedMap(
    [...distinct.values()],
    candidateLimit,
    async (row): Promise<CandidateWork> => {
      const orgId = boundedDiscoveryText(row.ORG_ID);
      const tableId = boundedDiscoveryText(row.TBL_ID);
      const tableName =
        boundedDiscoveryText(row.TBL_NM) || boundedDiscoveryText(row.TBL_NAME);
      const [sourceResult, periodResult] = await Promise.allSettled([
        invokeMetadata(() => client.getTableMeta(orgId, tableId, "SOURCE")),
        invokeMetadata(() => client.getTableMeta(orgId, tableId, "PRD")),
      ]);
      const sourceRows =
        sourceResult.status === "fulfilled"
          ? asUnknownRecords(sourceResult.value)
          : [];
      const periodRows =
        periodResult.status === "fulfilled"
          ? asUnknownRecords(periodResult.value)
          : [];
      const providerFailed =
        sourceResult.status === "rejected" ||
        periodResult.status === "rejected" ||
        originalProviderFailed;
      const candidateSource = sourceEvidence(sourceRows);
      const candidatePeriods = periodEvidence(periodRows);
      const differences: TableDiscoveryDifference[] = [];
      const missingEvidence: string[] = [];

      if (!source.text) missingEvidence.push("source");
      if (!candidateSource.text) missingEvidence.push("candidate_source");
      const sourceMismatch =
        Boolean(
          source.id && candidateSource.id && source.id !== candidateSource.id,
        ) ||
        Boolean(
          source.name &&
          candidateSource.name &&
          canonicalText(source.name) !== canonicalText(candidateSource.name),
        );
      if (sourceMismatch) {
        differences.push(
          discoveryDifference(
            "source",
            source.text ?? source.id ?? source.name ?? "",
            candidateSource.text ??
              candidateSource.id ??
              candidateSource.name ??
              "",
          ),
        );
      }
      const searchSourceId = boundedDiscoveryText(row.STAT_ID);
      if (
        searchSourceId &&
        (!candidateSource.id || candidateSource.id !== searchSourceId)
      ) {
        missingEvidence.push("search_source_identity_unverified");
      }

      if (sourcePeriods.length === 0) missingEvidence.push("source_period");
      if (candidatePeriods.length === 0) missingEvidence.push("period");
      if (
        requestedPeriod &&
        candidatePeriods.length > 0 &&
        !periodMatchesRequested(candidatePeriods, requestedPeriod)
      ) {
        differences.push(
          discoveryDifference(
            "period",
            sourcePeriods.join(", ") || requestedPeriod,
            candidatePeriods.join(", "),
          ),
        );
      }

      return {
        orgId,
        tableId,
        tableName,
        searchStatId: boundedDiscoveryText(row.STAT_ID) || undefined,
        sourceRows,
        periodRows,
        itemRows: [],
        commentRows: [],
        explainRows: [],
        differences,
        missingEvidence,
        providerFailed,
        extrasLoaded: false,
      };
    },
  );
  metadataCalls += works.length * 2;

  const compatible = works.filter(
    (work) =>
      !work.providerFailed &&
      work.differences.length === 0 &&
      Boolean(sourceEvidence(work.sourceRows).text) &&
      periodEvidence(work.periodRows).length > 0,
  );
  const extraCallWidth =
    2 + (typeof client.getStatisticsExplain === "function" ? 1 : 0);
  const extraLimit = Math.max(
    0,
    Math.min(
      compatible.length,
      Math.floor((metadataCallBudget - metadataCalls) / extraCallWidth),
    ),
  );
  const extraWorks = [...compatible]
    .sort((left, right) => {
      const profile = param.alternativeProfile;
      if (!profile) return 0;
      const leftExact =
        left.orgId === profile.candidate.orgId &&
        left.tableId === profile.candidate.tableId;
      const rightExact =
        right.orgId === profile.candidate.orgId &&
        right.tableId === profile.candidate.tableId;
      return Number(rightExact) - Number(leftExact);
    })
    .slice(0, extraLimit);
  const extraResults = await boundedMap(extraWorks, 1, async (work) => {
    const candidateSource = sourceEvidence(work.sourceRows);
    const metadataRequests: Array<Promise<UnknownRecord[]>> = [
      invokeMetadata(() =>
        client.getTableMeta(work.orgId, work.tableId, "ITM"),
      ).then(asUnknownRecords),
      invokeMetadata(() =>
        client.getTableMeta(work.orgId, work.tableId, "CMMT"),
      ).then(asUnknownRecords),
    ];
    const explain = client.getStatisticsExplain?.bind(client);
    const statId = candidateSource.id;
    if (explain && statId) {
      metadataRequests.push(
        invokeMetadata(() => explain(statId, "ALL")).then(asUnknownRecords),
      );
    }
    const settled = await Promise.allSettled(metadataRequests);
    let failed = false;
    const rows = settled.map((result) => {
      if (result.status === "rejected") {
        failed = true;
        return [] as UnknownRecord[];
      }
      return asUnknownRecords(result.value);
    });
    return {
      work,
      itemRows: rows[0] ?? [],
      commentRows: rows[1] ?? [],
      explainRows: rows[2] ?? [],
      failed,
      callCount: metadataRequests.length,
    };
  });
  metadataCalls += extraResults.reduce(
    (sum, result) => sum + result.callCount,
    0,
  );
  for (const result of extraResults) {
    result.work.itemRows = result.itemRows;
    result.work.commentRows = result.commentRows;
    result.work.explainRows = result.explainRows;
    result.work.providerFailed = result.work.providerFailed || result.failed;
    result.work.extrasLoaded = true;
  }
  const profile = param.alternativeProfile;
  if (profile) {
    for (const work of extraWorks) {
      if (
        work.orgId !== profile.candidate.orgId ||
        work.tableId !== profile.candidate.tableId
      )
        continue;
      const proof = await proveBirthAlternative(
        param,
        requested,
        profile,
        work,
        originalPrd,
        source.id,
        options,
        () => {
          if (metadataCalls >= metadataCallBudget) return false;
          metadataCalls += 1;
          return true;
        },
      );
      if (proof) work.positive = proof;
      break;
    }
  }

  const candidates = works.map((work): TableDiscoveryCandidate => {
    const missingEvidence = [...work.missingEvidence];
    if (
      !work.positive &&
      !work.providerFailed &&
      work.differences.length === 0
    ) {
      const item = candidateItemEvidence(work.itemRows, param);
      if (!item.text) missingEvidence.push("item");
      const definitionRows = [...work.explainRows, ...work.commentRows];
      if (!hasDefinitionEvidence(definitionRows))
        missingEvidence.push("definition");
      if (
        !definitionRows.some((metadata) =>
          ["goalPoplExmnPopl", "examinObjrange", "examinObjArea"].some(
            (key) => boundedDiscoveryText(metadata[key]).length > 0,
          ),
        )
      ) {
        missingEvidence.push("population");
      }
      if (
        work.itemRows.length === 0 ||
        !work.itemRows.some((metadata) => text(metadata.OBJ_ID).length > 0)
      ) {
        missingEvidence.push("fixedDimensions");
      }
      missingEvidence.push("compatibility_not_verified");
      if (!work.extrasLoaded) missingEvidence.push("metadata_budget");
      const profile = param.alternativeProfile;
      if (
        profile &&
        work.orgId === profile.candidate.orgId &&
        work.tableId === profile.candidate.tableId
      ) {
        if (!definitionMatchesProfile(work.explainRows, profile))
          missingEvidence.push("definition_profile");
        const profileItem = work.itemRows.some(
          (row) =>
            metadataId(row) === profile.candidate.itemId &&
            profile.aliases.some(
              (alias) =>
                canonicalText(metadataName(row)) === canonicalText(alias),
            ),
        );
        if (!profileItem) missingEvidence.push("item_binding");
        if (work.extrasLoaded) missingEvidence.push("candidate_probe");
      }
    }

    const uniqueMissing = [...new Set(missingEvidence)].slice(0, 8);
    const status: TableDiscoveryCandidateStatus = work.providerFailed
      ? "provider_error"
      : work.positive
        ? "matched"
        : work.differences.length > 0
          ? "definition_mismatch"
          : "metadata_insufficient";
    return {
      orgId: work.orgId,
      tableId: work.tableId,
      tableName: work.tableName,
      status,
      differences: work.differences.slice(0, 8),
      missingEvidence: uniqueMissing,
      ...(work.positive
        ? {
            caveats: work.positive.caveats,
            evidence: work.positive.evidence,
          }
        : {}),
    };
  });

  const metadataComplete = compatible.length <= extraWorks.length;
  const positive = works.find((work) => work.positive)?.positive;
  return {
    status: positive
      ? "searched"
      : candidates.every((candidate) => candidate.status === "provider_error")
        ? "provider_error"
        : "searched",
    candidates,
    searchedCount: candidates.length,
    candidateLimit,
    metadataCallBudget,
    metadataCalls,
    metadataComplete,
    ...(positive
      ? {
          selectedParam: positive.selectedParam,
          selectedRegionName: positive.regionName,
          selectedRegionCode: positive.regionCode,
          selectedAxis: positive.axis,
          selectedDimensions: positive.dimensions,
          caveats: positive.caveats,
        }
      : {}),
  };
}
function unresolved(
  param: QuickStatsParam,
  status: Exclude<RegionResolutionStatus, "none" | "resolved">,
  requestedRegion: string,
  reason: string,
  extra: Partial<RegionResolution> = {},
): RegionResolution {
  return {
    status,
    requestedRegion,
    reason,
    searchPath: searchPath(param, requestedRegion),
    ...extra,
  };
}
function exactNameCompositionMatches(
  intermediate: string,
  leaf: string,
  officialFullName: string,
): boolean {
  const observed = canonicalText(normalizeRegionName(officialFullName));
  return [...officialAliases(intermediate)].some((intermediateAlias) =>
    [...officialAliases(leaf)].some(
      (leafAlias) =>
        observed ===
        `${canonicalText(intermediateAlias)}${canonicalText(leafAlias)}`,
    ),
  );
}

function currentAffiliationCaveat(affiliation: SignguAffiliationFound): string {
  const period = affiliation.stdrYm
    ? `, stdrYm=${boundedDiscoveryText(affiliation.stdrYm, 32)}`
    : "";
  return `공식 소상공인시장진흥공단 상권정보의 현재 명칭 소속 확인: ${boundedDiscoveryText(affiliation.signguNm, 120)} (${boundedDiscoveryText(affiliation.signguCd, 64)}), observedAt=${boundedDiscoveryText(affiliation.observedAt, 64)}${period}; scope=current_name_affiliation_not_historical_boundary (현재 명칭 결합이며 관측연도의 역사적 행정경계 횡단표가 아님).`;
}

async function loadMetadataAndSample(
  param: QuickStatsParam,
  options: RegionResolverOptions,
): Promise<{
  metadataRows: UnknownRecord[];
  sampleRows: StatisticsDataItem[];
}> {
  const client = options.client ?? getKosisClient();
  const cache = options.useCache === false ? undefined : getCacheManager();
  const metadataRows =
    options.metadataRows ??
    (cache
      ? await cache.getTableMeta<UnknownRecord[]>(
          { orgId: param.orgId, tableId: param.tableId, infoType: "ITM" },
          () => client.getTableMeta(param.orgId, param.tableId, "ITM"),
        )
      : await client.getTableMeta(param.orgId, param.tableId, "ITM"));
  const dimensions = dimensionsFromParam(param);
  const sampleParams = {
    orgId: param.orgId,
    tableId: param.tableId,
    ...dimensions,
    itemId: param.itemId,
    periodType: param.supportedPeriods?.[0] ?? "Y",
    recentCount: 1,
  };
  const sampleRows =
    options.sampleRows ??
    (cache
      ? await cache.getStatisticsData<StatisticsDataItem[]>(sampleParams, () =>
          client.getStatisticsData({
            orgId: param.orgId,
            tblId: param.tableId,
            ...dimensions,
            itmId: param.itemId,
            prdSe: param.supportedPeriods?.[0] ?? "Y",
            newEstPrdCnt: 1,
          }),
        )
      : await client.getStatisticsData({
          orgId: param.orgId,
          tblId: param.tableId,
          ...dimensions,
          itmId: param.itemId,
          prdSe: param.supportedPeriods?.[0] ?? "Y",
          newEstPrdCnt: 1,
        }));
  return { metadataRows, sampleRows };
}

/** Resolve a region only when official ITM and observed data axes agree. */
export async function resolveRegion(
  param: QuickStatsParam,
  requestedRegion?: string | null,
  options: RegionResolverOptions = {},
): Promise<RegionResolution> {
  if (!requestedRegion || normalizeRegionName(requestedRegion).length === 0) {
    return { status: "none", dimensions: dimensionsFromParam(param) };
  }

  const requested = normalizeRegionName(requestedRegion);
  let loaded: {
    metadataRows: UnknownRecord[];
    sampleRows: StatisticsDataItem[];
  };
  try {
    loaded = await loadMetadataAndSample(param, options);
  } catch (error) {
    const failure = handleToolError(error);
    return unresolved(
      param,
      "unverified",
      requested,
      `공식 지역 메타데이터/표본 조회에 실패하여 지역 코드를 검증하지 못했습니다: ${failure.error} (${failure.code})`,
    );
  }

  const { metadataRows, sampleRows } = loaded;
  const observations = observeAxes(
    sampleRows as unknown as UnknownRecord[],
    metadataRows,
  );
  const axisByGroup = new Map<string, AxisObservation>();
  const groupByAxis = new Map<DimensionNumber, AxisObservation>();
  for (const observation of observations) {
    if (
      axisByGroup.has(observation.groupId) ||
      groupByAxis.has(observation.axis)
    ) {
      return unresolved(
        param,
        "unverified",
        requested,
        "공식 메타데이터의 OBJ_ID 그룹과 실제 Cn_OBJ_NM 축이 일대일로 대응하지 않습니다. 차원 순서를 추측하지 않았습니다.",
        { metadataRows, sampleRows },
      );
    }
    axisByGroup.set(observation.groupId, observation);
    groupByAxis.set(observation.axis, observation);
  }
  const regionGroups = [...axisByGroup.values()]
    .map((observation) => {
      const items = buildItems(metadataRows, observation.groupId);
      const byId = new Map(items.map((item) => [item.id, item]));
      const candidates = items
        .map((item) => {
          const path = pathFor(item, byId);
          return { item, path, score: candidateScore(requested, item, path) };
        })
        .filter((candidate) =>
          candidateMatchesRequest(
            param,
            requested,
            candidate.item,
            candidate.path,
            items,
          ),
        )
        .sort((left, right) => right.score - left.score);
      return { observation, candidates };
    })
    .filter((group) => group.candidates.length > 0);
  const metadataRegionGroups = [...groupRows(metadataRows).entries()].filter(
    ([, rows]) => {
      const items = buildItems(metadataRows, text(rows[0]?.OBJ_ID));
      const byId = new Map(items.map((item) => [item.id, item]));
      return items.some((item) => {
        const path = pathFor(item, byId);
        return candidateMatchesRequest(param, requested, item, path, items);
      });
    },
  );
  if (regionGroups.length === 0) {
    const partialCandidates = [...axisByGroup.values()].flatMap((observation) =>
      partialRegionCandidates(
        param,
        requested,
        observation,
        buildItems(metadataRows, observation.groupId),
      ),
    );
    if (partialCandidates.length > 1) {
      const names = [
        ...new Set(
          partialCandidates.map((candidate) => pathText(candidate.path)),
        ),
      ];
      return unresolved(
        param,
        "ambiguous",
        requested,
        "요청 지역에 대응하는 관측 지역 후보가 여러 개라 현재 명칭 소속을 확인할 수 없습니다.",
        {
          candidates: names,
          clarification: `상위 지역을 함께 지정하세요: ${names.join(", ")}`,
          metadataRows,
          sampleRows,
        },
      );
    }
    if (partialCandidates.length === 1) {
      const selected = partialCandidates[0];
      let affiliation: Awaited<
        ReturnType<typeof lookupCurrentSignguAffiliation>
      >;
      try {
        const lookup =
          options.signguAffiliationLookup ??
          ((signguCode: string) => lookupCurrentSignguAffiliation(signguCode));
        affiliation = await lookup(selected.item.id);
      } catch (error) {
        const failure = handleToolError(error);
        const message =
          failure.code === "INVALID_API_KEY"
            ? "상권정보 운영자의 DATA_GO_KR_SERVICE_KEY 설정을 확인해 주세요."
            : failure.error;
        return unresolved(
          param,
          "unverified",
          requested,
          `현재 공식 시군구 소속 조회에 실패하여 지역 코드를 검증하지 못했습니다: ${message} (${failure.code})`,
          { metadataRows, sampleRows },
        );
      }
      if (affiliation.status === "no_rows") {
        return unresolved(
          param,
          "unverified",
          requested,
          `현재 공식 시군구 소속 조회에 ${selected.item.id} 코드의 행이 없습니다.`,
          { metadataRows, sampleRows },
        );
      }
      if (affiliation.status === "incomplete_row") {
        return unresolved(
          param,
          "unverified",
          requested,
          `현재 공식 시군구 소속 조회 행에 필수 필드가 없습니다: ${affiliation.missingFields.join(", ")}.`,
          { metadataRows, sampleRows },
        );
      }

      const provinceId = selected.item.parentId;
      const province = selected.path.find((item) => item.id === provinceId);
      if (
        affiliation.signguCd !== selected.item.id ||
        !province ||
        affiliation.ctprvnCd !== province.id ||
        normalizeRegionName(province.name) !==
          normalizeRegionName(affiliation.ctprvnNm)
      ) {
        return unresolved(
          param,
          "unverified",
          requested,
          "KOSIS 시군구·시도 코드 또는 시도명이 현재 공식 소속 조회와 일치하지 않습니다.",
          { metadataRows, sampleRows },
        );
      }
      if (
        !exactNameCompositionMatches(
          selected.missingComponent,
          selected.item.name,
          affiliation.signguNm,
        )
      ) {
        return unresolved(
          param,
          "unverified",
          requested,
          "현재 공식 시군구 명칭이 요청한 누락 시·군·구와 KOSIS 관측 지역을 정확히 함께 나타내지 않습니다.",
          { metadataRows, sampleRows },
        );
      }

      const dimensions = dimensionsFromParam(param);
      dimensions[`objL${selected.observation.axis}`] = selected.item.id;
      return {
        status: "resolved",
        requestedRegion: requested,
        regionName: `${province.name} ${affiliation.signguNm}`,
        regionCode: selected.item.id,
        axis: selected.observation.axis,
        dimensions,
        metadataRows,
        sampleRows,
        caveats: [currentAffiliationCaveat(affiliation)],
      };
    }
  }
  if (regionGroups.length !== 1) {
    if (regionGroups.length === 0 && metadataRegionGroups.length > 0) {
      return unresolved(
        param,
        "unverified",
        requested,
        "공식 지역 항목은 찾았지만 실제 Cn_OBJ_NM 축 대응을 관측하지 못했습니다.",
        { metadataRows, sampleRows },
      );
    }
    if (regionGroups.length === 0) {
      const tableDiscovery =
        !options.disableAlternativeDiscovery &&
        isExplicitMunicipality(param, requested)
          ? await discoverAlternativeTables(param, requested, {
              ...options,
              metadataRows,
            })
          : undefined;
      if (
        tableDiscovery?.selectedParam &&
        tableDiscovery.selectedRegionCode &&
        tableDiscovery.selectedRegionName &&
        tableDiscovery.selectedAxis !== undefined &&
        tableDiscovery.selectedDimensions
      ) {
        return {
          status: "resolved",
          requestedRegion: requested,
          regionName: tableDiscovery.selectedRegionName,
          regionCode: tableDiscovery.selectedRegionCode,
          axis: tableDiscovery.selectedAxis,
          dimensions: tableDiscovery.selectedDimensions,
          selectedParam: tableDiscovery.selectedParam,
          caveats: tableDiscovery.caveats,
          tableDiscovery,
          metadataRows,
          sampleRows,
        };
      }
      return unresolved(
        param,
        "not_found",
        requested,
        "공식 ITM 분류에서 요청 지역을 찾지 못했습니다. 국가 기본값으로 대체하지 않았습니다.",
        {
          metadataRows,
          sampleRows,
          ...(tableDiscovery ? { tableDiscovery } : {}),
        },
      );
    }
    return unresolved(
      param,
      "unverified",
      requested,
      "요청 지역과 대응하는 공식 분류 그룹이 하나로 확정되지 않았습니다.",
      { metadataRows, sampleRows },
    );
  }
  const { observation, candidates } = regionGroups[0];

  if (candidates.length === 0) {
    return unresolved(
      param,
      "not_found",
      requested,
      "공식 ITM 분류에서 요청 지역을 찾지 못했습니다. 국가 기본값으로 대체하지 않았습니다.",
      { metadataRows, sampleRows },
    );
  }

  const bestScore = candidates[0].score;
  const best = candidates.filter((candidate) => candidate.score === bestScore);
  if (best.length !== 1) {
    const names = [
      ...new Set(best.map((candidate) => pathText(candidate.path))),
    ];
    return unresolved(
      param,
      "ambiguous",
      requested,
      "동일한 지역명이 여러 공식 부모 경로에 있어 하나를 선택할 수 없습니다.",
      {
        candidates: names,
        clarification: `상위 지역을 함께 지정하세요: ${names.join(", ")}`,
        metadataRows,
        sampleRows,
      },
    );
  }

  const selected = best[0];
  const dimensions = dimensionsFromParam(param);
  dimensions[`objL${observation.axis}`] = selected.item.id;
  return {
    status: "resolved",
    requestedRegion: requested,
    regionName: pathText(selected.path),
    regionCode: selected.item.id,
    axis: observation.axis,
    dimensions,
    metadataRows,
    sampleRows,
  };
}

/** Extract and resolve a region from the complete natural-language query. */
export async function resolveRegionFromQuery(
  param: QuickStatsParam,
  query: string,
  options: RegionResolverOptions = {},
): Promise<RegionResolution> {
  const explicit = options.metadataRows;
  if (explicit) {
    const remainder = queryRemainderTokens(param, query);
    if (remainder.length === 0) {
      return { status: "none", dimensions: dimensionsFromParam(param) };
    }
    const candidates = queryMetadataNames(explicit, query);
    const requested =
      candidates.length > 0 ||
      looksLikeRegionRequest(remainder.join(" ")) ||
      remainder.length > 0
        ? query
        : undefined;
    return resolveRegion(param, requested, options);
  }

  // The resolver must inspect official metadata before deciding whether query text
  // contains a region; this prevents the old 17-province substring shortcut.
  let loaded: {
    metadataRows: UnknownRecord[];
    sampleRows: StatisticsDataItem[];
  };
  try {
    loaded = await loadMetadataAndSample(param, options);
  } catch (error) {
    const remainder = queryRemainderTokens(param, query);
    if (remainder.length === 0) {
      return { status: "none", dimensions: dimensionsFromParam(param) };
    }
    const failure = handleToolError(error);
    return unresolved(
      param,
      "unverified",
      query,
      `지역 메타데이터 조회 실패: ${failure.error} (${failure.code})`,
    );
  }
  const remainder = queryRemainderTokens(param, query);
  if (remainder.length === 0) {
    return { status: "none", dimensions: dimensionsFromParam(param) };
  }
  const queryCandidates = queryMetadataNames(loaded.metadataRows, query);
  const requested =
    queryCandidates.length > 0 ||
    looksLikeRegionRequest(remainder.join(" ")) ||
    remainder.length > 0
      ? query
      : undefined;
  if (!requested)
    return { status: "none", dimensions: dimensionsFromParam(param) };
  return resolveRegion(param, requested, { ...options, ...loaded });
}

export interface RegionRowsValidation {
  ok: boolean;
  reason?: string;
  validationLevel: "verified" | "unverified";
}

/** Validate final observations without accepting a wrong-national or mixed-region row. */
export function validateRegionRows(
  rows: Array<Record<string, unknown>>,
  param: QuickStatsParam,
  resolution: RegionResolution,
  periodType: string,
): RegionRowsValidation {
  if (
    resolution.status !== "resolved" ||
    resolution.axis === undefined ||
    !resolution.regionCode
  ) {
    return {
      ok: false,
      validationLevel: "unverified",
      reason: "지역 해석이 검증되지 않았습니다.",
    };
  }
  if (rows.length === 0)
    return {
      ok: false,
      validationLevel: "unverified",
      reason: "응답 행이 없습니다.",
    };
  const axis = `C${resolution.axis}`;
  const expectedCode = text(resolution.regionCode);
  const expectedCodeIsMultiSelector = isProviderMultiSelector(expectedCode);
  const codes = new Set<string>();
  for (const row of rows) {
    if (
      text(row.ORG_ID) !== param.orgId ||
      text(row.TBL_ID) !== param.tableId
    ) {
      return {
        ok: false,
        validationLevel: "unverified",
        reason: "응답 표 식별자가 요청과 다릅니다.",
      };
    }
    if (normalizeStatisticsPeriodType(text(row.PRD_SE)) !== periodType) {
      return {
        ok: false,
        validationLevel: "unverified",
        reason: "응답 주기가 요청과 다릅니다.",
      };
    }
    const itemId = text(row.ITM_ID);
    if (!itemId) {
      return {
        ok: false,
        validationLevel: "unverified",
        reason: "응답 항목 식별자(ITM_ID)가 없습니다.",
      };
    }
    if (!isProviderMultiSelector(param.itemId) && itemId !== param.itemId) {
      return {
        ok: false,
        validationLevel: "unverified",
        reason: "응답 항목이 요청 항목과 다릅니다.",
      };
    }
    const code = text(row[axis]);
    if (!code)
      return {
        ok: false,
        validationLevel: "unverified",
        reason: `${axis} 지역 코드가 응답에 없습니다.`,
      };
    codes.add(code);
    if (!expectedCodeIsMultiSelector && code !== expectedCode) {
      return {
        ok: false,
        validationLevel: "unverified",
        reason: `${axis} 응답 지역 코드가 요청 지역과 다릅니다.`,
      };
    }
  }
  if (!expectedCodeIsMultiSelector && codes.size !== 1)
    return {
      ok: false,
      validationLevel: "unverified",
      reason: "여러 지역이 한 응답에 섞였습니다.",
    };
  return { ok: true, validationLevel: "verified" };
}
export function validateRequestedRows(
  rows: Array<Record<string, unknown>>,
  param: QuickStatsParam,
  dimensions: Record<string, string | undefined>,
  periodType: string,
): RegionRowsValidation {
  if (rows.length === 0) {
    return {
      ok: false,
      validationLevel: "unverified",
      reason: "응답 행이 없습니다.",
    };
  }
  const units = new Set<string>();
  for (const row of rows) {
    if (
      text(row.ORG_ID) !== param.orgId ||
      text(row.TBL_ID) !== param.tableId
    ) {
      return {
        ok: false,
        validationLevel: "unverified",
        reason: "응답 표 식별자가 요청과 다릅니다.",
      };
    }
    if (normalizeStatisticsPeriodType(text(row.PRD_SE)) !== periodType) {
      return {
        ok: false,
        validationLevel: "unverified",
        reason: "응답 주기가 요청과 다릅니다.",
      };
    }
    const itemId = text(row.ITM_ID);
    if (!itemId) {
      return {
        ok: false,
        validationLevel: "unverified",
        reason: "응답 항목 식별자(ITM_ID)가 없습니다.",
      };
    }
    if (!isProviderMultiSelector(param.itemId) && itemId !== param.itemId) {
      return {
        ok: false,
        validationLevel: "unverified",
        reason: "응답 항목이 요청 항목과 다릅니다.",
      };
    }
    const unit = text(row.UNIT_NM);
    if (unit) units.add(unit);
    for (let axis = 1; axis <= 8; axis += 1) {
      const expected = dimensions[`objL${axis}`];
      if (expected === undefined) continue;
      const observed = text(row[`C${axis}`]);
      if (
        !observed ||
        (!isProviderMultiSelector(expected) && observed !== expected)
      ) {
        return {
          ok: false,
          validationLevel: "unverified",
          reason: `C${axis} 응답 분류값이 요청 선택과 다릅니다.`,
        };
      }
    }
  }
  if (units.size > 1) {
    return {
      ok: false,
      validationLevel: "unverified",
      reason: "여러 단위가 한 응답에 섞였습니다.",
    };
  }
  return { ok: true, validationLevel: "verified" };
}

export function parseObservedNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim().replace(/,/gu, "");
  if (
    !raw ||
    raw === "-" ||
    raw.toLowerCase() === "na" ||
    raw.toLowerCase() === "null"
  )
    return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
