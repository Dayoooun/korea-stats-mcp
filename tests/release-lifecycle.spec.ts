import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "@playwright/test";
import {
  callToolJson,
  canonicalJson,
  candidateConfig,
  runSanitizedLiveCase,
  withReleaseClient,
  type LiveTransportKind,
} from "./release-live-client";
import { flattenDeploymentFiles } from "./release-deployment-files";

test.setTimeout(300_000);

const ORG_ID = "101";
const TABLE_ID = "DT_1B040A3";
const PAGE_SIZE = 2;
const EXTERNAL_PAGE_SIZE = 200;
const PROJECT_ID = "prj_7edzhiPnQ0Gxk0HRDVc9TciDMSZW";
const VERCEL_SCOPE = "dayooouns-projects";
const CHILD_SCRIPT = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "release-lifecycle-child.mjs",
);
const SYNTHETIC_KOSIS_KEY = "release-lifecycle-synthetic-kosis-key";
const SYNTHETIC_BUSINESS_KEY = "release-lifecycle-synthetic-business-key";
const SECRET_SENTINEL = "release-lifecycle-upstream-secret-sentinel";

type JsonObject = Record<string, unknown>;
type MetadataPage = JsonObject & {
  rawData: JsonObject[];
  totalCount: number;
  returnedCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  snapshot: string;
};
type ChildReady = {
  readonly type: "ready";
  readonly pid: number;
  readonly port: number;
};
type ChildResult = {
  readonly type: "result";
  readonly business?: JsonObject;
  readonly metadata?: JsonObject;
  readonly data?: JsonObject;
  readonly stderrHasSentinel?: boolean;
  readonly error?: string;
};
function isJsonObjectValue(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readyMessage(value: unknown): ChildReady | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !Object.hasOwn(value, "type") ||
    !Object.hasOwn(value, "pid") ||
    !Object.hasOwn(value, "port")
  ) {
    return undefined;
  }
  const type = Reflect.get(value, "type");
  const pid = Reflect.get(value, "pid");
  const port = Reflect.get(value, "port");
  if (
    type !== "ready" ||
    typeof pid !== "number" ||
    !Number.isInteger(pid) ||
    typeof port !== "number" ||
    !Number.isInteger(port)
  ) {
    return undefined;
  }
  return { type, pid, port };
}

function resultMessage(value: unknown): ChildResult | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !Object.hasOwn(value, "type") ||
    Reflect.get(value, "type") !== "result"
  ) {
    return undefined;
  }
  const business = Reflect.get(value, "business");
  const metadata = Reflect.get(value, "metadata");
  const data = Reflect.get(value, "data");
  const stderrHasSentinel = Reflect.get(value, "stderrHasSentinel");
  const error = Reflect.get(value, "error");
  if (
    (business !== undefined && !isJsonObjectValue(business)) ||
    (metadata !== undefined && !isJsonObjectValue(metadata)) ||
    (data !== undefined && !isJsonObjectValue(data)) ||
    (stderrHasSentinel !== undefined &&
      typeof stderrHasSentinel !== "boolean") ||
    (error !== undefined && typeof error !== "string")
  ) {
    return undefined;
  }
  return {
    type: "result",
    ...(business === undefined ? {} : { business }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(data === undefined ? {} : { data }),
    ...(stderrHasSentinel === undefined ? {} : { stderrHasSentinel }),
    ...(error === undefined ? {} : { error }),
  };
}
type ChildHandle = {
  readonly child: ChildProcess;
  readonly ready: ChildReady;
  readonly stdout: () => string;
  readonly stderr: () => string;
};

type DeploymentProof = {
  readonly id: string;
  readonly createdAt: number;
  readonly candidate: string;
  readonly sourceDigest: string;
  readonly files: Map<string, string>;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required release environment: ${name}`);
  return value;
}

function asRecord(value: unknown, label: string): JsonObject {
  expect(value, `${label} must be an object`).not.toBeNull();
  expect(typeof value, `${label} must be an object`).toBe("object");
  expect(Array.isArray(value), `${label} must not be an array`).toBe(false);
  return value as JsonObject;
}

function requiredString(value: unknown, label: string): string {
  expect(typeof value, `${label} must be a string`).toBe("string");
  const text = String(value).trim();
  expect(text.length, `${label} must be non-empty`).toBeGreaterThan(0);
  return text;
}

function mcpWireBytes(value: JsonObject): number {
  const text = JSON.stringify(value, null, 2);
  return new TextEncoder().encode(
    JSON.stringify({ content: [{ type: "text", text }] }),
  ).byteLength;
}

function metadataPage(value: JsonObject, label: string): MetadataPage {
  expect(value.success, `${label} success`).toBe(true);
  expect(value.orgId, `${label} orgId`).toBe(ORG_ID);
  expect(value.tableId, `${label} tableId`).toBe(TABLE_ID);
  expect(value.infoType, `${label} infoType`).toBe("ITM");
  expect(Array.isArray(value.rawData), `${label} rawData`).toBe(true);
  expect(typeof value.totalCount, `${label} totalCount`).toBe("number");
  expect(typeof value.returnedCount, `${label} returnedCount`).toBe("number");
  expect(typeof value.hasMore, `${label} hasMore`).toBe("boolean");
  expect(typeof value.snapshot, `${label} snapshot`).toBe("string");
  expect(value.snapshot, `${label} snapshot hash`).toMatch(/^[a-f0-9]{64}$/u);
  expect(
    value.nextCursor === null || typeof value.nextCursor === "string",
    `${label} nextCursor shape`,
  ).toBe(true);
  expect(mcpWireBytes(value), `${label} MCP wire bytes`).toBeLessThanOrEqual(
    32_768,
  );
  return value as unknown as MetadataPage;
}

function metadataArgs(cursor?: string, pageSize = PAGE_SIZE): JsonObject {
  return {
    orgId: ORG_ID,
    tableId: TABLE_ID,
    infoType: "ITM",
    pageSize,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function cursorShape(value: unknown, label: string): string {
  expect(typeof value, `${label} cursor type`).toBe("string");
  const cursor = String(value);
  expect(cursor, `${label} cursor shape`).toMatch(
    /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/u,
  );
  expect(cursor.length, `${label} cursor bounded`).toBeLessThan(1024);
  return cursor;
}

async function readAllMetadata(
  client: Client,
  first?: MetadataPage,
  pageSize = PAGE_SIZE,
): Promise<{
  readonly first: MetadataPage;
  readonly pages: MetadataPage[];
  readonly rows: JsonObject[];
}> {
  const pages: MetadataPage[] = [];
  const rows: JsonObject[] = [];
  let page =
    first ??
    metadataPage(
      await callToolJson(
        client,
        "get_table_info",
        metadataArgs(undefined, pageSize),
      ),
      "metadata page 1",
    );
  for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
    pages.push(page);
    const pageRows = page.rawData.map((row, index) =>
      asRecord(row, `metadata page ${pageNumber} row ${index}`),
    );
    rows.push(...pageRows);
    expect(page.returnedCount, "metadata current page count").toBe(
      pageRows.length,
    );
    expect(
      pageRows.length,
      "metadata requested page bound",
    ).toBeLessThanOrEqual(pageSize);
    expect(page.snapshot, "metadata traversal snapshot").toBe(
      pages[0].snapshot,
    );
    expect(page.totalCount, "metadata traversal total").toBe(
      pages[0].totalCount,
    );
    if (!page.hasMore) {
      expect(page.nextCursor, "metadata terminal cursor").toBeNull();
      expect(rows.length, "metadata full traversal count").toBe(
        page.totalCount,
      );
      return { first: pages[0], pages, rows };
    }
    const next = cursorShape(page.nextCursor, `metadata page ${pageNumber}`);
    page = metadataPage(
      await callToolJson(
        client,
        "get_table_info",
        metadataArgs(next, pageSize),
      ),
      `metadata page ${pageNumber + 1}`,
    );
  }
  throw new Error("metadata pagination exceeded bounded page count");
}

function parseHttpsMcpUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.pathname.replace(/\/+$/u, "") !== "/mcp" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${label} must be credential-free HTTPS /mcp without query data`,
    );
  }
  return url;
}

function boundedVercelApi(pathname: string, label: string): unknown {
  const result = spawnSync(
    "vercel",
    ["api", pathname, "--scope", VERCEL_SCOPE],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(`${label} Vercel CLI read failed`);
  }
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch {
    throw new Error(`${label} Vercel CLI response was not JSON`);
  }
}

function deploymentFiles(value: unknown, label: string): Map<string, string> {
  const selected = new Map<string, string>();
  for (const [file, record] of flattenDeploymentFiles(value, label)) {
    if (!file.startsWith("src/")) continue;
    expect(record.type, `${label} ${file} type`).toBe("file");
    expect(selected.has(file), `${label} duplicate ${file}`).toBe(false);
    selected.set(file, record.uid);
  }
  expect(selected.has("src/package.json"), `${label} package inventory`).toBe(
    true,
  );
  expect(
    [...selected.keys()].some((file) => file.startsWith("src/dist/")),
    `${label} dist inventory`,
  ).toBe(true);
  return selected;
}

function deploymentProof(
  url: URL,
  candidate: string,
  label: string,
): DeploymentProof {
  const deployment = asRecord(
    boundedVercelApi(`/v13/deployments/${url.hostname}`, `${label} deployment`),
    `${label} deployment`,
  );
  const id = requiredString(deployment.id, `${label} deployment id`);
  expect(deployment.readyState, `${label} deployment READY`).toBe("READY");
  expect(deployment.projectId, `${label} project`).toBe(PROJECT_ID);
  const metadata = asRecord(deployment.meta, `${label} deployment meta`);
  expect(metadata.candidate, `${label} candidate`).toBe(candidate);
  const sourceDigest = requiredString(
    metadata.sourceDigest,
    `${label} sourceDigest`,
  );
  const createdAtValue = deployment.createdAt;
  const createdAt =
    typeof createdAtValue === "number"
      ? createdAtValue
      : Date.parse(String(createdAtValue ?? ""));
  expect(Number.isFinite(createdAt), `${label} createdAt`).toBe(true);
  const files = deploymentFiles(
    boundedVercelApi(`/v6/deployments/${id}/files`, `${label} files`),
    label,
  );
  return {
    id,
    createdAt,
    candidate: requiredString(metadata.candidate, `${label} candidate`),
    sourceDigest,
    files,
  };
}

function attestExternalPreviews(): {
  readonly primary: URL;
  readonly cold: URL;
} {
  const primary = candidateConfig().httpUrl;
  const cold = parseHttpsMcpUrl(
    requiredEnvironment("KOREA_STATS_COLD_HTTP_URL"),
    "KOREA_STATS_COLD_HTTP_URL",
  );
  expect(cold.href, "cold preview differs from primary").not.toBe(primary.href);
  const candidate = requiredEnvironment("KOREA_STATS_RELEASE_CANDIDATE");
  const primaryProof = deploymentProof(primary, candidate, "primary preview");
  const coldProof = deploymentProof(cold, candidate, "cold preview");
  expect(coldProof.id, "cold deployment is distinct").not.toBe(primaryProof.id);
  expect(
    coldProof.createdAt,
    "cold deployment is fresh",
  ).toBeGreaterThanOrEqual(primaryProof.createdAt);
  expect(coldProof.sourceDigest, "same source digest").toBe(
    primaryProof.sourceDigest,
  );
  expect(coldProof.candidate, "same deployment candidate").toBe(
    primaryProof.candidate,
  );
  expect(
    [...coldProof.files.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
    "identical src/dist/package inventory",
  ).toEqual(
    [...primaryProof.files.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return { primary, cold };
}

async function assertExternalMetadataLifecycle(): Promise<void> {
  // Platform/deployment identity is attested before either protected URL receives
  // the shared bypass header in withReleaseClient.
  const { primary, cold } = attestExternalPreviews();
  const first = await withReleaseClient(
    "http",
    async ({ client }) => {
      const traversal = await readAllMetadata(
        client,
        undefined,
        EXTERNAL_PAGE_SIZE,
      );
      const firstCursor = cursorShape(
        traversal.first.nextCursor,
        "primary first cursor",
      );
      const altered = await callToolJson(client, "get_table_info", {
        ...metadataArgs(firstCursor, EXTERNAL_PAGE_SIZE),
        query: "부산",
      });
      expect(altered.success, "query-bound cursor rejects altered query").toBe(
        false,
      );
      expect(altered.errorCode, "query-bound cursor error").toBe(
        "INVALID_CURSOR",
      );
      return traversal;
    },
    primary,
  );
  expect(
    first.pages.length,
    "primary metadata has continuation",
  ).toBeGreaterThan(1);
  const firstCursor = cursorShape(
    first.first.nextCursor,
    "primary first cursor",
  );
  const resumed = await withReleaseClient(
    "http",
    async ({ client }) =>
      metadataPage(
        await callToolJson(
          client,
          "get_table_info",
          metadataArgs(firstCursor, EXTERNAL_PAGE_SIZE),
        ),
        "cold resumed metadata",
      ),
    cold,
  );
  expect(resumed.snapshot, "cross-deployment snapshot hash").toBe(
    first.first.snapshot,
  );
  expect(
    resumed.rawData.map(canonicalJson),
    "cross-deployment resumed row identities",
  ).toEqual(first.pages[1].rawData.map(canonicalJson));
  expect(
    mcpWireBytes(resumed),
    "resumed MCP response bound",
  ).toBeLessThanOrEqual(32_768);

  const coldAll = await withReleaseClient(
    "http",
    async ({ client }) =>
      readAllMetadata(client, undefined, EXTERNAL_PAGE_SIZE),
    cold,
  );
  expect(coldAll.first.snapshot, "cold first snapshot").toBe(
    first.first.snapshot,
  );
  expect(
    coldAll.rows.map(canonicalJson).sort(),
    "cold metadata reconciles primary official rows",
  ).toEqual(first.rows.map(canonicalJson).sort());
}

function createSandbox(): {
  readonly directory: string;
  readonly state: string;
  readonly counter: string;
} {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "korea-stats-release-lifecycle-"),
  );
  fs.chmodSync(directory, 0o700);
  const state = path.join(directory, "state.json");
  const counter = path.join(directory, "business-count");
  fs.writeFileSync(state, JSON.stringify({ generation: 1 }), { mode: 0o600 });
  fs.writeFileSync(counter, "0", { mode: 0o600 });
  return { directory, state, counter };
}

function writeGeneration(state: string, generation: 1 | 2): void {
  fs.writeFileSync(state, JSON.stringify({ generation }), { mode: 0o600 });
}

function childEnvironment(extra: Record<string, string>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of [
    "HOME",
    "LOGNAME",
    "PATH",
    "SHELL",
    "TERM",
    "USER",
    "TMPDIR",
  ]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  for (const name of [
    "KOREA_STATS_CANDIDATE_VERSION",
    "KOREA_STATS_CANDIDATE_STDIO_ENTRY",
    "KOREA_STATS_CANDIDATE_HTTP_URL",
  ]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  Object.assign(environment, extra, {
    KOSIS_API_KEY: SYNTHETIC_KOSIS_KEY,
    DOTENV_CONFIG_PATH: "/nonexistent-korea-stats-release-env",
  });
  delete environment.DATA_GO_KR_SERVICE_KEY;
  delete environment.VERCEL_AUTOMATION_BYPASS_SECRET;
  return environment;
}

async function startChild(
  mode: string,
  extra: Record<string, string>,
): Promise<ChildHandle> {
  const child = spawn(process.execPath, [CHILD_SCRIPT, mode], {
    cwd: process.cwd(),
    env: childEnvironment(extra),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    if (stdout.length < 64 * 1024) stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    if (stderr.length < 64 * 1024) stderr += String(chunk);
  });
  const ready = await new Promise<ChildReady>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${mode} child readiness timed out`)),
      30_000,
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          `${mode} child exited before readiness (${code ?? "signal"})`,
        ),
      );
    });
    child.on("message", (message) => {
      const candidate = readyMessage(message);
      if (candidate === undefined) {
        if (
          typeof message !== "object" ||
          message === null ||
          Array.isArray(message) ||
          Reflect.get(message, "type") !== "ready"
        ) {
          return;
        }
        clearTimeout(timer);
        reject(new Error(`${mode} child readiness payload is invalid`));
        return;
      }
      clearTimeout(timer);
      resolve(candidate);
    });
  });
  return { child, ready, stdout: () => stdout, stderr: () => stderr };
}

async function stopChild(handle: ChildHandle): Promise<void> {
  if (handle.child.exitCode !== null || handle.child.signalCode !== null)
    return;
  handle.child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      handle.child.kill("SIGKILL");
      resolve();
    }, 5_000);
    handle.child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function withLoopbackHttp<T>(
  ready: ChildReady,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${ready.port}/mcp`),
  );
  const client = new Client({
    name: "release-lifecycle-loopback",
    version: "1",
  });
  try {
    await client.connect(transport, {
      timeout: 30_000,
      maxTotalTimeout: 30_000,
    });
    return await operation(client);
  } finally {
    try {
      await transport.close();
    } catch {
      // Preserve the operation assertion; child cleanup remains in the caller.
    }
  }
}

function assertNoChildSecret(handle: ChildHandle): void {
  expect(
    handle.stdout(),
    "controlled child stdout has no KOSIS key",
  ).not.toContain(SYNTHETIC_KOSIS_KEY);
  expect(
    handle.stderr(),
    "controlled child stderr has no business key",
  ).not.toContain(SYNTHETIC_BUSINESS_KEY);
  expect(
    handle.stderr(),
    "controlled child stderr has no upstream sentinel",
  ).not.toContain(SECRET_SENTINEL);
}

async function assertLocalMetadataLifecycle(): Promise<void> {
  const sandbox = createSandbox();
  const handles: ChildHandle[] = [];
  try {
    writeGeneration(sandbox.state, 1);
    const childA = await startChild("metadata-a", {
      KOREA_STATS_CHILD_STATE_FILE: sandbox.state,
    });
    handles.push(childA);
    const first = await withLoopbackHttp(childA.ready, async (client) =>
      metadataPage(
        await callToolJson(client, "get_table_info", metadataArgs()),
        "local generation 1 page 1",
      ),
    );
    const oldCursor = cursorShape(
      first.nextCursor,
      "local generation 1 cursor",
    );
    await stopChild(childA);
    assertNoChildSecret(childA);

    writeGeneration(sandbox.state, 1);
    const childB = await startChild("metadata-b", {
      KOREA_STATS_CHILD_STATE_FILE: sandbox.state,
    });
    handles.push(childB);
    const resumed = await withLoopbackHttp(childB.ready, async (client) =>
      metadataPage(
        await callToolJson(client, "get_table_info", metadataArgs(oldCursor)),
        "local generation 1 resumed page",
      ),
    );
    expect(resumed.success, "cache-loss continuation remains successful").toBe(
      true,
    );
    expect(
      resumed.rawData.length,
      "cache-loss continuation has rows",
    ).toBeGreaterThan(0);
    await stopChild(childB);
    assertNoChildSecret(childB);

    writeGeneration(sandbox.state, 2);
    const childC = await startChild("metadata-c", {
      KOREA_STATS_CHILD_STATE_FILE: sandbox.state,
    });
    handles.push(childC);
    const changed = await withLoopbackHttp(childC.ready, async (client) =>
      callToolJson(client, "get_table_info", metadataArgs(oldCursor)),
    );
    expect(changed.success, "changed generation fails closed").toBe(false);
    expect(changed.errorCode, "changed generation restart code").toBe(
      "RESTART_REQUIRED",
    );
    expect(
      changed.rawData === undefined ||
        (Array.isArray(changed.rawData) && changed.rawData.length === 0),
      "restart response has no guessed data",
    ).toBe(true);
    expect(
      changed.nextCursor,
      "restart response has no continuation",
    ).toBeNull();
    const restarted = await withLoopbackHttp(childC.ready, async (client) =>
      metadataPage(
        await callToolJson(client, "get_table_info", metadataArgs()),
        "local generation 2 fresh page",
      ),
    );
    expect(restarted.success, "fresh generation restart succeeds").toBe(true);
    expect(restarted.snapshot, "fresh generation snapshot differs").not.toBe(
      first.snapshot,
    );
    await stopChild(childC);
    assertNoChildSecret(childC);
    expect(new Set(handles.map((handle) => handle.ready.pid)).size).toBe(3);
  } finally {
    for (const handle of handles) await stopChild(handle);
    fs.rmSync(sandbox.directory, { recursive: true, force: true });
  }
}

function assertBusinessUnavailable(
  result: JsonObject,
  label: string,
  code: string,
): void {
  expect(result.success, `${label} success`).toBe(false);
  expect(result.errorCode, `${label} error code`).toBe(code);
  expect(result.items, `${label} items`).toEqual([]);
  expect(result.data, `${label} data`).toEqual([]);
  expect(result.rows, `${label} rows`).toEqual([]);
  expect(result.returnedCount, `${label} returned count`).toBe(0);
  expect(result.providerTotal, `${label} provider total`).toBeNull();
  const completeness = asRecord(result.completeness, `${label} completeness`);
  expect(completeness.status, `${label} unavailable status`).toBe(
    "current_page_unavailable",
  );
  expect(completeness.wholeDataset, `${label} completeness scope`).toBe(
    "not_retrieved",
  );
  const pages = asRecord(result.pages, `${label} page state`);
  expect(pages.returned, `${label} page returned`).toBe(0);
  expect(typeof result.observedAt, `${label} observedAt`).toBe("string");
  expect(
    String(result.observedAt).trim().length,
    `${label} observedAt nonempty`,
  ).toBeGreaterThan(0);
  expect(JSON.stringify(result), `${label} no secret sentinel`).not.toContain(
    SECRET_SENTINEL,
  );
  expect(
    JSON.stringify(result),
    `${label} no synthetic business key`,
  ).not.toContain(SYNTHETIC_BUSINESS_KEY);
}

async function runHttpBusinessChild(
  mode: "business-http-missing" | "business-http-503",
): Promise<{
  readonly business: JsonObject;
  readonly metadata?: JsonObject;
  readonly data?: JsonObject;
  readonly stderrHasSentinel?: boolean;
  readonly calls: number;
  readonly output: string;
}> {
  const sandbox = createSandbox();
  let handle: ChildHandle | undefined;
  try {
    handle = await startChild(mode, {
      KOREA_STATS_CHILD_COUNTER_FILE: sandbox.counter,
    });
    const response = await withLoopbackHttp(handle.ready, async (client) => {
      const business = await callToolJson(client, "search_businesses", {
        regionType: "ctprvnCd",
        regionCode: "26",
        page: 1,
        pageSize: 1,
      });
      if (mode.endsWith("-missing")) return { business };
      const metadata = await callToolJson(client, "get_table_info", {
        orgId: ORG_ID,
        tableId: TABLE_ID,
        infoType: "ITM",
        pageSize: 4,
      });
      const data = await callToolJson(client, "get_statistics_data", {
        orgId: ORG_ID,
        tableId: TABLE_ID,
        objL1: "NATIONAL",
        itemId: "ITEM",
        periodType: "Y",
        startPeriod: "2023",
        endPeriod: "2023",
        pageSize: 1,
      });
      return { business, metadata, data };
    });
    await stopChild(handle);
    const output = `${handle.stdout()}${handle.stderr()}`;
    const calls =
      Number.parseInt(fs.readFileSync(sandbox.counter, "utf8"), 10) || 0;
    return { ...response, calls, output };
  } finally {
    if (handle) await stopChild(handle);
    fs.rmSync(sandbox.directory, { recursive: true, force: true });
  }
}

async function runStdioBusinessChild(
  mode: "business-stdio-missing" | "business-stdio-503",
): Promise<ChildResult & { readonly output: string; readonly calls: number }> {
  const sandbox = createSandbox();
  const handle = spawn(process.execPath, [CHILD_SCRIPT, mode], {
    cwd: process.cwd(),
    env: childEnvironment({ KOREA_STATS_CHILD_COUNTER_FILE: sandbox.counter }),
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let stdout = "";
  let stderr = "";
  handle.stdout?.on("data", (chunk) => {
    if (stdout.length < 64 * 1024) stdout += String(chunk);
  });
  handle.stderr?.on("data", (chunk) => {
    if (stderr.length < 64 * 1024) stderr += String(chunk);
  });
  try {
    const result = await new Promise<ChildResult>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${mode} result timed out`)),
        60_000,
      );
      handle.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      handle.once("exit", (code) => {
        if (code !== 0) {
          clearTimeout(timer);
          reject(
            new Error(
              `${mode} child failed before result (${code ?? "signal"})`,
            ),
          );
        }
      });
      handle.on("message", (message) => {
        const candidate = resultMessage(message);
        if (candidate === undefined) {
          if (
            typeof message !== "object" ||
            message === null ||
            Array.isArray(message) ||
            Reflect.get(message, "type") !== "result"
          ) {
            return;
          }
          clearTimeout(timer);
          reject(new Error(`${mode} child result payload is invalid`));
          return;
        }
        clearTimeout(timer);
        resolve(candidate);
      });
    });
    if (handle.exitCode === null && handle.signalCode === null) {
      await new Promise<void>((resolve) =>
        handle.once("close", () => resolve()),
      );
    }
    const calls =
      Number.parseInt(fs.readFileSync(sandbox.counter, "utf8"), 10) || 0;
    return { ...result, output: `${stdout}${stderr}`, calls };
  } finally {
    if (handle.exitCode === null && handle.signalCode === null)
      handle.kill("SIGTERM");
    fs.rmSync(sandbox.directory, { recursive: true, force: true });
  }
}

async function assertControlledBusinessFailure(
  kind: LiveTransportKind,
): Promise<void> {
  const missing =
    kind === "http"
      ? await runHttpBusinessChild("business-http-missing")
      : await runStdioBusinessChild("business-stdio-missing");
  const missingResult = missing.business;
  if (!missingResult)
    throw new Error(`${kind} missing-key child returned no result`);
  assertBusinessUnavailable(
    missingResult,
    `${kind} missing key`,
    "INVALID_API_KEY",
  );
  expect(missing.calls, `${kind} missing key upstream isolation`).toBe(0);
  expect(missing.output, `${kind} missing child output`).not.toContain(
    SECRET_SENTINEL,
  );
  expect(
    missing.output,
    `${kind} missing child output KOSIS key`,
  ).not.toContain(SYNTHETIC_KOSIS_KEY);
  if (missing.stderrHasSentinel !== undefined) {
    expect(
      missing.stderrHasSentinel,
      `${kind} missing stderr sanitization`,
    ).toBe(false);
  }

  const broken =
    kind === "http"
      ? await runHttpBusinessChild("business-http-503")
      : await runStdioBusinessChild("business-stdio-503");
  const brokenResult = broken.business;
  if (!brokenResult) throw new Error(`${kind} 503 child returned no result`);
  assertBusinessUnavailable(brokenResult, `${kind} 503`, "PROVIDER_ERROR");
  expect(broken.calls, `${kind} bounded business calls`).toBeGreaterThan(0);
  expect(broken.calls, `${kind} bounded business calls`).toBeLessThanOrEqual(2);
  expect(broken.output, `${kind} 503 child output`).not.toContain(
    SECRET_SENTINEL,
  );
  expect(broken.output, `${kind} 503 child output KOSIS key`).not.toContain(
    SYNTHETIC_KOSIS_KEY,
  );
  if (broken.stderrHasSentinel !== undefined) {
    expect(broken.stderrHasSentinel, `${kind} stderr sanitization`).toBe(false);
  }
  if (broken.metadata === undefined || broken.data === undefined) {
    throw new Error(`${kind} 503 child omitted healthy KOSIS proof`);
  }
  expect(broken.metadata.success, `${kind} KOSIS metadata after failure`).toBe(
    true,
  );
  expect(
    Array.isArray(broken.metadata.rawData),
    `${kind} KOSIS metadata rows`,
  ).toBe(true);
  expect(broken.data.success, `${kind} KOSIS data after failure`).toBe(true);
  expect(Array.isArray(broken.data.data), `${kind} KOSIS data rows`).toBe(true);
  expect(
    (broken.data.data as unknown[]).length,
    `${kind} KOSIS data nonempty`,
  ).toBeGreaterThan(0);
}

async function assertPublicCoreAndIsolation(
  kind: LiveTransportKind,
): Promise<void> {
  await withReleaseClient(kind, async ({ client }) => {
    const metadata = metadataPage(
      await callToolJson(client, "get_table_info", {
        orgId: ORG_ID,
        tableId: TABLE_ID,
        infoType: "ITM",
        pageSize: PAGE_SIZE,
      }),
      `${kind} public KOSIS metadata`,
    );
    expect(
      metadata.rawData.length,
      `${kind} official metadata rows`,
    ).toBeGreaterThan(0);
    const data = await callToolJson(client, "quick_stats", { query: "인구" });
    expect(data.success, `${kind} public KOSIS data success`).toBe(true);
    expect(
      typeof data.value === "string" || typeof data.value === "number",
      `${kind} public value`,
    ).toBe(true);
    const source = asRecord(data.source, `${kind} public source`);
    expect(
      requiredString(source.orgId, `${kind} source orgId`),
      `${kind} official org`,
    ).toBe(ORG_ID);
    expect(
      requiredString(source.tableId, `${kind} source tableId`).length,
    ).toBeGreaterThan(0);
  });
  await assertControlledBusinessFailure(kind);
}

const releasePhase = process.env.KOREA_STATS_RELEASE_PHASE?.trim();
if (releasePhase !== "R1") {
  test(
    "REQ-M05 stateless metadata cursor survives protected preview deployment and cache loss @R2 @http @AC12",
    { tag: ["@REQ-M05", "@R2", "@R3", "@AC12", "@live", "@http"] },
    async () =>
      runSanitizedLiveCase("REQ-M05", async () => {
        await assertExternalMetadataLifecycle();
        await assertLocalMetadataLifecycle();
      }),
  );
}

if (!releasePhase || releasePhase === "R3") {
  test(
    "REQ-O01.stdio operator-provider isolation keeps KOSIS positive and business failures truthful @R3 @stdio @AC9 @AC10 @AC13",
    {
      tag: [
        "@REQ-O01.stdio",
        "@R3",
        "@AC9",
        "@AC10",
        "@AC13",
        "@live",
        "@stdio",
      ],
    },
    async () =>
      runSanitizedLiveCase("REQ-O01.stdio", () =>
        assertPublicCoreAndIsolation("stdio"),
      ),
  );

  test(
    "REQ-O01.http operator-provider isolation keeps KOSIS positive and business failures truthful @R3 @http @AC9 @AC10 @AC13",
    {
      tag: ["@REQ-O01.http", "@R3", "@AC9", "@AC10", "@AC13", "@live", "@http"],
    },
    async () =>
      runSanitizedLiveCase("REQ-O01.http", () =>
        assertPublicCoreAndIsolation("http"),
      ),
  );
}
