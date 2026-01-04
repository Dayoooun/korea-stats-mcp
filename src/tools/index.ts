/**
 * MCP 도구 등록 통합
 */

export {
  searchStatistics,
  searchStatisticsSchema,
  type SearchStatisticsInput,
} from './searchStatistics.js';

export {
  getStatisticsList,
  getStatisticsListSchema,
  getAvailableViewCodes,
  type GetStatisticsListInput,
} from './getStatisticsList.js';

export {
  getStatisticsData,
  getStatisticsDataSchema,
  type GetStatisticsDataInput,
} from './getStatisticsData.js';

export {
  compareStatistics,
  compareStatisticsSchema,
  type CompareStatisticsInput,
} from './compareStatistics.js';

export {
  analyzeTimeSeries,
  analyzeTimeSeriesSchema,
  type AnalyzeTimeSeriesInput,
} from './analyzeTimeSeries.js';

export {
  getRecommendedStats,
  getRecommendedStatsSchema,
  getAvailableTopics,
  type GetRecommendedStatsInput,
} from './getRecommendedStats.js';

// 비활성화: 응답량 과다로 Cursor 초기화 유발
// export {
//   getTableInfo,
//   getTableInfoSchema,
//   type GetTableInfoInput,
// } from './getTableInfo.js';

export {
  quickStats,
  quickStatsSchema,
  type QuickStatsInput,
} from './quickStats.js';

export {
  quickTrend,
  quickTrendSchema,
  type QuickTrendInput,
} from './quickTrend.js';

// 도구 스키마들은 개별적으로 export되어 있습니다.
// server.ts에서 직접 import하여 사용하세요.
