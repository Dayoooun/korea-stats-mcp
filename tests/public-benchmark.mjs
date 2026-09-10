#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MANIFEST_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "public-benchmark.json",
);
export const EXPECTED_MANIFEST_ID = "public-locality-detail-v2";
export const EXPECTED_MANIFEST_VERSION = 2;
export const EXPECTED_MANIFEST_SHA256 =
  "2f2f5727c31954acba819ece263f789f47fd8d87cd94f68b2df0f747f24cf56e";
export const EXPECTED_SERVER_VERSION = "2.0.0";
export const MCP_TIMEOUT_MS = 30_000;
export const PROVIDER_TIMEOUT_MS = 8_000;
export const PROVIDER_MAX_BYTES = 4 * 1024 * 1024;
export const MCP_MAX_BYTES = 32 * 1024;
export const CATEGORY_WEIGHTS = Object.freeze({
  identity: 3,
  value: 3,
  completeness: 2,
  honesty: 2,
});
export const CANONICAL_TOOL_NAMES = Object.freeze([
  "quick_stats",
  "quick_trend",
  "search_statistics",
  "get_statistics_list",
  "get_statistics_data",
  "compare_statistics",
  "analyze_time_series",
  "get_recommended_statistics",
  "get_table_info",
  "search_indicators",
  "get_indicator",
  "search_businesses",
  "search_microdata",
  "get_microdata_info",
]);
const SECRET_ENV_NAMES = Object.freeze([
  "KOSIS_API_KEY",
  "DATA_GO_KR_SERVICE_KEY",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
]);
const KOSIS_META_ENDPOINT = "https://kosis.kr/openapi/statisticsData.do";
const KOSIS_DATA_ENDPOINT =
  "https://kosis.kr/openapi/Param/statisticsParameterData.do";
const BUSINESS_ENDPOINT =
  "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong";

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "undefined" : encoded;
}
export { canonicalJson };

/** Redacts credentials and provider URLs before anything is printed or persisted. */
export function sanitizeValue(value, seen = new WeakSet()) {
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value))
    return value.map((item) => sanitizeValue(item, seen));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      /api.?key|service.?key|authorization|password|secret|credential|token|cookie|bypass/i.test(
        key,
      )
    )
      continue;
    output[key] = sanitizeValue(item, seen);
  }
  return output;
}
export function sanitizeText(value) {
  let result = String(value);
  for (const name of SECRET_ENV_NAMES) {
    const secret = process.env[name]?.trim();
    if (secret) {
      result = result.split(secret).join("[redacted]");
      result = result.split(encodeURIComponent(secret)).join("[redacted]");
    }
  }
  result = result.replace(/https?:\/\/[^\s)]+/giu, (url) => redactUrl(url));
  return result
    .replace(
      /(apiKey|serviceKey|accessToken|authorization|token)=[^&\s]+/giu,
      (_match, key) => `${key}=[redacted]`,
    )
    .slice(0, 2_000);
}
export function sanitizeError(error) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return `${error.code}: ${sanitizeText(error.message ?? "request failed")}`;
  }
  return sanitizeText(
    error instanceof Error ? error.message : "request failed",
  );
}
function redactUrl(value) {
  try {
    const parsed = new URL(value);
    for (const key of [
      "apiKey",
      "serviceKey",
      "token",
      "authorization",
      "access_token",
    ]) {
      if (parsed.searchParams.has(key))
        parsed.searchParams.set(key, "[redacted]");
    }
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
    }
    return parsed.toString();
  } catch {
    return "[redacted-url]";
  }
}
export { redactUrl };

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = text(value).replaceAll(",", "");
  if (!raw || /^(?:-|\.\.|n\/a|null|미상)$/iu.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}
function unknownUnit(value) {
  return /^(?:unknown|n\/?a|null|미상|단위\s*미상|알\s*수\s*없음|-|…|\.\.\.)$/iu.test(
    text(value),
  );
}
export { parseNumber, unknownUnit };

function metadataRows(value) {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.result)) return value.result;
  if (
    isRecord(value) &&
    (value.error || value.errMsg || value.RESULT?.CODE || value.resultCode)
  ) {
    throw new Error("official metadata error envelope");
  }
  throw new Error("official metadata is not an array or result array");
}
export function parseKosisMetadata(value) {
  const rows = metadataRows(value);
  if (
    rows.some(
      (row) =>
        !isRecord(row) || !text(row.ITM_ID) || !Object.hasOwn(row, "ITM_NM"),
    )
  ) {
    throw new Error("official metadata row is missing ITM_ID or ITM_NM");
  }
  return rows;
}
function administrativeNameMatches(expected, observed) {
  const a = text(expected).replaceAll(/\s+/gu, "");
  const b = text(observed).replaceAll(/\s+/gu, "");
  if (!a || !b) return false;
  if (a === b) return true;
  const aliases = new Map([
    ["서울", "서울특별시"],
    ["부산", "부산광역시"],
    ["대구", "대구광역시"],
    ["인천", "인천광역시"],
    ["광주", "광주광역시"],
    ["대전", "대전광역시"],
    ["울산", "울산광역시"],
    ["세종", "세종특별자치시"],
    ["경기", "경기도"],
    ["강원", "강원특별자치도"],
    ["충북", "충청북도"],
    ["충남", "충청남도"],
    ["전북", "전북특별자치도"],
    ["전남", "전라남도"],
    ["경북", "경상북도"],
    ["경남", "경상남도"],
    ["제주", "제주특별자치도"],
  ]);
  return aliases.get(a) === b || aliases.get(b) === a;
}
function normalizedExactNameEquals(expected, observed) {
  const a = text(expected).replaceAll(/\s+/gu, "");
  const b = text(observed).replaceAll(/\s+/gu, "");
  return Boolean(a && b && a === b);
}
export { administrativeNameMatches };

/** Resolve a complete metadata hierarchy; no code-prefix or zero-padding heuristics are used. */
export function officialPathCandidates(rows, officialPath) {
  if (!Array.isArray(officialPath) || officialPath.length === 0)
    throw new Error("official path is empty");
  const usable = rows.filter((row) => isRecord(row) && text(row.ITM_ID));
  const byParent = (parent) =>
    usable.filter((row) => {
      const up = text(row.UP_ITM_ID);
      return parent ? up === parent : !up;
    });
  const matches = [];
  const visit = (index, parent, chain) => {
    if (index === officialPath.length) {
      matches.push(chain);
      return;
    }
    for (const row of byParent(parent)) {
      if (administrativeNameMatches(officialPath[index], row.ITM_NM))
        visit(index + 1, text(row.ITM_ID), [...chain, row]);
    }
  };
  visit(0, "", []);
  return matches.map((chain) => {
    const path = chain.map((row) => text(row.ITM_NM));
    return {
      code: text(chain.at(-1).ITM_ID),
      name: text(chain.at(-1).ITM_NM),
      path,
      names: [text(chain.at(-1).ITM_NM), path.join(" ")],
      rows: chain,
    };
  });
}
export function relaxedOfficialPathCandidates(rows, officialPath) {
  const strict = officialPathCandidates(rows, officialPath);
  if (strict.length > 0 || officialPath.length < 3) return strict;
  const relaxed = [];
  for (let skip = 1; skip < officialPath.length - 1; skip += 1) {
    const reducedPath = officialPath.filter((_, index) => index !== skip);
    for (const candidate of officialPathCandidates(rows, reducedPath)) {
      relaxed.push({
        ...candidate,
        path: reducedPath,
        names: [candidate.name, officialPath.join(" ")],
        missingIntermediate: officialPath[skip],
      });
    }
  }
  return relaxed;
}
export function resolveOfficialPath(rows, officialPath) {
  const matches = officialPathCandidates(rows, officialPath);
  if (matches.length === 0)
    throw new Error(
      `official region path not found: ${officialPath.join(" /")}`,
    );
  if (matches.length > 1)
    throw new Error(
      `official region path is ambiguous: ${officialPath.join(" /")}`,
    );
  return matches[0];
}
export function normalizeObservedPeriodType(value, expected = "Y") {
  const observed = text(value).toUpperCase();
  return expected === "Y" && observed === "A" ? "Y" : observed;
}
export function validateOfficialObservation(row, expected = {}) {
  if (!isRecord(row))
    return { ok: false, reason: "official observation is not an object" };
  const expectedCode = text(expected.code);
  const expectedName = text(expected.name);
  if (expectedCode && text(row.C1) !== expectedCode)
    return {
      ok: false,
      reason: "C1 region code does not match the independent hierarchy",
    };
  if (
    expected.names?.length > 0 &&
    !expected.names.some((name) => administrativeNameMatches(name, row.C1_NM))
  )
    return {
      ok: false,
      reason: "C1_NM region name does not match the independent hierarchy",
    };
  if (
    !expected.names?.length &&
    expectedName &&
    !administrativeNameMatches(expectedName, row.C1_NM)
  )
    return {
      ok: false,
      reason: "C1_NM region name does not match the independent hierarchy",
    };
  if (expected.itemId && text(row.ITM_ID) !== text(expected.itemId))
    return { ok: false, reason: "ITM_ID does not match the requested item" };
  if (
    expected.periodType &&
    normalizeObservedPeriodType(row.PRD_SE, expected.periodType) !==
      text(expected.periodType).toUpperCase()
  )
    return {
      ok: false,
      reason: "PRD_SE does not match the requested period type",
    };
  if (
    expected.period !== undefined &&
    text(row.PRD_DE) !== text(expected.period)
  )
    return { ok: false, reason: "PRD_DE does not match the requested year" };
  if (unknownUnit(row.UNIT_NM))
    return { ok: false, reason: "UNIT_NM is unknown" };
  if (!text(row.UNIT_NM) && !expected.allowMissingUnit)
    return { ok: false, reason: "UNIT_NM is missing" };
  const value = parseNumber(row.DT);
  if (value === null)
    return { ok: false, reason: "DT is missing or non-numeric" };
  return { ok: true, value, row };
}
export function validatePopulationObservations(rows, expected = {}) {
  if (!Array.isArray(rows))
    return { ok: false, reason: "official population data is not an array" };
  const start = Number(expected.startYear ?? expected.year);
  const end = Number(expected.endYear ?? expected.year);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start)
    return { ok: false, reason: "requested year range is invalid" };
  const requested = Array.from({ length: end - start + 1 }, (_, index) =>
    String(start + index),
  );
  const observed = rows.map((row) => text(row?.PRD_DE));
  if (new Set(observed).size !== observed.length)
    return { ok: false, reason: "duplicate official observation year" };
  if (
    observed.length !== requested.length ||
    requested.some((year) => !observed.includes(year))
  )
    return {
      ok: false,
      reason:
        "official observations do not cover exactly the requested year range",
    };
  const validated = rows.map((row) =>
    validateOfficialObservation(row, {
      ...expected,
      itemId: expected.itemId ?? "T20",
      periodType: expected.periodType ?? "Y",
    }),
  );
  const failure = validated.find((item) => !item.ok);
  if (failure) return failure;
  return {
    ok: true,
    rows,
    values: Object.fromEntries(
      rows.map((row) => [text(row.PRD_DE), parseNumber(row.DT)]),
    ),
    rawValues: Object.fromEntries(
      rows.map((row) => [text(row.PRD_DE), String(row.DT)]),
    ),
  };
}
export function validateTrendObservations(rows, expected = {}) {
  return validatePopulationObservations(rows, expected);
}
export function selectActiveOfficialCandidate(candidates, rows) {
  const active = [];
  for (const candidate of candidates) {
    const names = Array.isArray(candidate.names)
      ? candidate.names
      : [candidate.name];
    const candidateRows = rows.filter(
      (row) =>
        text(row?.C1) === candidate.code &&
        names.some((name) => administrativeNameMatches(name, row?.C1_NM)),
    );
    if (candidateRows.length > 0)
      active.push({ candidate, rows: candidateRows });
  }
  if (active.length !== 1)
    throw new Error(
      `official path has ${active.length} active codes for requested years; expected exactly one`,
    );
  return active[0];
}
function extractToolObject(result, name = "tool") {
  if (!isRecord(result)) throw new Error(`${name} result is not an object`);
  if (result.isError === true)
    throw new Error(`${name} returned an error result`);
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0)
    throw new Error(`${name} returned no content`);
  const first = content.find(
    (item) =>
      isRecord(item) && item.type === "text" && typeof item.text === "string",
  );
  if (!first) throw new Error(`${name} returned non-text content`);
  let parsed;
  try {
    parsed = JSON.parse(first.text);
  } catch {
    throw new Error(`${name} returned invalid JSON`);
  }
  if (!isRecord(parsed))
    throw new Error(`${name} returned a non-object JSON value`);
  return parsed;
}
export { extractToolObject };

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            Object.assign(new Error(`${label} timeout`), { code: "TIMEOUT" }),
          ),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
async function awaitAbortable(promise, signal, label) {
  if (!signal) return promise;
  if (signal.aborted) throw new Error(`${label} response timeout`);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(new Error(`${label} response timeout`));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
export async function boundedBody(
  response,
  maxBytes,
  timeoutMs,
  label,
  { signal, abort } = {},
) {
  const localController = signal ? undefined : new AbortController();
  const bodySignal = signal ?? localController?.signal;
  const abortBody = abort ?? (() => localController?.abort());
  const localTimer = localController
    ? setTimeout(() => localController.abort(), timeoutMs)
    : undefined;
  const declared = response.headers?.get?.("content-length");
  if (/^\d+$/u.test(declared ?? "") && Number(declared) > maxBytes) {
    abortBody();
    if (localTimer !== undefined) clearTimeout(localTimer);
    throw new Error(`${label} response exceeded byte limit`);
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    try {
      const bytes = new Uint8Array(
        await awaitAbortable(response.arrayBuffer(), bodySignal, label),
      );
      if (bodySignal?.aborted) throw new Error(`${label} response timeout`);
      if (bytes.byteLength > maxBytes) {
        abortBody();
        throw new Error(`${label} response exceeded byte limit`);
      }
      return bytes;
    } catch (error) {
      if (
        bodySignal?.aborted &&
        !/exceeded byte limit/iu.test(String(error?.message))
      ) {
        throw new Error(`${label} response timeout`);
      }
      throw error;
    } finally {
      if (localTimer !== undefined) clearTimeout(localTimer);
    }
  }
  const chunks = [];
  let total = 0;
  let sizeExceeded = false;
  let abortHandler;
  try {
    abortHandler = () => {
      void reader.cancel().catch(() => {});
    };
    bodySignal?.addEventListener("abort", abortHandler, { once: true });
    while (true) {
      let next;
      try {
        let abortReject;
        const abortPromise = new Promise((_, reject) => {
          abortReject = () => reject(new Error(`${label} response timeout`));
          if (bodySignal?.aborted) abortReject();
          else
            bodySignal?.addEventListener("abort", abortReject, { once: true });
        });
        try {
          next = await Promise.race([reader.read(), abortPromise]);
        } finally {
          bodySignal?.removeEventListener("abort", abortReject);
        }
      } catch (error) {
        if (sizeExceeded)
          throw new Error(`${label} response exceeded byte limit`);
        if (bodySignal?.aborted) throw new Error(`${label} response timeout`);
        throw error;
      }
      if (bodySignal?.aborted) throw new Error(`${label} response timeout`);
      if (next.done) break;
      const chunk =
        next.value instanceof Uint8Array
          ? next.value
          : new Uint8Array(next.value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        sizeExceeded = true;
        abortBody();
        void reader.cancel().catch(() => {});
        throw new Error(`${label} response exceeded byte limit`);
      }
      chunks.push(chunk);
    }
  } finally {
    bodySignal?.removeEventListener("abort", abortHandler);
    reader.releaseLock?.();
    if (localTimer !== undefined) clearTimeout(localTimer);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
export async function boundedFetch(
  input,
  init = {},
  { timeoutMs, maxBytes, label },
) {
  const controller = new AbortController();
  const parent = init.signal;
  const abortParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) abortParent();
  else parent?.addEventListener("abort", abortParent, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
    const bytes = await boundedBody(response, maxBytes, timeoutMs, label, {
      signal: controller.signal,
      abort: () => controller.abort(),
    });
    return { response, bytes };
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abortParent);
  }
}
async function mcpFetchFactory(baseUrl) {
  return async (input, init = {}) => {
    const requestUrl = new URL(String(input), baseUrl);
    if (
      requestUrl.origin !== baseUrl.origin ||
      requestUrl.username ||
      requestUrl.password
    )
      throw new Error("MCP request crossed configured origin");
    const headers = new Headers(init.headers);
    if (
      headers.has("authorization") ||
      headers.has("x-vercel-protection-bypass") ||
      headers.has("cookie")
    )
      throw new Error("MCP request attempted credentials or bypass headers");
    const { response, bytes } = await boundedFetch(
      requestUrl,
      { ...init, headers },
      { timeoutMs: MCP_TIMEOUT_MS, maxBytes: MCP_MAX_BYTES, label: "MCP" },
    );
    return new Response(bytes, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
function jsonBytes(bytes, label) {
  const body = new TextDecoder().decode(bytes);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}
function providerUrl(endpoint, params) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) url.searchParams.set(key, String(value));
  return url;
}
async function providerJson(endpoint, params, label) {
  const url = providerUrl(endpoint, params);
  const { response, bytes } = await boundedFetch(
    url,
    { headers: { accept: "application/json" } },
    { timeoutMs: PROVIDER_TIMEOUT_MS, maxBytes: PROVIDER_MAX_BYTES, label },
  );
  if (!response.ok) throw new Error(`${label} HTTP status ${response.status}`);
  return {
    status: response.status,
    endpoint: redactUrl(url.toString()),
    payload: jsonBytes(bytes, label),
  };
}
function decodeServiceKeyOnce(value) {
  const trimmed = text(value);
  if (!/%[0-9a-f]{2}/iu.test(trimmed)) return trimmed;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}
function queryParamsForBusiness(input, key) {
  const params = {
    divId: input.regionType,
    key: input.regionCode,
    pageNo: input.page,
    numOfRows: input.pageSize,
    type: "json",
    serviceKey: key,
  };
  if (input.industryType) params[input.industryType] = input.industryCode;
  return params;
}
function businessItems(payload) {
  if (
    !isRecord(payload) ||
    !isRecord(payload.header) ||
    !isRecord(payload.body)
  )
    throw new Error("business response must have top-level header and body");
  const items = payload.body.items;
  if (Array.isArray(items)) return items;
  if (isRecord(items) && Array.isArray(items.item)) return items.item;
  if (isRecord(items) && isRecord(items.item)) return [items.item];
  if (items === undefined || items === null) return [];
  throw new Error("business response items is malformed");
}
export function validateBusinessPage(payload, expected = {}) {
  if (
    !isRecord(payload) ||
    !isRecord(payload.header) ||
    !isRecord(payload.body)
  )
    return {
      ok: false,
      reason: "business response is not top-level header/body JSON",
    };
  if (
    text(payload.header.resultCode) !== "00" ||
    !/NORMAL(?: SERVICE)?/iu.test(text(payload.header.resultMsg))
  )
    return {
      ok: false,
      reason: "business provider header is not NORMAL SERVICE 00",
    };
  const page = Number(payload.body.pageNo),
    size = Number(payload.body.numOfRows),
    total = Number(payload.body.totalCount);
  if (
    ![page, size, total].every(Number.isSafeInteger) ||
    page !== Number(expected.page) ||
    size !== Number(expected.pageSize) ||
    total < 0
  )
    return {
      ok: false,
      reason: "business page metadata does not match the request",
    };
  let items;
  try {
    items = businessItems(payload);
  } catch (error) {
    return { ok: false, reason: sanitizeError(error) };
  }
  const expectedCount = Math.min(size, Math.max(0, total - (page - 1) * size));
  if (items.length !== expectedCount)
    return {
      ok: false,
      reason: `business page cardinality ${items.length} does not equal expected ${expectedCount}`,
    };
  const ids = new Set();
  for (const item of items) {
    if (!isRecord(item))
      return { ok: false, reason: "business item is not an object" };
    const id = text(item.bizesId);
    if (!id) return { ok: false, reason: "business item has no bizesId" };
    if (ids.has(id))
      return { ok: false, reason: "duplicate bizesId within business page" };
    ids.add(id);
    if (
      expected.regionCode !== undefined &&
      text(item[expected.regionField ?? "signguCd"]) !==
        text(expected.regionCode)
    )
      return { ok: false, reason: "business item region code mismatch" };
    if (
      expected.regionName !== undefined &&
      text(item.signguNm) !== text(expected.regionName)
    )
      return { ok: false, reason: "business item region name mismatch" };
    const address = [
      item.rdnmAdr,
      item.rdnmadr,
      item.lnoAdr,
      item.lnoadr,
      item.siteWhlAddr,
      item.address,
    ].some((value) => text(value));
    if (!address)
      return { ok: false, reason: "business item has no nonempty address" };
    if (
      expected.industryType &&
      text(item[expected.industryType]) !== text(expected.industryCode)
    )
      return { ok: false, reason: "business item industry filter mismatch" };
  }
  return { ok: true, items, page, pageSize: size, total, ids: [...ids] };
}
export function validateBusinessPages(pages, expected = {}) {
  if (!Array.isArray(pages) || pages.length === 0)
    return { ok: false, reason: "business query has no pages" };
  const requestedPages =
    expected.pages ??
    pages.map((_, index) => Number(expected.page ?? 1) + index);
  if (
    !Array.isArray(requestedPages) ||
    requestedPages.length !== pages.length ||
    new Set(requestedPages).size !== requestedPages.length ||
    !requestedPages.every((page) => Number.isSafeInteger(page) && page >= 1)
  )
    return {
      ok: false,
      reason: "business requested page sequence is incomplete or invalid",
    };
  const all = new Set();
  const validated = [];
  for (const [index, page] of pages.entries()) {
    const result = validateBusinessPage(page?.payload ?? page, {
      ...expected,
      page: requestedPages[index],
    });
    if (!result.ok) return result;
    for (const id of result.ids) {
      if (all.has(id))
        return { ok: false, reason: "duplicate bizesId across business pages" };
      all.add(id);
    }
    validated.push(result);
  }
  return { ok: true, pages: validated, ids: [...all] };
}
export function validateBusinessQueryGroups(groups, expectedByGroup) {
  if (
    !Array.isArray(groups) ||
    !Array.isArray(expectedByGroup) ||
    groups.length !== expectedByGroup.length
  ) {
    return {
      ok: false,
      reason: "business query groups and expectations must have equal lengths",
    };
  }
  const validated = groups.map((group, index) =>
    validateBusinessPages(group, expectedByGroup[index]),
  );
  const failure = validated.find((item) => !item.ok);
  return failure ? failure : { ok: true, groups: validated };
}

function check(name, pass, explanation) {
  return { name, pass: Boolean(pass), explanation: String(explanation) };
}
function emptyChecks() {
  return { identity: [], value: [], completeness: [], honesty: [] };
}
function addFailure(result, category, name, pass, explanation) {
  result.checks[category].push(check(name, pass, explanation));
  if (!pass)
    result.failureExplanations.push(`${category}.${name}: ${explanation}`);
}
function categoriesPass(checks) {
  return Object.values(checks).every(
    (items) => items.length > 0 && items.every((item) => item.pass),
  );
}
export function scoreCase(caseResult) {
  const positive = caseResult.mode === "answer";
  const unsuccessfulOutput =
    caseResult.outputsSuccessful !== true ||
    (Array.isArray(caseResult.sanitizedOutputs) &&
      caseResult.sanitizedOutputs.some((output) => output?.success === false));
  const positiveRefusal = positive && unsuccessfulOutput;
  const categoryPoints = Object.fromEntries(
    Object.entries(CATEGORY_WEIGHTS).map(([category, weight]) => [
      category,
      !positiveRefusal &&
      caseResult.status !== "BLOCKED" &&
      caseResult.status !== "UNAVAILABLE" &&
      Array.isArray(caseResult.checks?.[category]) &&
      caseResult.checks[category].length > 0 &&
      caseResult.checks[category].every((item) => item.pass)
        ? weight
        : 0,
    ]),
  );
  const passed =
    caseResult.status === "PASS" &&
    Object.values(categoryPoints).every((points) => points > 0) &&
    !positiveRefusal;
  const points = Object.values(categoryPoints).reduce(
    (sum, value) => sum + value,
    0,
  );
  return { id: caseResult.id, passed, points, categoryPoints };
}
export function scoreBenchmark(caseResults, integrityViolations = []) {
  const scored = caseResults.map(scoreCase);
  const allCasesPassed =
    scored.length === 10 && scored.every((item) => item.passed);
  const rawTotal = scored.reduce((sum, item) => sum + item.points, 0);
  const total =
    integrityViolations.length > 0 ? 0 : allCasesPassed ? 100 : rawTotal;
  return {
    total,
    maximum: 100,
    weights: { ...CATEGORY_WEIGHTS },
    allCasesPassed,
    integrityViolations: [...integrityViolations],
    cases: scored,
    passed: total === 100 && allCasesPassed && integrityViolations.length === 0,
  };
}

function toolItems(output) {
  for (const key of ["items", "data", "rows"])
    if (Array.isArray(output?.[key])) return output[key];
  return [];
}
function outputNumber(output) {
  return parseNumber(output?.value);
}
function periodYear(value) {
  const match = text(value).match(/\b(\d{4})\b/u);
  return match?.[1] ?? text(value);
}
function oracleUnit(rows) {
  const units = [
    ...new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => text(row?.UNIT_NM))
        .filter((unit) => unit && !unknownUnit(unit)),
    ),
  ];
  return units.length === 1 ? units[0] : undefined;
}
function oracleUnitStatus(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const units = [
    ...new Set(
      sourceRows
        .map((row) => text(row?.UNIT_NM))
        .filter((unit) => unit && !unknownUnit(unit)),
    ),
  ];
  const missing =
    sourceRows.length > 0 && sourceRows.every((row) => !text(row?.UNIT_NM));
  const known =
    sourceRows.length > 0 &&
    units.length === 1 &&
    sourceRows.every((row) => text(row?.UNIT_NM) && !unknownUnit(row.UNIT_NM));
  return { unit: known ? units[0] : undefined, known, missing };
}
export { oracleUnitStatus };
function parsePercentage(value) {
  const token = text(value);
  return /^[+-]?\d+(?:\.\d+)?%$/u.test(token)
    ? Number(token.slice(0, -1))
    : Number.NaN;
}
export function hasDerivedTrendClaims(output) {
  const points = outputDataPoints(output);
  if (
    points.some(
      (point) =>
        point.absoluteChange !== undefined || point.changeRate !== undefined,
    )
  )
    return true;
  if (!Array.isArray(output?.insights)) return true;

  const explicitDeferral =
    /(?:보류|유보|확인할\s*수\s*없|확인되지\s*않|알\s*수\s*없|판단할\s*수\s*없|단정할\s*수\s*없|비교[^.!?\n]*(?:불가|어렵|할\s*수\s*없)|(?:파생|추세|변화율|증감|방향성)[^.!?\n]*(?:계산|산출|판정|비교|해석)[^.!?\n]*(?:하지\s*않|않았|못)|(?:단위|정의)[^.!?\n]*(?:미상|없|확인되지\s*않|확인할\s*수\s*없))/iu;
  const derived =
    /(?:증가|감소|상승|하락|늘(?:었|어|고)?|줄(?:었|어|고)?|증감|변화|추세|전년\s*대비|최고|최저)/iu;
  const numeric =
    /(?:인구|인원|주민|출생아수|출생|통계|수치|값|관측)[^0-9]{0,24}[+-]?\d[\d,]*(?:\.\d+)?(?![\d])(?:\s*(?:명|건|%|원|만)|(?!\s*(?:년|월|일)))/iu;
  const unitNumber = /[+-]?\d[\d,]*(?:\.\d+)?\s*(?:명|건|%|원|만)/iu;
  const narrativeValues = [
    output?.answer,
    output?.note,
    output?.summary,
    output?.trendDescription,
    output?.trend,
    ...(Array.isArray(output?.caveats)
      ? output.caveats
      : output?.caveats === undefined || output?.caveats === null
        ? []
        : [output.caveats]),
    ...output.insights,
  ];
  return narrativeValues.some((value) =>
    text(value)
      .split(/[.!?\n]+/u)
      .flatMap((sentence) =>
        sentence.split(/[,，;；]|하지만|그러나|다만|지만/u),
      )
      .some((sentence) => {
        const clause = sentence.trim();
        return (
          clause.length > 0 &&
          !explicitDeferral.test(clause) &&
          (derived.test(clause) ||
            numeric.test(clause) ||
            unitNumber.test(clause))
        );
      }),
  );
}
export function validateTrendChanges(
  points,
  expectedValues,
  years,
  {
    requireDerivedChanges = false,
    requirePublicContract = false,
    expectedRawValues,
  } = {},
) {
  if (!Array.isArray(points) || points.length !== years.length)
    return {
      ok: false,
      reason: "trend points do not cover the requested years",
    };
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const year = periodYear(point?.year);
    const value = outputValue(point);
    if (
      requirePublicContract &&
      (typeof point?.value !== "number" ||
        !Number.isFinite(point.value) ||
        typeof point?.year !== "string" ||
        typeof point?.rawValue !== "string")
    )
      return {
        ok: false,
        reason: `trend point ${years[index]} does not satisfy the public data-point contract`,
      };
    if (
      year !== String(years[index]) ||
      value === null ||
      value !== expectedValues[year] ||
      (requirePublicContract &&
        (parseNumber(point.rawValue) !== value ||
          (expectedRawValues !== undefined &&
            point.rawValue !== expectedRawValues[year])))
    )
      return {
        ok: false,
        reason: `trend observation ${years[index]} does not equal the independent oracle`,
      };
    if (index === 0) continue;
    if (
      requireDerivedChanges &&
      (point.absoluteChange === undefined ||
        point.changeRate === undefined ||
        (requirePublicContract &&
          (typeof point.absoluteChange !== "number" ||
            !Number.isFinite(point.absoluteChange) ||
            typeof point.changeRate !== "string")))
    )
      return {
        ok: false,
        reason: `trend observation ${years[index]} omitted or mistyped required change fields`,
      };
    const previousYear = String(years[index - 1]);
    const previous = expectedValues[previousYear];
    if (
      previous === undefined ||
      (point.absoluteChange !== undefined &&
        Number(point.absoluteChange) !== value - previous)
    )
      return {
        ok: false,
        reason: `trend absolute change for ${years[index]} does not match adjacent oracle values`,
      };
    if (point.changeRate !== undefined) {
      if (previous === 0) {
        if (!/^N\/A$/iu.test(text(point.changeRate)))
          return {
            ok: false,
            reason: `trend change rate for ${years[index]} is invalid for a zero baseline`,
          };
      } else {
        const observedRate = parsePercentage(point.changeRate);
        const expectedRate = ((value - previous) / Math.abs(previous)) * 100;
        if (
          !Number.isFinite(observedRate) ||
          Math.abs(observedRate - expectedRate) > 0.051
        )
          return {
            ok: false,
            reason: `trend change rate for ${years[index]} does not match adjacent oracle values`,
          };
      }
    }
  }
  return { ok: true };
}
export function validateCandidateUnit(
  output,
  expectedUnit,
  { allowMissing = false } = {},
) {
  const observed = text(output?.unit ?? output?.source?.unit);
  if (expectedUnit)
    return observed === expectedUnit
      ? { ok: true }
      : {
          ok: false,
          reason: "candidate unit does not match the official UNIT_NM",
        };
  return allowMissing && !observed
    ? { ok: true }
    : { ok: false, reason: "candidate unit is unverified or fabricated" };
}
export function hasUnsupportedCausalClaim(output) {
  const sentences = JSON.stringify(output).split(/[.!?\n]+/u);
  return sentences.some(
    (sentence) =>
      /원인|때문|청년\s*유출|인과|영향을\s*받/iu.test(sentence) &&
      !/(?:원인|인과|청년\s*유출|영향을\s*받)[^.!?\n]*(?:아니|없|알\s*수\s*없|단정|확인되지|모르)/iu.test(
        sentence,
      ),
  );
}
function makeCaseResult(spec) {
  return {
    id: spec.id,
    mode: spec.mode,
    kind: spec.kind,
    question: spec.question,
    inputs: sanitizeValue(spec),
    sanitizedOutputs: [],
    rawOracleObservations: [],
    checks: emptyChecks(),
    failureExplanations: [],
    latencyMs: 0,
    status: "BLOCKED",
    outputsSuccessful: false,
  };
}
function recordOutput(result, output) {
  result.sanitizedOutputs.push(sanitizeValue(output));
  return output;
}
function recordOracle(result, observation) {
  result.rawOracleObservations.push(sanitizeValue(observation));
}

export function fillMissingChecks(result, reason = "check was not executed") {
  for (const category of Object.keys(CATEGORY_WEIGHTS)) {
    if (result.checks[category].length === 0)
      addFailure(result, category, "not-run", false, reason);
  }
}
async function runCase(spec, client, keys) {
  const result = makeCaseResult(spec);
  const started = Date.now();
  try {
    if (spec.kind === "business-pages")
      await runBusinessCase(spec, result, client, keys);
    else if (spec.kind === "population-pair")
      await runPopulationPairCase(spec, result, client, keys);
    else if (spec.kind === "population")
      await runPopulationCase(spec, result, client, keys);
    else if (spec.kind === "population-trend")
      await runPopulationTrendCase(spec, result, client, keys);
    else if (spec.kind === "birth-trend")
      await runBirthTrendCase(spec, result, client, keys);
    else if (
      spec.kind === "ambiguous-region" ||
      spec.kind === "nonexistent-region"
    )
      await runRejectCase(spec, result, client, keys);
    else throw new Error("unsupported benchmark case kind");
  } catch (error) {
    result.failureExplanations.push(`case execution: ${sanitizeError(error)}`);
    result.status = result.status === "UNAVAILABLE" ? result.status : "BLOCKED";
  }
  fillMissingChecks(
    result,
    result.failureExplanations.at(-1) ?? "check was not executed",
  );
  result.latencyMs = Date.now() - started;
  if (result.status === "PASS" && !categoriesPass(result.checks))
    result.status = "FAIL";
  if (result.status !== "PASS") result.outputsSuccessful = false;
  return result;
}

async function callTool(client, name, args) {
  const result = await withTimeout(
    client.callTool({ name, arguments: args }, undefined, {
      timeout: MCP_TIMEOUT_MS,
      maxTotalTimeout: MCP_TIMEOUT_MS,
    }),
    MCP_TIMEOUT_MS,
    name,
  );
  return extractToolObject(result, name);
}
async function kosisRows(result, label) {
  const rows = result.payload;
  if (
    isRecord(rows) &&
    (rows.error || rows.errMsg || rows.RESULT?.CODE || rows.resultCode)
  )
    throw new Error(`${label} returned an error envelope`);
  const parsed = Array.isArray(rows)
    ? rows
    : isRecord(rows) && Array.isArray(rows.result)
      ? rows.result
      : null;
  if (!parsed)
    throw new Error(`${label} returned an error envelope or non-array`);
  return parsed;
}
async function fetchKosisData(key, tableId, itemId, years, code = "ALL") {
  return providerJson(
    KOSIS_DATA_ENDPOINT,
    {
      method: "getList",
      orgId: "101",
      tblId: tableId,
      objL1: code,
      itmId: itemId,
      prdSe: "Y",
      startPrdDe: years[0],
      endPrdDe: years.at(-1),
      format: "json",
      jsonVD: "Y",
      apiKey: key,
    },
    "KOSIS data",
  );
}
export function validateSupplementalAffiliation(row, expected = {}) {
  if (!isRecord(row))
    return { ok: false, reason: "affiliation row is not an object" };
  if (text(row.signguCd) !== text(expected.signguCode))
    return {
      ok: false,
      reason: "affiliation signguCd does not match the active KOSIS code",
    };
  if (text(row.ctprvnCd) !== text(expected.provinceCode))
    return {
      ok: false,
      reason: "affiliation ctprvnCd does not match the official province code",
    };
  if (!normalizedExactNameEquals(expected.provinceName, row.ctprvnNm))
    return { ok: false, reason: "affiliation province name does not match" };
  if (text(row.signguNm) !== text(expected.fullName))
    return {
      ok: false,
      reason: "affiliation full municipality name does not match",
    };
  return { ok: true, row };
}
async function verifyIntermediateAdministrativeJoin(
  candidate,
  officialPath,
  key,
) {
  if (!key)
    throw new Error(
      "official intermediate municipality join requires DATA_GO_KR_SERVICE_KEY",
    );
  const response = await providerJson(
    BUSINESS_ENDPOINT,
    queryParamsForBusiness(
      {
        regionType: "signguCd",
        regionCode: candidate.code,
        page: 1,
        pageSize: 1,
      },
      key,
    ),
    "business affiliation oracle",
  );
  if (
    !isRecord(response.payload) ||
    !isRecord(response.payload.header) ||
    !isRecord(response.payload.body)
  )
    throw new Error("official affiliation response must have header and body");
  if (
    text(response.payload.header.resultCode) !== "00" ||
    !/NORMAL(?: SERVICE)?/iu.test(text(response.payload.header.resultMsg))
  )
    throw new Error("official affiliation response is not NORMAL SERVICE 00");
  const rows = businessItems(response.payload);
  if (
    Number(response.payload.body.pageNo) !== 1 ||
    Number(response.payload.body.numOfRows) !== 1 ||
    rows.length !== 1
  )
    throw new Error(
      "official affiliation response must contain exactly one current candidate",
    );
  const row = rows[0];
  const provinceCode = text(candidate.rows?.[0]?.ITM_ID);
  const affiliation = validateSupplementalAffiliation(row, {
    signguCode: candidate.code,
    provinceCode,
    provinceName: officialPath[0],
    fullName: `${officialPath.at(-2)} ${officialPath.at(-1)}`,
  });
  if (!affiliation.ok) throw new Error(affiliation.reason);
  return { response, row };
}
async function populationOracle(
  result,
  key,
  path,
  years,
  tableId = "DT_1B040A3",
  itemId = "T20",
  cache = {},
) {
  cache.metadata ??= new Map();
  cache.data ??= new Map();
  const metadataKey = tableId;
  let metaResponse = cache.metadata.get(metadataKey);
  if (!metaResponse) {
    metaResponse = await providerJson(
      KOSIS_META_ENDPOINT,
      {
        method: "getMeta",
        type: "ITM",
        orgId: "101",
        tblId: tableId,
        objId: "A",
        format: "json",
        jsonVD: "Y",
        apiKey: key,
      },
      "KOSIS metadata",
    );
    cache.metadata.set(metadataKey, metaResponse);
  }
  const metadata = parseKosisMetadata(metaResponse.payload);
  const candidates = relaxedOfficialPathCandidates(metadata, path);
  if (candidates.length === 0)
    throw new Error(`official region path not found: ${path.join(" /")}`);
  const dataKey = `${tableId}|${itemId}|${years[0]}|${years.at(-1)}`;
  let dataResponses = [];
  let rows;
  const cachedData = cache.data.get(dataKey);
  if (cachedData) {
    dataResponses = cachedData.responses;
    rows = cachedData.rows;
  } else {
    try {
      const response = await fetchKosisData(key, tableId, itemId, years, "ALL");
      dataResponses = [response];
      rows = await kosisRows(response, "KOSIS data");
    } catch (error) {
      // ALL is the primary request. Only its bounded-size failure permits candidate
      // requests; candidates are actual metadata IDs, never guessed code prefixes.
      if (!/exceeded byte limit/iu.test(sanitizeError(error))) throw error;
      for (const candidate of candidates)
        dataResponses.push(
          await fetchKosisData(key, tableId, itemId, years, candidate.code),
        );
      rows = [];
      for (const response of dataResponses)
        rows.push(...(await kosisRows(response, "KOSIS candidate data")));
    }
    cache.data.set(dataKey, { responses: dataResponses, rows });
  }
  const active = selectActiveOfficialCandidate(candidates, rows);
  const resolved = active.candidate;
  const validation = validatePopulationObservations(active.rows, {
    code: resolved.code,
    names: resolved.names,
    itemId,
    periodType: "Y",
    startYear: years[0],
    endYear: years.at(-1),
    allowMissingUnit: tableId === "DT_1B81A23",
  });
  if (!validation.ok) throw new Error(validation.reason);
  const affiliation = resolved.missingIntermediate
    ? await verifyIntermediateAdministrativeJoin(
        resolved,
        path,
        cache.businessKey,
      )
    : undefined;
  return {
    resolved,
    metadata: {
      status: metaResponse.status,
      endpoint: metaResponse.endpoint,
      rows: metadata,
    },
    data: {
      status: dataResponses.at(-1).status,
      endpoint: dataResponses.at(-1).endpoint,
      rows: active.rows,
    },
    validation,
    ...(affiliation
      ? {
          affiliation: {
            endpoint: affiliation.response.endpoint,
            row: affiliation.row,
          },
        }
      : {}),
  };
}
function requireKosis(keys) {
  if (!keys.kosis)
    throw new Error(
      "KOSIS_API_KEY is not configured; independent oracle is blocked",
    );
  return keys.kosis;
}
function requireBusiness(keys) {
  if (!keys.business)
    throw new Error(
      "DATA_GO_KR_SERVICE_KEY is not configured; independent oracle is blocked",
    );
  return keys.business;
}
function outputSourceMatches(output, oracle, tableId = "DT_1B040A3") {
  return (
    output?.source?.orgId === "101" &&
    output?.source?.tableId === tableId &&
    text(output?.source?.regionCode) === text(oracle.code)
  );
}
function outputDataPoints(output) {
  return Array.isArray(output?.dataPoints) ? output.dataPoints : [];
}
function checkYears(points, years) {
  return (
    points.length === years.length &&
    points.every(
      (point, index) => periodYear(point.year) === String(years[index]),
    )
  );
}
function outputValue(point) {
  return parseNumber(point?.value ?? point?.rawValue);
}
function changeMatches(point, previous) {
  const current = outputValue(point);
  const before = outputValue(previous);
  if (current === null || before === null) return false;
  if (
    point.absoluteChange !== undefined &&
    (!Number.isFinite(Number(point.absoluteChange)) ||
      Math.abs(Number(point.absoluteChange) - (current - before)) > 1e-9)
  )
    return false;
  if (point.changeRate !== undefined) {
    if (before === 0) return /^N\/A$/iu.test(text(point.changeRate));
    const observedRate = parsePercentage(point.changeRate);
    const expectedRate = ((current - before) / Math.abs(before)) * 100;
    if (
      !Number.isFinite(observedRate) ||
      Math.abs(observedRate - expectedRate) > 0.051
    )
      return false;
  }
  return true;
}

async function runPopulationCase(spec, result, client, keys) {
  const key = requireKosis(keys);
  const path = spec.officialPaths[0],
    years = [String(spec.year)];
  const output = recordOutput(
    result,
    await callTool(client, "quick_stats", {
      query: "인구",
      region: spec.regions[0],
      year: spec.year,
    }),
  );
  const oracle = await populationOracle(
    result,
    key,
    path,
    years,
    "DT_1B040A3",
    "T20",
    keys.oracleCache,
  );
  recordOracle(result, {
    provider: "KOSIS",
    tableId: "DT_1B040A3",
    metadata: oracle.metadata,
    observations: oracle.data,
  });
  const expectedUnit = oracleUnit(oracle.data.rows);
  result.outputsSuccessful = output.success === true;
  addFailure(
    result,
    "identity",
    "official-region",
    outputSourceMatches(output, oracle.resolved),
    "candidate source region code must equal the independently resolved official code",
  );
  addFailure(
    result,
    "identity",
    "table",
    output?.source?.tableId === "DT_1B040A3",
    "candidate must cite the population table",
  );
  addFailure(
    result,
    "identity",
    "region-name",
    text(output?.source?.regionCode) === text(oracle.resolved.code),
    "candidate must not substitute another region",
  );
  addFailure(
    result,
    "value",
    "success",
    output.success === true,
    "positive answer must return a successful observation",
  );
  addFailure(
    result,
    "value",
    "exact-value",
    outputNumber(output) === oracle.validation.values[years[0]],
    "candidate scalar must equal the independent raw observation",
  );
  addFailure(
    result,
    "value",
    "numeric",
    outputNumber(output) !== null,
    "candidate value must be numeric",
  );
  addFailure(
    result,
    "completeness",
    "period",
    periodYear(output.period) === years[0],
    "candidate period must equal the requested year",
  );
  addFailure(
    result,
    "completeness",
    "source",
    output?.source?.periodType === "Y",
    "candidate must expose annual source period",
  );
  addFailure(
    result,
    "honesty",
    "verified",
    output.validationLevel === "verified",
    "candidate must not claim an unverified scalar",
  );
  addFailure(
    result,
    "honesty",
    "unit",
    validateCandidateUnit(output, expectedUnit).ok,
    "candidate unit must exactly match the known official UNIT_NM",
  );
  addFailure(
    result,
    "honesty",
    "no-fabrication",
    output.success !== true ||
      outputNumber(output) !== 0 ||
      oracle.validation.values[years[0]] === 0,
    "zero is accepted only when the official observation is actually zero",
  );
  result.status = categoriesPass(result.checks) ? "PASS" : "FAIL";
}
async function runPopulationPairCase(spec, result, client, keys) {
  const key = requireKosis(keys);
  const outputs = [];
  const oracles = [];
  for (let index = 0; index < 2; index += 1) {
    outputs.push(
      recordOutput(
        result,
        await callTool(client, "quick_stats", {
          query: "인구",
          region: spec.regions[index],
          year: spec.year,
        }),
      ),
    );
    const oracle = await populationOracle(
      result,
      key,
      spec.officialPaths[index],
      [String(spec.year)],
      "DT_1B040A3",
      "T20",
      keys.oracleCache,
    );
    oracles.push(oracle);
    recordOracle(result, {
      provider: "KOSIS",
      tableId: "DT_1B040A3",
      path: oracle.resolved.path,
      observations: oracle.data,
    });
    if (oracle.affiliation)
      recordOracle(result, {
        provider: "SMEA",
        endpoint: oracle.affiliation.endpoint,
        observations: oracle.affiliation.row,
        basis: "current-name-only affiliation; no historical-boundary claim",
      });
  }
  result.outputsSuccessful = outputs.every((output) => output.success === true);
  addFailure(
    result,
    "identity",
    "both-regions",
    outputs.every((output, i) =>
      outputSourceMatches(output, oracles[i].resolved),
    ),
    "each output must use its independently resolved region code",
  );
  addFailure(
    result,
    "identity",
    "distinct-codes",
    new Set(oracles.map((oracle) => oracle.resolved.code)).size === 2 &&
      new Set(outputs.map((output) => text(output?.source?.regionCode)))
        .size === 2,
    "the two region identities must remain distinct",
  );
  addFailure(
    result,
    "identity",
    "table",
    outputs.every((output) => output?.source?.tableId === "DT_1B040A3"),
    "both outputs must cite the population table",
  );
  addFailure(
    result,
    "value",
    "success",
    result.outputsSuccessful,
    "positive pair must return two successful observations",
  );
  addFailure(
    result,
    "value",
    "exact-values",
    outputs.every(
      (output, i) =>
        outputNumber(output) ===
        oracles[i].validation.values[String(spec.year)],
    ),
    "each scalar must equal its independent observation",
  );
  addFailure(
    result,
    "value",
    "coincidence-allowed",
    true,
    "equal official values do not invalidate distinct identities",
  );
  addFailure(
    result,
    "completeness",
    "periods",
    outputs.every((output) => periodYear(output.period) === String(spec.year)),
    "both periods must be requested year",
  );
  addFailure(
    result,
    "completeness",
    "sources",
    outputs.every((output) => output?.source?.periodType === "Y"),
    "both sources must expose annual period",
  );
  addFailure(
    result,
    "honesty",
    "verified",
    outputs.every((output) => output.validationLevel === "verified"),
    "both values must be explicitly verified",
  );
  addFailure(
    result,
    "honesty",
    "no-substitution",
    outputs.every(
      (output, i) =>
        text(output?.source?.regionCode) === text(oracles[i].resolved.code),
    ),
    "no national or other-region fallback is permitted",
  );
  addFailure(
    result,
    "honesty",
    "units",
    outputs.every(
      (output, i) =>
        validateCandidateUnit(output, oracleUnit(oracles[i].data.rows)).ok,
    ),
    "each population candidate unit must exactly match the known official UNIT_NM",
  );
  result.status = categoriesPass(result.checks) ? "PASS" : "FAIL";
}
async function runPopulationTrendCase(spec, result, client, keys) {
  const key = requireKosis(keys);
  const years = Array.from(
    { length: spec.endYear - spec.startYear + 1 },
    (_, i) => spec.startYear + i,
  );
  const output = recordOutput(
    result,
    await callTool(client, "quick_trend", {
      keyword: "인구",
      region: spec.regions[0],
      startYear: spec.startYear,
      endYear: spec.endYear,
    }),
  );
  const oracle = await populationOracle(
    result,
    key,
    spec.officialPaths[0],
    years.map(String),
    "DT_1B040A3",
    "T20",
    keys.oracleCache,
  );
  recordOracle(result, {
    provider: "KOSIS",
    tableId: "DT_1B040A3",
    observations: oracle.data,
  });
  const points = outputDataPoints(output);
  const expected = oracle.validation.values;
  const expectedUnit = oracleUnit(oracle.data.rows);
  const trendValidation = validateTrendChanges(points, expected, years, {
    requireDerivedChanges: true,
    requirePublicContract: true,
    expectedRawValues: oracle.validation.rawValues,
  });
  result.outputsSuccessful = output.success === true;
  addFailure(
    result,
    "identity",
    "official-region",
    outputSourceMatches(output, oracle.resolved),
    "trend source region must equal official hierarchy",
  );
  addFailure(
    result,
    "identity",
    "table",
    output?.source?.tableId === "DT_1B040A3",
    "trend must cite population table",
  );
  addFailure(
    result,
    "identity",
    "keyword-region",
    output.keyword === "인구" &&
      text(output.region).includes(
        text(spec.regions[0]).replace(/^부산\s*/u, ""),
      ),
    "trend must preserve requested keyword and region",
  );
  addFailure(
    result,
    "identity",
    "source-unit",
    expectedUnit !== undefined &&
      text(output?.source?.unit) === expectedUnit &&
      (!text(output?.unit) || text(output.unit) === expectedUnit),
    "trend source.unit must exactly match the known official UNIT_NM",
  );
  addFailure(
    result,
    "value",
    "success",
    output.success === true,
    "positive trend must succeed",
  );
  addFailure(
    result,
    "value",
    "exact-values",
    trendValidation.ok,
    "every trend value and required change must equal independent observations",
  );
  addFailure(
    result,
    "completeness",
    "continuous-years",
    checkYears(points, years),
    "trend must contain exactly continuous requested years",
  );
  addFailure(
    result,
    "completeness",
    "no-duplicates",
    new Set(points.map((point) => periodYear(point.year))).size ===
      points.length,
    "trend must not duplicate years",
  );
  addFailure(
    result,
    "honesty",
    "no-causal-claim",
    !hasUnsupportedCausalClaim(output),
    "population observations do not prove a causal youth-outflow claim",
  );
  addFailure(
    result,
    "honesty",
    "verified",
    output.validationLevel === "verified",
    "population trend must have an explicit verified level",
  );
  result.status = categoriesPass(result.checks) ? "PASS" : "FAIL";
}
async function runBirthTrendCase(spec, result, client, keys) {
  const key = requireKosis(keys);
  const years = [spec.startYear, spec.endYear];
  const output = recordOutput(
    result,
    await callTool(client, "quick_trend", {
      keyword: "출생아수",
      region: spec.regions[0],
      startYear: spec.startYear,
      endYear: spec.endYear,
    }),
  );
  const oracle = await populationOracle(
    result,
    key,
    spec.officialPaths[0],
    years.map(String),
    "DT_1B81A23",
    "T1",
    keys.oracleCache,
  );
  recordOracle(result, {
    provider: "KOSIS",
    tableId: "DT_1B81A23",
    observations: oracle.data,
  });
  const points = outputDataPoints(output),
    expected = oracle.validation.values;
  const expectedUnit = oracleUnit(oracle.data.rows);
  result.outputsSuccessful = output.success === true;
  addFailure(
    result,
    "identity",
    "birth-table",
    output?.source?.tableId === "DT_1B81A23",
    "birth trend must cite the independent birth table",
  );
  addFailure(
    result,
    "identity",
    "official-region",
    outputSourceMatches(output, oracle.resolved, "DT_1B81A23"),
    "birth trend region must equal independently resolved A code",
  );
  addFailure(
    result,
    "identity",
    "candidate-owns-identity",
    output?.source?.regionCode !== undefined &&
      output?.source?.periodType === "Y",
    "candidate must expose its own annual source identity",
  );
  addFailure(
    result,
    "value",
    "success",
    output.success === true,
    "positive birth trend must return observations",
  );
  addFailure(
    result,
    "value",
    "raw-values",
    points.length === years.length &&
      points.every(
        (point) =>
          point.rawValue ===
          oracle.validation.rawValues[periodYear(point.year)],
      ),
    "birth raw values must equal the official observations",
  );
  addFailure(
    result,
    "value",
    "numeric-values",
    validateTrendChanges(points, expected, years, {
      requirePublicContract: true,
      expectedRawValues: oracle.validation.rawValues,
    }).ok,
    "birth numeric and raw values must both equal the independent observations",
  );
  addFailure(
    result,
    "completeness",
    "years",
    checkYears(points, years),
    "birth trend must cover both requested years exactly",
  );
  addFailure(
    result,
    "completeness",
    "no-fabricated-change",
    points.slice(1).every((point, i) => changeMatches(point, points[i])),
    "returned birth changes must be arithmetic on adjacent raw values",
  );
  const unitStatus = oracleUnitStatus(oracle.data.rows);
  const unitKnown = unitStatus.known;
  const unitMissing = unitStatus.missing;
  const caveat =
    (Array.isArray(output.caveats) && output.caveats.length > 0) ||
    /단위|정의|보류|잠정|비교/iu.test(
      `${text(output.note)} ${text(output.summary)} ${text(output.trendDescription)}`,
    );
  const unitHonest = unitKnown
    ? text(output?.source?.unit) === expectedUnit &&
      (!text(output?.unit) || text(output.unit) === expectedUnit)
    : unitMissing &&
      !text(output?.source?.unit) &&
      !text(output?.unit) &&
      output.trend === "deferred" &&
      output.validationLevel !== "verified" &&
      !hasDerivedTrendClaims(output) &&
      caveat;
  addFailure(
    result,
    "honesty",
    "definition-caveat",
    unitHonest,
    "when the birth definition/unit is not proven, output must defer trend with an explicit caveat",
  );
  addFailure(
    result,
    "honesty",
    "no-causal-claim",
    !hasUnsupportedCausalClaim(output),
    "birth observations do not prove a cause",
  );
  result.status = categoriesPass(result.checks) ? "PASS" : "FAIL";
}
async function runBusinessCase(spec, result, client, keys) {
  const key = requireBusiness(keys);
  const baseInput = {
    regionType: spec.regionType,
    regionCode: spec.regionCode,
    pageSize: spec.pageSize,
    page: 1,
  };
  const unfilteredMcp = [];
  const unfilteredOracle = [];
  for (const page of [1, 2]) {
    const mcp = recordOutput(
      result,
      await callTool(client, "search_businesses", { ...baseInput, page }),
    );
    unfilteredMcp.push(mcp);
    const provider = await providerJson(
      BUSINESS_ENDPOINT,
      queryParamsForBusiness({ ...baseInput, page }, key),
      "business unfiltered oracle",
    );
    unfilteredOracle.push(provider.payload);
    recordOracle(result, {
      provider: "SMEA",
      endpoint: provider.endpoint,
      status: provider.status,
      group: "unfiltered",
      page,
      observations: provider.payload,
    });
  }
  const probeItems = toolItems(unfilteredMcp[0]);
  const industryCode = text(probeItems[0]?.[spec.industryField]);
  if (!industryCode)
    throw new Error(
      "first unfiltered MCP business row did not provide an industry filter code",
    );
  const filteredInput = {
    ...baseInput,
    industryType: spec.industryField,
    industryCode,
    page: 1,
  };
  const filteredMcp = recordOutput(
    result,
    await callTool(client, "search_businesses", filteredInput),
  );
  const filteredProvider = await providerJson(
    BUSINESS_ENDPOINT,
    queryParamsForBusiness(filteredInput, key),
    "business filtered oracle",
  );
  const filteredOracle = [filteredProvider.payload];
  recordOracle(result, {
    provider: "SMEA",
    endpoint: filteredProvider.endpoint,
    status: filteredProvider.status,
    group: "filtered",
    page: 1,
    observations: filteredProvider.payload,
  });
  const unfilteredIndependent = validateBusinessPages(unfilteredOracle, {
    pageSize: spec.pageSize,
    pages: spec.pages,
    regionCode: spec.regionCode,
    regionField: spec.regionType,
    regionName: spec.regionName,
  });
  const filteredIndependent = validateBusinessPages(filteredOracle, {
    pageSize: spec.pageSize,
    pages: [1],
    regionCode: spec.regionCode,
    regionField: spec.regionType,
    regionName: spec.regionName,
    industryType: spec.industryField,
    industryCode,
  });
  result.inputs = sanitizeValue({
    manifest: spec,
    requests: [
      { ...baseInput, page: 1 },
      { ...baseInput, page: 2 },
      filteredInput,
    ],
  });
  const compareGroup = (candidatePages, oraclePages) => {
    if (candidatePages.length !== oraclePages.length) return false;
    return candidatePages.every((candidate, index) => {
      const candidates = toolItems(candidate);
      const oracleItems = businessItems(oraclePages[index]);
      if (candidates.length !== oracleItems.length) return false;
      const byId = new Map(
        oracleItems.map((item) => [text(item.bizesId), item]),
      );
      return candidates.every(
        (item) =>
          text(item.bizesId) &&
          canonicalJson(item) === canonicalJson(byId.get(text(item.bizesId))),
      );
    });
  };
  const allMcp = [...unfilteredMcp, filteredMcp];
  const allOracle = [...unfilteredOracle, ...filteredOracle];
  const candidateItems = allMcp.flatMap(toolItems);
  const candidateIdsByGroup = [
    unfilteredMcp.flatMap(toolItems).map((item) => text(item?.bizesId)),
    toolItems(filteredMcp).map((item) => text(item?.bizesId)),
  ];
  const groupsDisjoint = candidateIdsByGroup.every((ids) =>
    ids.every((id, index) => id && ids.indexOf(id) === index),
  );
  const exact =
    compareGroup(unfilteredMcp, unfilteredOracle) &&
    compareGroup([filteredMcp], filteredOracle);
  const outputsSuccessful = allMcp.every((page) => page.success === true);
  result.outputsSuccessful = outputsSuccessful;
  addFailure(
    result,
    "identity",
    "region",
    candidateItems.every(
      (item) =>
        text(item.signguCd) === spec.regionCode &&
        text(item.signguNm) === spec.regionName,
    ),
    "every candidate item must identify Dongnae-gu by code and name",
  );
  addFailure(
    result,
    "identity",
    "industry-source",
    industryCode.length > 0 &&
      text(probeItems[0]?.[spec.industryField]) === industryCode &&
      text(filteredMcp?.source?.endpoint) === BUSINESS_ENDPOINT,
    "filtered industry code must originate in the first unfiltered MCP row",
  );
  addFailure(
    result,
    "identity",
    "ids-and-source",
    candidateItems.every((item) => text(item.bizesId)) &&
      allMcp.every(
        (page) => text(page?.source?.endpoint) === BUSINESS_ENDPOINT,
      ),
    "every candidate item must expose an ID and cite the business source endpoint",
  );
  addFailure(
    result,
    "value",
    "success",
    outputsSuccessful,
    "positive business pages must succeed",
  );
  addFailure(
    result,
    "value",
    "raw-fields",
    exact,
    "each query group must equal independent raw fields by bizesId",
  );
  addFailure(
    result,
    "value",
    "oracle",
    unfilteredIndependent.ok && filteredIndependent.ok,
    "independent unfiltered and filtered business pages must validate",
  );
  addFailure(
    result,
    "completeness",
    "cardinality",
    unfilteredIndependent.ok &&
      filteredIndependent.ok &&
      unfilteredMcp.every(
        (page, index) =>
          toolItems(page).length ===
          unfilteredIndependent.pages[index].items.length,
      ) &&
      toolItems(filteredMcp).length ===
        filteredIndependent.pages[0].items.length,
    "each query page must have provider-derived expected cardinality",
  );
  addFailure(
    result,
    "completeness",
    "disjoint-pages",
    groupsDisjoint,
    "pages must not duplicate IDs within each query group",
  );
  addFailure(
    result,
    "honesty",
    "page-only",
    allMcp.every(
      (page) =>
        page.completeness?.wholeDataset === "not_retrieved" ||
        page.completeness?.status === "current_page_only",
    ),
    "candidate must not claim whole-dataset retrieval",
  );
  addFailure(
    result,
    "honesty",
    "stdrYm",
    allMcp.every(
      (page, index) =>
        Object.hasOwn(page, "stdrYm") &&
        text(page.stdrYm) === text(allOracle[index]?.header?.stdrYm),
    ),
    "provider stdrYm must be retained from each independent page rather than replaced with retrieval time",
  );
  result.status = categoriesPass(result.checks) ? "PASS" : "FAIL";
}
const REFUSAL_DIAGNOSTIC_FIELDS = new Set([
  "success",
  "validationLevel",
  "answer",
  "note",
  "error",
  "code",
  "tableDiscovery",
]);
function hasUnknownRefusalFields(output) {
  if (!isRecord(output)) return true;
  return Object.entries(output).some(([key, value]) => {
    if (REFUSAL_DIAGNOSTIC_FIELDS.has(key)) return false;
    if (value === undefined || value === null) return false;
    return Array.isArray(value)
      ? value.length > 0
      : isRecord(value)
        ? Object.keys(value).length > 0
        : text(value) !== "";
  });
}
export function rejectHasDataOrNumericClaim(output, expectedYear) {
  if (hasUnknownRefusalFields(output)) return true;
  for (const key of [
    "value",
    "data",
    "rawData",
    "dataPoints",
    "items",
    "rows",
    "observations",
    "statistics",
    "population",
    "statisticalValue",
    "insights",
  ]) {
    const value = output?.[key];
    if (value === undefined || value === null) continue;
    if (key === "value") return true;
    if (
      Array.isArray(value)
        ? value.length > 0
        : isRecord(value)
          ? Object.keys(value).length > 0
          : text(value) !== ""
    )
      return true;
  }
  let prose = [
    output?.answer,
    output?.note,
    output?.summary,
    output?.trendDescription,
    output?.error,
  ]
    .map(text)
    .filter(Boolean)
    .join(" ");
  prose = prose.replace(/(?:%[0-9A-Fa-f]{2})+/gu, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return "[encoded query]";
    }
  });
  const yearPattern =
    expectedYear === undefined
      ? /\b(?:19|20)\d{2}\s*년/gu
      : new RegExp(`\\b${String(expectedYear)}\\s*년`, "gu");
  prose = prose.replace(yearPattern, "[year]");
  prose = prose.replace(
    /\b(?:ITM_ID|ORG_ID|TBL_ID|OBJ_ID|REGIONCODE|REGION_ID|C\d|code|코드)\s*[:=]?\s*[A-Z0-9_-]+\b/giu,
    "",
  );
  return (
    /(?:인구|인원|주민|사람|출생아수|출생|통계|수치|값|관측)[^0-9]{0,24}[+-]?\d[\d,]*(?:\.\d+)?\s*(?:명|건|%|원|만)?/iu.test(
      prose,
    ) || /[+-]?\d[\d,]*(?:\.\d+)?\s*(?:명|건|%|원|만)/iu.test(prose)
  );
}
function primaryRejectDiagnostic(output) {
  return [
    text(output?.code),
    text(output?.error),
    text(output?.answer),
    text(output?.note),
  ]
    .filter(Boolean)
    .join(" ");
}
function primaryRejectError(output) {
  return [text(output?.code), text(output?.error), text(output?.answer)]
    .filter(Boolean)
    .join(" ");
}
export function hasPrimaryTechnicalFailure(output) {
  const code = text(output?.code).toUpperCase();
  const knownRefusalCodes = new Set([
    "REGION_AMBIGUOUS",
    "REGION_NOT_FOUND",
    "AMBIGUOUS_REGION",
    "UNKNOWN_REGION",
  ]);
  if (code && !knownRefusalCodes.has(code)) return true;
  return /TIMEOUT|NETWORK|AUTH|INVALID_API_KEY|INVALID_RESPONSE|RESPONSE_TOO_LARGE|METADATA_ERROR|DATA_ERROR|PROVIDER_ERROR|인증|auth|provider|서버\s*.*오류|(?:^|\s)(?:5\d\d|[45]\d\d)(?:\s|$)/iu.test(
    primaryRejectError(output),
  );
}
function validRejectOutput(output, kind, expectedYear) {
  const diagnostic = primaryRejectDiagnostic(output);
  const meaningful =
    kind === "ambiguous-region"
      ? /모호|상위|지역.*확인|중구/iu.test(diagnostic)
      : /확인하지|존재|없는군|지역.*찾/iu.test(diagnostic);
  const prohibited = hasPrimaryTechnicalFailure(output);
  return (
    output?.success === false &&
    output?.validationLevel === "unverified" &&
    output?.value === undefined &&
    output?.source === undefined &&
    !rejectHasDataOrNumericClaim(output, expectedYear) &&
    meaningful &&
    !prohibited
  );
}
export function validateRejectResponse(
  output,
  kind = "ambiguous-region",
  expectedYear,
) {
  return {
    ok: validRejectOutput(output, kind, expectedYear),
    reason: validRejectOutput(output, kind, expectedYear)
      ? "valid diagnostic refusal"
      : "refusal was not a meaningful unverified region refusal",
  };
}
async function runRejectCase(spec, result, client, keys) {
  const key = requireKosis(keys);
  const output = recordOutput(
    result,
    await callTool(client, "quick_stats", {
      query: "인구",
      region: spec.region,
      year: spec.year,
    }),
  );
  const metaResponse = await providerJson(
    KOSIS_META_ENDPOINT,
    {
      method: "getMeta",
      type: "ITM",
      orgId: "101",
      tblId: "DT_1B040A3",
      objId: "A",
      format: "json",
      jsonVD: "Y",
      apiKey: key,
    },
    "KOSIS metadata",
  );
  const metadata = parseKosisMetadata(metaResponse.payload);
  const matching = metadata.filter((row) =>
    administrativeNameMatches(spec.region, row.ITM_NM),
  );
  const parentIds = new Set(
    matching.map((row) => text(row.UP_ITM_ID)).filter(Boolean),
  );
  const officialBasis =
    spec.kind === "ambiguous-region"
      ? matching.length > 1 && parentIds.size > 1
        ? "official metadata contains multiple parent regions"
        : ""
      : matching.length === 0
        ? "official metadata contains no such region"
        : "";
  recordOracle(result, {
    provider: "KOSIS",
    tableId: "DT_1B040A3",
    metadata: {
      status: metaResponse.status,
      endpoint: metaResponse.endpoint,
      rows: metadata,
    },
    basis: officialBasis,
  });
  const refusal = validateRejectResponse(output, spec.kind, spec.year);
  result.outputsSuccessful = output.success === true;
  addFailure(
    result,
    "identity",
    "official-basis",
    Boolean(officialBasis),
    officialBasis ||
      "official metadata did not establish the requested rejection",
  );
  addFailure(result, "identity", "refusal", refusal.ok, refusal.reason);
  addFailure(
    result,
    "identity",
    "requested-region",
    text(output?.answer).includes(spec.region) ||
      text(output?.note).includes(spec.region),
    "refusal must discuss the requested region",
  );
  addFailure(
    result,
    "value",
    "no-success",
    output.success === false,
    "reject case must refuse rather than answer",
  );
  addFailure(
    result,
    "value",
    "no-number",
    output.value === undefined && output.success !== true,
    "reject case must not provide a numeric value",
  );
  addFailure(
    result,
    "value",
    "no-primary-timeout-auth",
    !hasPrimaryTechnicalFailure(output),
    "primary transport/tool/auth failure is not an accepted refusal reason",
  );
  addFailure(
    result,
    "completeness",
    "diagnostic",
    refusal.ok,
    "refusal must provide an actionable region diagnostic",
  );
  addFailure(
    result,
    "completeness",
    "unverified",
    output.validationLevel === "unverified",
    "refusal must remain unverified",
  );
  addFailure(
    result,
    "completeness",
    "no-data-bearing-fields",
    !rejectHasDataOrNumericClaim(output, spec.year),
    "reject response must not carry data rows or numeric statistical claims",
  );
  addFailure(
    result,
    "honesty",
    "no-fabrication",
    output.value === undefined,
    "refusal must not invent a value",
  );
  addFailure(
    result,
    "honesty",
    "no-verified",
    output.validationLevel !== "verified" && output.source === undefined,
    "refusal must not claim verified success",
  );
  result.status = categoriesPass(result.checks) ? "PASS" : "FAIL";
}

export function validateManifest(value, manifestSha256) {
  if (
    !isRecord(value) ||
    !Array.isArray(value.cases) ||
    value.cases.length !== 10
  )
    throw new Error("public benchmark manifest must contain exactly 10 cases");
  if (
    value.id !== EXPECTED_MANIFEST_ID ||
    value.version !== EXPECTED_MANIFEST_VERSION
  )
    throw new Error(
      "public benchmark manifest identity/version is not the frozen v2 policy",
    );
  if (manifestSha256 !== EXPECTED_MANIFEST_SHA256)
    throw new Error(
      "public benchmark manifest SHA-256 is not the frozen v2 policy",
    );
  if (value.maximumScore !== 100 || value.passScore !== 100)
    throw new Error("public benchmark score policy is not frozen at 100");
  const ids = value.cases.map((item) => item?.id);
  if (
    ids.some((id) => typeof id !== "string") ||
    new Set(ids).size !== 10 ||
    canonicalJson(ids) !==
      canonicalJson([
        "B01",
        "B02",
        "B03",
        "B04",
        "B05",
        "B06",
        "B07",
        "B08",
        "B09",
        "B10",
      ])
  )
    throw new Error(
      "public benchmark manifest cases are not the frozen B01-B10 set",
    );
  return value;
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
async function ensureOutputDirectory(target) {
  const output = resolve(target);
  try {
    await stat(output);
    throw new Error("output directory already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(output, { mode: 0o700 });
  await (await import("node:fs/promises")).chmod(output, 0o700);
  return output;
}
async function writePrivateJson(path, value) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(
      JSON.stringify(sanitizeValue(value), null, 2) + "\n",
      { mode: 0o600 },
    );
  } finally {
    await handle.close();
  }
  await (await import("node:fs/promises")).chmod(path, 0o600);
}
function parseArgs(argv) {
  let output;
  let url;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--output") {
      output = argv[++i];
      if (!output) throw new Error("--output requires a directory");
    } else if (argv[i] === "--url") {
      url = argv[++i];
      if (!url) throw new Error("--url requires an HTTPS /mcp URL");
    } else if (argv[i] === "--help" || argv[i] === "-h") return { help: true };
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return { output, url };
}
function validatedMcpUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.pathname.replace(/\/+$/u, "") !== "/mcp" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "candidate URL must be an explicit HTTPS /mcp URL without credentials or query",
    );
  return url;
}
async function connectCandidate(url) {
  const client = new Client({
    name: "public-benchmark-runner",
    version: "1.0.0",
  });
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: await mcpFetchFactory(url),
    reconnectionOptions: { maxRetries: 0 },
  });
  await withTimeout(
    client.connect(transport, {
      timeout: MCP_TIMEOUT_MS,
      maxTotalTimeout: MCP_TIMEOUT_MS,
    }),
    MCP_TIMEOUT_MS,
    "MCP initialize",
  );
  const serverVersion = client.getServerVersion();
  if (!serverVersion || serverVersion.version !== EXPECTED_SERVER_VERSION)
    throw new Error("candidate server version is not 2.0.0");
  const listed = await withTimeout(
    client.listTools(undefined, {
      timeout: MCP_TIMEOUT_MS,
      maxTotalTimeout: MCP_TIMEOUT_MS,
    }),
    MCP_TIMEOUT_MS,
    "MCP tools/list",
  );
  const names = listed.tools?.map((tool) => tool.name).sort() ?? [];
  const expected = [...CANONICAL_TOOL_NAMES].sort();
  if (canonicalJson(names) !== canonicalJson(expected))
    throw new Error(
      `candidate tool set does not contain the expected 14 tools (got ${names.length})`,
    );
  return { client, transport, serverVersion, toolNames: names };
}
async function closeCandidate(transport) {
  try {
    await withTimeout(transport.close(), MCP_TIMEOUT_MS, "MCP close");
    return null;
  } catch (error) {
    return sanitizeError(error);
  }
}

export async function runBenchmark({
  output,
  url,
  manifestPath = MANIFEST_PATH,
} = {}) {
  const runnerBytesBefore = await readFile(fileURLToPath(import.meta.url));
  const runnerShaBefore = sha256(runnerBytesBefore);
  const manifestBytesBefore = await readFile(manifestPath);
  const manifestShaBefore = sha256(manifestBytesBefore);
  const manifest = validateManifest(
    JSON.parse(manifestBytesBefore.toString("utf8")),
    manifestShaBefore,
  );
  const targetUrl = validatedMcpUrl(url ?? manifest.target);
  const outputDirectory = await ensureOutputDirectory(
    output ?? resolve(process.cwd(), `public-benchmark-${Date.now()}`),
  );
  const results = [];
  let connection;
  const integrityViolations = [];
  try {
    connection = await connectCandidate(targetUrl);
    const keys = {
      kosis: process.env.KOSIS_API_KEY?.trim(),
      business: process.env.DATA_GO_KR_SERVICE_KEY
        ? decodeServiceKeyOnce(process.env.DATA_GO_KR_SERVICE_KEY)
        : undefined,
      oracleCache: {},
    };
    keys.oracleCache.businessKey = keys.business;
    for (const spec of manifest.cases) {
      const result = await runCase(spec, connection.client, keys);
      results.push(result);
      await writePrivateJson(
        resolve(outputDirectory, `${spec.id}.json`),
        result,
      );
    }
  } catch (error) {
    integrityViolations.push(`candidate setup: ${sanitizeError(error)}`);
    for (const spec of manifest.cases.slice(results.length)) {
      const blocked = makeCaseResult(spec);
      blocked.failureExplanations.push(
        `candidate setup: ${sanitizeError(error)}`,
      );
      fillMissingChecks(blocked, blocked.failureExplanations.at(-1));
      blocked.latencyMs = 0;
      results.push(blocked);
      await writePrivateJson(
        resolve(outputDirectory, `${spec.id}.json`),
        blocked,
      );
    }
  } finally {
    if (connection) {
      const closeFailure = await closeCandidate(connection.transport);
      if (closeFailure)
        integrityViolations.push(`candidate close: ${closeFailure}`);
    }
  }
  const manifestBytesAfter = await readFile(manifestPath);
  const manifestShaAfter = sha256(manifestBytesAfter);
  if (manifestShaAfter !== manifestShaBefore)
    integrityViolations.push("frozen manifest changed during execution");
  const runnerShaAfter = sha256(await readFile(fileURLToPath(import.meta.url)));
  if (runnerShaAfter !== runnerShaBefore)
    integrityViolations.push("runner source changed during execution");
  const score = scoreBenchmark(results, integrityViolations);
  const candidateLabel = process.env.KOREA_STATS_RELEASE_CANDIDATE?.trim();
  const report = {
    status: score.passed ? "PASS" : "FAIL",
    benchmarkId: manifest.id,
    manifestVersion: manifest.version,
    manifestSha256Before: manifestShaBefore,
    manifestSha256After: manifestShaAfter,
    runnerSha256Before: runnerShaBefore,
    runnerSha256After: runnerShaAfter,
    target: targetUrl.origin + targetUrl.pathname,
    candidateUrl: targetUrl.origin + targetUrl.pathname,
    candidateServerVersion: connection?.serverVersion?.version ?? null,
    candidateServerInfo: connection?.serverVersion
      ? sanitizeValue(connection.serverVersion)
      : null,
    candidateToolNames: connection?.toolNames ?? [],
    toolCount: connection?.toolNames?.length ?? 0,
    ...(candidateLabel
      ? {
          candidateLabel: {
            value: sanitizeText(candidateLabel),
            independentlyVerified: false,
          },
        }
      : {}),
    score,
    cases: results.map((result) => ({
      id: result.id,
      status: result.status,
      latencyMs: result.latencyMs,
      failureExplanations: result.failureExplanations,
    })),
    outputDirectory,
  };
  await writePrivateJson(resolve(outputDirectory, "summary.json"), report);
  return report;
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log(
        "Usage: node tests/public-benchmark.mjs [--output NEW_DIRECTORY] [--url HTTPS_MCP_URL]",
      );
      return;
    }
    const report = await runBenchmark(args);
    const statuses = report.cases
      .map((item) => `${item.id}:${item.status}`)
      .join(" ");
    console.log(`public benchmark ${report.score.total}/100 (${statuses})`);
    console.log(`output: ${report.outputDirectory}`);
    if (!report.score.passed) process.exitCode = 1;
  } catch (error) {
    console.error(`public benchmark failed: ${sanitizeError(error)}`);
    process.exitCode = 1;
  }
}
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url)
  await main();
