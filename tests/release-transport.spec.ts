import { test, expect } from "@playwright/test";
import {
  CANONICAL_TOOL_NAMES,
  assertJsonRpcError,
  callToolJson,
  canonicalJson,
  getPromptText,
  initializeRequest,
  rawHttpRequest,
  readResourceJson,
  runSanitizedLiveCase,
  withReleaseClient,
  type LiveTransportKind,
} from "./release-live-client";

const RELEASE_PHASE_ENV = "KOREA_STATS_RELEASE_PHASE";
const releasePhase = process.env[RELEASE_PHASE_ENV]?.trim();
const includeR2Cases = releasePhase !== "R1";

test.setTimeout(180_000);

function expectNonEmptyString(
  value: unknown,
  label: string,
): asserts value is string {
  expect(typeof value, `${label} type`).toBe("string");
  expect((value as string).trim().length, `${label} nonempty`).toBeGreaterThan(
    0,
  );
}

function parsedObservedValue(
  result: Record<string, unknown>,
  label: string,
): number {
  expect(result.success, `${label} success`).toBe(true);
  expect(
    typeof result.value === "string" || typeof result.value === "number",
    `${label} observed value present`,
  ).toBe(true);
  expect(
    String(result.value).trim(),
    `${label} observed numeric syntax`,
  ).toMatch(/^[+-]?(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/);
  const value = Number(String(result.value).replaceAll(",", ""));
  expect(Number.isFinite(value), `${label} finite observed value`).toBe(true);
  expectNonEmptyString(result.unit, `${label} official unit`);
  expectNonEmptyString(result.period, `${label} official period`);
  const source = result.source;
  expect(
    source !== null && typeof source === "object" && !Array.isArray(source),
    `${label} official source`,
  ).toBe(true);
  const sourceRecord = source as Record<string, unknown>;
  expectNonEmptyString(sourceRecord.orgId, `${label} source organization`);
  expectNonEmptyString(sourceRecord.tableId, `${label} source table`);
  expectNonEmptyString(sourceRecord.tableName, `${label} source table name`);
  expectNonEmptyString(sourceRecord.periodType, `${label} source period type`);
  expect(["Y", "Q", "M"]).toContain(sourceRecord.periodType);
  expectNonEmptyString(result.validationLevel, `${label} validation level`);
  expect(["verified", "partial"]).toContain(result.validationLevel);
  return value;
}

async function assertToolsResourcesPromptAndKnownCohort(
  kind: LiveTransportKind,
): Promise<void> {
  await withReleaseClient(kind, async ({ client }) => {
    const listed = await client.listTools(undefined, {
      timeout: 30_000,
      maxTotalTimeout: 30_000,
    });
    const actualToolNames = listed.tools.map((tool) => tool.name).sort();
    expect(actualToolNames, `${kind} canonical tool names`).toEqual(
      [...CANONICAL_TOOL_NAMES].sort(),
    );

    const categoryTree = await readResourceJson(
      client,
      "kosis://categories/tree",
    );
    expect(
      typeof categoryTree.name === "string" &&
        categoryTree.name.trim().length > 0,
      `${kind} category-tree name`,
    ).toBe(true);
    expect(
      typeof categoryTree.description === "string" &&
        categoryTree.description.trim().length > 0,
      `${kind} category-tree description`,
    ).toBe(true);
    expect(Array.isArray(categoryTree.categories)).toBe(true);
    const categories = categoryTree.categories as unknown[];
    expect(categories.length).toBeGreaterThan(0);
    for (const category of categories) {
      expect(category !== null && typeof category === "object").toBe(true);
      const categoryRecord = category as Record<string, unknown>;
      expectNonEmptyString(categoryRecord.code, `${kind} category code`);
      expectNonEmptyString(categoryRecord.name, `${kind} category name`);
    }

    const keyIndicators = await readResourceJson(
      client,
      "kosis://indicators/list",
    );
    expect(
      typeof keyIndicators.name === "string" &&
        keyIndicators.name.trim().length > 0,
      `${kind} key-indicators name`,
    ).toBe(true);
    expectNonEmptyString(
      keyIndicators.description,
      `${kind} key-indicators description`,
    );
    expect(Array.isArray(keyIndicators.indicators)).toBe(true);
    const indicators = keyIndicators.indicators as unknown[];
    expect(indicators.length).toBeGreaterThan(0);
    for (const indicator of indicators) {
      expect(indicator !== null && typeof indicator === "object").toBe(true);
      const indicatorRecord = indicator as Record<string, unknown>;
      for (const field of [
        "name",
        "category",
        "orgId",
        "tableId",
        "periodType",
        "description",
      ]) {
        expectNonEmptyString(
          indicatorRecord[field],
          `${kind} indicator ${field}`,
        );
      }
    }

    const prompts = await client.listPrompts(undefined, {
      timeout: 30_000,
      maxTotalTimeout: 30_000,
    });
    expect(
      prompts.prompts.some(
        (promptItem) => promptItem.name === "statistics_assistant",
      ),
    ).toBe(true);
    const prompt = await getPromptText(
      client,
      "statistics_assistant",
      "전국과 부산의 인구를 비교해줘",
    );
    expect(prompt.trim().length).toBeGreaterThan(0);
    expect(prompt).toContain("quick_stats");

    const national = await callToolJson(client, "quick_stats", {
      query: "인구",
    });
    const busan = await callToolJson(client, "quick_stats", {
      query: "인구",
      region: "부산",
    });
    const nationalValue = parsedObservedValue(
      national,
      `${kind} national population`,
    );
    const busanValue = parsedObservedValue(busan, `${kind} Busan population`);
    const nationalSource = national.source as Record<string, unknown>;
    const busanSource = busan.source as Record<string, unknown>;
    expect(busanSource.regionCode, `${kind} official Busan code`).toBe("26");
    expect(busanSource.regionCode, `${kind} Busan source region`).not.toBe(
      nationalSource.regionCode,
    );
    // This compares two observations returned by this live candidate, rather
    // than asserting a fixture value or treating a request id as provenance.
    expect(busanValue, `${kind} Busan differs from national`).not.toBe(
      nationalValue,
    );

    const list = await callToolJson(client, "get_statistics_list", {
      viewCode: "MT_ZTITLE",
      parentId: "",
    });
    expect(list.success, `${kind} get_statistics_list success`).toBe(true);
    expect(list.parentId, `${kind} root list parent`).toBe("");
    expectNonEmptyString(list.viewName, `${kind} list view name`);
    expect(Array.isArray(list.items), `${kind} list items`).toBe(true);
    expect(
      (list.items as unknown[]).length,
      `${kind} list not empty`,
    ).toBeGreaterThan(0);
  });
}

test.describe("release live transport admission", () => {
  test(
    "REQ-T01.stdio live SDK transport and KOSIS cohort @live @stdio @AC9",
    { tag: ["@REQ-T01.stdio", "@AC9", "@live", "@stdio"] },
    async () =>
      runSanitizedLiveCase("REQ-T01.stdio", () =>
        assertToolsResourcesPromptAndKnownCohort("stdio"),
      ),
  );

  test(
    "REQ-T01.http live SDK transport and KOSIS cohort @live @http @AC9",
    { tag: ["@REQ-T01.http", "@AC9", "@live", "@http"] },
    async () =>
      runSanitizedLiveCase("REQ-T01.http", () =>
        assertToolsResourcesPromptAndKnownCohort("http"),
      ),
  );

  test(
    "REQ-T02 stateless remote HTTP method and reconnect contract @live @http @AC12",
    { tag: ["@REQ-T02", "@AC12", "@live", "@http"] },
    async () =>
      runSanitizedLiveCase("REQ-T02", async () => {
        // OPTIONS and the anonymous POST intentionally omit the preview bypass.
        // Functional method and MCP checks may use it, but cannot replace the
        // separate anonymous assertion below.
        const options = await rawHttpRequest("OPTIONS", undefined, false);
        expect(options.status, "unauthenticated OPTIONS status").toBe(200);

        const get = await rawHttpRequest("GET");
        expect(get.status, "GET status").toBe(405);
        expect(get.allow.toUpperCase()).toContain("POST");
        expect(get.contentType.toLowerCase()).toContain("application/json");
        expect(get.parsed, "GET JSON-RPC body").toBeDefined();
        assertJsonRpcError(get.parsed);

        const head = await rawHttpRequest("HEAD");
        expect(head.status, "HEAD status").toBe(405);
        expect(head.allow.toUpperCase()).toContain("POST");
        expect(head.body, "HEAD body").toBe("");

        const put = await rawHttpRequest("PUT");
        expect(put.status, "PUT status").toBe(405);
        expect(put.allow.toUpperCase()).toContain("POST");
        expect(put.contentType.toLowerCase()).toContain("application/json");
        expect(put.parsed, "PUT JSON-RPC body").toBeDefined();
        assertJsonRpcError(put.parsed);

        const initialize = await rawHttpRequest("POST", initializeRequest());
        expect(initialize.status, "POST initialize status").toBe(200);
        expect(initialize.contentType.toLowerCase()).toContain(
          "application/json",
        );
        const initializeResult = initialize.parsed;
        expect(
          initializeResult !== null && typeof initializeResult === "object",
          "initialize JSON body",
        ).toBe(true);
        const initializeObject = initializeResult as Record<string, unknown>;
        expect(initializeObject.jsonrpc).toBe("2.0");
        expect(
          initializeObject.result !== null &&
            typeof initializeObject.result === "object",
          "initialize result",
        ).toBe(true);

        await withReleaseClient("http", async ({ client, transport }) => {
          expect(
            (transport as { readonly sessionId?: string }).sessionId,
          ).toBeUndefined();
          const tools = await client.listTools(undefined, {
            timeout: 30_000,
            maxTotalTimeout: 30_000,
          });
          expect(tools.tools.length).toBe(CANONICAL_TOOL_NAMES.length);
        });
        // A fresh transport has no session metadata and must be able to connect
        // independently after the previous client has closed.
        await withReleaseClient("http", async ({ client, transport }) => {
          expect(
            (transport as { readonly sessionId?: string }).sessionId,
          ).toBeUndefined();
          await client.ping({ timeout: 30_000, maxTotalTimeout: 30_000 });
        });

        const anonymous = await rawHttpRequest(
          "POST",
          initializeRequest(),
          false,
        );
        expect(
          anonymous.status,
          "anonymous POST must succeed without bypass",
        ).toBe(200);
        expect(anonymous.contentType.toLowerCase()).toContain(
          "application/json",
        );
        const anonymousResult = anonymous.parsed as
          Record<string, unknown> | undefined;
        expect(anonymousResult?.jsonrpc).toBe("2.0");
        expect(anonymousResult?.result).toBeDefined();
        expect(anonymousResult?.error).toBeUndefined();
      }),
  );

  if (includeR2Cases) {
    test(
      "REQ-M01 live stdio/http get_table_info schemas remain equivalent @live @stdio @http @AC11",
      { tag: ["@REQ-M01", "@AC11", "@live", "@stdio", "@http"] },
      async () =>
        runSanitizedLiveCase("REQ-M01", async () => {
          const schemas: Record<LiveTransportKind, unknown> = {
            stdio: undefined,
            http: undefined,
          };
          for (const kind of ["stdio", "http"] as const) {
            await withReleaseClient(kind, async ({ client }) => {
              const listing = await client.listTools(undefined, {
                timeout: 30_000,
                maxTotalTimeout: 30_000,
              });
              const tool = listing.tools.find(
                (item) => item.name === "get_table_info",
              );
              expect(tool, `${kind} get_table_info registration`).toBeDefined();
              expect(
                tool?.inputSchema,
                `${kind} get_table_info input schema`,
              ).toBeDefined();
              schemas[kind] = tool?.inputSchema;
            });
          }
          expect(
            canonicalJson(schemas.stdio),
            "get_table_info schema parity",
          ).toBe(canonicalJson(schemas.http));
        }),
    );
  }
});
