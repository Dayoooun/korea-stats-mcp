import fs from "node:fs";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const mode = process.argv[2] ?? "";
const syntheticKosisKey = "release-lifecycle-synthetic-kosis-key";
const syntheticBusinessKey = "release-lifecycle-synthetic-business-key";
const secretSentinel = "release-lifecycle-upstream-secret-sentinel";
const stateFile = process.env.KOREA_STATS_CHILD_STATE_FILE;
const counterFile = process.env.KOREA_STATS_CHILD_COUNTER_FILE;

process.env.KOSIS_API_KEY = syntheticKosisKey;
process.env.DOTENV_CONFIG_PATH = "/nonexistent-korea-stats-release-env";
delete process.env.DATA_GO_KR_SERVICE_KEY;
delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
if (mode.endsWith("-503"))
  process.env.DATA_GO_KR_SERVICE_KEY = syntheticBusinessKey;

function send(message) {
  if (typeof process.send !== "function") return;
  process.send(message);
}

function metadataRows(generation) {
  const changed = generation === 2;
  return [
    {
      OBJ_ID: "REGION",
      OBJ_NM: "행정구역",
      ITM_ID: "NATIONAL",
      ITM_NM: changed ? "전국(새 스냅샷)" : "전국",
      UP_ITM_ID: "",
      OBJ_ID_SN: "1",
      UNIT: "명",
    },
    {
      OBJ_ID: "REGION",
      OBJ_NM: "행정구역",
      ITM_ID: "BUSAN",
      ITM_NM: "부산광역시",
      UP_ITM_ID: "",
      OBJ_ID_SN: "2",
      UNIT: "명",
    },
    {
      OBJ_ID: "REGION",
      OBJ_NM: "행정구역",
      ITM_ID: "DISTRICT",
      ITM_NM: changed ? "동래구(새 스냅샷)" : "동래구",
      UP_ITM_ID: "BUSAN",
      OBJ_ID_SN: "3",
      UNIT: "명",
    },
    {
      OBJ_ID: "ITEMS",
      OBJ_NM: "항목",
      ITM_ID: "ITEM",
      ITM_NM: changed ? "관측값(새 스냅샷)" : "관측값",
      UP_ITM_ID: "",
      OBJ_ID_SN: "4",
      UNIT: "명",
    },
  ];
}

function generationFromState() {
  if (!stateFile) throw new Error("metadata child state file is required");
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    throw new Error("metadata child state file is unreadable");
  }
  if (parsed?.generation !== 1 && parsed?.generation !== 2) {
    throw new Error("metadata child state generation must be 1 or 2");
  }
  return parsed.generation;
}

function incrementBusinessCounter() {
  if (!counterFile) return;
  let count = 0;
  try {
    count = Number.parseInt(fs.readFileSync(counterFile, "utf8"), 10) || 0;
  } catch {
    count = 0;
  }
  fs.writeFileSync(counterFile, `${count + 1}`, { mode: 0o600 });
}

function kosisResponse(url) {
  const params = url.searchParams;
  if (params.get("method") === "getMeta") {
    const generation = mode.startsWith("metadata-") ? generationFromState() : 1;
    return Response.json(metadataRows(generation));
  }
  if (params.has("tblId") || params.has("itmId")) {
    return Response.json([
      {
        ORG_ID: "101",
        TBL_ID: "DT_1B040A3",
        PRD_SE: "Y",
        C1: "NATIONAL",
        ITM_ID: "ITEM",
        PRD_DE: "2023",
        DT: "42",
        TBL_NM: "통제된 건강한 표",
        ITM_NM: "관측값",
        UNIT_NM: "명",
      },
    ]);
  }
  return Response.json([
    {
      ORG_ID: "101",
      TBL_ID: "DT_1B040A3",
      TBL_NM: "통제된 건강한 표",
      TBL_NM_ENG: "controlled healthy table",
    },
  ]);
}

function businessResponse() {
  incrementBusinessCounter();
  return new Response(
    JSON.stringify({ error: secretSentinel, serviceKey: syntheticBusinessKey }),
    {
      status: 503,
      headers: { "content-type": "application/json" },
    },
  );
}

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname === "kosis.kr") return kosisResponse(url);
  if (url.hostname === "apis.data.go.kr") {
    if (mode.endsWith("-503")) return businessResponse();
    throw new Error(
      "unexpected business request without a controlled failure mode",
    );
  }
  throw new Error("unexpected upstream host in controlled child");
};

function installHttpAdapter(handler) {
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    request.body = raw ? JSON.parse(raw) : undefined;
    response.status = (code) => {
      response.statusCode = code;
      return response;
    };
    response.json = (value) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(value));
      return response;
    };
    try {
      await handler(request, response);
    } catch {
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "controlled child failure" },
            id: null,
          }),
        );
      }
    }
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    send({ type: "ready", pid: process.pid, port: address?.port });
  });
  return server;
}

function stdioEnv() {
  const environment = {};
  for (const name of ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  for (const name of [
    "KOREA_STATS_CANDIDATE_VERSION",
    "KOREA_STATS_CANDIDATE_STDIO_ENTRY",
    "KOREA_STATS_CANDIDATE_HTTP_URL",
  ]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  environment.KOSIS_API_KEY = syntheticKosisKey;
  environment.DOTENV_CONFIG_PATH = "/nonexistent-korea-stats-release-env";
  if (mode.endsWith("-503"))
    environment.DATA_GO_KR_SERVICE_KEY = syntheticBusinessKey;
  return environment;
}

function stdioFetchHook() {
  const counter = JSON.stringify(counterFile ?? "");
  const business = JSON.stringify(mode.endsWith("-503"));
  const rows = JSON.stringify(metadataRows(1));
  const data = JSON.stringify([
    {
      ORG_ID: "101",
      TBL_ID: "DT_1B040A3",
      PRD_SE: "Y",
      C1: "NATIONAL",
      ITM_ID: "ITEM",
      PRD_DE: "2023",
      DT: "42",
      TBL_NM: "통제된 건강한 표",
      ITM_NM: "관측값",
      UNIT_NM: "명",
    },
  ]);
  return `
import fs from "node:fs";
const counterFile = ${counter};
const businessFailure = ${business};
const secretSentinel = ${JSON.stringify(secretSentinel)};
const syntheticBusinessKey = ${JSON.stringify(syntheticBusinessKey)};
const metadataRows = ${rows};
const dataRows = ${data};
function countBusiness() {
  if (!counterFile) return;
  let count = 0;
  try { count = Number.parseInt(fs.readFileSync(counterFile, "utf8"), 10) || 0; } catch {}
  fs.writeFileSync(counterFile, String(count + 1), { mode: 0o600 });
}
globalThis.fetch = async input => {
  const url = new URL(String(input));
  if (url.hostname === "kosis.kr") {
    if (url.searchParams.get("method") === "getMeta") return Response.json(metadataRows);
    if (url.searchParams.has("tblId") || url.searchParams.has("itmId")) return Response.json(dataRows);
    return Response.json([{ ORG_ID: "101", TBL_ID: "DT_1B040A3", TBL_NM: "통제된 건강한 표" }]);
  }
  if (url.hostname === "apis.data.go.kr" && businessFailure) {
    countBusiness();
    return new Response(JSON.stringify({ error: secretSentinel, serviceKey: syntheticBusinessKey }), { status: 503, headers: { "content-type": "application/json" } });
  }
  throw new Error("unexpected upstream host in controlled stdio child");
};
`;
}

function parseToolResult(result) {
  if (result?.isError === true)
    throw new Error("controlled stdio MCP returned isError");
  const text = result?.content?.find((item) => item?.type === "text")?.text;
  if (typeof text !== "string")
    throw new Error("controlled stdio tool result had no text");
  return JSON.parse(text);
}

async function runStdioScenario() {
  const { candidateConfig } = await import(
    new URL("./release-live-client.ts", import.meta.url)
  );
  const config = candidateConfig();
  const hook = `data:text/javascript,${encodeURIComponent(stdioFetchHook())}`;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", hook, config.stdioEntry],
    env: stdioEnv(),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    if (stderr.length < 64 * 1024) stderr += String(chunk);
  });
  const client = new Client({ name: "release-lifecycle-child", version: "1" });
  try {
    await client.connect(transport);
    const business = parseToolResult(
      await client.callTool({
        name: "search_businesses",
        arguments: {
          regionType: "ctprvnCd",
          regionCode: "26",
          page: 1,
          pageSize: 1,
        },
      }),
    );
    const metadata = parseToolResult(
      await client.callTool({
        name: "get_table_info",
        arguments: {
          orgId: "101",
          tableId: "DT_1B040A3",
          infoType: "ITM",
          pageSize: 4,
        },
      }),
    );
    const data = parseToolResult(
      await client.callTool({
        name: "get_statistics_data",
        arguments: {
          orgId: "101",
          tableId: "DT_1B040A3",
          objL1: "NATIONAL",
          itemId: "ITEM",
          periodType: "Y",
          startPeriod: "2023",
          endPeriod: "2023",
          pageSize: 1,
        },
      }),
    );
    await client.close();
    send({
      type: "result",
      business,
      metadata,
      data,
      stderrHasSentinel:
        stderr.includes(secretSentinel) ||
        stderr.includes(syntheticBusinessKey) ||
        stderr.includes(syntheticKosisKey),
    });
  } catch (error) {
    try {
      await client.close();
    } catch {}
    send({
      type: "result",
      error:
        error instanceof Error
          ? error.message
          : "controlled stdio scenario failed",
      stderrHasSentinel:
        stderr.includes(secretSentinel) ||
        stderr.includes(syntheticBusinessKey) ||
        stderr.includes(syntheticKosisKey),
    });
    process.exitCode = 1;
  }
}

if (mode.startsWith("metadata-")) {
  const { default: handler } = await import("../api/mcp.ts");
  installHttpAdapter(handler);
} else if (mode.startsWith("business-http-")) {
  const { default: handler } = await import("../api/mcp.ts");
  installHttpAdapter(handler);
} else if (mode.startsWith("business-stdio-")) {
  await runStdioScenario();
} else {
  throw new Error("unknown controlled child mode");
}
