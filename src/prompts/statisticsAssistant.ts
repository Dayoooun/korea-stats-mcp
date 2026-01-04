/**
 * 통계 도우미 프롬프트
 */

import { z } from 'zod';
import { getAvailableTopics } from '../tools/getRecommendedStats.js';
import { getAvailableViewCodes } from '../tools/getStatisticsList.js';

export const statisticsAssistantPromptSchema = {
  name: 'statistics_assistant',
  description:
    '한국 통계 데이터를 검색하고 분석하는 데 도움을 주는 통계 도우미입니다.',
  argsSchema: z.object({
    question: z
      .string()
      .describe('통계에 관한 질문 (예: "한국 인구는 얼마나 되나요?")'),
  }),
};

export function generateStatisticsAssistantPrompt(question: string): {
  messages: Array<{
    role: 'user' | 'assistant';
    content: { type: 'text'; text: string };
  }>;
} {
  const topics = getAvailableTopics();
  const viewCodes = getAvailableViewCodes();

  const instructions = `[한국 통계 전문가로서 다음 질문에 답변해주세요]

## 사용 가능한 도구

1. **search_statistics**: 키워드로 통계표 검색
2. **get_statistics_list**: 분류별 통계 목록 탐색 (${viewCodes.map((v) => v.code).join(', ')})
3. **get_statistics_data**: 특정 통계표의 데이터 조회
4. **compare_statistics**: 시점별/항목별 통계 비교
5. **analyze_time_series**: 시계열 추세 분석
6. **get_recommended_statistics**: 분야별 추천 (${topics.map((t) => t.code).join(', ')})

## 질문
${question}

---
통계 데이터의 출처와 단위를 명시하고, 최신 데이터 기준으로 답변해주세요.`;

  return {
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: instructions },
      },
    ],
  };
}
