/**
 * Vercel Serverless Function for Korea Stats MCP
 *
 * Kakao PlayMCP 등록용 원격 MCP 서버 엔드포인트
 * POST 전용 JSON-RPC 엔드포인트와 OPTIONS 사전 요청을 지원합니다.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  elapsedTimeMsSince,
  emitOperationalEvent,
  statusCategoryForCode,
} from "../dist/utils/operationalEvents.js";
import { config } from "../dist/config/index.js";

// 도구 가져오기 (컴파일된 dist 폴더에서)
import {
  searchStatistics,
  searchStatisticsSchema,
  getStatisticsList,
  getStatisticsListSchema,
  getStatisticsData,
  getStatisticsDataSchema,
  compareStatistics,
  compareStatisticsSchema,
  analyzeTimeSeries,
  analyzeTimeSeriesSchema,
  getRecommendedStats,
  getRecommendedStatsSchema,
  getTableInfo,
  getTableInfoSchema,
  registerPublicTools,
  quickStats,
  quickStatsSchema,
  quickTrend,
  quickTrendSchema,
} from "../dist/tools/index.js";

// 리소스 가져오기
import {
  getCategoryTreeJson,
  getKeyIndicatorsJson,
} from "../dist/resources/index.js";
import { PACKAGE_VERSION } from "../dist/version.js";

// 프롬프트 가져오기
import {
  statisticsAssistantPromptSchema,
  generateStatisticsAssistantPrompt,
} from "../dist/prompts/index.js";
function isInitializeRequest(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  try {
    return (value as { method?: unknown }).method === "initialize";
  } catch {
    return false;
  }
}

/**
 * MCP 서버 생성 (매 요청마다 - SDK 제약)
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "korea-stats-mcp",
    version: PACKAGE_VERSION,
    description: "한국 통계청 KOSIS OpenAPI 기반 MCP 서버",
  });

  // 도구 등록
  registerPublicTools(server);
  server.tool(
    getTableInfoSchema.name,
    getTableInfoSchema.description,
    getTableInfoSchema.inputSchema.shape,
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await getTableInfo(args), null, 2),
        },
      ],
    }),
  );
  server.tool(
    quickStatsSchema.name,
    quickStatsSchema.description,
    quickStatsSchema.inputSchema.shape,
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await quickStats(args as any), null, 2),
        },
      ],
    }),
  );

  server.tool(
    quickTrendSchema.name,
    quickTrendSchema.description,
    quickTrendSchema.inputSchema.shape,
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await quickTrend(args as any), null, 2),
        },
      ],
    }),
  );

  server.tool(
    searchStatisticsSchema.name,
    searchStatisticsSchema.description,
    searchStatisticsSchema.inputSchema.shape,
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await searchStatistics(args as any), null, 2),
        },
      ],
    }),
  );

  server.tool(
    getStatisticsListSchema.name,
    getStatisticsListSchema.description,
    getStatisticsListSchema.inputSchema.shape,
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await getStatisticsList(args as any), null, 2),
        },
      ],
    }),
  );

  server.tool(
    getStatisticsDataSchema.name,
    getStatisticsDataSchema.description,
    getStatisticsDataSchema.inputSchema.shape,
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await getStatisticsData(args as any), null, 2),
        },
      ],
    }),
  );

  server.tool(
    compareStatisticsSchema.name,
    compareStatisticsSchema.description,
    compareStatisticsSchema.inputSchema.shape,
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await compareStatistics(args as any), null, 2),
        },
      ],
    }),
  );

  server.tool(
    analyzeTimeSeriesSchema.name,
    analyzeTimeSeriesSchema.description,
    analyzeTimeSeriesSchema.inputSchema.shape,
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await analyzeTimeSeries(args as any), null, 2),
        },
      ],
    }),
  );

  server.tool(
    getRecommendedStatsSchema.name,
    getRecommendedStatsSchema.description,
    getRecommendedStatsSchema.inputSchema.shape,
    async (args) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(await getRecommendedStats(args as any), null, 2),
        },
      ],
    }),
  );

  // 리소스 등록
  server.resource(
    "category-tree",
    "kosis://categories/tree",
    {
      description: "KOSIS 통계 탐색을 위한 정적 분류 안내",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "kosis://categories/tree",
          text: getCategoryTreeJson(),
          mimeType: "application/json",
        },
      ],
    }),
  );

  server.resource(
    "key-indicators",
    "kosis://indicators/list",
    { description: "주요 경제사회 지표 목록", mimeType: "application/json" },
    async () => ({
      contents: [
        {
          uri: "kosis://indicators/list",
          text: getKeyIndicatorsJson(),
          mimeType: "application/json",
        },
      ],
    }),
  );

  // 프롬프트 등록
  server.prompt(
    statisticsAssistantPromptSchema.name,
    statisticsAssistantPromptSchema.description,
    statisticsAssistantPromptSchema.argsSchema.shape,
    async (args) => {
      const result = generateStatisticsAssistantPrompt(args.question as string);
      return {
        messages: result.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      };
    },
  );

  return server;
}

/**
 * Vercel Serverless Handler
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now();
  const initializeRequest = isInitializeRequest(req.body);
  let requestCompleted = false;
  let transportClosed = false;

  const emitRequestCompletion = (): void => {
    if (requestCompleted) return;
    requestCompleted = true;
    emitOperationalEvent({
      kind: "mcp_request_complete",
      elapsedTimeMs: elapsedTimeMsSince(startedAt),
      statusCategory: statusCategoryForCode(res.statusCode),
    });
  };

  // CORS 헤더
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    emitRequestCompletion();
    return;
  }

  // Stateless 모드: POST만 허용. GET(SSE)/DELETE(세션종료) 불필요
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32600,
        message:
          "Method not allowed. This is a stateless MCP server — use POST only.",
      },
      id: null,
    });
    emitRequestCompletion();
    return;
  }

  let transport: StreamableHTTPServerTransport | undefined;
  try {
    const server = createMcpServer();

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      if (transportClosed) return;
      transportClosed = true;
      try {
        const currentTransport = transport;
        if (currentTransport) {
          void currentTransport.close().catch(() => undefined);
        }
      } catch {
        // Closing diagnostics must not affect the response.
      }
      emitOperationalEvent({
        kind: "mcp_transport_close",
        elapsedTimeMs: elapsedTimeMsSince(startedAt),
        statusCategory: statusCategoryForCode(res.statusCode),
      });
    });

    await server.connect(transport);
    await transport.handleRequest(req as any, res as any, req.body);
  } catch {
    console.error("MCP request failed");

    // 이미 응답이 시작됐으면 중단
    if (!res.headersSent) {
      const message = "Internal server error";
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message },
        id: null,
      });
    }
  } finally {
    if (initializeRequest) {
      emitOperationalEvent({
        kind: "credentials_configured",
        configured: Boolean(config.kosis.apiKey.trim()),
      });
      emitOperationalEvent({
        kind: "mcp_initialize",
        elapsedTimeMs: elapsedTimeMsSince(startedAt),
        statusCategory: statusCategoryForCode(res.statusCode),
      });
    }
    emitRequestCompletion();
  }
}
