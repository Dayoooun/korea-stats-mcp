/**
 * Korea Stats MCP 서버
 * 통계청 KOSIS OpenAPI 기반 MCP 서버
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// 도구 가져오기
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
  // getTableInfo - 응답량이 너무 커서 Cursor 초기화 유발, 비활성화
  // getTableInfoSchema,
  quickStats,
  quickStatsSchema,
  quickTrend,
  quickTrendSchema,
} from './tools/index.js';

// 리소스 가져오기
import { getCategoryTreeJson, getKeyIndicatorsJson } from './resources/index.js';

// 프롬프트 가져오기
import {
  statisticsAssistantPromptSchema,
  generateStatisticsAssistantPrompt,
} from './prompts/index.js';

// 설정 가져오기
import { config, validateConfig } from './config/index.js';

/**
 * MCP 서버 생성 및 설정
 */
export function createServer(): McpServer {
  // 설정 유효성 검사
  validateConfig();

  const server = new McpServer({
    name: 'korea-stats-mcp',
    version: '1.0.0',
    description:
      '한국 통계청 KOSIS OpenAPI 기반 MCP 서버 - 자연어로 통계 데이터를 검색하고 분석합니다.',
  });

  // ===== 도구 등록 =====

  // 1. 통계 검색
  server.tool(
    searchStatisticsSchema.name,
    searchStatisticsSchema.description,
    searchStatisticsSchema.inputSchema.shape,
    async (args) => {
      const result = await searchStatistics(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 2. 통계 목록 조회
  server.tool(
    getStatisticsListSchema.name,
    getStatisticsListSchema.description,
    getStatisticsListSchema.inputSchema.shape,
    async (args) => {
      const result = await getStatisticsList(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 3. 통계 데이터 조회
  server.tool(
    getStatisticsDataSchema.name,
    getStatisticsDataSchema.description,
    getStatisticsDataSchema.inputSchema.shape,
    async (args) => {
      const result = await getStatisticsData(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 4. 통계 비교
  server.tool(
    compareStatisticsSchema.name,
    compareStatisticsSchema.description,
    compareStatisticsSchema.inputSchema.shape,
    async (args) => {
      const result = await compareStatistics(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 5. 시계열 분석
  server.tool(
    analyzeTimeSeriesSchema.name,
    analyzeTimeSeriesSchema.description,
    analyzeTimeSeriesSchema.inputSchema.shape,
    async (args) => {
      const result = await analyzeTimeSeries(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 6. 추천 통계
  server.tool(
    getRecommendedStatsSchema.name,
    getRecommendedStatsSchema.description,
    getRecommendedStatsSchema.inputSchema.shape,
    async (args) => {
      const result = await getRecommendedStats(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 7. 통계표 정보 조회 - 비활성화 (응답량 과다로 Cursor 초기화 유발)
  // 대신 quick_stats가 정적 파라미터를 사용하여 동일 기능 제공
  // server.tool(
  //   getTableInfoSchema.name,
  //   getTableInfoSchema.description,
  //   getTableInfoSchema.inputSchema.shape,
  //   async (args) => {
  //     const result = await getTableInfo(args as any);
  //     return {
  //       content: [
  //         {
  //           type: 'text' as const,
  //           text: JSON.stringify(result, null, 2),
  //         },
  //       ],
  //     };
  //   }
  // );

  // 8. 빠른 통계 조회 (원스텝)
  server.tool(
    quickStatsSchema.name,
    quickStatsSchema.description,
    quickStatsSchema.inputSchema.shape,
    async (args) => {
      const result = await quickStats(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // 9. 빠른 추세 분석 (시계열)
  server.tool(
    quickTrendSchema.name,
    quickTrendSchema.description,
    quickTrendSchema.inputSchema.shape,
    async (args) => {
      const result = await quickTrend(args as any);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // ===== 리소스 등록 =====

  // 1. 통계 분류 체계
  server.resource(
    'category-tree',
    'kosis://categories/tree',
    {
      description: 'KOSIS 통계 분류 체계 - 주제별/기관별 분류 구조',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'kosis://categories/tree',
          text: getCategoryTreeJson(),
          mimeType: 'application/json',
        },
      ],
    })
  );

  // 2. 주요 지표 목록
  server.resource(
    'key-indicators',
    'kosis://indicators/list',
    {
      description: '자주 조회되는 주요 경제사회 지표 목록',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'kosis://indicators/list',
          text: getKeyIndicatorsJson(),
          mimeType: 'application/json',
        },
      ],
    })
  );

  // ===== 프롬프트 등록 =====

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
    }
  );

  return server;
}
