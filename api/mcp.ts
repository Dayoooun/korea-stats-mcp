/**
 * Vercel Serverless Function for Korea Stats MCP
 *
 * Kakao PlayMCP 등록용 원격 MCP 서버 엔드포인트
 * 최적화: fetch 타임아웃, 빠른 에러 반환, GET 헬스체크 지원
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

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
  quickStats,
  quickStatsSchema,
  quickTrend,
  quickTrendSchema,
} from '../dist/tools/index.js';

// 리소스 가져오기
import { getCategoryTreeJson, getKeyIndicatorsJson } from '../dist/resources/index.js';

// 프롬프트 가져오기
import {
  statisticsAssistantPromptSchema,
  generateStatisticsAssistantPrompt,
} from '../dist/prompts/index.js';

/**
 * MCP 서버 생성 (매 요청마다 - SDK 제약)
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'korea-stats-mcp',
    version: '1.0.0',
    description: '한국 통계청 KOSIS OpenAPI 기반 MCP 서버',
  });

  // 도구 등록
  server.tool(
    quickStatsSchema.name,
    quickStatsSchema.description,
    quickStatsSchema.inputSchema.shape,
    async (args) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await quickStats(args as any), null, 2) }],
    })
  );

  server.tool(
    quickTrendSchema.name,
    quickTrendSchema.description,
    quickTrendSchema.inputSchema.shape,
    async (args) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await quickTrend(args as any), null, 2) }],
    })
  );

  server.tool(
    searchStatisticsSchema.name,
    searchStatisticsSchema.description,
    searchStatisticsSchema.inputSchema.shape,
    async (args) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await searchStatistics(args as any), null, 2) }],
    })
  );

  server.tool(
    getStatisticsListSchema.name,
    getStatisticsListSchema.description,
    getStatisticsListSchema.inputSchema.shape,
    async (args) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await getStatisticsList(args as any), null, 2) }],
    })
  );

  server.tool(
    getStatisticsDataSchema.name,
    getStatisticsDataSchema.description,
    getStatisticsDataSchema.inputSchema.shape,
    async (args) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await getStatisticsData(args as any), null, 2) }],
    })
  );

  server.tool(
    compareStatisticsSchema.name,
    compareStatisticsSchema.description,
    compareStatisticsSchema.inputSchema.shape,
    async (args) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await compareStatistics(args as any), null, 2) }],
    })
  );

  server.tool(
    analyzeTimeSeriesSchema.name,
    analyzeTimeSeriesSchema.description,
    analyzeTimeSeriesSchema.inputSchema.shape,
    async (args) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await analyzeTimeSeries(args as any), null, 2) }],
    })
  );

  server.tool(
    getRecommendedStatsSchema.name,
    getRecommendedStatsSchema.description,
    getRecommendedStatsSchema.inputSchema.shape,
    async (args) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await getRecommendedStats(args as any), null, 2) }],
    })
  );

  // 리소스 등록
  server.resource(
    'category-tree',
    'kosis://categories/tree',
    { description: 'KOSIS 통계 분류 체계', mimeType: 'application/json' },
    async () => ({
      contents: [{ uri: 'kosis://categories/tree', text: getCategoryTreeJson(), mimeType: 'application/json' }],
    })
  );

  server.resource(
    'key-indicators',
    'kosis://indicators/list',
    { description: '주요 경제사회 지표 목록', mimeType: 'application/json' },
    async () => ({
      contents: [{ uri: 'kosis://indicators/list', text: getKeyIndicatorsJson(), mimeType: 'application/json' }],
    })
  );

  // 프롬프트 등록
  server.prompt(
    statisticsAssistantPromptSchema.name,
    statisticsAssistantPromptSchema.description,
    statisticsAssistantPromptSchema.argsSchema.shape,
    async (args) => {
      const result = generateStatisticsAssistantPrompt(args.question as string);
      return { messages: result.messages.map((m) => ({ role: m.role, content: m.content })) };
    }
  );

  return server;
}

/**
 * Vercel Serverless Handler
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Stateless 모드: POST만 허용. GET(SSE)/DELETE(세션종료) 불필요
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Method not allowed. This is a stateless MCP server — use POST only.' },
      id: null,
    });
  }

  try {
    const server = createMcpServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => transport.close());

    await server.connect(transport);
    await transport.handleRequest(req as any, res as any, req.body);
  } catch (error) {
    console.error('MCP Error:', error);

    // 이미 응답이 시작됐으면 중단
    if (res.headersSent) return;

    const message = error instanceof Error ? error.message : 'Internal server error';
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message },
      id: null,
    });
  }
}
