# 🎯 Korea Stats MCP 사용성 개선 리포트

## 📋 테스트 개요

**테스트 관점**: 일반인/LLM이 처음 MCP를 사용할 때  
**테스트 날짜**: 2026-01-05  
**테스트 방법**: 자연스러운 질문으로 전체 플로우 테스트

---

## 🔴 발견된 주요 문제점

### 1. search_statistics - 자연어 검색 실패 ⚠️ Critical

| 검색어 | 기대 결과 | 실제 결과 | 상태 |
|--------|----------|----------|------|
| "한국 인구" | 총인구/인구수 통계 | 부양비 및 노령화지수 | ❌ |
| "총인구" | 인구수 통계 | 부양비 및 노령화지수 | ❌ |
| "인구수" | 인구수 통계 | 부양비 및 노령화지수 | ❌ |
| "주민등록인구" | 주민등록인구 | 부양비 및 노령화지수 | ❌ |
| "집값" | 주택가격 통계 | 귀촌의 이유(!) | ❌ |
| "주택가격" | 주택가격 통계 | 주택소유통계(주택수) | ⚠️ |
| "실업률" | 실업률 통계 | 성/연령별 실업률 | ✅ |
| "GDP" | GDP 통계 | 국내총생산 | ✅ |
| "물가" | 물가지수 | 소비자물가 등락률 | ✅ |
| "출산율" | 출산율 통계 | 합계출산율 | ✅ |
| "서울 실업률" | 지역별 실업률 | 행정구역별 실업률 | ✅ |

**원인 분석**:
- KOSIS API의 검색 알고리즘이 "인구" 키워드에 대해 부양비/노령화 통계를 상위에 반환
- "집값"이 TOPIC_MAPPINGS에 없음 (→ 이미 추가됨)
- 검색 결과 후처리에서 통계명 우선순위 조정 필요

**개선안**:
```typescript
// searchStatistics.ts - 검색 결과 후처리 추가
const PRIORITY_TABLES = {
  '인구': ['DT_1B04005', 'DT_1IN1503', 'DT_1YL20001'], // 총인구, 주민등록인구
  '집값': ['DT_1YL21101'], // 주택가격
  '주택가격': ['DT_1YL21101'],
};

// 검색 후 특정 키워드에 대해 우선 테이블 상위 배치
```

---

### 2. get_table_info - usageHint 지역코드 오류 ⚠️ Medium

**문제**:
usageHint 하단에 잘못된 지역코드 예시가 하드코딩되어 있음

```
현재 (잘못됨):
"지역 코드: 00=전국, 11=서울, 26=부산, 27=대구, 28=인천..."

실제 (경활 통계 기준):
"지역 코드: 00=계, 11=서울, 21=부산, 22=대구, 23=인천..."

실제 (인구동향 통계 기준):  
"지역 코드: 00=전국, 11=서울, 26=부산, 27=대구, 28=인천..."
```

**원인**:
- 통계표마다 지역코드 체계가 다름 (경활조사 vs 인구동향조사)
- usageHint에 하드코딩된 예시가 특정 통계표 기준임

**개선안**:
```typescript
// getTableInfo.ts - 하드코딩된 지역코드 예시 제거
// 대신 rawData에서 추출한 실제 코드만 표시

usageHint = `
### 사용 가능한 분류1(objL1) 코드
${actualC1Codes.map(c => `    - "${c.id}" (${c.name})`).join('\n')}

// 하드코딩된 "지역 코드: 00=전국, 11=서울..." 부분 삭제
`;
```

---

### 3. get_recommended_statistics - 핵심 통계 누락 ⚠️ Medium

**문제**:
"population" 토픽 추천에 기본 인구수 통계가 없음

**현재 추천 결과**:
1. 부양비 및 노령화지수
2. 부양인구비 및 노령화지수 - 남부·동남아시아
3. 부양인구비 및 노령화지수 - 동북·중앙아시아
4. 시군구/인구동태건수...
5. 시도/인구동태건수...

**기대 추천 결과**:
1. 주민등록인구현황 ⭐
2. 시도별 총인구 ⭐
3. 인구동태건수
4. 합계출산율
5. 고령인구비율

**개선안**:
```typescript
// getRecommendedStatistics.ts - 토픽별 추천 테이블 정의
const RECOMMENDED_TABLES: Record<string, string[]> = {
  population: [
    'DT_1B04005',    // 시도/성/연령별 주민등록인구
    'DT_1IN1503',    // 주민등록인구현황
    'DT_1B8000H',    // 인구동태건수
    'DT_1B81A17',    // 합계출산율
    'DT_1BPA002',    // 주요인구지표
  ],
  housing: [
    'DT_1YL21101',   // 아파트 매매/전세 가격
    // ...
  ],
};
```

---

### 4. compare_statistics - 다중 지역 비교 실패 ⚠️ Medium

**문제**:
`objL1: "11+21"` (서울+부산) 형식의 비교가 실패함

**테스트 결과**:
```json
{
  "success": false,
  "compareType": "item",
  "items": [],
  "summary": "비교 중 오류가 발생했습니다."
}
```

**개선안**:
```typescript
// compareStatistics.ts - 에러 시 상세 원인 제공
return {
  success: false,
  compareType: input.compareType,
  items: [],
  summary: "비교 중 오류가 발생했습니다.",
  error: errorMessage, // 추가
  usageHint: `
    다중 지역 비교 시 올바른 형식:
    - objL1: "11+21" (서울+부산)
    
    먼저 get_table_info로 유효한 코드를 확인하세요.
  `,
};
```

---

### 5. LLM 사용 플로우 - 단계가 너무 많음 ⚠️ High

**현재 플로우** (일반인 질문 → 답변까지):

```
사용자: "한국 실업률 알려줘"
    ↓
1. search_statistics("실업률")
    ↓
2. 테이블 목록 확인 → DT_1DA7102S 선택
    ↓
3. get_table_info("DT_1DA7102S")
    ↓
4. 분류 코드 확인 → objL1, itemId 파악
    ↓
5. get_statistics_data(objL1="0", objL2="00", itemId="T80")
    ↓
6. 결과 해석 및 응답
```

**문제점**:
- 6단계나 필요 (LLM 호출 5회)
- 일반 사용자 입장에서 복잡함
- LLM이 중간 단계에서 실수할 가능성 높음

**개선안 - quick_stats 도구 추가**:
```typescript
// 새 도구: quick_stats
export const quickStatsSchema = {
  name: 'quick_stats',
  description: '자주 묻는 통계를 한 번에 조회합니다. 내부적으로 검색, 테이블 정보 조회, 데이터 조회를 자동으로 수행합니다.',
  inputSchema: z.object({
    query: z.string().describe('자연어 질문. 예: "한국 실업률", "서울 인구", "2024년 출산율"'),
    region: z.string().optional().describe('지역명 (선택)'),
    year: z.number().optional().describe('연도 (선택, 미지정시 최근)'),
  }),
};

// 구현 로직
async function quickStats(input) {
  // 1. 키워드 → 추천 테이블 매핑
  const tableId = QUICK_STATS_MAPPING[extractKeyword(input.query)];
  
  // 2. 테이블 정보 자동 조회
  const tableInfo = await getTableInfo(tableId);
  
  // 3. 지역/연도 파라미터 자동 매핑
  const params = mapQueryToParams(input, tableInfo);
  
  // 4. 데이터 조회 및 자연어 응답 생성
  const data = await getStatisticsData(params);
  
  return {
    answer: formatNaturalLanguage(data), // "한국의 2024년 실업률은 2.8%입니다."
    source: { tableId, tableName, ... },
    rawData: data,
  };
}
```

---

## 📊 우선순위별 개선 로드맵

### 🔴 Priority 1 - 즉시 수정 필요

| 항목 | 설명 | 예상 작업량 |
|------|------|------------|
| search_statistics 결과 개선 | 인구/집값 검색 시 핵심 통계 상위 배치 | 2시간 |
| usageHint 지역코드 수정 | 하드코딩된 잘못된 코드 제거 | 30분 |

### 🟡 Priority 2 - 사용성 향상

| 항목 | 설명 | 예상 작업량 |
|------|------|------------|
| get_recommended_statistics 개선 | 토픽별 핵심 통계 정의 | 1시간 |
| compare_statistics 에러 개선 | 상세 에러 메시지 및 가이드 | 1시간 |

### 🟢 Priority 3 - 신규 기능

| 항목 | 설명 | 예상 작업량 |
|------|------|------------|
| quick_stats 도구 추가 | 원스텝 통계 조회 | 4시간 |
| 자연어 응답 생성기 | 데이터 → 문장 변환 | 2시간 |

---

## 💡 추가 개선 아이디어

### 1. 인기 검색어 기반 캐싱

```typescript
const POPULAR_QUERIES = {
  '실업률': { tableId: 'DT_1DA7102S', objL1: '0', objL2: '00', itemId: 'T80' },
  '출산율': { tableId: 'DT_1B8000H', objL1: '00', itemId: 'T12' },
  '인구': { tableId: 'DT_1B04005', objL1: '00', itemId: 'T2' },
  // ...
};
```

### 2. 검색 동의어 사전

```typescript
const SYNONYMS = {
  '인구': ['인구수', '총인구', '주민등록인구', '인구현황'],
  '집값': ['주택가격', '아파트값', '부동산가격', '집가격'],
  '월급': ['임금', '급여', '소득', '평균임금'],
  '범죄': ['범죄율', '치안', '범죄발생'],
};
```

### 3. 스마트 기본값

```typescript
// 지역 미지정 시 → 전국 데이터
// 연도 미지정 시 → 최근 5개년
// 항목 미지정 시 → 대표 항목 (예: 인구수, 합계출산율)
```

---

## ✅ 테스트 결과 요약

| 카테고리 | 테스트 수 | 성공 | 실패 | 성공률 |
|----------|----------|------|------|--------|
| 자연어 검색 | 11 | 6 | 5 | 55% |
| 테이블 정보 조회 | 3 | 3 | 0 | 100% |
| 데이터 조회 | 4 | 4 | 0 | 100% |
| 비교 분석 | 2 | 1 | 1 | 50% |
| **전체** | **20** | **14** | **6** | **70%** |

---

## 🎯 결론

현재 korea-stats-mcp는 **기술적으로는 잘 동작**하지만, **일반 사용자 관점에서는 개선이 필요**합니다.

가장 큰 문제는:
1. **"인구" 검색 시 인구수 통계가 안 나옴** - 가장 기본적인 질문인데 실패
2. **단계가 너무 많음** - 간단한 질문에 5번의 API 호출 필요

권장 조치:
1. **즉시**: search_statistics 결과 후처리 추가
2. **단기**: quick_stats 도구 추가로 원스텝 조회 지원
3. **중기**: 자연어 응답 생성기 추가

이 개선들이 적용되면 **일반인도 "한국 실업률"이라고 물어보면 바로 "2024년 한국 실업률은 2.8%입니다"라는 답변**을 받을 수 있게 됩니다.


