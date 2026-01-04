/**
 * 데이터 포매팅 유틸리티
 */

import type { StatisticsDataItem, SimplifiedDataItem } from '../api/types.js';

/**
 * 통계 데이터 간소화
 */
export function simplifyStatisticsData(
  items: StatisticsDataItem[]
): SimplifiedDataItem[] {
  return items.map((item) => ({
    period: formatPeriod(item.PRD_DE, item.PRD_SE),
    value: formatNumber(item.DT),
    classification: getClassificationName(item),
    item: item.ITM_NM,
    unit: item.UNIT_NM,
  }));
}

/**
 * 분류명 추출
 */
function getClassificationName(item: StatisticsDataItem): string {
  const names: string[] = [];

  for (let i = 1; i <= 8; i++) {
    const name = item[`C${i}_NM` as keyof StatisticsDataItem];
    if (name) {
      names.push(name as string);
    }
  }

  return names.join(' > ') || '-';
}

/**
 * 시점 포매팅
 */
export function formatPeriod(period: string, periodType: string): string {
  if (!period) return '-';

  switch (periodType) {
    case 'Y':
      return `${period}년`;
    case 'Q':
      return `${period.slice(0, 4)}년 ${period.slice(4)}분기`;
    case 'M':
      return `${period.slice(0, 4)}년 ${parseInt(period.slice(4), 10)}월`;
    case 'D':
      return `${period.slice(0, 4)}.${period.slice(4, 6)}.${period.slice(6)}`;
    default:
      return period;
  }
}

/**
 * 숫자 포매팅
 */
export function formatNumber(value: string): string {
  if (!value || value === '-' || value === '...') return value;

  // 숫자가 아닌 경우 그대로 반환
  const num = parseFloat(value.replace(/,/g, ''));
  if (isNaN(num)) return value;

  // 천 단위 구분자 추가
  return num.toLocaleString('ko-KR', {
    maximumFractionDigits: 2,
  });
}

/**
 * 변화율 계산
 */
export function calculateChangeRate(
  current: number,
  previous: number
): {
  rate: number;
  direction: 'up' | 'down' | 'stable';
  formatted: string;
} {
  if (previous === 0) {
    return { rate: 0, direction: 'stable', formatted: '-' };
  }

  const rate = ((current - previous) / Math.abs(previous)) * 100;
  const direction = rate > 0.1 ? 'up' : rate < -0.1 ? 'down' : 'stable';
  const sign = rate > 0 ? '+' : '';
  const formatted = `${sign}${rate.toFixed(1)}%`;

  return { rate, direction, formatted };
}

/**
 * 추세 분석
 */
export function analyzeTrend(
  values: number[]
): {
  trend: 'increasing' | 'decreasing' | 'stable' | 'fluctuating';
  avgGrowthRate: number;
  volatility: number;
} {
  if (values.length < 2) {
    return { trend: 'stable', avgGrowthRate: 0, volatility: 0 };
  }

  // 변화율 계산
  const changes: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] !== 0) {
      changes.push((values[i] - values[i - 1]) / Math.abs(values[i - 1]) * 100);
    }
  }

  if (changes.length === 0) {
    return { trend: 'stable', avgGrowthRate: 0, volatility: 0 };
  }

  // 평균 변화율
  const avgGrowthRate = changes.reduce((a, b) => a + b, 0) / changes.length;

  // 변동성 (표준편차)
  const variance =
    changes.reduce((sum, val) => sum + Math.pow(val - avgGrowthRate, 2), 0) /
    changes.length;
  const volatility = Math.sqrt(variance);

  // 추세 판단
  let trend: 'increasing' | 'decreasing' | 'stable' | 'fluctuating';
  if (volatility > 20) {
    trend = 'fluctuating';
  } else if (avgGrowthRate > 2) {
    trend = 'increasing';
  } else if (avgGrowthRate < -2) {
    trend = 'decreasing';
  } else {
    trend = 'stable';
  }

  return { trend, avgGrowthRate, volatility };
}

/**
 * 시각화 타입 추천
 */
export function recommendVisualization(
  dataLength: number,
  hasMultipleCategories: boolean,
  isTimeSeries: boolean
): {
  type: 'bar' | 'line' | 'pie' | 'table';
  reason: string;
} {
  if (isTimeSeries && dataLength > 2) {
    return {
      type: 'line',
      reason: '시계열 데이터는 선 그래프로 추세를 파악하기 좋습니다.',
    };
  }

  if (hasMultipleCategories && dataLength <= 6) {
    return {
      type: 'pie',
      reason: '비율 비교는 파이 차트가 적합합니다.',
    };
  }

  if (dataLength <= 10) {
    return {
      type: 'bar',
      reason: '항목 비교는 막대 그래프가 효과적입니다.',
    };
  }

  return {
    type: 'table',
    reason: '데이터가 많아 표 형식이 가장 적합합니다.',
  };
}
