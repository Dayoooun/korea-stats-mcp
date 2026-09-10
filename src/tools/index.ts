/**
 * MCP 도구 등록 통합
 */

export {
  searchIndicators,
  searchIndicatorsSchema,
  getIndicator,
  getIndicatorSchema,
} from "./indicators.js";
export { searchBusinesses, searchBusinessesSchema } from "./businesses.js";
export {
  searchMicrodata,
  searchMicrodataSchema,
  getMicrodataInfo,
  getMicrodataInfoSchema,
} from "./mdis.js";
export { registerPublicTools } from "./registerPublicTools.js";
export {
  searchStatistics,
  searchStatisticsSchema,
  type SearchStatisticsInput,
} from "./searchStatistics.js";

export {
  getStatisticsList,
  getStatisticsListSchema,
  getAvailableViewCodes,
  type GetStatisticsListInput,
} from "./getStatisticsList.js";

export {
  getStatisticsData,
  getStatisticsDataSchema,
  type GetStatisticsDataInput,
} from "./getStatisticsData.js";

export {
  compareStatistics,
  compareStatisticsSchema,
  type CompareStatisticsInput,
} from "./compareStatistics.js";

export {
  analyzeTimeSeries,
  analyzeTimeSeriesSchema,
  type AnalyzeTimeSeriesInput,
} from "./analyzeTimeSeries.js";

export {
  getRecommendedStats,
  getRecommendedStatsSchema,
  getAvailableTopics,
  type GetRecommendedStatsInput,
} from "./getRecommendedStats.js";

export {
  getTableInfo,
  getTableInfoSchema,
  type GetTableInfoInput,
} from "./getTableInfo.js";

export {
  quickStats,
  quickStatsSchema,
  type QuickStatsInput,
} from "./quickStats.js";

export {
  quickTrend,
  quickTrendSchema,
  type QuickTrendInput,
} from "./quickTrend.js";

// 도구 스키마들은 개별적으로 export되어 있습니다.
// server.ts에서 직접 import하여 사용하세요.
